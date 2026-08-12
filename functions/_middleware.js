// Cloudflare Pages global middleware (runs before static assets are
// served, at the edge, independent of Astro's static build). This is
// the correct equivalent of "Astro Middleware" for a fully static
// (SSG, no adapter) Astro project - Astro's own middleware only runs
// under an SSR runtime, which this project does not use.
// Normalizes: protocol (http -> https), host (apex/other -> www),
// and trailing slash (matches src/lib/utils/urlHelper.ts convention).
const CANONICAL_HOST = "www.walakatha.net";
const APEX_HOST = "walakatha.net";

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
  // file-like paths such as .xml, .txt, .png, .css, .js) - same rule
  // already used by src/lib/utils/urlHelper.ts and Base.astro.
  if (!isFileLikePath(target.pathname) && !target.pathname.endsWith("/")) {
    target.pathname = `${target.pathname}/`;
    needsRedirect = true;
  }

  if (needsRedirect) {
    return Response.redirect(target.toString(), 301);
  }

  return next();
}
