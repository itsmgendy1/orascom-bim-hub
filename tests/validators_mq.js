// Model-quality kernel suite, headless (no deps, runs in CI).
// Locks health-export parsing, QAQC workbook parsing, metric math,
// color thresholds, XML escaping and discipline labels.
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
eval(scripts + '\n;module.exports={parseOne,parseQAQCWorkbook,normalizeMetric,safePct,rc,hex2rgba,escXml,discLabel,getQAQCFailsForDisc,_setQ:v=>{QAQC_DATA=v}};');
const M = module.exports;

// 1. parseOne on a synthetic health export.
const HEALTH = [
  '<div class="passRate big" style="color:green">  87%</div>',
  '<p>120 Checks completed, 104 Pass, 16 Fail, 5 Count/List items, 3 Errors</p>',
  '<div>File Size</div><div>Result: 245.6 MB</div>',
  '<div>Warnings</div><div>Count: 12</div>',
  '<div>Purgeable Elements</div><div>Count: 1,234</div>',
  '<div>Revit Version</div><div>Result: Autodesk Revit 2024</div>',
  '<div>Sheets</div><div>Count: 40</div>',
].join('\n');
let d = null;
try { d = M.parseOne(HEALTH, 'P0152-K00146-OCC-UB02-M3-AR-00001.html'); }
catch (e) { ok(false, 'parseOne', 'threw: ' + e.message); }
ok(d && d.pass_rate === 87, 'pass rate');
ok(d && d.total === 120 && d.passed === 104 && d.failed === 16, 'summary counts');
ok(d && d.count_list === 5 && d.errors === 3, 'count/list + errors');
ok(d && d.code === 'AR' && d.location === 'UB02', 'code/location', JSON.stringify(d && { code: d.code, location: d.location }));
ok(d && d.report_name === 'AR-UB02', 'report name');
ok(d && d.file_size_mb === 245.6 && d.warnings === 12 && d.purgeable === 1234, 'metric counts');
ok(d && d.revit_ver === '2024' && d.sheets === 40, 'version + sheets');
// ID/FF special naming.
d = M.parseOne(HEALTH, 'P0152-K00146-OCC-UB02-M3-ID-00007.html');
ok(d && d.code === 'ID' && d.report_name === 'ID-UB02-7', 'ID special name', d && d.report_name);
// Short summary fallback + null case.
const SHORT = '<div class="passRate" style="x">  50%</div><p>40 Checks, 30 Pass, 10 Fail</p>';
d = M.parseOne(SHORT, 'X-M3-EL-2.html');
ok(d && d.total === 40 && d.passed === 30 && d.failed === 10 && d.count_list === 0, 'short summary');
ok(M.parseOne('<html><body>no metrics here</body></html>', 'X.html') === null, 'null without passRate');

// 2. QAQC workbook parsing (stubbed sheet arrays).
const wb = {
  SheetNames: ['QAQC Checklist - AR', 'Notes'],
  Sheets: {
    'QAQC Checklist - AR': [
      ['Title', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x'],
      ['Item ID', 'Group', 'Desc', 'a', 'b', 'c', 'd', 'VALIDATION SCORE', 'AR MODEL', 'ST MODEL', 'REMARKS'],
      ['', '', '', '', '', '', '', '', 'AR Model', 'ST Model', ''],
      ['QA-01', 'G1', 'Check one', '', '', '', '', '', 100, 80, ''],
      ['QA-02', 'G1', 'Check two', '', '', '', '', '', 90, 100, ''],
      ['ZZ-99', 'Gx', 'Skipped row', '', '', '', '', '', 0, 0, ''],
    ],
    Notes: [['nothing relevant']],
  },
};
const q = M.parseQAQCWorkbook(wb);
ok(!!(q['QAQC Checklist - AR'] && !q.Notes), 'sheets with Item ID only');
const sh = q['QAQC Checklist - AR'];
ok(sh.code === 'AR' && sh.models.join(',') === 'ARMODEL,STMODEL', 'models extracted', sh.models.join(','));
ok(sh.checks.length === 2, 'QA rows only');
ok(sh.checks[0].failedModels.length === 1 && sh.checks[0].failedModels[0].model === 'STMODEL', 'failed models');

// 3. Metric math + thresholds + escaping + labels.
ok(M.normalizeMetric(50, 100, false) === 50, 'metric direct');
ok(M.normalizeMetric(50, 100, true) === 50, 'metric invert');
ok(M.normalizeMetric(200, 100, false) === 100 && M.normalizeMetric(-5, 100, false) === 0, 'metric clamp');
ok(M.normalizeMetric(5, 0, false) === 0, 'metric zero max');
ok(M.safePct(1, 2) === 50 && M.safePct(1, 0) === 0, 'safe pct');
ok(M.rc(80) === '#27AE60' && M.rc(79) === '#E03535', 'threshold colors');
ok(M.hex2rgba('#27AE60', 0.5) === 'rgba(39,174,96,0.5)', 'hex alpha');
ok(M.escXml('<a href="x">y&z</a>') === '&lt;a href=&quot;x&quot;&gt;y&amp;z&lt;/a&gt;', 'xml escape');
ok(M.discLabel({ report_name: 'AR-UB02' }) === 'AR-UB02', 'label report');
ok(M.discLabel({ code: 'ST', location: 'ZZ' }) === 'ST', 'label code fallback');
ok(M.discLabel(null) === '', 'label null');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
