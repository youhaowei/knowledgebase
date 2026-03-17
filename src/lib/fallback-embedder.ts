/**
 * Fallback Embedder - HuggingFace transformers.js with Snowflake Arctic
 *
 * Zero-dependency fallback when Ollama is unavailable.
 * Uses Snowflake/snowflake-arctic-embed-xs (384 dimensions)
 * Lazy-loads the model on first use.
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_ID = "Snowflake/snowflake-arctic-embed-xs";
let fallbackDim: number | null = null;

let pipeline: FeatureExtractionPipeline | null = null;
let initPromise: Promise<FeatureExtractionPipeline | null> | null = null;
let initFailed = false;
let initWarned = false;
let embedWarned = false;

/** Get the detected fallback embedding dimension (null if not yet detected) */
export function getFallbackDim(): number | null {
  return fallbackDim;
}

async function loadPipeline(): Promise<FeatureExtractionPipeline | null> {
  try {
    const { pipeline: createPipeline } = await import(
      "@huggingface/transformers"
    );
    const pipe = await createPipeline("feature-extraction", MODEL_ID, {
      dtype: "fp32",
    });
    console.error(`[embed] Fallback ready (${MODEL_ID})`);
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

/** Generate an embedding using transformers.js. Returns empty array on failure. */
export async function embedFallback(text: string): Promise<number[]> {
  const pipe = await ensurePipeline();
  if (!pipe) return [];

  try {
    const output = await pipe(text, { pooling: "cls", normalize: true });
    const result = Array.from(output.data as Float32Array);
    if (fallbackDim === null && result.length > 0) {
      fallbackDim = result.length;
      console.error(`[embed] Fallback dim: ${fallbackDim}`);
    }
    return result;
  } catch (err) {
    if (!embedWarned) {
      console.warn(
        `[fallback-embedder] Embedding failed: ${err instanceof Error ? err.message : err}`,
      );
      embedWarned = true;
    }
    return [];
  }
}
