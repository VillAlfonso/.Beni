import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiGet } from "./lib/fandom.js";
import { parsePage } from "./lib/wikitext.js";
import { writeCorpusDoc } from "./scrape-fandom.js";

const API = "https://en.wikipedia.org/w/api.php";

// The Wikipedia article covers the entire series (cast, plot, production), so
// its blocks are floored to episode 51 — visible only with an uncapped/late
// timeline. Foundational lore comes from per-topic fandom pages instead.
export async function scrapeWikipedia(): Promise<void> {
  const data = await apiGet(API, {
    action: "query",
    prop: "revisions",
    rvslots: "main",
    rvprop: "content",
    titles: "Tenkai Knights"
  });
  const content = data.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content;
  if (typeof content !== "string") {
    console.log("Wikipedia: article not found, skipping");
    return;
  }
  const blocks = parsePage(content, 51);
  writeCorpusDoc({
    source: "wikipedia",
    title: "Tenkai Knights (series overview)",
    kind: "concept",
    episode: null,
    url: "https://en.wikipedia.org/wiki/Tenkai_Knights",
    blocks
  });
  console.log(`Wikipedia: 1 doc, ${blocks.length} blocks`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) scrapeWikipedia().catch((e) => { console.error(e); process.exit(1); });
