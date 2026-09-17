#!/usr/bin/env node
/**
 * Google Search Console -> src/data/gsc-keywords.json
 *
 * google-indexing.yml එකේ පාවිච්චි කරන ඒම service-account key එකම
 * (GOOGLE_INDEXING_KEY) webmasters.readonly scope එකෙන් පාවිච්චි කරයි.
 *
 * ගන්න දේ:
 *   - web search queries (90 දින)
 *   - image search queries (90 දින, image ranking සඳහා 1.5x weight)
 *   - page+query mapping (එක් එක් post එකට අදාළ queries)
 *   - trend ratio (recent 28d vs previous 28d impressions)
 *
 * සීමාව (දැනගෙන තියෙන්න): GSC API එකෙන් එන්නේ දැනටමත් impressions
 * තියෙන queries විතරයි. "Related searches" හෝ search volume දෙන්නේ නෑ,
 * සහ low-volume long-tail queries වලින් කොටසක් anonymised නිසා කවදාවත්
 * return වෙන්නේ නෑ.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire("/tmp/gsc-tool/package.json");
const { google } = require("googleapis");

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, "src", "data", "gsc-keywords.json");
const SITE_HOST = (process.env.SITE_HOST || "www.walakatha.net").replace(/^www\./, "");
const LOOKBACK_DAYS = num(process.env.LOOKBACK_DAYS, 90, 7, 480);
const MIN_IMPRESSIONS = num(process.env.MIN_IMPRESSIONS, 2, 1, 1000);
const DATA_LAG_DAYS = 3;
const ROW_LIMIT = 25000;
const MAX_PAGES = 4;
const MAX_GLOBAL = 500;
const MAX_PER_PAGE = 25;
const IMAGE_WEIGHT = 1.5;

function num(raw, def, min, max) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

const rawKey = process.env.GSC_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_INDEXING_KEY;
if (!rawKey || !rawKey.trim()) {
  console.error("ERROR: GOOGLE_INDEXING_KEY (or GSC_SERVICE_ACCOUNT_JSON) secret is missing.");
  process.exit(1);
}
let key;
try {
  key = JSON.parse(rawKey);
} catch (err) {
  console.error("ERROR: service-account secret is not valid JSON:", err.message);
  process.exit(1);
}

const auth = new google.auth.JWT(
  key.client_email,
  null,
  key.private_key,
  ["https://www.googleapis.com/auth/webmasters.readonly"],
  null,
);
const gsc = google.searchconsole({ version: "v1", auth });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDate = (d) => d.toISOString().slice(0, 10);
const dayMs = 86400000;

/* ---------- brand terms: alt text වලට මේවා යොදන්නේ නෑ ---------- */
const BRAND_PATTERNS = [
  /wal[\s._-]*katha/gi,
  /wala[\s._-]*katha/gi,
  /walkatha/gi,
  /walakatha/gi,
  /sinhala[\s._-]*wal/gi,
  /වල්[\s\u200d]*කතා/g,
  /වල[\s\u200d]*කතා/g,
  /වල්කතා/g,
  /වලකතා/g,
];
function stripBrand(text) {
  let out = String(text || "");
  for (const re of BRAND_PATTERNS) out = out.replace(re, " ");
  return out.replace(/\s{2,}/g, " ").trim();
}
const isBrandish = (q) => BRAND_PATTERNS.some((re) => new RegExp(re.source, re.flags.replace("g", "")).test(q));
const isBrandOnly = (q) => stripBrand(q).replace(/[^\p{L}\p{N}]/gu, "").length < 4;

