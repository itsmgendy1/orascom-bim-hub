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
eval(scripts + '\n;module.exports={baseHygiene,validateFamilySeg,validateViewTemplateSeg,validateWorksetSeg};');
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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
