import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL = "Xenova/bge-small-en-v1.5";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

let pipePromise: Promise<FeatureExtractionPipeline> | null = null;

// transformers.js overloads produce a union too complex for tsc — call through
// a narrowed signature instead.
const makePipeline = pipeline as unknown as (
  task: "feature-extraction",
  model: string,
  opts?: { dtype?: string }
) => Promise<FeatureExtractionPipeline>;

function getPipe(): Promise<FeatureExtractionPipeline> {
  if (!pipePromise) {
    pipePromise = makePipeline("feature-extraction", MODEL, { dtype: "q8" });
  }
  return pipePromise;
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getPipe();
  const out: Float32Array[] = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await pipe(batch, { pooling: "mean", normalize: true });
    const data = res.data as Float32Array;
    const dim = data.length / batch.length;
    for (let j = 0; j < batch.length; j++) {
      out.push(new Float32Array(data.slice(j * dim, (j + 1) * dim)));
    }
  }
  return out;
}

/** Embed corpus passages (no prefix). */
export function embedPassages(texts: string[]): Promise<Float32Array[]> {
  return embed(texts);
}

/** Embed a retrieval query (bge query prefix). */
export async function embedQuery(text: string): Promise<Float32Array> {
  const [v] = await embed([QUERY_PREFIX + text]);
  return v;
}

/** Warm the model at server start so the first chat isn't slow. */
export function warmup(): void {
  embed(["warmup"]).catch(() => {});
}
