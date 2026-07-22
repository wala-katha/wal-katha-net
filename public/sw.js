// ==========================================================
// 🎯 MINIMAL PWA SERVICE WORKER — Installability Enhancement
//
// මෙය add කරන්නේ Chrome ගේ "richer" PWA install dialog එක
// (github.com එකේ පේන "Install" + "Create shortcut" options
// දෙකම එකවර පෙන්නෙන) trigger කරන්නට. Service Worker එකක්
// නොමැති PWA එකක් Chrome ට "lower-confidence" install candidate
// එකක් විදිහට පේනවා, සමහර UI paths වලදී simplified single-option
// dialog එකකට (Install විතරක්) fallback වේ.
//
// Strategy: "Network-first, cache-fallback" — user අද්දකින
// content එක සියල්ල දිගටම live/fresh (Astro SSG + Cloudflare
// Pages edge caching) ලෙසම පෙනෙනවා, service worker එක content
// staleness කිසිවක් introduce කරන්නේ නෑ. Offline access සඳහා
// පමණක් cache fallback එක යොදාගනී.
//
// ⚠️ IMPORTANT: Comments API (comments.wala-katha.workers.dev)
// වගේ dynamic/POST requests මෙම cache logic එකෙන් සම්පූර්ණයෙන්ම
// bypass කරයි — comment submission/fetch behavior කිසිවකට
// බලපෑමක් නැත.
// ==========================================================

const CACHE_NAME = "walakatha-static-v1";

const STATIC_ASSETS_TO_CACHE = [
  "/",
  "/manifest.json",
  "/images/favicon.webp",
  "/images/app-icon.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS_TO_CACHE))
      .catch((err) => {
        // ⚠️ ආරක්ෂිත fallback: cache seeding එකේදී network error එකක්
        // ආවත් (build-time asset missing, offline install ආදී),
        // service worker registration එකම fail නොවී ඉදිරියට යයි.
        console.warn("SW install cache seed skipped:", err);
      })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // ✅ GET requests විතරයි handle කරයි — POST (comment submission),
  // API calls, cross-origin requests (Cloudflare Worker comments API,
  // web3forms, Google Fonts ආදී) සියල්ල browser default behavior
  // එකටම pass-through වෙනවා, service worker එක ඒවාට කිසිසේත් මැදිහත් නොවේ.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // ✅ Same-origin requests විතරයි handle කරයි (site එකේම assets/pages).
  // Third-party origins (fonts, comments worker, analytics ආදී)
  // සම්පූර්ණයෙන්ම bypass කරයි.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Network එකෙන් සාර්ථකව ලැබුනොත්, cache එකත් update කරලා
        // (offline fallback එකට), fresh response එකම user ට දෙයි.
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone).catch(() => {});
        });
        return networkResponse;
      })
      .catch(() => {
        // Network fail උනොත් (offline), cache එකෙන් serve කිරීමට
        // උත්සාහ කරයි. Cache එකේවත් නැත්නම්, browser ගේ default
        // offline error page එකටම fallback වේ.
        return caches.match(request).then((cached) => {
          return cached || Response.error();
        });
      })
  );
});
