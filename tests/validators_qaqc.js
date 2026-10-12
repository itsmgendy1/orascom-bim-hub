// QAQC fill-core suite, headless (no deps, runs in CI).
// Locks the locked rules: C-fill -> action, binary scoring, discipline
// detection, and the GENERAL cyan mapping coverage.
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const MOD = path.join(ROOT, 'modules', 'model-quality.html');

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
    click() {}, focus() {}, closest() { return null; },
    getAttribute() { return null; }, setAttribute() {},
    querySelector() { return null; }, querySelectorAll: () => [],
    getContext() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
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
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = global;
global.navigator = { userAgent: 'node' };
global.location = { href: 'http://localhost/', protocol: 'http:', origin: 'http://localhost' };
global.history = { replaceState() {}, pushState() {} };
global.addEventListener = () => {};
global.requestAnimationFrame = () => 0;
global.fetch = () => Promise.reject(new Error('offline'));
global.Blob = function () {};
global.URL = { createObjectURL: () => '', revokeObjectURL() {} };
global.FileReader = function () {};
global.Chart = function () { return { destroy() {}, resize() {}, update() {} }; };
global.XLSX = { utils: { sheet_to_json: (ws) => ws } };
global.indexedDB = undefined;

const html = fs.readFileSync(MOD, 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
eval(scripts + '\n;module.exports={qaqcRuleFromArgb,qaqcScoreFor,qaqcDiscFromName,QAQC_FILL_MAP};');
const M = module.exports;

// 1. Color -> rule (exact ARGB from the template).
ok(M.qaqcRuleFromArgb('FF92D050') === 'green', 'green rule');
ok(M.qaqcRuleFromArgb('FFFF0000') === 'red', 'red rule');
ok(M.qaqcRuleFromArgb('FF00B0F0') === 'cyan', 'cyan rule');
ok(M.qaqcRuleFromArgb('FFFFFF00') === 'yellow', 'yellow rule');
ok(M.qaqcRuleFromArgb('ff92d050') === 'green', 'case-insensitive');
ok(M.qaqcRuleFromArgb('') === 'plain' && M.qaqcRuleFromArgb(null) === 'plain', 'plain fallback');

// 2. Binary scoring: ANY mapped fail -> 0, else 100; unmapped -> null.
ok(M.qaqcScoreFor(['File Size'], ['Warnings']) === 100, 'pass -> 100');
ok(M.qaqcScoreFor(['File Size'], ['file size']) === 0, 'fail case-insensitive -> 0');
ok(M.qaqcScoreFor(['A', 'B'], ['b']) === 0, 'any-fail strict');
ok(M.qaqcScoreFor([], ['x']) === null && M.qaqcScoreFor(null, []) === null, 'unmapped -> null');
ok(M.qaqcScoreFor(['__COUNTS_GENERIC_INPLACE__'], [], { generic: 0, inplace: 0 }) === 100, 'counts clean -> 100');
ok(M.qaqcScoreFor(['__COUNTS_GENERIC_INPLACE__'], [], { generic: 3, inplace: 0 }) === 0, 'counts generic -> 0');
ok(M.qaqcScoreFor(['__COUNTS_GENERIC_INPLACE__'], [], { generic: 0, inplace: 2 }) === 0, 'counts inplace -> 0');
ok(M.qaqcScoreFor(['__COUNTS_GENERIC_INPLACE__'], [], null) === null, 'counts absent -> null');
ok(M.qaqcScoreFor(['__COUNTS_VIEWS_OFF_SHEET__'], [], { viewsOff: 0 }) === 100, 'views 0 off -> 100');
ok(M.qaqcScoreFor(['__COUNTS_VIEWS_OFF_SHEET__'], [], { viewsOff: 1 }) === 100, 'views 1 off -> 100');
ok(M.qaqcScoreFor(['__COUNTS_VIEWS_OFF_SHEET__'], [], { viewsOff: 2 }) === 0, 'views 2 off -> 0');
ok(M.qaqcScoreFor(['__COUNTS_VIEWS_OFF_SHEET__'], [], null) === null, 'views absent -> null');

// 3. Discipline from health filename.
ok(M.qaqcDiscFromName('P0152-K00146-OCC-SF01-ZZ-M3-AR-000001.html') === 'AR', 'disc AR');
ok(M.qaqcDiscFromName('X-M3-ST-2.html') === 'ST', 'disc ST');
ok(M.qaqcDiscFromName('nope.html') === '', 'disc absent');

// 4. GENERAL cyan coverage: mapped rows resolve; rows with no health
//    equivalent stay explicitly unmapped (left blank, owner reviews).
const EXPECT_MAPPED = ['QA-GE-004', 'QA-GE-008', 'QA-GE-009', 'QA-GE-011', 'QA-GE-013',
  'QA-GE-014', 'QA-GE-024', 'QA-GE-036', 'QA-GE-037', 'QA-GE-038', 'QA-GE-051',
  'QA-GE-060', 'QA-GE-061', 'QA-GE-062', 'QA-GE-064'];
const missing = EXPECT_MAPPED.filter((id) => !M.QAQC_FILL_MAP[id]);
ok(missing.length === 0, 'cyan rows mapped', missing.join(','));
ok(M.QAQC_FILL_MAP['QA-GE-004'].join() === 'File Size', 'map exact');
['QA-GE-063'].forEach(function (id) {
  ok(!M.QAQC_FILL_MAP[id], id + ' honestly unmapped (manual)');
});

// 5. Discipline-sheet mappings ship locked too (added with the filler).
ok(M.QAQC_FILL_MAP['QA-GE-025'].join() === '__COUNTS_VIEWS_OFF_SHEET__', 'GE-025 views rule');
ok(M.QAQC_FILL_MAP['QA-GE-026'].join() === '__COUNTS_VIEWS_OFF_SHEET__', 'GE-026 views rule');
ok(M.QAQC_FILL_MAP['QA-AR-029'].join() === 'Purgeable Elements', 'AR-029 purge');
ok(M.QAQC_FILL_MAP['QA-AR-030'].join() === 'Warnings', 'AR-030 warnings');
ok(M.QAQC_FILL_MAP['QA-AR-031'].join() === 'Duplicate Modeled Elements', 'AR-031 dup');
ok(M.QAQC_FILL_MAP['QA-AR-001'].join() === 'Rooms', 'AR-001 rooms');
ok(M.QAQC_FILL_MAP['QA-AR-002'].join() === 'Redundant and Unenclosed Rooms', 'AR-002 redundant');
ok(M.QAQC_FILL_MAP['QA-AR-003'].join() === 'Unplaced Rooms', 'AR-003 unplaced');
ok(M.QAQC_FILL_MAP['QA-ST-006'].join() === 'Duplicate Modeled Elements', 'ST-006 dup');

// 6. Exact key set: additions/removals must update this suite (owner-locked).
const EXPECT_KEYS = ['QA-GE-004', 'QA-GE-008', 'QA-GE-009', 'QA-GE-011', 'QA-GE-013',
  'QA-GE-014', 'QA-GE-024', 'QA-GE-025', 'QA-GE-026', 'QA-GE-036', 'QA-GE-037',
  'QA-GE-038', 'QA-GE-051', 'QA-GE-060', 'QA-GE-061', 'QA-GE-062', 'QA-GE-064',
  'QA-AR-029', 'QA-AR-030', 'QA-AR-031', 'QA-AR-001', 'QA-AR-002', 'QA-AR-003',
  'QA-ST-006'].sort();
const gotKeys = Object.keys(M.QAQC_FILL_MAP).sort();
ok(gotKeys.join('|') === EXPECT_KEYS.join('|'), 'map key set exact',
  'extra: ' + gotKeys.filter((k) => EXPECT_KEYS.indexOf(k) < 0).join(',') +
  ' missing: ' + EXPECT_KEYS.filter((k) => gotKeys.indexOf(k) < 0).join(','));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
