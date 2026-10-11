// Naming-convention segment suites, headless (no deps, runs in CI).
// Locks every pass/fail branch of the OCC segment validators.
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const MOD = path.join(ROOT, 'modules', 'naming-convention.html');

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
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
eval(scripts + '\n;module.exports={baseHygiene,validateFamilySeg,validateViewTemplateSeg,validateWorksetSeg,validateViewsSeg,validateDatumSeg,validateAnnotativeSeg,validateBrowserSeg,validateSheetsSeg,validateOccSegments};');
const M = module.exports;

// baseHygiene
ok(M.baseHygiene('OK-NAME') === null, 'hygiene clean');
ok(/Leading/.test(M.baseHygiene(' BAD') || ''), 'hygiene leading space');
ok(/trailing/i.test(M.baseHygiene('BAD ') || ''), 'hygiene trailing space');
ok(/Double space/.test(M.baseHygiene('A  B') || ''), 'hygiene double space');
ok(/Invalid separator/.test(M.baseHygiene('A_B') || ''), 'hygiene underscore');
ok(M.baseHygiene('AR - Walls') === null, 'hygiene DD-prefix underscore allowed');

// Family segments
let r = M.validateFamilySeg('OCC-WALLS-BASIC-DESCRIPTION');
ok(r.pass === true && r.segments.length === 4, 'family pass');
r = M.validateFamilySeg('XX-WALLS-BASIC-DESC');
ok(r.pass === false && /prefix/.test(r.reason), 'family missing OCC prefix');
r = M.validateFamilySeg('OCC-WALLS');
ok(r.pass === false && /segments/.test(r.reason), 'family too few segments');
r = M.validateFamilySeg('occ-walls-basic-desc');
ok(r.pass === false && /prefix|lowercase|UPPERCASE/.test(r.reason), 'family lowercase rejected');
r = M.validateFamilySeg('OCC-WALLS-BASIC-');
ok(r.pass === false && /empty/i.test(r.reason), 'family empty segment');
r = M.validateFamilySeg('OCC-WALLS-BASIC-DESC!');
ok(r.pass === false && /Invalid characters/.test(r.reason), 'family invalid char');
r = M.validateFamilySeg(' OCC-WALLS-BASIC-DESC');
ok(r.pass === false, 'family leading space fails hygiene');
r = M.validateFamilySeg('OCC-WALLS-BASIC-EXTRA-DESC');
ok(r.pass === true, 'family extra segments allowed');

// View template segments
r = M.validateViewTemplateSeg('OCC-VTE-FLOOR-PLAN');
ok(r.pass === true, 'vte pass');
r = M.validateViewTemplateSeg('OCC-VT-PLAN');
ok(r.pass === false && /VTE/.test(r.reason), 'vte wrong type code');
r = M.validateViewTemplateSeg('OCC-VTE-A/B');
ok(r.pass === false && /slash/i.test(r.reason), 'vte slash rejected');
r = M.validateViewTemplateSeg('OCC-VTE-plan');
ok(r.pass === false && /lowercase|UPPERCASE/.test(r.reason), 'vte lowercase rejected');
r = M.validateViewTemplateSeg('XX-VTE-PLAN');
ok(r.pass === false, 'vte missing prefix');

// Workset segments
r = M.validateWorksetSeg('ST - ST Framing');
ok(r.pass === true, 'workset pass');
r = M.validateWorksetSeg('st - ST Framing');
ok(r.pass === false, 'workset lowercase discipline');
r = M.validateWorksetSeg('ST Framing');
ok(r.pass === false && /separator/i.test(r.reason), 'workset separator');
r = M.validateWorksetSeg('XX - Something');
ok(r.pass === false && /discipline/i.test(r.reason), 'workset unknown discipline');
r = M.validateWorksetSeg('ST - ');
ok(r.pass === false, 'workset missing category');

// Views segments
r = M.validateViewsSeg('3D View - OCC-FLOOR-PLAN');
ok(r.pass === true, 'views 3d occ pass');
r = M.validateViewsSeg('3D View - My Plan');
ok(r.pass === false && /OCC-/.test(r.reason), 'views 3d missing occ');
r = M.validateViewsSeg('My Level {user}');
ok(r.pass === false && /personal/i.test(r.reason), 'views personal braces');
r = M.validateViewsSeg('Floor Plan Copy 2');
ok(r.pass === false && /Copy/i.test(r.reason), 'views copy suffix');
r = M.validateViewsSeg('Sections - lower level');
ok(r.pass === false && /UPPERCASE/.test(r.reason), 'views lowercase desc');
r = M.validateViewsSeg('OCC-KEYPLAN');
ok(r.pass === true, 'views occ pass');

