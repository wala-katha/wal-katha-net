import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";
// Reusable social-link validator: accepts a valid absolute URL, an
// empty string (common when an author leaves a frontmatter field
// blank but keeps the key present), or is entirely absent. Empty
// strings are transformed to undefined so downstream consumers
// (Social.astro's normalize()) never render a broken <a href=""> -
// this avoids both a hard build crash on empty values AND a broken
// anchor tag in the rendered output, without needing changes to any
// consuming component.
const optionalSocialUrl = z
  .union([z.url(), z.literal("")])
  .optional()
  .transform((val) => (val === "" ? undefined : val));
// About collection schema
const aboutCollection = defineCollection({
  loader: glob({ pattern: "**/-*.{md,mdx}", base: "src/content/about" }),
  schema: z.object({
    title: z.string().trim(),
    meta_title: z.string().optional(),
    image: z.string().optional(),
    draft: z.boolean().optional(),
    what_i_do: z.object({
      title: z.string(),
      items: z.array(
        z.object({
          title: z.string(),
          description: z.string(),
        }),
      ),
    }),
  }),
});
// Contact collection schema
const contactCollection = defineCollection({
  loader: glob({ pattern: "**/-*.{md,mdx}", base: "src/content/contact" }),
  schema: z.object({
    title: z.string().trim(),
    meta_title: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    draft: z.boolean().optional(),
  }),
});
// Authors collection schema
const authorsCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/authors" }),
  schema: z.object({
    title: z.string().trim(),
    meta_title: z.string().optional(),
    image: z.string().optional(),
    description: z.string().optional(),
    social: z
      .object({
        facebook: optionalSocialUrl,
        x: optionalSocialUrl,
        instagram: optionalSocialUrl,
        linkedin: optionalSocialUrl,
        github: optionalSocialUrl,
        website: optionalSocialUrl,
        youtube: optionalSocialUrl,
      })
      .optional(),
  }),
});
// Posts collection schema
const postsCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/posts" }),
  schema: z
    .object({
      title: z.string().trim(),
      meta_title: z.string().optional(),
      description: z.string().optional(),
      date: z.coerce.date().optional(),
      // 2026 "LAST UPDATED" FEATURE: post publish karaata passe content
      // edit kalot (typo fix, content expand adiya), me optional field
      // eken "Updated on: X" kiyala UI ekaeth, article:modified_time
      // schema/meta tag ekaeth wenas (publish date ekata wada different)
      // dinayak penviya hak. Field eka .optional() nisa, existing posts
      // (updated field ekak nathi) build kisivak break nowi digatama
      // wada karayi - evata "Updated" badge ekak penvenne natha (date
      // === updated nam ho updated nomathi nam), publish date eka
      // vitarak penvayi.
      updated: z.coerce.date().optional(),
      image: z.string().optional(),
      // 2026 AI ALT-TEXT FEATURE: build-time PR-based GitHub Action
      // (.github/workflows/generate-alt-text.yml) fills this in via
      // Gemini Vision API when "image" exists but "image_alt" doesn't.
      // Fully optional - existing posts without this field build and
      // render exactly as before, falling back to post title as alt.
      image_alt: z.string().optional(),
      // NOTE: default() intentionally uses a factory function
      // (() => [...]) rather than a plain array literal. Zod's own
      // guidance is to prefer a factory for array/object defaults -
      // a plain array literal default would be the SAME array
      // instance reused across every parsed entry that falls back to
      // it, risking a shared-mutable-reference bug if any downstream
      // code ever mutates a post's categories/authors/tags array in
      // place. The factory form guarantees a fresh array per parse.
      categories: z.array(z.string()).default(() => ["others"]),
      authors: z.array(z.string()).default(() => ["Admin"]),
      tags: z.array(z.string()).default(() => ["others"]),
      // Optional synonym/related-word list for the auto internal-links
      // remark plugin (src/lib/remarkAutoInternalLinks.mjs). Each entry
      // acts as an extra keyword that links back to this same post,
      // independent of its title/tags - lets an author add natural
      // synonyms (e.g. alternate spellings, related phrases) so more
      // organic in-body mentions become internal links. Fully optional;
      // posts without this field build and behave exactly as before.
      keywords: z.array(z.string()).optional(),
      draft: z.boolean().optional(),
    })
    // Self-healing guard (matches this codebase's established
    // auto-fix-don't-crash philosophy, e.g. dateFormat.ts,
    // readingTime.ts, contentParser.astro): if an author accidentally
    // sets "updated" to a date earlier than "date" (publish date),
    // this silently clamps "updated" up to match "date" instead of
    // failing the entire site build over one mistaken frontmatter
    // value. This keeps article:modified_time / the "Updated" badge
    // in PostSingle.astro always chronologically valid.
    .transform((data) => {
      if (data.updated && data.date && data.updated.getTime() < data.date.getTime()) {
        return { ...data, updated: data.date };
      }
      return data;
    }),
});
// Pages collection schema
const pagesCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/pages" }),
  schema: z.object({
    title: z.string().trim(),
    meta_title: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),
    layout: z.string().optional(),
    draft: z.boolean().optional(),
    noindex: z.boolean().optional(),
  }),
});
// Export collections
export const collections = {
  posts: postsCollection,
  about: aboutCollection,
  contact: contactCollection,
  authors: authorsCollection,
  pages: pagesCollection,
};
