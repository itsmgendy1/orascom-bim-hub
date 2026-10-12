// Headless smoke test: executes real Hub views with stubbed DOM + Leaflet.
// Catches ReferenceErrors (undefined vars) that syntax checks cannot.
const fs = require('fs');

function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', files: [],
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, appendChild() {}, remove() {},
    click() {}, focus() {}, setSelectionRange() {},
    getAttribute() { return null; }, setAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; },
    getContext() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 10, height: 10 }; },
  };
}
const els = {};
global.document = {
  addEventListener() {},
  getElementById: (id) => (els[id] || (els[id] = makeEl())),
  createElement: () => makeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: makeEl(),
};
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.window = global;
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.location = { hash: '', href: 'http://localhost/hub.html', protocol: 'http:', origin: 'http://localhost' };
global.history = { replaceState() {} };
const _session = {};
global.sessionStorage = {
  getItem: (k) => (k in _session ? _session[k] : null),
  setItem: (k, v) => { _session[k] = String(v); },
  removeItem: (k) => { delete _session[k]; },
};
global.navigator = { userAgent: 'node' };
function leafletLayer() {
  return { addTo() { return this; }, bindTooltip() { return this; }, bindPopup() { return this; },
    on() { return this; }, off() { return this; }, getBounds() { return {}; }, setView() { return this; },
    fitBounds() { return this; }, removeLayer() {}, invalidateSize() {},
    doubleClickZoom: { disable() {}, enable() {} } };
}
global.L = {
  map: () => leafletLayer(), polygon: () => leafletLayer(),
  polyline: () => leafletLayer(), circleMarker: () => leafletLayer(),
  marker: () => leafletLayer(), tileLayer: () => leafletLayer(),
  layerGroup: () => leafletLayer(), divIcon: () => ({}),
};
global.fetch = () => Promise.reject(new Error('offline'));
global.alert = () => {};
global.confirm = () => false;

const HUB = 'assets/js/hub.js';
eval(fs.readFileSync('assets/js/site-plots.js', 'utf8'));
eval(fs.readFileSync('assets/js/ohub-auth.js', 'utf8'));
eval(fs.readFileSync(HUB, 'utf8'));

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('PASS -', name); }
  catch (e) { fail++; console.log('FAIL -', name, '::', e.constructor.name + ':', e.message); }
}

check('gis view renders (was: stageName ReferenceError)', () => {
  window.OHub.switchView('gis');
  const reg = els['gis-register'].innerHTML;
  if (!reg.includes('DP01') || !reg.includes('DP05')) throw new Error('register missing plots');
  const modes = els['gis-modes'].innerHTML;
  if (!modes.includes('Review Status')) throw new Error('mode buttons missing');
  const tbl = els['gis-table'].innerHTML;
  if (!tbl.includes('Design Package Information') && !tbl.includes('DP01')) throw new Error('table missing');
  // Library KPI figures wiped (owner request): DP01/DP05 rows stay, numbers gone.
  if (!tbl.includes('DP01') || !tbl.includes('DP05')) throw new Error('plot rows missing');
  ['738,216', '914,102', '278,415', '104,647', '2,933', '12,025'].forEach(function (fig) {
    if (tbl.includes(fig)) throw new Error('stale library figure in table: ' + fig);
  });
});
check('stages view renders', () => {
  window.OHub.switchView('stages');
  const h = els['stages-content'].innerHTML;
  if (!h.includes('Stage gates') && !h.includes('No project selected')) throw new Error('stages content missing');
});
check('projects view renders', () => {
  window.OHub.switchView('projects');
});
check('dashboard renders', () => {
  window.OHub.switchView('dashboard');
});
check('gis draw wiring (no points -> toast, cancel clean)', () => {
  window.OHub.switchView('gis');
  window.OHub.gisStartDraw();
  window.OHub.gisFinishDraw(); // <3 points: must refuse, not throw
  window.OHub.gisCancelDraw();
  const seg = els['gis-draw'].innerHTML;
  if (!seg.includes('Draw new zone')) throw new Error('draw button not restored');
});
check('plot link keeps custom boundary (link-only assign)', () => {
  var lib = window.SITE_PLOTS.filter(function (pl) { return pl.code === 'DP01'; })[0];
  var pure = { plotCode: 'DP01', boundary: { type: 'MultiPolygon', coordinates: [lib.rings] } };
  var kept = { plotCode: 'DP01', boundary: { type: 'MultiPolygon', coordinates: [[[[27.8, 31.2], [27.9, 31.2], [27.9, 31.3], [27.8, 31.2]]]] } };
  if (!window.OHub.plotBoundaryCustom) throw new Error('helper not exported');
  if (window.OHub.plotBoundaryCustom(pure) !== false) throw new Error('pure assignment flagged custom');
  if (window.OHub.plotBoundaryCustom(kept) !== true) throw new Error('kept drawn shape not detected');
  if (window.OHub.plotBoundaryCustom({ boundary: kept.boundary }) !== false) throw new Error('unlinked flagged');
  if (window.OHub.plotBoundaryCustom({ plotCode: 'DP99', boundary: kept.boundary }) !== true) throw new Error('retired plot not custom');
});
check('drawGeoJson closes ring in [lng,lat] order', () => {
  const src = fs.readFileSync('assets/js/hub.js', 'utf8');
  eval(src.slice(src.indexOf('function drawGeoJson'), src.indexOf('function gisFinishDraw')));
  const g = drawGeoJson([[31.1, 27.8], [31.2, 27.8], [31.2, 27.9]]);
  const ring = g.coordinates[0][0];
  const ok = g.type === 'MultiPolygon' && ring.length === 4 &&
    ring[0][0] === 27.8 && ring[0][1] === 31.1 &&
    JSON.stringify(ring[0]) === JSON.stringify(ring[3]);
  if (!ok) throw new Error('bad geometry: ' + JSON.stringify(g));
});
check('settings view renders incl. cloud sync', () => {
  window.OHub.switchView('settings');
  if (!els['cloud-url'].value.includes('workers.dev')) throw new Error('cloud url default missing');
  if (els['cloud-workspace'].value !== 'main') throw new Error('workspace default missing');
});
check('program view renders', () => {
  window.OHub.switchView('program');
  const h = els['program-content'].innerHTML;
  if (!h.includes('No project selected') && !h.includes('No packages yet') && !h.includes('kpi-card')) throw new Error('program content missing');
});
(async () => {
  try {
    if (window.OHubAuth.hasUsers()) throw new Error('expected fresh store');
    await window.OHubAuth.setup('tester', 's3cret-strong-12');
    if (!window.OHubAuth.hasUsers()) throw new Error('setup did not persist');
    if (await window.OHubAuth.login('tester', 'wrong')) throw new Error('wrong password accepted');
    if (!(await window.OHubAuth.login('tester', 's3cret-strong-12'))) throw new Error('valid login rejected');
    if (!window.OHubAuth.hasSession()) throw new Error('no session after login');
    window.OHubAuth.logout();
    if (window.OHubAuth.hasSession()) throw new Error('logout did not clear');
    console.log('PASS - auth setup/login/logout');
  } catch (e) { fail++; console.log('FAIL - auth ::', e.message); }
  process.exit(fail ? 1 : 0);
})();
