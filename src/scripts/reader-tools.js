/* ==========================================================================
   Reader Tools — core + built-in tools (v1)
   --------------------------------------------------------------------------
   Dependency නැහැ. අලුත් tool එකක් එකතු කරන්න:

     ReaderTools.register({
       id: 'bookmarks',
       label: 'සලකුණු',
       icon: '<svg…>',
       order: 60,
       mount(container, ctx) { ...; return () => cleanup(); }
     });

   Article element එක auto-detect වෙනවා. ඕන නම් layout එකේ
   data-rt-article දාලා override කරන්න පුළුවන්.
   ========================================================================== */
(() => {
  'use strict';

  const STORE_KEY = 'wk:reader:v1';
  const posKey = (p) => `wk:reader:pos:${p}`;

  /* article auto-detect — මුලින්ම match වෙන, text ප්‍රමාණවත් එක තෝරනවා */
  const ARTICLE_CANDIDATES = [
    '[data-rt-article]',
    'article .prose',
    '.post-content',
    '.post-body',
    '.entry-content',
    '.prose',
    'article',
    'main article',
    'main',
  ];
  const HEADING_SEL = 'h2, h3, h4';
  const MIN_ARTICLE_CHARS = 400;

  const DEFAULTS = {
    theme: 'dark',
    fontScale: 1,
    lineHeight: 1.8,
    letter: 0,
    font: 'sans',
    measure: 'normal',
    focus: false,
    rate: 1,
    voiceURI: '',
    tab: 'toc',
  };

  /* ---------------- storage ---------------- */
  const store = {
    read() {
      try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
      } catch {
        return { ...DEFAULTS };
      }
    },
    write(s) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
    },
  };

  let state = store.read();

  /* ---------------- helpers ---------------- */
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  const el = (tag, attrs = {}, html = '') => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      n.setAttribute(k, v === true ? '' : String(v));
    }
    if (html) n.innerHTML = html;
    return n;
  };

  let _article = null;
  function article() {
    if (_article && _article.isConnected) return _article;
    _article = null;
    for (const sel of ARTICLE_CANDIDATES) {
      const n = $(sel);
      if (!n) continue;
      const len = (n.textContent || '').trim().length;
      if (sel === '[data-rt-article]' || len >= MIN_ARTICLE_CHARS) {
        _article = n;
        break;
      }
    }
    if (_article && !_article.hasAttribute('data-rt-article')) {
      _article.setAttribute('data-rt-article', '');
    }
    return _article;
  }

  /* focus mode එකේදී මැකෙන්න ඕන දේ auto-mark */
  let dimMarked = false;
  function markDimTargets() {
    if (dimMarked) return;
    const a = article();
    if (!a) return;
    let node = a;
    while (node && node !== document.body) {
      const parent = node.parentElement;
      if (!parent) break;
      Array.from(parent.children).forEach((sib) => {
        if (sib === node) return;
        if (sib.closest('.rt-root')) return;
        if (sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE' || sib.tagName === 'LINK') return;
        sib.setAttribute('data-rt-dim', '');
      });
      node = parent;
    }
    dimMarked = true;
  }

  const ICON = {
    panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    aa:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 18 7.5 6l4.5 12M4.6 14h5.8M14 18l3.5-9L21 18m-6.2-3h4.9"/></svg>',
    voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    eye:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    stop:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>',
  };

  /* ---------------- tiny event bus ---------------- */
  const bus = new Map();

  function on(ev, fn) {
    if (!bus.has(ev)) bus.set(ev, new Set());
    bus.get(ev).add(fn);
    return () => bus.get(ev)?.delete(fn);
  }

  function emit(ev, data) {
    (bus.get(ev) || []).forEach((f) => {
      try { f(data); } catch (e) { console.error('[reader-tools]', e); }
    });
  }

  /* ---------------- apply prefs ---------------- */
  function apply() {
    const r = document.documentElement;
    r.dataset.theme = state.theme;
    r.dataset.rtFont = state.font;
    r.dataset.rtMeasure = state.measure;
    r.dataset.rtFocus = state.focus ? 'on' : 'off';
    r.style.setProperty('--rt-font-scale', state.fontScale);
    r.style.setProperty('--rt-line-height', state.lineHeight);
    r.style.setProperty('--rt-letter', state.letter + 'em');
    r.style.colorScheme = state.theme === 'light' ? 'light' : 'dark';
    if (state.focus) markDimTargets();
  }

  function set(patch) {
    state = { ...state, ...patch };
    store.write(state);
    apply();
    emit('change', state);
  }

  /* ---------------- tool registry ---------------- */
  const tools = [];
  let cleanupCurrent = null;

  function register(tool) {
    if (!tool || !tool.id || typeof tool.mount !== 'function') {
      console.warn('[reader-tools] invalid tool', tool);
      return;
    }
    if (tools.some((t) => t.id === tool.id)) return;
    tools.push({ order: 100, label: tool.id, icon: '', ...tool });
    tools.sort((a, b) => a.order - b.order);
    if (ui.tabsEl) renderTabs();
  }

  /* ---------------- UI shell ---------------- */
  const ui = {};

  function build() {
    const root = $('[data-rt-root]');
    if (!root) return false;

    ui.root = root;
    ui.progress = $('.rt-progress > i', root);
    ui.fab = $('.rt-fab', root);
    ui.scrim = $('.rt-scrim', root);
    ui.panel = $('.rt-panel', root);
    ui.title = $('.rt-title', root);
    ui.tabsEl = $('.rt-tabs', root);
    ui.body = $('.rt-body', root);
    ui.closeBtn = $('.rt-close', root);

    if (!ui.fab || !ui.panel || !ui.tabsEl || !ui.body) return false;

    ui.fab.addEventListener('click', () => open());
    ui.closeBtn?.addEventListener('click', () => close());
    ui.scrim?.addEventListener('click', () => close());

    document.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') { close(); ui.fab.focus(); }
      else if (e.key === 'Tab' && window.innerWidth <= 640) trapFocus(e);
    });

    return true;
  }

  function trapFocus(e) {
    const f = $$('button, [href], select, input, [tabindex]:not([tabindex="-1"])', ui.panel)
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const isOpen = () => ui.panel?.dataset.open === '1';

  function open(tabId) {
    if (!ui.panel) return;
    ui.panel.hidden = false;
    if (ui.scrim) ui.scrim.hidden = false;
    requestAnimationFrame(() => {
      ui.panel.dataset.open = '1';
      if (ui.scrim) ui.scrim.dataset.show = '1';
    });
    ui.fab.setAttribute('aria-expanded', 'true');
    showTab(tabId || state.tab || tools[0]?.id);
    if (window.innerWidth <= 640) {
      $('.rt-tab[aria-selected="true"]', ui.panel)?.focus();
    }
    emit('open');
  }

  function close() {
    if (!ui.panel) return;
    ui.panel.dataset.open = '0';
    if (ui.scrim) ui.scrim.dataset.show = '0';
    ui.fab.setAttribute('aria-expanded', 'false');
    setTimeout(() => {
      if (!isOpen()) {
        ui.panel.hidden = true;
        if (ui.scrim) ui.scrim.hidden = true;
      }
    }, 300);
    emit('close');
  }

  function renderTabs() {
    ui.tabsEl.innerHTML = '';
    tools.forEach((t) => {
      const b = el('button', {
        class: 'rt-tab',
        type: 'button',
        role: 'tab',
        'data-id': t.id,
        'aria-selected': String(t.id === state.tab),
      }, (t.icon || '') + `<span>${t.label}</span>`);
      b.addEventListener('click', () => showTab(t.id));
      ui.tabsEl.append(b);
    });
  }

  function showTab(id) {
    const tool = tools.find((t) => t.id === id) || tools[0];
    if (!tool) return;

    if (typeof cleanupCurrent === 'function') {
      try { cleanupCurrent(); } catch (e) { console.error('[reader-tools]', e); }
    }
    cleanupCurrent = null;

    if (state.tab !== tool.id) set({ tab: tool.id });

    $$('.rt-tab', ui.tabsEl).forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.id === tool.id)));

    ui.title.textContent = tool.label;
    ui.body.innerHTML = '';
    ui.body.scrollTop = 0;

    const ctx = { state, set, on, emit, el, $, $$, article, ICON, open, close, showTab };
    cleanupCurrent = tool.mount(ui.body, ctx) || null;
  }

  /* ---------------- progress + position save ---------------- */
  function initProgress() {
    let raf = 0;

    const update = () => {
      raf = 0;
      const a = article();
      if (!a || !ui.progress) return;
      const rect = a.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const total = a.offsetHeight - window.innerHeight * 0.6;
      const pct = clamp(((window.scrollY - top) / Math.max(total, 1)) * 100, 0, 100);
      ui.progress.style.width = pct + '%';
      emit('progress', pct);
      if (window.scrollY > 400) {
        try { localStorage.setItem(posKey(location.pathname), String(Math.round(window.scrollY))); } catch {}
      }
    };

    addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    addEventListener('resize', update, { passive: true });
    update();
  }

  /* ==========================================================================
     TOOL 1 — අන්තර්ගතය (TOC + reading time + progress)
     ========================================================================== */
  register({
    id: 'toc',
    order: 10,
    label: 'අන්තර්ගතය',
    icon: ICON.list,
    mount(box) {
      const a = article();
      if (!a) {
        box.append(el('p', { class: 'rt-empty' }, 'මෙම පිටුවේ කියවීමට ලිපියක් හමු නොවිය.'));
        return;
      }

      const words = (a.textContent || '').trim().split(/\s+/).filter(Boolean).length;
      const mins = Math.max(1, Math.round(words / 180));

      const meta = el('div', { class: 'rt-meta' });
      meta.append(
        el('span', {}, `~${mins} මිනිත්තු`),
        el('span', {}, `${words.toLocaleString('si-LK')} වචන`),
        el('span', { 'data-rt-pct': '' }, '0% කියවා ඇත'),
      );
      box.append(meta);

      const offPct = on('progress', (p) => {
        const n = $('[data-rt-pct]', meta);
        if (n) n.textContent = `${Math.round(p)}% කියවා ඇත`;
      });

      const heads = $$(HEADING_SEL, a).filter((h) => (h.textContent || '').trim());
      heads.forEach((h, i) => { if (!h.id) h.id = 'rt-h-' + i; });

      if (!heads.length) {
        box.append(el('p', { class: 'rt-empty' }, 'මෙම ලිපියේ උපමාතෘකා නොමැත.'));
        return offPct;
      }

      const ul = el('ul', { class: 'rt-toc' });
      heads.forEach((h) => {
        const li = el('li', { 'data-depth': h.tagName[1] });
        const link = el('a', { href: '#' + h.id }, (h.textContent || '').trim());
        link.addEventListener('click', (e) => {
          e.preventDefault();
          h.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.replaceState(null, '', '#' + h.id);
          if (window.innerWidth <= 640) close();
        });
        li.append(link);
        ul.append(li);
      });
      box.append(ul);

      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          $$('.rt-toc a', ul).forEach((x) => x.removeAttribute('data-active'));
          const link = $(`.rt-toc a[href="#${CSS.escape(en.target.id)}"]`, ul);
          if (link) {
            link.dataset.active = '1';
            link.scrollIntoView({ block: 'nearest' });
          }
        });
      }, { rootMargin: '-72px 0px -70% 0px', threshold: 0 });

      heads.forEach((h) => io.observe(h));

      return () => { io.disconnect(); offPct(); };
    },
  });

  /* ==========================================================================
     TOOL 2 — පෙනුම (theme, font, size, line-height, letter, measure)
     ========================================================================== */
  register({
    id: 'display',
    order: 20,
    label: 'පෙනුම',
    icon: ICON.aa,
    mount(box) {
      const group = (label, node, valueText) => {
        const g = el('div', { class: 'rt-group' });
        g.append(
          el('div', { class: 'rt-label' },
            `<span>${label}</span>` + (valueText != null ? `<span data-val>${valueText}</span>` : '')),
          node,
        );
        return g;
      };

      const seg = (options, current, cb) => {
        const wrap = el('div', { class: 'rt-seg' });
        options.forEach(([val, text]) => {
          const b = el('button', { type: 'button', 'aria-pressed': String(val === current) }, text);
          b.addEventListener('click', () => {
            $$('button', wrap).forEach((x) => x.setAttribute('aria-pressed', 'false'));
            b.setAttribute('aria-pressed', 'true');
            cb(val);
          });
          wrap.append(b);
        });
        return wrap;
      };

      const slider = (label, key, min, max, step, fmt) => {
        const input = el('input', {
          class: 'rt-range', type: 'range',
          min: String(min), max: String(max), step: String(step),
          value: String(state[key]),
          'aria-label': label,
        });
        const g = group(label, input, fmt(Number(state[key])));
        input.addEventListener('input', () => {
          const v = Number(input.value);
          set({ [key]: v });
          const out = $('[data-val]', g);
          if (out) out.textContent = fmt(v);
        });
        return g;
      };

      box.append(group('වර්ණ තේමාව',
        seg([['dark', 'කළු'], ['light', 'සුදු'], ['sepia', 'සෙපියා']],
          state.theme, (v) => set({ theme: v }))));

      box.append(group('අකුරු විලාසය',
        seg([['sans', 'සාමාන්‍ය'], ['serif', 'සෙරිෆ්'], ['system', 'උපාංගය']],
          state.font, (v) => set({ font: v }))));

      box.append(slider('අකුරු විශාලත්වය', 'fontScale', 0.85, 1.7, 0.05,
        (v) => Math.round(v * 100) + '%'));

      box.append(slider('පේළි පරතරය', 'lineHeight', 1.4, 2.4, 0.05,
        (v) => v.toFixed(2)));

      box.append(slider('අකුරු පරතරය', 'letter', 0, 0.08, 0.01,
        (v) => v.toFixed(2) + 'em'));

      box.append(group('පේළියේ පළල',
        seg([['narrow', 'පටු'], ['normal', 'සාමාන්‍ය'], ['wide', 'පළල්']],
          state.measure, (v) => set({ measure: v }))));

      const reset = el('button', { class: 'rt-btn', type: 'button' }, 'මුල් සැකසුම්වලට හරවන්න');
      reset.addEventListener('click', () => {
        set({
          theme: DEFAULTS.theme,
          font: DEFAULTS.font,
          fontScale: DEFAULTS.fontScale,
          lineHeight: DEFAULTS.lineHeight,
          letter: DEFAULTS.letter,
          measure: DEFAULTS.measure,
        });
        showTab('display');
      });

      const row = el('div', { class: 'rt-row' });
      row.append(reset);
      box.append(row);
    },
  });

  /* ==========================================================================
     TOOL 3 — හඬ (Web Speech API; pluggable engines)
     ========================================================================== */
  const engines = new Map();

  const webSpeech = {
    id: 'web-speech',
    _chunks: [],
    _i: 0,
    _opts: {},
    _hooks: {},
    _stopped: true,

    available() { return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; },

    voices() {
      const all = (window.speechSynthesis.getVoices() || []);
      return { all, si: all.filter((v) => /^si/i.test(v.lang)) };
    },

    speak(chunks, opts, hooks) {
      this.stop();
      this._chunks = chunks;
      this._i = 0;
      this._opts = opts || {};
      this._hooks = hooks || {};
      this._stopped = false;
      this._next();
    },

    _next() {
      if (this._stopped) return;
      if (this._i >= this._chunks.length) {
        this._stopped = true;
        this._hooks.onEnd?.();
        return;
      }
      const c = this._chunks[this._i];
      const u = new SpeechSynthesisUtterance(c.text);
      const { all } = this.voices();
      const v = all.find((x) => x.voiceURI === this._opts.voiceURI);
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'si-LK'; }
      u.rate = this._opts.rate || 1;
      u.onend = () => { this._i++; this._next(); };
      u.onerror = () => { this._i++; this._next(); };
      this._hooks.onChunk?.(c, this._i);
      window.speechSynthesis.speak(u);
    },

    pause() { try { window.speechSynthesis.pause(); } catch {} },
    resume() { try { window.speechSynthesis.resume(); } catch {} },
    stop() {
      this._stopped = true;
      this._i = 0;
      try { window.speechSynthesis.cancel(); } catch {}
    },
    get idle() { return this._stopped; },
    get paused() { try { return !!window.speechSynthesis.paused; } catch { return false; } },
  };
  engines.set('web-speech', webSpeech);

  register({
    id: 'voice',
    order: 30,
    label: 'හඬ',
    icon: ICON.voice,
    mount(box) {
      const engine = engines.get('web-speech');

      if (!engine.available()) {
        box.append(el('p', { class: 'rt-empty' },
          'ඔබේ බ්‍රව්සරය හඬ කියවීම (text-to-speech) සඳහා සහාය නොදක්වයි.'));
        return;
      }

      const a = article();
      const chunks = a
        ? $$('p, li, h2, h3, h4, blockquote', a)
            .map((n) => ({ node: n, text: (n.textContent || '').trim() }))
            .filter((c) => c.text.length > 1)
        : [];

      const sel = el('select', { class: 'rt-select', 'aria-label': 'හඬ තෝරන්න' });
      const voiceGroup = el('div', { class: 'rt-group' });
      voiceGroup.append(el('div', { class: 'rt-label' }, '<span>හඬ</span>'), sel);

      const note = el('p', { class: 'rt-note' }, '');

      function fillVoices() {
        const { all, si } = engine.voices();
        const list = si.length ? si : all;
        const prev = sel.value || state.voiceURI;
        sel.innerHTML = '';
        list.forEach((v) => {
          const o = el('option', { value: v.voiceURI }, `${v.name} — ${v.lang}`);
          if (v.voiceURI === prev) o.selected = true;
          sel.append(o);
        });
        note.textContent = si.length
          ? 'සිංහල (si) හඬ හමු විය.'
          : 'ඔබේ උපාංගයේ සිංහල හඬක් නැත — වෙනත් භාෂා හඬකින් සිංහල අකුරු නිවැරදිව උච්චාරණය නොවිය හැක. Android: Settings → Language & input → Text-to-speech output → සිංහල language pack ස්ථාපනය කරන්න.';
      }

      fillVoices();
      const onVoices = () => fillVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', onVoices);
      sel.addEventListener('change', () => set({ voiceURI: sel.value }));

      const rate = el('input', {
        class: 'rt-range', type: 'range', min: '0.6', max: '1.6', step: '0.05',
        value: String(state.rate), 'aria-label': 'කියවීමේ වේගය',
      });
      const rateGroup = el('div', { class: 'rt-group' });
      rateGroup.append(
        el('div', { class: 'rt-label' },
          `<span>වේගය</span><span data-val>${Number(state.rate).toFixed(2)}×</span>`),
        rate,
      );
      rate.addEventListener('input', () => {
        const v = Number(rate.value);
        set({ rate: v });
        const out = $('[data-val]', rateGroup);
        if (out) out.textContent = v.toFixed(2) + '×';
      });

      const playBtn = el('button', { class: 'rt-btn rt-btn--primary', type: 'button' },
        ICON.play + '<span>කියවන්න</span>');
      const stopBtn = el('button', { class: 'rt-btn', type: 'button' },
        ICON.stop + '<span>නවත්වන්න</span>');
      const row = el('div', { class: 'rt-row' });
      row.append(playBtn, stopBtn);

      const clearHl = () => $$('.rt-speaking').forEach((n) => n.classList.remove('rt-speaking'));
      let mode = 'stopped';

      function paint() {
        playBtn.innerHTML = (mode === 'playing')
          ? ICON.pause + '<span>විරාමය</span>'
          : (mode === 'paused')
            ? ICON.play + '<span>දිගටම</span>'
            : ICON.play + '<span>කියවන්න</span>';
      }
      paint();

      playBtn.addEventListener('click', () => {
        if (!chunks.length) return;
        if (mode === 'playing') {
          engine.pause();
          mode = 'paused';
        } else if (mode === 'paused') {
          engine.resume();
          mode = 'playing';
        } else {
          engine.speak(chunks, { rate: state.rate, voiceURI: sel.value }, {
            onChunk: (c) => {
              clearHl();
              c.node.classList.add('rt-speaking');
              c.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            },
            onEnd: () => { clearHl(); mode = 'stopped'; paint(); },
          });
          mode = 'playing';
        }
        paint();
      });

      stopBtn.addEventListener('click', () => {
        engine.stop();
        clearHl();
        mode = 'stopped';
        paint();
      });

      box.append(voiceGroup, rateGroup, row, note);
      if (!chunks.length) {
        box.append(el('p', { class: 'rt-empty' }, 'කියවීමට පෙළක් හමු නොවිය.'));
      }

      return () => {
        window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
      };
    },
  });

  /* ==========================================================================
     TOOL 4 — කියවීම (focus mode, auto-scroll, resume, nav)
     ========================================================================== */
  register({
    id: 'reading',
    order: 40,
    label: 'කියවීම',
    icon: ICON.eye,
    mount(box) {
      /* focus mode */
      const focusGroup = el('div', { class: 'rt-group' });
      const focusSw = el('input', { type: 'checkbox', role: 'switch' });
      focusSw.checked = !!state.focus;
      const focusRow = el('label', { class: 'rt-switch' });
      focusRow.append(el('span', {}, 'අවධානය මාදිලිය — අවට දේ මකා දමන්න'), focusSw);
      focusSw.addEventListener('change', () => {
        markDimTargets();
        set({ focus: focusSw.checked });
      });
      focusGroup.append(focusRow);
      box.append(focusGroup);

      /* auto scroll */
      const asGroup = el('div', { class: 'rt-group' });
      const asRange = el('input', {
        class: 'rt-range', type: 'range', min: '0', max: '5', step: '1', value: '0',
        'aria-label': 'ස්වයංක්‍රීය අනුචලන වේගය',
      });
      asGroup.append(
        el('div', { class: 'rt-label' },
          '<span>ස්වයංක්‍රීය අනුචලනය</span><span data-val>අක්‍රීය</span>'),
        asRange,
      );
      box.append(asGroup);

      let raf = 0, speed = 0, last = 0, carry = 0;

      const tick = (t) => {
        if (!speed) { raf = 0; return; }
        const dt = last ? (t - last) : 16;
        last = t;
        carry += (speed * 14 * dt) / 1000;
        const px = Math.floor(carry);
        if (px) { carry -= px; window.scrollBy(0, px); }
        raf = requestAnimationFrame(tick);
      };

      asRange.addEventListener('input', () => {
        speed = Number(asRange.value);
        const out = $('[data-val]', asGroup);
        if (out) out.textContent = speed ? `වේගය ${speed}` : 'අක්‍රීය';
        last = 0;
        if (speed && !raf) raf = requestAnimationFrame(tick);
      });

      /* resume reading */
      let saved = 0;
      try { saved = Number(localStorage.getItem(posKey(location.pathname)) || 0); } catch {}
      if (saved > 600) {
        const g = el('div', { class: 'rt-group' });
        const b = el('button', { class: 'rt-btn', type: 'button' }, 'ඔබ නැවතුණ තැනට යන්න');
        b.addEventListener('click', () => {
          window.scrollTo({ top: saved, behavior: 'smooth' });
          if (window.innerWidth <= 640) close();
        });
        g.append(el('div', { class: 'rt-label' }, '<span>දිගටම කියවන්න</span>'), b);
        box.append(g);
      }

      /* top / bottom */
      const nav = el('div', { class: 'rt-row' });
      const toTop = el('button', { class: 'rt-btn', type: 'button' }, '↑ මුලට');
      const toBottom = el('button', { class: 'rt-btn', type: 'button' }, '↓ අන්තිමට');
      toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
      toBottom.addEventListener('click', () =>
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
      nav.append(toTop, toBottom);
      box.append(nav);

      box.append(el('p', { class: 'rt-note' },
        'ඔබේ සැකසුම් මේ උපාංගයේම සුරැකෙනවා (localStorage) — server එකට කිසිවක් යන්නේ නැහැ.'));

      return () => {
        speed = 0;
        if (raf) cancelAnimationFrame(raf);
      };
    },
  });

  /* ==========================================================================
     TOOL 5 — පරිවර්තනය
     ========================================================================== */
  register({
    id: 'translate',
    order: 50,
    label: 'පරිවර්තනය',
    icon: ICON.globe,
    mount(box) {
      const langs = [
        ['en', 'English'], ['ta', 'தமிழ்'], ['hi', 'हिन्दी'], ['ar', 'العربية'],
        ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '中文'], ['ru', 'Русский'],
        ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'],
      ];

      const sel = el('select', { class: 'rt-select', 'aria-label': 'භාෂාව තෝරන්න' });
      langs.forEach(([c, n]) => sel.append(el('option', { value: c }, n)));

      const g = el('div', { class: 'rt-group' });
      g.append(el('div', { class: 'rt-label' }, '<span>මෙම පිටුව පරිවර්තනය කරන්න</span>'), sel);
      box.append(g);

      const go = el('button', { class: 'rt-btn rt-btn--primary', type: 'button' }, 'පරිවර්තනය කරන්න');
      go.addEventListener('click', () => {
        const url = 'https://translate.google.com/translate'
          + '?sl=si&tl=' + encodeURIComponent(sel.value)
          + '&u=' + encodeURIComponent(location.href);
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      const row = el('div', { class: 'rt-row' });
      row.append(go);
      box.append(row);

      box.append(el('p', { class: 'rt-note' },
        'මෙය Google Translate හි පිටු-පරිවර්තන සේවාව අලුත් කවුළුවක විවෘත කරයි. '
        + 'ඔබේ බ්‍රව්සරයේ built-in translate විකල්පය බොහෝ විට මෙයට වඩා හොඳින් වැඩ කරයි.'));
    },
  });

  /* ---------------- boot ---------------- */
  let booted = false;

  function boot() {
    apply();
    if (!build()) return;
    booted = true;
    renderTabs();
    initProgress();
    ui.panel.hidden = true;
    if (ui.scrim) ui.scrim.hidden = true;
    emit('ready');
  }

  window.ReaderTools = {
    register,
    get: (k) => (k ? state[k] : { ...state }),
    set,
    on,
    open,
    close,
    isOpen,
    article,
    registerVoiceEngine: (id, engine) => engines.set(id, engine),
    ICON,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  /* Astro view transitions */
  document.addEventListener('astro:page-load', () => {
    _article = null;
    dimMarked = false;
    apply();
    if (!booted || !ui.root || !ui.root.isConnected) boot();
  });
})();
