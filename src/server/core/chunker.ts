export interface SectionBlock {
  heading: string;
  text: string;
  episode: number | null;
}

export interface Chunk {
  text: string;
  episode: number | null;
}

/**
 * Merge section blocks into retrieval chunks of ~target chars with overlap.
 * A chunk's episode tag is the max episode of the blocks it contains (null if
 * none are tagged) so the episode-cap filter can never leak future events.
 * Oversized blocks are split at sentence boundaries.
 */
export function chunkSections(
  sections: SectionBlock[],
  opts: { target?: number; overlap?: number } = {}
): Chunk[] {
  const target = opts.target ?? 1400;
  const overlap = opts.overlap ?? 200;
  const out: Chunk[] = [];

  let buf = "";
  let bufEp: number | null = null;

  const flush = () => {
    const text = buf.trim();
    if (text.length > 0) out.push({ text, episode: bufEp });
    buf = "";
    bufEp = null;
  };

  const push = (piece: string, ep: number | null) => {
    if (buf.length > 0 && buf.length + piece.length + 1 > target) {
      const tail = buf.slice(Math.max(0, buf.length - overlap));
      const tailEp = bufEp;
      flush();
      buf = tail.trimStart();
      bufEp = tailEp;
    }
    buf += (buf ? "\n" : "") + piece;
    if (ep !== null) bufEp = bufEp === null ? ep : Math.max(bufEp, ep);
  };

  for (const s of sections) {
    const headed = s.heading ? `## ${s.heading}\n${s.text}` : s.text;
    if (headed.length <= target) {
      push(headed, s.episode);
      continue;
    }
    // split long blocks at sentence-ish boundaries
    const sentences = headed.split(/(?<=[.!?])\s+/);
    let piece = "";
    for (const sent of sentences) {
      if (piece.length + sent.length + 1 > target && piece) {
        push(piece, s.episode);
        piece = piece.slice(Math.max(0, piece.length - overlap));
      }
      piece += (piece ? " " : "") + sent;
    }
    if (piece.trim()) push(piece, s.episode);
  }
  flush();
  return out.filter((c) => c.text.length >= 40);
}
