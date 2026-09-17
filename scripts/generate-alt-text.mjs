#!/usr/bin/env node
/**
 * AI image alt-text generator (Gemini Vision).
 *
 * මූලික අරමුණ: images Google Image Search එකේ rank කරවීම.
 *
 * 1. KEY POOL: GEMINI_API_KEY + GEMINI_API_KEY_1..30 ස්වයංක්‍රීයව
 *    හොයාගෙන round-robin කරයි. Key එකක් daily quota ගැහුවොත්
 *    (429 + "per day") ඒක ඉවත් කරලා ඊළඟ key එකට මාරු වෙයි;
 *    per-minute rate limit නම් කෙටි cooldown එකකට දාලා නැවත ගනී.
 *    Model fallback: gemini-2.5-flash -> 2.0-flash -> flash-latest.
 *
 * 2. KEYWORD SEED PRIORITY (brand terms කවදාවත් යොදන්නේ නෑ):
 *      a. frontmatter image_keyword
 *      b. src/data/gsc-keywords.json -> byPage[/blog/slug/]  (post එකේම real queries)
 *      c. gsc-keywords.json -> global  (trend score අනුව, එක query එකක් එක image එකකට විතරයි)
 *      d. brand නොවන tag / keywords
 *      e. category
 *      f. title
 *
 * 3. SAFETY: prompt එකෙන් model එකට කියන්නේ neutral, non-explicit
 *    විදිහට විතරක් describe කරන්න කියලා (adults only). Model එක block
 *    කළොත් deterministic keyword+title fallback එකකට යයි - workflow එක
 *    crash වෙන්නේ නෑ.
 *
 * 4. IDEMPOTENT: generate කරන seed එක image_keyword එකට ආපහු ලියනවා,
 *    ඒ නිසා ඊළඟ run එකේ ඒම topic එකම ස්ථාවරව තියෙනවා.
 */
import { readFile, writeFile, readdir, appendFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "src", "content", "posts");
const PUBLIC_DIR = path.join(ROOT, "public");
const KEYWORDS_FILE = path.join(ROOT, "src", "data", "gsc-keywords.json");

const LIMIT = clampInt(process.env.ALT_LIMIT, 8, 1, 40);
const OVERWRITE = String(process.env.ALT_OVERWRITE) === "true";
const FIX_BRANDED = String(process.env.ALT_FIX_BRANDED ?? "true") === "true";
const INCLUDE_BODY = String(process.env.ALT_INCLUDE_BODY ?? "true") === "true";
const BODY_IMAGES_PER_POST = 2;
const MIN_LEN = 30;
const MAX_LEN = 125;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 60000;
const MODELS = (process.env.ALT_MODELS || "gemini-2.5-flash,gemini-2.0-flash,gemini-flash-latest")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff\u00ad]/g;
const MIME_BY_EXT = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".heif": "image/heif",
};
const EXT_FALLBACKS = [".webp", ".jpg", ".jpeg", ".png"];

function clampInt(raw, def, min, max) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= brand / filler scrubbing ================= */
const BRAND_PATTERNS = [
  /wal[\s._-]*katha/gi,
  /wala[\s._-]*katha/gi,
  /walkatha/gi,
  /walakatha/gi,
  /sinhala[\s._-]*wal\b/gi,
  /වල්[\s\u200d]*කතා/g,
  /වල[\s\u200d]*කතා/g,
  /වල්කතා/g,
  /වලකතා/g,
];
const FILLER_PATTERNS = [
  /\b(image|photo|picture|thumbnail|cover|banner)\b/gi,
  /පින්තූර(ය|යක්)?/g,
  /ඡායාරූප(ය|යක්)?/g,
  /රූප(ය|සටහන)?/g,
];
function stripBrand(text) {
  let out = String(text || "");
  for (const re of BRAND_PATTERNS) out = out.replace(re, " ");
  return tidy(out);
}
function stripFiller(text) {
  let out = String(text || "");
  for (const re of FILLER_PATTERNS) out = out.replace(re, " ");
  return tidy(out);
}
function tidy(text) {
  return String(text || "")
    .replace(INVISIBLE, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:,.|]+|[\s\-–—:,.|]+$/g, "")
    .trim();
}
const hasBrand = (t) =>
  BRAND_PATTERNS.some((re) => new RegExp(re.source, re.flags.replace("g", "")).test(String(t || "")));
