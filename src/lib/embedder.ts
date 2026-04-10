/**
 * Embedder - generates vector embeddings for text
 *
 * Primary: HuggingFace transformers.js Snowflake Arctic xs (384-dim, in-process)
 * Complementary: Ollama (model configurable via EMBEDDING_MODEL env var)
 *
 * The built-in embedder is always available and is sufficient for all retrieval
 * workloads (validated by benchmark: 100% R@1 with Haiku extractor, ≤5pp gap
 * from Ollama on all extractors). Ollama is an optional upgrade for memory-text
 * retrieval where the larger model has a marginal edge.
 *
 * Dimensions are detected from model output, not hardcoded.
 */

import {
  embedFallback,
  isFallbackAvailable,
  getFallbackDim,
} from "./fallback-embedder.js";
import type { EmbeddingMap } from "../types.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.EMBEDDING_MODEL ?? "qwen3-embedding:4b";

export type EmbedSource = "ollama" | "builtin";

export type EmbedResult = {
  embedding: number[];
  dimension: number;
  source: EmbedSource;
};

/** Check if an embedding is all zeros or empty */
export function isZeroEmbedding(embedding: number[]): boolean {
  return embedding.length === 0 || embedding.every((v) => v === 0);
}

let ollamaWarned = false;
let ollamaDim: number | null = null;

/** Get the detected Ollama embedding dimension (null if not yet detected) */
export function getOllamaDim(): number | null {
  return ollamaDim;
}

/** Which embedding dimension is active for the current session.
 *  Always returns the built-in (384d) as primary. */
export function getActiveDimension(): number | null {
  return getFallbackDim();
}

/** Get all detected embedding dimensions */
export function getRegisteredDimensions(): number[] {
  const dims: number[] = [];
  const fb = getFallbackDim();
  if (fb) dims.push(fb);
  if (ollamaDim && ollamaDim !== fb) dims.push(ollamaDim);
  return dims;
}

/**
 * Generate an Ollama embedding. Returns empty array on failure.
 * This is the complementary path — used for dual-index ingestion when
 * Ollama is available, not for primary retrieval.
 */
export async function embed(text: string): Promise<number[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: text,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Embedding failed (${res.status}): ${error}`);
    }

    const data = (await res.json()) as { embedding?: number[] };

    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error("Invalid embedding response from Ollama");
    }

    ollamaWarned = false;

    if (ollamaDim === null) {
      ollamaDim = data.embedding.length;
      console.error(`[embed] Ollama dim: ${ollamaDim}`);
    }

    return data.embedding;
  } catch (err) {
    if (!ollamaWarned) {
      console.error(
        `[embed] Ollama embedding unavailable, using built-in only. (${err instanceof Error ? err.message : err})`,
      );
      ollamaWarned = true;
    }
    return [];
  }
}

/**
 * Generate embedding using the built-in model (primary).
 * Always uses Snowflake Arctic xs (384-dim, in-process via transformers.js).
 */
export async function embedWithDimension(text: string): Promise<EmbedResult> {
  const result = await embedFallback(text);
  if (result.length > 0) {
    return {
      embedding: result,
      dimension: result.length,
      source: "builtin",
    };
  }

  // Built-in failed (shouldn't happen) — try Ollama as last resort
  const ollamaResult = await embed(text);
  if (ollamaResult.length > 0) {
    return { embedding: ollamaResult, dimension: ollamaResult.length, source: "ollama" };
  }

  return { embedding: [], dimension: 0, source: "builtin" };
}

/**
 * Generate embeddings from all available sources simultaneously.
 * Returns an EmbeddingMap keyed by detected dimension.
 * Used during ingestion to populate all vector indexes.
 *
 * Built-in always runs. Ollama runs best-effort — if it's down,
 * only the built-in embedding is returned. This is fine: the built-in
 * index is sufficient for retrieval, the Ollama index is a bonus.
 */
export async function embedDual(text: string): Promise<EmbeddingMap> {
  const [ollamaResult, builtinResult] = await Promise.all([
    embed(text),
    embedFallback(text),
  ]);

  const map: EmbeddingMap = new Map();

  // Built-in always goes in first (primary)
  const fb = getFallbackDim();
  if (fb && builtinResult.length > 0 && !isZeroEmbedding(builtinResult)) {
    map.set(fb, builtinResult);
  }

  // Ollama is complementary — add if available
  if (ollamaDim && ollamaResult.length > 0 && !isZeroEmbedding(ollamaResult)) {
    map.set(ollamaDim, ollamaResult);
  }

  return map;
}

/** Check if Ollama is available and the model is ready */
export async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return false;

    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return data.models?.some((m) => m.name === MODEL) ?? false;
  } catch {
    return false;
  }
}

/** Check if any embedding source is available (built-in or Ollama) */
export async function checkAnyEmbedder(): Promise<{
  ollama: boolean;
  fallback: boolean;
  any: boolean;
}> {
  const [ollama, fallback] = await Promise.all([
    checkOllama(),
    isFallbackAvailable(),
  ]);
  return { ollama, fallback, any: ollama || fallback };
}
