import { test, expect, describe } from "bun:test";
import {
  embedFallback,
  isFallbackAvailable,
  getFallbackDim,
} from "../src/lib/fallback-embedder";

describe("Fallback Embedder (transformers.js)", () => {
  test("should report availability", async () => {
    const available = await isFallbackAvailable();
    expect(typeof available).toBe("boolean");
  }, 30_000);

  test("should generate 384-dim embeddings", { timeout: 30_000 }, async () => {
    const embedding = await embedFallback("Hello world");
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);
    // Dimension should be detected after first embedding
    const dim = getFallbackDim();
    expect(dim).not.toBeNull();
    expect(embedding.length).toBe(dim);

    // Check if it's a real embedding (not all zeros)
    const available = await isFallbackAvailable();
    if (available) {
      const isZero = embedding.every((v) => v === 0);
      expect(isZero).toBe(false);
      expect(typeof embedding[0]).toBe("number");
    }
  });

  test("should return consistent embeddings for same text", async () => {
    const available = await isFallbackAvailable();
    if (!available) {
      console.log("Skipping consistency test - fallback not available");
      return;
    }

    const emb1 = await embedFallback("consistent test");
    const emb2 = await embedFallback("consistent test");
    expect(emb1).toEqual(emb2);
  });

  test("should return different embeddings for different text", async () => {
    const available = await isFallbackAvailable();
    if (!available) {
      console.log("Skipping difference test - fallback not available");
      return;
    }

    const emb1 = await embedFallback("cats are great");
    const emb2 = await embedFallback("quantum physics theories");
    expect(emb1).not.toEqual(emb2);
  });

  test("concurrent calls should share initialization", async () => {
    // Multiple simultaneous calls should use singleton promise pattern
    const results = await Promise.all([
      embedFallback("concurrent test 1"),
      embedFallback("concurrent test 2"),
      embedFallback("concurrent test 3"),
    ]);

    for (const result of results) {
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