const meaningfulLength = (t) => String(t || "").replace(/[^\p{L}\p{N}]/gu, "").length;

/* ================= Gemini key pool ================= */
function collectKeys() {
  const names = ["GEMINI_API_KEY"];
  for (let i = 1; i <= 30; i++) names.push(`GEMINI_API_KEY_${i}`);
  const seen = new Set();
  const keys = [];
  for (const name of names) {
    const value = (process.env[name] || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    keys.push({ name, value, exhausted: false, cooldownUntil: 0, calls: 0, ok: 0 });
  }
  return keys;
}
const keys = collectKeys();
let cursor = clampInt(process.env.GITHUB_RUN_NUMBER, 0, 0, 10 ** 9) % Math.max(keys.length, 1);

async function nextKey() {
  const usable = keys.filter((k) => !k.exhausted);
  if (!usable.length) return null;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[cursor++ % keys.length];
    if (!k.exhausted && k.cooldownUntil <= Date.now()) return k;
  }
  const soonest = Math.min(...usable.map((k) => k.cooldownUntil));
  const wait = Math.min(Math.max(soonest - Date.now(), 1000), 60000);
  console.log(`  ! all keys cooling down - waiting ${Math.round(wait / 1000)}s`);
  await sleep(wait);
  return usable.find((k) => k.cooldownUntil <= Date.now()) || usable[0];
}

function firstLine(text) {
  return String(text || "").replace(/\s+/g, " ").slice(0, 220);
}

async function callModel(model, keyEntry, prompt, image) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { inline_data: { mime_type: image.mime, data: image.base64 } }],
      },
    ],
    generationConfig: { temperature: 0.45, topP: 0.9, maxOutputTokens: 256 },
  };
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": keyEntry.value },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, kind: "network", message: String(err?.message || err) };
  }
  const text = await res.text();
  if (!res.ok) {
    const lower = text.toLowerCase();
    if (res.status === 429) {
      const perDay = lower.includes("per day") || lower.includes("perday") || lower.includes("daily limit");
      return { ok: false, kind: perDay ? "quota" : "rate", message: firstLine(text) };
    }
    if (res.status === 403 || (res.status === 400 && lower.includes("api key"))) {
      return { ok: false, kind: "auth", message: firstLine(text) };
    }
    if (res.status === 404) return { ok: false, kind: "model", message: firstLine(text) };
    if (res.status >= 500) return { ok: false, kind: "server", message: firstLine(text) };
    return { ok: false, kind: "other", message: firstLine(text) };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, kind: "other", message: "response was not valid JSON" };
  }
  if (json.promptFeedback?.blockReason) {
    return { ok: false, kind: "blocked", message: json.promptFeedback.blockReason };
  }
  const cand = json.candidates?.[0];
  if (!cand) return { ok: false, kind: "empty", message: "no candidate returned" };
  if (cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") {
    return { ok: false, kind: "blocked", message: cand.finishReason };
  }
  const out = (cand.content?.parts || [])
    .map((p) => p.text || "")
    .join(" ")
    .trim();
  if (!out) return { ok: false, kind: "empty", message: "empty text part" };
  return { ok: true, text: out };
}

