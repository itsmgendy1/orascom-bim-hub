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

// 6. QAQC reports file their discipline model under the building they name:
//    HT01/AR -> "HT01 AR" in the HT01 package; suites and other projects stay flat.
const before = JSON.parse(store.ohub_models || '[]').length;
OHub.upsertDisciplineModels('PP', [
  { code: 'AR', name: 'HT01 AR', building: 'HT01', score: 80, issues: 3 },
  { code: 'EL', name: 'UB02 EL', building: 'UB02', score: 90, issues: 1 },
  { code: 'FF', name: 'FF', building: '', score: 77, issues: 2 },
]);
const m2 = JSON.parse(store.ohub_models || '[]');
const pp2 = m2.filter((m) => m.project === 'PP');
ok(m2.length === before + 3, 'three models added', m2.length);
ok(!!pp2.find((m) => m.name === 'HT01 AR' && m.package === '01. HT01 MAIN BUILDING' && m.discipline === 'AR'), 'HT01 AR filed under HT01');
ok(!!pp2.find((m) => m.name === 'UB02 EL' && m.package === '07. UB02 UTILITY BUILDING'), 'UB02 EL filed under UB02');
ok(!!pp2.find((m) => m.name === 'FF' && !m.package), 'suite code model stays unassigned');
OHub.upsertDisciplineModels('PP', [{ code: 'AR', name: 'HT01 AR', building: 'HT01', score: 95, issues: 0 }]);
ok(JSON.parse(store.ohub_models || '[]').length === before + 3, 're-report does not duplicate');
OHub.upsertDisciplineModels('P1', [{ code: 'AR', name: 'AR', building: '', score: 50, issues: 9 }]);
ok(JSON.parse(store.ohub_models || '[]').filter((m) => m.project === 'P1' && m.name === 'AR').length === 1, 'non-Portaluna bare model');

// 6b. Findings carry the building so the issue log is classified per building,
//     and the same failure in two buildings is not de-duplicated into one.
OHub.fileAutoIssues('PP', 'qaqc', [
  { desc: '[HT01 AR] Warnings', model: 'HT01 AR', severity: 'High' },
  { desc: '[SF01 AR] Warnings', model: 'SF01 AR', severity: 'High' },
  { desc: '[BMS] Worksets', model: 'BMS', severity: 'High' },
]);
const iss = JSON.parse(store.ohub_issues || '[]').filter((i) => i.project === 'PP');
ok(iss.find((i) => i.description === '[HT01 AR] Warnings').building === 'HT01', 'HT01 issue tagged to building');
ok(iss.find((i) => i.description === '[SF01 AR] Warnings').building === 'SF01', 'same check in another building kept');
ok(iss.find((i) => i.description === '[BMS] Worksets').building === '', 'unclassified issue stays blank');
OHub.fileAutoIssues('PP', 'qaqc', [{ desc: '[HT01 AR] Warnings', model: 'HT01 AR', severity: 'High' }]);
ok(JSON.parse(store.ohub_issues || '[]').filter((i) => i.description === '[HT01 AR] Warnings').length === 1, 're-report does not duplicate issue');

// 6c. A new report re-opens a resolved issue (auto update) and classification
//     is stamped on the issue itself, even when no model is registered.
const hid = iss.find((i) => i.description === '[HT01 AR] Warnings').id;
OHub.qcBulkStatus('Resolved', [hid]);
OHub.fileAutoIssues('PP', 'qaqc', [{ desc: '[HT01 AR] Warnings', model: 'HT01 AR', severity: 'High' }]);
const re = JSON.parse(store.ohub_issues || '[]').find((i) => i.description === '[HT01 AR] Warnings');
ok(re.status === 'Open', 'new report reopens a resolved issue');
ok(re.discipline === 'AR' && typeof re.lastSeen === 'number', 'issue classification + lastSeen stamped', re.discipline);
OHub.fileAutoIssues('PP', 'naming', [{ desc: '[CR01 EL] Views Not On Sheets', severity: 'High' }]);
const cr = JSON.parse(store.ohub_issues || '[]').find((i) => i.description === '[CR01 EL] Views Not On Sheets');
ok(cr && cr.building === 'CR01' && cr.discipline === 'EL', 'classification inferred from finding text');

