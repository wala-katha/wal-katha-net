// ==========================================================================
// Reader Tools — logic only. Chrome + themes = reader-tools.css
// --------------------------------------------------------------------------
// මේ ෆයිල් එකේ slash-star block comment පාවිච්චි කරන්නේ නෑ (nested comment
// නිසා build කැඩෙන ප්‍රශ්නය ආපහු එන්නේ නැති වෙන්නයි).
//
// Panel markup එක මේ script එකම හදනවා. ReaderTools.astro එකේ
// <div class="rt-root" data-rt-root></div> එකක් තිබුණත් නැතත් වැඩ කරනවා.
//
// අලුත් tool එකක් (මේ ෆයිල් එක වෙනස් නොකර):
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

  const DIM_CANDIDATES = ['header', 'footer', '#comments', '.related-posts'];
  const HEADING_SEL = 'h2, h3, h4';
  const BLOCK_SEL = 'p, li, h2, h3, h4, blockquote';
  const MIN_ARTICLE_CHARS = 400;
  const WORDS_PER_MIN = 160;
  const TTS_CHUNK = 170;
  const POS_SAVE_MS = 1500;
  const STORE_DEBOUNCE_MS = 300;

  const DEFAULTS = {
    page: 'dark',
    font: 'sinhala',
    fontScale: 1,
    lineHeight: 1.85,
    letter: 0,
    measure: 'normal',
    focus: false,
    rate: 1,
    pitch: 1,
    voiceURI: '',
    scrollSpeed: 3,
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

  // frame එකකට rAF එකයි. scroll consumer හැමෝම එකම handler එකක් බෙදාගන්නවා;
  // navigation එකකට එකක් බැඳුණු නිසා තමයි කලින් tab එක හිර වුණේ.
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

  // Tracked listeners: එකතු කරන හැම එකක්ම මෙතනින් යනවා, ඒ නිසා teardown
  // එකේදී එකක්වත් ඉතුරු වෙන්නේ නෑ.
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
    s.focus = !!s.focus;
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

  // Debounced writes. Slider drag එකේදී pointer move එකකට synchronous
  // localStorage write එකක් = main thread disk I/O.
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

  // --------------------------------------------------------------- elements

  const ui = {
    root: null, bar: null, fab: null, scrim: null, panel: null,
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
    // duplicate root (Astro markup + JS) එකක් නොතිබෙන බව තහවුරු කරනවා
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

    // හැම boot එකකටම fresh rebuild -> stale node හෝ duplicate නෑ.
    root.textContent = '';
    root.setAttribute('data-open', '0');
    root.setAttribute('data-rt-ready', '0');
    // Base.astro එකේ copy-protection selectstart blocker එකෙන් බේරෙන්න
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
    }, [
      el('span', { class: 'rt-fab-ico', html: ICON.type, 'aria-hidden': 'true' }),
      el('span', { class: 'rt-fab-txt', text: 'මෙවලම්' }),
    ]);

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
    root.appendChild(scrim);
    root.appendChild(panel);

    ui.root = root;
    ui.bar = bar;
    ui.fab = fab;
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

  // Panel එක <aside> එකක්; blanket `aside` selector එකක් panel එකම dim කළා.
  // ඒ නිසා explicit list + containment guard.
  function markDim() {
    DIM_CANDIDATES.forEach((sel) => {
      $$(sel).forEach((n) => {
        if (ui.root && (ui.root.contains(n) || n.contains(ui.root))) return;
        if (article && (n.contains(article) || article.contains(n))) return;
        n.setAttribute('data-rt-dim', '');
      });
    });
  }

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

    // ලිපියක් නැති පිටුවක (home / category / tag) focus mode කිසි විටෙක
    // ක්‍රියාත්මක නොවේ — header/footer නොපෙනීමේ ගැටලුවට මූලික හේතුව මෙයයි.
    const focusOn = !!state.focus && !!article;
    r.setAttribute('data-rt-focus', focusOn ? 'on' : 'off');
    if (focusOn) markDim();
    else clearDim();
  }

  function set(patch, opts) {
    Object.assign(state, patch || {});
    apply();
    if (opts && opts.immediate) saveNow();
    else save();
    emit('change', state);
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

  function slider(label, key, fmt) {
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
    });
    input.addEventListener('change', saveNow);
    // touch drag එක page scroll එකට යන්නේ නැති බව තහවුරු කරනවා
    input.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    return el('div', { class: 'rt-group' }, [
      el('p', { class: 'rt-label', text: label }),
      el('div', { class: 'rt-row' }, [input, out]),
    ]);
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

      // per-frame querySelector එකක් වෙනුවට cache
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
          text: 'මෙම ලිපියේ උපශීර්ෂ නැහැ. "කියවීම" ටැබ් එකෙන් ස්වයං-අනුචලනය භාවිත කරන්න.',
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
            h.scrollIntoView({ behavior: behavior(), block: 'start' });
            if (isMobile()) close();
          },
        });
        pairs.push({ a: a, h: h });
        list.appendChild(el('li', { 'data-lvl': h.tagName.slice(1) }, a));
      });
      group.appendChild(list);
      box.appendChild(group);

      // තමන්ගේ scroll listener එකක් නෑ — shared handler එක මේක call කරනවා.
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

  // Chrome එක තනි utterance එකක් ~15s ට වැඩි වුණාම කපනවා, ඒ නිසා දිග
  // ඡේද මැදින් නැවතුණා. වාක්‍ය මායිම්වලින් කඩනවා.
  function chunk(text) {
    const out = [];
    let rest = (text || '').replace(/\s+/g, ' ').trim();
    while (rest.length > TTS_CHUNK) {
      let cut = -1;
      const head = rest.slice(0, TTS_CHUNK);
      const seps = ['. ', '! ', '? ', '। ', ', ', ' '];
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
      tts = { i: 0, playing: false, stopped: true, userPaused: false, kick: null };

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
      // Chrome list එක async විදිහට පුරවනවා; event එක එකකට වඩා වාරයක්
      // වෙඩි වෙන්න පුළුවන් නිසා fillVoices idempotent.
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
        u.onend = () => {
          if (tts && !tts.stopped) speakAt(i + 1);
        };
        u.onerror = (ev) => {
          if (ev && (ev.error === 'interrupted' || ev.error === 'canceled')) return;
          note.setAttribute('data-warn', '1');
          note.textContent = 'හඬ කියවීමේ දෝෂයක්. වෙනත් හඬක් තෝරා නැවත උත්සාහ කරන්න.';
          ttsStopHard();
          label('කියවන්න');
        };
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
        tts.stopped = false;
        tts.playing = true;
        tts.userPaused = false;
        note.removeAttribute('data-warn');
        note.textContent = 'කියවනවා...';
        label('කියවනවා');
        // Safari එක cancel() එකම tick එකේ speak() එකක් අත් හරිනවා.
        try { synth.cancel(); } catch (e) {}
        tts.kick = setTimeout(() => {
          if (!tts) return;
          tts.kick = null;
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

      function stop() {
        ttsStopHard();
        if (tts) tts.i = 0;
        label('කියවන්න');
        note.removeAttribute('data-warn');
        note.textContent = 'නතර කළා.';
      }

      btnPlay.addEventListener('click', play);
      btnPause.addEventListener('click', pause);
      btnStop.addEventListener('click', stop);

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
        text: 'කොටස් ' + queue.length + 'ක් පෝලිමේ. පිටුව මාරු වූ විට හඬ ස්වයංක්‍රීයව නවතී.',
      }));

      return () => {
        clearTimeout(poll);
        synth.removeEventListener('voiceschanged', fillVoices);
        ttsStopHard();
        tts = null;
      };
    },
  });

  // --------------------------------------------------------- tool: reading

  register({
    id: 'reading',
    label: 'කියවීම',
    icon: ICON.eye,
    order: 40,
    mount(box) {
      box.appendChild(segment('නාභි ආකාරය', state.focus ? 'on' : 'off', [
        { value: 'off', label: 'ක්‍රියාවිරහිත' },
        { value: 'on', label: 'ක්‍රියාත්මක' },
      ], (v) => set({ focus: v === 'on' }, { immediate: true })));

      let raf = null;
      let carry = 0;
      const btn = el('button', {
        class: 'rt-btn', type: 'button',
        html: ICON.down + '<span>ස්වයං-අනුචලනය</span>',
      });

      function stopScroll() {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        btn.innerHTML = ICON.down + '<span>ස්වයං-අනුචලනය</span>';
        btn.removeAttribute('data-primary');
      }

      function step() {
        carry += state.scrollSpeed * 0.35;
        const whole = Math.floor(carry);
        if (whole >= 1) {
          carry -= whole;
          window.scrollBy(0, whole);
        }
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
          stopScroll();
          return;
        }
        raf = requestAnimationFrame(step);
      }

      btn.addEventListener('click', () => {
        if (raf) { stopScroll(); return; }
        carry = 0;
        btn.innerHTML = ICON.pause + '<span>අනුචලනය නවත්වන්න</span>';
        btn.setAttribute('data-primary', '1');
        raf = requestAnimationFrame(step);
      });

      // Manual input එකකින් නවතිනවා. නමුත් panel එක ඇතුළේ සිදු වන
      // touch/wheel එකකින් නවතුනොත් ඒ click එකම ආපහු start කරනවා —
      // ඒ නිසා root එක ඇතුළේ event නොසලකනවා.
      const abort = (ev) => {
        if (!raf) return;
        if (ui.root && ev && ev.target && ui.root.contains(ev.target)) return;
        stopScroll();
      };
      ['wheel', 'touchstart', 'keydown'].forEach((t) =>
        window.addEventListener(t, abort, { passive: true })
      );

      box.appendChild(slider('අනුචලන වේගය', 'scrollSpeed', (v) => String(v)));
      box.appendChild(btn);

      let saved = 0;
      try {
        saved = parseFloat(localStorage.getItem(posKey(curPath)) || '0') || 0;
      } catch (e) {}
      if (saved > 0.04 && saved < 0.95) {
        box.appendChild(el('button', {
          class: 'rt-btn',
          type: 'button',
          html: ICON.up + '<span>කලින් නැවතුණ තැනට (' + Math.round(saved * 100) + '%)</span>',
          onclick: () => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            window.scrollTo({ top: max * saved, behavior: behavior() });
            if (isMobile()) close();
          },
        }));
      }

      box.appendChild(el('div', { class: 'rt-row' }, [
        el('button', {
          class: 'rt-btn', type: 'button', html: ICON.up + '<span>මුලට</span>',
          onclick: () => window.scrollTo({ top: 0, behavior: behavior() }),
        }),
        el('button', {
          class: 'rt-btn', type: 'button', html: ICON.down + '<span>අන්තිමට</span>',
          onclick: () => window.scrollTo({
            top: document.documentElement.scrollHeight, behavior: behavior(),
          }),
        }),
      ]));

      return () => {
        stopScroll();
        ['wheel', 'touchstart', 'keydown'].forEach((t) => window.removeEventListener(t, abort));
      };
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
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 4 ? clamp(window.scrollY / max, 0, 1) : 0;
    lastPct = pct;

    // width නෙවෙයි transform: compositor එකේ රැඳෙනවා, frame එකකට layout නෑ.
    if (ui.bar) ui.bar.style.transform = 'scaleX(' + pct.toFixed(4) + ')';

    // panel එක වැහුණු විට DOM වැඩක් නෑ.
    if (isOpen) {
      if (pctEl) pctEl.textContent = Math.round(pct * 100) + '%';
      if (tocSync) tocSync();
    }

    // localStorage = synchronous disk I/O. frame එකකට ලියපු එක තමයි
    // scroll freeze එකේ ප්‍රධාන හේතුව; 1.5s එකකට එකක් ඇති.
    const now = Date.now();
    if (pct > 0.02 && now - lastSave > POS_SAVE_MS) {
      lastSave = now;
      try {
        localStorage.setItem(posKey(curPath), pct.toFixed(3));
      } catch (e) {}
    }
  });

  function flushPos() {
    if (lastPct > 0.02) {
      try {
        localStorage.setItem(posKey(curPath), lastPct.toFixed(3));
      } catch (e) {}
    }
    saveNow();
  }

  // -------------------------------------------------------- boot/teardown

  let booted = false;

  function bindGlobal() {
    listen(ui.fab, 'click', toggle);
    listen(ui.close, 'click', close);
    listen(ui.scrim, 'click', close);
    listen(window, 'scroll', onScroll, { passive: true });
    listen(window, 'resize', onScroll, { passive: true });
    listen(document, 'keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        e.stopPropagation();
        close();
        return;
      }
      if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        toggle();
        return;
      }
      trap(e);
    });
    listen(window, 'pagehide', flushPos);
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushPos();
        if (window.speechSynthesis && tts && tts.playing && !window.speechSynthesis.paused) {
          try { window.speechSynthesis.pause(); } catch (e) {}
        }
      } else if (window.speechSynthesis && tts && tts.playing && !tts.userPaused) {
        try { window.speechSynthesis.resume(); } catch (e) {}
      }
    });
    // age gate එක verify වුණාම class එක අයින් කරනවා; එවිට ආපහු බලනවා.
    listen(document, 'wk:age-verified', () => {
      if (ui.root && article) ui.root.setAttribute('data-rt-ready', '1');
    });
  }

  function teardown() {
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
    if (ui.root) {
      ui.root.setAttribute('data-open', '0');
      ui.root.setAttribute('data-rt-ready', '0');
    }
    clearDim();
    document.documentElement.setAttribute('data-rt-focus', 'off');
    document.documentElement.removeAttribute('data-rt-has-article');
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

    article = findArticle();
    apply();

    if (!article) {
      // ලිපියක් නෙමෙයි (home / category / tag): FAB, progress, panel නෑ.
      // dim එකත් apply() එකෙන් පිරිසිදු වුණා, ඒ නිසා header/footer නොපෙනීම නෑ.
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

  // ClientRouter: before-swap එකෙන් සියල්ල teardown වෙනවා, ඒ නිසා handler,
  // rAF හෝ utterance එකක් ඊළඟ පිටුවට යන්නේ නෑ. page-load එකෙන් නැවත හදනවා.
  // `booted` flag එකෙන් DOMContentLoaded + page-load double-fire නිරුපද්‍රිතයි.
  document.addEventListener('astro:before-swap', teardown);
  document.addEventListener('astro:page-load', boot);

  // ---------------------------------------------------------------- api

  window.ReaderTools = {
    version: 4,
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
    get state() { return Object.assign({}, state); },
    get article() { return article; },
    get tools() { return tools.map((t) => t.id); },
    get engines() { return Object.keys(engines); },
  };
})();
