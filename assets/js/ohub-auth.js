/* Orascom BIM Hub — front-door auth (static, no backend).
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
  function hasUsers() { return Object.keys(readUsers()).length > 0; }
  function hasSession() {
    try { return !!sessionStorage.getItem(SS_SESSION); } catch (e) { return false; }
  }

  window.OHubAuth = {
    hasUsers: hasUsers,
    hasSession: hasSession,
    setup: function (username, password) {
      username = String(username || '').trim();
      if (!username) return Promise.reject(new Error('Pick a username'));
      if (!password || password.length < 4) return Promise.reject(new Error('Password needs 4+ characters'));
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
        if (hash !== rec.hash) return false;
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
