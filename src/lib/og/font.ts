// Satori (the SVG layout engine used for OG image generation) does
// not use browser/system fonts - it lays out and rasterizes text
// itself, so it needs the raw font file bytes for every character
// that might appear (post titles, categories, brand text, digits).
//
// Satori only accepts TTF/OTF/WOFF - not WOFF2. Google Fonts serves
// WOFF2 by default to modern browsers.
//
// FIX (2026-08 - "Could not find a TTF/OTF font URL" build failure):
// The previous approach relied solely on requesting Google Fonts CSS
// with an old User-Agent string that historically made Google Fonts
// fall back to serving TTF URLs instead of WOFF2. Google's edge
// service has since changed behavior for this trick on some routes,
// causing the CSS response to no longer contain a TTF/OTF url() -
// which made every single OG image generation fail at build time.
//
// PERMANENT FIX: this now tries the old-User-Agent CSS trick first
// (kept, since it still works in most cases and needs zero extra
// network trips), then falls back to fetching the SAME font family's
// static TTF file directly from the jsDelivr CDN mirror of the
// official google/fonts GitHub repository. This CDN path is stable
// and version-independent (unlike Google's own versioned/hashed
// gstatic.com font URLs), so it cannot silently break the same way
// again. Every step is wrapped so a failure in one layer falls
// through to the next, rather than throwing and failing the whole
// post's OG image build.
const OLD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/534.24 (KHTML, like Gecko) Chrome/11.0.696.71 Safari/534.24";

// Stable, version-independent static TTF mirrors (google/fonts repo,
// ofl/notosanssinhala/static/) served via jsDelivr's GitHub CDN.
const FALLBACK_TTF_URLS: Record<number, string> = {
  400: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssinhala/static/NotoSansSinhala-Regular.ttf",
  700: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssinhala/static/NotoSansSinhala-Bold.ttf",
};

let regularFontPromise: Promise<ArrayBuffer> | null = null;
let boldFontPromise: Promise<ArrayBuffer> | null = null;

// Attempt 1: old-User-Agent Google Fonts CSS trick. Parses every
// src url()/format() pair (not just the first match) and prefers a
// truetype/opentype entry if one exists anywhere in the response.
async function tryFetchViaOldUserAgent(weight: number): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+Sinhala:wght@${weight}`;
    const cssRes = await fetch(cssUrl, {
      headers: { "User-Agent": OLD_USER_AGENT },
    });
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const matches = [...css.matchAll(/url\(([^)]+)\)\s*format\('([^']+)'\)/g)];
    if (matches.length === 0) return null;
    const preferred =
      matches.find((m) => m[2] === "truetype" || m[2] === "opentype") ?? matches[0];
    const fontRes = await fetch(preferred[1]);
    if (!fontRes.ok) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

// Attempt 2: stable jsDelivr CDN mirror of the official google/fonts
// GitHub repo's static TTF file for this exact weight.
async function tryFetchViaJsDelivrFallback(weight: number): Promise<ArrayBuffer | null> {
  try {
    const url = FALLBACK_TTF_URLS[weight] ?? FALLBACK_TTF_URLS[400];
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

async function fetchGoogleFontTtf(weight: number): Promise<ArrayBuffer> {
  const viaOldUa = await tryFetchViaOldUserAgent(weight);
  if (viaOldUa) return viaOldUa;

  const viaFallback = await tryFetchViaJsDelivrFallback(weight);
  if (viaFallback) return viaFallback;

  throw new Error(
    `Could not fetch a TTF/OTF font for weight ${weight} via either the Google Fonts CSS trick or the jsDelivr fallback mirror.`
  );
}

// Returns { regular, bold } ArrayBuffers for Noto Sans Sinhala.
// Safe to call once per post - the underlying network fetch only
// ever happens on the first call in a given build process, thanks to
// the module-level promise cache below.
export async function getSinhalaFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (!regularFontPromise) {
    regularFontPromise = fetchGoogleFontTtf(400);
  }
  if (!boldFontPromise) {
    boldFontPromise = fetchGoogleFontTtf(700);
  }
  const [regular, bold] = await Promise.all([regularFontPromise, boldFontPromise]);
  return { regular, bold };
}
