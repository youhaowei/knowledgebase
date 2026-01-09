import { test, expect, describe } from "bun:test";
import { embed, checkOllama } from "../src/lib/embedder";

describe("Embedder", () => {
  test("should check if Ollama is available", async () => {
    const available = await checkOllama();
    // This test might fail if Ollama isn't running
    expect(typeof available).toBe("boolean");
  });

  test("should generate embeddings for text", async () => {
    // Check Ollama availability first
    const isOllamaAvailable = await checkOllama();

    if (!isOllamaAvailable) {
      console.log("Skipping embedding test - Ollama not available");
      return; // Skip test gracefully
    }

    const embedding = await embed("Hello world");
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);
    expect(typeof embedding[0]).toBe("number");
  });
});
