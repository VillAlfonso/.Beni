import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { getDb, newId, DATA_DIR } from "../src/server/db.js";
import { chunkSections, type SectionBlock } from "../src/server/core/chunker.js";
import { embedPassages } from "../src/server/rag/embedder.js";
import { toBlob } from "../src/server/core/vector.js";

interface DocInput {
  source: string;
  title: string;
  kind: string;
  episode: number | null;
  url: string | null;
  blocks: SectionBlock[];
}

/** Parse a corpus .md body back into section blocks (see scrape-fandom output). */
export function parseCorpusBody(body: string): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  let heading = "";
  let pendingEp: number | null = null;
  let para: string[] = [];

  const flush = () => {
    const text = para.join("\n").trim();
    para = [];
    if (text) blocks.push({ heading, text, episode: pendingEp });
    pendingEp = null;
  };

  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.+)$/.exec(line);
    const ep = /^<!--ep:(\d+(?:\.\d+)?)-->$/.exec(line.trim());
    if (h) {
      flush();
      heading = h[1].trim();
    } else if (ep) {
      flush();
      pendingEp = Number(ep[1]);
    } else if (line.trim() === "") {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

function loadCorpusDocs(): DocInput[] {
  const dir = path.join(DATA_DIR, "corpus");
  if (!fs.existsSync(dir)) return [];
  const out: DocInput[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const { data, content } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
    out.push({
      source: String(data.source ?? "manual"),
      title: String(data.title ?? file),
      kind: String(data.kind ?? "concept"),
      episode: data.episode === null || data.episode === undefined ? null : Number(data.episode),
      url: data.url ? String(data.url) : null,
      blocks: parseCorpusBody(content)
    });
  }
  return out;
}

interface TranscriptLine {
  speaker: string;
  text: string;
}

function loadTranscriptDocs(): DocInput[] {
  const dir = path.join(DATA_DIR, "transcripts");
  if (!fs.existsSync(dir)) return [];
  const out: DocInput[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
        episode: number;
        title?: string;
        lines: TranscriptLine[];
      };
      if (!Array.isArray(data.lines) || typeof data.episode !== "number") continue;
      const blocks: SectionBlock[] = [];
      const WINDOW = 15;
      const STEP = 10;
      for (let i = 0; i < data.lines.length; i += STEP) {
        const win = data.lines.slice(i, i + WINDOW);
        if (win.length < 3) break;
        blocks.push({
          heading: `Episode ${data.episode} dialogue`,
          text: win.map((l) => `${l.speaker}: ${l.text}`).join("\n"),
          episode: data.episode
        });
      }
      out.push({
        source: "transcript",
        title: data.title ? `Ep ${data.episode}: ${data.title}` : `Episode ${data.episode} transcript`,
        kind: "transcript",
        episode: data.episode,
        url: null,
        blocks
      });
    } catch {
      console.warn(`  skipping unparseable transcript ${file}`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const db = getDb();
  const docs = [...loadCorpusDocs(), ...loadTranscriptDocs()];
  if (docs.length === 0) {
    console.error("No corpus found. Run `npm run scrape` first.");
    process.exit(1);
  }

  let unchanged = 0;
  let updated = 0;
  let chunksEmbedded = 0;

  for (const doc of docs) {
    const content = doc.blocks.map((b) => `${b.heading}\n${b.text}`).join("\n\n");
    const hash = createHash("sha1").update(content).digest("hex");
    const existing = db
      .prepare("SELECT id, hash FROM docs WHERE source=? AND title=?")
      .get(doc.source, doc.title) as { id: string; hash: string } | undefined;

    if (existing && existing.hash === hash) {
      unchanged++;
      continue;
    }
    if (existing) db.prepare("DELETE FROM docs WHERE id=?").run(existing.id);

    const docId = newId();
    db.prepare(
      "INSERT INTO docs(id,source,title,kind,episode,url,content,hash,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
    ).run(docId, doc.source, doc.title, doc.kind, doc.episode, doc.url, content, hash, Date.now());

    const chunks = chunkSections(doc.blocks);
    if (chunks.length > 0) {
      const vecs = await embedPassages(chunks.map((c) => c.text));
      const ins = db.prepare(
        "INSERT INTO chunks(id,doc_id,seq,text,episode,kind,embedding) VALUES(?,?,?,?,?,?,?)"
      );
      const tx = db.transaction(() => {
        chunks.forEach((c, i) => {
          ins.run(newId(), docId, i, c.text, c.episode, doc.kind, toBlob(vecs[i]));
        });
      });
      tx();
      chunksEmbedded += chunks.length;
    }
    updated++;
    process.stdout.write(`\r  ingested ${updated} docs (${chunksEmbedded} chunks)   `);
  }

  const totals = db.prepare("SELECT (SELECT COUNT(*) FROM docs) d, (SELECT COUNT(*) FROM chunks) c").get() as {
    d: number;
    c: number;
  };
  console.log(
    `\nIngest done: ${updated} docs embedded, ${unchanged} unchanged. DB now has ${totals.d} docs / ${totals.c} chunks.`
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
