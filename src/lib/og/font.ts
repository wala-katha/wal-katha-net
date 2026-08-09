// Satori (the SVG layout engine used for OG image generation) does
// not use browser/system fonts - it lays out and rasterizes text
// itself, so it needs the raw font file bytes for every character
// that might appear (post titles, categories, brand text, digits).
//
// Google Fonts serves WOFF2 by default, but Satori only accepts
// TTF/OTF/WOFF - not WOFF2. Requesting the CSS with an old
// User-Agent string that predates WOFF2 support makes Google Fonts
// fall back to serving TTF font URLs instead. This is the standard,
// widely-used trick for Satori-based OG image generators.
//
// The font is fetched ONCE per build (module-level cache below) and
// reused for every post's image - this file's fetch functions are
// only ever invoked at build time (inside a static endpoint's GET
// handler), never at request time in production, since the output
// PNGs are fully prerendered static files.
const OLD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/534.24 (KHTML, like Gecko) Chrome/11.0.696.71 Safari/534.24";

let regularFontPromise: Promise<ArrayBuffer> | null = null;
let boldFontPromise: Promise<ArrayBuffer> | null = null;

async function fetchGoogleFontTtf(weight: number): Promise<ArrayBuffer> {
  const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+Sinhala:wght@${weight}`;
  const cssRes = await fetch(cssUrl, {
    headers: { "User-Agent": OLD_USER_AGENT },
  });
  if (!cssRes.ok) {
    throw new Error(`Google Fonts CSS request failed with status ${cssRes.status}`);
  }
  const css = await cssRes.text();
  const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/);
  if (!match) {
    throw new Error("Could not find a TTF/OTF font URL in the Google Fonts CSS response");
  }
  const fontRes = await fetch(match[1]);
  if (!fontRes.ok) {
    throw new Error(`Font file download failed with status ${fontRes.status}`);
  }
  return await fontRes.arrayBuffer();
}

// Returns { regular, bold } ArrayBuffers for Noto Sans Sinhala.
// Safe to call once per post - the underlying network fetch only
// ever happens on the first call in a given build process, thanks to
// the module-level promise cache above.
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