// Datum segments
r = M.validateDatumSeg('OCC-SCB-01');
ok(r.pass === true, 'datum pass');
r = M.validateDatumSeg('Scope Boxes : Mine');
ok(r.pass === false && /Scope Boxes/.test(r.reason), 'datum scope boxes');
r = M.validateDatumSeg('Level 1');
ok(r.pass === false && /prefix/.test(r.reason), 'datum level missing prefix');
r = M.validateDatumSeg('GRID-A');
ok(r.pass === false && /prefix/.test(r.reason), 'datum grid missing prefix');
r = M.validateDatumSeg('OCC-SCB-01!');
ok(r.pass === false && /characters/i.test(r.reason), 'datum invalid char');

// Annotative segments
r = M.validateAnnotativeSeg('OCC-TEXT-NOTES');
ok(r.pass === true, 'annotative text pass');
r = M.validateAnnotativeSeg('OCC-DIMN-100');
ok(r.pass === true, 'annotative dimn pass');
r = M.validateAnnotativeSeg('ARC-TEXT-X');
ok(r.pass === false && /ARC-/.test(r.reason), 'annotative legacy arc');
r = M.validateAnnotativeSeg('OCC_TEXT-X');
ok(r.pass === false && /separator/.test(r.reason), 'annotative underscore');
r = M.validateAnnotativeSeg('OCC-TEXT-A.B');
ok(r.pass === false && /"\\."|hyphen/i.test(r.reason), 'annotative dot');
r = M.validateAnnotativeSeg('OCC-TEXT-1.5MM');
ok(r.pass === true, 'annotative decimal allowed');
r = M.validateAnnotativeSeg('OCC-LINES-X');
ok(r.pass === false && /TEXT/.test(r.reason), 'annotative wrong type');
r = M.validateAnnotativeSeg('OCC-text-x');
ok(r.pass === false && /UPPERCASE|pattern mismatch/i.test(r.reason), 'annotative lowercase');

// Browser segments
r = M.validateBrowserSeg('OCC-SHEETS-A101');
ok(r.pass === true, 'browser occ pass');
r = M.validateBrowserSeg('01 - Plans');
ok(r.pass === true, 'browser numbered pass');
r = M.validateBrowserSeg('Random Folder');
ok(r.pass === false && /prefix/.test(r.reason), 'browser missing prefix');

// Sheets segments
r = M.validateSheetsSeg('OCC-HT01-AR-PLAN');
ok(r.pass === true, 'sheets pass');
r = M.validateSheetsSeg('HT01-AR-PLAN');
ok(r.pass === false && /prefix/.test(r.reason), 'sheets missing prefix');
r = M.validateSheetsSeg('OCC-HT01');
ok(r.pass === false && /segments/i.test(r.reason), 'sheets too few');
r = M.validateSheetsSeg('OCC-toolongcode-AR-X');
ok(r.pass === false && /building/i.test(r.reason), 'sheets bad building');

// Schedule dispatcher (PNG schedules)
r = M.validateOccSegments('x', 'OCC-HT01-ST-ST-FRAMING', { fieldLabel: 'Schedule Name' });
ok(r.pass === true, 'schedule 4seg pass');
r = M.validateOccSegments('x', 'OCC-HT01-SUB-AR-WALLS', { fieldLabel: 'Schedule Name' });
ok(r.pass === true, 'schedule 5seg pass');
r = M.validateOccSegments('x', 'OCC-HT01-ST', { fieldLabel: 'Schedule Name' });
ok(r.pass === false && /segments/i.test(r.reason), 'schedule too few');
r = M.validateOccSegments('x', 'OCC-HT01-ST-X-Y-Z', { fieldLabel: 'Schedule Name' });
ok(r.pass === false && /segments/i.test(r.reason), 'schedule too many');
r = M.validateOccSegments('x', 'XX-ST-X', { fieldLabel: 'Schedule Name' });
ok(r.pass === false && /prefix/.test(r.reason), 'schedule missing prefix');

// Section dispatcher routing
ok(M.validateOccSegments('arch', 'OCC-WALLS-BASIC-D').pass === true, 'dispatch arch');
ok(M.validateOccSegments('viewtemplates', 'OCC-VTE-X').pass === true, 'dispatch vte');
ok(M.validateOccSegments('views', 'OCC-KEYPLAN').pass === true, 'dispatch views');
ok(M.validateOccSegments('datum', 'OCC-SCB-01').pass === true, 'dispatch datum');
ok(M.validateOccSegments('annotative', 'OCC-TEXT-X').pass === true, 'dispatch annotative');
ok(M.validateOccSegments('browser', 'OCC-X').pass === true, 'dispatch browser');
ok(M.validateOccSegments('sheets', 'OCC-HT01-AR-X').pass === true, 'dispatch sheets');
ok(M.validateOccSegments('unknown', 'OCC-WALLS-BASIC-D').pass === true, 'dispatch default family');
ok(M.validateOccSegments('sheets', 'OCC-X', { fieldLabel: 'Workset Name' }).pass === false, 'dispatch workset label');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
