import type { APIRoute, GetStaticPaths } from "astro";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { getCollection } from "astro:content";
import { humanize } from "@/lib/utils/textConverter";
import { getSinhalaFonts } from "@/lib/og/font";
import { OgImageTemplate } from "@/lib/og/template";
import config from "@/config/config.json";

// Every route in this project is prerendered by default (no SSR
// adapter is configured in astro.config.mjs), so this becomes a real
// static /og/{slug}.png file in dist/ at build time - zero per-request
// cost for visitors, identical to how Astro's official "dynamic OG
// image" recipe works.
export const prerender = true;

export const getStaticPaths = (async () => {
  const posts = await getCollection("posts", ({ data, id }) => {
    return !data.draft && !id.startsWith("-");
  });
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const post = (props as { post: any }).post;

  try {
    const title: string = post.data.title || config.site.title;
    const category: string | undefined = post.data.categories?.[0]
      ? humanize(post.data.categories[0])
      : undefined;

    const { regular, bold } = await getSinhalaFonts();

    const svg = await satori(OgImageTemplate({ title, category, siteTitle: config.site.title }) as any, {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Noto Sans Sinhala", data: regular, weight: 400, style: "normal" },
        { name: "Noto Sans Sinhala", data: bold, weight: 700, style: "normal" },
      ],
    });

    const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
    const png = resvg.render().asPng();

    return new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    // Self-healing fallback: one post's OG generation failing (e.g. a
    // transient Google Fonts network error during build) must never
    // break the entire site build. Fall back to the existing static
    // og-image.webp read directly from disk instead of failing.
    console.error(`OG image generation failed for post "${post?.id}":`, err);
    try {
      const fallbackPath = path.join(process.cwd(), "public/images/og-image.webp");
      if (existsSync(fallbackPath)) {
        const buf = readFileSync(fallbackPath);
        return new Response(buf, {
          status: 200,
          headers: { "Content-Type": "image/webp" },
        });
      }
    } catch {
      // ignore, fall through to 500 below
    }
    return new Response("OG image generation failed", { status: 500 });
  }
};
