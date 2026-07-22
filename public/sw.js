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
//
// 🎯 2026 UPGRADE — OFFLINE FALLBACK PAGE (root cause fix):
// කලින් version එකේ, offline වෙලා තිබෙන විට cache එකේත් page එක
// නැත්නම් `Response.error()` return කළා — මේකෙන් browser එකේ
// generic, brand-එකකින් තොර "This site can't be reached" error
// screen එකක් පෙන්වුනා. මෙය PWA installed apps (Android/iOS
// standalone mode) වල විශේෂයෙන් bad UX එකක් — user ට site එකේ
// name/logo කිසිවක් නොපෙනී, browser chrome එකකින්වත් තොරව
// blank/broken screen එකක් විතරක් පේනවා.
//
// Root-cause fix: OFFLINE_FALLBACK_PAGE එකක් (static, self-contained
// HTML — Sinhala UI, site theme colors #050505/#01AD9F, retry
// button එකක් සමඟ) install event එකේදීම precache කරලා, fetch
// handler එකේ navigation requests (HTML page loads) fail උනොත්
// කලින් cache match එකක් නැත්නම් මේ fallback page එකටම serve
// කරයි. මෙය permanent, self-healing solution එකක් — අලුත් post
// pages add වුනත්, cache නොකළ page එකකට user ගියොත්වත් (offline
// state එකේ), browser error screen එකක් වෙනුවට site-branded
// fallback එකක්ම දිගටම පෙන්වයි.
// ==========================================================

const CACHE_NAME = "walakatha-static-v2";
const OFFLINE_URL = "/offline.html";

const STATIC_ASSETS_TO_CACHE = [
  "/",
  "/manifest.json",
  "/images/favicon.webp",
  "/images/app-icon.webp",
  OFFLINE_URL,
];

// 🎯 SELF-CONTAINED OFFLINE FALLBACK HTML — inline string ලෙස define
// කර ඇත්තේ (වෙනම public/offline.html file එකක් නොව), Service Worker
// install event එකේදීම Response object එකක් ලෙස සෘජුවම cache
// කරගැනීමට. මෙයින් build pipeline එකේ නව file එකක් add කිරීමේ
// අවශ්‍යතාවයක් නැති අතර, sw.js file එකම update කිරීමෙන් fallback
// UI එකේ content/styling වෙනස් කළ හැක.
const OFFLINE_HTML = `<!doctype html>
<html lang="si">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ඔබ Offline තත්වයේ පවතී - Wala Katha</title>
<style>
  html, body {
    margin: 0; padding: 0; height: 100%;
    background-color: #050505; color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .wrap {
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    padding: 24px; box-sizing: border-box;
  }
  .icon { font-size: 56px; margin-bottom: 16px; }
  h1 { font-size: 22px; font-weight: 800; margin: 0 0 8px; color: #F8F8FF; }
  p { font-size: 14px; color: #94a3b8; margin: 0 0 24px; max-width: 320px; line-height: 1.6; }
  button {
    background-color: #01AD9F; color: #010203; border: none;
    font-weight: 800; font-size: 14px; padding: 12px 28px;
    border-radius: 999px; cursor: pointer;
  }
  button:active { transform: scale(0.97); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="icon">📡</div>
    <h1>ඔබ දැනට Offline තත්වයේ පවතී</h1>
    <p>අන්තර්ජාල සම්බන්ධතාවය නොමැති බව පෙනේ. කරුණාකර ඔබේ connection එක පරීක්ෂා කර නැවත උත්සාහ කරන්න.</p>
    <button onclick="window.location.reload()">නැවත උත්සාහ කරන්න</button>
  </div>
</body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        // Offline fallback page එක Response object එකක් ලෙස
        // manually construct කර cache එකට directly put කරයි —
        // network fetch එකක් මත රඳා නොපවතී.
        await cache.put(
          OFFLINE_URL,
          new Response(OFFLINE_HTML, {
            headers: { "Content-Type": "text/html; charset=UTF-8" },
          })
        );

        // ඉතිරි static assets ටික සාමාන්‍ය පරිදි cache.addAll() එකෙන්.
        const remainingAssets = STATIC_ASSETS_TO_CACHE.filter((url) => url !== OFFLINE_URL);
        return cache.addAll(remainingAssets);
      })
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

  // 🎯 NAVIGATION-AWARE OFFLINE FALLBACK: request එක document
  // navigation එකක්ද (user page එකක් load කරන request, e.g. URL
  // bar / link click / PWA launch) කියලා මුලින්ම check කරයි.
  // request.mode === "navigate" යනු HTML page load requests
  // (images, CSS, JS ආදී sub-resource requests නොවේ) හඳුනාගැනීමට
  // නිවැරදිම browser-native ක්‍රමයයි.
  const isNavigationRequest = request.mode === "navigate";

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
        // උත්සාහ කරයි.
        return caches.match(request).then((cached) => {
          if (cached) return cached;

          // 🎯 ROOT-CAUSE FIX: Cache එකේවත් page එක නැත්නම්, browser
          // ගේ generic error screen එකට (Response.error()) fallback
          // වෙනුවට — navigation request එකක් නම් (user page එකක්
          // load කරන්න හදනවා නම්) site-branded OFFLINE_URL page එකම
          // serve කරයි. Sub-resource requests (images, fonts ආදී)
          // සඳහා පමණක් තවමත් Response.error() එකම යයි — ඒවාට
          // fallback HTML එකක් serve කිරීම logically incorrect
          // (image request එකකට HTML document එකක් return කිරීම
          // broken image icon එකකට තුඩු දෙනවා මිස වැඩක් නෑ).
          if (isNavigationRequest) {
            return caches.match(OFFLINE_URL).then((offlinePage) => {
              return offlinePage || Response.error();
            });
          }

          return Response.error();
        });
      })
  );
});
