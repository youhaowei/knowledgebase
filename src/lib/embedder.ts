/**
 * Embedder - generates vector embeddings for text
 *
 * Primary: Ollama qwen3-embedding:4b (2560 dimensions)
 * Fallback: HuggingFace transformers.js Snowflake Arctic (384 dimensions)
 *
 * Tries Ollama first; falls back to transformers.js if unavailable.
 */

import {
  embedFallback,
  isFallbackAvailable,
  FALLBACK_DIM,
} from "./fallback-embedder.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.EMBEDDING_MODEL ?? "qwen3-embedding:4b";
const OLLAMA_DIM = 2560;
const ZERO_EMBEDDING_OLLAMA = new Array(OLLAMA_DIM).fill(0);
const ZERO_EMBEDDING_FALLBACK = new Array(FALLBACK_DIM).fill(0);

export type EmbedSource = "ollama" | "fallback";

export type EmbedResult = {
  embedding: number[];
  dimension: typeof OLLAMA_DIM | typeof FALLBACK_DIM;
  source: EmbedSource;
};

/** Check if an embedding is all zeros (sentinel for "no embedder available") */
export function isZeroEmbedding(embedding: number[]): boolean {
  return embedding.every((v) => v === 0);
}

let ollamaWarned = false;
let ollamaAvailable = true;

export { OLLAMA_DIM, FALLBACK_DIM };

/** Which embedding dimension is active for the current session */
export function getActiveDimension(): typeof OLLAMA_DIM | typeof FALLBACK_DIM {
  return ollamaAvailable ? OLLAMA_DIM : FALLBACK_DIM;
}

/**
 * Generate an Ollama embedding (2560-dim). Returns zero-vector on failure.
 * Backward-compatible — same behavior as before.
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

    ollamaAvailable = true;
    ollamaWarned = false;
    return data.embedding;
  } catch (err) {
    ollamaAvailable = false;
    if (!ollamaWarned) {
      console.warn(
        `[embedder] Ollama unavailable, falling back to transformers.js. Run db:reembed to backfill once Ollama is running. (${err instanceof Error ? err.message : err})`,
      );
      ollamaWarned = true;
    }
    return [...ZERO_EMBEDDING_OLLAMA];
  }
}

/**
 * Generate embeddings with dimension metadata.
 * Tries Ollama first → falls back to transformers.js → zero-vector as last resort.
 */
export async function embedWithDimension(text: string): Promise<EmbedResult> {
  // Try Ollama first
  const ollamaResult = await embed(text);
  if (ollamaAvailable) {
    return { embedding: ollamaResult, dimension: OLLAMA_DIM, source: "ollama" };
  }

  // Ollama failed — try fallback
  const fallbackResult = await embedFallback(text);
  if (!isZeroEmbedding(fallbackResult)) {
    return {
      embedding: fallbackResult,
      dimension: FALLBACK_DIM,
      source: "fallback",
    };
  }

  // Both failed — return zero-vector with fallback dimension
  return {
    embedding: [...ZERO_EMBEDDING_FALLBACK],
    dimension: FALLBACK_DIM,
    source: "fallback",
  };
}

/**
 * Generate both Ollama (2560) and fallback (384) embeddings simultaneously.
 * Used during ingestion to populate both vector indexes.
 */
export async function embedDual(
  text: string,
): Promise<{ ollama: number[]; fallback: number[] }> {
  const [ollamaResult, fallbackResult] = await Promise.all([
    embed(text),
    embedFallback(text),
  ]);
  return { ollama: ollamaResult, fallback: fallbackResult };
}

/** Check if Ollama is available and the model is ready */
export async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) {
      ollamaAvailable = false;
      return false;
    }

    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const available = data.models?.some((m) => m.name === MODEL) ?? false;
    ollamaAvailable = available;
    return available;
  } catch {
    ollamaAvailable = false;
    return false;
  }
}

/** Check if any embedding source is available (Ollama or fallback) */
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