/* ---------- API helpers with retry ---------- */
async function withRetry(label, fn) {
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.code || err?.response?.status;
      if (status && status !== 429 && status < 500) throw err;
      const wait = 2000 * 2 ** attempt;
      console.warn(`${label}: transient error (${status ?? err.message}) - retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function resolveProperty() {
  if (process.env.GSC_SITE_URL) {
    console.log(`Using GSC_SITE_URL override: ${process.env.GSC_SITE_URL}`);
    return process.env.GSC_SITE_URL;
  }
  const { data } = await withRetry("sites.list", () => gsc.sites.list());
  const entries = (data.siteEntry || []).filter((e) =>
    ["siteOwner", "siteFullUser", "siteRestrictedUser"].includes(e.permissionLevel),
  );
  if (!entries.length) {
    throw new Error(
      `Service account ${key.client_email} has no Search Console properties. ` +
        "Search Console -> Settings -> Users and permissions -> Add user (Owner/Full).",
    );
  }
  const domainProp = entries.find((e) => e.siteUrl === `sc-domain:${SITE_HOST}`);
  if (domainProp) return domainProp.siteUrl;
  const urlProp = entries.find((e) => e.siteUrl.includes(SITE_HOST));
  if (urlProp) return urlProp.siteUrl;
  console.warn(`No property matched ${SITE_HOST}; falling back to ${entries[0].siteUrl}`);
  return entries[0].siteUrl;
}

async function queryAll(property, { dimensions, type, startDate, endDate }) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await withRetry(`searchanalytics(${type}/${dimensions.join("+")})`, () =>
      gsc.searchanalytics.query({
        siteUrl: property,
        requestBody: {
          startDate,
          endDate,
          dimensions,
          type,
          rowLimit: ROW_LIMIT,
          startRow: page * ROW_LIMIT,
          dataState: "all",
        },
      }),
    );
    const got = data.rows || [];
    rows.push(...got);
    if (got.length < ROW_LIMIT) break;
  }
  return rows;
}

/* ---------- main ---------- */
(async () => {
  const property = await resolveProperty();
  console.log(`Property: ${property}`);

  const end = new Date(Date.now() - DATA_LAG_DAYS * dayMs);
  const start = new Date(end.getTime() - (LOOKBACK_DAYS - 1) * dayMs);
  const recentStart = new Date(end.getTime() - 27 * dayMs);
  const prevEnd = new Date(recentStart.getTime() - dayMs);
  const prevStart = new Date(prevEnd.getTime() - 27 * dayMs);

  const range = { startDate: fmtDate(start), endDate: fmtDate(end) };
  console.log(`Range: ${range.startDate} -> ${range.endDate} (${LOOKBACK_DAYS} days)`);

  const [webQ, imgQ, webPQ, imgPQ, recentQ, prevQ] = await Promise.all([
    queryAll(property, { dimensions: ["query"], type: "web", ...range }),
    queryAll(property, { dimensions: ["query"], type: "image", ...range }),
    queryAll(property, { dimensions: ["page", "query"], type: "web", ...range }),
    queryAll(property, { dimensions: ["page", "query"], type: "image", ...range }),
    queryAll(property, {
      dimensions: ["query"],
      type: "web",
      startDate: fmtDate(recentStart),
      endDate: fmtDate(end),
    }),
    queryAll(property, {
      dimensions: ["query"],
      type: "web",
      startDate: fmtDate(prevStart),
      endDate: fmtDate(prevEnd),
    }),
  ]);

  console.log(
    `Rows: web=${webQ.length} image=${imgQ.length} page+query(web)=${webPQ.length} page+query(image)=${imgPQ.length}`,
  );

  const impressionsOf = (rows) => {
    const m = new Map();
    for (const r of rows) m.set(String(r.keys?.[0] || "").trim().toLowerCase(), r.impressions || 0);
    return m;
  };
  const recentMap = impressionsOf(recentQ);
  const prevMap = impressionsOf(prevQ);

  function trendOf(q) {
    const r = recentMap.get(q) || 0;
    const p = prevMap.get(q) || 0;
    if (r === 0 && p === 0) return 1;
    if (p === 0) return r >= 3 ? 2.5 : 1.5; // අලුතෙන් එන query
    return Math.round((r / p) * 100) / 100;
  }

  function scoreOf({ impressions, position, sources, trend }) {
    const imageBoost = sources.includes("image") ? IMAGE_WEIGHT : 1;
    // page 1 පල්ලෙහා / page 2-4 => අල්ප වෙනසකින් top rank කරන්න පුළුවන්
    const positionBoost = position > 3 && position <= 40 ? 1.3 : 1;
    const trendBoost = trend > 1 ? 1 + Math.min(trend - 1, 2) * 0.5 : 1;
    return Math.round(impressions * imageBoost * positionBoost * trendBoost * 100) / 100;
  }

  /* --- global keyword list --- */
  const globalMap = new Map();
  const addGlobal = (rows, source) => {
    for (const r of rows) {
      const raw = String(r.keys?.[0] || "").replace(/\s{2,}/g, " ").trim();
      if (!raw) continue;
      const q = raw.toLowerCase();
      if ((r.impressions || 0) < MIN_IMPRESSIONS) continue;
      const prev = globalMap.get(q) || {
        query: q,
        impressions: 0,
        clicks: 0,
        positionSum: 0,
        positionWeight: 0,
        sources: [],
      };
      prev.impressions += r.impressions || 0;
      prev.clicks += r.clicks || 0;
      prev.positionSum += (r.position || 0) * (r.impressions || 1);
      prev.positionWeight += r.impressions || 1;
      if (!prev.sources.includes(source)) prev.sources.push(source);
      globalMap.set(q, prev);
    }
  };
  addGlobal(webQ, "web");
  addGlobal(imgQ, "image");

  const global = [...globalMap.values()]
    .map((e) => {
      const position = e.positionWeight ? Math.round((e.positionSum / e.positionWeight) * 10) / 10 : 0;
      const trend = trendOf(e.query);
      const brandOnly = isBrandOnly(e.query);
      return {
        query: e.query,
        clean: stripBrand(e.query),
        impressions: e.impressions,
        clicks: e.clicks,
        ctr: e.impressions ? Math.round((e.clicks / e.impressions) * 10000) / 100 : 0,
        position,
        sources: e.sources,
        trend,
        brandish: isBrandish(e.query),
        brandOnly,
        score: scoreOf({ impressions: e.impressions, position, sources: e.sources, trend }),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_GLOBAL);

  /* --- per-page keyword list --- */
  const pageMap = new Map();
  const addPage = (rows, source) => {
    for (const r of rows) {
      const pageUrl = String(r.keys?.[0] || "");
      const raw = String(r.keys?.[1] || "").replace(/\s{2,}/g, " ").trim();
      if (!pageUrl || !raw) continue;
      if ((r.impressions || 0) < 1) continue;
      let pathname;
      try {
        pathname = new URL(pageUrl).pathname;
      } catch {
        continue;
      }
      const q = raw.toLowerCase();
      const bucket = pageMap.get(pathname) || new Map();
      const prev = bucket.get(q) || { query: q, impressions: 0, clicks: 0, position: 0, sources: [] };
      prev.impressions += r.impressions || 0;
      prev.clicks += r.clicks || 0;
      prev.position = prev.position ? (prev.position + (r.position || 0)) / 2 : r.position || 0;
      if (!prev.sources.includes(source)) prev.sources.push(source);
      bucket.set(q, prev);
      pageMap.set(pathname, bucket);
    }
  };
  addPage(webPQ, "web");
  addPage(imgPQ, "image");

  const byPage = {};
  for (const [pathname, bucket] of pageMap) {
    const list = [...bucket.values()]
      .map((e) => {
        const trend = trendOf(e.query);
        return {
          query: e.query,
          clean: stripBrand(e.query),
          impressions: e.impressions,
          clicks: e.clicks,
          position: Math.round((e.position || 0) * 10) / 10,
          sources: e.sources,
          trend,
          brandish: isBrandish(e.query),
          brandOnly: isBrandOnly(e.query),
          score: scoreOf({
            impressions: e.impressions,
            position: e.position || 0,
            sources: e.sources,
            trend,
          }),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PER_PAGE);
    if (list.length) byPage[pathname] = list;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    property,
    range: { ...range, lookbackDays: LOOKBACK_DAYS, dataLagDays: DATA_LAG_DAYS },
    filters: { minImpressions: MIN_IMPRESSIONS, imageWeight: IMAGE_WEIGHT },
    totals: {
      globalQueries: global.length,
      usableQueries: global.filter((g) => !g.brandOnly).length,
      pages: Object.keys(byPage).length,
    },
    global,
    byPage,
  };

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  console.log(`Wrote ${OUT_FILE} (${global.length} global, ${Object.keys(byPage).length} pages)`);

  const top = global.filter((g) => !g.brandOnly).slice(0, 25);
  const lines = [
    "## GSC keyword sync",
    "",
    `Property: \`${property}\`  |  Range: ${range.startDate} → ${range.endDate}`,
    `Global queries: **${global.length}** (usable, non-brand: **${payload.totals.usableQueries}**)  |  Pages: **${payload.totals.pages}**`,
    "",
    "| # | Query | Impr | Clicks | Pos | Trend | Source | Score |",
    "| - | ----- | ---- | ------ | --- | ----- | ------ | ----- |",
    ...top.map(
      (g, i) =>
        `| ${i + 1} | ${g.query.replace(/\|/g, "\\|")} | ${g.impressions} | ${g.clicks} | ${g.position} | ${g.trend}x | ${g.sources.join("+")} | ${g.score} |`,
    ),
  ];
  const summary = `${lines.join("\n")}\n`;
  await writeFile("/tmp/gsc-summary.md", summary, "utf-8");
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
})().catch((err) => {
  console.error("FATAL:", err?.message || err);
  if (err?.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
