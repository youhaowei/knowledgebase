import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
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
    expect(result.guidance).toContain("forgetEdge");
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
});
