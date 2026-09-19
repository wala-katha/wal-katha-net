/* wal-katha-net reader-tools / auto-scroll PROOF HARNESS
   Runs the REAL site component (src/layouts/components/reader-tools.js) in
   Node against a fake DOM and fake timers, then measures:
     - how many window.scrollY reads the rAF loop performs per frame
     - how many scroll writes it performs per frame
     - whether localStorage is touched while the loop runs
     - whether the interval watchdog stops a wedged loop
     - whether the stop pill got all its event bindings
   Usage, from the repo root:
     node scripts/verify-autoscroll.cjs src/layouts/components/reader-tools.js
   Exit code: 0 = every check passed, 1 = at least one check failed, 2 = file missing.
*/
'use strict';
const path = require('path');

let NOW = 1000000;
let scrollYReads = 0, writes = 0, storeWrites = 0, pxTotal = 0;
let _y = 0;
const DOC_H = 200000;
const VIEW_H = 800;
const MAXY = DOC_H - VIEW_H;

/* ---------------- fake timers ---------------- */
let tid = 0, sid = 0;
const intervals = new Map();
const timeouts = new Map();
Date.now = () => NOW;
global.setInterval = (fn, ms) => { const id = ++tid; intervals.set(id, { fn, ms, next: NOW + ms }); return id; };
global.clearInterval = (id) => intervals.delete(id);
global.setTimeout = (fn, ms) => { const id = ++sid; timeouts.set(id, { fn, at: NOW + ms }); return id; };
global.clearTimeout = (id) => timeouts.delete(id);
function fireTimers(atMs) {
  NOW = atMs;
  for (const [, t] of [...intervals]) if (NOW >= t.next) { t.next = NOW + t.ms; try { t.fn(); } catch (e) { console.log('timer err', e.message); } }
  for (const [id, t] of [...timeouts]) if (NOW >= t.at) { timeouts.delete(id); try { t.fn(); } catch (e) { console.log('timeout err', e.message); } }
}

/* ---------------- fake rAF ---------------- */
let rafId = 0;
const rafMap = new Map();
function runFrame(ts) {
  const q = [...rafMap.values()];
  rafMap.clear();
  q.forEach((f) => { try { f(ts); } catch (e) { console.log('raf err', e.message); } });
}

