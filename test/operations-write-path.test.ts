import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
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

describe("operations write-path regressions", () => {
  test("queueMemoryForIndexing releases the in-flight key if the initial file read fails", async () => {
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

  test("persistProcessedMemory preserves a user-edited name while still writing index metadata", async () => {
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

  test("getProvider retries after an initialization failure instead of caching the rejection forever", async () => {
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

    await expect(operations.getProvider()).rejects.toThrow("Transient provider init failure");
    await expect(operations.getProvider()).resolves.toBe(provider);
    expect(attempts).toBe(2);
  });

  test("processUnindexedMemories stops once it reaches the sweep batch limit", async () => {
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

  test("forget deletes the filesystem source before touching the graph", async () => {
    createTempEnvironment();

    const id = randomUUID();
    const namespace = "default";
    writeMemoryFile(id, "Delete me", makeFrontmatter({
      id,
      name: "Delete Me",
      namespace,
    }));

    let fileStillPresentWhenGraphRan = true;
    provider = makeProvider({
      forget: async () => {
        fileStillPresentWhenGraphRan = listMemoryFiles(namespace)
          .some((entry) => entry.id === id);
        return { deletedMemory: true, deletedEntity: false };
      },
    });

    const ops = await loadOperations();
    const result = await ops.forget("Delete Me", namespace);

    expect(result.deleted).toBe(true);
    expect(fileStillPresentWhenGraphRan).toBe(false);
  });
});
