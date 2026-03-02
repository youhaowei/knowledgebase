import { test, expect, describe } from "bun:test";
import {
  embed,
  checkOllama,
  embedWithDimension,
  embedDual,
  getActiveDimension,
  checkAnyEmbedder,
  OLLAMA_DIM,
  FALLBACK_DIM,
} from "../src/lib/embedder";

describe("Embedder", () => {
  test("should check if Ollama is available", async () => {
    const available = await checkOllama();
    expect(typeof available).toBe("boolean");
  });

  test("should generate embeddings for text", async () => {
    const isOllamaAvailable = await checkOllama();

    if (!isOllamaAvailable) {
      console.log("Skipping Ollama embedding test - Ollama not available");
      return;
    }

    const embedding = await embed("Hello world");
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBe(OLLAMA_DIM);
    expect(typeof embedding[0]).toBe("number");
  });

  test("embedWithDimension returns correct metadata", async () => {
    const result = await embedWithDimension("test query");
    expect(result).toHaveProperty("embedding");
    expect(result).toHaveProperty("dimension");
    expect(result).toHaveProperty("source");
    expect(Array.isArray(result.embedding)).toBe(true);
    expect(result.embedding.length).toBe(result.dimension);
    expect([OLLAMA_DIM, FALLBACK_DIM]).toContain(result.dimension);
    expect(["ollama", "fallback"]).toContain(result.source);
  });

  test("embedDual returns both dimensions", async () => {
    const result = await embedDual("dual test");
    expect(result).toHaveProperty("ollama");
    expect(result).toHaveProperty("fallback");
    expect(Array.isArray(result.ollama)).toBe(true);
    expect(Array.isArray(result.fallback)).toBe(true);
    expect(result.ollama.length).toBe(OLLAMA_DIM);
    expect(result.fallback.length).toBe(FALLBACK_DIM);
  });

  test("getActiveDimension returns valid dimension", () => {
    const dim = getActiveDimension();
    expect([OLLAMA_DIM, FALLBACK_DIM]).toContain(dim);
  });

  test("checkAnyEmbedder returns structured result", async () => {
    const result = await checkAnyEmbedder();
    expect(typeof result.ollama).toBe("boolean");
    expect(typeof result.fallback).toBe("boolean");
    expect(typeof result.any).toBe("boolean");
    expect(result.any).toBe(result.ollama || result.fallback);
  });
});
