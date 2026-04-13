import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

import {
  __testing__,
  configureHybridSearchDependenciesForTests,
  filterGraphResultsByTaggedFileIds,
  hybridSearch,
  resetHybridSearchForTests,
} from "../src/lib/hybrid-search";

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
  resetHybridSearchForTests();
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
          { name: "Tagged Entity", type: "concept", namespace: "default", scope: "project" },
          { name: "Shared Entity", type: "concept", namespace: "default", scope: "project" },
          { name: "Leak Entity", type: "concept", namespace: "default", scope: "project" },
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

describe("runGraphSearch", () => {
  test("returns null and logs when graph search throws", async () => {
    configureHybridSearchDependenciesForTests({
      graphSearch: async () => {
        throw new Error("graph unavailable");
      },
    });

    const result = await __testing__.runGraphSearch("fail", "default", 5);

    expect(result).toBeNull();
  });

  test("returns graph payload when search succeeds", async () => {
    configureHybridSearchDependenciesForTests({
      graphSearch: async () => ({
        memories: [],
        edges: [],
        entities: [],
        intent: "general",
        guidance: "ok",
      }),
    });

    const result = await __testing__.runGraphSearch("ok", "default", 5);

    expect(result).not.toBeNull();
    expect(result!.guidance).toBe("ok");
  });
});

