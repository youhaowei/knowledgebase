/**
 * Ollama Embedder - generates vector embeddings for text using local Ollama
 *
 * Uses qwen3-embedding:4b by default (2560 dimensions)
 * Fully local, no API costs
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.EMBEDDING_MODEL ?? "qwen3-embedding:4b";
const EMBEDDING_DIM = 2560;
const ZERO_EMBEDDING = new Array(EMBEDDING_DIM).fill(0);

let ollamaWarned = false;
let ollamaAvailable = true;

/** Whether vector search should be used. False when Ollama is unavailable. */
export function isVectorEnabled() {
  return ollamaAvailable;
}

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
        `[embedder] Ollama unavailable, vector search disabled. Run db:reembed to backfill once Ollama is running. (${err instanceof Error ? err.message : err})`,
      );
      ollamaWarned = true;
    }
    return [...ZERO_EMBEDDING];
  }
}

/**
 * Check if Ollama is available and the model is ready
 */
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
