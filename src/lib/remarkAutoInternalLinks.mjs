// Build-time remark plugin.
// Scans every post's body content for keyword matches (other post
// titles, categories, tags) and automatically injects internal
// hyperlinks. Runs once per markdown/mdx file inside
// src/content/posts/ during the Astro build. Never touches files
// outside that directory, never breaks the build on failure.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import matter from "gray-matter";
import { slug as slugify } from "github-slugger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../");
const POSTS_DIR = path.join(PROJECT_ROOT, "src/content/posts");

// Tuning constants.
const MIN_TITLE_KEYWORD_LENGTH = 8;
const MIN_TAXONOMY_KEYWORD_LENGTH = 6;
const MAX_LINKS_PER_POST = 5;

// Node types whose children must never be entered/linkified.
// blockquote covers the copyright notice at the end of every post.
const SKIP_RECURSE_TYPES = new Set([
  "blockquote",
  "heading",
  "code",
  "inlineCode",
  "html",
  "image",
  "imageReference",
  "link",
  "linkReference",
  "yaml",
  "mdxJsxTextElement",
  "mdxJsxFlowElement",
  "mdxTextExpression",
  "mdxFlowExpression",
  "mdxjsEsm",
]);

// Same humanize logic as src/lib/utils/textConverter.ts, kept local
// since this file runs as plain Node ESM (astro.config.mjs context),
// not through the Vite/TS pipeline.
function humanize(content) {
  if (!content || typeof content !== "string") return "";
  return content
    .replace(/^[\s_]+|[\s_]+$/g, "")
    .replace(/[_\s]+/g, " ")
    .replace(/[-\s]+/g, " ")
    .replace(/^[a-z]/, (m) => m.toUpperCase());
}

function loadPostsMeta() {
  const posts = [];
  try {
    if (!fs.existsSync(POSTS_DIR)) return posts;
    for (const file of fs.readdirSync(POSTS_DIR)) {
      if (!/\.(md|mdx)$/i.test(file)) continue;
      if (file.startsWith("-")) continue;
      const fullPath = path.join(POSTS_DIR, file);
      try {
        const raw = fs.readFileSync(fullPath, "utf-8");
        const parsed = matter(raw);
        const data = parsed.data || {};
        if (data.draft === true) continue;
        posts.push({
          slug: file.replace(/\.[^.]+$/, ""),
          title: typeof data.title === "string" ? data.title.trim() : "",
          categories: Array.isArray(data.categories) ? data.categories : [],
          tags: Array.isArray(data.tags) ? data.tags : [],
        });
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return posts;
}

function buildLinkIndex() {
  const posts = loadPostsMeta();
  const entries = [];

  // Title-based entries: post-to-post links.
  for (const post of posts) {
    if (post.title.length >= MIN_TITLE_KEYWORD_LENGTH) {
      entries.push({
        keyword: post.title,
        url: `/blog/${post.slug}/`,
        targetKey: `post:${post.slug}`,
      });
    }
  }

  // Category-based entries: link to the category archive page.
  const seenCategories = new Set();
  for (const post of posts) {
    for (const raw of post.categories) {
      const s = slugify(String(raw || ""));
      if (!s || seenCategories.has(s)) continue;
      const label = humanize(String(raw || ""));
      if (label.length < MIN_TAXONOMY_KEYWORD_LENGTH) continue;
      seenCategories.add(s);
      entries.push({
        keyword: label,
        url: `/categories/${s}/`,
        targetKey: `category:${s}`,
      });
    }
  }

  // Tag-based entries: link to the tag archive page.
  const seenTags = new Set();
  for (const post of posts) {
    for (const raw of post.tags) {
      const s = slugify(String(raw || ""));
      if (!s || seenTags.has(s)) continue;
      const label = humanize(String(raw || ""));
      if (label.length < MIN_TAXONOMY_KEYWORD_LENGTH) continue;
      seenTags.add(s);
      entries.push({
        keyword: label,
        url: `/tags/${s}/`,
        targetKey: `tag:${s}`,
      });
    }
  }

  // Longest keyword first, so specific phrases win over short ones.
  entries.sort((a, b) => b.keyword.length - a.keyword.length);
  return entries;
}

let cachedEntries = null;
function getEntries() {
  if (cachedEntries === null) {
    cachedEntries = buildLinkIndex();
  }
  return cachedEntries;
}

function linkifyTextNode(node, context) {
  const value = node.value;
  if (!value || typeof value !== "string" || !value.trim()) {
    return [node];
  }
  if (context.linkCounter.count >= MAX_LINKS_PER_POST) {
    return [node];
  }

  const lowerValue = value.toLowerCase();

  for (const entry of context.entries) {
    if (context.linkCounter.count >= MAX_LINKS_PER_POST) break;
    if (entry.targetKey === `post:${context.currentSlug}`) continue;
    if (context.usedTargets.has(entry.targetKey)) continue;

    const lowerKeyword = entry.keyword.toLowerCase();
    if (!lowerKeyword) continue;
    const idx = lowerValue.indexOf(lowerKeyword);
    if (idx === -1) continue;

    const before = value.slice(0, idx);
    const matched = value.slice(idx, idx + entry.keyword.length);
    const after = value.slice(idx + entry.keyword.length);

    context.usedTargets.add(entry.targetKey);
    context.linkCounter.count += 1;

    const nodes = [];
    if (before) nodes.push({ type: "text", value: before });
    nodes.push({
      type: "link",
      url: entry.url,
      title: null,
      children: [{ type: "text", value: matched }],
    });
    if (after) {
      nodes.push(...linkifyTextNode({ type: "text", value: after }, context));
    }
    return nodes;
  }

  return [node];
}

function processChildren(children, context) {
  if (!Array.isArray(children)) return children;
  const result = [];
  for (const node of children) {
    if (!node) continue;
    if (node.type === "text") {
      result.push(...linkifyTextNode(node, context));
    } else if (SKIP_RECURSE_TYPES.has(node.type)) {
      result.push(node);
    } else if (Array.isArray(node.children)) {
      node.children = processChildren(node.children, context);
      result.push(node);
    } else {
      result.push(node);
    }
  }
  return result;
}

export default function remarkAutoInternalLinks() {
  const entries = getEntries();

  return (tree, file) => {
    try {
      if (!entries.length) return;

      const rawPath =
        (file && file.path) ||
        (file && Array.isArray(file.history) ? file.history[0] : "") ||
        "";
      const filePath = String(rawPath).replace(/\\/g, "/");
      if (!filePath.includes("/content/posts/")) return;

      const baseName = filePath.split("/").pop() || "";
      if (!baseName || baseName.startsWith("-")) return;

      const currentSlug = baseName.replace(/\.[^.]+$/, "");

      const context = {
        entries,
        currentSlug,
        usedTargets: new Set(),
        linkCounter: { count: 0 },
      };

      if (Array.isArray(tree.children)) {
        tree.children = processChildren(tree.children, context);
      }
    } catch (err) {
      console.warn("remarkAutoInternalLinks skipped for a file:", err && err.message);
    }
  };
}
