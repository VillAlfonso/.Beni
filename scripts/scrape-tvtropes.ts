import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { writeCorpusDoc } from "./scrape-fandom.js";
import type { ParsedBlock } from "./lib/wikitext.js";

const PAGES = [
  { url: "https://tvtropes.org/pmwiki/pmwiki.php/Anime/TenkaiKnights", title: "TV Tropes: Tenkai Knights", kind: "concept" },
  { url: "https://tvtropes.org/pmwiki/pmwiki.php/Characters/TenkaiKnights", title: "TV Tropes: Tenkai Knights Characters", kind: "character" }
];

// Trope pages describe the whole series arc (peak spoilers), so every block is
// tagged episode 51 — retrievable only at the latest timeline stages.
export async function scrapeTvTropes(): Promise<void> {
  let count = 0;
  for (const page of PAGES) {
    try {
      const res = await fetch(page.url, {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BeniRP personal archive" }
      });
      if (!res.ok) {
        console.log(`TV Tropes: ${page.url} → HTTP ${res.status}, skipping`);
        continue;
      }
      const $ = cheerio.load(await res.text());
      $("#main-article script, #main-article style, #main-article .proper-ad-unit").remove();
      const blocks: ParsedBlock[] = [];
      let heading = "";
      $("#main-article").children().each((_, el) => {
        const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "";
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (!text) return;
        if (/^h[1-4]$/.test(tag)) {
          heading = text;
        } else if (text.length > 60) {
          blocks.push({ heading, text, episode: 51 });
        }
      });
      // folders (character entries) render as li items
      $("#main-article li").each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (text.length > 80) blocks.push({ heading: "Tropes", text, episode: 51 });
      });
      if (blocks.length === 0) {
        console.log(`TV Tropes: ${page.url} → no content parsed, skipping`);
        continue;
      }
      writeCorpusDoc({ source: "tvtropes", title: page.title, kind: page.kind, episode: null, url: page.url, blocks });
      count++;
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.log(`TV Tropes: ${page.url} failed (${(err as Error).message}), skipping`);
    }
  }
  console.log(`TV Tropes: ${count} docs`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) scrapeTvTropes().catch((e) => { console.error(e); process.exit(1); });
