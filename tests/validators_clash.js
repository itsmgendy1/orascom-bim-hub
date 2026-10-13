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
eval(scripts + '\n;module.exports={CLASH_RULES_DEFAULT,clashRuleCompile,clashDiscipline,clashSplitTest,clashRuleMatches,clashParseDist,clashBuildRecords,clashEvaluate,clashTestDiscs,clashIsOpen,clashDiscAnalysis,clashDiscUnmapped,clashSelfDisc,clashApproved,clashRowHtml,CLASH_TRADE_MECH,CLASH_TRADE_ELEC};');
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

// B2: same element pair in another test, order-insensitive, manual only.
const dupRecs = M.clashBuildRecords([
  { test: 'T1', aName: 'Wall', clash: 'CL-1', statusRaw: 'Active', distance: '5', aId: 'A1', bId: 'B1' },
  { test: 'T2', aName: 'Wall', clash: 'CL-2', statusRaw: 'Active', distance: '5', aId: 'B1', bId: 'A1' },
  { test: 'T3', aName: 'Wall', clash: 'CL-3', statusRaw: 'Active', distance: '5', aId: 'A1', bId: 'B1' },
  { test: 'T4', aName: 'Slab', clash: 'CL-4', statusRaw: 'Active', distance: '5', aId: '', bId: '' },
]);
const dout = M.clashEvaluate(dupRecs, rules, ['New', 'Active']);
ok(dout[0].rule === null, 'first occurrence stays manual');
ok(dout[1].rule === 'B2' && dout[1].tier === 'B' && /duplicate of CL-1 in T1/.test(dout[1].note), 'second occurrence marked duplicate', dout[1].rule + '|' + dout[1].note);
ok(dout[2].rule === 'B2', 'third occurrence also duplicate');
ok(dout[3].rule === null, 'keyless rows skipped');
// B2 never overrides a direct rule hit.
const mixRecs = M.clashBuildRecords([
  { test: 'X', aName: 'Tray', clash: 'CL-9', statusRaw: 'Active', distance: '0.005', aId: 'E1', bId: 'E2' },
  { test: 'Y', aName: 'Tray', clash: 'CL-10', statusRaw: 'Active', distance: '0.005', aId: 'E2', bId: 'E1' },
]);
const mout = M.clashEvaluate(mixRecs, [{ id: 'R1', tier: 'A', enabled: true, maxDistance: 0.01 }].map(M.clashRuleCompile), ['Active']);
ok(mout[0].rule === 'R1' && mout[1].rule === 'R1', 'direct hits keep priority over B2');
// Disabled B2 disables duplicate marking.
const noDup = rules.map((r) => Object.assign({}, r, { enabled: r.id === 'B2' ? false : r.enabled }));
const nout = M.clashEvaluate(dupRecs, noDup, ['Active']);
ok(nout[1].rule === null, 'disabled B2 marks nothing');

