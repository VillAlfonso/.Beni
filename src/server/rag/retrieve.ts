import type { Db } from "../db.js";
import { cosineTopK, fromBlob, type VecRow } from "../core/vector.js";
import { embedQuery } from "./embedder.js";

export interface CanonHit {
  id: string;
  text: string;
  episode: number | null;
  kind: string;
  docTitle: string;
  score: number;
}

export interface MemoryHit {
  id: string;
  text: string;
  importance: number;
  score: number;
}

let canonCache: { rows: VecRow[]; texts: Map<string, { text: string; docTitle: string }> } | null = null;

export function reloadCanon(): void {
  canonCache = null;
}

function loadCanon(db: Db) {
  if (canonCache) return canonCache;
  const rows: VecRow[] = [];
  const texts = new Map<string, { text: string; docTitle: string }>();
  const all = db
    .prepare(
      `SELECT c.id, c.text, c.episode, c.kind, c.embedding, d.title AS docTitle
       FROM chunks c JOIN docs d ON d.id = c.doc_id
       WHERE c.embedding IS NOT NULL`
    )
    .all() as { id: string; text: string; episode: number | null; kind: string; embedding: Buffer; docTitle: string }[];
  for (const r of all) {
    rows.push({ id: r.id, vec: fromBlob(r.embedding), episode: r.episode, kind: r.kind });
    texts.set(r.id, { text: r.text, docTitle: r.docTitle });
  }
  canonCache = { rows, texts };
  return canonCache;
}

/** Semantic canon lookup, hard-filtered by episode cap (merch always excluded). */
export async function retrieveCanon(
  db: Db,
  query: string,
  opts: { cap: number; k?: number }
): Promise<CanonHit[]> {
  const { rows, texts } = loadCanon(db);
  if (rows.length === 0) return [];
  const q = await embedQuery(query);
  const hits = cosineTopK(q, rows, opts.k ?? 6, {
    episodeCap: opts.cap,
    excludeKinds: ["merch"],
    minScore: 0.35
  });
  return hits.map((h) => {
    const row = rows.find((r) => r.id === h.id)!;
    const t = texts.get(h.id)!;
    return { id: h.id, text: t.text, episode: row.episode, kind: row.kind, docTitle: t.docTitle, score: h.score };
  });
}

/** Per-chat episodic memory lookup. */
export async function retrieveMemories(
  db: Db,
  chatId: string,
  query: string,
  opts: { k?: number } = {}
): Promise<MemoryHit[]> {
  const mems = db
    .prepare("SELECT id, text, importance, embedding FROM memories WHERE chat_id=? AND embedding IS NOT NULL")
    .all(chatId) as { id: string; text: string; importance: number; embedding: Buffer }[];
  if (mems.length === 0) return [];
  const q = await embedQuery(query);
  const rows: VecRow[] = mems.map((m) => ({ id: m.id, vec: fromBlob(m.embedding), episode: null, kind: "memory" }));
  const hits = cosineTopK(q, rows, opts.k ?? 6, { minScore: 0.3 });
  return hits.map((h) => {
    const m = mems.find((x) => x.id === h.id)!;
    return { id: m.id, text: m.text, importance: m.importance, score: h.score };
  });
}
