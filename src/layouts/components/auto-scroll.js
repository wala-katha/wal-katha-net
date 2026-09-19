/* wal-katha-net auto-scroll engine v1
   Path: src/layouts/components/auto-scroll.js
   Replaces the broken auto-scroll + stop loop inside reader-tools.js.
   Load AFTER reader-tools.js. Comments are ASCII-only. */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__wkAutoScrollInit) return;
  window.__wkAutoScrollInit = true;

  var LEGACY_KEY = 'wk:reader:v1';
  var SPEEDS = [14, 22, 32, 45, 62, 84, 110, 140, 175, 215];
  var DEFAULT_SPEED = 4;
  var ARM_MS = 420;
  var MAX_FRAME_MS = 64;
  var DRIFT_PX = 160;
  var STALL_MS = 4000;
  var HEIGHT_TTL_MS = 400;
  var REDUCED_SPEED_CAP = 4;
  var STUCK_LIMIT = 8;
  var STYLE_ID = 'wk-asc-style';
  var BTN_ID = 'wk-asc-stop';
  var LIVE_ID = 'wk-asc-live';

  var MSG = {
    start: 'ස්වයං-අනුචලනය ආරම්භ විය. නැවැත්වීමට Escape යතුර හෝ රතු නවත්වන්න බොත්තම භාවිත කරන්න.',
    button: 'ස්වයං-අනුචලනය නැවතී ඇත.',
    key: 'යතුරු එබීම නිසා ස්වයං-අනුචලනය නැවතී ඇත.',
    touch: 'ස්පර්ශය නිසා ස්වයං-අනුචලනය නැවතී ඇත.',
    manual: 'ඔබ අතින් අනුචලනය කළ නිසා ස්වයං-අනුචලනය නැවතී ඇත.',
    stall: 'පිටුව ප්‍රතිචාර නොදැක්වූ නිසා ස්වයං-අනුචලනය නැවතී ඇත.',
    end: 'ලිපියේ අවසානයට ළඟා විය. ස්වයං-අනුචලනය නැවතී ඇත.',
    hidden: 'ටැබය සැඟවුණි. ස්වයං-අනුචලනය තාවකාලිකව නැවතී ඇත.',
    shown: 'ස්වයං-අනුචලනය නැවත ආරම්භ විය.',
    idle: 'නැවතීමට ස්වයං-අනුචලනයක් ක්‍රියාත්මක නැත.'
  };

  var ICON_DOWN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
  var ICON_STOP = '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>';

  var CSS = [
    'html[data-wk-autoscroll="1"]{scroll-behavior:auto !important}',
    'html[data-wk-autoscroll="1"] .rt-stopfab{display:none !important}',
    '#wk-asc-stop{position:fixed;left:50%;bottom:calc(5.25rem + env(safe-area-inset-bottom));',
    'transform:translateX(-50%) translateZ(0);z-index:2147483000;display:none;align-items:center;gap:8px;',
    'min-height:44px;margin:0;padding:11px 18px 11px 14px;border:1px solid rgba(239,68,68,.65);',
    'border-radius:999px;background:#b91c1c;color:#fff;font-family:inherit;font-size:12.5px;font-weight:800;',
    'line-height:1;white-space:nowrap;cursor:pointer;touch-action:manipulation;will-change:transform;',
    'box-shadow:0 10px 26px rgba(0,0,0,.55);-webkit-tap-highlight-color:transparent}',
    '#wk-asc-stop[data-on="1"]{display:inline-flex}',
    '#wk-asc-stop:hover,#wk-asc-stop:focus-visible{background:#dc2626;outline:none}',
    '#wk-asc-stop:active{transform:translateX(-50%) translateZ(0) scale(.96)}',
    '#wk-asc-stop svg{flex:0 0 auto;display:block}',
    '#wk-asc-stop .wk-asc-dot{width:9px;height:9px;flex:0 0 auto;border-radius:999px;background:#fff;',
    'animation:wk-asc-pulse 1.1s ease-in-out infinite}',
    '#wk-asc-stop .wk-asc-kbd{font-size:9px;font-weight:800;opacity:.78;',
    'border:1px solid rgba(255,255,255,.45);border-radius:5px;padding:2px 4px}',
    '#wk-asc-live{position:absolute !important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;',
    'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}',
    '@keyframes wk-asc-pulse{0%,100%{opacity:1}50%{opacity:.3}}',
    '@media (max-width:640px){#wk-asc-stop{bottom:calc(6rem + env(safe-area-inset-bottom))}}',
    '@media (prefers-reduced-motion:reduce){#wk-asc-stop .wk-asc-dot{animation:none}}',
    '@media print{#wk-asc-stop,#wk-asc-live{display:none !important}}'
  ].join('');

  var running = false;
  var enginePaused = false;
  var rafId = 0;
  var lastTs = 0;
  var carry = 0;
  var expected = -1;
  var wroteTo = -1;
  var armedAt = 0;
  var progressAt = 0;
  var stuckFrames = 0;
  var smoothFallback = false;
  var speed = DEFAULT_SPEED;
  var heightValue = 0;
  var heightAt = 0;
  var hooks = [];
  var globalsInstalled = false;
  var controlsBound = false;

  function now() {
    if (window.performance && typeof window.performance.now === 'function') return window.performance.now();
    return Date.now();
  }

  function clamp(value, lo, hi) {
    if (!isFinite(value)) return lo;
    if (value < lo) return lo;
    if (value > hi) return hi;
    return value;
  }

  function scroller() {
    return document.scrollingElement || document.documentElement;
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function maxTop() {
    var t = now();
    if (heightValue <= 0 || t - heightAt > HEIGHT_TTL_MS) {
      var s = scroller();
      heightValue = Math.max(0, s.scrollHeight - s.clientHeight);
      heightAt = t;
    }
    return heightValue;
  }

  function pxPerSec() {
    return SPEEDS[clamp(Math.round(speed), 1, SPEEDS.length) - 1];
  }

  function legacySpeed() {
    try {
      var raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return DEFAULT_SPEED;
      var data = JSON.parse(raw);
      var v = parseFloat(data && data.scrollSpeed);
      if (!isFinite(v)) return DEFAULT_SPEED;
      return clamp(v, 1, SPEEDS.length);
    } catch (err) {
      return DEFAULT_SPEED;
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  function liveRegion() {
    var el = document.getElementById(LIVE_ID);
    if (el) return el;
    if (!document.body) return null;
    el = document.createElement('div');
    el.id = LIVE_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    document.body.appendChild(el);
    return el;
  }

  function announce(text) {
    if (!text) return;
    var el = liveRegion();
    if (!el) return;
    el.textContent = '';
    window.setTimeout(function () {
      el.textContent = text;
    }, 30);
  }

  function emit() {
    for (var i = 0; i < hooks.length; i++) {
      try {
        hooks[i](running && !enginePaused);
      } catch (err) {
      }
    }
    syncPanel();
    try {
      document.dispatchEvent(new CustomEvent('wk:autoscroll', {
        detail: { running: running, paused: enginePaused, speed: speed }
      }));
    } catch (err) {
    }
  }

  function on(fn) {
    if (typeof fn === 'function' && hooks.indexOf(fn) < 0) hooks.push(fn);
    return function () {
      off(fn);
    };
  }

  function off(fn) {
    var i = hooks.indexOf(fn);
    if (i >= 0) hooks.splice(i, 1);
  }

  function stopButton() {
    var btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    if (!document.body) return null;
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-keyshortcuts', 'Escape');
    btn.innerHTML = '<span class="wk-asc-dot" aria-hidden="true"></span>' +
      '<span class="wk-asc-txt"></span>' +
      '<span class="wk-asc-kbd" aria-hidden="true">Esc</span>';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      stop('button');
    });
    document.body.appendChild(btn);
    return btn;
  }

  function paint() {
    var btn = stopButton();
    if (!btn) return;
    btn.setAttribute('data-on', running ? '1' : '0');
    btn.setAttribute('aria-label', running ? 'ස්වයං-අනුචලනය නවත්වන්න' : 'ස්වයං-අනුචලනය');
    var label = btn.querySelector('.wk-asc-txt');
    if (label) label.textContent = running ? 'නවත්වන්න' : 'ස්වයං-අනුචලනය';
  }

  function start(opts) {
    if (running) return true;
    if (!document.body) return false;
    if (maxTop() <= 8) {
      announce('මෙම පිටුවේ අනුචලනය කිරීමට ප්‍රමාණවත් අන්තර්ගතයක් හමු නොවුණි.');
      return false;
    }
    if (opts && typeof opts.speed === 'number' && isFinite(opts.speed)) {
      speed = clamp(opts.speed, 1, SPEEDS.length);
    } else {
      speed = legacySpeed();
    }
    if (reducedMotion()) speed = Math.min(speed, REDUCED_SPEED_CAP);

    running = true;
    enginePaused = false;
    carry = 0;
    lastTs = 0;
    stuckFrames = 0;
    expected = scroller().scrollTop;
    wroteTo = -1;
    armedAt = now();
    progressAt = armedAt;
    injectStyle();
    liveRegion();
    document.documentElement.setAttribute('data-wk-autoscroll', '1');
    paint();
    rafId = window.requestAnimationFrame(tick);
    emit();
    announce(MSG.start);
    return true;
  }

  function stop(reason) {
    if (!running) {
      if (reason === 'idle') announce(MSG.idle);
      return;
    }
    running = false;
    enginePaused = false;
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
    lastTs = 0;
    carry = 0;
    expected = -1;
    wroteTo = -1;
    stuckFrames = 0;
    document.documentElement.removeAttribute('data-wk-autoscroll');
    if (smoothFallback) {
      smoothFallback = false;
      document.documentElement.style.removeProperty('scroll-behavior');
      if (document.body) document.body.style.removeProperty('scroll-behavior');
    }
    paint();
    emit();
    if (reason && reason !== 'nav') announce(MSG[reason] || MSG.button);
  }

  function toggle(opts) {
    if (running) {
      stop('button');
      return false;
    }
    return start(opts);
  }

  function pauseByEngine() {
    if (!running || enginePaused) return;
    enginePaused = true;
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
    emit();
  }

  function resumeByEngine() {
    if (!running || !enginePaused) return;
    enginePaused = false;
    lastTs = 0;
    carry = 0;
    stuckFrames = 0;
    expected = scroller().scrollTop;
    wroteTo = -1;
    armedAt = now();
    progressAt = armedAt;
    rafId = window.requestAnimationFrame(tick);
    emit();
  }

  function tick(ts) {
    if (!running || enginePaused) return;
    rafId = window.requestAnimationFrame(tick);

    if (!lastTs) {
      lastTs = ts;
      return;
    }
    var dt = ts - lastTs;
    lastTs = ts;
    if (dt <= 0) return;
    if (dt > MAX_FRAME_MS) dt = MAX_FRAME_MS;

    var s = scroller();
    var top = s.scrollTop;

    if (wroteTo >= 0) {
      if (Math.abs(top - wroteTo) > 4) {
        stuckFrames++;
        if (stuckFrames === STUCK_LIMIT && !smoothFallback) {
          smoothFallback = true;
          document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
          if (document.body) document.body.style.setProperty('scroll-behavior', 'auto', 'important');
        } else if (stuckFrames > STUCK_LIMIT * 2) {
          stop('stall');
          return;
        }
      } else {
        stuckFrames = 0;
      }
    }

    var limit = maxTop();
    if (limit <= 4) {
      stop('end');
      return;
    }

    if (ts - armedAt < ARM_MS) {
      expected = top;
      progressAt = ts;
      return;
    }

    if (expected >= 0 && Math.abs(top - expected) > DRIFT_PX) {
      stop('manual');
      return;
    }

    if (ts - progressAt > STALL_MS) {
      stop('stall');
      return;
    }

    carry += pxPerSec() * dt / 1000;
    var step = Math.floor(carry);
    if (step < 1) return;
    carry -= step;

    var next = top + step;
    if (next > limit) next = limit;
    s.scrollTop = next;
    wroteTo = next;
    expected = next;
    progressAt = ts;

    if (next >= limit - 1) {
      stop('end');
      return;
    }
  }

  function interrupted(ev) {
    if (!running || enginePaused) return;
    if (ev.type === 'keydown') {
      var key = ev.key;
      var navigationKey = key === 'Escape' || key === ' ' || key === 'Spacebar' ||
        key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' ||
        key === 'PageDown' || key === 'Home' || key === 'End';
      if (!navigationKey) return;
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      var node = ev.target;
      if (node && node.closest && node.closest('input, select, textarea, [contenteditable="true"], .rt-panel, #' + BTN_ID)) return;
      stop('key');
      return;
    }
    var target = ev.target;
    if (target && target.nodeType === 1 && target.closest && target.closest('.rt-panel, #' + BTN_ID + ', .rt-stopfab')) return;
    stop(ev.type === 'touchstart' ? 'touch' : 'manual');
  }

  var scrollPending = false;

  function onScroll() {
    if (!running || enginePaused || scrollPending) return;
    scrollPending = true;
    window.requestAnimationFrame(function () {
      scrollPending = false;
      if (!running || enginePaused) return;
      if (now() - armedAt < ARM_MS) return;
      var top = scroller().scrollTop;
      if (expected >= 0 && Math.abs(top - expected) > DRIFT_PX) stop('manual');
    });
  }

  function installGlobals() {
    if (globalsInstalled) return;
    globalsInstalled = true;
    var opts = { capture: true, passive: true };
    document.addEventListener('pointerdown', interrupted, opts);
    document.addEventListener('mousedown', interrupted, opts);
    document.addEventListener('touchstart', interrupted, opts);
    document.addEventListener('wheel', interrupted, opts);
    document.addEventListener('keydown', interrupted, true);
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('visibilitychange', function () {
      if (!running) return;
      if (document.visibilityState === 'hidden') {
        pauseByEngine();
        announce(MSG.hidden);
      } else {
        var wasPaused = enginePaused;
        resumeByEngine();
        if (wasPaused) announce(MSG.shown);
      }
    });
    window.addEventListener('pagehide', function () {
      stop('nav');
    });
    document.addEventListener('astro:before-swap', function () {
      stop('nav');
    });
  }

  function legacyPanelButton(node) {
    if (!node || node.nodeType !== 1 || !node.closest) return null;
    var btn = node.closest('button.rt-btn');
    if (!btn) return null;
    var label = btn.textContent || '';
    if (label.indexOf('ස්වයං-අනුචලනය') < 0 && label.indexOf('අනුචලනය නවත්වන්න') < 0) return null;
    return btn;
  }

  function paintPanelButton(btn) {
    btn.innerHTML = (running ? ICON_STOP : ICON_DOWN) +
      '<span>' + (running ? 'අනුචලනය නවත්වන්න' : 'ස්වයං-අනුචලනය අරඹන්න') + '</span>';
    if (running) {
      btn.setAttribute('data-danger', '1');
      btn.removeAttribute('data-primary');
    } else {
      btn.setAttribute('data-primary', '1');
      btn.removeAttribute('data-danger');
    }
  }

  function syncPanel() {
    var btns = document.querySelectorAll('.rt-panel .rt-btn');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      var label = btn.textContent || '';
      var isStart = label.indexOf('ස්වයං-අනුචලනය') >= 0;
      var isStop = label.indexOf('අනුචලනය නවත්වන්න') >= 0;
      if (!isStart && !isStop) continue;
      if ((running && isStart) || (!running && isStop)) paintPanelButton(btn);
      return;
    }
  }

  function onPanelClick(ev) {
    var node = ev.target;
    if (!node || node.nodeType !== 1 || !node.closest || !node.closest('.rt-panel')) return;
    var btn = legacyPanelButton(node);
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (running) {
      stop('button');
    } else if (start()) {
      var rt = window.ReaderTools;
      if (rt && typeof rt.close === 'function') {
        try {
          rt.close();
        } catch (err) {
        }
      }
    }
    paintPanelButton(btn);
  }

  function onTabClick(ev) {
    var node = ev.target;
    if (!node || node.nodeType !== 1 || !node.closest || !node.closest('.rt-tab')) return;
    window.setTimeout(syncPanel, 0);
  }

  function bridgeLegacy() {
    var rt = window.ReaderTools;
    if (!rt || rt.__wkAscBridged) return;
    rt.__wkAscBridged = true;
    var legacyStop = rt.stopAutoScroll;
    if (typeof legacyStop === 'function') {
      try {
        legacyStop.call(rt);
      } catch (err) {
      }
    }
    rt.startAutoScroll = function () {
      return start();
    };
    rt.stopAutoScroll = function () {
      stop('button');
    };
    rt.toggleAutoScroll = function () {
      return toggle();
    };
    try {
      Object.defineProperty(rt, 'scrolling', {
        configurable: true,
        get: function () {
          return running && !enginePaused;
        }
      });
    } catch (err) {
    }
  }

  function bindControls() {
    if (controlsBound) return;
    controlsBound = true;
    document.addEventListener('click', onPanelClick, true);
    document.addEventListener('click', onTabClick, true);
  }

  function boot() {
    injectStyle();
    liveRegion();
    installGlobals();
    bindControls();
    bridgeLegacy();
    paint();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
  document.addEventListener('astro:page-load', boot);

  window.WkAutoScroll = {
    version: 1,
    start: start,
    stop: function () {
      stop('button');
    },
    toggle: toggle,
    pause: pauseByEngine,
    resume: resumeByEngine,
    setSpeed: function (value) {
      var v = parseFloat(value);
      if (isFinite(v)) speed = clamp(v, 1, SPEEDS.length);
      return speed;
    },
    on: on,
    off: off,
    get running() {
      return running && !enginePaused;
    },
    get paused() {
      return running && enginePaused;
    },
    get speed() {
      return speed;
    },
    get pxPerSecond() {
      return pxPerSec();
    }
  };
})();
