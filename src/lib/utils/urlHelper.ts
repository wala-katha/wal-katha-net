/**
 * 🎯 CENTRAL URL NORMALIZER — Cloudflare Pages Trailing-Slash Fix
 *
 * Cloudflare Pages (Git-integrated deployment) 308-redirects every
 * no-trailing-slash directory-style URL (e.g. "/blog/foo") to the
 * trailing-slash version ("/blog/foo/"). This happens regardless of
 * wrangler.jsonc's html_handling setting for this direction.
 *
 * Every <a href> generated across the site must therefore already
 * end in "/" so browsers and crawlers (Googlebot, Ahrefs, etc.) never
 * have to follow a redirect hop. This single helper is the one place
 * that decides "does this URL get a trailing slash", so every
 * component that builds links can share the exact same logic instead
 * of re-implementing it (and risking inconsistency) locally.
 *
 * Rules:
 * - Already ends in "/" -> returned unchanged
 * - File-like paths (last segment has a dot, e.g. "/sitemap.xml",
 *   "/robots.txt", "/logo.png") -> returned unchanged (never slashed)
 * - mailto:, tel:, "#" anchors -> returned unchanged (never touch
 *   non-navigational/in-page links)
 * - Absolute URLs on OUR OWN domain (config.site.base_url, e.g.
 *   "https://www.walakatha.net/blog/foo") -> trailing slash appended,
 *   same as a relative path would get. This fixes the Ahrefs
 *   "Open Graph URL not matching canonical URL" issue: PostSingle.astro
 *   builds og:url as an absolute `${siteUrl}/blog/${post.id}` string,
 *   and that must resolve to the exact same trailing-slash URL as the
 *   canonical tag (which is always slashed by Base.astro).
 * - Absolute URLs on ANY OTHER domain (Facebook, WhatsApp, Telegram,
 *   YouTube, Google Fonts, etc.) -> returned unchanged. We must never
 *   rewrite a third-party URL we don't control.
 * - Everything else (relative internal paths) -> trailing slash appended
 */

// Our own site's origin, derived once from config so this file has a
// single source of truth for "is this URL ours". We intentionally read
// this from config.json rather than hardcoding the domain, so staging/
// preview deployments with a different base_url are handled correctly
// too.
import config from "@/config/config.json";

const OWN_ORIGIN = (() => {
  try {
    return new URL(config.site.base_url).origin.toLowerCase();
  } catch {
    return "";
  }
})();

export function withTrailingSlash(url: string | undefined | null): string {
  if (!url) return "/";

  // Never touch mailto/tel/in-page anchor links
  if (/^mailto:/i.test(url) || /^tel:/i.test(url) || url.startsWith("#")) {
    return url;
  }

  // Absolute URL handling (http:// or https://)
  if (/^https?:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      // Malformed absolute URL — return unchanged rather than guessing
      return url;
    }

    // Third-party domain (Facebook, WhatsApp, Telegram, YouTube, CDN
    // fonts, etc.) — never rewrite URLs we don't own.
    if (!OWN_ORIGIN || parsed.origin.toLowerCase() !== OWN_ORIGIN) {
      return url;
    }

    // It's our own domain — fall through to the same slashing rules
    // used for relative paths, applied to the pathname only (query
    // string / hash preserved untouched).
    if (parsed.pathname.endsWith("/")) return url;

    const lastSegment = parsed.pathname.split("/").pop() || "";
    if (lastSegment.includes(".")) return url; // file-like (e.g. sitemap.xml)

    parsed.pathname = `${parsed.pathname}/`;
    return parsed.toString();
  }

  // Already correct (relative path)
  if (url.endsWith("/")) return url;

  // File-like paths (has a dot in the last path segment) — leave as-is
  const lastSegment = url.split("/").pop() || "";
  if (lastSegment.includes(".")) return url;

  // Preserve query strings / hashes if present (defensive — not
  // currently used by internal menu/post links, but keeps this safe
  // for future use)
  const [pathPart, ...rest] = url.split(/([?#].*)/);
  return `${pathPart}/${rest.join("")}`;
}

export default withTrailingSlash;
