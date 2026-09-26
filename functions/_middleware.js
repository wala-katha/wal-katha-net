// Cloudflare Pages global middleware (runs before static assets are
// served, at the edge, independent of Astro's static build). This is
// the correct equivalent of "Astro Middleware" for a fully static
// (SSG, no adapter) Astro project - Astro's own middleware only runs
// under an SSR runtime, which this project does not use.
// Normalizes: protocol (http -> https), host (apex/other -> www),
// and trailing slash (matches src/lib/utils/urlHelper.ts convention).
const CANONICAL_HOST = "www.walakatha.net";
const APEX_HOST = "walakatha.net";
// Ad-network / third-party site-verification files (ExoClick, Ezoic,
// Google Search Console alternate methods, etc.) are commonly issued
// WITHOUT a file extension and MUST be served at the exact literal
// path the verifying crawler was given - no trailing slash, no
// redirect chain. Verification crawlers typically do not follow
// redirects, so forcing a trailing slash onto these paths (as would
// otherwise happen since an extension-less path looks "directory-like"
// to isFileLikePath()) silently breaks every future site-verification
// flow. Add any new extension-less verification filename here as
// needed - this list is intentionally exact-match only, so it can
// never accidentally exempt a real content route.
//
// 2026-09 ADDITION: "/ads" - the standalone A-ADS ad-verification page
// (src/pages/ads.astro). A-ADS's own bot documentation explicitly
// states that redirects can prevent their crawler from detecting the
// embedded ad unit. Since this site's trailing-slash normalization
// below would otherwise 301-redirect a bare "/ads" request to "/ads/"
// before the crawler ever sees the ad markup, "/ads" is exempted here
// so BOTH "/ads" and "/ads/" resolve directly to the same page with
// zero redirect hops, regardless of which exact URL form is registered
// in the A-ADS ad-unit dashboard settings.
const VERIFICATION_FILE_EXEMPTIONS = new Set([
  "/113433b046592ff2d58ad8fd7c7c31db",
  "/ads",
]);
function isFileLikePath(pathname) {
  const lastSegment = pathname.split("/").pop() || "";
  return lastSegment.includes(".");
}
function isOwnDomain(hostname) {
  return hostname === APEX_HOST || hostname === CANONICAL_HOST || hostname.endsWith("." + APEX_HOST);
}
export async function onRequest(context) {
  const { request, next } = context;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return next();
  }
  // Only act on our own production domain variants. Never touch
  // *.pages.dev preview deployments, localhost, or unrelated hosts -
  // this prevents preview/testing environments from being redirected
  // to production and breaking deploy verification.
  if (!isOwnDomain(url.hostname)) {
    return next();
  }
  let needsRedirect = false;
  const target = new URL(url.toString());
  // Force https
  if (target.protocol !== "https:") {
    target.protocol = "https:";
    needsRedirect = true;
  }
  // Force www (non-www apex -> www, any subdomain drift -> www)
  if (target.hostname !== CANONICAL_HOST) {
    target.hostname = CANONICAL_HOST;
    needsRedirect = true;
  }
  // Force trailing slash on directory-style paths only (never on
  // file-like paths such as .xml, .txt, .png, .css, .js, and never
  // on exact-match third-party verification file paths, which must
  // be served at their literal issued path with no redirect) - same
  // rule already used by src/lib/utils/urlHelper.ts and Base.astro.
  if (
    !isFileLikePath(target.pathname) &&
    !target.pathname.endsWith("/") &&
    !VERIFICATION_FILE_EXEMPTIONS.has(target.pathname)
  ) {
    target.pathname = `${target.pathname}/`;
    needsRedirect = true;
  }
  if (needsRedirect) {
    return Response.redirect(target.toString(), 301);
  }
  return next();
}
