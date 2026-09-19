// ==========================================================================
// Reader Tools - logic only. Chrome + themes live in reader-tools.css
// --------------------------------------------------------------------------
// v13:
//  - reading tab: focus-mode toggle and pause button removed
//  - reading tab: red reset button appears only when speed differs from default
//  - reading tab: all small texts rewritten in natural spoken Sinhala
//  - resume button no longer stretches vertically (wrapped in a row)
//
// Do not add a second auto-scroll script: two rAF loops freeze low-end phones.
//
// Extra tool (no edit to this file needed):
//   ReaderTools.register({ id, label, icon, order, mount(box, ctx) {} });
// ==========================================================================
(() => {
  'use strict';

  if (window.__wkReaderToolsInit) return;
  window.__wkReaderToolsInit = true;

  const STORE_KEY = 'wk:reader:v1';
  const posKey = (p) => 'wk:reader:pos:' + p;

  const ARTICLE_CANDIDATES = [
    '[data-rt-article]',
    '.custom-post-content',
    '#main-content article .content',
    '#main-content .content',
    '#main-content article',
    'main article',
  ];

  const HEADING_SEL = 'h2, h3, h4';
  const BLOCK_SEL = 'p, li, h2, h3, h4, blockquote';
  const MIN_ARTICLE_CHARS = 400;
  const WORDS_PER_MIN = 160;
  const TTS_CHUNK = 170;
  const POS_SAVE_MS = 1500;
  const STORE_DEBOUNCE_MS = 300;
  const MAX_CACHE_MS = 400;

  // auto-scroll tuning
  const AUTO_PPS = [12, 20, 30, 42, 58, 78, 100, 124, 150, 178];
  const AUTO_ARM_MS = 420;
  const AUTO_DRIFT = 120;
  const AUTO_MAX_DT = 64;
  const STALL_FRAMES = 45;
  const AUTO_STYLE_ID = 'wk-rt-auto-style';
  const RESET_STYLE_ID = 'wk-rt-reset-style';

  // watchdog: stops the engine if the rAF loop dies silently
  const AUTO_WATCHDOG_MS = 1500;
  const AUTO_WD_POLL_MS = 400;
  const AUTO_WRITE_EPS = 0.5;
  const AUTO_MIN_WRITE_PX = 2;
  // write budget: count scroll writes per second, not pixels (~18/s max)
  const AUTO_WRITE_MS = 55;
  const AUTO_JANK_MS = 50;
  const AUTO_GOV_MIN = 0.4;
  const AUTO_GOV_UP = 0.02;

  const DEFAULTS = {
    page: 'dark',
    font: 'sinhala',
    fontScale: 1,
    lineHeight: 1.85,
    letter: 0,
    measure: 'normal',
    rate: 1,
    pitch: 1,
    voiceURI: '',
    scrollSpeed: 4,
  };

  const LIMITS = {
    fontScale: [0.85, 1.6, 0.05],
    lineHeight: [1.4, 2.4, 0.05],
    letter: [-0.01, 0.06, 0.005],
    rate: [0.6, 1.6, 0.05],
    pitch: [0.6, 1.4, 0.05],
    scrollSpeed: [1, 10, 1],
  };

  const ENUMS = {
    page: ['dark', 'paper', 'sepia', 'contrast'],
    font: ['sinhala', 'serif', 'system'],
    measure: ['narrow', 'normal', 'wide'],
  };

  // ---------------------------------------------------------------- helpers

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const round = (n, step) => Math.round(n / step) * step;

  const reduceMotion = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isMobile = () => !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
  const behavior = () => (reduceMotion() ? 'auto' : 'smooth');

  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'text') n.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          n.addEventListener(k.slice(2).toLowerCase(), v);
        } else n.setAttribute(k, String(v));
      });
    }
    if (kids) {
      (Array.isArray(kids) ? kids : [kids]).forEach((c) => {
        if (c === null || c === undefined || c === false) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  // one rAF per frame; all scroll consumers share one handler
  function rafOnce(fn) {
    let queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn();
      });
    };
  }

  // scrollHeight read = forced layout; cached for 400ms
  let maxCache = -1;
  let maxCacheAt = 0;
  function scrollMax(force) {
    const now = Date.now();
    if (force || maxCache < 0 || now - maxCacheAt > MAX_CACHE_MS) {
      maxCacheAt = now;
      maxCache = document.documentElement.scrollHeight - window.innerHeight;
    }
    return maxCache;
  }

  // tracked listeners: teardown removes every one of them
  const bound = [];
  function listen(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    bound.push([target, type, fn, opts]);
  }
  function unlistenAll() {
    while (bound.length) {
      const b = bound.pop();
      try {
        b[0].removeEventListener(b[1], b[2], b[3]);
      } catch (e) {}
    }
  }

  // ---------------------------------------------------------------- storage

  function sanitize(raw) {
    const s = Object.assign({}, DEFAULTS, raw || {});
    Object.keys(ENUMS).forEach((k) => {
      if (ENUMS[k].indexOf(s[k]) < 0) s[k] = DEFAULTS[k];
    });
    Object.keys(LIMITS).forEach((k) => {
      const l = LIMITS[k];
      s[k] = clamp(isNum(s[k]) ? s[k] : DEFAULTS[k], l[0], l[1]);
    });
    // legacy key from the removed focus mode
    delete s.focus;
    s.voiceURI = typeof s.voiceURI === 'string' ? s.voiceURI : '';
    return s;
  }

  function load() {
    try {
      return sanitize(JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
    } catch (e) {
      return sanitize(null);
    }
  }

  const state = load();

  let storeTimer = null;
  function save() {
    if (storeTimer) clearTimeout(storeTimer);
    storeTimer = setTimeout(() => {
      storeTimer = null;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
      } catch (e) {}
    }, STORE_DEBOUNCE_MS);
  }
  function saveNow() {
    if (storeTimer) {
      clearTimeout(storeTimer);
      storeTimer = null;
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  // ------------------------------------------------------------------- bus

  const bus = {};
  function on(evt, fn) {
    (bus[evt] = bus[evt] || []).push(fn);
    return () => {
      bus[evt] = (bus[evt] || []).filter((f) => f !== fn);
    };
  }
  function emit(evt, data) {
    (bus[evt] || []).slice().forEach((fn) => {
      try {
        fn(data);
      } catch (e) {
        console.warn('[reader-tools] listener', e);
      }
    });
  }

  // ----------------------------------------------------------------- icons

  const ICON = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>',
    voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 14.6-5.9"/><path d="M19 3v4.5h-4.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // ------------------------------------------------- injected auto-scroll css
  // Also lives here (not only in the css file) so a renamed class or a cached
  // old css build can never make the red stop pill invisible.
  function ensureAutoStyle() {
    if (!document.head || document.getElementById(AUTO_STYLE_ID)) return;
    const css =
      'html[data-rt-scrolling="1"],html[data-rt-scrolling="1"] body{' +
      'scroll-behavior:auto !important;}' +
      '.rt-root .rt-stopfab{display:none;position:fixed;left:50%;' +
      'bottom:calc(1.35rem + env(safe-area-inset-bottom));' +
      'transform:translateX(-50%) translateZ(0);z-index:9750;' +
      'align-items:center;gap:9px;margin:0;padding:6px 15px 6px 6px;' +
      'border:1px solid rgba(248,113,113,.5);border-radius:999px;' +
      'background:#7f1d1d;color:#fff;font-family:inherit;font-size:12.5px;' +
      'font-weight:800;line-height:1;white-space:nowrap;cursor:pointer;' +
      'pointer-events:auto;-webkit-tap-highlight-color:transparent;' +
      'box-shadow:0 10px 26px rgba(0,0,0,.55);}' +
      '.rt-root[data-scrolling="1"] .rt-stopfab,' +
      '.rt-root[data-autoscroll="1"] .rt-stopfab,' +
      '.rt-root .rt-stopfab[data-on="1"]{display:inline-flex !important;}' +
      '.rt-root[data-scrolling="1"] .rt-fab,' +
      '.rt-root[data-autoscroll="1"] .rt-fab{opacity:0 !important;' +
      'pointer-events:none !important;visibility:hidden !important;}' +
      '.rt-root .rt-stopfab-badge{display:grid;place-items:center;width:28px;' +
      'height:28px;flex:0 0 auto;border-radius:999px;background:#fff;color:#b91c1c;}' +
      '.rt-root .rt-stopfab-badge svg{display:block;width:13px;height:13px;}' +
      '.rt-root .rt-stopfab-pct{min-width:36px;padding:3px 7px;border-radius:999px;' +
      'background:rgba(255,255,255,.14);font-size:10.5px;text-align:center;' +
      'font-variant-numeric:tabular-nums;}' +
      '.rt-root .rt-stopfab:active{transform:translateX(-50%) translateZ(0) scale(.95);}' +
      '@media (max-width:640px){.rt-root .rt-stopfab{' +
      'bottom:calc(4.9rem + env(safe-area-inset-bottom));padding:6px 14px 6px 6px;' +
      'font-size:12px;}.rt-root .rt-stopfab-pct{display:none;}}' +
      '@media (max-width:380px){.rt-root .rt-stopfab-txt{display:none;}}' +
      '@media print{.rt-root .rt-stopfab{display:none !important;}}';
    const s = document.createElement('style');
    s.id = AUTO_STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  // Red "reset speed" button. The wrapper collapses with grid-template-rows so
  // showing/hiding it never makes the panel jump; hidden state uses
  // visibility:hidden so it cannot be focused or tapped.
  function ensureResetStyle() {
    if (!document.head || document.getElementById(RESET_STYLE_ID)) return;
    const css =
      '.rt-root .rt-reset-wrap{display:grid;grid-template-rows:0fr;opacity:0;' +
      'visibility:hidden;margin-top:-14px;' +
      'transition:grid-template-rows .3s ease,opacity .25s ease,margin .3s ease,' +
      'visibility 0s linear .3s;}' +
      '.rt-root .rt-reset-wrap[data-show="1"]{grid-template-rows:1fr;opacity:1;' +
      'visibility:visible;margin-top:0;' +
      'transition:grid-template-rows .3s ease,opacity .25s ease,margin .3s ease,' +
      'visibility 0s;}' +
      '.rt-root .rt-reset-inner{min-height:0;overflow:hidden;}' +
      '.rt-root .rt-reset-btn{display:flex;align-items:center;justify-content:center;' +
      'gap:8px;width:100%;padding:10px 14px;border:1px solid rgba(248,113,113,.55);' +
      'border-radius:12px;background:rgba(239,68,68,.14);color:#f87171;' +
      'font:inherit;font-size:12px;font-weight:800;line-height:1.2;cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent;' +
      'transition:background-color .18s ease,border-color .18s ease,color .18s ease,' +
      'transform .12s ease;}' +
      '.rt-root .rt-reset-wrap[data-show="1"] .rt-reset-btn{' +
      'animation:wk-rt-reset-pop .35s cubic-bezier(.34,1.56,.64,1);}' +
      '.rt-root .rt-reset-btn:hover,.rt-root .rt-reset-btn:focus-visible{' +
      'background:#dc2626;border-color:#dc2626;color:#fff;outline:none;}' +
      '.rt-root .rt-reset-btn:active{transform:scale(.97);}' +
      '.rt-root .rt-reset-btn svg{display:block;width:15px;height:15px;flex:0 0 auto;' +
      'transition:transform .45s ease;}' +
      '.rt-root .rt-reset-btn:hover svg{transform:rotate(-360deg);}' +
      '.rt-root .rt-reset-tag{padding:2px 8px;border-radius:999px;' +
      'background:rgba(248,113,113,.18);font-size:10px;font-weight:700;' +
      'font-variant-numeric:tabular-nums;}' +
      '.rt-root .rt-reset-btn:hover .rt-reset-tag,' +
      '.rt-root .rt-reset-btn:focus-visible .rt-reset-tag{background:rgba(255,255,255,.22);}' +
      '@keyframes wk-rt-reset-pop{0%{transform:scale(.92);}100%{transform:scale(1);}}' +
      '@media (prefers-reduced-motion:reduce){.rt-root .rt-reset-wrap,' +
      '.rt-root .rt-reset-btn,.rt-root .rt-reset-btn svg{transition:none !important;' +
      'animation:none !important;}}';
    const s = document.createElement('style');
    s.id = RESET_STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  // --------------------------------------------------------------- elements

  const ui = {
    root: null, bar: null, fab: null, stop: null, stopPct: null, scrim: null, panel: null,
    tabs: null, body: null, sub: null, close: null,
  };

  let article = null;
  let isOpen = false;
  let activeTab = null;
  let cleanupTab = null;
  let lastFocus = null;
  let pctEl = null;
  let curPath = typeof location !== 'undefined' ? location.pathname : '/';

  // ------------------------------------------------------------ build chrome

  function ensureRoot() {
    const found = $$('[data-rt-root], .rt-root');
    if (!found.length) {
      const r = el('div', { class: 'rt-root', 'data-rt-root': '' });
      document.body.appendChild(r);
      return r;
    }
    for (let i = 1; i < found.length; i++) {
      try { found[i].remove(); } catch (e) {}
    }
    const root = found[0];
    root.classList.add('rt-root');
    root.setAttribute('data-rt-root', '');
    return root;
  }

  function buildChrome() {
    if (!document.body) return false;
    const root = ensureRoot();
    root.textContent = '';
    root.setAttribute('data-open', '0');
    root.setAttribute('data-rt-ready', '0');
    root.removeAttribute('data-scrolling');
    root.removeAttribute('data-autoscroll');
    // escape the global copy-protection selectstart blocker
    root.setAttribute('data-allow-select', '');

    const bar = el('i');
    const progress = el('div', { class: 'rt-progress', 'aria-hidden': 'true' }, bar);

    const fab = el('button', {
      class: 'rt-fab',
      type: 'button',
      id: 'rt-fab',
      'aria-controls': 'rt-panel',
      'aria-expanded': 'false',
      'aria-label': 'කියවීමේ මෙවලම්',
      title: 'කියවීමේ මෙවලම් (Alt+R)',
    }, [
      el('span', { class: 'rt-fab-ico', html: ICON.type, 'aria-hidden': 'true' }),
      el('span', { class: 'rt-fab-txt', text: 'මෙවලම්' }),
    ]);

    // red stop pill: visible only while auto-scroll runs
    const stopFab = el('button', {
      class: 'rt-stopfab',
      type: 'button',
      'data-on': '0',
      'aria-label': 'ස්වයං-අනුචලනය නවත්වන්න',
      title: 'නවත්වන්න (Esc)',
      html:
        '<span class="rt-stopfab-badge" aria-hidden="true">' + ICON.stop + '</span>' +
        '<span class="rt-stopfab-txt">නවත්වන්න</span>' +
        '<span class="rt-stopfab-pct" data-rt-stop-pct>0%</span>',
    });

    const scrim = el('div', { class: 'rt-scrim', 'data-rt-scrim': '', 'aria-hidden': 'true' });

    const sub = el('span', { class: 'rt-sub', 'data-rt-sub': '' });
    const closeBtn = el('button', {
      class: 'rt-iconbtn rt-close',
      type: 'button',
      'aria-label': 'වසන්න',
      html: ICON.close,
    });
    const head = el('div', { class: 'rt-head' }, [
      el('span', { class: 'rt-head-dot', 'aria-hidden': 'true' }),
      el('span', { class: 'rt-head-txt' }, [
        el('span', { class: 'rt-title', text: 'කියවීමේ මෙවලම්' }),
        sub,
      ]),
      closeBtn,
    ]);

    const tabs = el('div', { class: 'rt-tabs', role: 'tablist', 'aria-label': 'මෙවලම්' });
    const body = el('div', { class: 'rt-body', role: 'tabpanel', tabindex: '-1' });
    const panel = el('aside', {
      class: 'rt-panel',
      id: 'rt-panel',
      role: 'dialog',
      'aria-label': 'කියවීමේ මෙවලම්',
      tabindex: '-1',
    }, [head, tabs, body]);

    root.appendChild(progress);
    root.appendChild(fab);
    root.appendChild(stopFab);
    root.appendChild(scrim);
    root.appendChild(panel);

    ui.root = root;
    ui.bar = bar;
    ui.fab = fab;
    ui.stop = stopFab;
    ui.stopPct = $('[data-rt-stop-pct]', stopFab);
    ui.scrim = scrim;
    ui.panel = panel;
    ui.tabs = tabs;
    ui.body = body;
    ui.sub = sub;
    ui.close = closeBtn;
    return true;
  }

  // --------------------------------------------------------------- article

  function findArticle() {
    for (let i = 0; i < ARTICLE_CANDIDATES.length; i++) {
      const n = $(ARTICLE_CANDIDATES[i]);
      if (!n) continue;
      if (ui.root && (ui.root.contains(n) || n.contains(ui.root))) continue;
      if ((n.textContent || '').trim().length >= MIN_ARTICLE_CHARS) return n;
    }
    return null;
  }

  // removes stale dim flags left by the retired focus mode
  function clearDim() {
    $$('[data-rt-dim]').forEach((n) => n.removeAttribute('data-rt-dim'));
  }

  function words() {
    if (!article) return 0;
    const t = (article.textContent || '').replace(/\s+/g, ' ').trim();
    return t ? t.split(' ').length : 0;
  }

  function minutes() {
    return Math.max(1, Math.round(words() / WORDS_PER_MIN));
  }

  // ----------------------------------------------------------------- apply

  function apply() {
    const r = document.documentElement;
    r.setAttribute('data-rt-page', state.page);
    r.setAttribute('data-rt-font', state.font);
    r.setAttribute('data-rt-measure', state.measure);
    r.style.setProperty('--rt-font-scale', String(state.fontScale));
    r.style.setProperty('--rt-line-height', String(state.lineHeight));
    r.style.setProperty('--rt-letter', state.letter + 'em');

    if (article) {
      article.setAttribute('data-rt-article', '');
      r.setAttribute('data-rt-has-article', '1');
    } else {
      r.removeAttribute('data-rt-has-article');
    }
    r.setAttribute('data-rt-focus', 'off');

    // font/line-height changes alter the document height
    scrollMax(true);
  }

  function set(patch, opts) {
    Object.assign(state, patch || {});
    apply();
    if (opts && opts.immediate) saveNow();
    else save();
    emit('change', state);
  }

  // -------------------------------------------------------- auto scroll
  // Module level: keeps running when the panel closes; teardown stops it.

  const auto = {
    raf: 0, last: 0, carry: 0, expect: -1, stall: 0, armed: false, armTimer: 0,
    prevY: 0, watchdog: 0, wdY: -1, wdAt: 0,
    ms: 0, gov: 1, stopFlag: false, pctAt: 0, pctShow: -1,
  };

  function autoWatchdog() {
    if (!auto.raf) return;
    const now = Date.now();
    if (now - auto.wdAt > AUTO_WATCHDOG_MS) {
      stopAuto();
      return;
    }
    const y = window.scrollY;
    if (y !== auto.wdY) {
      auto.wdY = y;
      auto.wdAt = now;
    }
  }

  function autoPps() {
    return AUTO_PPS[clamp(Math.round(state.scrollSpeed), 1, 10) - 1] * auto.gov;
  }

  // jank governor: a long frame slows the scroll down, protecting weak phones
  function autoGovern(dt) {
    if (dt > AUTO_JANK_MS) auto.gov = Math.max(AUTO_GOV_MIN, auto.gov - 0.08);
    else if (auto.gov < 1) auto.gov = Math.min(1, auto.gov + AUTO_GOV_UP);
  }

  function setY(y) {
    try {
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    } catch (e) {
      window.scrollTo(0, y);
    }
  }

  function autoStep(ts) {
    if (!auto.raf) return;
    auto.raf = requestAnimationFrame(autoStep);

    if (!auto.last) {
      auto.last = ts;
      auto.prevY = window.scrollY;
      return;
    }

    let dt = ts - auto.last;
    auto.last = ts;
    if (dt <= 0) return;
    if (dt > AUTO_MAX_DT) dt = AUTO_MAX_DT;

    // watchdog heartbeat
    auto.wdAt = Date.now();

    autoGovern(dt);

    const y = window.scrollY;

    // user scrolled by hand (scrollbar drag included)
    if (auto.armed && auto.expect >= 0 && Math.abs(y - auto.expect) > AUTO_DRIFT) {
      stopAuto();
      return;
    }

    const max = scrollMax();
    if (max <= 4 || y >= max - 1) {
      stopAuto();
      return;
    }

    // stall guard: compares only against the value we wrote last
    if (auto.expect >= 0) {
      if (y < auto.expect - AUTO_WRITE_EPS) auto.stall++;
      else auto.stall = 0;
      if (auto.stall > STALL_FRAMES) {
        stopAuto();
        return;
      }
    }
    auto.prevY = y;

    auto.ms += dt;
    auto.carry += (autoPps() * dt) / 1000;
    if (auto.carry > 320) auto.carry = 320;

    if (auto.ms < AUTO_WRITE_MS || auto.carry < AUTO_MIN_WRITE_PX) return;
    auto.ms -= AUTO_WRITE_MS;
    if (auto.ms > AUTO_WRITE_MS * 4) auto.ms = AUTO_WRITE_MS * 4;

    const step = Math.floor(auto.carry);
    auto.carry -= step;

    const target = Math.min(max, y + step);
    setY(target);
    auto.expect = target;

    if (ui.stopPct && ts - auto.pctAt > 500) {
      auto.pctAt = ts;
      const pct = max > 0 ? Math.min(100, Math.round((target / max) * 100)) : 100;
      if (pct !== auto.pctShow) {
        auto.pctShow = pct;
        ui.stopPct.textContent = pct + '%';
      }
    }
  }

  function startAuto() {
    if (auto.raf || !article) return;
    if (scrollMax(true) <= 8) return;

    // panel closes: scroll lock and scrim both go away
    close();
    document.documentElement.classList.remove('rt-locked');
    ensureAutoStyle();
    document.documentElement.setAttribute('data-rt-scrolling', '1');
    if (ui.root) {
      ui.root.setAttribute('data-scrolling', '1');
      ui.root.setAttribute('data-autoscroll', '1');
    }

    auto.last = 0;
    auto.carry = 0;
    auto.ms = 0;
    auto.stall = 0;
    auto.expect = -1;
    auto.armed = false;
    auto.gov = 1;
    auto.pctAt = 0;
    auto.pctShow = -1;
    auto.prevY = window.scrollY;
    if (ui.stop) {
      ui.stop.setAttribute('data-on', '1');
      ui.stop.setAttribute('aria-pressed', 'true');
      if (ui.stopPct) ui.stopPct.textContent = '0%';
    }
    if (auto.armTimer) clearTimeout(auto.armTimer);
    // arm late so the tap that started the scroll does not stop it
    auto.armTimer = setTimeout(() => {
      auto.armTimer = 0;
      auto.armed = true;
    }, AUTO_ARM_MS);

    auto.wdY = window.scrollY;
    auto.wdAt = Date.now();
    if (auto.watchdog) clearInterval(auto.watchdog);
    auto.watchdog = setInterval(autoWatchdog, AUTO_WD_POLL_MS);

    auto.raf = requestAnimationFrame(autoStep);

    // the FAB turns visibility:hidden; move keyboard focus to the stop pill
    if (ui.fab && ui.stop && document.activeElement === ui.fab) {
      try { ui.stop.focus({ preventScroll: true }); } catch (e) {}
    }
    emit('autoscroll', true);
  }

  function stopAuto() {
    if (auto.stopFlag) return;
    auto.stopFlag = true;

    // timers first: stop must work even when the main thread is busy
    if (auto.armTimer) { clearTimeout(auto.armTimer); auto.armTimer = 0; }
    if (auto.watchdog) { clearInterval(auto.watchdog); auto.watchdog = 0; }
    const was = !!auto.raf;
    if (auto.raf) { cancelAnimationFrame(auto.raf); auto.raf = 0; }

    auto.armed = false;
    auto.last = 0;
    auto.carry = 0;
    auto.ms = 0;
    auto.stall = 0;
    auto.expect = -1;
    auto.prevY = 0;
    auto.wdY = -1;
    auto.wdAt = 0;
    auto.gov = 1;
    auto.pctAt = 0;
    auto.pctShow = -1;

    document.documentElement.removeAttribute('data-rt-scrolling');
    if (ui.root) {
      ui.root.removeAttribute('data-scrolling');
      ui.root.removeAttribute('data-autoscroll');
    }
    if (ui.stop) {
      ui.stop.setAttribute('data-on', '0');
      ui.stop.setAttribute('aria-pressed', 'false');
    }
    auto.stopFlag = false;
    if (was) {
      savePos();
      emit('autoscroll', false);
    }
  }

  function toggleAuto() {
    if (auto.raf) stopAuto();
    else startAuto();
  }

  // ------------------------------------------------------------ open/close

  function lockScroll(lock) {
    const r = document.documentElement;
    if (lock && isMobile()) r.classList.add('rt-locked');
    else r.classList.remove('rt-locked');
  }

  function focusables() {
    if (!ui.panel) return [];
    return $$('button, [href], select, input, [tabindex]:not([tabindex="-1"])', ui.panel)
      .filter((n) => !n.disabled && n.offsetParent !== null);
  }

  function trap(e) {
    if (!isOpen || e.key !== 'Tab' || !ui.panel) return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ui.panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open() {
    if (!ui.root || isOpen || !article) return;
    if (document.documentElement.classList.contains('age-gate-pending')) return;
    // the panel locks scrolling, so auto-scroll stops first
    stopAuto();
    isOpen = true;
    lastFocus = document.activeElement;
    ui.root.setAttribute('data-open', '1');
    ui.fab.setAttribute('aria-expanded', 'true');
    lockScroll(true);
    if (!activeTab && tools.length) showTab(tools[0].id);
    setTimeout(() => {
      if (isOpen && ui.panel) {
        try { ui.panel.focus({ preventScroll: true }); } catch (e) {}
      }
    }, reduceMotion() ? 0 : 80);
    emit('open');
  }

  function close() {
    if (!ui.root || !isOpen) return;
    isOpen = false;
    ui.root.setAttribute('data-open', '0');
    if (ui.fab) ui.fab.setAttribute('aria-expanded', 'false');
    lockScroll(false);
    if (lastFocus && document.contains(lastFocus)) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
    } else if (ui.fab) {
      try { ui.fab.focus({ preventScroll: true }); } catch (e) {}
    }
    lastFocus = null;
    emit('close');
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  // -------------------------------------------------------------- registry

  const tools = [];

  function register(tool) {
    if (!tool || !tool.id || typeof tool.mount !== 'function') {
      console.warn('[reader-tools] invalid tool', tool);
      return;
    }
    if (tools.some((t) => t.id === tool.id)) return;
    tools.push(Object.assign({ order: 100, label: tool.id, icon: '' }, tool));
    tools.sort((a, b) => a.order - b.order);
    if (ui.tabs) renderTabs();
  }

  function renderTabs() {
    if (!ui.tabs) return;
    ui.tabs.textContent = '';
    tools.forEach((t) => {
      ui.tabs.appendChild(
        el('button', {
          class: 'rt-tab',
          type: 'button',
          role: 'tab',
          'data-tab': t.id,
          'aria-selected': activeTab === t.id ? 'true' : 'false',
          onclick: () => showTab(t.id),
        }, [
          el('span', { html: t.icon, 'aria-hidden': 'true' }),
          el('span', { text: t.label }),
        ])
      );
    });
  }

  function runCleanup() {
    if (typeof cleanupTab === 'function') {
      try { cleanupTab(); } catch (e) { console.warn('[reader-tools] cleanup', e); }
    }
    cleanupTab = null;
    pctEl = null;
  }

  function showTab(id) {
    const tool = tools.filter((t) => t.id === id)[0];
    if (!tool || !ui.body) return;
    runCleanup();
    activeTab = id;
    ui.body.textContent = '';
    ui.body.scrollTop = 0;
    renderTabs();
    const ctx = { state, set, on, el, $, $$, article, ICON, close, showTab, limits: LIMITS };
    try {
      const c = tool.mount(ui.body, ctx);
      if (typeof c === 'function') cleanupTab = c;
    } catch (e) {
      console.warn('[reader-tools] mount ' + id, e);
      ui.body.appendChild(el('p', {
        class: 'rt-note', 'data-warn': '1', text: 'මෙම මෙවලම පූරණය නොවුණි.',
      }));
    }
    emit('tab', id);
  }

  // ------------------------------------------------------------- ui bits

  function segment(label, value, options, pick) {
    const seg = el('div', { class: 'rt-seg' });
    options.forEach((o) => {
      const chip = el('button', {
        class: 'rt-chip',
        type: 'button',
        text: o.label,
        'aria-pressed': value === o.value ? 'true' : 'false',
        onclick: () => {
          $$('.rt-chip', seg).forEach((c) => c.setAttribute('aria-pressed', 'false'));
          chip.setAttribute('aria-pressed', 'true');
          pick(o.value);
        },
      });
      seg.appendChild(chip);
    });
    return el('div', { class: 'rt-group' }, [
      el('p', { class: 'rt-label', text: label }),
      seg,
    ]);
  }

  // returns the group element; group.rtSync(v) updates the thumb and label
  // from code (used by the speed reset button)
  function slider(label, key, fmt, onLive) {
    const l = LIMITS[key];
    const out = el('span', { class: 'rt-val', text: fmt(state[key]) });
    const input = el('input', {
      class: 'rt-range',
      type: 'range',
      min: String(l[0]),
      max: String(l[1]),
      step: String(l[2]),
      value: String(state[key]),
      'aria-label': label,
    });
    input.addEventListener('input', () => {
      const v = clamp(round(parseFloat(input.value), l[2]), l[0], l[1]);
      out.textContent = fmt(v);
      const patch = {};
      patch[key] = v;
      set(patch);
      if (typeof onLive === 'function') onLive(v);
    });
    input.addEventListener('change', saveNow);
    input.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    const group = el('div', { class: 'rt-group' }, [
      el('p', { class: 'rt-label', text: label }),
      el('div', { class: 'rt-row' }, [input, out]),
    ]);
    group.rtSync = (v) => {
      input.value = String(v);
      out.textContent = fmt(v);
    };
    return group;
  }

  // ------------------------------------------------------------- tool: toc

  let tocSync = null;

  register({
    id: 'toc',
    label: 'අන්තර්ගතය',
    icon: ICON.list,
    order: 10,
    mount(box) {
      const w = words();
      box.appendChild(el('div', { class: 'rt-stats' }, [
        el('div', { class: 'rt-stat' }, [
          el('b', { text: w.toLocaleString('en-US') }),
          el('span', { text: 'වචන' }),
        ]),
        el('div', { class: 'rt-stat' }, [
          el('b', { text: String(minutes()) }),
          el('span', { text: 'මිනිත්තු' }),
        ]),
        el('div', { class: 'rt-stat' }, [
          el('b', { 'data-rt-pct': '', text: '0%' }),
          el('span', { text: 'කියවා ඇත' }),
        ]),
      ]));
      pctEl = $('[data-rt-pct]', box);
      if (pctEl) pctEl.textContent = Math.round(lastPct * 100) + '%';

      const group = el('div', { class: 'rt-group' }, [
        el('p', { class: 'rt-label', text: 'කොටස්' }),
      ]);
      const heads = article
        ? $$(HEADING_SEL, article).filter((h) => (h.textContent || '').trim())
        : [];

      if (!heads.length) {
        group.appendChild(el('p', {
          class: 'rt-empty',
          text: 'මේ ලිපියේ උපශීර්ෂ නැහැ. "කියවීම" ටැබ් එකෙන් ස්වයං-අනුචලනය පාවිච්චි කරන්න පුළුවන්.',
        }));
        box.appendChild(group);
        return () => { pctEl = null; };
      }

      const list = el('ul', { class: 'rt-toc' });
      const pairs = [];
      heads.forEach((h, i) => {
        if (!h.id) h.id = 'rt-h-' + i;
        const a = el('a', {
          href: '#' + h.id,
          text: (h.textContent || '').trim(),
          onclick: (ev) => {
            ev.preventDefault();
            stopAuto();
            h.scrollIntoView({ behavior: behavior(), block: 'start' });
            if (isMobile()) close();
          },
        });
        pairs.push({ a: a, h: h });
        list.appendChild(el('li', { 'data-lvl': h.tagName.slice(1) }, a));
      });
      group.appendChild(list);
      box.appendChild(group);

      tocSync = () => {
        let cur = null;
        for (let i = 0; i < pairs.length; i++) {
          if (pairs[i].h.getBoundingClientRect().top <= 130) cur = pairs[i];
        }
        pairs.forEach((p) => p.a.setAttribute('data-active', p === cur ? '1' : '0'));
      };
      tocSync();

      return () => {
        tocSync = null;
        pctEl = null;
      };
    },
  });

  // --------------------------------------------------------- tool: display

  register({
    id: 'display',
    label: 'පෙනුම',
    icon: ICON.type,
    order: 20,
    mount(box) {
      box.appendChild(segment('පසුබිම', state.page, [
        { value: 'dark', label: 'අඳුරු' },
        { value: 'paper', label: 'සුදු' },
        { value: 'sepia', label: 'සෙපියා' },
        { value: 'contrast', label: 'තීව්‍ර' },
      ], (v) => set({ page: v }, { immediate: true })));

      box.appendChild(segment('අකුරු වර්ගය', state.font, [
        { value: 'sinhala', label: 'සිංහල' },
        { value: 'serif', label: 'සෙරිෆ්' },
        { value: 'system', label: 'පද්ධති' },
      ], (v) => set({ font: v }, { immediate: true })));

      box.appendChild(slider('අකුරු ප්‍රමාණය', 'fontScale', (v) => Math.round(v * 100) + '%'));
      box.appendChild(slider('පේළි පරතරය', 'lineHeight', (v) => v.toFixed(2)));
      box.appendChild(slider('අකුරු පරතරය', 'letter', (v) => String(Math.round(v * 1000))));

      box.appendChild(segment('පේළි පළල', state.measure, [
        { value: 'narrow', label: 'පටු' },
        { value: 'normal', label: 'සාමාන්‍ය' },
        { value: 'wide', label: 'පළල්' },
      ], (v) => set({ measure: v }, { immediate: true })));

      box.appendChild(el('button', {
        class: 'rt-btn',
        type: 'button',
        html: ICON.reset + '<span>මුල් තත්ත්වයට</span>',
        onclick: () => {
          set({
            page: DEFAULTS.page,
            font: DEFAULTS.font,
            fontScale: DEFAULTS.fontScale,
            lineHeight: DEFAULTS.lineHeight,
            letter: DEFAULTS.letter,
            measure: DEFAULTS.measure,
          }, { immediate: true });
          showTab('display');
        },
      }));
    },
  });

  // ----------------------------------------------------------- tool: voice

  const engines = {};
  function registerVoiceEngine(id, engine) {
    if (id && engine && typeof engine.speak === 'function') engines[id] = engine;
  }

  function chunk(text) {
    const out = [];
    let rest = (text || '').replace(/\s+/g, ' ').trim();
    while (rest.length > TTS_CHUNK) {
      let cut = -1;
      const head = rest.slice(0, TTS_CHUNK);
      const seps = ['. ', '! ', '? ', '\u0DF4 ', ', ', ' '];
      for (let i = 0; i < seps.length && cut < 0; i++) {
        const at = head.lastIndexOf(seps[i]);
        if (at > TTS_CHUNK * 0.5) cut = at + seps[i].length;
      }
      if (cut < 0) cut = TTS_CHUNK;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out;
  }

  let tts = null;

  function ttsStopHard() {
    if (tts) {
      tts.stopped = true;
      tts.playing = false;
      tts.userPaused = false;
      if (tts.kick) {
        clearTimeout(tts.kick);
        tts.kick = null;
      }
    }
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {}
    $$('.rt-speaking').forEach((n) => n.classList.remove('rt-speaking'));
  }

  register({
    id: 'voice',
    label: 'හඬ',
    icon: ICON.voice,
    order: 30,
    mount(box) {
      const synth = window.speechSynthesis;
      if (!synth) {
        box.appendChild(el('p', {
          class: 'rt-note', 'data-warn': '1',
          text: 'මෙම බ්‍රව්සරය හඬ කියවීමට (TTS) සහාය නොදක්වයි.',
        }));
        return;
      }

      const blocks = article
        ? $$(BLOCK_SEL, article).filter((n) => (n.textContent || '').trim().length > 1)
        : [];
      if (!blocks.length) {
        box.appendChild(el('p', {
          class: 'rt-note', 'data-warn': '1',
          text: 'කියවීමට අන්තර්ගතයක් හමු නොවුණි.',
        }));
        return;
      }

      const queue = [];
      blocks.forEach((node) => {
        chunk(node.textContent).forEach((text) => queue.push({ node: node, text: text }));
      });

      ttsStopHard();
      tts = { i: 0, playing: false, stopped: true, userPaused: false, kick: null, gen: 0, guard: 0 };

      const note = el('p', { class: 'rt-note', text: 'සූදානම්.' });
      const select = el('select', { class: 'rt-select', 'aria-label': 'හඬ තෝරන්න' });

      const btnPlay = el('button', {
        class: 'rt-btn', 'data-primary': '1', type: 'button',
        html: ICON.play + '<span>කියවන්න</span>',
      });
      const btnPause = el('button', {
        class: 'rt-btn', type: 'button', html: ICON.pause, 'aria-label': 'විරාමය',
      });
      const btnStop = el('button', {
        class: 'rt-btn', type: 'button', html: ICON.stop, 'aria-label': 'නතර කරන්න',
      });

      let voicesFilled = false;
      function fillVoices() {
        const all = synth.getVoices() || [];
        if (!all.length) return;
        voicesFilled = true;
        const keep = select.value;
        select.textContent = '';
        const si = all.filter((v) => (v.lang || '').toLowerCase().indexOf('si') === 0);
        si.concat(all.filter((v) => si.indexOf(v) < 0)).forEach((v) => {
          select.appendChild(el('option', {
            value: v.voiceURI, text: v.name + ' (' + v.lang + ')',
          }));
        });
        const want = keep || state.voiceURI;
        if (want && all.some((v) => v.voiceURI === want)) select.value = want;
        if (!si.length) {
          note.setAttribute('data-warn', '1');
          note.textContent =
            'සිංහල (si-LK) හඬක් මේ උපාංගයේ නැහැ. Android: Settings → Language → Text-to-speech එකෙන් සිංහල pack එක install කරන්න. iOS / desktop බොහොමයක සිංහල හඬ නෑ — වෙනත් හඬක් තේරුවොත් උච්චාරණය නිවැරදි නොවේ.';
        } else {
          note.removeAttribute('data-warn');
          note.textContent = 'සිංහල හඬ ලබා ගත හැක.';
        }
      }
      fillVoices();
      synth.addEventListener('voiceschanged', fillVoices);
      const poll = setTimeout(() => { if (!voicesFilled) fillVoices(); }, 400);
      select.addEventListener('change', () => set({ voiceURI: select.value }, { immediate: true }));

      function label(txt) {
        btnPlay.innerHTML = ICON.play + '<span>' + txt + '</span>';
      }

      function highlight(node) {
        $$('.rt-speaking').forEach((n) => { if (n !== node) n.classList.remove('rt-speaking'); });
        if (node) node.classList.add('rt-speaking');
      }

      function speakAt(i) {
        if (!tts || tts.stopped) return;
        if (i >= queue.length) {
          ttsStopHard();
          label('කියවන්න');
          note.removeAttribute('data-warn');
          note.textContent = 'කියවීම අවසන්.';
          return;
        }
        tts.i = i;
        const gen = tts.gen;
        if (tts.guard) { clearTimeout(tts.guard); tts.guard = 0; }
        const item = queue[i];
        highlight(item.node);

        const u = new SpeechSynthesisUtterance(item.text);
        const all = synth.getVoices() || [];
        const v = all.filter((x) => x.voiceURI === select.value)[0];
        if (v) {
          u.voice = v;
          u.lang = v.lang;
        } else {
          u.lang = 'si-LK';
        }
        u.rate = state.rate;
        u.pitch = state.pitch;

        // single-shot: onend and the guard timer must not both advance
        let advanced = false;
        const done = () => {
          if (advanced) return;
          advanced = true;
          if (tts.guard) { clearTimeout(tts.guard); tts.guard = 0; }
          if (!tts || tts.stopped || tts.gen !== gen) return;
          speakAt(i + 1);
        };
        u.onend = done;
        u.onerror = (ev) => {
          if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return;
          if (!tts || tts.gen !== gen) return;
          note.setAttribute('data-warn', '1');
          note.textContent = 'හඬ කියවීමේ දෝෂයක්. වෙනත් හඬක් තෝරා නැවත උත්සාහ කරන්න.';
          ttsStopHard();
          label('කියවන්න');
        };

        // some engines never fire onend; a guard timer moves on after a
        // generous estimate, and waits while the user has paused
        const est = Math.max(4000, Math.min(60000,
          Math.round((item.text.length / 11) * 1000 / Math.max(0.5, state.rate)) + 3500));
        const t0 = Date.now();
        const tick = () => {
          if (!tts || tts.stopped || tts.gen !== gen) { if (tts) tts.guard = 0; return; }
          if (synth.paused) { tts.guard = setTimeout(tick, 1500); return; }
          const idle = synth.speaking === false && synth.pending === false;
          if (!idle && Date.now() - t0 < est + 8000) {
            tts.guard = setTimeout(tick, 1200);
            return;
          }
          tts.guard = 0;
          if (!idle) { try { synth.cancel(); } catch (e) {} }
          done();
        };
        tts.guard = setTimeout(tick, est);

        try {
          synth.speak(u);
        } catch (e) {
          ttsStopHard();
          label('කියවන්න');
        }
      }

      function play() {
        if (!tts) return;
        if (tts.playing && synth.paused) {
          tts.userPaused = false;
          try { synth.resume(); } catch (e) {}
          note.textContent = 'කියවනවා...';
          label('කියවනවා');
          return;
        }
        if (tts.playing) return;
        const gen = ++tts.gen;
        if (tts.guard) { clearTimeout(tts.guard); tts.guard = 0; }
        if (tts.kick) { clearTimeout(tts.kick); tts.kick = null; }
        tts.stopped = false;
        tts.playing = true;
        tts.userPaused = false;
        note.removeAttribute('data-warn');
        note.textContent = 'කියවනවා...';
        label('කියවනවා');
        try { synth.cancel(); } catch (e) {}
        tts.kick = setTimeout(() => {
          tts.kick = null;
          if (!tts || tts.gen !== gen) return;
          speakAt(tts.i);
        }, 90);
      }

      function pause() {
        if (tts && tts.playing && !synth.paused) {
          tts.userPaused = true;
          try { synth.pause(); } catch (e) {}
          note.textContent = 'විරාමයේ.';
          label('දිගටම');
        }
      }

      function stopVoice() {
        if (tts) {
          tts.gen++;
          if (tts.kick) { clearTimeout(tts.kick); tts.kick = null; }
          if (tts.guard) { clearTimeout(tts.guard); tts.guard = 0; }
        }
        try { synth.cancel(); } catch (e) {}
        ttsStopHard();
        if (tts) tts.i = 0;
        label('කියවන්න');
        note.removeAttribute('data-warn');
        note.textContent = 'නතර කළා.';
      }

      btnPlay.addEventListener('click', play);
      btnPause.addEventListener('click', pause);
      btnStop.addEventListener('click', stopVoice);

      box.appendChild(el('div', { class: 'rt-group' }, [
        el('p', { class: 'rt-label', text: 'හඬ' }),
        select,
      ]));
      box.appendChild(slider('වේගය', 'rate', (v) => v.toFixed(2) + 'x'));
      box.appendChild(slider('ස්වරය', 'pitch', (v) => v.toFixed(2)));
      box.appendChild(el('div', { class: 'rt-row' }, [btnPlay, btnPause, btnStop]));
      box.appendChild(note);
      box.appendChild(el('p', {
        class: 'rt-empty',
        text: 'කොටස් ' + queue.length + 'ක් පෝලිමේ. පිටුව මාරු කළොත් හඬ ඉබේම නවතිනවා.',
      }));

      return () => {
        clearTimeout(poll);
        synth.removeEventListener('voiceschanged', fillVoices);
        if (tts) {
          tts.gen++;
          if (tts.kick) clearTimeout(tts.kick);
          if (tts.guard) clearTimeout(tts.guard);
        }
        try { synth.cancel(); } catch (e) {}
        ttsStopHard();
        tts = null;
      };
    },
  });

  // --------------------------------------------------------- tool: reading

  // short spoken-Sinhala description that follows the speed slider
  function speedHint(v) {
    const n = clamp(Math.round(v), 1, 10);
    if (n <= 3) return 'හරිම සෙමින් යනවා. හොඳින් රස විඳිමින් කියවන්න පුළුවන්.';
    if (n <= 6) return 'මධ්‍යම වේගයක්. සාමාන්‍යයෙන් කියවන්න හොඳයි.';
    if (n <= 8) return 'ටිකක් වේගයි. ඉක්මනට කියවන අයට.';
    return 'හරිම වේගයි. පිටුව ඉක්මනින් පහළට යනවා.';
  }

  register({
    id: 'reading',
    label: 'කියවීම',
    icon: ICON.eye,
    order: 40,
    mount(box) {
      const defSpeed = DEFAULTS.scrollSpeed;

      const hintEl = el('p', { class: 'rt-empty' });

      // red reset button: shown only while the speed differs from default
      const btnReset = el('button', {
        class: 'rt-reset-btn',
        type: 'button',
        'aria-label': 'වේගය මුල් අගයට නැවත සකසන්න',
        html:
          ICON.reset +
          '<span>වේගය නැවත සකසන්න</span>' +
          '<span class="rt-reset-tag">මුල් අගය ' + defSpeed + '</span>',
      });
      const resetWrap = el('div', {
        class: 'rt-reset-wrap',
        'data-show': '0',
        'aria-hidden': 'true',
      }, el('div', { class: 'rt-reset-inner' }, btnReset));

      function paintHint() {
        hintEl.textContent = speedHint(state.scrollSpeed);
      }
      function paintReset() {
        const changed = Math.round(state.scrollSpeed) !== defSpeed;
        resetWrap.setAttribute('data-show', changed ? '1' : '0');
        resetWrap.setAttribute('aria-hidden', changed ? 'false' : 'true');
      }

      // speed can be changed while running too: autoStep reads state each frame
      const speedGroup = slider(
        'ස්වයං-අනුචලන වේගය',
        'scrollSpeed',
        (v) => Math.round(v) + ' / 10',
        () => {
          paintHint();
          paintReset();
        }
      );
      speedGroup.appendChild(hintEl);
      box.appendChild(speedGroup);
      box.appendChild(resetWrap);
      paintHint();
      paintReset();

      btnReset.addEventListener('click', () => {
        set({ scrollSpeed: defSpeed }, { immediate: true });
        speedGroup.rtSync(defSpeed);
        paintHint();
        paintReset();
      });

      const btn = el('button', { class: 'rt-btn', type: 'button' });
      function paint() {
        const running = !!auto.raf;
        btn.innerHTML =
          (running ? ICON.stop : ICON.down) +
          '<span>' + (running ? 'නවත්වන්න' : 'ඉබේම පහළට යන්න පටන් ගන්න') + '</span>';
        if (running) {
          btn.setAttribute('data-danger', '1');
          btn.removeAttribute('data-primary');
        } else {
          btn.setAttribute('data-primary', '1');
          btn.removeAttribute('data-danger');
        }
      }
      paint();
      const offAuto = on('autoscroll', paint);
      btn.addEventListener('click', toggleAuto);

      box.appendChild(el('div', { class: 'rt-row' }, [btn]));
      box.appendChild(el('p', {
        class: 'rt-empty',
        text: 'පටන් ගත්තම මේ මෙනුව ඉබේම වැහෙනවා. නවත්වන්න ඕන නම් පහළ මැද තියෙන රතු බොත්තම ඔබන්න, නැත්නම් තිරය ඇඟිල්ලෙන් ඇදන්න. කතාව අවසාන වුනාම තනියම නවතිනවා.',
      }));

      let saved = 0;
      try {
        saved = parseFloat(localStorage.getItem(posKey(curPath)) || '0') || 0;
      } catch (e) {}
      if (saved > 0.04 && saved < 0.95) {
        // inside a row so the button keeps its normal height
        box.appendChild(el('div', { class: 'rt-row' }, [
          el('button', {
            class: 'rt-btn',
            type: 'button',
            html: ICON.up + '<span>කලින් නැවතුණු තැනට යන්න (' + Math.round(saved * 100) + '%)</span>',
            onclick: () => {
              stopAuto();
              window.scrollTo({
                top: scrollMax(true) * saved,
                behavior: isMobile() ? 'auto' : behavior(),
              });
              if (isMobile()) close();
            },
          }),
        ]));
      }

      box.appendChild(el('div', { class: 'rt-row' }, [
        el('button', {
          class: 'rt-btn', type: 'button', html: ICON.up + '<span>මුලට</span>',
          onclick: () => {
            stopAuto();
            window.scrollTo({ top: 0, behavior: isMobile() ? 'auto' : behavior() });
          },
        }),
        el('button', {
          class: 'rt-btn', type: 'button', html: ICON.down + '<span>අන්තිමට</span>',
          onclick: () => {
            stopAuto();
            window.scrollTo({ top: scrollMax(true), behavior: isMobile() ? 'auto' : behavior() });
          },
        }),
      ]));

      return () => { offAuto(); };
    },
  });

  // ------------------------------------------------------- tool: translate

  register({
    id: 'translate',
    label: 'පරිවර්තනය',
    icon: ICON.globe,
    order: 50,
    mount(box) {
      const seg = el('div', { class: 'rt-seg' });
      [
        { code: 'en', label: 'English' },
        { code: 'ta', label: 'தமிழ்' },
        { code: 'hi', label: 'हिन्दी' },
        { code: 'ru', label: 'Русский' },
        { code: 'zh-CN', label: '中文' },
        { code: 'ar', label: 'العربية' },
      ].forEach((l) => {
        seg.appendChild(el('button', {
          class: 'rt-chip',
          type: 'button',
          text: l.label,
          onclick: () => {
            const u = 'https://translate.google.com/translate?sl=si&tl=' +
              encodeURIComponent(l.code) + '&u=' + encodeURIComponent(location.href);
            window.open(u, '_blank', 'noopener,noreferrer');
          },
        }));
      });
      box.appendChild(el('div', { class: 'rt-group' }, [
        el('p', { class: 'rt-label', text: 'භාෂාව තෝරන්න' }),
        seg,
      ]));
      box.appendChild(el('p', {
        class: 'rt-note',
        text: 'Google Translate හි පිටු-පරිවර්තනය අලුත් කවුළුවක විවෘත වේ.',
      }));
    },
  });

  // -------------------------------------------------------- shared scroll

  let lastSave = 0;
  let lastPct = 0;

  const onScroll = rafOnce(() => {
    const max = scrollMax();
    const pct = max > 4 ? clamp(window.scrollY / max, 0, 1) : 0;
    lastPct = pct;
    if (ui.bar) ui.bar.style.transform = 'scaleX(' + pct.toFixed(4) + ')';
    if (isOpen) {
      if (pctEl) pctEl.textContent = Math.round(pct * 100) + '%';
      if (tocSync) tocSync();
    }
    const now = Date.now();
    // localStorage is synchronous I/O: never write it while auto-scroll runs
    if (!auto.raf && pct > 0.02 && now - lastSave > POS_SAVE_MS) {
      lastSave = now;
      savePos();
    }
  });

  function savePos() {
    try {
      if (lastPct <= 0.02) return;
      localStorage.setItem(posKey(curPath), lastPct.toFixed(3));
    } catch (e) {}
  }

  function flushPos() {
    savePos();
    saveNow();
  }

  // -------------------------------------------------------- boot/teardown

  let booted = false;

  function bindGlobal() {
    listen(ui.fab, 'click', toggle);
    listen(ui.close, 'click', close);
    listen(ui.scrim, 'click', close);

    // stop pill: act on the very first event (pointerdown / touchstart);
    // a finger press can turn into a scroll gesture and cancel the click
    const hardStopAuto = (ev) => {
      if (ev) {
        if (ev.cancelable) ev.preventDefault();
        ev.stopPropagation();
      }
      stopAuto();
    };
    listen(ui.stop, 'pointerdown', hardStopAuto);
    listen(ui.stop, 'touchstart', hardStopAuto, { passive: false });
    listen(ui.stop, 'click', hardStopAuto);

    // on a long page the scroll writes can delay event dispatch, so any tap
    // outside the panel also stops auto-scroll (capture phase, runs first)
    const tapStop = (ev) => {
      if (!auto.raf) return;
      const t = ev ? ev.target : null;
      if (t && ui.stop && (t === ui.stop || ui.stop.contains(t))) {
        stopAuto();
        return;
      }
      if (t && ui.root && ui.root.contains(t)) return;
      stopAuto();
    };
    listen(window, 'pointerdown', tapStop, { capture: true, passive: true });
    listen(window, 'touchstart', tapStop, { capture: true, passive: true });
    listen(window, 'mousedown', tapStop, { capture: true, passive: true });

    const keyStop = (ev) => {
      if (!auto.raf || !auto.armed) return;
      const k = ev ? ev.key : '';
      if (k === 'Escape' || k === ' ' || k === 'Home' || k === 'End' ||
          k.slice(0, 5) === 'Arrow' || k.slice(0, 4) === 'Page') {
        stopAuto();
      }
    };
    listen(window, 'keydown', keyStop);

    listen(window, 'scroll', onScroll, { passive: true });
    listen(window, 'resize', () => {
      scrollMax(true);
      onScroll();
    }, { passive: true });

    // manual input stops auto-scroll; events inside the panel are ignored,
    // and the 420ms arm delay protects the tap that started it
    const abortAuto = (ev) => {
      if (!auto.raf || !auto.armed) return;
      if (ui.root && ev && ev.target && ev.target.nodeType && ui.root.contains(ev.target)) return;
      stopAuto();
    };
    listen(window, 'wheel', abortAuto, { passive: true });
    listen(window, 'touchmove', abortAuto, { passive: true });

    listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') {
        if (auto.raf) stopAuto();
        if (isOpen) {
          e.stopPropagation();
          close();
        }
        return;
      }
      if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        toggle();
        return;
      }
      // only scroll keys stop auto-scroll
      if (auto.raf && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const k = e.key;
        if (k === ' ' || k === 'Spacebar' || k === 'ArrowUp' || k === 'ArrowDown' ||
            k === 'PageUp' || k === 'PageDown' || k === 'Home' || k === 'End') {
          stopAuto();
        }
      }
      trap(e);
    });

    listen(window, 'pagehide', () => {
      stopAuto();
      flushPos();
    });
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        stopAuto();
        flushPos();
        if (window.speechSynthesis && tts && tts.playing && !window.speechSynthesis.paused) {
          try { window.speechSynthesis.pause(); } catch (e) {}
        }
      } else if (window.speechSynthesis && tts && tts.playing && !tts.userPaused) {
        try { window.speechSynthesis.resume(); } catch (e) {}
      }
    });
    listen(document, 'wk:age-verified', () => {
      if (ui.root && article) ui.root.setAttribute('data-rt-ready', '1');
    });
  }

  function teardown() {
    stopAuto();
    runCleanup();
    ttsStopHard();
    tts = null;
    tocSync = null;
    pctEl = null;
    flushPos();
    unlistenAll();
    lockScroll(false);
    isOpen = false;
    activeTab = null;
    lastFocus = null;
    lastPct = 0;
    maxCache = -1;
    if (ui.root) {
      ui.root.setAttribute('data-open', '0');
      ui.root.setAttribute('data-rt-ready', '0');
      ui.root.removeAttribute('data-scrolling');
      ui.root.removeAttribute('data-autoscroll');
    }
    clearDim();
    document.documentElement.setAttribute('data-rt-focus', 'off');
    document.documentElement.removeAttribute('data-rt-has-article');
    document.documentElement.removeAttribute('data-rt-scrolling');
    Object.keys(ui).forEach((k) => { ui[k] = null; });
    article = null;
    booted = false;
  }

  function boot() {
    if (booted) return;
    if (!document.body) return;
    curPath = location.pathname;
    if (!buildChrome()) return;
    booted = true;
    ensureAutoStyle();
    ensureResetStyle();
    clearDim();
    maxCache = -1;
    article = findArticle();
    apply();

    if (!article) {
      ui.root.setAttribute('data-rt-ready', '0');
      if (ui.bar) ui.bar.style.transform = 'scaleX(0)';
      emit('boot', { article: null });
      return;
    }

    ui.root.setAttribute('data-rt-ready', '1');
    if (ui.sub) {
      ui.sub.textContent = words().toLocaleString('en-US') + ' වචන · ' + minutes() + ' මිනිත්තු';
    }
    renderTabs();
    bindGlobal();
    onScroll();
    emit('boot', { article: article });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  document.addEventListener('astro:before-swap', teardown);
  document.addEventListener('astro:page-load', boot);

  // ---------------------------------------------------------------- api

  window.ReaderTools = {
    version: 13,
    register: register,
    registerVoiceEngine: registerVoiceEngine,
    open: open,
    close: close,
    toggle: toggle,
    showTab: showTab,
    set: set,
    on: on,
    boot: boot,
    teardown: teardown,
    startAutoScroll: startAuto,
    stopAutoScroll: stopAuto,
    toggleAutoScroll: toggleAuto,
    get scrolling() { return !!auto.raf; },
    get state() { return Object.assign({}, state); },
    get article() { return article; },
    get tools() { return tools.map((t) => t.id); },
    get engines() { return Object.keys(engines); },
  };
})();
