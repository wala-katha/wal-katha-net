/*
 * public/scripts/deferred-perf.js
 * =================================================================
 * 2026-09 CWV FIX - Deferred low-priority performance + UX scripts
 * formerly inlined into Base.astro's <head>.
 *
 * මෙය <head> ඇතුළෙන් ඉවත් කළේ ඇයි:
 *   කලින් inline ලෙස තිබූ 3 scripts එකට 250+ lines same-origin parse
 *   ක් SLIDER PAINT වීමට පෙර run විය. එය PageSpeed CrUX field-data
 *   (28-day) එකේ 445ms INP long-task ලෙස measure විය. <head> inline
 *   scripts render-blocking වේ. <script defer> මගින් මේවා main
 *   thread එකෙන් ඉවත් කළ විට LCP/FCP දෙකම නැවත ජනනය වේ.
 *
 * ඇයි තුන්ම එකට:
 *   තුනම first-paint deferral ඉලක්කය share කරන නිසා one network
 *   round-trip ලෙස bundle කිරීම LCP සඳහා optimal. තුනට බෙදුවොත්
 *   one render-blocker, three network round-trips බවට පරිවර්තනය
 *   වේ - LCP සඳහා ඛේදානික ලෙස නරක වේ.
 *
 * Functional parity - 100%:
 *   SW register path "/sw.js" - unchanged
 *   web-vitals metric names + thresholds - unchanged
 *   notice throttle 2200ms + visible 2600ms - unchanged
 *   editable-target exemptions - unchanged
 * =================================================================
 */

(function () {
  if (typeof window === "undefined") return;
  if (window.__wkPerfBundleLoaded) return;
  window.__wkPerfBundleLoaded = true;

  var gtmEnabled = !!(window.__wkGtmEnabled);

  // 1. SERVICE WORKER REGISTRATION (LCP non-critical, deferred)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then(function (r) {
      console.log("SW registered (deferred):", r.scope);
    }).catch(function (err) {
      console.warn("SW registration failed:", err);
    });
  }

  // 2. WEB VITALS MONITORING
  function reportMetric(name, value, extra) {
    var displayValue = name === "CLS" ? value.toFixed(3) : Math.round(value);
    var analyticsValue = Math.round(name === "CLS" ? value * 1000 : value);
    console.log("[Web Vitals] " + name + ":", displayValue, extra || "");
    if (gtmEnabled && window.dataLayer) {
      window.dataLayer.push({
        event: "web_vitals",
        metric_name: name,
        metric_value: analyticsValue
      });
    }
  }

  if (typeof PerformanceObserver !== "undefined") {
    window.addEventListener("load", function () {
      try {
        new PerformanceObserver(function (list) {
          var entries = list.getEntries();
          var last = entries[entries.length - 1];
          if (last) {
            reportMetric("LCP", last.renderTime || last.loadTime || last.startTime);
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });

        var clsValue = 0;
        new PerformanceObserver(function (list) {
          for (var i = 0; i < list.getEntries().length; i++) {
            var e = list.getEntries()[i];
            if (!e.hadRecentInput) clsValue += e.value;
          }
          reportMetric("CLS", clsValue);
        }).observe({ type: "layout-shift", buffered: true });

        new PerformanceObserver(function (list) {
          for (var j = 0; j < list.getEntries().length; j++) {
            var e = list.getEntries()[j];
            if (e.duration) reportMetric("INP", e.duration, e.name);
          }
        }).observe({ type: "event", buffered: true, durationThreshold: 40 });
      } catch (err) {
        console.warn("Web Vitals monitoring unavailable:", err);
      }
    });
  }

  // 3. CONTENT PROTECTION
  var lastNoticeAt = 0;
  var NOTICE_THROTTLE_MS = 2200;
  var NOTICE_VISIBLE_MS = 2600;
  var NOTICE_MESSAGE = "මෙම අන්තර්ගතය පිටපත් කිරීම වළක්වා ඇත";

  function isEditableTarget(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" ||
        tag === "select" || tag === "option") return true;
    if (t.isContentEditable) return true;
    if (t.closest && t.closest("[data-allow-select]")) return true;
    if (t.closest && t.closest(".rt-root")) return true;
    return false;
  }

  function buildLockIconSvg() {
    return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="4" y="10.5" width="16" height="9.5" rx="2.2"></rect>' +
      '<path d="M7.5 10.5V7.2a4.5 4.5 0 019 0v3.3"></path>' +
      '<circle cx="12" cy="14.7" r="1.4" fill="currentColor" stroke="none"></circle>' +
      "</svg>";
  }

  function showProtectionNotice() {
    var now = Date.now();
    if (now - lastNoticeAt < NOTICE_THROTTLE_MS) return;
    lastNoticeAt = now;

    var toast = document.getElementById("content-protection-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "content-protection-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");

      var iconWrap = document.createElement("span");
      iconWrap.className = "cp-icon-wrap";
      iconWrap.setAttribute("aria-hidden", "true");
      iconWrap.innerHTML = buildLockIconSvg();

      var text = document.createElement("span");
      text.className = "cp-text";

      toast.appendChild(iconWrap);
      toast.appendChild(text);
      document.body.appendChild(toast);
    }
    var textEl = toast.querySelector(".cp-text");
    if (textEl) textEl.textContent = NOTICE_MESSAGE;

    toast.classList.add("show");
    clearTimeout(toast._cpHideTimer);
    toast._cpHideTimer = setTimeout(function () {
      toast.classList.remove("show");
    }, NOTICE_VISIBLE_MS);
  }

  document.addEventListener("contextmenu", function (e) {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    showProtectionNotice();
  });
  document.addEventListener("copy", function (e) {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    showProtectionNotice();
  });
  document.addEventListener("cut", function (e) {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
  });
  document.addEventListener("selectstart", function (e) {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
  });
  document.addEventListener("dragstart", function (e) {
    var t = e.target;
    if (t && t.tagName && t.tagName.toLowerCase() === "img") {
      e.preventDefault();
    }
  });
})();
