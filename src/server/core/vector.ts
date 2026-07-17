export interface VecRow {
  id: string;
  vec: Float32Array;
  episode: number | null;
  kind: string;
}

export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function fromBlob(b: Buffer): Float32Array {
  // Copy to guarantee alignment regardless of Buffer pool offsets.
  const copy = Buffer.from(b);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

/**
 * Top-k by dot product (vectors must be L2-normalized).
 * Rows with episode > episodeCap are excluded; episode NULL passes any cap.
 */
export function cosineTopK(
  query: Float32Array,
  rows: VecRow[],
  k: number,
  opts: { episodeCap?: number | null; excludeKinds?: string[]; minScore?: number } = {}
): { id: string; score: number }[] {
  const cap = opts.episodeCap ?? null;
  const excluded = new Set(opts.excludeKinds ?? []);
  const minScore = opts.minScore ?? -Infinity;
  const scored: { id: string; score: number }[] = [];
  for (const row of rows) {
    if (cap !== null && row.episode !== null && row.episode > cap) continue;
    if (excluded.has(row.kind)) continue;
    const v = row.vec;
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i] * query[i];
    if (dot < minScore) continue;
    scored.push({ id: row.id, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
