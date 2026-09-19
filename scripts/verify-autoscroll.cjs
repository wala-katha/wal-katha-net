'use strict';
/* v12 verifier: real code, stub DOM. Proves boot, the time-budgeted write
   engine, stop, and - the key one - that teardown()/boot() can cycle
   without a strict-mode ReferenceError. */
const vm = require('vm');
const fs = require('fs');
const target = process.argv[2];
let FAILS = 0, writes = 0, t0 = Date.parse('2026-09-19T10:00:00Z');
Date.now = () => (t0 += 3);
function node(tag) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(), nodeType: 1, children: [], _a: {}, _L: {},
    style: { setProperty() {}, transform: '' },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this._a[k] = String(v); }, removeAttribute(k) { delete this._a[k]; }, getAttribute(k) { return this._a[k]; },
    addEventListener(t, f, o) { (this._L[t] = this._L[t] || []).push({ f: f, o: o }); },
    removeEventListener() {}, appendChild(c) { this.children.push(c); return c; }, remove() {}, focus() {}, blur() {},
    contains() { return false; }, getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    offsetParent: {}, disabled: false, _text: '', _html: '',
    set textContent(v) { this._text = v == null ? '' : String(v); }, get textContent() { return this._text; },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
  };
  n.querySelector = (s) => (String(s).indexOf('rt-stop-pct') >= 0 ? node('span') : null);
  n.querySelectorAll = () => [];
  return n;
}
const docEl = node('html'); docEl.scrollHeight = 20000;
const body = node('body'); const head = node('head');
const art = node('div'); art._text = 'x'.repeat(600);
const document = {
  documentElement: docEl, body: body, head: head, readyState: 'complete', visibilityState: 'visible', activeElement: null,
  createElement: node, createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  getElementById: () => null,
  querySelector: (s) => (s === '.custom-post-content' ? art : null),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, contains() { return true; },
};
const store = {};
const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const win = {
  scrollY: 0, innerHeight: 800, matchMedia: () => ({ matches: false }),
  scrollTo(o, y) { writes++; win.scrollY = typeof o === 'object' ? o.top : y; },
  addEventListener() {}, removeEventListener() {}, localStorage: localStorage,
  location: { pathname: '/post/x', href: 'https://walakatha.net/post/x' }, document: document,
};
let rafQ = [], rafId = 0; const cancelled = new Set(), live = new Map();
const requestAnimationFrame = (fn) => { const id = ++rafId; live.set(id, fn); return id; };
const cancelAnimationFrame = (id) => { cancelled.add(id); };
function pump(frames, step) { let ts = 0; for (let i = 0; i < frames; i++) { ts += step; const ids = Array.from(live.keys()); const q = ids.map((id) => [id, live.get(id)]); q.forEach(([id, fn]) => { if (cancelled.has(id)) return; live.delete(id); fn(ts); }); } }
global.window = win; global.document = document; global.localStorage = localStorage;
global.location = win.location;
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'node' }, configurable: true }); } catch (e) {}
global.requestAnimationFrame = requestAnimationFrame; global.cancelAnimationFrame = cancelAnimationFrame;
global.SpeechSynthesisUtterance = function () {};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.window.requestAnimationFrame = requestAnimationFrame; global.window.cancelAnimationFrame = cancelAnimationFrame;
vm.runInThisContext(fs.readFileSync(target, 'utf8'), { filename: target });
const RT = win.ReaderTools;
const ok = (b, m) => { if (!b) { FAILS++; console.log('  FAIL  ' + m); } else console.log('  ok    ' + m); };
console.log('--- 1. boot ---');
ok(!!RT, 'window.ReaderTools exposed');
ok(RT && RT.version === 13, 'version = ' + (RT && RT.version) + ' (expect 13)');
ok(RT && RT.tools.length === 5, 'tools = [' + (RT ? RT.tools.join(',') : '') + ']');
ok(RT && RT.article !== null, 'article found (stub .custom-post-content)');
console.log('--- 2. auto-scroll: time budget ~18 writes/s (speed 4 = 42 px/s) ---');
writes = 0; win.scrollY = 0;
RT.startAutoScroll();
ok(RT.scrolling === true, 'scrolling = true after start');
pump(80, 16);            // 1280 ms of synthetic frame time
const px = win.scrollY;
ok(writes >= 15 && writes <= 26, 'scroll writes over 1280 ms = ' + writes + ' (expect 15-26; old v7 = 76)');
ok(px >= 40 && px <= 70, 'px advanced = ' + px.toFixed(1) + ' (expect 40-70 for 42 px/s * 1.28 s)');
ok(store['wk:reader:pos:/post/x'] === undefined, 'localStorage NOT written while running');
console.log('--- 3. stop ---');
RT.stopAutoScroll();
ok(RT.scrolling === false, 'scrolling = false after stop');
ok(store['wk:reader:pos:/post/x'] !== undefined, 'position saved on stop (' + store['wk:reader:pos:/post/x'] + ')');
console.log('--- 4. teardown/boot cycle (the strict-mode ReferenceError check) ---');
try {
  RT.teardown(); RT.boot(); RT.teardown(); RT.boot();
  ok(true, 'teardown() -> boot() -> teardown() -> boot() completed with NO exception');
} catch (e) { ok(false, 'strict-mode failure: ' + e.name + ': ' + e.message); }
console.log('--- 5. stop pill markup the redesign depends on ---');
const html = (function walk(n, out) { if (!n || !n.children) return out; n.children.forEach((c) => { out.push(c._html || ''); walk(c, out); }); return out; })(body, []).join('');
ok(html.indexOf('rt-stopfab-badge') >= 0, 'badge element present in pill markup');
ok(html.indexOf('rt-stopfab-pct') >= 0, 'live % chip present in pill markup');
ok(html.indexOf('නවත්වන්න') >= 0, 'Sinhala label present in pill markup');
console.log('=== ' + (FAILS === 0 ? 'ALL CHECKS PASSED' : FAILS + ' CHECK(S) FAILED') + ' ===');
process.exit(FAILS === 0 ? 0 : 1);
