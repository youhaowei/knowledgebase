import {
  test,
  expect,
  describe,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";
import { randomUUID } from "crypto";
import type { GraphProvider } from "../src/lib/graph-provider";
import { Neo4jProvider } from "../src/lib/neo4j-provider";
import { LadybugProvider } from "../src/lib/ladybug-provider";
import type { Memory, Entity, ExtractedEdge, StoredEntity } from "../src/types";

function makeTestEmbedding(seed: number): number[] {
  const embedding = new Array(2560).fill(0);
  for (let i = 0; i < 2560; i++) {
    embedding[i] = Math.sin(seed * (i + 1)) * 0.5;
  }
  return embedding;
}

function createTestProvider(): GraphProvider {
  if (process.env.NEO4J_URI) {
    return new Neo4jProvider();
  }
  return new LadybugProvider("./.test-ladybug");
}

function isLadybugMode(): boolean {
  return !process.env.NEO4J_URI;
}

describe("GraphProvider", () => {
  let provider: GraphProvider;
  let testNamespace: string;

  beforeAll(async () => {
    provider = createTestProvider();
    await provider.init();
  });

  afterAll(async () => {
    await provider.close();
  });

  afterEach(async () => {
    if (testNamespace) {
      await provider.deleteByNamespace(testNamespace);
    }
  });

  describe("init/close", () => {
    test("init() creates schema without error", async () => {
      await expect(provider.init()).resolves.toBeUndefined();
    });

    test("close() closes connection without error", async () => {
      const tempProvider = createTestProvider();
      await tempProvider.init();
      await expect(tempProvider.close()).resolves.toBeUndefined();
    });
  });

  describe("store()", () => {
    test("stores memory with entities and edges", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Test Memory",
        text: "Alice prefers TypeScript over JavaScript",
        summary: "Alice prefers TypeScript",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Alice", type: "person" },
        { uuid: randomUUID(), name: "TypeScript", type: "technology" },
        { uuid: randomUUID(), name: "JavaScript", type: "technology" },
      ];

      const edges: ExtractedEdge[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          relationType: "prefers",
          fact: "Alice prefers TypeScript",
          sentiment: 0.8,
        },
        {
          sourceIndex: 0,
          targetIndex: 2,
          relationType: "avoids",
          fact: "Alice avoids JavaScript",
          sentiment: -0.3,
        },
      ];

      const memoryEmbedding = makeTestEmbedding(1);
      const edgeEmbeddings = [makeTestEmbedding(2), makeTestEmbedding(3)];

      await provider.store(
        memory,
        entities,
        edges,
        memoryEmbedding,
        edgeEmbeddings,
      );

      const result = await provider.get("Alice", testNamespace);
      expect(result.entity).toBeDefined();
      expect(result.entity?.name).toBe("Alice");
      expect(result.edges.length).toBeGreaterThanOrEqual(1);
    });

    test("stores global memory with namespace: null", async () => {
      testNamespace = `test-${randomUUID()}`;
      const globalMemory: Memory = {
        id: randomUUID(),
        name: "Global Note",
        text: "Remember to check the docs",
        summary: "Check docs reminder",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [];
      const edges: ExtractedEdge[] = [];

      await provider.store(
        globalMemory,
        entities,
        edges,
        makeTestEmbedding(10),
        [],
      );

      const memories = await provider.findMemories({
        namespace: testNamespace,
      });
      expect(memories.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("search()", () => {
    test("returns combined results (memories, edges, entities)", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Search Test",
        text: "Bob works on the Dashboard project",
        summary: "Bob works on Dashboard",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Bob", type: "person" },
        { uuid: randomUUID(), name: "Dashboard", type: "project" },
      ];

      const edges: ExtractedEdge[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          relationType: "worksOn",
          fact: "Bob works on the Dashboard project",
          sentiment: 0.5,
        },
      ];

      await provider.store(memory, entities, edges, makeTestEmbedding(20), [
        makeTestEmbedding(21),
      ]);

      const result = await provider.search(
        makeTestEmbedding(20),
        "Dashboard",
        10,
      );
      expect(result).toHaveProperty("memories");
      expect(result).toHaveProperty("edges");
      expect(result).toHaveProperty("entities");
    });

    test("fuzzy matches entity names (case-insensitive)", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Fuzzy Test",
        text: "Charlie Smith is a developer",
        summary: "Charlie is a developer",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Charlie Smith", type: "person" },
      ];

      await provider.store(memory, entities, [], makeTestEmbedding(30), []);

      const result = await provider.search(
        makeTestEmbedding(30),
        "charlie",
        10,
      );
      expect(result.entities.some((e) => e.name === "Charlie Smith")).toBe(
        true,
      );
    });
  });

  describe("vectorSearch()", () => {
    test("returns memories sorted by similarity", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory1: Memory = {
        id: randomUUID(),
        name: "Vector Test 1",
        text: "First test memory",
        summary: "First test",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const memory2: Memory = {
        id: randomUUID(),
        name: "Vector Test 2",
        text: "Second test memory",
        summary: "Second test",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      await provider.store(memory1, [], [], makeTestEmbedding(40), []);
      await provider.store(memory2, [], [], makeTestEmbedding(41), []);

      const results = await provider.vectorSearch(makeTestEmbedding(40), 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("respects limit parameter", async () => {
      testNamespace = `test-${randomUUID()}`;
      for (let i = 0; i < 5; i++) {
        const memory: Memory = {
          id: randomUUID(),
          name: `Limit Test ${i}`,
          text: `Memory number ${i}`,
          summary: `Memory ${i}`,
          namespace: testNamespace,
          status: "completed",
          createdAt: new Date(),
        };
        await provider.store(memory, [], [], makeTestEmbedding(50 + i), []);
      }

      const results = await provider.vectorSearch(makeTestEmbedding(50), 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    test("filters by namespace when provided", async () => {
      testNamespace = `test-${randomUUID()}`;
      const otherNamespace = `other-${randomUUID()}`;

      const memory1: Memory = {
        id: randomUUID(),
        name: "NS Test 1",
        text: "In test namespace",
        summary: "Test NS",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const memory2: Memory = {
        id: randomUUID(),
        name: "NS Test 2",
        text: "In other namespace",
        summary: "Other NS",
        namespace: otherNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      await provider.store(memory1, [], [], makeTestEmbedding(60), []);
      await provider.store(memory2, [], [], makeTestEmbedding(61), []);

      const results = await provider.vectorSearch(makeTestEmbedding(60), 10, {
        namespace: testNamespace,
      });

      expect(results.every((m) => m.namespace === testNamespace)).toBe(true);

      await provider.deleteByNamespace(otherNamespace);
    });
  });

  describe("fullTextSearchEdges()", () => {
    test("returns edges matching keyword query", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "FTS Test",
        text: "David manages the infrastructure team",
        summary: "David manages infrastructure",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "David", type: "person" },
        {
          uuid: randomUUID(),
          name: "Infrastructure Team",
          type: "organization",
        },
      ];

      const edges: ExtractedEdge[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          relationType: "manages",
          fact: "David manages the infrastructure team",
          sentiment: 0.6,
        },
      ];

      await provider.store(memory, entities, edges, makeTestEmbedding(70), [
        makeTestEmbedding(71),
      ]);

      const results = await provider.fullTextSearchEdges("infrastructure", 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.fact).toContain("infrastructure");
    });

    test("returns empty for no matches", async () => {
      testNamespace = `test-${randomUUID()}`;
      const results = await provider.fullTextSearchEdges(
        "xyznonexistent123",
        10,
      );
      expect(results).toEqual([]);
    });

    test("respects limit parameter", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "FTS Limit Test",
        text: "Multiple facts about coding",
        summary: "Coding facts",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Developer", type: "person" },
        { uuid: randomUUID(), name: "Python", type: "technology" },
        { uuid: randomUUID(), name: "Rust", type: "technology" },
        { uuid: randomUUID(), name: "Go", type: "technology" },
      ];

      const edges: ExtractedEdge[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          relationType: "uses",
          fact: "Developer uses Python for coding",
          sentiment: 0.5,
        },
        {
          sourceIndex: 0,
          targetIndex: 2,
          relationType: "uses",
          fact: "Developer uses Rust for coding",
          sentiment: 0.5,
        },
        {
          sourceIndex: 0,
          targetIndex: 3,
          relationType: "uses",
          fact: "Developer uses Go for coding",
          sentiment: 0.5,
        },
      ];

      await provider.store(memory, entities, edges, makeTestEmbedding(80), [
        makeTestEmbedding(81),
        makeTestEmbedding(82),
        makeTestEmbedding(83),
      ]);

      const results = await provider.fullTextSearchEdges("coding", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("get()", () => {
    test("retrieves entity with associated edges", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Get Test",
        text: "Eve created the API",
        summary: "Eve created API",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Eve", type: "person" },
        { uuid: randomUUID(), name: "API", type: "project" },
      ];

      const edges: ExtractedEdge[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          relationType: "created",
          fact: "Eve created the API",
          sentiment: 0.7,
        },
      ];

      await provider.store(memory, entities, edges, makeTestEmbedding(90), [
        makeTestEmbedding(91),
      ]);

      const result = await provider.get("Eve", testNamespace);
      expect(result.entity).toBeDefined();
      expect(result.entity?.name).toBe("Eve");
      expect(result.edges.length).toBeGreaterThanOrEqual(1);
    });

    test("returns undefined for non-existent entity", async () => {
      testNamespace = `test-${randomUUID()}`;
      const result = await provider.get(
        "NonExistentEntity12345",
        testNamespace,
      );
      expect(result.entity).toBeUndefined();
      expect(result.memory).toBeUndefined();
    });
  });

  describe("findEntities()", () => {
    test("finds entities by filter", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Find Entity Test",
        text: "Frank is a person",
        summary: "Frank exists",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Frank", type: "person" },
      ];

      await provider.store(memory, entities, [], makeTestEmbedding(100), []);

      const results = await provider.findEntities({
        namespace: testNamespace,
        type: "person",
      });
      expect(results.some((e) => e.name === "Frank")).toBe(true);
    });

    test("finds global entities with namespace: null filter", async () => {
      testNamespace = `test-${randomUUID()}`;
      const globalEntity: StoredEntity = {
        uuid: randomUUID(),
        name: "GlobalCorp",
        type: "organization",
        namespace: undefined,
        scope: "global",
      };

      await provider.storeEntity(globalEntity);

      const results = await provider.findEntities({
        namespace: null,
        scope: "global",
      });
      expect(results.some((e) => e.name === "GlobalCorp")).toBe(true);
    });
  });

  describe("findEdges()", () => {
    test("finds edges by filter", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Find Edge Test",
        text: "Grace leads the team",
        summary: "Grace leads team",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Grace", type: "person" },
        { uuid: randomUUID(), name: "Team", type: "organization" },
      ];

      const edges: ExtractedEdge[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          relationType: "leads",
          fact: "Grace leads the team",
          sentiment: 0.6,
        },
      ];

      await provider.store(memory, entities, edges, makeTestEmbedding(110), [
        makeTestEmbedding(111),
      ]);

      const results = await provider.findEdges({ sourceEntityName: "Grace" });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.sourceEntityName).toBe("Grace");
    });
  });

  describe("findMemories()", () => {
    test("finds memories by filter", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Unique Memory Name 12345",
        text: "Some text content",
        summary: "Summary",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      await provider.store(memory, [], [], makeTestEmbedding(120), []);

      const results = await provider.findMemories({
        name: "Unique Memory Name 12345",
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("finds memories by namespace", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "NS Memory Test",
        text: "Namespaced content",
        summary: "NS content",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      await provider.store(memory, [], [], makeTestEmbedding(125), []);

      const results = await provider.findMemories({ namespace: testNamespace });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every((m) => m.namespace === testNamespace)).toBe(true);
    });
  });

  describe("forget()", () => {
    test("removes entity and its edges", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Forget Test",
        text: "Henry exists",
        summary: "Henry",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Henry", type: "person" },
      ];

      await provider.store(memory, entities, [], makeTestEmbedding(130), []);

      const beforeForget = await provider.get("Henry", testNamespace);
      expect(beforeForget.entity).toBeDefined();

      const result = await provider.forget("Henry", testNamespace);
      expect(result.deletedEntity).toBe(true);

      const afterForget = await provider.get("Henry", testNamespace);
      expect(afterForget.entity).toBeUndefined();
    });

    test("returns false for non-existent entity", async () => {
      testNamespace = `test-${randomUUID()}`;
      const result = await provider.forget("NonExistent12345", testNamespace);
      expect(result.deletedMemory).toBe(false);
      expect(result.deletedEntity).toBe(false);
    });
  });

  describe("forgetEdge()", () => {
    test("invalidates edge and returns audit info", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Forget Edge Test",
        text: "Ivan knows Julia",
        summary: "Ivan knows Julia",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Ivan", type: "person" },
        { uuid: randomUUID(), name: "Julia", type: "person" },
      ];

      const edges: ExtractedEdge[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          relationType: "knows",
          fact: "Ivan knows Julia",
          sentiment: 0.5,
        },
      ];

      await provider.store(memory, entities, edges, makeTestEmbedding(140), [
        makeTestEmbedding(141),
      ]);

      const edgesBefore = await provider.findEdges({
        sourceEntityName: "Ivan",
      });
      expect(edgesBefore.length).toBeGreaterThanOrEqual(1);
      const edgeId = edgesBefore[0]!.id;

      const result = await provider.forgetEdge(
        edgeId,
        "No longer accurate",
        testNamespace,
      );
      expect(result.invalidatedEdge).toBeDefined();
      expect(result.auditMemoryId).toBeDefined();

      const edgesAfter = await provider.findEdges({
        sourceEntityName: "Ivan",
        includeInvalidated: false,
      });
      expect(edgesAfter.length).toBe(0);
    });
  });

  describe("Queue Operations", () => {
    test("storeMemoryOnly() stores memory without extraction", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Queue Test Memory",
        text: "Pending memory text",
        summary: "Pending",
        namespace: testNamespace,
        status: "pending",
        createdAt: new Date(),
      };

      await provider.storeMemoryOnly(memory);

      const results = await provider.findMemories({ id: memory.id });
      expect(results.length).toBe(1);
      expect(results[0]?.status).toBe("pending");
    });

    test("updateMemoryStatus() updates memory status", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Status Test Memory",
        text: "Status test",
        summary: "Status",
        namespace: testNamespace,
        status: "pending",
        createdAt: new Date(),
      };

      await provider.storeMemoryOnly(memory);
      await provider.updateMemoryStatus(memory.id, "completed");

      const results = await provider.findMemories({ id: memory.id });
      expect(results[0]?.status).toBe("completed");
    });

    test("getPendingMemories() returns memories with pending status", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Pending Memory",
        text: "Waiting to be processed",
        summary: "Waiting",
        namespace: testNamespace,
        status: "pending",
        createdAt: new Date(),
      };

      await provider.storeMemoryOnly(memory);

      const pending = await provider.getPendingMemories(testNamespace);
      expect(pending.some((m) => m.id === memory.id)).toBe(true);
    });
  });

  describe("Stats/Utility", () => {
    test("stats() returns counts for memories, entities, edges", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Stats Test",
        text: "Stats test content",
        summary: "Stats",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "StatsEntity", type: "concept" },
      ];

      await provider.store(memory, entities, [], makeTestEmbedding(150), []);

      const stats = await provider.stats(testNamespace);
      expect(stats.memories).toBeGreaterThanOrEqual(1);
      expect(stats.entities).toBeGreaterThanOrEqual(1);
      expect(typeof stats.edges).toBe("number");
    });

    test("listNamespaces() returns distinct namespaces", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Namespace List Test",
        text: "Content",
        summary: "Summary",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "NSListEntity", type: "concept" },
      ];

      await provider.store(memory, entities, [], makeTestEmbedding(160), []);

      const namespaces = await provider.listNamespaces();
      expect(Array.isArray(namespaces)).toBe(true);
    });

    test("deleteByNamespace() deletes all data in a namespace", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Delete NS Test",
        text: "To be deleted",
        summary: "Delete me",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "DeleteEntity", type: "concept" },
      ];

      await provider.store(memory, entities, [], makeTestEmbedding(170), []);

      const beforeDelete = await provider.stats(testNamespace);
      expect(beforeDelete.memories).toBeGreaterThanOrEqual(1);

      await provider.deleteByNamespace(testNamespace);

      const afterDelete = await provider.stats(testNamespace);
      expect(afterDelete.memories).toBe(0);
      expect(afterDelete.entities).toBe(0);
    });

    test("getGraphData() returns graph visualization data", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Graph Data Test",
        text: "Karen knows Leo",
        summary: "Karen knows Leo",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "Karen", type: "person" },
        { uuid: randomUUID(), name: "Leo", type: "person" },
      ];

      const edges: ExtractedEdge[] = [
        {
          sourceIndex: 0,
          targetIndex: 1,
          relationType: "knows",
          fact: "Karen knows Leo",
          sentiment: 0.5,
        },
      ];

      await provider.store(memory, entities, edges, makeTestEmbedding(180), [
        makeTestEmbedding(181),
      ]);

      const graphData = await provider.getGraphData(testNamespace);

      if (isLadybugMode()) {
        expect(graphData).toEqual({ nodes: [], links: [] });
      } else {
        expect(graphData).toHaveProperty("nodes");
        expect(graphData).toHaveProperty("links");
        expect(Array.isArray(graphData.nodes)).toBe(true);
        expect(Array.isArray(graphData.links)).toBe(true);
      }
    });
  });

  describe("Edge Cases", () => {
    test("handles empty arrays gracefully", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Empty Arrays Test",
        text: "No entities or edges",
        summary: "Empty",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      await provider.store(memory, [], [], makeTestEmbedding(190), []);

      const results = await provider.findMemories({ id: memory.id });
      expect(results.length).toBe(1);
    });

    test("handles Unicode names", async () => {
      testNamespace = `test-${randomUUID()}`;
      const memory: Memory = {
        id: randomUUID(),
        name: "Unicode Test",
        text: "日本語テスト with emoji 🎉",
        summary: "Unicode content",
        namespace: testNamespace,
        status: "completed",
        createdAt: new Date(),
      };

      const entities: Entity[] = [
        { uuid: randomUUID(), name: "田中太郎", type: "person" },
      ];

      await provider.store(memory, entities, [], makeTestEmbedding(200), []);

      const result = await provider.get("田中太郎", testNamespace);
      expect(result.entity?.name).toBe("田中太郎");
    });

    test("handles special characters in queries", async () => {
      testNamespace = `test-${randomUUID()}`;
      const results = await provider.fullTextSearchEdges(
        'test\'s "quoted" & special',
        10,
      );
      expect(Array.isArray(results)).toBe(true);
    });
  });
});
