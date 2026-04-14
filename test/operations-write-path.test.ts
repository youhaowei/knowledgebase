import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

import type { Memory } from "../src/types";
import type { Queue as RealQueue } from "../src/lib/queue";
import {
  listMemoryFiles,
  readMemoryFile,
  writeMemoryFile,
  type MemoryFrontmatter,
} from "../src/lib/fs-memory";

const tempDirs: string[] = [];
const originalEnv = {
  KB_MEMORY_PATH: process.env.KB_MEMORY_PATH,
  __ANALYTICS_DB_PATH: process.env.__ANALYTICS_DB_PATH,
  LADYBUG_DATA_PATH: process.env.LADYBUG_DATA_PATH,
};

const queueState: {
  adds: number;
  onAdd: (memory: Memory) => Promise<void>;
} = {
  adds: 0,
  onAdd: async () => {},
};

let provider: ReturnType<typeof makeProvider> = makeProvider();

class MockQueue {
  async add(memory: Memory, onStored?: (memory: Memory) => Promise<void>): Promise<void> {
    queueState.adds += 1;
    await queueState.onAdd(memory);
    await onStored?.(memory);
  }

  pending(): number {
    return 0;
  }
}

function makeFrontmatter(overrides: Partial<MemoryFrontmatter> = {}): MemoryFrontmatter {
  return {
    id: randomUUID(),
    name: "Test Memory",
    origin: "manual",
    namespace: "default",
    tags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProvider(overrides: Record<string, unknown> = {}) {
  return {
    init: async () => {},
    close: async () => {},
    store: async () => {},
    search: async () => ({ memories: [], edges: [], entities: [] }),
    vectorSearch: async () => [],
    vectorSearchEdges: async () => [],
    fullTextSearchEdges: async () => [],
    get: async () => ({ edges: [] }),
    forget: async () => ({ deletedMemory: false, deletedEntity: false }),
    forgetMemoryById: async () => false,
    forgetEdge: async () => ({}),
    storeMemoryOnly: async () => {},
    updateMemoryStatus: async () => {},
    getPendingMemories: async () => [],
    storeEntity: async () => {},
    findEntities: async () => [],
    findEdges: async () => [],
    findMemories: async () => [],
    stats: async () => ({ memories: 0, entities: 0, edges: 0 }),
    listNamespaces: async () => [],
    deleteByNamespace: async () => {},
    getGraphData: async () => ({ nodes: [], links: [] }),
    findMemoriesNeedingEmbedding: async () => [],
    findEdgesNeedingEmbedding: async () => [],
    updateMemoryEmbeddings: async () => {},
    updateFactEmbeddings: async () => {},
    updateMemorySummary: async () => {},
    countMemories: async () => 0,
    getEntityCatalog: async () => [],
    mergeEntities: async () => ({ removed: 0 }),
    ...overrides,
  };
}

function createQueueFactory(): () => RealQueue {
  return () => new MockQueue() as unknown as RealQueue;
}

function createTempEnvironment(): void {
  const tempDir = mkdtempSync(join(tmpdir(), "kb-write-path-"));
  tempDirs.push(tempDir);
  process.env.KB_MEMORY_PATH = tempDir;
  process.env.__ANALYTICS_DB_PATH = join(tempDir, "analytics.db");
  process.env.LADYBUG_DATA_PATH = join(tempDir, "ladybug");
}

function createDeferredQueueMutation(mutate: (memory: Memory) => void): { onAdd: (memory: Memory) => Promise<void>; release: () => void } {
  let release!: () => void;

  return {
    onAdd: (memory) =>
      new Promise<void>((resolve) => {
        release = () => {
          mutate(memory);
          resolve();
        };
      }),
    release: () => release(),
  };
}

async function loadOperations() {
  const operations = await import("../src/lib/operations.js");
  operations.resetOperationStateForTests();
  operations.configureOperationDependenciesForTests({
    createGraphProvider: async () => provider,
    createQueue: createQueueFactory(),
  });
  return operations;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await Bun.sleep(10);
  }
}

afterEach(async () => {
  const operations = await import("../src/lib/operations.js");
  operations.resetOperationStateForTests();
  queueState.adds = 0;
  queueState.onAdd = async () => {};
  provider = makeProvider();

  const tempDir = tempDirs.pop();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (originalEnv.KB_MEMORY_PATH === undefined) delete process.env.KB_MEMORY_PATH;
  else process.env.KB_MEMORY_PATH = originalEnv.KB_MEMORY_PATH;

  if (originalEnv.__ANALYTICS_DB_PATH === undefined) delete process.env.__ANALYTICS_DB_PATH;
  else process.env.__ANALYTICS_DB_PATH = originalEnv.__ANALYTICS_DB_PATH;

  if (originalEnv.LADYBUG_DATA_PATH === undefined) delete process.env.LADYBUG_DATA_PATH;
  else process.env.LADYBUG_DATA_PATH = originalEnv.LADYBUG_DATA_PATH;
});

// These tests defend specific race-condition regressions discovered during
// Phase 1 implementation. Each test name names the invariant it guards.
// They're intentionally narrower than end-to-end contract tests — the value
// is that they pin down subtle state transitions that naïve refactors break.
describe("operations write-path invariants", () => {
  test("US-1: queueMemoryForIndexing releases in-flight key on file-read failure (no deadlock)", async () => {
    createTempEnvironment();

    const ops = await loadOperations();
    const id = randomUUID();

    await expect(ops.queueMemoryForIndexing(id, "default")).rejects.toThrow();

    const path = writeMemoryFile(id, "Recovered body", makeFrontmatter({
      id,
      name: "Recovered Memory",
      namespace: "default",
    }));
    expect(path).toContain(id);

    expect(await ops.queueMemoryForIndexing(id, "default")).toBe(true);
  });

  test("Decision #12: non-null user-set abstract survives extractor returning null (??-discipline)", async () => {
    createTempEnvironment();

    // Extractor returns null/undefined for derived fields — simulates a
    // model that couldn't generate a summary, or a re-extract pass on a
    // memory that already has user-curated metadata.
    const deferredQueue = createDeferredQueueMutation((memory) => {
      memory.abstract = null as unknown as string;
      memory.summary = null as unknown as string;
      memory.category = "general";
    });
    queueState.onAdd = deferredQueue.onAdd;

    const ops = await loadOperations();
    const id = randomUUID();
    const frontmatter = makeFrontmatter({
      id,
      name: "Pre-Filled",
      namespace: "default",
      abstract: "User wrote this abstract by hand",
      summary: "User-written summary",
    });
    const path = writeMemoryFile(id, "Body text", frontmatter);

    expect(await ops.queueMemoryForIndexing(id, "default")).toBe(true);
    deferredQueue.release();
    await waitFor(() => Boolean(readMemoryFile(path).frontmatter.indexedAt));

    const updated = readMemoryFile(path).frontmatter;
    // ?? semantics: null from extractor falls back to the on-disk value
    // (Decision #12: derived fields filled only when null/missing).
    expect(updated.abstract).toBe("User wrote this abstract by hand");
    expect(updated.summary).toBe("User-written summary");
  });

  test("Decision #12: tags edited by user during indexing are preserved on commit (additive merge)", async () => {
    createTempEnvironment();

    const deferredQueue = createDeferredQueueMutation((memory) => {
      memory.abstract = "Done";
      memory.summary = "Done";
      memory.category = "general";
    });
    queueState.onAdd = deferredQueue.onAdd;

    const ops = await loadOperations();
    const id = randomUUID();
    const frontmatter = makeFrontmatter({
      id,
      name: "Tagged",
      namespace: "default",
      tags: ["original"],
    });
    const path = writeMemoryFile(id, "Body text", frontmatter);

    expect(await ops.queueMemoryForIndexing(id, "default")).toBe(true);

    // User edits the file mid-indexing to add a new tag.
    writeMemoryFile(id, "Body text", {
      ...frontmatter,
      tags: ["original", "user-added"],
    });

    deferredQueue.release();
    await waitFor(() => Boolean(readMemoryFile(path).frontmatter.indexedAt));

    const updated = readMemoryFile(path).frontmatter;
    // The on-disk tag set wins because persistProcessedMemoryUnlocked
    // re-reads under the lock and spreads currentFrontmatter (which
    // includes user-added tags) into the merged frontmatter.
    expect(updated.tags).toEqual(["original", "user-added"]);
  });

  test("Goal #3: persistProcessedMemory preserves user-edited name during async indexing (file is canonical)", async () => {
    createTempEnvironment();

    const deferredQueue = createDeferredQueueMutation((memory) => {
      memory.name = "Stale Queue Snapshot";
      memory.abstract = "Persisted abstract";
      memory.summary = "Persisted summary";
      memory.category = "general";
      memory.schemaVersion = "1.2.3";
      memory.versionedAt = "2026-04-10T00:00:00.000Z";
    });
    queueState.onAdd = deferredQueue.onAdd;

    const ops = await loadOperations();
    const id = randomUUID();
    const frontmatter = makeFrontmatter({
      id,
      name: "Original Name",
      namespace: "default",
    });
    const path = writeMemoryFile(id, "Body text", frontmatter);

    expect(await ops.queueMemoryForIndexing(id, "default")).toBe(true);

    writeMemoryFile(id, "Body text", {
      ...frontmatter,
      name: "User Edited Name",
    });

    deferredQueue.release();
    await waitFor(() => Boolean(readMemoryFile(path).frontmatter.indexedAt));

    const updated = readMemoryFile(path).frontmatter;
    expect(updated.name).toBe("User Edited Name");
    expect(updated.summary).toBe("Persisted summary");
    expect(updated.abstract).toBe("Persisted abstract");
    expect(updated.indexedAt).toBeDefined();
  });

  test("getProvider enters cooldown after init failure, then recovers when cooldown clears — degraded-mode contract", async () => {
    // Spec/codex: after a provider init failure, the cooldown short-circuits
    // subsequent calls so degraded-mode requests don't churn through repeated
    // init attempts (and re-emit the same error log on every search). Once
    // the cooldown clears (production: wall-clock timeout; tests: explicit
    // helper), the next call retries init and recovers.
    createTempEnvironment();

    let attempts = 0;
    const operations = await import("../src/lib/operations.js");
    operations.resetOperationStateForTests();
    operations.configureOperationDependenciesForTests({
      createGraphProvider: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Transient provider init failure");
        }
        return provider;
      },
      createQueue: createQueueFactory(),
    });

    // First call: real init fails.
    await expect(operations.getProvider()).rejects.toThrow("Transient provider init failure");

    // Second call (within cooldown window): fails fast without re-entering init.
    await expect(operations.getProvider()).rejects.toThrow("in failure cooldown");
    expect(attempts).toBe(1);

    // Clear cooldown and verify recovery on next call.
    operations.clearProviderFailureCooldownForTests();
    await expect(operations.getProvider()).resolves.toBe(provider);
    expect(attempts).toBe(2);
  });

  test("Decision #6: processUnindexedMemories respects the sweep batch limit (bounded work per cycle)", async () => {
    createTempEnvironment();

    const ops = await loadOperations();
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      writeMemoryFile(id, `Body ${i}`, makeFrontmatter({
        id,
        name: `Memory ${i}`,
        namespace: "default",
      }));
    }

    const queued = await ops.processUnindexedMemories(undefined, 2);

    expect(queued).toBe(2);
    expect(queueState.adds).toBe(2);
  });

  test("Decision #11: forget tombstones the file and never touches the graph", async () => {
    createTempEnvironment();

    const id = randomUUID();
    const namespace = "default";
    writeMemoryFile(id, "Delete me", makeFrontmatter({
      id,
      name: "Delete Me",
      namespace,
    }));

    let providerForgetCalled = false;
    provider = makeProvider({
      forget: async () => {
        providerForgetCalled = true;
        return { deletedMemory: true, deletedEntity: false };
      },
    });

    const ops = await loadOperations();
    const result = await ops.forget("Delete Me", namespace);

    expect(result.deleted).toBe(true);
    // Spec Decision #11: CLI path never opens LadybugDB. The provider's
    // forget must not be called from operations.forget() — the server
    // reconciler consumes _tombstones.jsonl on its sweep instead.
    expect(providerForgetCalled).toBe(false);
    // File is tombstoned, not removed. Body preserved for recovery.
    expect(listMemoryFiles(namespace).some((e) => e.id === id)).toBe(false);
  });

  test("Decision #11: forget preserves the file body by renaming to {uuid}.md.deleted", async () => {
    createTempEnvironment();

    const id = randomUUID();
    const namespace = "default";
    const body = "content that must survive for recovery";
    const originalPath = writeMemoryFile(id, body, makeFrontmatter({
      id,
      name: "Recoverable Memory",
      namespace,
    }));

    const ops = await loadOperations();
    const result = await ops.forget("Recoverable Memory", namespace);
    expect(result.deleted).toBe(true);

    // Original file is gone; tombstoned sibling preserves the body.
    expect(existsSync(originalPath)).toBe(false);
    const tombstonePath = `${originalPath}.deleted`;
    expect(existsSync(tombstonePath)).toBe(true);
    expect(readFileSync(tombstonePath, "utf-8")).toContain(body);
  });

  test("Decision #11: forget appends a record to _tombstones.jsonl with id/name/reason/timestamp", async () => {
    createTempEnvironment();

    const id = randomUUID();
    const namespace = "default";
    writeMemoryFile(id, "body", makeFrontmatter({
      id,
      name: "Logged Memory",
      namespace,
    }));

    const ops = await loadOperations();
    await ops.forget("Logged Memory", namespace, "manual purge");

    const jsonlPath = join(process.env.KB_MEMORY_PATH!, namespace, "_tombstones.jsonl");
    expect(existsSync(jsonlPath)).toBe(true);
    const lines = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);

    const record = JSON.parse(lines[0]);
    expect(record.id).toBe(id);
    expect(record.name).toBe("Logged Memory");
    expect(record.reason).toBe("manual purge");
    expect(typeof record.timestamp).toBe("string");
    // Reconciler (Phase 2) parses this record to apply graph cleanup.
  });

  test("Decision #11 + #9: forgetEdge appends to _forget_edges.jsonl and never touches memory files", async () => {
    createTempEnvironment();

    // Seed an unrelated memory so we can prove its file is untouched.
    const unrelatedId = randomUUID();
    const namespace = "default";
    const unrelatedPath = writeMemoryFile(unrelatedId, "I am unrelated to any edge", makeFrontmatter({
      id: unrelatedId,
      name: "Unrelated",
      namespace,
    }));

    let providerForgetEdgeCalled = false;
    provider = makeProvider({
      forgetEdge: async () => {
        providerForgetEdgeCalled = true;
        return { invalidated: true };
      },
    });

    const ops = await loadOperations();
    await ops.forgetEdge("edge-abc-123", "superseded by newer fact", namespace);

    // Decision #11: CLI path does not open LadybugDB.
    expect(providerForgetEdgeCalled).toBe(false);

    // Decision #9: forgetEdge is graph-only; memory files are untouched.
    expect(existsSync(unrelatedPath)).toBe(true);
    expect(readFileSync(unrelatedPath, "utf-8")).toContain("I am unrelated to any edge");

    // Intent is recorded for the reconciler.
    const jsonlPath = join(process.env.KB_MEMORY_PATH!, namespace, "_forget_edges.jsonl");
    expect(existsSync(jsonlPath)).toBe(true);
    const record = JSON.parse(readFileSync(jsonlPath, "utf-8").trim());
    expect(record.edgeId).toBe("edge-abc-123");
    expect(record.reason).toBe("superseded by newer fact");
    expect(typeof record.timestamp).toBe("string");
  });

  test("Decision #11: drainTombstones preserves failed memory tombstones and replays exact ids", async () => {
    createTempEnvironment();

    const namespace = "default";
    const appliedId = randomUUID();
    const failedId = randomUUID();
    writeMemoryFile(appliedId, "body", makeFrontmatter({
      id: appliedId,
      name: "Applied",
      namespace,
    }));

    const replayedIds: string[] = [];
    provider = makeProvider({
      forget: async () => {
        throw new Error("legacy name replay should not run for id tombstones");
      },
      forgetMemoryById: async (id: string) => {
        replayedIds.push(id);
        if (id === failedId) {
          throw new Error("transient provider failure");
        }
        return true;
      },
    });

    const jsonlPath = join(process.env.KB_MEMORY_PATH!, namespace, "_tombstones.jsonl");
    writeFileSync(jsonlPath, [
      JSON.stringify({ id: appliedId, name: "Applied", reason: "cleanup" }),
      JSON.stringify({ id: failedId, name: "Failed", reason: "cleanup" }),
    ].join("\n") + "\n");

    const ops = await loadOperations();
    const result = await ops.drainTombstones();

    expect(result).toEqual({ memoriesForgotten: 1, edgesForgotten: 0 });
    expect(replayedIds).toEqual([appliedId, failedId]);
    const remaining = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(remaining).toHaveLength(1);
    expect(JSON.parse(remaining[0])).toMatchObject({ id: failedId, name: "Failed" });
  });

  test("Decision #11: drainTombstones preserves failed edge replays for the next sweep", async () => {
    createTempEnvironment();

    const namespace = "default";
    const sentinelId = randomUUID();
    writeMemoryFile(sentinelId, "body", makeFrontmatter({
      id: sentinelId,
      name: "Sentinel",
      namespace,
    }));

    const replayedEdges: string[] = [];
    provider = makeProvider({
      forgetEdge: async (edgeId: string) => {
        replayedEdges.push(edgeId);
        if (edgeId === "edge-fail") {
          throw new Error("transient edge failure");
        }
        return { invalidated: true };
      },
    });

    const jsonlPath = join(process.env.KB_MEMORY_PATH!, namespace, "_forget_edges.jsonl");
    writeFileSync(jsonlPath, [
      JSON.stringify({ edgeId: "edge-ok", reason: "cleanup" }),
      JSON.stringify({ edgeId: "edge-fail", reason: "cleanup" }),
    ].join("\n") + "\n");

    const ops = await loadOperations();
    const result = await ops.drainTombstones();

    expect(result).toEqual({ memoriesForgotten: 0, edgesForgotten: 1 });
    expect(replayedEdges).toEqual(["edge-ok", "edge-fail"]);
    const remaining = readFileSync(jsonlPath, "utf-8").trim().split("\n");
    expect(remaining).toHaveLength(1);
    expect(JSON.parse(remaining[0])).toMatchObject({ edgeId: "edge-fail", reason: "cleanup" });
  });

  test("Decision #11: forgetEdgeViaGraph does not queue a replay record after successful invalidation", async () => {
    createTempEnvironment();

    const namespace = "default";
    provider = makeProvider({
      forgetEdge: async () => ({ invalidated: true }),
    });

    const ops = await loadOperations();
    const result = await ops.forgetEdgeViaGraph("edge-live", "superseded", namespace);

    expect(result).toEqual({
      edgeId: "edge-live",
      reason: "superseded",
      namespace,
      appliedToGraph: true,
    });

    const jsonlPath = join(process.env.KB_MEMORY_PATH!, namespace, "_forget_edges.jsonl");
    expect(existsSync(jsonlPath)).toBe(false);
  });

  test("Decision #11: forgetEdgeViaGraph queues a replay record when graph invalidation fails", async () => {
    createTempEnvironment();

    const namespace = "default";
    provider = makeProvider({
      forgetEdge: async () => {
        throw new Error("graph unavailable");
      },
    });

    const ops = await loadOperations();
    const result = await ops.forgetEdgeViaGraph("edge-deferred", "superseded", namespace);

    expect(result).toEqual({
      edgeId: "edge-deferred",
      reason: "superseded",
      namespace,
      appliedToGraph: false,
    });

    const jsonlPath = join(process.env.KB_MEMORY_PATH!, namespace, "_forget_edges.jsonl");
    expect(existsSync(jsonlPath)).toBe(true);
    const record = JSON.parse(readFileSync(jsonlPath, "utf-8").trim());
    expect(record).toMatchObject({ edgeId: "edge-deferred", reason: "superseded" });
  });
});
