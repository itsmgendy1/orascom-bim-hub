// Role-gating suite, headless (no deps, runs in CI).
// Localhost / ACC / APS surfaces (Settings server cards, Data Center ACC,
// topbar ACC, project modal link, models runbar) must be visible for ADMIN
// and hidden for every other role / no role at all.
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

let pass = 0, fail = 0;
function ok(cond, id, detail) {
  if (cond) { pass++; console.log('PASS ' + id); }
  else { fail++; console.log('FAIL ' + id + (detail ? ' | ' + detail : '')); }
}

function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', files: [], checked: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    click() {}, focus() {}, setSelectionRange() {}, closest() { return null; },
    getAttribute() { return null; }, setAttribute() {},
    querySelector() { return null; }, querySelectorAll: () => [],
    getContext() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 10, height: 10 }; },
  };
}

const GATED_IDS = ['btn-open-acc', 'pm-accrow', 'dc-sync-server', 'card-acc-local', 'card-acc-cloud', 'card-sync-server', 'card-cloud', 'card-team', 'card-forma'];

function boot(role) {
  const els = {}, store = {}, session = {};
  global.document = {
    addEventListener() {}, removeEventListener() {},
    getElementById: (id) => (els[id] || (els[id] = makeEl())),
    createElement: () => makeEl(), createElementNS: () => makeEl(),
    querySelector: () => null, querySelectorAll: () => [],
    body: makeEl(), documentElement: makeEl(), head: makeEl(),
  };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  global.sessionStorage = {
    getItem: (k) => (k in session ? session[k] : null),
    setItem: (k, v) => { session[k] = String(v); },
    removeItem: (k) => { delete session[k]; },
  };
  global.window = global;
  global.addEventListener = () => {};
  global.removeEventListener = () => {};
  global.location = { hash: '', href: 'http://localhost/hub.html', protocol: 'http:', origin: 'http://localhost' };
  global.history = { replaceState() {}, pushState() {} };
  global.navigator = { userAgent: 'node' };
  global.fetch = () => Promise.reject(new Error('offline'));
  store.ohub_projects = JSON.stringify([{ id: 'RG', code: 'RG01', name: 'Role Gate Project' }]);
  store.ohub_active_project = JSON.stringify('RG');
  store.ohub_models = JSON.stringify([{ id: 'rg1', project: 'RG', name: 'RG01 AR', code: 'AR', discipline: 'AR', filePath: 'AR/RG01-AR.rvt' }]);
  if (role) store.ohub_authuid = JSON.stringify({ uid: 'u1', username: 'test.' + role.toLowerCase(), role: role });
  eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'site-plots.js'), 'utf8'));
  eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'ohub-auth.js'), 'utf8'));
  eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'hub.js'), 'utf8'));
  return els;
}

['', 'USER'].forEach(function (role) {
  const els = boot(role);
  const tag = role || 'NO-ROLE';
  window.OHub.switchView('settings');
  GATED_IDS.forEach(function (id) {
    ok(!!els[id] && els[id].style.display === 'none', tag + ': hidden ' + id);
  });
  window.OHub.switchView('models');
  ok(els['models-runbar'].style.display === 'none', tag + ': models runbar hidden');
  window.OHub.switchView('dashboard');
  const dash = (els['dash-content'] || {}).innerHTML || '';
  ok(dash.indexOf('Autodesk Forma') === -1, tag + ': dashboard Forma/APS card hidden');
});

const adminEls = boot('ADMIN');
window.OHub.switchView('settings');
GATED_IDS.forEach(function (id) {
  ok(!!adminEls[id] && adminEls[id].style.display === '', 'ADMIN: visible ' + id);
});
window.OHub.switchView('models');
ok(adminEls['models-runbar'].style.display === '', 'ADMIN: models runbar visible');
global.OForma = { links: () => ({}), isConfigured: () => false };
window.OHub.switchView('dashboard');
const adminDash = (adminEls['dash-content'] || {}).innerHTML || '';
ok(adminDash.indexOf('Open ACC') >= 0, 'ADMIN: dashboard ACC quick action visible');
ok(adminDash.indexOf('Autodesk Forma') >= 0, 'ADMIN: dashboard Forma card visible');

/* ----- project registry: add/edit visible to ADMIN + MANAGER only ----- */
const PROJECT_MANAGER_IDS = ['btn-add-project', 'btn-edit-project', 'btn-add-project-view'];

['', 'USER', 'VIEWER', 'QA', 'COORDINATOR'].forEach(function (role) {
  const els = boot(role);
  const tag = role || 'NO-ROLE';
  window.OHub.switchView('dashboard');
  ok(window.OHub.canManageProjects() === false, tag + ': project management denied');
  PROJECT_MANAGER_IDS.forEach(function (id) {
    ok(!!els[id] && els[id].style.display === 'none', tag + ': hidden ' + id);
  });
});

['ADMIN', 'MANAGER'].forEach(function (role) {
  const els = boot(role);
  window.OHub.switchView('dashboard');
  ok(window.OHub.canManageProjects() === true, role + ': project management allowed');
  PROJECT_MANAGER_IDS.forEach(function (id) {
    ok(!!els[id] && els[id].style.display === '', role + ': visible ' + id);
  });
});

/* ----- GIS zone drawing: ADMIN + MANAGER + COORDINATOR only ----- */
['', 'USER', 'VIEWER', 'QA'].forEach(function (role) {
  boot(role);
  ok(window.OHub.canDrawGis() === false, (role || 'NO-ROLE') + ': GIS drawing denied');
});

['ADMIN', 'MANAGER', 'COORDINATOR'].forEach(function (role) {
  boot(role);
  ok(window.OHub.canDrawGis() === true, role + ': GIS drawing allowed');
});

/* ----- shared registry plumbing is present (worker + hub wiring) ----- */
const workerSrc = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.js'), 'utf8');
ok(workerSrc.indexOf('SHARED_STORES') >= 0, 'worker: shared store allowlist present');
ok(workerSrc.indexOf('SHARED_WRITER_ROLES') >= 0, 'worker: shared writer roles present');
ok(workerSrc.indexOf('shared_data') >= 0, 'worker: shared_data table used');
const schemaSrc = fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8');
ok(schemaSrc.indexOf('shared_data') >= 0, 'schema: shared_data table defined');
const hubHtml = fs.readFileSync(path.join(ROOT, 'hub.html'), 'utf8');
ok(hubHtml.indexOf('id="btn-add-project"') >= 0, 'hub.html: + Project button id');
ok(hubHtml.indexOf('id="btn-edit-project"') >= 0, 'hub.html: Edit button id');
const hubSrc = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'hub.js'), 'utf8');
ok(hubSrc.indexOf('authwSharedProjectsPull()') >= 0, 'hub.js: shared projects pulled on boot');
ok(hubSrc.indexOf('/api/shared/projects') >= 0, 'hub.js: shared projects endpoint wired');
ok(hubSrc.indexOf('authwCanDrawGis') >= 0 && hubSrc.indexOf('Only admins, managers and coordinators can draw zones') >= 0, 'hub.js: GIS drawing gated');
ok(/SHARED_WRITER_ROLES = \[[^\]]*COORDINATOR/.test(workerSrc), 'worker: coordinator may write shared projects');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
