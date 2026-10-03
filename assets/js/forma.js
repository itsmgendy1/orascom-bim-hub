/* ==========================================================================
   Orascom BIM Hub — Autodesk Forma live link (100% free, no backend)
   --------------------------------------------------------------------------
   Public-client OAuth2 PKCE straight from this static page (same pattern as
   Autodesk's own SPA sample). No client secret, no server, nothing uploaded.

   Requirements (all free):
     1. An APS app (https://aps.autodesk.com/myapps) of type
        "Desktop, Mobile & Single Page App" (PKCE) — copy its Client ID.
        Register this redirect URL in the app:
            http://localhost:8000/auth.html   (your port/folder may differ —
            use whatever serves this file, then /auth.html beside it)
     2. Serve this folder over HTTP, e.g.  python -m http.server 8000
        (OAuth + crypto.subtle do NOT work from file:// — the UI says so.)
     3. A Forma license/trial + the Forma Project ID (last part of the
        Forma project URL).

    Security notes (shown in Settings too):
      - Access token lives in MEMORY only. Refresh token (15 days) lives in
        THIS browser's localStorage by default, or sessionStorage-only when
        "Forget on tab close" is ticked in Settings. Disconnect wipes both.
      - Read-only scope (data:read). Nothing is ever written back to Forma.
   ========================================================================== */
