/**
 * Ollama Embedder - generates vector embeddings for text using local Ollama
 *
 * Uses qwen3-embedding:4b by default (2560 dimensions)
 * Fully local, no API costs
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.EMBEDDING_MODEL ?? "qwen3-embedding:4b";

export async function embed(text: string): Promise<number[]> {
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

  return data.embedding;
}

/**
 * Check if Ollama is available and the model is ready
 */
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
