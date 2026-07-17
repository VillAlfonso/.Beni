import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- canonical episode map ----------

interface EpisodeEntry {
  no: number;
  title: string;
  special?: boolean;
}
const epMapFile = JSON.parse(fs.readFileSync(path.join(HERE, "../episode-map.json"), "utf8")) as {
  episodes: EpisodeEntry[];
  aliases: Record<string, number>;
};

export const EPISODES: EpisodeEntry[] = epMapFile.episodes;

export function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const EP_LOOKUP = new Map<string, number>();
for (const e of EPISODES) EP_LOOKUP.set(normTitle(e.title), e.no);
for (const [alias, no] of Object.entries(epMapFile.aliases)) EP_LOOKUP.set(normTitle(alias), no);

export function episodeNumberFor(title: string): number | null {
  return EP_LOOKUP.get(normTitle(title)) ?? null;
}

// Long-ish titles usable for plain-text mention scanning (avoid false hits on
// short/generic words). Sorted longest first.
const TEXT_SCAN: { rx: RegExp; no: number }[] = EPISODES.filter((e) => e.title.length >= 8).map((e) => ({
  rx: new RegExp(e.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  no: e.no
}));

// ---------- wikitext cleaning ----------

/** Strip {{...}} templates with nesting support. */
export function stripTemplates(src: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    if (src.startsWith("{{", i)) {
      depth++;
      i++;
      continue;
    }
    if (src.startsWith("}}", i) && depth > 0) {
      depth--;
      i++;
      continue;
    }
    if (depth === 0) out += src[i];
  }
  return out;
}

function stripTables(src: string): string {
  return src.replace(/\{\|[\s\S]*?\|\}/g, "");
}

function stripGalleries(src: string): string {
  return src.replace(/<gallery[\s\S]*?<\/gallery>/gi, "");
}

/** [[Category:X]] targets. */
export function extractCategories(src: string): string[] {
  const out: string[] = [];
  const rx = /\[\[\s*Category\s*:\s*([^\]|]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(src))) out.push(m[1].trim());
  return out;
}

/** All [[link]] targets (excluding File/Category/Image). */
export function extractLinkTargets(src: string): string[] {
  const out: string[] = [];
  const rx = /\[\[\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(src))) {
    const t = m[1];
    if (/^(file|image|category)\s*:/i.test(t)) continue;
    out.push(t.replace(/#.*$/, "").trim());
  }
  return out;
}

/** Max canonical episode referenced in a wikitext block (links + plain text). */
export function maxEpisodeRef(block: string): number | null {
  let max: number | null = null;
  for (const target of extractLinkTargets(block)) {
    const no = episodeNumberFor(target);
    if (no !== null) max = max === null ? no : Math.max(max, no);
  }
  const plain = block.replace(/\[\[[^\]]*\]\]/g, " ");
  for (const { rx, no } of TEXT_SCAN) {
    if (rx.test(plain)) max = max === null ? no : Math.max(max, no);
  }
  return max;
}

/** Convert a wikitext block to plain readable text. */
export function cleanBlock(src: string): string {
  let t = src;
  t = t.replace(/\[\[\s*(?:file|image)\s*:[^\]]*\]\]/gi, "");
  t = t.replace(/\[\[\s*category\s*:[^\]]*\]\]/gi, "");
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  t = t.replace(/\[\[([^\]]+)\]\]/g, "$1");
  t = t.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1");
  t = t.replace(/\[https?:\/\/[^\]]+\]/g, "");
  t = t.replace(/'''''|'''|''/g, "");
  t = t.replace(/<ref[^>]*\/>/gi, "");
  t = t.replace(/<ref[\s\S]*?<\/ref>/gi, "");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/^\s*[*#:;]+\s*/gm, "- ");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export interface ParsedBlock {
  heading: string;
  text: string;
  episode: number | null;
}

const SKIP_SECTIONS =
  /^(gallery|videos?|links?|references?|external links?|navigation|see also|site navigation|trivia sources)$/i;

/**
 * Parse page wikitext into cleaned blocks with per-paragraph episode tags.
 * `defaultEpisode` (for episode pages) floors every block's tag.
 */
export function parsePage(wikitext: string, defaultEpisode: number | null = null): ParsedBlock[] {
  let body = stripGalleries(stripTables(wikitext));
  // keep infobox fields before dropping templates
  const infobox = extractInfoboxFacts(wikitext);
  body = stripTemplates(body);

  const lines = body.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];
  let heading = "";
  let buf: string[] = [];

  const flush = () => {
    const raw = buf.join("\n").trim();
    buf = [];
    if (!raw) return;
    if (SKIP_SECTIONS.test(heading.trim())) return;
    // paragraph-level tagging: split on blank lines
    for (const para of raw.split(/\n\s*\n/)) {
      const clean = cleanBlock(para);
      if (clean.length < 30) continue;
      const ref = maxEpisodeRef(para);
      const episode =
        defaultEpisode !== null
          ? Math.max(defaultEpisode, ref ?? defaultEpisode)
          : ref;
      blocks.push({ heading, text: clean, episode });
    }
  };

  for (const line of lines) {
    const h = /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(line);
    if (h) {
      flush();
      heading = cleanBlock(h[2]);
    } else {
      buf.push(line);
    }
  }
  flush();

  if (infobox) blocks.unshift({ heading: "Facts", text: infobox, episode: defaultEpisode });
  return blocks;
}

/** Pull simple |key = value fields out of the first infobox template. */
export function extractInfoboxFacts(wikitext: string): string | null {
  const start = wikitext.search(/\{\{\s*Infobox/i);
  if (start === -1) return null;
  // find matching close
  let depth = 0;
  let end = -1;
  for (let i = start; i < wikitext.length; i++) {
    if (wikitext.startsWith("{{", i)) {
      depth++;
      i++;
    } else if (wikitext.startsWith("}}", i)) {
      depth--;
      i++;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;
  const box = wikitext.slice(start, end);
  const facts: string[] = [];
  const rx = /\|\s*([A-Za-z][A-Za-z0-9 _/-]*?)\s*=\s*([^\n|][^\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(box))) {
    const key = m[1].trim();
    if (/^(image|imagewidth|name|caption)$/i.test(key)) continue;
    const val = cleanBlock(m[2]);
    if (val && val.length < 200) facts.push(`${key}: ${val}`);
  }
  return facts.length ? facts.join("\n") : null;
}

/** <gallery> file entries plus infobox image, for the image downloader. */
export function extractImageFiles(wikitext: string): string[] {
  const files = new Set<string>();
  const galleries = wikitext.match(/<gallery[\s\S]*?<\/gallery>/gi) ?? [];
  for (const g of galleries) {
    for (const line of g.split(/\r?\n/)) {
      const name = line.replace(/<[^>]+>/g, "").split("|")[0].trim();
      if (/\.(png|jpe?g|gif|webp)$/i.test(name)) files.add(name);
    }
  }
  const rx = /\[\[\s*(?:file|image)\s*:\s*([^\]|]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(wikitext))) {
    const name = m[1].trim();
    if (/\.(png|jpe?g|gif|webp)$/i.test(name)) files.add(name);
  }
  const box = /\|\s*image\s*=\s*(?:\[\[\s*(?:file|image)\s*:\s*)?([^\]|\n]+)/i.exec(wikitext);
  if (box && /\.(png|jpe?g|gif|webp)$/i.test(box[1].trim())) files.add(box[1].trim());
  return [...files];
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "page"
  );
}
