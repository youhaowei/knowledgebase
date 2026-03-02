/**
 * Fallback Embedder - HuggingFace transformers.js with Snowflake Arctic
 *
 * Zero-dependency fallback when Ollama is unavailable.
 * Uses Snowflake/snowflake-arctic-embed-xs (384 dimensions)
 * Lazy-loads the model on first use.
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_ID = "Snowflake/snowflake-arctic-embed-xs";
const FALLBACK_DIM = 384;
const ZERO_EMBEDDING = new Array(FALLBACK_DIM).fill(0);

let pipeline: FeatureExtractionPipeline | null = null;
let initPromise: Promise<FeatureExtractionPipeline | null> | null = null;
let initFailed = false;
let initWarned = false;
let embedWarned = false;

export { FALLBACK_DIM };

async function loadPipeline(): Promise<FeatureExtractionPipeline | null> {
  try {
    const { pipeline: createPipeline } = await import(
      "@huggingface/transformers"
    );
    const pipe = await createPipeline("feature-extraction", MODEL_ID, {
      dtype: "fp32",
    });
    console.error(
      `[fallback-embedder] Loaded ${MODEL_ID} (${FALLBACK_DIM}-dim)`,
    );
    return pipe as FeatureExtractionPipeline;
  } catch (err) {
    initFailed = true;
    if (!initWarned) {
      console.warn(
        `[fallback-embedder] Failed to load transformers.js model. Vector search requires Ollama. (${err instanceof Error ? err.message : err})`,
      );
      initWarned = true;
    }
    return null;
  }
}

/** Initialize the fallback embedder. Singleton — safe to call concurrently. */
async function ensurePipeline(): Promise<FeatureExtractionPipeline | null> {
  if (pipeline) return pipeline;
  if (initFailed) return null;
  if (!initPromise) {
    initPromise = loadPipeline().then((p) => {
      pipeline = p;
      return p;
    });
  }
  return initPromise;
}

/** Whether the fallback embedder is available */
export async function isFallbackAvailable(): Promise<boolean> {
  const pipe = await ensurePipeline();
  return pipe !== null;
}

/** Generate a 384-dim embedding using transformers.js. Returns zero-vector on failure. */
export async function embedFallback(text: string): Promise<number[]> {
  const pipe = await ensurePipeline();
  if (!pipe) return [...ZERO_EMBEDDING];

  try {
    const output = await pipe(text, { pooling: "cls", normalize: true });
    return Array.from(output.data as Float32Array);
  } catch (err) {
    if (!embedWarned) {
      console.warn(
        `[fallback-embedder] Embedding failed: ${err instanceof Error ? err.message : err}`,
      );
      embedWarned = true;
    }
    return [...ZERO_EMBEDDING];
  }
}
