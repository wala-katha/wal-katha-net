// ExoClick ad controller. ClientRouter-safe: this script loads once
// (head script tag is identical across pages, so ClientRouter's diff
// preserves it instead of re-executing it), then re-renders ad slots
// on every astro:page-load, matching this repo's own established
// pattern (reader-tools.js boot/teardown, Header.astro initHeaderLogic).
(function () {
  var PROVIDER_HOST = "https://a.magsrv.com/ad-provider.js";
  var AGE_STORAGE_KEY = "wk_age_verified";
  var SLOT_SELECTOR = ".exo-ad-slot[data-zoneid]";
  var providerLoaded = false;
  var providerLoading = false;
  function ageOk() {
    try {
      return localStorage.getItem(AGE_STORAGE_KEY) === "true";
    } catch (e) {
      return false;
    }
  }
  function loadProvider(cb) {
    if (providerLoaded) {
      cb();
      return;
    }
    if (providerLoading) return;
    providerLoading = true;
    var s = document.createElement("script");
    s.async = true;
    s.type = "application/javascript";
    s.src = PROVIDER_HOST;
    s.onload = function () {
      providerLoaded = true;
      providerLoading = false;
      cb();
    };
    document.head.appendChild(s);
  }
  function fillSlot(slot) {
    var zoneId = slot.getAttribute("data-zoneid");
    if (!zoneId || slot.dataset.exoFilled === "1") return false;
    // ExoAds.astro always supplies data-adclass with the real class
    // from the ExoClick dashboard (Publisher panel -> zone -> Get the
    // code) for that specific zone. "eas6a97888e35" is kept only as a
    // last-resort fallback for any slot markup that omits it.
    var adClass = slot.getAttribute("data-adclass") || "eas6a97888e35";
    slot.dataset.exoFilled = "1";
    slot.innerHTML = "";
    var ins = document.createElement("ins");
    ins.className = adClass;
    ins.setAttribute("data-zoneid", zoneId);
    slot.appendChild(ins);
    return true;
  }
  function render() {
    if (!ageOk()) return;
    var slots = document.querySelectorAll(SLOT_SELECTOR);
    if (!slots.length) return;
    var filledAny = false;
    slots.forEach(function (slot) {
      if (fillSlot(slot)) filledAny = true;
    });
    if (!filledAny) return;
    loadProvider(function () {
      window.AdProvider = window.AdProvider || [];
      window.AdProvider.push({ serve: {} });
    });
  }
  function boot() {
    render();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
  document.addEventListener("astro:page-load", render);
  document.addEventListener("wk:age-verified", render);
})();
