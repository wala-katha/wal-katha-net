import type { APIContext } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";
import { sortByDate } from "@/lib/utils/sortFunctions";
import { withTrailingSlash } from "@/lib/utils/urlHelper";
import config from "@/config/config.json";
// GOOGLE IMAGES SITEMAP - image-specific XML sitemap (Google Sitemap
// Image extension, <image:image> namespace). Google's Indexing API
// only accepts webpage URLs (a raw image file URL is rejected as an
// invalid document), so image discovery/indexing must go through this
// sitemap mechanism instead - this is the officially documented and
// correct way to help Google Images crawl this site's post images.
//
// Same file-level pattern as news-sitemap.xml.ts (getSinglePage,
// sortByDate, own escapeXml helper, plain Response with XML content
// type) so this endpoint is fully consistent with the site's existing
// sitemap conventions. Declared separately in public/robots.txt
// (not merged into the auto-generated @astrojs/sitemap output),
// matching how news-sitemap.xml is also declared independently.
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
  // Only posts that actually have an image field are relevant here -
  // a post without an image contributes nothing to an image sitemap.
  const postsWithImages = sortedPosts.filter((post) => !!post.data.image);
  const urlEntries = postsWithImages
    .map((post) => {
      const postUrl = withTrailingSlash(`${siteUrl}/blog/${post.id}`);
      const rawImage = post.data.image as string;
      const imageUrl = rawImage.startsWith("http") ? rawImage : `${siteUrl}${rawImage}`;
      const imageTitle = escapeXml(post.data.title || "");
      const imageCaption = escapeXml(post.data.description || post.data.title || "");
      return `  <url>
    <loc>${escapeXml(postUrl)}</loc>
    <image:image>
      <image:loc>${escapeXml(imageUrl)}</image:loc>
      <image:title>${imageTitle}</image:title>
      <image:caption>${imageCaption}</image:caption>
    </image:image>
  </url>`;
    })
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
    },
  });
}
