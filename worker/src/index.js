/* Orascom Hub — Auth + User-data Worker (Cloudflare Workers + D1).
 * Zero dependencies. WebCrypto only (PBKDF2-SHA256 passwords, random sessions).
 * Auth: HttpOnly Secure SameSite=None session cookie (ohub_sid), 7-day sliding.
 * Every protected route re-validates session + role server-side; the browser
 * userId is NEVER trusted — data is keyed by the session's user_id in D1.
 */

const SESSION_COOKIE = 'ohub_sid';
const SESSION_TTL = 7 * 24 * 3600;
const PBKDF2_ITER = 120000;
const MAX_SNAPSHOT = 5 * 1024 * 1024;

// Stores this API will persist (Hub ohub_* dataset names). Anything else: 400.
const STORES = ['projects', 'scores', 'issues', 'deliverables', 'models',
  'gates', 'weights', 'thresholds', 'activity', 'reports', 'history', 'dark'];

// Role -> permissions. Frontend mirrors for visibility only; enforced HERE.
const PERMS = {
  ADMIN: ['VIEW_OWN_DATA', 'EDIT_OWN_DATA', 'DELETE_OWN_DATA', 'VIEW_ALL_USERS',
    'MANAGE_USERS', 'APPROVE_USERS', 'VIEW_ALL_DATA', 'MANAGE_SETTINGS', 'VIEW_AUDIT_LOG'],
  MANAGER: ['VIEW_OWN_DATA', 'EDIT_OWN_DATA', 'DELETE_OWN_DATA', 'VIEW_ALL_DATA'],
  COORDINATOR: ['VIEW_OWN_DATA', 'EDIT_OWN_DATA', 'VIEW_ALL_DATA'],
  QA: ['VIEW_OWN_DATA', 'EDIT_OWN_DATA', 'VIEW_ALL_DATA'],
  VIEWER: ['VIEW_OWN_DATA'],
  USER: ['VIEW_OWN_DATA', 'EDIT_OWN_DATA', 'DELETE_OWN_DATA'],
};
const ROLES = Object.keys(PERMS);
const STATUSES = ['PENDING', 'ACTIVE', 'DISABLED', 'REJECTED'];

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const now = () => Math.floor(Date.now() / 1000);
const uid = (p) => p + '_' + Date.now().toString(36) + b64u(rand(6)).replace(/-/g, '');

