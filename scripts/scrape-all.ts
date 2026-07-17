import { scrapeFandom } from "./scrape-fandom.js";
import { scrapeWikipedia } from "./scrape-wikipedia.js";
import { scrapeTvTropes } from "./scrape-tvtropes.js";

const steps: [string, () => Promise<void>][] = [
  ["fandom wiki", scrapeFandom],
  ["wikipedia", scrapeWikipedia],
  ["tv tropes", scrapeTvTropes]
];

for (const [name, fn] of steps) {
  console.log(`\n=== Scraping ${name} ===`);
  try {
    await fn();
  } catch (err) {
    console.error(`${name} failed:`, (err as Error).message);
  }
}
console.log("\nDone. Next: npm run ingest");