// Test-derived discipline analysis: codes from TEST sides, cross counts both,
// self counted once, open excludes auto-approved, owner-locked trade groups.
ok(M.CLASH_TRADE_MECH.join() === 'AC,WS,DR,PS,FS', 'mech trade locked');
ok(M.CLASH_TRADE_ELEC.join() === 'TE,EL,BS,VT', 'elec trade locked');
const D = (setA, setB, bucket, auto) => ({ setA, setB, bucket, auto: auto || null });
ok(JSON.stringify(M.clashTestDiscs(D('AR-Casework', 'AR-Furniture', 'Open'))) === '["AR","AR"]', 'self sides');
ok(JSON.stringify(M.clashTestDiscs(D('AR-Casework', 'PS-Pipes', 'Open'))) === '["AR","PS"]', 'cross sides');
ok(M.clashIsOpen(D('AR-X', 'PS-Y', 'Open')) === true, 'open');
ok(M.clashIsOpen(D('AR-X', 'PS-Y', 'Open', { rule: 'A1' })) === false, 'auto-approved not open');
ok(M.clashIsOpen(D('AR-X', 'PS-Y', 'Closed')) === false, 'closed not open');
const da = M.clashDiscAnalysis([
  D('AR-Casework', 'AR-Furniture', 'Open'),      // self AR open
  D('AR-Casework', 'AR-Furniture', 'Closed'),    // self AR closed
  D('AR-Casework', 'PS-Pipes', 'Open'),          // cross AR+PS open
  D('AC-Ducts', 'TE-Trays', 'Closed'),           // cross mech+elec closed
  D('AC-Ducts', 'TE-Trays', 'Open', { rule: 'A1' }), // auto: closed-bucket math
]);
ok(da.per.AR.open === 2 && da.per.AR.closed === 1, 'AR open/closed', JSON.stringify(da.per.AR));
ok(da.per.PS.open === 1 && da.per.PS.closed === 0, 'PS cross counted');
ok(da.per.AR.self === 2 && da.per.AR.cross === 1, 'AR self/cross split');
ok(da.self.open === 1 && da.self.closed === 1, 'self totals');
ok(da.cross.open === 1 && da.cross.closed === 2, 'cross totals (auto counts closed)');
ok(da.trades.mech.open === 1 && da.trades.mech.closed === 2, 'mech trade', JSON.stringify(da.trades.mech));
ok(da.trades.elec.open === 0 && da.trades.elec.closed === 2, 'elec trade');
ok(da.trades.mechElec.open === 0 && da.trades.mechElec.closed === 2, 'mech-elec pairs');
ok(M.clashDiscAnalysis([]).discs.length === 0, 'empty input');
ok(M.clashDiscAnalysis([D('', '', 'Open')]).per.Unspecified.open === 1, 'missing sides unspecified');

ok(M.clashDiscUnmapped([]) === false, 'unmapped: empty is not unmapped');
ok(M.clashDiscUnmapped([{ setA: '', setB: '', aDisc: 'Unspecified', bDisc: 'Unspecified' }]) === true, 'unmapped: default unspecified strings');
ok(M.clashDiscUnmapped([{ setA: 'AR-X', setB: '', aDisc: '', bDisc: '' }]) === false, 'unmapped: one side mapped');
ok(M.clashDiscUnmapped([{ setA: '', setB: '', aDisc: 'AR', bDisc: '' }]) === false, 'unmapped: item disc mapped');

// Live dashboard items carry raw test (no setA/setB): fallback splits test.
ok(JSON.stringify(M.clashTestDiscs({ test: 'AR-Casework -vs- PS-Pipes' })) === '["AR","PS"]', 'fallback splits test');
ok(JSON.stringify(M.clashTestDiscs({ test: 'NoSep', setA: '', setB: '' })) === '["NOSEP",""]', 'fallback no-sep');
const dt = M.clashDiscAnalysis([
  { test: 'AR-Casework -vs- AR-Furniture', bucket: 'Open' },
  { test: 'AR-Casework -vs- PS-Pipes', bucket: 'Open' },
  { test: 'AC-Ducts -vs- TE-Trays', bucket: 'Closed' },
]);
ok(dt.per.AR.open === 2 && dt.per.PS.open === 1, 'fallback per-disc');
ok(JSON.stringify(dt.per.AR.mates) === '{"PS":1}', 'mates counted', JSON.stringify(dt.per.AR.mates));
ok(dt.per.TE.mates && dt.per.TE.mates.AC === 1, 'cross mates mirrored');
ok(dt.per.AR.cross === 1 && dt.per.PS.cross === 1, 'cross split');

// Details-tab predicates + shared row builder.
ok(M.clashSelfDisc({ test: 'AR-X -vs- AR-Y', bucket: 'Open' }) === 'AR', 'self disc');
ok(M.clashSelfDisc({ test: 'AR-X -vs- PS-Y', bucket: 'Open' }) === null, 'cross not self');
ok(M.clashSelfDisc({ test: '', bucket: 'Open' }) === 'Unspecified', 'blank sides self-unspecified');
ok(M.clashApproved({ auto: { rule: 'A1' } }) === true, 'auto approved');
ok(M.clashApproved({}) === false && M.clashApproved(null) === false, 'not approved');
ok(typeof M.clashRowHtml({ test: 'T', clash: '', aName: 'A', bName: 'B', aDisc: 'AR', bDisc: 'PS', distance: '', priority: 'High', bucket: 'Open', statusRaw: '', date: '' }) === 'string', 'row builder returns html');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