describe("hybridSearch file results", () => {
  test("returns file results for memories on disk", async () => {
    const ns = `hybrid-file-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: ns, name: "Hybrid Test Memory" });
    writeMemoryFile(id, "This memory has searchable content about TypeScript", fm);

    // Simulate graph being unavailable — file-only results
    configureHybridSearchDependenciesForTests({
      graphSearch: async () => {
        throw new Error("graph unavailable");
      },
    });

    const result = await hybridSearch("TypeScript", ns, 10);

    expect(result.files.length).toBeGreaterThanOrEqual(1);
    expect(result.files.some((f) => f.name === "Hybrid Test Memory")).toBe(true);
    // Graph results should be empty (graph threw)
    expect(result.memories).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.entities).toEqual([]);
    expect(result.intent).toBe("general");
    // Spec Decision #8: degraded responses carry structured signals; guidance
    // is composed from them rather than the default forgetEdge prompt.
    expect(result.signals.degraded).toBe(true);
    expect(result.guidance).toContain("Graph index unavailable");
  });

  test("deduplicates: graph memories exclude IDs already in file results", async () => {
    const ns = `hybrid-dedup-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: ns, name: "Dedup Memory" });
    writeMemoryFile(id, "Dedup test content", fm);

    configureHybridSearchDependenciesForTests({
      graphSearch: async () => ({
        memories: [
          {
            id,
            name: "Dedup Memory",
            text: "Graph copy",
            abstract: "",
            summary: "From graph",
            namespace: ns,
            schemaVersion: "0.0.0",
            createdAt: new Date("2026-04-08T00:00:00.000Z"),
          },
        ],
        edges: [],
        entities: [],
        intent: "general",
        guidance: "graph guidance",
      }),
    });

    const result = await hybridSearch("Dedup", ns, 10);

    expect(result.memories.map((memory) => memory.id)).toEqual([id]);
    expect(result.files.some((file) => file.id === id)).toBe(false);
  });

  test("Decision #8: signals.unindexedCount reflects file results lacking indexedAt", async () => {
    const ns = `hybrid-signals-unindexed-${randomUUID().slice(0, 8)}`;
    const unindexedId = randomUUID();
    writeMemoryFile(
      unindexedId,
      "New content awaiting the indexer",
      makeFrontmatter({ id: unindexedId, namespace: ns, name: "Pending Memory" }),
    );

    configureHybridSearchDependenciesForTests({
      graphSearch: async () => ({
        memories: [],
        edges: [],
        entities: [],
        intent: "general",
        guidance: "",
      }),
    });

    const result = await hybridSearch("Pending", ns, 10);

    expect(result.files.some((f) => f.id === unindexedId)).toBe(true);
    // Public contract: consumers read signals.unindexedCount to render "not indexed yet" badges.
    expect(result.signals.unindexedCount).toBe(1);
    expect(result.signals.degraded).toBe(false);
    expect(result.guidance).toContain("not yet indexed");
  });

  test("Decision #8: signals.staleCount reflects file results with mtime > indexedAt", async () => {
    const ns = `hybrid-signals-stale-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    const indexedAt = new Date(Date.now() - 60_000).toISOString(); // 60s ago
    const path = writeMemoryFile(
      id,
      "Stale body — edited after the indexer last touched the file",
      makeFrontmatter({ id, namespace: ns, name: "Stale Memory", indexedAt }),
    );
    // Bump mtime forward so file-search judges the file stale
    // (Decision #8: stale = mtime > indexedAt).
    const future = new Date(Date.now() + 30_000);
    utimesSync(path, future, future);

    configureHybridSearchDependenciesForTests({
      graphSearch: async () => ({
        memories: [], edges: [], entities: [],
        intent: "general", guidance: "",
      }),
    });

    const result = await hybridSearch("Stale", ns, 10);
    expect(result.signals.staleCount).toBe(1);
  });

  test("Decision #8: signals.staleCount counts stale files even when graph dedups them out of `files`", async () => {
    // Regression: dedup must not erase the stale signal. A memory present in
    // BOTH graph and file results gets dropped from `files[]` (graph wins),
    // but consumers expect `signals.staleCount` to reflect the response
    // population, not just the file-only slice.
    const ns = `hybrid-signals-stale-dedup-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    const indexedAt = new Date(Date.now() - 60_000).toISOString();
    const path = writeMemoryFile(
      id,
      "Body that's been edited since indexing",
      makeFrontmatter({ id, namespace: ns, name: "Stale + Graph", indexedAt }),
    );
    const future = new Date(Date.now() + 30_000);
    utimesSync(path, future, future);

    configureHybridSearchDependenciesForTests({
      graphSearch: async () => ({
        memories: [{
          id, name: "Stale + Graph", text: "graph copy",
          abstract: "", summary: "", namespace: ns, schemaVersion: "0.0.0",
          createdAt: new Date(),
        }],
        edges: [], entities: [],
        intent: "general", guidance: "",
      }),
    });

    const result = await hybridSearch("Body", ns, 10);
    // Graph wins → file row dropped from `files`...
    expect(result.files.some((f) => f.id === id)).toBe(false);
    // ...but the staleness signal must persist across the dedup boundary.
    expect(result.signals.staleCount).toBe(1);
  });

  test("Decision #8: file results carry `path` and `indexedAt` as public contract", async () => {
    const ns = `hybrid-signals-path-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: ns, name: "With Path" });
    const path = writeMemoryFile(id, "body", fm);

    configureHybridSearchDependenciesForTests({
      graphSearch: async () => ({
        memories: [], edges: [], entities: [],
        intent: "general", guidance: "",
      }),
    });

    const result = await hybridSearch("With", ns, 10);
    const match = result.files.find((f) => f.id === id);

    // H10 fix: MCP/CLI consumers depend on these fields to read the underlying file.
    expect(match).toBeDefined();
    expect(match!.path).toBe(path);
    expect(match!.indexedAt).toBeNull(); // unindexed: explicit null, not undefined
  });

  test("US-8: tag filter allowlist covers ALL tagged files, not just the top-N file-search slice", async () => {
    // Seed N+1 memories with the same tag so fileSearch({ limit: N }) pages
    // them — the tagged-memory allowlist for graph results must still include
    // the one that falls off the paginated file slice.
    const ns = `hybrid-tagfilter-${randomUUID().slice(0, 8)}`;
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const id = randomUUID();
      ids.push(id);
      writeMemoryFile(
        id,
        `body ${i}`,
        makeFrontmatter({
          id,
          namespace: ns,
          name: `tagged-${i}`,
          tags: ["shared"],
        }),
      );
    }

    // Graph ranks the 4th (last) tagged file highest — this is exactly the
    // memory that fileSearch(limit: 2) would omit from its paginated slice.
    const highestGraphRankId = ids[3];
    configureHybridSearchDependenciesForTests({
      graphSearch: async () => ({
        memories: [{
          id: highestGraphRankId, name: "tagged-3", text: "body 3",
          abstract: "", summary: "", namespace: ns, schemaVersion: "0.0.0",
          createdAt: new Date(),
        }],
        edges: [], entities: [],
        intent: "general", guidance: "",
      }),
    });

    const result = await hybridSearch("tagged", ns, 2, ["shared"]);

    // The graph's best hit must survive even though fileSearch's paginated
    // results don't include it. Before the H6 fix, the tag allowlist was
    // built from fileSearch's top-N → the graph result was filtered out.
    expect(result.memories.some((m) => m.id === highestGraphRankId)).toBe(true);
  });

  test("Decision #8: signals.contradictionsDetected fires when edges carry opposing sentiment on the same pair", async () => {
    const ns = `hybrid-contradict-${randomUUID().slice(0, 8)}`;

    configureHybridSearchDependenciesForTests({
      graphSearch: async () => ({
        memories: [],
        edges: [
          {
            id: "e1", sourceEntityName: "A", targetEntityName: "B",
            relationType: "uses", fact: "A uses B", sentiment: 0.8, confidence: 0.9,
            episodes: [], createdAt: new Date(), namespace: ns,
          },
          {
            id: "e2", sourceEntityName: "A", targetEntityName: "B",
            relationType: "rejects", fact: "A rejects B", sentiment: -0.8, confidence: 0.9,
            episodes: [], createdAt: new Date(), namespace: ns,
          },
        ],
        entities: [],
        intent: "general",
        guidance: "",
      }),
    });

    const result = await hybridSearch("A B", ns, 10);

    expect(result.signals.contradictionsDetected).toBe(true);
    expect(result.guidance).toContain("Contradictions detected");
  });
});
