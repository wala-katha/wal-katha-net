import type { APIContext } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";
import { sortByDate } from "@/lib/utils/sortFunctions";
import { withTrailingSlash } from "@/lib/utils/urlHelper";
import config from "@/config/config.json";

// GOOGLE IMAGES SITEMAP - image-specific XML sitemap (Google Sitemap
// Image extension, <image:image> namespace). Google's Indexing API
// only accepts webpage URLs, so image discovery must go through this
// sitemap mechanism.
//
// 2026 HARDENING: frontmatter image paths can silently contain
// zero-width / bidi / non-breaking characters pasted from editors
// (confirmed live on bus-jack-wal-katha.webp, which carried two
// U+200B chars and therefore 404'd for Googlebot-Image). Every URL
// is now sanitised and percent-encoded before emission.

function stripInvisibleChars(value: string): string {
  // U+200B-U+200D zero-width, U+FEFF BOM, U+00A0 nbsp,
  // U+200E/U+200F + U+202A-U+202E bidi controls.
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .trim();
}

function encodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
}

function buildImageUrl(rawImage: string, siteUrl: string): string | null {
  const cleaned = stripInvisibleChars(rawImage);
  if (!cleaned) return null;

  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      parsed.pathname = encodePath(parsed.pathname);
      return parsed.toString();
    } catch {
      return null;
    }
  }

  const withLeadingSlash = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return `${siteUrl}${encodePath(withLeadingSlash)}`;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(context: APIContext) {
  const posts = await getSinglePage("posts");
  const sortedPosts = sortByDate(posts || []);

  const base_url = (config?.site?.base_url || "").replace(/\/$/, "");
  const siteUrl = context.site?.toString().replace(/\/$/, "") ?? base_url;

  const postsWithImages = sortedPosts.filter((post) => !!post.data.image);

  const urlEntries = postsWithImages
    .map((post) => {
      const imageUrl = buildImageUrl(post.data.image as string, siteUrl);
      if (!imageUrl) return null;

      const postUrl = withTrailingSlash(`${siteUrl}/blog/${post.id}`);
      const imageTitle = escapeXml(stripInvisibleChars(post.data.title || ""));
      const imageCaption = escapeXml(
        stripInvisibleChars(post.data.description || post.data.title || "")
      );

      return `  <url>
    <loc>${escapeXml(postUrl)}</loc>
    <image:image>
      <image:loc>${escapeXml(imageUrl)}</image:loc>
      <image:title>${imageTitle}</image:title>
      <image:caption>${imageCaption}</image:caption>
    </image:image>
  </url>`;
    })
    .filter(Boolean)
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urlEntries}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
