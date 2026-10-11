// Validator fixture suite: workset module, headless (no deps, runs in CI).
// Locks known-good parse counts + status distributions (seed-fixed fixtures),
// proves adversarial cells render as text, and proves CSV exports are
// formula-injection safe. Any rule change trips these on purpose.
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd(); // repo root: deploy/ in CI, HUB source locally
const HUB = path.join(ROOT, 'modules', 'workset-validator.html');
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
    click() { if (this.download) global.__lastDownload = { href: this.href, name: this.download }; }, focus() {}, closest() { return null; },
    getAttribute() { return null; }, setAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
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
global.navigator = { clipboard: null, userAgent: 'node' };
global.location = { hash: '', href: 'http://localhost/', protocol: 'http:', origin: 'http://localhost' };
global.history = { replaceState() {}, pushState() {} };
global.addEventListener = () => {};
global.requestAnimationFrame = () => 0;
global.fetch = () => Promise.reject(new Error('offline'));
global.Blob = function (parts) { global.__lastBlob = (parts || []).join(''); };
global.URL = { createObjectURL: () => '', revokeObjectURL() {} };
global.FileReader = function () {};
global.Chart = function () { return { destroy() {}, resize() {}, update() {} }; };
let downloaded = null;
global.downloadBlob = function (blob, name) { downloaded = { blob, name }; };

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
  unparse(rows) { return rows.map((r) => r.map((c) => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c)).join(',')).join('\n'); },
};

const html = fs.readFileSync(HUB, 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
eval(scripts + '\n;module.exports={parseAllCsv,validateRows,escapeHtml,computeStats,renderElements,exportElementsCsv,csvSafe,_setElements:v=>{ELEMENTS=v}};');
const M = module.exports;

const EXPECT_COUNT = { 'all-000': 0, 'all-001': 1, 'all-010': 10, 'all-100': 100, 'all-1000': 1000, 'all-dup': 60, 'all-extra-cols': 25, 'all-missing-fields': 29, 'all-xss': 4 };
const EXPECT_DIST = {
  'all-000': {}, 'all-001': { Valid: 1 }, 'all-010': { Valid: 10 },
  'all-100': { Valid: 73, Invalid: 18, Skipped: 5, Missing: 4 },
  'all-1000': { Valid: 766, Invalid: 205, Skipped: 29 },
  'all-dup': { Valid: 13, Invalid: 42, Missing: 3, Skipped: 2 },
  'all-extra-cols': { Valid: 19, Missing: 3, Skipped: 1, Invalid: 2 },
  'all-missing-fields': { Valid: 8, Skipped: 14, Missing: 5, Invalid: 2 },
  'all-xss': { Skipped: 2, Valid: 2 },
};
const dist = (res) => { const t = {}; for (const r of res) t[r.status] = (t[r.status] || 0) + 1; return t; };
const sameDist = (a, b) => JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]])) === JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k]]));

for (const f of Object.keys(EXPECT_COUNT)) {
  const raw = fs.readFileSync(path.join(FX, f + '.csv'), 'utf8');
  let rows = [];
  try { rows = M.parseAllCsv(raw); } catch (e) { ok(false, f + ' parse', 'threw: ' + e.message); continue; }
  ok(rows.length === EXPECT_COUNT[f], f + ' parse count=' + EXPECT_COUNT[f], 'got ' + rows.length);
  let res = [];
  try { res = M.validateRows(rows); } catch (e) { ok(false, f + ' validate', 'threw: ' + e.message); continue; }
  ok(res.length === rows.length, f + ' results=rows');
  ok(sameDist(dist(res), EXPECT_DIST[f]), f + ' distribution locked', 'got ' + JSON.stringify(dist(res)));
  ok(res.every((r) => typeof r.status === 'string' && typeof r.failure_reason === 'string'), f + ' result shape');
}

// Duplicate Element Ids are flagged, never silently valid.
const dupRows = M.validateRows(M.parseAllCsv(fs.readFileSync(path.join(FX, 'all-dup.csv'), 'utf8')));
const dupFlagged = dupRows.filter((r) => (r.failure_reason || '').indexOf('Duplicate Element Id') === 0);
ok(dupFlagged.length === 40, 'all-dup flags all 40 repeat occurrences', 'got ' + dupFlagged.length);
ok(dupFlagged.every((r) => r.status === 'Invalid'), 'duplicate rows are Invalid');

// XSS: adversarial cells must render as text in the elements table.
const xssRows = M.parseAllCsv(fs.readFileSync(path.join(FX, 'all-xss.csv'), 'utf8'));
M._setElements(M.validateRows(xssRows));
try { M.renderElements(); } catch (e) { ok(false, 'xss render', 'threw: ' + e.message); }
const out = (els.etable && els.etable.innerHTML) || '';
ok(out.length > 0, 'xss table rendered');
// Strip escaped spans (&lt;...&gt;) first: handlers inside them are inert text.
const stripped = out.replace(/&lt;.*?&gt;/g, '');
ok(!/<(img|script|svg)[\s>]/i.test(stripped) && !/ on(error|load)=/i.test(stripped), 'xss renders as text, never executes');
ok(/&lt;img/i.test(out), 'xss payload visibly escaped (&lt;)');
// White-box guard: the table template must keep escaping the reason column.
ok(/escapeHtml\(e\.failure_reason\)/.test(html), 'reason column stays escaped in template');

// escapeHtml unit.
ok(M.escapeHtml('<img src="x">') === '&lt;img src=&quot;x&quot;&gt;', 'escapeHtml exact');

// CSV export must neutralise formula-leading cells.
downloaded = null; global.__lastDownload = null; global.__lastBlob = null;
M._setElements([{ element_id: 1, discipline: 'EL', family: 'F', category: 'Cables', workset_name: '=cmd|/c calc', expected_workset: 'E', status: 'Invalid', failure_reason: '+evil -thing @go' }]);
try { M.exportElementsCsv(); } catch (e) { ok(false, 'csv export', 'threw: ' + e.message); }
ok(!!global.__lastDownload, 'csv export triggers download');
ok(/WorksetValidator_Elements_.*\.csv/.test((global.__lastDownload || {}).name || ''), 'csv export filename');
ok(/'=cmd/.test(global.__lastBlob || '') && /'\+evil/.test(global.__lastBlob || ''), 'csv export sanitises formula cells');
ok(typeof M.csvSafe('=cmd|/c') === 'string' && M.csvSafe('=1+1')[0] === "'" && M.csvSafe('+x')[0] === "'" && M.csvSafe('-x')[0] === "'" && M.csvSafe('@x')[0] === "'" && M.csvSafe('ok') === 'ok', 'csvSafe neutralises = + - @');
ok(M.csvSafe(null) === '' && M.csvSafe(undefined) === '', 'csvSafe null-safe');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
