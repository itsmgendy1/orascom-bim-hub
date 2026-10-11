// Clash auto-approval engine suite, headless (no deps, runs in CI).
// Locks rule semantics: per-rule hits, distance gates (NaN never trips),
// same-discipline/name matching, MEP exclusion, swapped sides, statuses,
// disabled/duplicate rules, and first-match priority.
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const MOD = path.join(ROOT, 'modules', 'clash.html');

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

const html = fs.readFileSync(MOD, 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*(?:src=|type="application\/ld\+json"|type="application\/json"))[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
eval(scripts + '\n;module.exports={CLASH_RULES_DEFAULT,clashRuleCompile,clashDiscipline,clashSplitTest,clashRuleMatches,clashParseDist,clashBuildRecords,clashEvaluate};');
const M = module.exports;
const rules = JSON.parse(JSON.stringify(M.CLASH_RULES_DEFAULT.rules)).map(M.clashRuleCompile);
const byId = (id) => rules.filter((r) => r.id === id)[0];

// Primitives
ok(M.clashParseDist('1,234.5') === 1234.5, 'dist commas');
ok(M.clashParseDist('-3') === 3, 'dist abs');
ok(isNaN(M.clashParseDist('abc')), 'dist NaN text');
ok(isNaN(M.clashParseDist('')), 'dist NaN empty');
ok(isNaN(M.clashParseDist(null)), 'dist NaN null');
ok(M.clashDiscipline('ST-WALLS') === 'ST', 'discipline prefix');
ok(M.clashDiscipline('Insulation') === 'INSULATION', 'discipline word');
ok(JSON.stringify(M.clashSplitTest('A-vs-B')) === JSON.stringify(['A', 'B']), 'split test');
ok(JSON.stringify(M.clashSplitTest('NoSep')) === JSON.stringify(['NoSep', '']), 'split no-sep');
// Defaults locked
ok(rules.length === 6 && rules.filter((r) => r.tier === 'A').length === 4, 'default rule set v1 (6 rules, 4 tier-A)');

function C(o) {
  return Object.assign({ test: 'T', setA: '', setB: '', clash: 'CL', status: 'Active', dist: NaN, nameA: '', nameB: '', pathA: '', pathB: '' }, o);
}
// A1: insulation vs its own host, same item, <=50mm (real sets are
// discipline-prefixed on both sides, e.g. AC-Duct Insulations vs AC-Ducts)
ok(M.clashRuleMatches(byId('A1'), C({ setA: 'AC-Duct Insulations', setB: 'AC-Ducts', nameA: 'Duct 300x200', nameB: 'Duct 300x200', dist: 0.02 })) === true, 'A1 hit');
ok(M.clashRuleMatches(byId('A1'), C({ setA: 'AC-Ducts', setB: 'AC-Duct Insulations', nameA: 'Duct 300x200', nameB: 'Duct 300x200', dist: 0.02 })) === true, 'A1 swapped sides');
ok(M.clashRuleMatches(byId('A1'), C({ setA: 'AC-Duct Insulations', setB: 'AC-Ducts', nameA: 'Insulation', nameB: 'Steel Beam', dist: 0.02 })) === false, 'A1 name mismatch stays manual');
ok(M.clashRuleMatches(byId('A1'), C({ setA: 'AC-Duct Insulations', setB: 'AC-Ducts', nameA: 'Duct 300x200', nameB: 'Duct 300x200', dist: 0.2 })) === false, 'A1 distance gate');
// A2: same-system connection <=10mm
ok(M.clashRuleMatches(byId('A2'), C({ setA: 'EL-Cable', setB: 'EL-Trays', nameA: 'Tray', nameB: 'Tray', dist: 0.005 })) === true, 'A2 hit');
ok(M.clashRuleMatches(byId('A2'), C({ setA: 'EL-Cable', setB: 'ST-Wall', nameA: 'Tray', nameB: 'Tray', dist: 0.005 })) === false, 'A2 discipline gate');
// A3: hanger vs structure <=30mm
ok(M.clashRuleMatches(byId('A3'), C({ setA: 'Accessories', nameA: 'HILTI anchor', setB: 'ST-WALLS', dist: 0.02 })) === true, 'A3 hit');
ok(M.clashRuleMatches(byId('A3'), C({ setA: 'Accessories', nameA: 'Pipe', setB: 'ST-WALLS', dist: 0.02 })) === false, 'A3 name gate');
// A4: tolerance <=10mm, MEP-vs-MEP excluded
ok(M.clashRuleMatches(byId('A4'), C({ setA: 'AR-Walls', setB: 'ST-Cols', dist: 0.008 })) === true, 'A4 hit');
ok(M.clashRuleMatches(byId('A4'), C({ setA: 'Ducts', setB: 'Pipes', dist: 0.008 })) === false, 'A4 MEP exclusion');
ok(M.clashRuleMatches(byId('A4'), C({ setA: 'AR-Walls', setB: 'ST-Cols', dist: 0.05 })) === false, 'A4 distance gate');
ok(M.clashRuleMatches(byId('A4'), C({ setA: 'AR-Walls', setB: 'ST-Cols', dist: NaN })) === false, 'A4 NaN never trips');
// B1: finish vs structure <=150mm
ok(M.clashRuleMatches(byId('B1'), C({ setA: 'AR-Floors', nameA: 'Terrazzo finish', setB: 'ST-Slab', dist: 0.1 })) === true, 'B1 hit');
ok(M.clashRuleMatches(byId('B1'), C({ setA: 'AR-Floors', nameA: 'Terrazzo finish', setB: 'ST-Slab', dist: 0.2 })) === false, 'B1 distance gate');
// B2 duplicate type never matches directly
ok(M.clashRuleMatches(byId('B2'), C({ dist: 0 })) === false, 'B2 never direct-matches');
// Disabled rule skipped
const dis = JSON.parse(JSON.stringify(M.CLASH_RULES_DEFAULT.rules)).map(M.clashRuleCompile);
dis.filter((r) => r.id === 'A1')[0].enabled = false;
ok(M.clashRuleMatches(dis.filter((r) => r.id === 'A1')[0], C({ setA: 'Insulation', setB: 'AC-Ducts', nameA: 'D', nameB: 'D', dist: 0.01 })) === false, 'disabled rule skipped');

// clashEvaluate: statuses, priority, records
const recs = M.clashBuildRecords([
  { test: 'M-vs-S', aName: 'Anchor', clash: 'CL-1', statusRaw: 'Active', distance: '0.02', aId: '1', bId: '2' },
  { test: 'M-vs-S', clash: 'CL-2', statusRaw: 'Resolved', distance: '0.001', aId: '3', bId: '4' },
  { test: 'M-vs-S', clash: 'CL-3', statusRaw: 'New', distance: '5', aId: '5', bId: '6' },
]);
ok(recs.length === 3 && recs[0].dist === 0.02, 'build records');
const out = M.clashEvaluate(recs, rules, ['New', 'Active']);
ok(out.length === 2, 'evaluate filters statuses', 'got ' + out.length);
ok(out.every((o) => o.rec.status !== 'Resolved'), 'resolved excluded');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
