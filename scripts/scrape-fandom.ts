import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAllPages, fetchPages } from "./lib/fandom.js";
import {
  parsePage,
  extractCategories,
  episodeNumberFor,
  slugify,
  EPISODES,
  type ParsedBlock
} from "./lib/wikitext.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://tenkai-knights.fandom.com/api.php";
const WIKI_BASE = "https://tenkai-knights.fandom.com/wiki/";
const CORPUS = path.join(ROOT, "data/corpus");
const RAW = path.join(ROOT, "data/raw/fandom");

const FANON_TITLE = /fanon|fan[ -]?made|fan[ -]?fic|\(fan|roleplay|rp\b/i;
const FANON_CAT = /fanon|fan[ -]?made|fan ?fiction|custom|original character|user/i;
const META_TITLE = /^(list of|timeline of)|wiki|disambig/i;

const CHARACTER_CATS = new Set([
  "characters", "tenkai knights characters", "main characters", "humans", "quartonians",
  "corrupted", "corekai", "guardians", "antagonists", "protagonists", "allies",
  "former enemies", "henchmen", "relatives", "adults", "parents", "female characters",
  "male characters", "soldiers", "beasts", "neutral", "villains"
]);
const LOCATION_CATS = new Set(["places", "cities", "planets", "locations", "worlds"]);
const ITEM_CATS = new Set(["devices", "vehicles", "modes", "weapons", "items", "keys", "cubes"]);
const CONCEPT_CATS = new Set([
  "terms", "tenkai knights terms", "webisodes", "tenkai knights webisodes", "events", "media"
]);
const MERCH_RX =
  /toys?$|figures?$|dvd|volume|companies|broadcasters?|retail|websites?|toy maker|action packs?|toy line|broadcast market|internet retailers|games|merchandise|stores?$|packs?$/i;

function classify(cats: string[], title: string): string {
  const set = new Set(cats.map((c) => c.trim().toLowerCase()));
  const has = (s: Set<string>) => [...set].some((c) => s.has(c));
  if (/\((toy|figure|vehicle|set)\)/i.test(title)) return "merch";
  if ((set.has("episodes") || set.has("tenkai knights episodes")) && episodeNumberFor(title) !== null)
    return "episode";
  if (has(CHARACTER_CATS)) return "character";
  if (has(LOCATION_CATS)) return "location";
  if (has(ITEM_CATS)) return "item";
  if (has(CONCEPT_CATS)) return "concept";
  if ([...set].some((c) => MERCH_RX.test(c))) return "merch";
  return "concept";
}

export function writeCorpusDoc(opts: {
  source: string;
  title: string;
  kind: string;
  episode: number | null;
  url: string;
  blocks: ParsedBlock[];
  slug?: string;
}): number {
  fs.mkdirSync(CORPUS, { recursive: true });
  const lines: string[] = [
    "---",
    `source: ${opts.source}`,
    `title: ${JSON.stringify(opts.title)}`,
    `kind: ${opts.kind}`,
    `episode: ${opts.episode === null ? "null" : opts.episode}`,
    `url: ${JSON.stringify(opts.url)}`,
    "---",
    ""
  ];
  let lastHeading: string | null = null;
  let total = 0;
  for (const b of opts.blocks) {
    if (b.heading && b.heading !== lastHeading) {
      lines.push(`## ${b.heading}`, "");
      lastHeading = b.heading;
    }
    if (b.episode !== null) lines.push(`<!--ep:${b.episode}-->`);
    lines.push(b.text, "");
    total += b.text.length;
  }
  const file = path.join(CORPUS, `${opts.source}--${opts.slug ?? slugify(opts.title)}.md`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return total;
}

export async function scrapeFandom(): Promise<void> {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(CORPUS, { recursive: true });
  // idempotent: clear this scraper's previous output so reclassified/removed
  // pages never leave stale corpus files behind
  for (const f of fs.readdirSync(CORPUS)) {
    if (f.startsWith("fandom--")) fs.rmSync(path.join(CORPUS, f));
  }
  for (const f of fs.readdirSync(RAW)) fs.rmSync(path.join(RAW, f));
  console.log("Listing pages…");
  const titles = await listAllPages(API);
  console.log(`  ${titles.length} main-namespace pages`);

  const wanted = titles.filter((t) => !FANON_TITLE.test(t) && !META_TITLE.test(t));
  const pages = await fetchPages(API, wanted);

  let kept = 0;
  let skippedFanon = 0;
  let skippedSmall = 0;
  const synopses = new Map<number, string>();
  const byKind: Record<string, number> = {};
  const usedSlugs = new Map<string, number>();
  const inventory: { title: string; kind: string; cats: string[] }[] = [];

  for (const page of pages) {
    const cats = extractCategories(page.wikitext);
    if (FANON_CAT.test(cats.join(" | "))) {
      skippedFanon++;
      continue;
    }
    const epNo = episodeNumberFor(page.title);
    if ((cats.some((c) => /episodes/i.test(c)) && epNo === null)) {
      skippedFanon++; // an "episode" outside the canonical 51 → fan content
      continue;
    }
    const kind = classify(cats, page.title);
    const blocks = parsePage(page.wikitext, kind === "episode" ? epNo : null);
    const textLen = blocks.reduce((n, b) => n + b.text.length, 0);
    if (textLen < 200 && kind !== "episode") {
      skippedSmall++;
      continue;
    }

    let slug = slugify(page.title);
    const seen = usedSlugs.get(slug) ?? 0;
    usedSlugs.set(slug, seen + 1);
    if (seen > 0) slug = `${slug}-${seen + 1}`;

    fs.writeFileSync(path.join(RAW, `${slug}.wikitext`), page.wikitext, "utf8");
    writeCorpusDoc({
      source: "fandom",
      title: page.title,
      kind,
      episode: kind === "episode" ? epNo : null,
      url: WIKI_BASE + encodeURIComponent(page.title.replace(/ /g, "_")),
      blocks,
      slug
    });
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    inventory.push({ title: page.title, kind, cats });
    kept++;

    if (kind === "episode" && epNo !== null && !synopses.has(epNo)) {
      const prose = blocks
        .filter((b) => b.heading !== "Facts")
        .map((b) => b.text)
        .join(" ");
      synopses.set(epNo, prose.slice(0, 500));
    }
  }

  // Every canonical episode gets an entry so Story mode can anchor anywhere.
  const episodes = EPISODES.filter((e) => !e.special).map((e) => ({
    no: e.no,
    title: e.title,
    synopsis: synopses.get(e.no) ?? ""
  }));
  fs.writeFileSync(path.join(ROOT, "data/episodes.json"), JSON.stringify(episodes, null, 2), "utf8");
  fs.writeFileSync(path.join(RAW, "_pages.json"), JSON.stringify(inventory, null, 2), "utf8");

  console.log(`Fandom: kept ${kept} docs (${JSON.stringify(byKind)}), skipped ${skippedFanon} fanon/meta, ${skippedSmall} tiny; ${[...synopses.keys()].length}/51 episode synopses.`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) scrapeFandom().catch((e) => { console.error(e); process.exit(1); });
