import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchImageUrls, download } from "./lib/fandom.js";
import { extractImageFiles } from "./lib/wikitext.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://tenkai-knights.fandom.com/api.php";
const OUT = path.join(ROOT, "data/images/beni");

// Downloads every image referenced on Beni's wiki page (gallery + infobox) —
// the seed dataset for a future image LoRA (see docs/LORA-IMAGE.md).
async function main(): Promise<void> {
  const raw = path.join(ROOT, "data/raw/fandom/beni.wikitext");
  if (!fs.existsSync(raw)) {
    console.error("Run `npm run scrape` first (needs data/raw/fandom/beni.wikitext).");
    process.exit(1);
  }
  const files = extractImageFiles(fs.readFileSync(raw, "utf8"));
  console.log(`${files.length} image references on Beni's page`);
  const urls = await fetchImageUrls(API, files.map((f) => `File:${f}`));
  fs.mkdirSync(OUT, { recursive: true });

  let n = 0;
  for (const { title, url } of urls) {
    const safe = title.replace(/^File:/i, "").replace(/[^a-z0-9.-]+/gi, "_").slice(-80);
    const dest = path.join(OUT, `${String(n).padStart(3, "0")}-${safe}`);
    try {
      fs.writeFileSync(dest, await download(url));
      n++;
      process.stdout.write(`\r  downloaded ${n}/${urls.length}   `);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.log(`\n  failed ${title}: ${(err as Error).message}`);
    }
  }
  console.log(`\nSaved ${n} images to data/images/beni/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
