// Model-quality persistence + scoring suite, headless (no deps, runs in CI).
// Covers weighted scoring, trend snapshots (in-memory IndexedDB shim),
// QAQC failure lookup, and project save/load/delete round-trips.
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
global.confirm = () => false;

// Minimal in-memory IndexedDB supporting the exact API surface used.
const _dbs = {};
function fakeStore(st) {
  return {
    put(v) {
      const r = {};
      const k = (v.id !== undefined && v.id !== null) ? v.id : ((v.date !== undefined && v.date !== null) ? v.date : st._seq++);
      st._map.set(k, v);
      setTimeout(() => { r.result = k; if (r.onsuccess) r.onsuccess(); }, 0);
      return r;
    },
    getAll() {
      const r = {};
      setTimeout(() => { r.result = [...st._map.values()]; if (r.onsuccess) r.onsuccess(); }, 0);
      return r;
    },
    delete(id) { st._map.delete(id); },
    clear() { st._map.clear(); },
  };
}
function fakeDb(db) {
  return {
    close() {},
    objectStoreNames: { contains: (n) => !!db.stores[n] },
    createObjectStore(n) { if (!db.stores[n]) db.stores[n] = { _map: new Map(), _seq: 1 }; },
    transaction(name) {
      if (!db.stores[name]) db.stores[name] = { _map: new Map(), _seq: 1 };
      const tx = { objectStore: () => fakeStore(db.stores[name]), oncomplete: null, onerror: null };
      setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
      return tx;
    },
  };
}
global.indexedDB = {
  open(name) {
    if (!_dbs[name]) _dbs[name] = { stores: {} };
    const r = {};
    setTimeout(() => {
      if (r.onupgradeneeded) r.onupgradeneeded({ target: { result: fakeDb(_dbs[name]) } });
      const ev = { target: { result: fakeDb(_dbs[name]) } };
      if (r.onsuccess) r.onsuccess(ev);
    }, 0);
    return r;
  },
};

const html = fs.readFileSync(MOD, 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
eval(scripts + '\n;module.exports={applyWeightedScore,getQAQCFailsForDisc,saveTrendSnapshot,getTrendHistory,saveProject,loadProjects,deleteProject,_setD:v=>{DATA=v},_getD:()=>DATA,_setW:v=>{WEIGHTS=v},_setQ:v=>{QAQC_DATA=v}};');
const M = module.exports;

(async () => {
  // 1. Weighted scoring.
  M._setW({ pass_rate: 50, warnings: 30, in_place: 20 });
  M._setD({ disciplines: [
    { code: 'AR', pass_rate: 100, file_size_mb: 10, warnings: 0, purgeable: 0, in_place: 0, worksets: 30 },
    { code: 'ST', pass_rate: 0, file_size_mb: 9999, warnings: 999, purgeable: 99999, in_place: 5, worksets: 0 },
  ] });
  M.applyWeightedScore();
  const dd = M._getD().disciplines;
  ok(dd[0].weightedScore === 100, 'perfect disc scores 100', 'got ' + dd[0].weightedScore);
  ok(dd[1].weightedScore === 0, 'worst disc scores 0', 'got ' + dd[1].weightedScore);
  // qaqc fallback 0.5 when absent; zero weights -> 50.
  M._setW({ naming_convention: 100 });
  M._setD({ disciplines: [{ code: 'AR', pass_rate: 100, qaqc: { naming_convention: 80 } }, { code: 'ST', pass_rate: 100 }] });
  M.applyWeightedScore();
  const dd2 = M._getD().disciplines;
  ok(dd2[0].weightedScore === 80 && dd2[1].weightedScore === 50, 'qaqc real vs fallback-50');
  M._setW({});
  M._setD({ disciplines: [{ code: 'AR', pass_rate: 100 }] });
  M.applyWeightedScore();
  ok(M._getD().disciplines[0].weightedScore === 50, 'zero weights -> 50');

  // 2. Trend snapshot round-trip.
  M._setD({ reportDate: '2026-10-11', project: 'T', disciplines: [
    { code: 'AR', pass_rate: 80, file_size_mb: 1, warnings: 1, purgeable: 1 },
    { code: 'ST', pass_rate: 60, file_size_mb: 1, warnings: 1, purgeable: 1 },
  ] });
  M.saveTrendSnapshot();
  const hist = await M.getTrendHistory();
  ok(hist.length === 1 && hist[0].avgRate === 70 && hist[0].totalDisciplines === 2, 'trend snapshot avg', JSON.stringify(hist[0]));

  // 3. QAQC failure lookup.
  M._setQ({
    'QAQC Checklist - GENERAL': { code: 'GENERAL', models: ['AR', 'ST'], checks: [
      { id: 'QA-01', group: 'G', desc: 'd1', scores: { AR: 100, ST: 80 } },
      { id: 'QA-02', group: 'G', desc: 'd2', scores: { AR: 90, ST: 100 } },
    ] },
    'QAQC Checklist - EL': { code: 'EL', models: ['EL'], checks: [
      { id: 'QA-03', group: 'G', desc: 'd3', scores: { EL: 70 } },
    ] },
  });
  const arFails = M.getQAQCFailsForDisc('AR', 'general');
  ok(arFails.length === 1 && arFails[0].id === 'QA-02', 'general fails for AR');
  const elFails = M.getQAQCFailsForDisc('EL', 'technical');
  ok(elFails.length === 1 && elFails[0].score === 70, 'technical fails for EL');
  const none = M.getQAQCFailsForDisc('ZZ', 'general');
  ok(none.length === 0, 'no fails for unknown disc');
  M._setQ(null);
  ok(M.getQAQCFailsForDisc('AR', 'general').length === 0, 'null data safe');

  // 4. Project persistence round-trip.
  await M.saveProject('proj-one', { a: 1 });
  let list = await M.loadProjects();
  ok(list.length === 1 && list[0].name === 'proj-one' && list[0].data.a === 1, 'project saved+loaded');
  await M.deleteProject(list[0].id);
  list = await M.loadProjects();
  ok(list.length === 0, 'project deleted');

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS', e); process.exit(1); });