// 7. Models tab lists a Building column, filters by building, and sorts grouped.
OHub.setActiveProject('PP');
els['models-bld-filter'] = makeEl();
els['models-pkg-filter'] = makeEl();
els['models-bld-filter'].value = 'HT01';
OHub.switchView('models');
const mg = (els['models-grid'] || {}).innerHTML || '';
ok(mg.indexOf('>Building<') >= 0, 'models table has Building column');
ok(mg.indexOf('HT01 AR') >= 0 && mg.indexOf('HT01 MAIN BUILDING') >= 0, 'HT01 filter shows HT01 models', mg.slice(0, 300));
ok(mg.indexOf('UB02 EL') === -1 && mg.indexOf('BH01 BOH') === -1, 'HT01 filter hides other buildings');
ok(els['models-bld-filter'].innerHTML.indexOf('HT01') >= 0 && els['models-bld-filter'].innerHTML.indexOf('UB02') >= 0, 'building filter lists every building');
els['models-bld-filter'].value = '';
els['models-pkg-filter'].value = '';
OHub.switchView('models');
const mo = (els['models-grid'] || {}).innerHTML || '';
ok(mo.indexOf('HT01 AR') >= 0 && mo.indexOf('FF') >= 0, 'no filter shows all models');
ok(mo.indexOf('BH01 BOH') < mo.indexOf('HT01 MAIN BUILDING'), 'rows sorted by building code', 'order');
ok(mo.indexOf('Building HT01 \u2014 HT01 MAIN BUILDING') >= 0, 'models: building group header');
ok(mo.indexOf('Building BH01 \u2014 BH01 BOH - GUARD HOUSE') >= 0, 'models: every building grouped');
ok(mo.indexOf('Architectural <span') >= 0, 'models: discipline sub-group');
const iHt = mo.indexOf('Building HT01 \u2014 HT01 MAIN BUILDING');
ok(iHt >= 0 && mo.indexOf('Architectural <span', iHt) > iHt, 'building header precedes disciplines');
els['models-bld-filter'].value = '';

// 8. Quality Center rolls issues up per building.
OHub.setActiveProject('PP');
OHub.switchView('quality-center');
const qc = (els['qc-content'] || {}).innerHTML || '';
ok(qc.indexOf('Issues by building') >= 0, 'quality center building rollup');
ok(qc.indexOf('<td><strong>HT01</strong></td><td>HT01 MAIN BUILDING</td><td>14</td><td>1</td>') >= 0, 'HT01 row: 14 models, 1 open issue');
ok(qc.indexOf('<td><strong>SF01</strong></td>') >= 0, 'SF01 row present');
ok(qc.indexOf('<th>Building</th>') >= 0, 'issue log has Building column');

// 9. Issue log filters + batch actions (all / selected).
const ppIss = () => JSON.parse(store.ohub_issues || '[]').filter((i) => i.project === 'PP');
ok(OHub.qcBulkStatus('Resolved', null) === ppIss().length, 'batch resolve all');
ok(ppIss().every((i) => i.status === 'Resolved'), 'all resolved');
ok(OHub.qcBulkStatus('Open', null) === ppIss().length, 'batch reopen all');
els['qc-bulk-status'] = makeEl();
els['qc-bulk-status'].value = 'Waived';
ok(OHub.qcBulkApply('all') === ppIss().length, 'bulk apply all');
ok(ppIss().every((i) => i.status === 'Waived'), 'all waived');
ok(OHub.qcBulkApply('selected') === 0, 'apply to selected needs ticks');
const sfId = ppIss().find((i) => i.description === '[SF01 AR] Warnings').id;
ok(OHub.qcBulkDelete([sfId]) === 1, 'bulk delete selected');
ok(!JSON.parse(store.ohub_issues || '[]').some((i) => i.id === sfId), 'deleted issue removed');
ok(OHub.qcBulkStatus('Open', null) === ppIss().length, 'reset statuses');
OHub.qcSetFilter('bld', 'HT01');
const qc1 = (els['qc-content'] || {}).innerHTML || '';
ok(qc1.indexOf('[HT01 AR] Warnings') >= 0, 'building filter keeps its issues');
ok(qc1.indexOf('[CR01 EL] Views Not On Sheets') === -1, 'building filter hides other buildings');
ok(qc1.indexOf('<th>Discipline</th>') >= 0, 'issue log has Discipline column');
ok(qc1.indexOf('Building HT01 \u2014 HT01 MAIN BUILDING') >= 0, 'issue log: building group header');
ok(qc1.indexOf('AR <span') >= 0, 'issue log: discipline sub-group');
ok(qc1.indexOf('\u21b3') >= 0, 'building rollup: discipline sub-rows');
OHub.qcSetFilter('bld', '');
OHub.qcSetFilter('disc', 'EL');
const qc2 = (els['qc-content'] || {}).innerHTML || '';
ok(qc2.indexOf('[CR01 EL] Views Not On Sheets') >= 0 && qc2.indexOf('[BMS] Worksets') === -1, 'discipline filter works');
OHub.qcSetFilter('disc', '');

// 10. Building-first classification reaches the other tabs too.
OHub.switchView('program');
const pg2 = (els['program-content'] || {}).innerHTML || '';
ok(pg2.indexOf('badge-muted">AR 1</span>') >= 0, 'program: discipline chips per building card');

OHub.switchView('dashboard');
const dash = (els['dash-content'] || {}).innerHTML || '';
ok(dash.indexOf('>HT01 \u00b7 AR</span>') >= 0, 'dashboard: open issue tagged building + discipline');

OHub.switchView('reports');
const rep = (els['reports-content'] || {}).innerHTML || '';
ok(rep.indexOf('By building &amp; discipline') >= 0, 'reports: building classification card');
ok(rep.indexOf('<strong>HT01</strong>') >= 0, 'reports: building rows with discipline sub-rows');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
