// Parameter-validator kernel suite, headless (no deps, runs in CI).
// Covers cellStatus (Filled/Empty/N-A incl. token set + custom tokens),
// column-level classification on real fixtures, and XSS-safe rendering.
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const MOD = path.join(ROOT, 'modules', 'parameter-validator.html');
const FX = path.join(ROOT, 'tests', 'fixtures');

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
    querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
  };
}
const els = {};
function el(id) { return (els[id] || (els[id] = makeEl())); }
global.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: el,
  createElement: () => makeEl(), createElementNS: () => makeEl(),
  querySelector: () => null, querySelectorAll: () => [],
  body: makeEl(), documentElement: makeEl(), head: makeEl(),
};
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.window = global;
global.navigator = { clipboard: null, userAgent: 'node' };
global.location = { hash: '', href: 'http://localhost/', protocol: 'http:', origin: 'http://localhost' };
global.history = { replaceState() {}, pushState() {} };
global.addEventListener = () => {};
global.requestAnimationFrame = () => 0;
global.fetch = () => Promise.reject(new Error('offline'));
global.Blob = function () {};
global.URL = { createObjectURL: () => '', revokeObjectURL() {} };
global.FileReader = function () {};
global.Chart = function () { return { destroy() {}, resize() {}, update() {} }; };

function csvParse(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  row.push(field); rows.push(row);
  return rows;
}
global.Papa = {
  parse(text, opts) {
    opts = opts || {};
    let rows = csvParse(String(text));
    if (opts.skipEmptyLines) rows = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
    if (opts.header) {
      const h = rows.length ? rows[0] : [];
      return { data: rows.slice(1).map((r) => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; }) };
    }
    return { data: rows };
  },
};

const html = fs.readFileSync(MOD, 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
eval(scripts + '\n;module.exports={cellStatus,escapeHtml,renderElementsTable,' +
  '_setP:v=>{PARAM_LIST=v},_setE:v=>{ELEMENTS=v},_setC:v=>{CUSTOM_NA_TOKENS=v},_setF:v=>{ELEM_FILTER=v},_setS:v=>{ELEM_SORT=v}};');
const M = module.exports;

// Mirror shipped rule defaults (both checked).
el('rule-trim').checked = true;
el('rule-case').checked = true;

// 1. cellStatus matrix.
const CASES = [
  [null, 'E'], [undefined, 'E'], ['', 'E'], ['   ', 'E'], ['\t\n ', 'E'],
  ['n/a', 'N'], ['N/A', 'N'], ['NA', 'N'], ['na', 'N'], ['<n/a>', 'N'],
  ['-', 'N'], ['--', 'N'], ['none', 'N'], ['None', 'N'], ['null', 'N'], ['undefined', 'N'],
  ['hello', 'F'], ['0', 'F'], ['false', 'F'], ['{{7*7}}', 'F'], ['${7*7}', 'F'],
  ['<img src=x onerror=alert(1)>', 'F'], ['  padded  ', 'F'],
];
for (const [inp, want] of CASES) {
  let got = null;
  try { got = M.cellStatus(inp); } catch (e) { got = 'THREW:' + e.message; }
  ok(got === want, 'cellStatus(' + JSON.stringify(inp) + ')=' + want, 'got ' + JSON.stringify(got));
}
// 2. Custom N/A tokens.
M._setC(new Set(['tbd', 'pending']));
ok(M.cellStatus('TBD') === 'N', 'custom token case-insensitive');
ok(M.cellStatus('n/a') === 'F', 'custom set replaces default set');
M._setC(null);
ok(M.cellStatus('n/a') === 'N', 'default set restored');

// 3. Column classification on real fixtures (Comments + Mark columns).
function classify(col, rows) {
  const t = { F: 0, E: 0, N: 0 };
  for (const r of rows) { const s = M.cellStatus(r[col]); t[s] = (t[s] || 0) + 1; }
  return t;
}
const files = ['all-001', 'all-010', 'all-100', 'all-dup', 'all-missing-fields', 'all-xss', 'all-extra-cols'];
const EXPECT_PMAP = {
  'all-001': { n: 1, Comments: { F: 0, E: 1, N: 0 }, Mark: { F: 0, E: 1, N: 0 } },
  'all-010': { n: 10, Comments: { F: 7, E: 3, N: 0 }, Mark: { F: 8, E: 2, N: 0 } },
  'all-100': { n: 100, Comments: { F: 75, E: 25, N: 0 }, Mark: { F: 80, E: 20, N: 0 } },
  'all-dup': { n: 60, Comments: { F: 45, E: 15, N: 0 }, Mark: { F: 48, E: 12, N: 0 } },
  'all-missing-fields': { n: 29, Comments: { F: 22, E: 7, N: 0 }, Mark: { F: 24, E: 5, N: 0 } },
  'all-xss': { n: 4, Comments: { F: 4, E: 0, N: 0 }, Mark: { F: 4, E: 0, N: 0 } },
  'all-extra-cols': { n: 25, Comments: { F: 18, E: 7, N: 0 }, Mark: { F: 20, E: 5, N: 0 } },
};
for (const f of files) {
  const raw = fs.readFileSync(path.join(FX, f + '.csv'), 'utf8');
  const rows = global.Papa.parse(raw, { header: true, skipEmptyLines: true }).data
    .filter((r) => (r.Category || r.Workset || r['Family and Type']));
  const got = { n: rows.length, Comments: classify('Comments', rows), Mark: classify('Mark', rows) };
  ok(JSON.stringify(got) === JSON.stringify(EXPECT_PMAP[f]), f + ' column map locked', 'got ' + JSON.stringify(got));
}

// 4. XSS-safe elements table.
M._setP(['Comments']);
M._setF('all'); M._setS({ col: 'pct', dir: -1 });
M._setE([
  { source: 'T', category: '<img src=x onerror=alert(1)>', famType: 'Fam <b>b</b>', workset: 'W', params: { Comments: 'F' }, pct: 50 },
  { source: 'T', category: 'Walls', famType: 'Normal', workset: '<script>alert(2)</script>', params: { Comments: 'E' }, pct: 0 },
]);
try { M.renderElementsTable(); } catch (e) { ok(false, 'pm table render', 'threw: ' + e.message); }
const tOut = ((els['elements-table'] || {}).innerHTML) || '';
ok(tOut.length > 0, 'pm table rendered');
const stripped = tOut.replace(/&lt;.*?&gt;/g, '');
ok(!/<(img|script|svg)[\s>]/i.test(stripped) && !/ on(error|load)=/i.test(stripped), 'pm payloads render as text');
ok(/&lt;img/i.test(tOut), 'pm payload visibly escaped');
ok(/escapeHtml\(e\.category\)/.test(html) && /escapeHtml\(e\.famType\)/.test(html) && /escapeHtml\(e\.workset\)/.test(html), 'pm columns stay escaped in template');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