async function sha256hex(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function pbkdf2(pass, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
  return hex(bits);
}
// Constant-time string compare (auth paths).
function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- CORS (Pages origins + localhost dev) ---------- */
const ORIGIN_RES = [/^https:\/\/orascom-bim-hub\.pages\.dev$/,
  /^https:\/\/[a-z0-9-]+\.orascom-bim-hub\.pages\.dev$/,
  /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
function allowOrigin(req) {
  const o = req.headers.get('Origin') || '';
  return ORIGIN_RES.some((re) => re.test(o)) ? o : null;
}
function corsHeaders(req) {
  const h = { 'Vary': 'Origin' };
  const o = allowOrigin(req);
  if (o) { h['Access-Control-Allow-Origin'] = o; h['Access-Control-Allow-Credentials'] = 'true'; }
  return h;
}
function json(req, obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...corsHeaders(req), ...extra },
  });
}
function preflight(req) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(req),
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/* ---------- sessions ---------- */
function cookieSid(req) {
  const c = req.headers.get('Cookie') || '';
  const m = c.match(/(?:^|;\s*)ohub_sid=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  const a = req.headers.get('Authorization') || '';
  const b = a.match(/^Bearer\s+(.+)$/i);
  return b ? b[1].trim() : null;
}
function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=None`;
}
function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
}
async function currentUser(req, env) {
  const tok = cookieSid(req);
  if (!tok || tok.length > 256) return null;
  const th = await sha256hex(tok);
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash=?').bind(th).first();
  if (!s || s.expires_at < now()) return null;
  const u = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(s.user_id).first();
  if (!u || u.status !== 'ACTIVE') return null;
  // Sliding expiry (cheap, one write per request at most every few hours).
  if (s.expires_at - now() < SESSION_TTL - 3600) {
    await env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?')
      .bind(now() + SESSION_TTL, th).run();
  }
  delete u.pass_hash; delete u.pass_salt;
  return u;
}
function can(u, perm) { return (PERMS[u.role] || []).includes(perm); }
async function audit(env, ctx, e) {
  try {
    await env.DB.prepare(
      'INSERT INTO audit(ts,actor_id,actor_username,action,target_id,detail,ip) VALUES (?,?,?,?,?,?,?)')
      .bind(now(), e.actor_id || null, e.actor_username || null, e.action,
        e.target_id || null, e.detail || null, e.ip || null).run();
  } catch (_) { /* audit must never break the request */ }
}
const ipOf = (req) => req.headers.get('CF-Connecting-IP') || '';

/* ---------- router ---------- */
export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return preflight(req);
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    let body = {};
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      try { body = await req.json(); } catch (_) { body = {}; }
    }
    const need = async (perm) => {
      const u = await currentUser(req, env);
      if (!u) return { err: json(req, { ok: false, error: 'unauthorized' }, 401) };
      if (perm && !can(u, perm)) return { err: json(req, { ok: false, error: 'forbidden' }, 403) };
      return { u };
    };

    /* ----- public: account request ----- */
    if (path === '/api/auth/request' && req.method === 'POST') {
      const reg = await env.DB.prepare("SELECT value FROM settings WHERE key='registration_open'").first();
      if (!reg || reg.value !== '1') return json(req, { ok: false, error: 'registration closed' }, 403);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const email = String(body.email || '').trim().slice(0, 120);
      const display = String(body.displayName || username).trim().slice(0, 80);
      if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return json(req, { ok: false, error: 'bad username' }, 400);
      if (password.length < 12) return json(req, { ok: false, error: 'password needs 12+ characters' }, 400);
      const salt = hex(rand(16));
      try {
        await env.DB.prepare(
          'INSERT INTO users(id,username,email,display_name,pass_salt,pass_hash,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .bind(uid('usr'), username, email || null, display, salt, await pbkdf2(password, salt), 'USER', 'PENDING', now()).run();
      } catch (_) { return json(req, { ok: false, error: 'username taken' }, 409); }
      ctx.waitUntil(audit(env, ctx, { action: 'ACCOUNT_CREATED', target_id: username, ip: ipOf(req) }));
      return json(req, { ok: true, status: 'PENDING' });
    }

    /* ----- public: login ----- */
    if (path === '/api/auth/login' && req.method === 'POST') {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const t = now();
      const tries = await env.DB.prepare(
        'SELECT COUNT(*) c FROM login_attempts WHERE username=? AND ts>?').bind(username, t - 600).first();
      if (tries && tries.c >= 10) return json(req, { ok: false, error: 'too many attempts — try later' }, 429);
      const u = await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
      const fail = async (msg, code = 401) => {
        await env.DB.prepare('INSERT INTO login_attempts(ts,username,ip) VALUES (?,?,?)')
          .bind(t, username, ipOf(req)).run();
        ctx.waitUntil(audit(env, ctx, { action: 'FAILED_LOGIN', target_id: username, ip: ipOf(req) }));
        return json(req, { ok: false, error: msg }, code);
      };
      if (!u) return fail('wrong username or password');
      if (u.status === 'PENDING') return fail('account pending approval', 403);
      if (u.status !== 'ACTIVE') return fail('account disabled', 403);
      if (!safeEq(await pbkdf2(password, u.pass_salt), u.pass_hash)) return fail('wrong username or password');
      await env.DB.prepare('DELETE FROM login_attempts WHERE username=?').bind(username).run();
      const tok = b64u(rand(32));
      await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at,ip) VALUES (?,?,?,?,?)')
        .bind(await sha256hex(tok), u.id, t + SESSION_TTL, t, ipOf(req)).run();
      await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(t, u.id).run();
      ctx.waitUntil(audit(env, ctx, { action: 'LOGIN', actor_id: u.id, actor_username: u.username, ip: ipOf(req) }));
      return json(req, {
        ok: true,
        user: { id: u.id, username: u.username, email: u.email, displayName: u.display_name, role: u.role },
      }, 200, { 'Set-Cookie': sessionCookie(tok) });
    }

    /* ----- logout + me ----- */
    if (path === '/api/auth/logout' && req.method === 'POST') {
      const tok = cookieSid(req);
      if (tok) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256hex(tok)).run();
      const { u } = await need(null).catch(() => ({}));
      ctx.waitUntil(audit(env, ctx, { action: 'LOGOUT', actor_id: u && u.id, actor_username: u && u.username }));
      return json(req, { ok: true }, 200, { 'Set-Cookie': clearCookie() });
    }
    if (path === '/api/auth/me' && req.method === 'GET') {
      const { err, u } = await need(null);
      if (err) return err;
      return json(req, {
        ok: true,
        user: { id: u.id, username: u.username, email: u.email, displayName: u.display_name, role: u.role, perms: PERMS[u.role] || [] },
      });
    }
    if (path === '/api/auth/password' && req.method === 'POST') {
      const { err, u } = await need(null);
      if (err) return err;
      const full = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(u.id).first();
      if (!safeEq(await pbkdf2(String(body.current || ''), full.pass_salt), full.pass_hash))
        return json(req, { ok: false, error: 'current password wrong' }, 400);
      if (String(body.next || '').length < 12)
        return json(req, { ok: false, error: 'password needs 12+ characters' }, 400);
      const salt = hex(rand(16));
      await env.DB.prepare('UPDATE users SET pass_salt=?,pass_hash=? WHERE id=?')
        .bind(salt, await pbkdf2(String(body.next), salt), u.id).run();
      await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id).run();
      ctx.waitUntil(audit(env, ctx, { action: 'PASSWORD_CHANGED', actor_id: u.id, actor_username: u.username }));
      return json(req, { ok: true });
    }

    /* ----- own data (session user owns every row) ----- */
    const dm = path.match(/^\/api\/data\/([a-z_]+)$/);
    if (dm) {
      const store = dm[1];
      if (!STORES.includes(store)) return json(req, { ok: false, error: 'unknown store' }, 400);
      if (req.method === 'GET') {
        const { err, u } = await need('VIEW_OWN_DATA');
        if (err) return err;
        const r = await env.DB.prepare('SELECT snapshot_json,updated_at FROM user_data WHERE user_id=? AND store_key=?')
          .bind(u.id, store).first();
        return json(req, { ok: true, snapshot: r ? JSON.parse(r.snapshot_json) : null, updated_at: r ? r.updated_at : 0 });
      }
      if (req.method === 'PUT') {
        const { err, u } = await need('EDIT_OWN_DATA');
        if (err) return err;
        const snap = JSON.stringify(body.snapshot ?? null);
        if (snap.length > MAX_SNAPSHOT) return json(req, { ok: false, error: 'snapshot too large' }, 413);
        await env.DB.prepare('INSERT INTO user_data(user_id,store_key,snapshot_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,store_key) DO UPDATE SET snapshot_json=excluded.snapshot_json,updated_at=excluded.updated_at')
          .bind(u.id, store, snap, now()).run();
        return json(req, { ok: true });
      }
      if (req.method === 'DELETE') {
        const { err, u } = await need('DELETE_OWN_DATA');
        if (err) return err;
        await env.DB.prepare('DELETE FROM user_data WHERE user_id=? AND store_key=?').bind(u.id, store).run();
        ctx.waitUntil(audit(env, ctx, { action: 'DATA_DELETED', actor_id: u.id, actor_username: u.username, target_id: store }));
        return json(req, { ok: true });
      }
      return json(req, { ok: false, error: 'method not allowed' }, 405);
    }

    /* ----- admin: users ----- */
    if (path === '/api/admin/users' && req.method === 'GET') {
      const { err, u } = await need('VIEW_ALL_USERS');
      if (err) return err;
      const q = String(url.searchParams.get('q') || '').toLowerCase();
      const st = String(url.searchParams.get('status') || '');
      const role = String(url.searchParams.get('role') || '');
      let rows = (await env.DB.prepare(
        'SELECT id,username,email,display_name,role,status,created_at,last_login_at FROM users ORDER BY created_at DESC LIMIT 500').all()).results || [];
      if (q) rows = rows.filter((r) => (r.username + ' ' + (r.email || '') + ' ' + (r.display_name || '')).toLowerCase().includes(q));
      if (st && STATUSES.includes(st)) rows = rows.filter((r) => r.status === st);
      if (role && ROLES.includes(role)) rows = rows.filter((r) => r.role === role);
      return json(req, { ok: true, users: rows });
    }
    if (path === '/api/admin/users' && req.method === 'POST') {
      const { err, u } = await need('MANAGE_USERS');
      if (err) return err;
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const role = String(body.role || 'USER');
      if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return json(req, { ok: false, error: 'bad username' }, 400);
      if (password.length < 12) return json(req, { ok: false, error: 'password needs 12+ characters' }, 400);
      if (!ROLES.includes(role)) return json(req, { ok: false, error: 'bad role' }, 400);
      if (role === 'ADMIN' && u.role !== 'ADMIN') return json(req, { ok: false, error: 'forbidden' }, 403);
      const salt = hex(rand(16));
      const id = uid('usr');
      try {
        await env.DB.prepare(
          'INSERT INTO users(id,username,email,display_name,pass_salt,pass_hash,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
          .bind(id, username, String(body.email || '').trim().slice(0, 120) || null,
            String(body.displayName || username).trim().slice(0, 80),
            salt, await pbkdf2(password, salt), role, 'ACTIVE', now()).run();
      } catch (_) { return json(req, { ok: false, error: 'username taken' }, 409); }
      ctx.waitUntil(audit(env, ctx, { action: 'ACCOUNT_CREATED', actor_id: u.id, actor_username: u.username, target_id: username, detail: role }));
      return json(req, { ok: true, id });
    }
    const um = path.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (um) {
      const { err, u } = await need('MANAGE_USERS');
      if (err) return err;
      const target = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(um[1]).first();
      if (!target) return json(req, { ok: false, error: 'not found' }, 404);
      if (req.method === 'PATCH') {
        if (target.id === u.id && (body.status && body.status !== 'ACTIVE'))
          return json(req, { ok: false, error: 'cannot disable yourself' }, 400);
        const sets = [], args = [];
        if (body.status && STATUSES.includes(body.status)) {
          if (!can(u, 'APPROVE_USERS') && ['ACTIVE', 'REJECTED'].includes(body.status))
            return json(req, { ok: false, error: 'forbidden' }, 403);
          if (target.id === u.id) return json(req, { ok: false, error: 'cannot change own status' }, 400);
          sets.push('status=?'); args.push(body.status);
          const act = body.status === 'ACTIVE' ? 'ACCOUNT_APPROVED' : body.status === 'REJECTED' ? 'ACCOUNT_REJECTED' : body.status === 'DISABLED' ? 'ACCOUNT_DISABLED' : 'ACCOUNT_ENABLED';
          ctx.waitUntil(audit(env, ctx, { action: act, actor_id: u.id, actor_username: u.username, target_id: target.username }));
          if (body.status !== 'ACTIVE') await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id).run();
        }
        if (body.role && ROLES.includes(body.role)) {
          if (target.id === u.id) return json(req, { ok: false, error: 'cannot change own role' }, 400);
          if (body.role === 'ADMIN' && u.role !== 'ADMIN') return json(req, { ok: false, error: 'forbidden' }, 403);
          sets.push('role=?'); args.push(body.role);
          ctx.waitUntil(audit(env, ctx, { action: 'ROLE_CHANGED', actor_id: u.id, actor_username: u.username, target_id: target.username, detail: body.role }));
        }
        if (!sets.length) return json(req, { ok: false, error: 'nothing to change' }, 400);
        args.push(target.id);
        await env.DB.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).bind(...args).run();
        return json(req, { ok: true });
      }
      if (req.method === 'DELETE') {
        if (target.id === u.id) return json(req, { ok: false, error: 'cannot delete yourself' }, 400);
        await env.DB.prepare('DELETE FROM users WHERE id=?').bind(target.id).run();
        ctx.waitUntil(audit(env, ctx, { action: 'DATA_DELETED', actor_id: u.id, actor_username: u.username, target_id: target.username, detail: 'account deleted' }));
        return json(req, { ok: true });
      }
      return json(req, { ok: false, error: 'method not allowed' }, 405);
    }

    /* ----- admin: read a user's data (audited), audit log, settings ----- */
    const adm = path.match(/^\/api\/admin\/data\/([^/]+)(?:\/([a-z_]+))?$/);
    if (adm) {
      const { err, u } = await need('VIEW_ALL_DATA');
      if (err) return err;
      const t = await env.DB.prepare('SELECT id,username,display_name,role,status FROM users WHERE id=?').bind(adm[1]).first();
      if (!t) return json(req, { ok: false, error: 'not found' }, 404);
      ctx.waitUntil(audit(env, ctx, { action: 'ADMIN_VIEWED_USER_DATA', actor_id: u.id, actor_username: u.username, target_id: t.username, detail: adm[2] || 'all' }));
      if (adm[2]) {
        if (!STORES.includes(adm[2])) return json(req, { ok: false, error: 'unknown store' }, 400);
        const r = await env.DB.prepare('SELECT snapshot_json,updated_at FROM user_data WHERE user_id=? AND store_key=?').bind(t.id, adm[2]).first();
        return json(req, { ok: true, user: t, snapshot: r ? JSON.parse(r.snapshot_json) : null, updated_at: r ? r.updated_at : 0 });
      }
      const rows = (await env.DB.prepare('SELECT store_key,updated_at FROM user_data WHERE user_id=?').bind(t.id).all()).results || [];
      return json(req, { ok: true, user: t, stores: rows });
    }
    if (path === '/api/admin/audit' && req.method === 'GET') {
      const { err } = await need('VIEW_AUDIT_LOG');
      if (err) return err;
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));
      const rows = (await env.DB.prepare('SELECT * FROM audit ORDER BY ts DESC LIMIT ?').bind(limit).all()).results || [];
      return json(req, { ok: true, audit: rows });
    }
    if (path === '/api/admin/settings' && req.method === 'GET') {
      const { err } = await need('MANAGE_SETTINGS');
      if (err) return err;
      const rows = (await env.DB.prepare('SELECT key,value FROM settings').all()).results || [];
      return json(req, { ok: true, settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
    }
    if (path === '/api/admin/settings' && req.method === 'PUT') {
      const { err, u } = await need('MANAGE_SETTINGS');
      if (err) return err;
      if (!['0', '1'].includes(String(body.registration_open)))
        return json(req, { ok: false, error: 'registration_open must be 0/1' }, 400);
      await env.DB.prepare("UPDATE settings SET value=? WHERE key='registration_open'")
        .bind(String(body.registration_open)).run();
      ctx.waitUntil(audit(env, ctx, { action: 'SETTINGS_CHANGED', actor_id: u.id, actor_username: u.username, detail: 'registration_open=' + body.registration_open }));
      return json(req, { ok: true });
    }

    /* ----- one-time admin bootstrap (SETUP_KEY env secret) ----- */
    if (path === '/api/admin/bootstrap' && req.method === 'POST') {
      const n = await env.DB.prepare('SELECT COUNT(*) c FROM users').first();
      if (n && n.c > 0) return json(req, { ok: false, error: 'already initialized' }, 403);
      if (!env.BOOTSTRAP_KEY || !safeEq(String(body.setupKey || ''), env.BOOTSTRAP_KEY))
        return json(req, { ok: false, error: 'forbidden' }, 403);
      const salt = hex(rand(16));
      const id = uid('usr');
      await env.DB.prepare(
        'INSERT INTO users(id,username,email,display_name,pass_salt,pass_hash,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, String(body.username || 'admin').trim(), null, 'Administrator',
          salt, await pbkdf2(String(body.password || ''), salt), 'ADMIN', 'ACTIVE', now()).run();
      ctx.waitUntil(audit(env, ctx, { action: 'ACCOUNT_CREATED', target_id: 'bootstrap-admin', detail: 'first ADMIN' }));
      return json(req, { ok: true, id });
    }

    return json(req, { ok: false, error: 'not found' }, 404);
  },
};
