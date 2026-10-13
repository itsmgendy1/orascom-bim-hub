// Hub-shell behavior suite, headless (no deps, runs in CI).
// Drives the REAL app through its public OHub API with seeded localStorage:
// stage-gate lifecycle, gate tallies, and XSS-escaping of user content.
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
const els = {};
global.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: (id) => (els[id] || (els[id] = makeEl())),
  createElement: () => makeEl(), createElementNS: () => makeEl(),
  querySelector: () => null, querySelectorAll: () => [],
  body: makeEl(), documentElement: makeEl(), head: makeEl(),
};
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const _session = {};
global.sessionStorage = {
  getItem: (k) => (k in _session ? _session[k] : null),
  setItem: (k, v) => { _session[k] = String(v); },
  removeItem: (k) => { delete _session[k]; },
};
global.window = global;
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.location = { hash: '', href: 'http://localhost/hub.html', protocol: 'http:', origin: 'http://localhost' };
global.history = { replaceState() {}, pushState() {} };
global.navigator = { userAgent: 'node' };
global.fetch = () => Promise.reject(new Error('offline'));

// Seed BEFORE the app boots (state is read at load).
store.ohub_projects = JSON.stringify([
  { id: 'P1', code: 'DP01', name: 'Test Project' },
  { id: 'P2', code: 'DP02', name: '<img src=x onerror=alert(1)>' },
  { id: 'PP', code: 'P0152', name: 'P0152 Portaluna Sales Resort' },
]);
store.ohub_active_project = JSON.stringify('P1');
store.ohub_models = JSON.stringify([
  { project: 'P1', package: 'Structures' },
  { project: 'P1', package: 'MEP' },
  { project: 'PP', name: 'HT01 MAIN BUILDING', code: 'HT01', package: '01. HT01 MAIN BUILDING', discipline: '' },
]);
store.ohub_gates = JSON.stringify({});

eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'site-plots.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'ohub-auth.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'hub.js'), 'utf8'));
const OHub = window.OHub;
const gates = () => JSON.parse(store.ohub_gates || '{}');

// 1. Stages view renders seeded packages with zero approvals.
OHub.switchView('stages');
const s0 = (els['stages-content'] || {}).innerHTML || '';
ok(s0.indexOf('Structures') >= 0 && s0.indexOf('MEP') >= 0, 'stages lists packages');
ok(s0.indexOf('0/10 approved (0%)') >= 0, 'stages zero tally', s0.slice(s0.indexOf('approved') - 12, s0.indexOf('approved') + 10));

// 2. Gate lifecycle: '' -> In Progress -> Submitted -> Approved -> ''.
OHub.cycleGate('P1', 'Structures', 'Concept');
ok(gates()['P1|Structures|Concept'] === 'In Progress', 'gate step 1');
OHub.cycleGate('P1', 'Structures', 'Concept');
ok(gates()['P1|Structures|Concept'] === 'Submitted', 'gate step 2');
OHub.cycleGate('P1', 'Structures', 'Concept');
ok(gates()['P1|Structures|Concept'] === 'Approved', 'gate step 3');
const s1 = (els['stages-content'] || {}).innerHTML || '';
ok(s1.indexOf('1/10 approved (10%)') >= 0, 'stages tally after approval');
OHub.cycleGate('P1', 'Structures', 'Concept');
ok(!('P1|Structures|Concept' in gates()), 'gate wraps to empty (no dead keys)');

// 3. Encoded package names survive the round trip.
OHub.cycleGate('P1', 'MEP & Low Current', 'IFC Issue');
ok(gates()['P1|MEP & Low Current|IFC Issue'] === 'In Progress', 'encoded names decode');

// 4. Stages + dashboard escape user-controlled project content.
OHub.setActiveProject('P2');
OHub.switchView('stages');
const d = (els['stages-content'] || {}).innerHTML || '';
ok(d.length > 0 && d.indexOf('Stage gates') >= 0, 'stages renders for P2');
const stripped = d.replace(/&lt;.*?&gt;/g, '');
ok(!/<(img|script|svg)[\s>]/i.test(stripped) && !/ on(error|load)=/i.test(stripped), 'project name renders as text');
ok(/&lt;img/i.test(d), 'payload visibly escaped');

// 5. Portaluna buildings seed: one package card per building, idempotent,
//    Portaluna-gated (other projects untouched). PP was seeded pre-boot.
OHub.setActiveProject('PP');
OHub.switchView('program');
const pg0 = (els['program-content'] || {}).innerHTML || '';
ok(pg0.indexOf('Portaluna building models missing') >= 0, 'program offers building seed');
const added = OHub.seedPortalunaBuildings();
ok(added === 90, 'seed adds 90 federation models', added);
const mods = JSON.parse(store.ohub_models || '[]');
const ppm = mods.filter((m) => m.project === 'PP');
ok(mods.length === 92 && ppm.length === 90, 'models stored for PP');
ok(!ppm.some((m) => m.name === 'HT01 MAIN BUILDING'), 'legacy singleton replaced');
ok(ppm.filter((m) => m.code === 'HT01').length === 13, 'HT01 full set');
const pkgs = Array.from(new Set(mods.filter((m) => m.project === 'PP').map((m) => m.package))).sort();
ok(pkgs.length === 10 && pkgs[0].indexOf('HT01 MAIN BUILDING') >= 0 && pkgs[9].indexOf('BH01 BOH - GUARD HOUSE') >= 0, 'packages ordered per building', pkgs.join(' | '));
OHub.switchView('program');
const pg1 = (els['program-content'] || {}).innerHTML || '';
ok(pg1.indexOf('HT01 MAIN BUILDING') >= 0 && pg1.indexOf('BH01 BOH - GUARD HOUSE') >= 0, 'program cards render');
ok(OHub.seedPortalunaBuildings() === 0, 're-seed adds nothing', JSON.parse(store.ohub_models || '[]').length);
OHub.setActiveProject('P1');
ok(OHub.seedPortalunaBuildings() === 0, 'non-Portaluna untouched', JSON.parse(store.ohub_models || '[]').length);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
