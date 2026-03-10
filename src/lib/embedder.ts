/**
 * Embedder - generates vector embeddings for text
 *
 * Primary: Ollama (model configurable via EMBEDDING_MODEL env var)
 * Fallback: HuggingFace transformers.js Snowflake Arctic
 *
 * Dimensions are detected from model output, not hardcoded.
 * Tries Ollama first; falls back to transformers.js if unavailable.
 */

import {
  embedFallback,
  isFallbackAvailable,
  getFallbackDim,
} from "./fallback-embedder.js";
import type { EmbeddingMap } from "../types.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.EMBEDDING_MODEL ?? "qwen3-embedding:4b";

export type EmbedSource = "ollama" | "fallback";

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
let ollamaAvailable = true;
let ollamaDim: number | null = null;

/** Get the detected Ollama embedding dimension (null if not yet detected) */
export function getOllamaDim(): number | null {
  return ollamaDim;
}

/** Which embedding dimension is active for the current session */
export function getActiveDimension(): number | null {
  if (ollamaAvailable && ollamaDim) return ollamaDim;
  return getFallbackDim();
}

/** Get all detected embedding dimensions */
export function getRegisteredDimensions(): number[] {
  const dims: number[] = [];
  if (ollamaDim) dims.push(ollamaDim);
  const fb = getFallbackDim();
  if (fb && fb !== ollamaDim) dims.push(fb);
  return dims;
}

/**
 * Generate an Ollama embedding. Returns empty array on failure.
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

    if (ollamaDim === null) {
      ollamaDim = data.embedding.length;
      console.error(`[embedder] Detected Ollama dimension: ${ollamaDim}`);
    }

    return data.embedding;
  } catch (err) {
    ollamaAvailable = false;
    if (!ollamaWarned) {
      console.warn(
        `[embedder] Ollama unavailable, falling back to transformers.js. Run db:reembed to backfill once Ollama is running. (${err instanceof Error ? err.message : err})`,
      );
      ollamaWarned = true;
    }
    return [];
  }
}

/**
 * Generate embeddings with dimension metadata.
 * Tries Ollama first → falls back to transformers.js → empty result as last resort.
 */
export async function embedWithDimension(text: string): Promise<EmbedResult> {
  const ollamaResult = await embed(text);
  if (ollamaAvailable && ollamaResult.length > 0) {
    return { embedding: ollamaResult, dimension: ollamaResult.length, source: "ollama" };
  }

  const fallbackResult = await embedFallback(text);
  if (fallbackResult.length > 0) {
    return {
      embedding: fallbackResult,
      dimension: fallbackResult.length,
      source: "fallback",
    };
  }

  return {
    embedding: [],
    dimension: 0,
    source: "fallback",
  };
}

/**
 * Generate embeddings from all available sources simultaneously.
 * Returns an EmbeddingMap keyed by detected dimension.
 * Used during ingestion to populate all vector indexes.
 */
export async function embedDual(text: string): Promise<EmbeddingMap> {
  const [ollamaResult, fallbackResult] = await Promise.all([
    embed(text),
    embedFallback(text),
  ]);

  const map: EmbeddingMap = new Map();

  if (ollamaDim && ollamaResult.length > 0 && !isZeroEmbedding(ollamaResult)) {
    map.set(ollamaDim, ollamaResult);
  }

  const fb = getFallbackDim();
  if (fb && fallbackResult.length > 0 && !isZeroEmbedding(fallbackResult)) {
    map.set(fb, fallbackResult);
  }

  return map;
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
