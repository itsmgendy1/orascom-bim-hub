// Delivery-verification kernel suite, headless (no deps, runs in CI).
// Locks name normalisation, decompose keys, version/date comparison,
// file matching (L1/L2/L3 incl. duplicate ties), size parsing and
// XSS-safe provenance rendering.
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const MOD = path.join(ROOT, 'modules', 'delivery-verification.html');

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

const html = fs.readFileSync(MOD, 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
eval(scripts + '\n;module.exports={normalizeKey,extractDiscipline,axNormName,axNormBase,axDecompose,axDecompKey,axFileType,axIsRelevant,axParseVer,axDayDiff,axGetExt,axSameExt,axBuildFileIndex,axMatchOurFile,axCompareVersions,axReconcileOne,parseFileSizeMB,abParseDate,abHumanizeDiff,abDateOnly,abDayDiffText,axProvRow,axBridgePill,axConfPill,escHtml,nameFilterMatch,onNameFilterChange,axNameScope};');
const M = module.exports;

// Mirror shipped rule defaults.
el('rule-ext').checked = true;
el('rule-suffix').checked = false;

// 1. normalizeKey / extractDiscipline
ok(M.normalizeKey('P0152-AR-0001.pdf') === 'P0152-AR-0001', 'norm ext');
ok(M.normalizeKey('  a b  ') === 'A B', 'norm case/space');
ok(M.normalizeKey(null) === '', 'norm null');
ok(M.extractDiscipline('P0152-AR-0001') === 'AR', 'disc middle');
ok(M.extractDiscipline('ST-FRAME') === 'ST', 'disc first');
ok(M.extractDiscipline('NOPE-X') === '', 'disc absent');

// 2. ax names / ext / type
ok(M.axNormName(' aB-1 .pdf ') === 'AB-1 .PDF', 'axNormName');
ok(M.axNormBase('A-EL-0001-P01.pdf') === 'A-EL-0001', 'axNormBase strips rev+ext');
ok(M.axGetExt('x.RVT') === 'rvt', 'ext lower');
ok(M.axGetExt('noext') === '', 'ext absent');
ok(M.axSameExt({ name: 'a.pdf' }, { name: 'b.PDF' }) === true, 'same ext ci');
ok(M.axSameExt({ name: 'a.pdf' }, { name: 'b.dwg' }) === false, 'diff ext');
ok(M.axFileType({ isRevitModel: true }) === 'Revit Model', 'type model');
ok(M.axFileType({ isDrawing: true, ext: 'pdf' }) === 'Drawing PDF', 'type pdf');
ok(M.axIsRelevant({ isDrawing: true }) && !M.axIsRelevant({ isSupportingFile: true }), 'relevance');

// 3. decompose
const dc = M.axDecompose('P0152-PROJ-ZONE-BL12-01-AR-00001.dwg');
ok(dc.bldg === 'BL12' && dc.zone === '01' && dc.disc === 'AR' && dc.seq === '00001', 'decompose full', JSON.stringify(dc));
ok(M.axDecompKey(dc) === 'BL12|01|AR|00001', 'decomp key');
ok(M.axDecompKey(M.axDecompose('random-name')) === '', 'decomp key empty');
ok(M.axDecompose(null).seq === '' && M.axDecompose('').bldg === '', 'decompose null-safe');

// 4. versions
ok(M.axParseVer('V12') === 12 && M.axParseVer('v3 x') === 3, 'parse ver');
ok(M.axParseVer('none') === null && M.axParseVer('') === null && M.axParseVer(null) === null, 'parse ver absent');
let c = M.axCompareVersions({ versionNumber: 'V3' }, { versionNumber: 'V2' });
ok(c.verdict === 'CLIENT OUTDATED' && c.ourVer === 3 && c.clientVer === 2, 'client outdated');
c = M.axCompareVersions({ versionNumber: 'V2' }, { versionNumber: 'V3' });
ok(c.verdict === 'CLIENT NEWER', 'client newer');
c = M.axCompareVersions({ versionNumber: 'V2', revision: 'P01' }, { versionNumber: 'V2', revision: 'P02' });
ok(c.verdict === 'SAME' && c.revMismatch === true, 'rev mismatch flagged');
c = M.axCompareVersions({}, {});
ok(c.verdict === 'UNKNOWN', 'unknown without data');
c = M.axCompareVersions(
  { lastUpdatedDate: new Date(2026, 9, 1) }, { lastUpdatedDate: new Date(2026, 9, 5) });
ok(c.verdict === 'CLIENT NEWER' && c.dayDelay === -4, 'date-only newer', JSON.stringify(c));
ok(M.axDayDiff(new Date(2026, 9, 5), new Date(2026, 9, 1)) === 4, 'day diff');
ok(M.axDayDiff(null, new Date()) === null, 'day diff null-safe');

// 5. dates / sizes
ok(M.abParseDate('October 11, 2026 10:30 AM') instanceof Date, 'ab date words');
ok(M.abParseDate('2026-10-11') instanceof Date, 'ab date iso');
ok(M.abParseDate('garbage') === null && M.abParseDate('') === null, 'ab date invalid');
ok(M.abDayDiffText(0) === 'same day' && M.abDayDiffText(3) === '+3d', 'day text');
ok(M.parseFileSizeMB('10 MB') === 10 && M.parseFileSizeMB('1.5GB') === 1536, 'sizes');
ok(M.parseFileSizeMB('512KB') === 0.5 && M.parseFileSizeMB('') === 0 && M.parseFileSizeMB('x') === 0, 'sizes edge');

// 6. matching: exact, missing, duplicate tie, same-folder preference
const F = (name, folder, ext, extra) => Object.assign(
  { name, folderPath: folder, ext, isDrawing: true, isRevitModel: false }, extra || {});
const client = [
  F('A-EL-0001.pdf', '/Our', 'pdf'),
  F('A-EL-0001.pdf', '/Other', 'pdf'),
  F('B-AR-0002-P01.dwg', '/Our', 'dwg'),
];
const idx = M.axBuildFileIndex(client);
let m = M.axMatchOurFile(F('A-EL-0001.pdf', '/Our', 'pdf'), idx);
ok(m.level === 'L1' && m.conf === 'HIGH' && m.cands.length === 1 && m.cands[0].folderPath === '/Our', 'same-folder twin preferred');
m = M.axMatchOurFile(F('A-EL-0001.pdf', '/Third', 'pdf'), idx);
ok(m.level === 'L1' && m.dup === true && m.conf === 'LOW', 'true tie stays duplicate LOW');
m = M.axMatchOurFile(F('B-AR-0002-P02.dwg', '/Our', 'dwg'), idx);
ok((m.level === 'L2' || m.level === 'L3') && m.conf !== 'NO MATCH', 'revision step matches below L1', m.level);
m = M.axMatchOurFile(F('ZZ-404.pdf', '/Our', 'pdf'), idx);
ok(m.level === 'NONE' && m.conf === 'NO MATCH', 'missing file');

// 7. Full reconciliation verdicts.
const D = (s) => new Date(2026, 9, s);
const cliFiles = [
  F('A-EL-0001.pdf', '/Our', 'pdf', { versionNumber: 'V2', revision: 'P01', lastUpdatedDate: D(5) }),
  F('TWIN.pdf', '/A', 'pdf', { versionNumber: 'V1' }),
  F('TWIN.pdf', '/B', 'pdf', { versionNumber: 'V1' }),
];
const cidx = M.axBuildFileIndex(cliFiles);
function O(name, folder, extra) {
  return Object.assign({ name, folderPath: folder, ext: 'pdf', isDrawing: true, versionNumber: 'V2', revision: 'P01', lastUpdatedDate: D(5) }, extra || {});
}
let rec = M.axReconcileOne(O('A-EL-0001.pdf', '/Our'), cidx, 'test');
ok(rec.bridge === 'BRIDGED — CONFIRMED' && rec.versionStatus === 'SAME', 'identical copy confirmed');
rec = M.axReconcileOne(O('A-EL-0001.pdf', '/Our', { versionNumber: 'V3' }), cidx, 'test');
ok(rec.bridge === 'OUTDATED CLIENT COPY', 'ours newer -> client outdated');
rec = M.axReconcileOne(O('A-EL-0001.pdf', '/Our', { versionNumber: 'V1' }), cidx, 'test');
ok(rec.bridge === 'CLIENT NEWER', 'ours older -> client newer');
rec = M.axReconcileOne(O('A-EL-0001.pdf', '/Our', { revision: 'P02' }), cidx, 'test');
ok(rec.versionStatus === 'REVISION MISMATCH' && /Revision differs/.test(rec.notes), 'revision mismatch noted');
rec = M.axReconcileOne(O('ZZ-404.pdf', '/Our'), cidx, 'test');
ok(rec.bridge === 'MISSING FROM CLIENT' && rec.client === null, 'missing verdict');
rec = M.axReconcileOne(O('TWIN.pdf', '/C'), cidx, 'test');
ok(rec.bridge === 'DUPLICATE', 'twin tie duplicates');

// 7. provenance rendering stays escaped
ok(M.axBridgePill('MISSING FROM CLIENT').indexOf('MISSING') >= 0, 'pill known');
ok(M.axBridgePill('<img src=x>').indexOf('<img') === -1, 'pill fallback escaped');
const provCalls = [...html.matchAll(/axProvRow\((\s*'[^']*'\s*,[^)]*)\)/g)].map((x) => x[1]);
const unsafe = provCalls.filter((args) => !/escHtml|ax[A-Z][a-zA-Z]*Pill|— none —|mono/.test(args) && /[a-zA-Z_$][\w$]*\.[a-zA-Z_$]/.test(args));
ok(unsafe.length === 0, 'all provenance values escaped or pill-built', unsafe.slice(0, 2).join(' // '));

// 8. drawing-name filter (rule) scoping
ok(M.nameFilterMatch('P0152-K00146-OCC-HT01-RL-AB-AC-000001') === true, 'no filter matches all');
ok(M.nameFilterMatch(null) === true && M.nameFilterMatch(undefined) === true, 'filter null-safe');
M.onNameFilterChange('-rl-ab');
ok(store['dv_name_filter'] === '-RL-AB', 'filter upper-cased + persisted');
ok(M.nameFilterMatch('P0152-K00146-OCC-HT01-RL-AB-AC-000001') === true, 'filter matches roof level drawing');
ok(M.nameFilterMatch('P0152-K00146-OCC-HT01-FL-AC-AC-000001') === false, 'filter rejects other level');
ok(M.nameFilterMatch('p0152-k00146-occ-ht01-rl-ab.dwg') === true, 'filter case-insensitive');
const scoped = M.axNameScope([
  F('A-RL-AB-0001.pdf', '/Our', 'pdf'),
  F('A-FL-0002.pdf', '/Our', 'pdf'),
  F('A-HT01-AR.rvt', '/M', 'rvt', { isDrawing: false, isRevitModel: true }),
]);
ok(scoped.length === 2 && scoped.some(function(f){ return f.isRevitModel; }) && !scoped.some(function(f){ return f.name === 'A-FL-0002.pdf'; }), 'audit scope keeps models, drops non-matching drawings', JSON.stringify(scoped.map(function(f){ return f.name; })));
M.onNameFilterChange('  ');
ok(M.nameFilterMatch('anything') === true && store['dv_name_filter'] === '', 'filter cleared + whitespace trimmed');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
