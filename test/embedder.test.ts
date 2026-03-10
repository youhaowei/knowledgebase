import { test, expect, describe } from "bun:test";
import {
  embed,
  checkOllama,
  embedWithDimension,
  embedDual,
  getActiveDimension,
  checkAnyEmbedder,
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
    expect(embedding.length).toBeGreaterThan(0);
    expect(typeof embedding[0]).toBe("number");
  });

  test("embedWithDimension returns correct metadata", async () => {
    const result = await embedWithDimension("test query");
    expect(result).toHaveProperty("embedding");
    expect(result).toHaveProperty("dimension");
    expect(result).toHaveProperty("source");
    expect(Array.isArray(result.embedding)).toBe(true);
    expect(result.embedding.length).toBe(result.dimension);
    expect(result.dimension).toBeGreaterThan(0);
    expect(["ollama", "fallback"]).toContain(result.source);
  });

  test("embedDual returns both dimensions", async () => {
    const result = await embedDual("dual test");
    expect(result instanceof Map).toBe(true);
    expect(result.size).toBeGreaterThan(0);
    for (const [dim, vec] of result) {
      expect(dim).toBeGreaterThan(0);
      expect(Array.isArray(vec)).toBe(true);
    }
  });

  test("getActiveDimension returns valid dimension", () => {
    const dim = getActiveDimension();
    expect(dim === null || dim > 0).toBe(true);
  });

  test("checkAnyEmbedder returns structured result", async () => {
    const result = await checkAnyEmbedder();
    expect(typeof result.ollama).toBe("boolean");
    expect(typeof result.fallback).toBe("boolean");
    expect(typeof result.any).toBe("boolean");
    expect(result.any).toBe(result.ollama || result.fallback);
  });
});
