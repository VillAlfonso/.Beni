/**
 * Ingest the timeline's per-episode `recall` digests (Beni's own first-person
 * memory of each episode) into the RAG corpus as episode-tagged chunks, so the
 * existing capped retrieval can surface her lived history on demand.
 *
 * Idempotent and re-runnable: unchanged digests are skipped by hash; edited
 * ones are re-embedded. Run after authoring or editing episode files:
 *   npm run ingest:recall
 * (Restart the app server afterward — it caches canon chunks in memory.)
 */
import { createHash } from "node:crypto";
import { getDb, newId } from "../src/server/db.js";
import { embedPassages } from "../src/server/rag/embedder.js";
import { toBlob } from "../src/server/core/vector.js";
import { reloadTimeline, allEpisodes } from "../src/server/timeline/load.js";

const SOURCE = "timeline-recall";
const KIND = "beni-recall";

async function main(): Promise<void> {
  reloadTimeline();
  const eps = allEpisodes().filter((e) => !e.beniAbsent && e.recall.trim());
  if (eps.length === 0) {
    console.log("no recall digests to ingest yet");
    return;
  }

  const db = getDb();
  let updated = 0;
  let unchanged = 0;

  for (const ep of eps) {
    const title = `Beni's memory — ep ${String(ep.no).padStart(2, "0")} "${ep.title}"`;
    const text = ep.recall.trim();
    const hash = createHash("sha1").update(`${KIND}|${ep.no}\n${text}`).digest("hex");

    const existing = db
      .prepare("SELECT id, hash FROM docs WHERE source=? AND title=?")
      .get(SOURCE, title) as { id: string; hash: string } | undefined;
    if (existing && existing.hash === hash) {
      unchanged++;
      continue;
    }
    if (existing) db.prepare("DELETE FROM docs WHERE id=?").run(existing.id);

    const docId = newId();
    db.prepare(
      "INSERT INTO docs(id,source,title,kind,episode,url,content,hash,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
    ).run(docId, SOURCE, title, KIND, ep.no, null, text, hash, Date.now());

    const [vec] = await embedPassages([text]);
    db.prepare("INSERT INTO chunks(id,doc_id,seq,text,episode,kind,embedding) VALUES(?,?,?,?,?,?,?)").run(
      newId(),
      docId,
      0,
      text,
      ep.no,
      KIND,
      toBlob(vec)
    );
    updated++;
  }

  console.log(`recall ingest: ${updated} embedded, ${unchanged} unchanged (of ${eps.length} digests)`);
}

void main();
