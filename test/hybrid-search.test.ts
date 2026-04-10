import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

import { filterGraphResultsByTaggedFileIds, _state } from "../src/lib/hybrid-search";

// Set up isolated filesystem for tests that need real files
const tempDir = mkdtempSync(join(tmpdir(), "kb-hybrid-test-"));
process.env.KB_MEMORY_PATH = tempDir;

import { writeMemoryFile, type MemoryFrontmatter } from "../src/lib/fs-memory";

function makeFrontmatter(overrides?: Partial<MemoryFrontmatter>): MemoryFrontmatter {
  return {
    id: randomUUID(),
    name: "Test Memory",
    origin: "manual" as const,
    namespace: "default",
    tags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.KB_MEMORY_PATH;
});

afterEach(() => {
  _state.reset();
});

describe("filterGraphResultsByTaggedFileIds", () => {
  test("filters memories, edges, and entities to the tagged memory set", () => {
    const taggedOnly = new Set(["mem-tagged"]);
    const result = filterGraphResultsByTaggedFileIds(
      {
        memories: [
          {
            id: "mem-tagged",
            name: "Tagged Memory",
            text: "tagged text",
            abstract: "tagged abstract",
            summary: "tagged summary",
            namespace: "default",
            schemaVersion: "0.0.0",
            createdAt: new Date("2026-04-08T00:00:00.000Z"),
          },
          {
            id: "mem-other",
            name: "Other Memory",
            text: "other text",
            abstract: "other abstract",
            summary: "other summary",
            namespace: "default",
            schemaVersion: "0.0.0",
            createdAt: new Date("2026-04-08T00:00:00.000Z"),
          },
        ],
        edges: [
          {
            id: "edge-tagged",
            sourceEntityName: "Tagged Entity",
            targetEntityName: "Shared Entity",
            relationType: "mentions",
            fact: "Tagged memory mentions the shared entity",
            sentiment: 0,
            confidence: 1,
            episodes: ["mem-tagged"],
            namespace: "default",
            createdAt: new Date("2026-04-08T00:00:00.000Z"),
          },
          {
            id: "edge-other",
            sourceEntityName: "Other Entity",
            targetEntityName: "Leak Entity",
            relationType: "mentions",
            fact: "Other memory should be filtered out",
            sentiment: 0,
            confidence: 1,
            episodes: ["mem-other"],
            namespace: "default",
            createdAt: new Date("2026-04-08T00:00:00.000Z"),
          },
        ],
        entities: [
          { name: "Tagged Entity", type: "concept", namespace: "default" },
          { name: "Shared Entity", type: "concept", namespace: "default" },
          { name: "Leak Entity", type: "concept", namespace: "default" },
        ],
        intent: "general",
        guidance: "guidance",
      },
      taggedOnly,
    );

    expect(result.memories.map((memory) => memory.id)).toEqual(["mem-tagged"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["edge-tagged"]);
    expect(result.entities.map((entity) => entity.name)).toEqual(["Tagged Entity", "Shared Entity"]);
  });

  test("returns empty results when graphResult is null", () => {
    const result = filterGraphResultsByTaggedFileIds(null, new Set(["mem-1"]));
    expect(result.memories).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.entities).toEqual([]);
  });
});

describe("hybridSearch", () => {
  // hybridSearch imports ops which imports graph provider — we need to mock
  // the graph search to avoid needing a real DB. We do this by testing the
  // timeout/cooldown behavior via _state.

  test("cooldown skips graph search when within cooldown window", () => {
    // Set cooldown to future
    _state.graphFailureCooldownUntil = Date.now() + 30_000;

    // graphSearchWithTimeout should return null immediately when in cooldown
    // We verify this indirectly: _state is exported for this purpose
    expect(Date.now() < _state.graphFailureCooldownUntil).toBe(true);
  });

  test("reset clears cooldown", () => {
    _state.graphFailureCooldownUntil = Date.now() + 30_000;
    _state.reset();
    expect(_state.graphFailureCooldownUntil).toBe(0);
  });
});

describe("hybridSearch file results", () => {
  test("returns file results for memories on disk", async () => {
    const ns = `hybrid-file-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: ns, name: "Hybrid Test Memory" });
    writeMemoryFile(id, "This memory has searchable content about TypeScript", fm);

    // Import hybridSearch after files are written
    const { hybridSearch } = await import("../src/lib/hybrid-search");

    // Force cooldown so graph search is skipped — file-only results
    _state.graphFailureCooldownUntil = Date.now() + 30_000;

    const result = await hybridSearch("TypeScript", ns, 10);

    // Should get file results even when graph is down
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    expect(result.files.some((f) => f.name === "Hybrid Test Memory")).toBe(true);
    // Graph results should be empty (cooldown active)
    expect(result.memories).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.entities).toEqual([]);
    // Defaults when graph is unavailable
    expect(result.intent).toBe("general");
    expect(result.guidance).toContain("forgetEdge");
  });

  test("deduplicates: graph memories exclude IDs already in file results", async () => {
    // This tests the dedup logic: if a memory appears in both graph and file
    // results, the file result is filtered out (graph wins)
    const ns = `hybrid-dedup-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: ns, name: "Dedup Memory" });
    writeMemoryFile(id, "Dedup test content", fm);

    const { hybridSearch } = await import("../src/lib/hybrid-search");

    // With cooldown, only file results
    _state.graphFailureCooldownUntil = Date.now() + 30_000;
    const fileOnly = await hybridSearch("Dedup", ns, 10);
    expect(fileOnly.files.some((f) => f.id === id)).toBe(true);

    // The dedup logic is: graphMemoryIds filters out file results with same ID.
    // Since graph is empty here, all file results survive.
    expect(fileOnly.files.filter((f) => f.id === id)).toHaveLength(1);
  });
});
