// MyAdCash (Adcash) ad controller. ClientRouter-safe: aclib.js loads
// once in <head> (Base.astro), then this deferred script re-renders
// ad slots on every astro:page-load - same pattern this repo already
// uses for reader-tools.js and Header.astro's initHeaderLogic. This
// file replaces the removed ExoClick controller (exo-ads.js).
(function () {
  var AGE_STORAGE_KEY = "wk_age_verified";
  var SLOT_SELECTOR = ".adcash-ad-slot[data-zoneid]";
  var ACLIB_POLL_MS = 100;
  var ACLIB_MAX_TRIES = 50;

  function ageOk() {
    try {
      return localStorage.getItem(AGE_STORAGE_KEY) === "true";
    } catch (e) {
      return false;
    }
  }

  // aclib.js is loaded synchronously, high in <head>, per MyAdCash's
  // own integration instructions - but this poll guard protects
  // against any future change to that loading strategy (e.g. if the
  // script tag is ever made async/defer) without needing this file
  // to change again.
  function aclibReady(cb) {
    if (window.aclib && typeof window.aclib.runBanner === "function") {
      cb();
      return;
    }
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (window.aclib && typeof window.aclib.runBanner === "function") {
        clearInterval(timer);
        cb();
      } else if (tries >= ACLIB_MAX_TRIES) {
        clearInterval(timer);
      }
    }, ACLIB_POLL_MS);
  }

  function fillSlot(slot) {
    var zoneId = slot.getAttribute("data-zoneid");
    if (!zoneId || slot.dataset.adcashFilled === "1") return false;
    slot.dataset.adcashFilled = "1";
    aclibReady(function () {
      try {
        window.aclib.runBanner({
          zoneId: zoneId,
          renderIn: "#" + slot.id,
        });
      } catch (e) {}
    });
    return true;
  }

  function render() {
    if (!ageOk()) return;
    var slots = document.querySelectorAll(SLOT_SELECTOR);
    if (!slots.length) return;
    slots.forEach(function (slot) {
      fillSlot(slot);
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
