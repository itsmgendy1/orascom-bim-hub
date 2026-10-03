/* Orascom BIM Hub — front-door auth (static, no backend).
 *
 * honesty: this is a DEMO-GRADE browser-local gate, not server security.
 * It keeps honest people honest on a shared workstation; anyone with
 * DevTools can bypass it. Real enforcement lives on the sync Worker
 * (team accounts). Labels in the login UI say the same.
 *
 * Model: first run creates an admin (setup mode); after that the landing
 * shows login. Credentials live in THIS browser's localStorage as
 * salted SHA-256 hashes (never plaintext). A session flag in
 * sessionStorage unlocks hub.html per tab; hub.html redirects back here
 * without it. Deep links survive via sessionStorage redirect target.
 */
(function () {
  'use strict';
  var LS_USERS = 'ohub_users';
  var SS_SESSION = 'ohub_session';
  var SS_NEXT = 'ohub_next';

  function readUsers() {
    try { return JSON.parse(localStorage.getItem(LS_USERS) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writeUsers(u) {
    try { localStorage.setItem(LS_USERS, JSON.stringify(u)); return true; }
    catch (e) { return false; }
  }
  function randHex(n) {
    var a = new Uint8Array(n || 16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    var s = '';
    for (var j = 0; j < a.length; j++) s += ('0' + a[j].toString(16)).slice(-2);
    return s;
  }
  function sha256hex(text) {
    if (window.crypto && window.crypto.subtle) {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      });
    }
    // No WebCrypto (old browser / insecure context): plain fallback hash.
    // Honest downgrade — works everywhere, weaker offline protection.
    return Promise.resolve('plain$' + btoa(unescape(encodeURIComponent(text))).split('').reverse().join(''));
  }
  // Legacy verifier for accounts created where WebCrypto was missing.
  // Used once to transparently upgrade plain$ hashes to salted SHA-256.
  function legacyPlain(text) {
    try { return 'plain$' + btoa(unescape(encodeURIComponent(text))).split('').reverse().join(''); }
    catch (e) { return null; }
  }
  function hasUsers() { return Object.keys(readUsers()).length > 0; }
  function hasSession() {
    try { return !!sessionStorage.getItem(SS_SESSION); } catch (e) { return false; }
  }
  function cloudCfg() {
    try {
      var c = JSON.parse(localStorage.getItem('ohub_cloud') || '{}') || {};
      return { url: String(c.url || '').replace(/\/+$/, ''), token: String(c.token || '') };
    } catch (e) { return { url: '', token: '' }; }
  }
  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
    }, function () { throw new Error('Server unreachable — check connection.'); });
  }

  window.OHubAuth = {
    hasUsers: hasUsers,
    hasSession: hasSession,
    cloudCfg: cloudCfg,
    // Team sign-in against the Worker. Plaintext password never leaves:
    // we fetch the salt, hash locally, and send only the hash.
    cloudLogin: function (url, username, password) {
      username = String(username || '').trim();
      var base = String(url || '').replace(/\/+$/, '');
      if (!base) return Promise.reject(new Error('Set the team server URL first.'));
      if (!username || !password) return Promise.reject(new Error('Enter username and password.'));
      return fetchJson(base + '/api/users/salt?username=' + encodeURIComponent(username))
        .then(function (res) {
          if (res.status === 404 || !res.body.ok) throw new Error('Unknown team account.');
          if (!res.body.salt) throw new Error('Server misconfigured (no salt).');
          return sha256hex(res.body.salt + '$' + password);
        })
        .then(function (hash) {
          return fetchJson(base + '/api/users/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, hash: hash }),
          });
        })
        .then(function (res) {
          if (res.status === 429) throw new Error('Too many attempts — try later.');
          if (!res.body.ok || !res.body.sid) throw new Error('Wrong username or password.');
          try {
            sessionStorage.setItem(SS_SESSION, JSON.stringify({ u: res.body.username, sid: res.body.sid, cloud: base }));
          } catch (e) { throw new Error('Browser storage blocked.'); }
          return res.body.username;
        });
    },
    cloudLogout: function () {
      var sid = '', cloud = '';
      try {
        var s = JSON.parse(sessionStorage.getItem(SS_SESSION) || 'null');
        if (s && s.sid) { sid = s.sid; cloud = s.cloud || ''; }
      } catch (e) {}
      var done = function () {
        try { sessionStorage.removeItem(SS_SESSION); } catch (e2) {}
      };
      if (!sid || !cloud) { done(); return Promise.resolve(); }
      return fetch(cloud + '/api/users/logout', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + sid },
      }).catch(function () {}).then(done);
    },
    setup: function (username, password) {
      username = String(username || '').trim();
      if (!username) return Promise.reject(new Error('Pick a username'));
      if (!password || password.length < 12) return Promise.reject(new Error('Password needs 12+ characters'));
      var users = readUsers();
      if (users[username]) return Promise.reject(new Error('That username is taken'));
      var salt = randHex(16);
      return sha256hex(salt + '$' + password).then(function (hash) {
        users[username] = { salt: salt, hash: hash, created: Date.now() };
        if (!writeUsers(users)) throw new Error('Browser storage blocked');
      });
    },
    login: function (username, password) {
      username = String(username || '').trim();
      var users = readUsers();
      var rec = users[username];
      if (!rec) return Promise.resolve(false);
      return sha256hex(rec.salt + '$' + password).then(function (hash) {
        if (hash !== rec.hash) {
          // Legacy plain$ account (created where WebCrypto was missing):
          // verify with the old formula once, then transparently upgrade
          // to salted SHA-256 so access is never lost and never stays weak.
          if (rec.hash && rec.hash.indexOf('plain$') === 0 &&
              window.crypto && window.crypto.subtle &&
              legacyPlain(rec.salt + '$' + password) === rec.hash) {
            rec.hash = hash; users[username] = rec; writeUsers(users);
          } else {
            return false;
          }
        }
        try {
          sessionStorage.setItem(SS_SESSION, JSON.stringify({ u: username, t: Date.now() }));
        } catch (e) { return false; }
        return true;
      });
    },
    logout: function () {
      try { sessionStorage.removeItem(SS_SESSION); } catch (e) {}
    },
    user: function () {
      try {
        var s = JSON.parse(sessionStorage.getItem(SS_SESSION) || 'null');
        return (s && s.u) || '';
      } catch (e) { return ''; }
    },
    // hub.html guard: remember where we were headed, then bounce to landing.
    bounceToLogin: function () {
      try {
        if (location.hash && location.hash.length > 2) sessionStorage.setItem(SS_NEXT, location.hash);
      } catch (e) {}
      location.replace('index.html');
    },
    // landing: after login, resume the saved deep link (if any).
    enterHub: function () {
      var next = '';
      try {
        next = sessionStorage.getItem(SS_NEXT) || '';
        sessionStorage.removeItem(SS_NEXT);
      } catch (e) {}
      location.href = 'hub.html' + (next && next.charAt(0) === '#' ? next : '');
    }
  };
})();