/* ---------------- fake DOM ---------------- */
function mkEl(tag) {
  const L = {};
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [], attrs: {}, style: { setProperty() {} },
    _text: '', _html: '', hidden: false, offsetParent: {}, _L: L,
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toString() { return [...this._s].join(' '); },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    contains(n) { if (n === this) return true; return this.children.some((c) => c.contains && c.contains(n)); },
    addEventListener(t, f, o) { (L[t] = L[t] || []).push({ f, o }); },
    removeEventListener(t, f) { if (L[t]) L[t] = L[t].filter((x) => x.f !== f); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() { document.activeElement = el; },
    blur() {},
    getBoundingClientRect() { scrollYReads += 1000; return { top: 0, left: 0, width: 0, height: 0 }; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
  };
  Object.defineProperty(el, 'className', {
    get() { return [...el.classList._s].join(' '); },
    set(v) { el.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  return el;
}
const docEl = mkEl('html'); docEl.scrollHeight = DOC_H;
const body = mkEl('body');
const head = mkEl('head');
const article = mkEl('div'); article._text = 'A'.repeat(1500);
const byId = {};
const docL = {};
const document = {
  documentElement: docEl, body, head, activeElement: null,
  readyState: 'complete', visibilityState: 'visible',
  createElement: mkEl,
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  getElementById: (id) => byId[id] || null,
  querySelector: (s) => (s === '[data-rt-article]' ? article : null),
  querySelectorAll: () => [],
  addEventListener: (t, f, o) => { (docL[t] = docL[t] || []).push({ f, o }); },
  removeEventListener: () => {},
  contains: () => true,
  dispatch: (t, ev) => (docL[t] || []).slice().forEach((x) => x.f(ev)),
};
const winL = {};
const window = {
  __wkReaderToolsInit: false,
  innerHeight: VIEW_H, innerWidth: 400, devicePixelRatio: 2,
  get scrollY() { scrollYReads++; return _y; },
  scrollTo(a, b) { writes++; const d = typeof a === 'object' ? (a.top - _y) : (b - _y); pxTotal += d; _y = Math.max(0, Math.min(MAXY, _y + d)); },
  scrollBy(a, b) { writes++; const d = typeof a === 'object' ? a.top : b; pxTotal += d; _y = Math.max(0, Math.min(MAXY, _y + d)); },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener: (t, f, o) => { (winL[t] = winL[t] || []).push({ f, o }); },
  removeEventListener: () => {},
  requestAnimationFrame: (f) => { rafId++; rafMap.set(rafId, f); return rafId; },
  cancelAnimationFrame: (id) => rafMap.delete(id),
  open() {},
  location: { href: 'https://walakatha.net/blog/x/', pathname: '/blog/x/' },
};

global.window = window;
global.document = document;
global.location = window.location;
global.localStorage = { getItem: () => null, setItem: () => { storeWrites++; }, removeItem: () => {} };
global.sessionStorage = global.localStorage;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-harness' }, configurable: true, writable: true }); } catch (e) {}
global.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
global.MutationObserver = class { observe(){} disconnect(){} takeRecords(){return [];} };
global.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
const history = { pushState: () => {}, replaceState: () => {}, state: null };
global.history = history;
window.history = history;


global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = window.cancelAnimationFrame;
global.getComputedStyle = () => ({ getPropertyValue: () => '', transition: '' });
global.matchMedia = window.matchMedia;
global.scrollTo = window.scrollTo;

/* ---------------- load the real component ----------------
   The repo's package.json is "type": "module" while this harness is
   CommonJS, so a bare require() of the site .js path leans on Node's ESM
   interop and on the Node major version (a probe here died inside the
   module on `window is not defined`, i.e. it never reached the stubs).
   Instead the source is read and evaluated in this context: any path or
   extension works, and the file's own IIFE + 'use strict' stay intact. */
const fs = require('fs');
const vm = require('vm');
const file = path.resolve(process.argv[2] || 'src/layouts/components/reader-tools.js');
if (!fs.existsSync(file)) {
  console.log('LOAD: FAIL - file not found: ' + file);
  process.exit(2);
}
vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
const RT = window.ReaderTools;
let FAILS = 0;
const ok = (b) => { if (!b) FAILS++; return b ? 'PASS' : 'FAIL'; };
if (!RT) {
  console.log('BOOT: *** FAIL *** window.ReaderTools missing');
  process.exit(1);
}
console.log('BOOT: PASS  ReaderTools.version = ' + RT.version + '  tools=[' + RT.tools.join(',') + ']');
console.log('stop-pill bindings: ' + ['pointerdown', 'touchstart', 'touchend', 'pointerup', 'click']
  .map((t) => t + '=' + ((docL[t] || winL[t]) ? '' : '') + '..').join(' '));

/* baseline reads during boot */
const readsAfterBoot = scrollYReads;
storeWrites = 0;

/* ---------------- start auto-scroll and drive 600 frames ---------------- */
RT.startAutoScroll();
const running0 = RT.scrolling;
const readsAtStart = scrollYReads, writesAtStart = writes;
let t = 0;
for (let i = 0; i < 600; i++) { t += 16; runFrame(t); fireTimers(NOW + 16); NOW += 16; }
const writesLoop = writes - writesAtStart;
const readsLoop = scrollYReads - readsAtStart;
const readsPerFrame = readsLoop / 600;
console.log('--- 600 frames (9.6 s) at speed 4 (45 px/s) = 432 px ---');
console.log('scroll writes / 600 frames    : ' + writesLoop + '   (old v7 = 431 = one per frame; 432px / 3px throttle = ~144)  ' + ok(writesLoop <= 180));
console.log('window.scrollY reads / frame  : ' + readsPerFrame.toFixed(3) + '   (1.000 = ideal; old v7 = 1.718 = a second read after every write)  ' + ok(readsPerFrame < 1.3));
console.log('localStorage writes in loop   : ' + storeWrites + '   (must be 0 while running; sync I/O per frame was a stall source)  ' + ok(storeWrites === 0));
console.log('px advanced / 432 expected    : ' + pxTotal.toFixed(1) + '   ' + ok(Math.abs(pxTotal - 432) < 15));
console.log('still running after 9.6 s     : ' + running0 + ' -> ' + RT.scrolling + '   ' + ok(RT.scrolling === true));
console.log('scrollY reads during boot     : ' + readsAfterBoot);

/* ---------------- wedge test: stop the clock, keep firing the interval ---------------- */
const writesBeforeWedge = writes;
console.log('--- wedge test: rAF never runs again, only the watchdog interval ---');
console.log('watchdog interval registered : ' + (intervals.size >= 1 ? 'yes (' + intervals.size + ' interval(s))' : '*** NO ***'));
for (let i = 1; i <= 8 && RT.scrolling; i++) {
  NOW += 600; fireTimers(NOW);
  console.log('  tick ' + i + ' (+' + (i * 600) + ' ms)  running=' + RT.scrolling + '  writes=' + (writes - writesBeforeWedge));
}
console.log('watchdog verdict             : ' + (RT.scrolling ? 'still running' : 'loop was stopped by the watchdog') + '   ' + ok(RT.scrolling === false));

/* ---------------- restart, then prove the pill binding stops it ---------------- */
RT.startAutoScroll();
const st = ['started=' + RT.scrolling];
for (let i = 0; i < 30; i++) { t += 16; runFrame(t); NOW += 16; }
const stopEl = (function find(node) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (c.classList && c.classList.contains('rt-stopfab')) return c;
    const r = find(c); if (r) return r;
  }
  return null;
})(docEl) || (function find(node) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (c.classList && c.classList.contains('rt-stopfab')) return c;
    const r = find(c); if (r) return r;
  }
  return null;
})(body);
if (stopEl) {
  const kinds = Object.keys(stopEl._L);
  console.log('stop pill element found: class=rt-stopfab  listeners=[' + kinds.join(',') + ']');
  console.log('pill has pointerdown     : ' + ok(kinds.indexOf('pointerdown') >= 0));
  console.log('pill has touchstart      : ' + ok(kinds.indexOf('touchstart') >= 0));
  stopEl._L.pointerdown[0].f({ cancelable: true, preventDefault() {}, stopPropagation() {} });
  console.log('after pointerdown on pill: running=' + RT.scrolling + '  ' + ok(RT.scrolling === false));
} else {
  console.log('stop pill element: *** NOT FOUND in fake DOM tree ***');
}

/* ---------------- any-tap-stops: document-level capture listener ---------------- */
RT.startAutoScroll();
for (let i = 0; i < 60; i++) { t += 16; runFrame(t); NOW += 16; fireTimers(NOW); }
console.log('any-tap test: running before tap = ' + RT.scrolling + '  (arm window 420 ms; 60 frames + timers = 960 ms elapsed)');
const isCap = (o) => o === true || (o && o.capture === true);
const cap = (winL.pointerdown || []).filter((x) => isCap(x.o)).length;
console.log('window pointerdown capture listeners: ' + cap + '  ' + ok(cap >= 1));
if (cap) {
  winL.pointerdown.filter((x) => isCap(x.o))[0].f({ target: article });
  console.log('after any-tap (article target)   : running=' + RT.scrolling + '  ' + ok(RT.scrolling === false));
}
if (intervals.size > 0) console.log('NOTE: ' + intervals.size + ' interval(s) still registered at end of run.');
console.log('RESULT: ' + (FAILS === 0 ? 'ALL CHECKS PASSED' : FAILS + ' CHECK(S) FAILED'));
process.exit(FAILS === 0 ? 0 : 1);

