/* wal-katha.net — standalone auto-scroll + stop pill. v2
   Fully independent of reader-tools.js internals.
   Public API: window.__wkAutoScroll.start() / .stop() / .toggle() / .setSpeed(1..10) */
(function () {
  "use strict";

  if (window.__wkAutoScroll && window.__wkAutoScroll.v === 2) return;

  var STORE_KEY = "wk:reader:v1";
  var STYLE_ID = "wk-as-style";
  var PILL_ID = "wk-as-pill";
  var ART_SEL = "[data-rt-article], .custom-post-content, article";

  /* px per second for levels 1..10 */
  var SPEEDS = [14, 22, 32, 45, 62, 84, 110, 140, 175, 215];

  var running = false;
  var armed = false;
  var rafId = 0;
  var armTimer = 0;
  var lastTs = 0;
  var acc = 0;
  var expectedY = -1;
  var stalled = 0;
  var maxY = 0;
  var measuredAt = 0;
  var pxPerSec = 62;
  var sc = null;
  var pill = null;

  function clamp(n, lo, hi) {
    n = typeof n === "number" && isFinite(n) ? n : lo;
    return Math.min(hi, Math.max(lo, n));
  }

  /* ---------------------------------------------------------- scroller */
  /* Normally the document scrolls. If some wrapper owns the scroll
     instead, find it once at start time - writing to window when the
     document cannot scroll is exactly what spins forever. */

  function resolveScroller() {
    var docH = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    if (docH - window.innerHeight > 4) return null;

    var art = document.querySelector(ART_SEL);
    var n = art ? art.parentElement : null;
    while (n && n !== document.body && n !== document.documentElement) {
      var st = null;
      try {
        st = window.getComputedStyle(n);
      } catch (e) {}
      if (
        st &&
        /(auto|scroll)/.test(st.overflowY) &&
        n.scrollHeight - n.clientHeight > 4
      ) {
        return n;
      }
      n = n.parentElement;
    }
    return null;
  }

  function getY() {
    if (sc) return sc.scrollTop;
    return window.scrollY || window.pageYOffset || 0;
  }

  function setY(v) {
    if (sc) sc.scrollTop = v;
    else window.scrollTo(0, v);
  }

  function getMax() {
    if (sc) return Math.max(0, sc.scrollHeight - sc.clientHeight);
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    return Math.max(0, h - window.innerHeight);
  }

  /* ------------------------------------------------------------- style */
  /* Injected here, not in reader-tools.css, so the pill can never be
     hidden by the data-rt-ready guard or a stale build. */

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var p = "#" + PILL_ID;
    var css =
      p +
      "{position:fixed;left:50%;bottom:calc(1.25rem + env(safe-area-inset-bottom));" +
      "transform:translateX(-50%) translateZ(0);z-index:2147483000;display:none;" +
      "align-items:center;gap:8px;margin:0;padding:11px 17px 11px 13px;" +
      "border:1px solid rgba(239,68,68,.6);border-radius:999px;background:#b91c1c;" +
      "color:#fff;font-family:inherit;font-size:12px;font-weight:800;line-height:1;" +
      "white-space:nowrap;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,.55);" +
      "-webkit-tap-highlight-color:transparent;will-change:transform;}" +
      p +
      "[data-on='1']{display:inline-flex;}" +
      p +
      ":active{transform:translateX(-50%) translateZ(0) scale(.96);}" +
      p +
      " svg{display:block;width:15px;height:15px;flex:0 0 auto;}" +
      p +
      " i{width:9px;height:9px;flex:0 0 auto;border-radius:999px;background:#fff;" +
      "animation:wk-as-pulse 1.1s ease-in-out infinite;}" +
      "@keyframes wk-as-pulse{0%,100%{opacity:1}50%{opacity:.25}}" +
      "@media(max-width:640px){" +
      p +
      "{bottom:calc(5rem + env(safe-area-inset-bottom));font-size:12.5px;}}" +
      "@media(prefers-reduced-motion:reduce){" +
      p +
      " i{animation:none}}" +
      /* while scrolling: no smooth hijack, no panel, no settings fab */
      "html[data-rt-as='1']{scroll-behavior:auto !important;}" +
      "html[data-rt-as='1'] .rt-panel{transform:translateX(102%) !important;" +
      "visibility:hidden !important;}" +
      "html[data-rt-as='1'] .rt-scrim{opacity:0 !important;visibility:hidden !important;}" +
      "html[data-rt-as='1'] .rt-fab{opacity:0 !important;pointer-events:none !important;}" +
      "@media(max-width:640px){html[data-rt-as='1'] .rt-panel{" +
      "transform:translateY(102%) !important;}}";

    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  function ensurePill() {
    var found = document.getElementById(PILL_ID);
    if (found && found.isConnected) {
      pill = found;
      return pill;
    }
    ensureStyle();
    pill = document.createElement("button");
    pill.id = PILL_ID;
    pill.type = "button";
    pill.setAttribute("aria-label", "ස්වයංක්‍රීය අනුචලනය නවත්වන්න");
    pill.innerHTML =
      '<i></i><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<rect x="7" y="7" width="10" height="10" rx="2"></rect></svg>' +
      "<span>නවත්වන්න</span>";
    pill.addEventListener("click", onPillClick, false);
    pill.addEventListener("touchstart", swallow, { passive: true });
    (document.body || document.documentElement).appendChild(pill);
    return pill;
  }

  function swallow(e) {
    if (e && e.stopPropagation) e.stopPropagation();
  }

  function onPillClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    stop("pill");
  }

  function showPill(on) {
    var el = ensurePill();
    if (on) el.setAttribute("data-on", "1");
    else el.removeAttribute("data-on");
  }

  /* ------------------------------------------------------------ speed */

  function readLevel() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var p = raw ? JSON.parse(raw) : null;
      if (p) {
        var keys = ["scrollSpeed", "autoScrollSpeed", "asSpeed", "speed"];
        for (var i = 0; i < keys.length; i++) {
          var v = p[keys[i]];
          if (typeof v === "number" && isFinite(v)) return clamp(Math.round(v), 1, 10);
        }
      }
    } catch (e) {}
    return 4;
  }

  function setSpeed(level) {
    level = clamp(Math.round(level), 1, 10);
    pxPerSec = SPEEDS[level - 1];
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var p = raw ? JSON.parse(raw) || {} : {};
      p.scrollSpeed = level;
      localStorage.setItem(STORE_KEY, JSON.stringify(p));
    } catch (e) {}
  }

  /* ------------------------------------------------------------- loop */
  /* One read + one write per frame. scrollHeight is measured at most
     every 400ms, never per frame - that read/write/read pattern is what
     forces a synchronous layout on every single frame. */

  function frame(ts) {
    if (!running) return;
    rafId = window.requestAnimationFrame(frame);

    if (!lastTs) {
      lastTs = ts;
      return;
    }
    var dt = ts - lastTs;
    lastTs = ts;
    if (dt <= 0) return;
    if (dt > 64) dt = 64;

    var y = getY();

    /* hand-scrolled away? (tolerance covers mobile url-bar resize) */
    if (expectedY >= 0 && Math.abs(y - expectedY) > 90) {
      stop("manual");
      return;
    }

    if (ts - measuredAt > 400) {
      maxY = getMax();
      measuredAt = ts;
    }

    if (maxY <= 0 || y >= maxY - 1) {
      stop("end");
      return;
    }

    acc += (pxPerSec * dt) / 1000;
    if (acc < 1) return;

    var step = Math.floor(acc);
    acc -= step;

    var next = y + step;
    if (next > maxY) next = maxY;

    setY(next);
    var after = getY();
    expectedY = after;

    /* nothing actually moved for ~40 frames -> something is blocking
       the scroll (a leftover overflow:hidden lock, a modal, etc.).
       Bail out instead of spinning the main thread. */
    if (after <= y) {
      stalled++;
      if (stalled > 40) {
        stop("stalled");
        return;
      }
    } else {
      stalled = 0;
    }
  }

  /* --------------------------------------------------------- controls */

  function unlock() {
    var h = document.documentElement;
    h.classList.remove("rt-locked");
    if (h.style.overflow === "hidden") h.style.overflow = "";
    if (document.body && document.body.style.overflow === "hidden") {
      document.body.style.overflow = "";
    }
  }

  function closePanel() {
    try {
      if (window.ReaderTools && typeof window.ReaderTools.close === "function") {
        window.ReaderTools.close();
      }
    } catch (e) {}
    var root = document.querySelector(".rt-root");
    if (root) root.setAttribute("data-open", "0");
  }

  function start(level) {
    if (running) return false;
    if (!document.querySelector(ART_SEL)) return false;

    setSpeedInternal(typeof level === "number" ? level : readLevel());

    sc = resolveScroller();
    maxY = getMax();
    if (maxY <= 8) return false;

    running = true;
    armed = false;
    lastTs = 0;
    acc = 0;
    stalled = 0;
    expectedY = -1;
    measuredAt = 0;

    document.documentElement.setAttribute("data-rt-as", "1");
    var root = document.querySelector(".rt-root");
    if (root) root.setAttribute("data-autoscroll", "1");

    closePanel();
    unlock();
    ensureStyle();
    showPill(true);
    addStopListeners();

    /* the tap that started this still produces touchend/click, so only
       start listening for "user scrolled" a moment later */
    armTimer = window.setTimeout(function () {
      armed = true;
    }, 450);

    window.__wkAutoScroll.running = true;
    rafId = window.requestAnimationFrame(frame);
    return true;
  }

  function setSpeedInternal(level) {
    pxPerSec = SPEEDS[clamp(Math.round(level), 1, 10) - 1];
  }

  function stop(reason) {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (armTimer) {
      window.clearTimeout(armTimer);
      armTimer = 0;
    }
    running = false;
    armed = false;
    lastTs = 0;
    acc = 0;
    stalled = 0;
    expectedY = -1;
    sc = null;

    removeStopListeners();
    showPill(false);

    document.documentElement.removeAttribute("data-rt-as");
    var root = document.querySelector(".rt-root");
    if (root) root.removeAttribute("data-autoscroll");

    window.__wkAutoScroll.running = false;
    window.__wkAutoScroll.lastStop = reason || "";
  }

  function toggle(level) {
    if (running) {
      stop("toggle");
      return false;
    }
    return start(level);
  }

  /* --------------------------------------------- user-intent handlers */

  function fromPill(e) {
    var t = e && e.target;
    return !!(pill && t && (t === pill || (pill.contains && pill.contains(t))));
  }

  function onIntent(e) {
    if (!running || !armed) return;
    if (fromPill(e)) return;
    stop("user");
  }

  function onKey(e) {
    if (!running) return;
    var k = e.key;
    if (
      k === "Escape" ||
      k === " " ||
      k === "Spacebar" ||
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === "PageUp" ||
      k === "PageDown" ||
      k === "Home" ||
      k === "End"
    ) {
      stop("key");
    }
  }

  function onHidden() {
    if (running && document.hidden) stop("hidden");
  }

  function addStopListeners() {
    window.addEventListener("wheel", onIntent, { passive: true });
    window.addEventListener("touchstart", onIntent, { passive: true });
    window.addEventListener("mousedown", onIntent, true);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onHidden, false);
  }

  function removeStopListeners() {
    window.removeEventListener("wheel", onIntent, { passive: true });
    window.removeEventListener("touchstart", onIntent, { passive: true });
    window.removeEventListener("mousedown", onIntent, true);
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("visibilitychange", onHidden, false);
  }

  /* ------------------------------------------------------- delegation */
  /* Any element with data-rt-autoscroll="toggle" starts/stops it.
     The selector is value-specific on purpose: <html> carries
     data-rt-as, so a bare attribute match could hit the root element. */

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var btn = t.closest('[data-rt-autoscroll="toggle"],[data-rt-autoscroll="stop"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.getAttribute("data-rt-autoscroll") === "stop") stop("button");
      else toggle();
    },
    false
  );

  document.addEventListener(
    "input",
    function (e) {
      var t = e.target;
      if (!t || !t.hasAttribute) return;
      if (!t.hasAttribute("data-rt-autoscroll-speed")) return;
      setSpeed(parseFloat(t.value));
    },
    false
  );

  /* astro client router: never survive a navigation */
  document.addEventListener("astro:before-swap", function () {
    stop("nav");
  });
  document.addEventListener("astro:after-swap", function () {
    stop("nav");
    pill = null;
    document.documentElement.removeAttribute("data-rt-as");
  });
  document.addEventListener("astro:page-load", function () {
    ensureStyle();
  });
  window.addEventListener("pagehide", function () {
    stop("pagehide");
  });

  window.__wkAutoScroll = {
    v: 2,
    running: false,
    lastStop: "",
    start: start,
    stop: stop,
    toggle: toggle,
    setSpeed: setSpeed,
    isRunning: function () {
      return running;
    }
  };

  ensureStyle();
})();
