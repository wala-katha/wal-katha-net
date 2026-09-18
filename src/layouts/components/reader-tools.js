// ==========================================================================
// Reader Tools — core + built-in tools
// --------------------------------------------------------------------------
// Dependency නැහැ. Astro ClientRouter (view transitions) safe.
// මේ ෆයිල් එකේ block comment (slash-star) පාවිච්චි කරන්නේ නෑ — nested
// comment එකකින් build එක කැඩෙන ප්‍රශ්නය ආපහු එන්නේ නැති වෙන්නයි.
//
// අලුත් tool එකක් එකතු කරන්න (මේ ෆයිල් එක වෙනස් කරන්න ඕන නෑ):
//
//   ReaderTools.register({
//     id: 'bookmarks',
//     label: 'සලකුණු',
//     icon: '<svg ...></svg>',
//     order: 60,
//     mount(container, ctx) {
//       // container = panel body element
//       // ctx = { state, set, on, el, $, $$, article, ICON, close, showTab }
//       return () => {};   // cleanup
//     }
//   });
// ==========================================================================

(() => {
  'use strict';

  if (window.__wkReaderToolsLoaded) return;
  window.__wkReaderToolsLoaded = true;

  // ------------------------------------------------------------------ config

  const STORE_KEY = 'wk:reader:v1';
  const posKey = (p) => 'wk:reader:pos:' + p;

  // මේ සයිට් එකේ article wrapper = .custom-post-content (PostSingle.astro).
  // ඉතිරි ඒවා fallback.
  const ARTICLE_CANDIDATES = [
    '[data-rt-article]',
    '.custom-post-content',
    '#main-content article .content',
    '#main-content .content',
    '#main-content article',
  ];

  const HEADING_SEL = 'h2, h3, h4';
  const BLOCK_SEL = 'p, li, h2, h3, h4, blockquote';
  const MIN_ARTICLE_CHARS = 400;
  const WORDS_PER_MIN = 160;

  const DEFAULTS = {
    page: 'dark',      // dark | paper | sepia | contrast
    font: 'sinhala',   // sinhala | serif | system
    fontScale: 1,      // 0.85 - 1.6
    lineHeight: 1.85,  // 1.4 - 2.4
    letter: 0,         // -0.01 - 0.06 (em)
    measure: 'normal', // narrow | normal | wide
    focus: false,
    rate: 1,           // 0.6 - 1.6
    voiceURI: '',
    scrollSpeed: 3,    // 1 - 10
  };

  const LIMITS = {
    fontScale: [0.85, 1.6, 0.05],
    lineHeight: [1.4, 2.4, 0.05],
    letter: [-0.01, 0.06, 0.005],
    rate: [0.6, 1.6, 0.05],
    scrollSpeed: [1, 10, 1],
  };

  // ------------------------------------------------------------------ helpers

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else node.setAttribute(k, String(v));
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (v, fb) => (typeof v === 'number' && isFinite(v) ? v : fb);

  function rafThrottle(fn) {
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

  function round(n, step) {
    const inv = 1 / step;
    return Math.round(n * inv) / inv;
  }

  // ------------------------------------------------------------------ storage

  function readStore() {
    let saved = {};
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) saved = JSON.parse(raw) || {};
    } catch (e) {
      saved = {};
    }
    const s = Object.assign({}, DEFAULTS, saved);
    s.fontScale = clamp(num(s.fontScale, 1), LIMITS.fontScale[0], LIMITS.fontScale[1]);
    s.lineHeight = clamp(num(s.lineHeight, 1.85), LIMITS.lineHeight[0], LIMITS.lineHeight[1]);
    s.letter = clamp(num(s.letter, 0), LIMITS.letter[0], LIMITS.letter[1]);
    s.rate = clamp(num(s.rate, 1), LIMITS.rate[0], LIMITS.rate[1]);
    s.scrollSpeed = clamp(num(s.scrollSpeed, 3), LIMITS.scrollSpeed[0], LIMITS.scrollSpeed[1]);
    if (['dark', 'paper', 'sepia', 'contrast'].indexOf(s.page) < 0) s.page = 'dark';
    if (['sinhala', 'serif', 'system'].indexOf(s.font) < 0) s.font = 'sinhala';
    if (['narrow', 'normal', 'wide'].indexOf(s.measure) < 0) s.measure = 'normal';
    s.focus = !!s.focus;
    return s;
  }

  function writeStore(s) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  const state = readStore();

  // ------------------------------------------------------------------ events

  const bus = {};
  function on(evt, fn) {
    (bus[evt] = bus[evt] || []).push(fn);
    return () => {
      bus[evt] = (bus[evt] || []).filter((f) => f !== fn);
    };
  }
  function emit(evt, payload) {
    (bus[evt] || []).forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.warn('[reader-tools] listener error', e);
      }
    });
  }

  // ------------------------------------------------------------------ icons

  const ICON = {
    fab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 015.5 4H10a2 2 0 012 2v13a1.6 1.6 0 00-1.6-1.6H4z"/><path d="M20 5.5A1.5 1.5 0 0018.5 4H14a2 2 0 00-2 2v13a1.6 1.6 0 011.6-1.6H20z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>',
    voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 6a9 9 0 010 12"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 1014.6-5.9"/><path d="M19 3v4.5h-4.5"/></svg>',
  };

  // ------------------------------------------------------------------ styles

  const CSS = [
    '.rtk-root{--rtk-accent:#01ad9f;--rtk-accent-soft:rgba(1,173,159,.14);--rtk-bg:#0c0d10;--rtk-bg2:#12141a;--rtk-fg:#f8f8ff;--rtk-muted:rgba(248,248,255,.6);--rtk-line:rgba(255,255,255,.09);--rtk-z:99990;font-family:inherit}',
    '.rtk-root *{box-sizing:border-box}',

    // progress
    '.rtk-progress{position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,#01ad9f,#34d399);z-index:99991;transition:width .12s linear;pointer-events:none;border-bottom-right-radius:3px}',

    // fab
    '.rtk-fab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:99992;display:flex;flex-direction:column;align-items:center;gap:4px;padding:11px 8px 12px;border:1px solid rgba(1,173,159,.4);border-right:0;border-radius:14px 0 0 14px;background:rgba(12,13,16,.94);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);color:#01ad9f;cursor:pointer;box-shadow:-6px 0 22px rgba(0,0,0,.45);transition:background .2s ease,color .2s ease,padding .2s ease}',
    '.rtk-fab:hover{background:#01ad9f;color:#010203;padding-right:12px}',
    '.rtk-fab svg{width:20px;height:20px;display:block}',
    '.rtk-fab-label{font-size:9.5px;font-weight:800;letter-spacing:.06em;writing-mode:vertical-rl;text-orientation:mixed}',
    '.rtk-root[data-open="1"] .rtk-fab{opacity:0;pointer-events:none}',

    // scrim + panel
    '.rtk-scrim{position:fixed;inset:0;z-index:99993;background:rgba(1,2,3,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .28s ease}',
    '.rtk-root[data-open="1"] .rtk-scrim{opacity:1;pointer-events:auto}',
    '.rtk-panel{position:fixed;top:0;right:0;height:100%;width:min(92vw,336px);z-index:99994;display:flex;flex-direction:column;background:var(--rtk-bg);border-left:1px solid var(--rtk-line);box-shadow:-18px 0 50px rgba(0,0,0,.6);color:var(--rtk-fg);transform:translateX(102%);transition:transform .3s cubic-bezier(.22,1,.36,1);overscroll-behavior:contain}',
    '.rtk-root[data-open="1"] .rtk-panel{transform:translateX(0)}',
    '.rtk-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 14px 12px;border-bottom:1px solid var(--rtk-line);flex:0 0 auto}',
    '.rtk-title{font-size:13px;font-weight:800;letter-spacing:.02em;margin:0}',
    '.rtk-sub{font-size:10.5px;font-weight:600;color:var(--rtk-muted);margin:3px 0 0}',
    '.rtk-x{display:flex;align-items:center;justify-content:center;width:30px;height:30px;flex:0 0 auto;border:1px solid var(--rtk-line);border-radius:999px;background:transparent;color:var(--rtk-fg);cursor:pointer;transition:background .18s ease}',
    '.rtk-x:hover{background:rgba(239,68,68,.16);border-color:rgba(239,68,68,.45);color:#f87171}',
    '.rtk-x svg{width:15px;height:15px}',

    // tabs
    '.rtk-tabs{display:flex;gap:2px;padding:8px 8px 0;border-bottom:1px solid var(--rtk-line);flex:0 0 auto;overflow-x:auto;scrollbar-width:none}',
    '.rtk-tabs::-webkit-scrollbar{display:none}',
    '.rtk-tab{display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 9px 8px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--rtk-muted);font-size:9.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:color .18s ease,border-color .18s ease}',
    '.rtk-tab svg{width:16px;height:16px}',
    '.rtk-tab[aria-selected="true"]{color:var(--rtk-accent);border-bottom-color:var(--rtk-accent)}',

    // body
    '.rtk-body{flex:1 1 auto;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:14px;-webkit-overflow-scrolling:touch}',
    '.rtk-group{display:flex;flex-direction:column;gap:7px}',
    '.rtk-label{font-size:10px;font-weight:800;letter-spacing:.07em;color:var(--rtk-muted);margin:0}',
    '.rtk-row{display:flex;align-items:center;gap:8px}',
    '.rtk-seg{display:flex;gap:4px;flex-wrap:wrap}',
    '.rtk-chip{flex:1 1 auto;min-width:56px;padding:8px 6px;border:1px solid var(--rtk-line);border-radius:10px;background:var(--rtk-bg2);color:var(--rtk-fg);font-size:11px;font-weight:700;cursor:pointer;transition:border-color .18s ease,background .18s ease,color .18s ease}',
    '.rtk-chip:hover{border-color:rgba(1,173,159,.5)}',
    '.rtk-chip[aria-pressed="true"]{background:var(--rtk-accent-soft);border-color:rgba(1,173,159,.6);color:var(--rtk-accent)}',
    '.rtk-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;border:1px solid var(--rtk-line);border-radius:10px;background:var(--rtk-bg2);color:var(--rtk-fg);font-size:11.5px;font-weight:700;cursor:pointer;transition:background .18s ease,border-color .18s ease}',
    '.rtk-btn:hover{border-color:rgba(1,173,159,.5)}',
    '.rtk-btn[data-primary="1"]{background:var(--rtk-accent);border-color:var(--rtk-accent);color:#010203}',
    '.rtk-btn svg{width:15px;height:15px}',
    '.rtk-btn:disabled{opacity:.45;cursor:not-allowed}',
    '.rtk-range{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:999px;background:rgba(255,255,255,.14);outline:none;touch-action:pan-y}',
    '.rtk-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:999px;background:var(--rtk-accent);border:2px solid #0c0d10;cursor:pointer}',
    '.rtk-range::-moz-range-thumb{width:14px;height:14px;border:2px solid #0c0d10;border-radius:999px;background:var(--rtk-accent);cursor:pointer}',
    '.rtk-val{min-width:38px;text-align:right;font-size:10.5px;font-weight:800;color:var(--rtk-accent);font-variant-numeric:tabular-nums}',
    '.rtk-select{width:100%;padding:9px 10px;border:1px solid var(--rtk-line);border-radius:10px;background:var(--rtk-bg2);color:var(--rtk-fg);font-size:11.5px;font-weight:600}',
    '.rtk-note{margin:0;padding:9px 10px;border:1px solid rgba(1,173,159,.3);border-radius:10px;background:rgba(1,173,159,.07);color:var(--rtk-accent);font-size:10.5px;line-height:1.65}',
    '.rtk-warn{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.08);color:#fbbf24}',
    '.rtk-stats{display:flex;gap:8px}',
    '.rtk-stat{flex:1;padding:10px 8px;border:1px solid var(--rtk-line);border-radius:12px;background:var(--rtk-bg2);text-align:center}',
    '.rtk-stat b{display:block;font-size:15px;color:var(--rtk-accent);font-variant-numeric:tabular-nums}',
    '.rtk-stat span{font-size:9.5px;font-weight:700;color:var(--rtk-muted)}',

    // toc
    '.rtk-toc{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}',
    '.rtk-toc a{display:block;padding:7px 9px;border-radius:9px;border-left:2px solid transparent;color:var(--rtk-fg);font-size:11.5px;line-height:1.55;text-decoration:none;transition:background .18s ease}',
    '.rtk-toc a:hover{background:var(--rtk-accent-soft);border-left-color:var(--rtk-accent)}',
    '.rtk-toc a[data-active="1"]{background:var(--rtk-accent-soft);border-left-color:var(--rtk-accent);color:var(--rtk-accent);font-weight:700}',
    '.rtk-toc li[data-lvl="3"] a{padding-left:20px;font-size:11px;color:var(--rtk-muted)}',
    '.rtk-toc li[data-lvl="4"] a{padding-left:30px;font-size:10.5px;color:var(--rtk-muted)}',
    '.rtk-empty{font-size:11px;color:var(--rtk-muted);line-height:1.7;margin:0}',

    // reading surfaces (article only — header/footer untouched)
    '.rtk-surface{--rt-font-scale:1;--rt-line-height:1.85;--rt-letter:0em;font-size:calc(1rem * var(--rt-font-scale));line-height:var(--rt-line-height);letter-spacing:var(--rt-letter);transition:background-color .25s ease,color .25s ease}',
    '.rtk-surface p,.rtk-surface li,.rtk-surface blockquote{line-height:inherit;letter-spacing:inherit}',
    'html[data-rt-font="sinhala"] .rtk-surface{font-family:"Noto Sans Sinhala","Iskoola Pota","Abhaya Libre",sans-serif}',
    'html[data-rt-font="serif"] .rtk-surface{font-family:"Abhaya Libre","Noto Serif Sinhala",Georgia,serif}',
    'html[data-rt-font="system"] .rtk-surface{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
    'html[data-rt-page="paper"] .rtk-surface{background:#f6f3ec !important;color:#1f2328 !important;border-radius:14px;padding:16px}',
    'html[data-rt-page="sepia"] .rtk-surface{background:#f2e4cd !important;color:#4a3826 !important;border-radius:14px;padding:16px}',
    'html[data-rt-page="contrast"] .rtk-surface{background:#000 !important;color:#fff !important;border-radius:14px;padding:16px}',
    'html[data-rt-page="paper"] .rtk-surface :is(p,li,h2,h3,h4,blockquote,span,strong,em,div){color:inherit !important;background:transparent !important}',
    'html[data-rt-page="sepia"] .rtk-surface :is(p,li,h2,h3,h4,blockquote,span,strong,em,div){color:inherit !important;background:transparent !important}',
    'html[data-rt-page="contrast"] .rtk-surface :is(p,li,h2,h3,h4,blockquote,span,strong,em,div){color:inherit !important;background:transparent !important}',
    'html[data-rt-measure="narrow"] .rtk-surface{max-width:34rem;margin-left:auto;margin-right:auto}',
    'html[data-rt-measure="wide"] .rtk-surface{max-width:none}',

    // focus mode
    'html[data-rt-focus="on"] [data-rt-dim]{opacity:.12;filter:saturate(.4);transition:opacity .3s ease}',
    'html[data-rt-focus="on"] [data-rt-dim]:hover{opacity:.6}',

    // tts highlight
    '.rtk-speaking{background:rgba(1,173,159,.16) !important;box-shadow:inset 3px 0 0 #01ad9f;border-radius:6px;transition:background .2s ease}',

    // mobile bottom sheet
    '@media (max-width:640px){.rtk-panel{top:auto;bottom:0;right:0;left:0;width:100%;height:min(82vh,560px);border-left:0;border-top:1px solid var(--rtk-line);border-radius:18px 18px 0 0;transform:translateY(102%)}.rtk-root[data-open="1"] .rtk-panel{transform:translateY(0)}.rtk-fab{top:auto;bottom:86px;transform:none}}',

    // a11y / print
    '@media (prefers-reduced-motion:reduce){.rtk-panel,.rtk-scrim,.rtk-progress{transition:none !important}}',
    '@media print{.rtk-root{display:none !important}}',
  ].join('\n');

  function injectStyles() {
    if ($('#rtk-style')) return;
    document.head.appendChild(el('style', { id: 'rtk-style', html: CSS }));
  }

  // ------------------------------------------------------------------ article

  let article = null;

  function findArticle() {
    for (let i = 0; i < ARTICLE_CANDIDATES.length; i++) {
      const node = $(ARTICLE_CANDIDATES[i]);
      if (node && (node.textContent || '').trim().length >= MIN_ARTICLE_CHARS) return node;
    }
    return null;
  }

  function markDimTargets() {
    ['header', 'footer', '#comments', '.related-posts', 'aside'].forEach((sel) => {
      $$(sel).forEach((n) => {
        if (!n.closest('.rtk-root')) n.setAttribute('data-rt-dim', '');
      });
    });
  }

  function articleText() {
    if (!article) return '';
    return (article.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function wordCount() {
    const t = articleText();
    return t ? t.split(/\s+/).length : 0;
  }

  // ------------------------------------------------------------------ state

  function applyState() {
    const r = document.documentElement;
    r.setAttribute('data-rt-page', state.page);
    r.setAttribute('data-rt-font', state.font);
    r.setAttribute('data-rt-measure', state.measure);
    r.setAttribute('data-rt-focus', state.focus ? 'on' : 'off');
    r.style.setProperty('--rt-font-scale', String(state.fontScale));
    r.style.setProperty('--rt-line-height', String(state.lineHeight));
    r.style.setProperty('--rt-letter', state.letter + 'em');

    if (article) {
      article.classList.add('rtk-surface');
      article.style.setProperty('--rt-font-scale', String(state.fontScale));
      article.style.setProperty('--rt-line-height', String(state.lineHeight));
      article.style.setProperty('--rt-letter', state.letter + 'em');
    }
    if (state.focus) markDimTargets();
  }

  function set(patch) {
    Object.assign(state, patch || {});
    applyState();
    writeStore(state);
    emit('change', state);
  }

  // ------------------------------------------------------------------ ui

  const ui = { root: null, progress: null, fab: null, scrim: null, panel: null, tabsEl: null, bodyEl: null, subEl: null };
  let isOpen = false;
  let activeTab = null;

  function buildUI() {
    let root = $('.rtk-root') || $('.rt-root');
    if (root) root.innerHTML = '';
    else {
      root = el('div', {});
      document.body.appendChild(root);
    }
    root.className = 'rtk-root rt-root';
    root.setAttribute('data-open', '0');
    root.setAttribute('data-allow-select', '');

    const progress = el('div', { class: 'rtk-progress', 'aria-hidden': 'true' });

    const fab = el(
      'button',
      { class: 'rtk-fab', type: 'button', 'aria-label': 'කියවීමේ මෙවලම්', onclick: open },
      [el('span', { html: ICON.fab, 'aria-hidden': 'true' }), el('span', { class: 'rtk-fab-label', text: 'මෙවලම්' })]
    );

    const scrim = el('div', { class: 'rtk-scrim', onclick: close, 'aria-hidden': 'true' });

    const subEl = el('p', { class: 'rtk-sub', text: '' });
    const head = el('div', { class: 'rtk-head' }, [
      el('div', {}, [el('h2', { class: 'rtk-title', text: 'කියවීමේ මෙවලම්' }), subEl]),
      el('button', { class: 'rtk-x', type: 'button', 'aria-label': 'වසන්න', html: ICON.close, onclick: close }),
    ]);

    const tabsEl = el('div', { class: 'rtk-tabs', role: 'tablist' });
    const bodyEl = el('div', { class: 'rtk-body' });

    const panel = el(
      'aside',
      { class: 'rtk-panel', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'කියවීමේ මෙවලම්', tabindex: '-1' },
      [head, tabsEl, bodyEl]
    );

    root.appendChild(progress);
    root.appendChild(fab);
    root.appendChild(scrim);
    root.appendChild(panel);

    ui.root = root;
    ui.progress = progress;
    ui.fab = fab;
    ui.scrim = scrim;
    ui.panel = panel;
    ui.tabsEl = tabsEl;
    ui.bodyEl = bodyEl;
    ui.subEl = subEl;
  }

  function open() {
    if (!ui.root || isOpen) return;
    if (document.documentElement.classList.contains('age-gate-pending')) return;
    isOpen = true;
    ui.root.setAttribute('data-open', '1');
    if (!activeTab && tools.length) showTab(tools[0].id);
    setTimeout(() => {
      try {
        ui.panel.focus();
      } catch (e) {}
    }, 60);
    emit('open');
  }

  function close() {
    if (!ui.root || !isOpen) return;
    isOpen = false;
    ui.root.setAttribute('data-open', '0');
    emit('close');
  }

  function updateSub() {
    if (!ui.subEl) return;
    const w = wordCount();
    ui.subEl.textContent = w ? w.toLocaleString('en-US') + ' වචන · ' + Math.max(1, Math.round(w / WORDS_PER_MIN)) + ' මිනිත්තු' : '';
  }

  // ------------------------------------------------------------------ registry

  const tools = [];
  let cleanupCurrent = null;

  function register(tool) {
    if (!tool || !tool.id || typeof tool.mount !== 'function') {
      console.warn('[reader-tools] invalid tool', tool);
      return;
    }
    for (let i = 0; i < tools.length; i++) if (tools[i].id === tool.id) return;
    tools.push(Object.assign({ order: 100, label: tool.id, icon: '' }, tool));
    tools.sort((a, b) => a.order - b.order);
    if (ui.tabsEl) renderTabs();
  }

  function renderTabs() {
    if (!ui.tabsEl) return;
    ui.tabsEl.innerHTML = '';
    tools.forEach((t) => {
      const btn = el(
        'button',
        {
          class: 'rtk-tab',
          type: 'button',
          role: 'tab',
          'data-tab': t.id,
          'aria-selected': activeTab === t.id ? 'true' : 'false',
          onclick: () => showTab(t.id),
        },
        [el('span', { html: t.icon || '', 'aria-hidden': 'true' }), el('span', { text: t.label })]
      );
      ui.tabsEl.appendChild(btn);
    });
  }

  function showTab(id) {
    const tool = tools.filter((t) => t.id === id)[0];
    if (!tool || !ui.bodyEl) return;

    if (typeof cleanupCurrent === 'function') {
      try {
        cleanupCurrent();
      } catch (e) {}
    }
    cleanupCurrent = null;

    activeTab = id;
    ui.bodyEl.innerHTML = '';
    renderTabs();

    const ctx = { state, set, on, el, $, $$, article, ICON, close, showTab, limits: LIMITS };
    try {
      const maybeCleanup = tool.mount(ui.bodyEl, ctx);
      if (typeof maybeCleanup === 'function') cleanupCurrent = maybeCleanup;
    } catch (e) {
      console.warn('[reader-tools] mount failed: ' + id, e);
      ui.bodyEl.appendChild(el('p', { class: 'rtk-note rtk-warn', text: 'මෙම මෙවලම පූරණය කිරීමේ දෝෂයක්.' }));
    }
  }

  // ------------------------------------------------------------------ ui bits

  function segment(label, value, options, onPick) {
    const seg = el('div', { class: 'rtk-seg' });
    options.forEach((o) => {
      const chip = el('button', {
        class: 'rtk-chip',
        type: 'button',
        text: o.label,
        'aria-pressed': value === o.value ? 'true' : 'false',
        onclick: () => {
          $$('.rtk-chip', seg).forEach((c) => c.setAttribute('aria-pressed', 'false'));
          chip.setAttribute('aria-pressed', 'true');
          onPick(o.value);
        },
      });
      seg.appendChild(chip);
    });
    return el('div', { class: 'rtk-group' }, [el('p', { class: 'rtk-label', text: label }), seg]);
  }

  function slider(label, key, format) {
    const lim = LIMITS[key];
    const out = el('span', { class: 'rtk-val', text: format(state[key]) });
    const input = el('input', {
      class: 'rtk-range',
      type: 'range',
      min: String(lim[0]),
      max: String(lim[1]),
      step: String(lim[2]),
      value: String(state[key]),
      'aria-label': label,
    });
    input.addEventListener('input', () => {
      const v = round(clamp(parseFloat(input.value), lim[0], lim[1]), lim[2]);
      out.textContent = format(v);
      const patch = {};
      patch[key] = v;
      set(patch);
    });
    return el('div', { class: 'rtk-group' }, [
      el('p', { class: 'rtk-label', text: label }),
      el('div', { class: 'rtk-row' }, [input, out]),
    ]);
  }

  // ------------------------------------------------------------------ tool: toc

  register({
    id: 'toc',
    label: 'අන්තර්ගතය',
    icon: ICON.list,
    order: 10,
    mount(box) {
      const w = wordCount();
      box.appendChild(
        el('div', { class: 'rtk-stats' }, [
          el('div', { class: 'rtk-stat' }, [
            el('b', { text: w ? w.toLocaleString('en-US') : '0' }),
            el('span', { text: 'වචන' }),
          ]),
          el('div', { class: 'rtk-stat' }, [
            el('b', { text: String(Math.max(1, Math.round(w / WORDS_PER_MIN))) }),
            el('span', { text: 'මිනිත්තු' }),
          ]),
        ])
      );

      const headings = article ? $$(HEADING_SEL, article).filter((h) => (h.textContent || '').trim()) : [];
      const group = el('div', { class: 'rtk-group' }, [el('p', { class: 'rtk-label', text: 'කොටස්' })]);

      if (!headings.length) {
        group.appendChild(el('p', { class: 'rtk-empty', text: 'මෙම ලිපියේ උපශීර්ෂ නැහැ. පහළ "කියවීම" ටැබ් එකෙන් ස්වයං-අනුචලනය භාවිත කරන්න.' }));
      } else {
        const list = el('ul', { class: 'rtk-toc' });
        const links = [];
        headings.forEach((h, i) => {
          if (!h.id) h.id = 'rt-h-' + i;
          const a = el('a', {
            href: '#' + h.id,
            text: (h.textContent || '').trim(),
            onclick: (ev) => {
              ev.preventDefault();
              h.scrollIntoView({ behavior: 'smooth', block: 'start' });
              close();
            },
          });
          links.push({ a: a, h: h });
          list.appendChild(el('li', { 'data-lvl': h.tagName.slice(1) }, a));
        });
        group.appendChild(list);

        const sync = rafThrottle(() => {
          let current = null;
          links.forEach((p) => {
            if (p.h.getBoundingClientRect().top <= 120) current = p;
          });
          links.forEach((p) => p.a.setAttribute('data-active', p === current ? '1' : '0'));
        });
        sync();
        window.addEventListener('scroll', sync, { passive: true });
        box.appendChild(group);
        return () => window.removeEventListener('scroll', sync);
      }
      box.appendChild(group);
    },
  });

  // ------------------------------------------------------------------ tool: display

  register({
    id: 'display',
    label: 'පෙනුම',
    icon: ICON.type,
    order: 20,
    mount(box) {
      box.appendChild(
        segment(
          'පසුබිම',
          state.page,
          [
            { value: 'dark', label: 'අඳුරු' },
            { value: 'paper', label: 'සුදු' },
            { value: 'sepia', label: 'සෙපියා' },
            { value: 'contrast', label: 'තීව්‍ර' },
          ],
          (v) => set({ page: v })
        )
      );

      box.appendChild(
        segment(
          'අකුරු වර්ගය',
          state.font,
          [
            { value: 'sinhala', label: 'සිංහල' },
            { value: 'serif', label: 'සෙරිෆ්' },
            { value: 'system', label: 'පද්ධති' },
          ],
          (v) => set({ font: v })
        )
      );

      box.appendChild(slider('අකුරු ප්‍රමාණය', 'fontScale', (v) => Math.round(v * 100) + '%'));
      box.appendChild(slider('පේළි පරතරය', 'lineHeight', (v) => v.toFixed(2)));
      box.appendChild(slider('අකුරු පරතරය', 'letter', (v) => (v * 1000).toFixed(0)));

      box.appendChild(
        segment(
          'පේළි පළල',
          state.measure,
          [
            { value: 'narrow', label: 'පටු' },
            { value: 'normal', label: 'සාමාන්‍ය' },
            { value: 'wide', label: 'පළල්' },
          ],
          (v) => set({ measure: v })
        )
      );

      box.appendChild(
        el('button', {
          class: 'rtk-btn',
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
            });
            showTab('display');
          },
        })
      );
    },
  });

  // ------------------------------------------------------------------ tool: voice

  const voiceEngines = {};
  function registerVoiceEngine(id, engine) {
    if (id && engine && typeof engine.speak === 'function') voiceEngines[id] = engine;
  }

  register({
    id: 'voice',
    label: 'හඬ',
    icon: ICON.voice,
    order: 30,
    mount(box) {
      const synth = window.speechSynthesis;
      if (!synth) {
        box.appendChild(el('p', { class: 'rtk-note rtk-warn', text: 'මෙම බ්‍රව්සරය හඬ කියවීම (TTS) සඳහා සහාය නොදක්වයි.' }));
        return;
      }

      const blocks = article ? $$(BLOCK_SEL, article).filter((n) => (n.textContent || '').trim().length > 1) : [];
      if (!blocks.length) {
        box.appendChild(el('p', { class: 'rtk-note rtk-warn', text: 'කියවීමට ලිපි අන්තර්ගතයක් හමු නොවුණි.' }));
        return;
      }

      const status = el('p', { class: 'rtk-note', text: 'සූදානම්.' });
      const select = el('select', { class: 'rtk-select', 'aria-label': 'හඬ තෝරන්න' });
      let idx = 0;
      let speaking = false;
      let stopped = true;

      function fillVoices() {
        const voices = synth.getVoices() || [];
        select.innerHTML = '';
        const si = voices.filter((v) => (v.lang || '').toLowerCase().indexOf('si') === 0);
        const rest = voices.filter((v) => si.indexOf(v) < 0);
        si.concat(rest).forEach((v) => {
          select.appendChild(el('option', { value: v.voiceURI, text: v.name + ' (' + v.lang + ')' }));
        });
        if (state.voiceURI) select.value = state.voiceURI;
        if (!si.length) {
          status.className = 'rtk-note rtk-warn';
          status.textContent = 'සිංහල (si-LK) හඬක් මේ උපාංගයේ නැහැ. Android නම් Settings → Language → Text-to-speech එකෙන් සිංහල pack එක install කරන්න. නැත්නම් වෙනත් හඬක් තෝරන්න — උච්චාරණය නිවැරදි නොවිය හැක.';
        } else {
          status.className = 'rtk-note';
          status.textContent = 'සිංහල හඬ ලබා ගත හැක.';
        }
      }
      fillVoices();
      synth.addEventListener('voiceschanged', fillVoices);

      select.addEventListener('change', () => set({ voiceURI: select.value }));

      function clearHighlight() {
        blocks.forEach((b) => b.classList.remove('rtk-speaking'));
      }

      function speakFrom(i) {
        if (i >= blocks.length) {
          stop();
          status.textContent = 'කියවීම අවසන්.';
          return;
        }
        idx = i;
        clearHighlight();
        const node = blocks[i];
        node.classList.add('rtk-speaking');

        const u = new SpeechSynthesisUtterance((node.textContent || '').trim());
        const voices = synth.getVoices() || [];
        const picked = voices.filter((v) => v.voiceURI === select.value)[0];
        if (picked) {
          u.voice = picked;
          u.lang = picked.lang;
        } else u.lang = 'si-LK';
        u.rate = state.rate;
        u.onend = () => {
          if (!stopped) speakFrom(i + 1);
        };
        u.onerror = () => {
          status.className = 'rtk-note rtk-warn';
          status.textContent = 'හඬ කියවීමේ දෝෂයක්. වෙනත් හඬක් තෝරා නැවත උත්සාහ කරන්න.';
          stop();
        };
        synth.speak(u);
      }

      function play() {
        if (synth.paused && speaking) {
          synth.resume();
          status.textContent = 'කියවනවා...';
          return;
        }
        stopped = false;
        speaking = true;
        status.textContent = 'කියවනවා...';
        synth.cancel();
        speakFrom(idx);
      }

      function pause() {
        if (speaking && !synth.paused) {
          synth.pause();
          status.textContent = 'විරාමයේ.';
        }
      }

      function stop() {
        stopped = true;
        speaking = false;
        try {
          synth.cancel();
        } catch (e) {}
        clearHighlight();
        idx = 0;
        status.textContent = 'නතර කළා.';
      }

      box.appendChild(el('div', { class: 'rtk-group' }, [el('p', { class: 'rtk-label', text: 'හඬ' }), select]));
      box.appendChild(slider('වේගය', 'rate', (v) => v.toFixed(2) + 'x'));
      box.appendChild(
        el('div', { class: 'rtk-row' }, [
          el('button', { class: 'rtk-btn', 'data-primary': '1', type: 'button', html: ICON.play + '<span>කියවන්න</span>', onclick: play }),
          el('button', { class: 'rtk-btn', type: 'button', html: ICON.pause, 'aria-label': 'විරාමය', onclick: pause }),
          el('button', { class: 'rtk-btn', type: 'button', html: ICON.stop, 'aria-label': 'නතර', onclick: stop }),
        ])
      );
      box.appendChild(status);

      return () => {
        synth.removeEventListener('voiceschanged', fillVoices);
        stop();
      };
    },
  });

  // ------------------------------------------------------------------ tool: reading

  register({
    id: 'reading',
    label: 'කියවීම',
    icon: ICON.eye,
    order: 40,
    mount(box) {
      box.appendChild(
        segment(
          'නාභි ආකාරය (focus mode)',
          state.focus ? 'on' : 'off',
          [
            { value: 'off', label: 'ක්‍රියාවිරහිත' },
            { value: 'on', label: 'ක්‍රියාත්මක' },
          ],
          (v) => set({ focus: v === 'on' })
        )
      );

      let rafId = null;
      let carry = 0;
      const toggle = el('button', {
        class: 'rtk-btn',
        type: 'button',
        html: ICON.down + '<span>ස්වයං-අනුචලනය අරඹන්න</span>',
      });

      function stopScroll() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        toggle.innerHTML = ICON.down + '<span>ස්වයං-අනුචලනය අරඹන්න</span>';
        toggle.removeAttribute('data-primary');
      }

      function step() {
        carry += state.scrollSpeed * 0.35;
        const whole = Math.floor(carry);
        if (whole >= 1) {
          carry -= whole;
          window.scrollBy(0, whole);
        }
        if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) {
          stopScroll();
          return;
        }
        rafId = requestAnimationFrame(step);
      }

      toggle.addEventListener('click', () => {
        if (rafId) stopScroll();
        else {
          toggle.innerHTML = ICON.pause + '<span>අනුචලනය නවත්වන්න</span>';
          toggle.setAttribute('data-primary', '1');
          rafId = requestAnimationFrame(step);
        }
      });

      box.appendChild(slider('අනුචලන වේගය', 'scrollSpeed', (v) => String(v)));
      box.appendChild(toggle);

      let saved = 0;
      try {
        saved = parseFloat(localStorage.getItem(posKey(location.pathname)) || '0') || 0;
      } catch (e) {}
      if (saved > 0.04 && saved < 0.95) {
        box.appendChild(
          el('button', {
            class: 'rtk-btn',
            type: 'button',
            html: ICON.up + '<span>ඉස්සර කියවපු තැනට (' + Math.round(saved * 100) + '%)</span>',
            onclick: () => {
              const max = document.documentElement.scrollHeight - window.innerHeight;
              window.scrollTo({ top: max * saved, behavior: 'smooth' });
              close();
            },
          })
        );
      }

      box.appendChild(
        el('div', { class: 'rtk-row' }, [
          el('button', {
            class: 'rtk-btn',
            type: 'button',
            html: ICON.up + '<span>මුලට</span>',
            onclick: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
          }),
          el('button', {
            class: 'rtk-btn',
            type: 'button',
            html: ICON.down + '<span>අන්තිමට</span>',
            onclick: () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }),
          }),
        ])
      );

      return stopScroll;
    },
  });

  // ------------------------------------------------------------------ tool: translate

  register({
    id: 'translate',
    label: 'පරිවර්තනය',
    icon: ICON.globe,
    order: 50,
    mount(box) {
      const langs = [
        { code: 'en', label: 'English' },
        { code: 'ta', label: 'தமிழ்' },
        { code: 'hi', label: 'हिन्दी' },
        { code: 'ru', label: 'Русский' },
        { code: 'zh-CN', label: '中文' },
        { code: 'ar', label: 'العربية' },
      ];
      const seg = el('div', { class: 'rtk-seg' });
      langs.forEach((l) => {
        seg.appendChild(
          el('button', {
            class: 'rtk-chip',
            type: 'button',
            text: l.label,
            onclick: () => {
              const u =
                'https://translate.google.com/translate?sl=si&tl=' +
                encodeURIComponent(l.code) +
                '&u=' +
                encodeURIComponent(location.href);
              window.open(u, '_blank', 'noopener,noreferrer');
            },
          })
        );
      });
      box.appendChild(el('div', { class: 'rtk-group' }, [el('p', { class: 'rtk-label', text: 'භාෂාව තෝරන්න' }), seg]));
      box.appendChild(el('p', { class: 'rtk-note', text: 'මෙය Google Translate හි පිටු-පරිවර්තන සේවාව අලුත් කවුළුවක විවෘත කරයි.' }));
    },
  });

  // ------------------------------------------------------------------ progress + position

  let scrollHandler = null;
  let keyHandler = null;

  function bindScroll() {
    const onScroll = rafThrottle(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const pct = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      if (ui.progress) ui.progress.style.width = (pct * 100).toFixed(2) + '%';
      try {
        if (pct > 0.02) localStorage.setItem(posKey(location.pathname), String(round(pct, 0.01)));
      } catch (e) {}
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    scrollHandler = onScroll;
  }

  function unbindScroll() {
    if (!scrollHandler) return;
    window.removeEventListener('scroll', scrollHandler);
    window.removeEventListener('resize', scrollHandler);
    scrollHandler = null;
  }

  function bindKeys() {
    keyHandler = (e) => {
      if (e.key === 'Escape' && isOpen) close();
    };
    document.addEventListener('keydown', keyHandler);
  }

  function unbindKeys() {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }

  // ------------------------------------------------------------------ boot

  function teardown() {
    if (typeof cleanupCurrent === 'function') {
      try {
        cleanupCurrent();
      } catch (e) {}
    }
    cleanupCurrent = null;
    activeTab = null;
    isOpen = false;
    unbindScroll();
    unbindKeys();
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {}
    if (ui.root && ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
    ui.root = null;
    $$('.rtk-speaking').forEach((n) => n.classList.remove('rtk-speaking'));
  }

  function boot() {
    injectStyles();
    article = findArticle();

    if (!article) {
      // ලිපි පිටුවක් නෙමෙයි — panel එක පෙන්නන්නේ නෑ, ඒත් සුරකින ලද පෙනුම යොදනවා.
      applyState();
      if (ui.root && ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
      ui.root = null;
      return;
    }

    buildUI();
    applyState();
    updateSub();
    renderTabs();
    bindScroll();
    bindKeys();
    emit('boot', { article: article });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Astro ClientRouter (view transitions)
  document.addEventListener('astro:before-swap', teardown);
  document.addEventListener('astro:page-load', boot);

  // ------------------------------------------------------------------ public api

  window.ReaderTools = {
    version: 2,
    register: register,
    registerVoiceEngine: registerVoiceEngine,
    open: open,
    close: close,
    showTab: showTab,
    set: set,
    get state() {
      return Object.assign({}, state);
    },
    get article() {
      return article;
    },
    on: on,
    boot: boot,
  };
})();
