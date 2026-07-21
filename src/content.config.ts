import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

// About collection schema
const aboutCollection = defineCollection({
  loader: glob({ pattern: "**/-*.{md,mdx}", base: "src/content/about" }),
  schema: z.object({
    title: z.string(),
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
    title: z.string(),
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
    title: z.string(),
    meta_title: z.string().optional(),
    image: z.string().optional(),
    description: z.string().optional(),
    social: z
      .object({
        facebook: z.url().optional(),
        x: z.url().optional(),
        instagram: z.url().optional(),
        linkedin: z.url().optional(),
        github: z.url().optional(),
        website: z.url().optional(),
        youtube: z.url().optional(),
      })
      .optional(),
  }),
});

// Posts collection schema
const postsCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/posts" }),
  schema: z.object({
    title: z.string(),
    meta_title: z.string().optional(),
    description: z.string().optional(),
    date: z.coerce.date().optional(),
    // 🎯 2026 "LAST UPDATED" FEATURE: post එකක් publish කරාට පස්සේ
    // content edit කළොත් (typo fix, content expand ආදී), මෙම optional
    // field එකෙන් "Updated on: X" කියලා UI එකේත්, article:modified_time
    // schema/meta tag එකේත් නිවැරදි (publish date එකට වඩා different)
    // දිනයක් පෙන්විය හැක. Field එක .optional() නිසා, existing posts 4ම
    // (updated field එකක් නැති) build කිසිවක් break නොවී දිගටම වැඩ කරයි —
    // ඒවාට "Updated" badge එකක් පෙන්වන්නේ නැත (date === updated නම් හෝ
    // updated නොමැති නම්), publish date එක විතරක් පෙන්වයි.
    updated: z.coerce.date().optional(),
    image: z.string().optional(),
    categories: z.array(z.string()).default(() => ["others"]),
    authors: z.array(z.string()).default(() => ["Admin"]),
    tags: z.array(z.string()).default(() => ["others"]),
    draft: z.boolean().optional(),
  }),
});

// Pages collection schema
const pagesCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/pages" }),
  schema: z.object({
    title: z.string(),
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
