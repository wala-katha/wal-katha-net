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
 * - Absolute external URLs (http://, https://, mailto:, tel:, #anchor)
 *   -> returned unchanged (never touch third-party or in-page links)
 * - Everything else -> trailing slash appended
 */
export function withTrailingSlash(url: string | undefined | null): string {
  if (!url) return "/";

  // Never touch external/absolute/protocol/anchor links
  if (
    /^https?:\/\//i.test(url) ||
    /^mailto:/i.test(url) ||
    /^tel:/i.test(url) ||
    url.startsWith("#")
  ) {
    return url;
  }

  // Already correct
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
