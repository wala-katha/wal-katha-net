import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Beasties from "beasties";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "dist");
function walkHtmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkHtmlFiles(full, out);
    } else if (entry.toLowerCase().endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}
async function run() {
  if (!existsSync(outDir)) {
    console.warn("inline-critical-css: dist/ not found, skipping.");
    return;
  }
  const beasties = new Beasties({
    path: outDir,
    logLevel: "warn",
    preload: "swap",
    pruneSource: false,
    compress: true,
    reduceInlineStyles: false,
  });
  const files = walkHtmlFiles(outDir);
  let processed = 0;
  for (const file of files) {
    try {
      const html = readFileSync(file, "utf-8");
      const result = await beasties.process(html);
      writeFileSync(file, result, "utf-8");
      processed++;
    } catch (err) {
      console.warn(
        `inline-critical-css: skipped ${path.relative(outDir, file)} - ${err && err.message}`
      );
    }
  }
  console.log(
    `inline-critical-css: inlined critical CSS for ${processed}/${files.length} page(s).`
  );
}
run().catch((err) => {
  console.warn("inline-critical-css: skipped due to an error:", err && err.message);
  process.exit(0);
});