async function generateAlt(prompt, image) {
  const errors = [];
  if (!keys.length) return { text: null, errors: ["no GEMINI_API_KEY* secrets available"] };
  const attemptsPerModel = Math.max(keys.length * 2, 4);
  for (const model of MODELS) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      const keyEntry = await nextKey();
      if (!keyEntry) {
        errors.push("all Gemini keys exhausted");
        return { text: null, errors };
      }
      keyEntry.calls++;
      const r = await callModel(model, keyEntry, prompt, image);
      if (r.ok) {
        keyEntry.ok++;
        return { text: r.text, model, keyName: keyEntry.name, errors };
      }
      errors.push(`${model}/${keyEntry.name}: ${r.kind} - ${r.message || ""}`.trim());
      if (r.kind === "quota" || r.kind === "auth") {
        keyEntry.exhausted = true;
        console.log(`  ! ${keyEntry.name} disabled for this run (${r.kind}) - switching key`);
        continue;
      }
      if (r.kind === "rate") {
        keyEntry.cooldownUntil = Date.now() + 45000;
        continue;
      }
      if (r.kind === "server" || r.kind === "network") {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      break; // model / blocked / empty / other -> next model
    }
  }
  return { text: null, errors };
}

/* ================= frontmatter helpers ================= */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseScalar(fm, field) {
  const m = fm.match(new RegExp(`^${field}\\s*:\\s*(.*)$`, "m"));
  if (!m) return undefined;
  let v = m[1].trim();
  if (!v || v === "|" || v === ">") return undefined;
  v = v.replace(/^["']|["']$/g, "");
  return tidy(v);
}
function parseList(fm, field) {
  const inline = fm.match(new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)\\]`));
  if (inline) {
    return inline[1]
      .split(",")
      .map((s) => tidy(s.replace(/^["']|["']$/g, "")))
      .filter(Boolean);
  }
  const block = fm.match(new RegExp(`${field}\\s*:\\s*\\n((?:[ \\t]*-[ \\t]*.+\\n?)+)`));
  if (block) {
    return block[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-"))
      .map((l) => tidy(l.replace(/^-\s*/, "").replace(/^["']|["']$/g, "")))
      .filter(Boolean);
  }
  return [];
}
function upsertField(fm, field, value) {
  const line = `${field}: ${JSON.stringify(value)}`;
  const re = new RegExp(`^${field}\\s*:.*$`, "m");
  if (re.test(fm)) return fm.replace(re, line);
  const imageRe = /^image\s*:.*$/m;
  if (imageRe.test(fm)) return fm.replace(imageRe, (m) => `${m}\n${line}`);
  return `${fm.replace(/\s+$/, "")}\n${line}`;
}

/* ================= image resolution ================= */
function resolveImage(rawPath) {
  const cleaned = tidy(String(rawPath || "")).replace(/^['"]|['"]$/g, "");
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return { error: `unsupported path "${cleaned}"` };
  let rel = cleaned.split("?")[0].split("#")[0];
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep as-is */
  }
  rel = rel.replace(/^\/+/, "");
  const candidates = [path.join(PUBLIC_DIR, rel), path.join(ROOT, rel)];
  const ext = path.extname(rel).toLowerCase();
  for (const base of [path.join(PUBLIC_DIR, rel), path.join(ROOT, rel)]) {
    for (const alt of EXT_FALLBACKS) {
      if (alt !== ext) candidates.push(base.slice(0, base.length - ext.length) + alt);
    }
  }
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const useExt = path.extname(file).toLowerCase();
    const mime = MIME_BY_EXT[useExt];
    if (!mime) continue;
    const size = statSync(file).size;
    if (size > MAX_IMAGE_BYTES) return { error: `too large (${Math.round(size / 1024)} KB)` };
    return { file, mime, size };
  }
  return { error: `file not found for "${cleaned}"` };
}

/* ================= seed resolution ================= */
function usableQuery(entry, usedSeeds) {
  if (!entry || entry.brandOnly) return false;
  const clean = stripFiller(stripBrand(entry.clean || entry.query));
  if (meaningfulLength(clean) < 6) return false;
  if (usedSeeds.has(clean.toLowerCase())) return false;
  return true;
}
function cleanQuery(entry) {
  return stripFiller(stripBrand(entry.clean || entry.query));
}

function resolveSeed(post, keywords, usedSeeds) {
  const explicit = stripFiller(stripBrand(post.imageKeyword || ""));
  if (meaningfulLength(explicit) >= 4) return { seed: explicit, origin: "frontmatter" };

  const pageList = keywords?.byPage?.[`/blog/${post.slug}/`] || keywords?.byPage?.[`/blog/${post.slug}`] || [];
  const pageHit = pageList.find((e) => usableQuery(e, usedSeeds));
  if (pageHit) return { seed: cleanQuery(pageHit), origin: `gsc-page(${pageHit.impressions} impr)` };

  const globalList = [...(keywords?.global || [])].sort(
    (a, b) => b.trend * b.score - a.trend * a.score,
  );
  const globalHit = globalList.find((e) => usableQuery(e, usedSeeds));
  if (globalHit)
    return { seed: cleanQuery(globalHit), origin: `gsc-global(${globalHit.impressions} impr, ${globalHit.trend}x)` };

  for (const tag of [...post.keywords, ...post.tags]) {
    const clean = stripFiller(stripBrand(tag));
    if (clean.toLowerCase() === "others") continue;
    if (meaningfulLength(clean) >= 4 && !usedSeeds.has(clean.toLowerCase()))
      return { seed: clean, origin: "tag" };
  }
  for (const cat of post.categories) {
    const clean = stripFiller(stripBrand(cat));
    if (clean.toLowerCase() === "others") continue;
    if (meaningfulLength(clean) >= 4) return { seed: clean, origin: "category" };
  }
  const titleSeed = stripFiller(stripBrand(post.title));
  return { seed: titleSeed || post.slug.replace(/-/g, " "), origin: "title" };
}

/* ================= prompt + normalisation ================= */
function buildPrompt(seed, post) {
  const title = stripBrand(post.title);
  return [
    "You write the HTML alt attribute for a cover image on a Sinhala adult-fiction blog.",
    "",
    `Keyword phrase to include naturally, once, at the start: "${seed}"`,
    `Post title, for context only - do not copy it: "${title}"`,
    "",
    "Rules:",
    "1. Reply with ONE single line of Sinhala text and nothing else - no quotes, no markdown, no explanation.",
    `2. Length must be between ${MIN_LEN} and ${MAX_LEN} characters.`,
    '3. Format: "<keyword phrase> - <short natural description of what is actually visible>".',
    "4. Describe ONLY neutral, non-explicit visual facts: adult people, clothing, posture, setting, lighting, colours, mood, composition.",
    "5. Never describe nudity, sexual acts, or intimate body parts. Everyone depicted is an adult - never mention children, teenagers, school, or youth.",
    "6. Banned words: wal katha, wala katha, walkatha, walakatha, වල් කතා, වල කතා, sinhala wal katha.",
    "7. Banned filler words: image, photo, picture, පින්තූරය, ඡායාරූපය.",
    "8. No emoji, no hashtags, no keyword repetition, no line breaks.",
  ].join("\n");
}

function normaliseAlt(raw, seed) {
  let out = tidy(String(raw || "").split("\n")[0]);
  out = out.replace(/^```.*$/g, "").replace(/```/g, "");
  out = out.replace(/^(alt\s*(text)?\s*[:=]\s*)/i, "");
  out = out.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  out = stripFiller(stripBrand(out));
  out = out.replace(/#[^\s#]+/g, "");
  out = tidy(out);
  if (!out) return null;
  if (out.length > MAX_LEN) {
    const cut = out.slice(0, MAX_LEN);
    const lastSpace = cut.lastIndexOf(" ");
    out = tidy(lastSpace > MAX_LEN * 0.6 ? cut.slice(0, lastSpace) : cut);
  }
  if (meaningfulLength(out) < 12) return null;
  const seedClean = tidy(seed);
  if (seedClean && !out.toLowerCase().includes(seedClean.toLowerCase())) {
    const merged = tidy(`${seedClean} - ${out}`);
    out = merged.length <= MAX_LEN ? merged : out;
  }
  return out;
}

function fallbackAlt(seed, post) {
  const parts = [tidy(seed), stripFiller(stripBrand(post.title))].filter(Boolean);
  let out = tidy(parts.join(" - "));
  if (out.length > MAX_LEN) out = tidy(out.slice(0, MAX_LEN));
  return meaningfulLength(out) >= 8 ? out : null;
}

/* ================= main ================= */
(async () => {
  console.log(`Gemini keys detected: ${keys.length} (${keys.map((k) => k.name).join(", ") || "none"})`);
  console.log(`Models: ${MODELS.join(" -> ")}`);
  if (!keys.length) {
    console.log("No GEMINI_API_KEY* secret found - nothing to do.");
    await writeOutputs(false, "No Gemini API keys configured.");
    return;
  }

  let keywords = null;
  if (existsSync(KEYWORDS_FILE)) {
    try {
      keywords = JSON.parse(await readFile(KEYWORDS_FILE, "utf-8"));
      console.log(
        `Loaded GSC keywords: ${keywords.global?.length || 0} global, ` +
          `${Object.keys(keywords.byPage || {}).length} pages (generated ${keywords.generatedAt})`,
      );
    } catch (err) {
      console.warn(`Could not parse ${KEYWORDS_FILE}: ${err.message}`);
    }
  } else {
    console.log("No src/data/gsc-keywords.json yet - falling back to tags/category/title seeds.");
  }

  const files = (await readdir(POSTS_DIR)).filter(
    (f) => (f.endsWith(".md") || f.endsWith(".mdx")) && !f.startsWith("-"),
  );
  console.log(`DIAGNOSTIC: Scanned ${files.length} post file(s)`);

  const posts = [];
  const usedAlts = new Set();
  const usedSeeds = new Set();

  for (const name of files) {
    const file = path.join(POSTS_DIR, name);
    const content = await readFile(file, "utf-8");
    const m = content.match(FM_RE);
    if (!m) continue;
    const fm = m[1];
    const post = {
      file,
      slug: name.replace(/\.[^.]+$/, ""),
      content,
      fm,
      title: parseScalar(fm, "title") || "",
      image: parseScalar(fm, "image") || "",
      imageAlt: parseScalar(fm, "image_alt") || "",
      imageKeyword: parseScalar(fm, "image_keyword") || "",
      date: parseScalar(fm, "date") || "",
      draft: /^draft\s*:\s*true\s*$/m.test(fm),
      categories: parseList(fm, "categories"),
      tags: parseList(fm, "tags"),
      keywords: parseList(fm, "keywords"),
    };
    if (post.imageAlt) usedAlts.add(post.imageAlt.toLowerCase());
    if (post.imageKeyword) usedSeeds.add(stripBrand(post.imageKeyword).toLowerCase());
    for (const bodyAlt of post.content.matchAll(/!\[([^\]]+)\]\(/g)) usedAlts.add(tidy(bodyAlt[1]).toLowerCase());
    posts.push(post);
  }

  const needsWork = posts
    .filter((p) => {
      if (!p.image) return false;
      if (OVERWRITE) return true;
      if (!p.imageAlt) return true;
      if (FIX_BRANDED && hasBrand(p.imageAlt)) return true;
      if (INCLUDE_BODY && /!\[\]\(/.test(p.content)) return true;
      return false;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  console.log(`Posts needing alt text: ${needsWork.length} (processing up to ${LIMIT} image(s) this run)`);

  const report = [];
  let generated = 0;

  for (const post of needsWork) {
    if (generated >= LIMIT) break;

    const targets = [];
    const coverNeeded = OVERWRITE || !post.imageAlt || (FIX_BRANDED && hasBrand(post.imageAlt));
    if (coverNeeded) targets.push({ kind: "cover", raw: post.image });
    if (INCLUDE_BODY) {
      const bodyMatches = [...post.content.matchAll(/!\[\]\(([^)\s]+)([^)]*)\)/g)].slice(0, BODY_IMAGES_PER_POST);
      for (const bm of bodyMatches) targets.push({ kind: "body", raw: bm[1], match: bm[0] });
    }

    for (const target of targets) {
      if (generated >= LIMIT) break;

      const img = resolveImage(target.raw);
      if (img.error) {
        console.log(`SKIP ${post.slug} [${target.kind}]: ${img.error}`);
        report.push({ slug: post.slug, kind: target.kind, status: `skipped - ${img.error}` });
        continue;
      }

      const { seed, origin } = resolveSeed(post, keywords, usedSeeds);
      const base64 = (await readFile(img.file)).toString("base64");
      const result = await generateAlt(buildPrompt(seed, post), { base64, mime: img.mime });

      let alt = result.text ? normaliseAlt(result.text, seed) : null;
      let source = alt ? `${result.model}/${result.keyName}` : "fallback";
      if (!alt) {
        alt = fallbackAlt(seed, post);
        if (result.errors?.length) console.log(`  errors: ${result.errors.slice(-3).join(" | ")}`);
      }
      if (!alt) {
        report.push({ slug: post.slug, kind: target.kind, status: "failed - no usable text" });
        continue;
      }
      if (usedAlts.has(alt.toLowerCase())) {
        const unique = tidy(`${alt} | ${post.slug.replace(/-/g, " ")}`).slice(0, MAX_LEN);
        if (usedAlts.has(unique.toLowerCase())) {
          report.push({ slug: post.slug, kind: target.kind, status: "skipped - duplicate alt" });
          continue;
        }
        alt = unique;
      }

      usedAlts.add(alt.toLowerCase());
      usedSeeds.add(seed.toLowerCase());

      if (target.kind === "cover") {
        let fm = post.fm;
        fm = upsertField(fm, "image_alt", alt);
        fm = upsertField(fm, "image_keyword", seed);
        post.content = post.content.replace(FM_RE, `---\n${fm}\n---`);
        post.fm = fm;
      } else {
        post.content = post.content.replace(target.match, target.match.replace("![]", `![${alt.replace(/[[\]]/g, "")}]`));
      }
      await writeFile(post.file, post.content, "utf-8");

      generated++;
      console.log(`OK ${post.slug} [${target.kind}] seed=${origin} via ${source}\n   -> ${alt}`);
      report.push({ slug: post.slug, kind: target.kind, seed, origin, source, alt, status: "generated" });
    }
  }

  console.log("\nKey usage:");
  for (const k of keys) {
    if (!k.calls) continue;
    console.log(`  ${k.name}: ${k.ok}/${k.calls} ok${k.exhausted ? " (exhausted)" : ""}`);
  }

  const lines = [
    "## AI image alt text",
    "",
    `Generated: **${generated}** | Candidates: ${needsWork.length} | Keys: ${keys.length}`,
    "",
  ];
  if (report.length) {
    lines.push(
      "| Post | Type | Seed origin | Alt text / status |",
      "| ---- | ---- | ----------- | ----------------- |",
      ...report.map(
        (r) =>
          `| \`${r.slug}\` | ${r.kind} | ${r.origin || "-"} | ${(r.alt || r.status).replace(/\|/g, "\\|")} |`,
      ),
    );
  } else {
    lines.push("Nothing to do - every post image already has clean alt text.");
  }
  await writeOutputs(generated > 0, `${lines.join("\n")}\n`);
})().catch(async (err) => {
  console.error("FATAL:", err?.stack || err);
  process.exit(1);
});

async function writeOutputs(changed, summary) {
  await writeFile("/tmp/alt-text-report.md", summary, "utf-8");
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
