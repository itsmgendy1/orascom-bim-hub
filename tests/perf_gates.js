// Perf gates: generous ceilings (100x+ above measured baselines) so CI only
// fails on pathological regressions, never on runner noise.
// Baselines (local, 2026-10-11): ws-parse-1000 5.5ms, ws-validate-1000 7.3ms,
// clash-eval-5000 11.3ms, naming-2000 4.1ms, dv-match-2000 0.8ms, hub-boot 9.9ms.
// The 70MB report path is browser-DOM-only by design (chunked import);
// raw scan cost measured separately: read 0.16s, table split 0.04s.
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

let pass = 0, fail = 0;
function ok(cond, id, detail) {
  if (cond) { pass++; console.log('PASS ' + id + (detail ? ' | ' + detail : '')); }
  else { fail++; console.log('FAIL ' + id + (detail ? ' | ' + detail : '')); }
}
function stub() {
  function makeEl() {
    return { innerHTML: '', textContent: '', value: '', files: [], checked: false, style: {}, dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, click() {}, focus() {},
      closest() { return null; }, getAttribute() { return null; }, setAttribute() {},
      querySelector() { return null; }, querySelectorAll: () => [], getContext() { return null; },
      getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; } };
  }
  const els = {};
  global.document = { addEventListener() {}, removeEventListener() {},
    getElementById: (id) => (els[id] || (els[id] = makeEl())), createElement: () => makeEl(),
    createElementNS: () => makeEl(), querySelector: () => null, querySelectorAll: () => [],
    body: makeEl(), documentElement: makeEl(), head: makeEl() };
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
}
function csvParse(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  row.push(field); rows.push(row);
  return rows;
}
stub();
global.Papa = { parse(text, opts) {
  opts = opts || {};
  let rows = csvParse(String(text));
  if (opts.skipEmptyLines) rows = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (opts.header) { const h = rows.length ? rows[0] : []; return { data: rows.slice(1).map((r) => { const o = {}; h.forEach((k, i) => { o[k] = r[i]; }); return o; }) }; }
  return { data: rows };
} };
function load(mod) {
  const html = fs.readFileSync(path.join(ROOT, 'modules', mod), 'utf8');
  return [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}
function gate(id, ms, cap) {
  ok(ms < cap, id + ' under ' + cap + 'ms', ms.toFixed(1) + 'ms');
}
let t0 = process.hrtime.bigint();
eval(load('workset-validator.html') + ';module.exports={parseAllCsv,validateRows};');
const W = module.exports;
const raw1000 = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'all-1000.csv'), 'utf8');
t0 = process.hrtime.bigint();
const wrows = W.parseAllCsv(raw1000);
gate('ws-parse-1000', Number(process.hrtime.bigint() - t0) / 1e6, 5000);
t0 = process.hrtime.bigint();
W.validateRows(wrows);
gate('ws-validate-1000', Number(process.hrtime.bigint() - t0) / 1e6, 5000);

eval(load('clash.html') + ';module.exports={CLASH_RULES_DEFAULT,clashRuleCompile,clashEvaluate,clashBuildRecords};');
const CE = module.exports;
const rules = JSON.parse(JSON.stringify(CE.CLASH_RULES_DEFAULT.rules)).map(CE.clashRuleCompile);
const items = [];
for (let i = 0; i < 5000; i++) items.push({ test: 'AC-Ducts-vs-AC-Duct Insulations', aName: 'Duct ' + (i % 50), clash: 'CL-' + i, statusRaw: 'Active', distance: String(0.005 + (i % 7) * 0.01), aId: String(i), bId: String(100000 + i) });
const recs = CE.clashBuildRecords(items);
t0 = process.hrtime.bigint();
CE.clashEvaluate(recs, rules, ['New', 'Active']);
gate('clash-eval-5000', Number(process.hrtime.bigint() - t0) / 1e6, 8000);

eval(load('naming-convention.html') + ';module.exports={validateFamilySeg};');
t0 = process.hrtime.bigint();
for (let i = 0; i < 2000; i++) module.exports.validateFamilySeg('OCC-WALLS-BASIC-DESC' + i);
gate('naming-2000', Number(process.hrtime.bigint() - t0) / 1e6, 5000);

eval(load('delivery-verification.html') + ';module.exports={axBuildFileIndex,axMatchOurFile};');
const cf = [];
for (let i = 0; i < 2000; i++) cf.push({ name: 'A-EL-' + String(i).padStart(4, '0') + '.pdf', folderPath: '/Our', ext: 'pdf', isDrawing: true });
const didx = module.exports.axBuildFileIndex(cf);
t0 = process.hrtime.bigint();
for (let i = 0; i < 2000; i += 2) module.exports.axMatchOurFile(cf[i], didx);
gate('dv-match-2000', Number(process.hrtime.bigint() - t0) / 1e6, 5000);

t0 = process.hrtime.bigint();
eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'site-plots.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'ohub-auth.js'), 'utf8'));
eval(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'hub.js'), 'utf8'));
gate('hub-boot', Number(process.hrtime.bigint() - t0) / 1e6, 5000);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