(function(){
  "use strict";

  var AUTH_URL  = 'https://developer.api.autodesk.com/authentication/v2/authorize';
  var TOKEN_URL = 'https://developer.api.autodesk.com/authentication/v2/token';
  var FORMA_API = 'https://developer.api.autodesk.com/forma/project/v1alpha';
  var SCOPES    = 'data:read';

  var LS_CFG     = 'ohub_forma_cfg';      // {clientId, region, sessionOnly}
  var LS_REFRESH = 'ohub_forma_refresh';  // refresh token (this browser only)

  // Refresh-token store follows the Settings choice: localStorage (stay signed
  // in across restarts) or sessionStorage-only (forget on tab close). Default
  // stays local — existing behavior unchanged unless the user opts in.
  function refreshStore(){ try{ return (cfg().sessionOnly===true) ? sessionStorage : localStorage; }catch(e){ return localStorage; } }
  function readRefresh(){ try{ var v = refreshStore().getItem(LS_REFRESH); return v ? JSON.parse(v) : null; }catch(e){ return null; } }
  function writeRefresh(tok){
    try{ localStorage.removeItem(LS_REFRESH); }catch(e){}
    try{ sessionStorage.removeItem(LS_REFRESH); }catch(e){}
    if(tok==null) return;
    try{ refreshStore().setItem(LS_REFRESH, JSON.stringify(tok)); }catch(e){}
  }
  var LS_LINKS   = 'ohub_forma_links';    // {hubProjectId: {formaId, name, figures, updated}}

  var memAccess = null, memExpiry = 0;

  function readLS(k, fb){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }catch(e){ return fb; } }
  function writeLS(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function toast(m){ var h=document.getElementById('toast-host'); if(!h){ alert(m); return; } var t=document.createElement('div'); t.className='toast'; t.textContent=m; h.appendChild(t); setTimeout(function(){ t.remove(); }, 3000); }

  function cfg(){ return readLS(LS_CFG, {clientId:'', region:'EMEA'}); }
  // Merge (never replace): Settings inputs save partial objects; dropping
  // unknown keys here would silently wipe the sessionOnly choice.
  function saveCfg(c){ writeLS(LS_CFG, Object.assign({}, cfg(), c)); }
  // Move any stored refresh token between stores when the choice flips.
  function setSessionOnly(on){
    var cur = readRefresh();
    var c = cfg(); c.sessionOnly = !!on; saveCfg(c);
    writeRefresh(null);
    if(cur){ try{ ((!!on) ? sessionStorage : localStorage).setItem(LS_REFRESH, JSON.stringify(cur)); }catch(e){} }
    return !!(cfg().sessionOnly);
  }
  function callbackUrl(){
    var path = location.pathname.replace(/[^/]*$/, '');
    return location.origin + path + 'auth.html';
  }
  function secureCtx(){
    return !!(window.crypto && window.crypto.subtle && window.isSecureContext !== false &&
              (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'));
  }

  function b64url(buf){
    var s = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
    return s.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function randomString(n){
    var a = new Uint8Array(n || 64);
    if(window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for(var j=0;j<a.length;j++) a[j] = Math.floor(Math.random()*256);
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~', s = '';
    for(var i=0;i<a.length;i++) s += chars[a[i] % chars.length];
    return s;
  }

  /* ---------------- login / callback / refresh ---------------- */
  function beginLogin(returnView){
    var c = cfg();
    if(!c.clientId){ toast('Paste your APS Client ID in Settings first'); return; }
    if(!secureCtx()){ toast('Login needs HTTP(S) — serve the Hub (python -m http.server), not file://'); return; }
    var verifier = randomString(64);
    window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function(hash){
      var state = randomString(24);
      try{
        sessionStorage.setItem('ohub_forma_verifier', verifier);
        sessionStorage.setItem('ohub_forma_state', state);
        sessionStorage.setItem('ohub_forma_return', returnView || 'settings');
      }catch(e){}
      var u = AUTH_URL + '?response_type=code' +
        '&client_id=' + encodeURIComponent(c.clientId) +
        '&redirect_uri=' + encodeURIComponent(callbackUrl()) +
        '&scope=' + encodeURIComponent(SCOPES) +
        '&code_challenge=' + b64url(hash) +
        '&code_challenge_method=S256' +
        '&state=' + encodeURIComponent(state) +
        '&prompt=login';
      location.href = u;
    }).catch(function(){ toast('This browser cannot do PKCE (WebCrypto missing)'); });
  }

  function handleCallback(){
    var q = {};
    location.search.replace(/^\?/, '').split('&').forEach(function(p){
      var kv = p.split('='); if(kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||'');
    });
    var back = function(view){ location.href = 'hub.html#/' + view; };
    if(q.error){ renderAuthMsg('Login refused: ' + (q.error_description || q.error)); return; }
    if(!q.code){ renderAuthMsg('No authorization code received.'); return; }
    var verifier = null, state = null, ret = 'settings';
    try{
      verifier = sessionStorage.getItem('ohub_forma_verifier');
      state = sessionStorage.getItem('ohub_forma_state');
      ret = sessionStorage.getItem('ohub_forma_return') || 'settings';
    }catch(e){}
    if(!verifier || !q.state || !state || q.state!==state){ renderAuthMsg('Session mismatch — start login again from the Hub.'); return; }
    renderAuthMsg('Exchanging code for token…');
    var body = 'grant_type=authorization_code' +
      '&code=' + encodeURIComponent(q.code) +
      '&redirect_uri=' + encodeURIComponent(callbackUrl()) +
      '&code_verifier=' + encodeURIComponent(verifier) +
      '&client_id=' + encodeURIComponent(cfg().clientId);
    fetch(TOKEN_URL, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:body})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(j){
        if(!j.access_token) throw new Error('no access token returned');
        memAccess = j.access_token;
        memExpiry = Date.now() + ((j.expires_in || 3600) * 1000) - 60000;
        if(j.refresh_token){ writeRefresh(j.refresh_token); }
        try{ sessionStorage.removeItem('ohub_forma_verifier'); sessionStorage.removeItem('ohub_forma_state'); }catch(e){}
        back(ret);
      })
      .catch(function(err){ renderAuthMsg('Token exchange failed: ' + err.message); });
  }
  function renderAuthMsg(m){
    var el = document.getElementById('auth-msg');
    if(el){ el.textContent = m; return; }
    var p = document.createElement('p');
    p.style.cssText = 'font-family:sans-serif;padding:40px;';
    p.textContent = m;
    document.body.appendChild(p);
  }

  function getAccessToken(){
    if(memAccess && Date.now() < memExpiry) return Promise.resolve(memAccess);
    var rt = readRefresh();
    if(!rt) return Promise.resolve(null);
    var body = 'grant_type=refresh_token' +
      '&refresh_token=' + encodeURIComponent(rt) +
      '&client_id=' + encodeURIComponent(cfg().clientId) +
      '&scope=' + encodeURIComponent(SCOPES);
    return fetch(TOKEN_URL, {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:body})
      .then(function(r){ if(!r.ok) throw new Error('refresh HTTP '+r.status); return r.json(); })
      .then(function(j){
        memAccess = j.access_token;
        memExpiry = Date.now() + ((j.expires_in || 3600) * 1000) - 60000;
        if(j.refresh_token){ writeRefresh(j.refresh_token); }
        return memAccess;
      })
      .catch(function(){ memAccess = null; return null; });
  }

  function disconnect(){
    memAccess = null; memExpiry = 0;
    writeRefresh(null);
    toast('Forma disconnected (tokens wiped)');
    if(window.OHub) window.OHub.switchView('settings');
  }

  /* ---------------- Forma reads (defensive: Beta API shapes shift) ---------------- */
  function apiGet(path){
    return getAccessToken().then(function(tok){
      if(!tok) throw new Error('not connected');
      return fetch(FORMA_API + path, {headers:{
        'Authorization':'Bearer ' + tok,
        'x-ads-region': cfg().region || 'EMEA',
        'Accept':'application/json'
      }});
    }).then(function(r){ if(!r.ok) throw new Error('Forma HTTP '+r.status); return r.json(); });
  }
  function getProject(pid){
    return apiGet('/projects/' + encodeURIComponent(pid));
  }
  // Best-effort key figures: surface what the API actually returns, invent nothing.
  function summarizeProject(j){
    if(!j || typeof j !== 'object') return {name:'(empty response)', figures:[]};
    var name = j.name || j.displayName || j.projectName || '(unnamed project)';
    var skip = {id:true, projectId:true, urn:true, href:true, links:true, _links:true, type:true};
    var figs = [];
    Object.keys(j).forEach(function(k){
      if(figs.length >= 8 || skip[k]) return;
      var v = j[k];
      if(v == null) return;
      if(typeof v === 'number') figs.push({k:k, v:(Math.round(v*100)/100).toLocaleString()});
      else if(typeof v === 'string' && v.length <= 60 && v.indexOf('http') !== 0) figs.push({k:k, v:v});
      else if(Array.isArray(v)) figs.push({k:k, v:v.length + ' item(s)'});
    });
    return {name:name, figures:figs};
  }

  /* ---------------- Hub-project link (cached snapshot for offline view) ---------------- */
  function links(){ return readLS(LS_LINKS, {}); }
  function linkProject(hubId, formaId){
    var all = links();
    var prev = all[hubId];
    all[hubId] = {formaId:formaId, source:'live',
      name:(prev && prev.formaId===formaId && prev.name) ? prev.name : '(fetching…)',
      figures:(prev && prev.formaId===formaId && prev.figures) ? prev.figures : [],
      updated:(prev && prev.formaId===formaId && prev.updated) ? prev.updated : 0};
    writeLS(LS_LINKS, all);
  }
  function unlinkProject(hubId){
    var all = links(); delete all[hubId]; writeLS(LS_LINKS, all);
  }
  function refreshLink(hubId){
    var all = links(), L = all[hubId];
    if(!L) return Promise.resolve(null);
    return getProject(L.formaId).then(function(j){
      var s = summarizeProject(j);
      all[hubId] = {formaId:L.formaId, source:'live', name:s.name, figures:s.figures, updated:Date.now()};
      writeLS(LS_LINKS, all);
      return all[hubId];
    });
  }
  // APS-free path: snapshot parsed from a Forma export file (Data Center).
  function saveFileSnapshot(hubId, fileName, figures){
    var all = links();
    var base = String(fileName||'Forma export').replace(/\.[^.]+$/, '');
    all[hubId] = {formaId:null, fileName:fileName, source:'file',
      name:base, figures:figures||[], updated:Date.now()};
    writeLS(LS_LINKS, all);
    return all[hubId];
  }

  window.OForma = {
    cfg: cfg, saveCfg: saveCfg, setSessionOnly: setSessionOnly,
    isSessionOnly: function(){ return cfg().sessionOnly===true; },
    isConfigured: function(){ return !!(cfg().clientId); },
    beginLogin: beginLogin, handleCallback: handleCallback,
    getAccessToken: getAccessToken, disconnect: disconnect,
    getProject: getProject, summarizeProject: summarizeProject,
    links: links, linkProject: linkProject, unlinkProject: unlinkProject,
    refreshLink: refreshLink, saveFileSnapshot: saveFileSnapshot, secureCtx: secureCtx
  };
})();
