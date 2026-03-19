/**
 * TanStack Start Server Functions
 *
 * Thin wrappers around the operations layer (src/lib/operations.ts)
 * that add input validation and response shaping for the Web UI.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as ops from "../lib/operations.js";
import { analyticsContext } from "../lib/analytics.js";

// ============================================================================
// Queries (GET by default)
// ============================================================================

const namespaceFilterSchema = z.object({
  namespace: z.string().optional(),
});

export const getGraphData = createServerFn()
  .inputValidator((data: unknown) => namespaceFilterSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const result = await ops.getGraphData(data.namespace || undefined);
    return {
      nodes: result.nodes,
      edges: result.links.map((link) => ({
        source: link.source,
        target: link.target,
        relationType: link.relationType,
        fact: link.fact,
        sentiment: link.sentiment,
        confidence: link.confidence,
        edgeId: link.edgeId,
      })),
    };
  });

export const getStats = createServerFn()
  .inputValidator((data: unknown) => namespaceFilterSchema.parse(data ?? {}))
  .handler(({ data }) =>
    analyticsContext.run({ source: "web" }, () => ops.stats(data.namespace || undefined)),
  );

export const listNamespaces = createServerFn().handler(async () => {
  return ops.listNamespaces();
});

const searchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  limit: z.number().int().positive().max(100).default(10),
  namespace: z.string().optional(),
});

export const searchMemories = createServerFn()
  .inputValidator((data: unknown) => searchSchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await ops.search(data.query, data.namespace, data.limit);

    return {
      intent: result.intent,
      memories: result.memories.map((m) => ({
        id: m.id,
        name: m.name,
        summary: m.summary,
        category: m.category,
        createdAt: m.createdAt,
      })),
      edges: result.edges.map((e) => ({
        id: e.id,
        sourceEntity: e.sourceEntityName,
        targetEntity: e.targetEntityName,
        relationType: e.relationType,
        fact: e.fact,
        sentiment: e.sentiment,
        confidence: e.confidence,
        confidenceReason: e.confidenceReason,
        validAt: e.validAt,
        createdAt: e.createdAt,
      })),
      entities: result.entities.map((e) => ({
        name: e.name,
        type: e.type,
        description: e.description,
        summary: e.summary,
      })),
      guidance: result.guidance,
    };
  }));

const getMemorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  namespace: z.string().optional(),
});

export const getMemory = createServerFn()
  .inputValidator((data: unknown) => getMemorySchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await ops.getByName(data.name, data.namespace || undefined);

    if (!result.memory && !result.entity) {
      throw new Error(`Nothing found with name "${data.name}"`);
    }

    return {
      memory: result.memory
        ? {
            id: result.memory.id,
            name: result.memory.name,
            text: result.memory.text,
            summary: result.memory.summary,
            category: result.memory.category,
            createdAt: result.memory.createdAt,
          }
        : undefined,
      entity: result.entity
        ? {
            name: result.entity.name,
            type: result.entity.type,
            description: result.entity.description,
            summary: result.entity.summary,
          }
        : undefined,
      edges: result.edges.map((e) => ({
        id: e.id,
        sourceEntity: e.sourceEntityName,
        targetEntity: e.targetEntityName,
        relationType: e.relationType,
        fact: e.fact,
        sentiment: e.sentiment,
        confidence: e.confidence,
        confidenceReason: e.confidenceReason,
        validAt: e.validAt,
        invalidAt: e.invalidAt,
        createdAt: e.createdAt,
      })),
    };
  }));

export const getHealth = createServerFn().handler(async () => {
  const pending = await ops.getQueueStatus();
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    queuePending: pending,
  };
});

export const getQueueStatus = createServerFn().handler(async () => {
  const pending = await ops.getQueueStatus();
  return { pending };
});

// ============================================================================
// Mutations (POST)
// ============================================================================

const addMemorySchema = z.object({
  text: z.string().min(1, "Text is required"),
  name: z.string().optional(),
  namespace: z.string().default("default"),
});

export const addMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => addMemorySchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await ops.addMemory(data.text, data.name, data.namespace);
    const pending = await ops.getQueueStatus(data.namespace);
    const pendingInfo = pending > 0 ? ` (${pending} pending)` : "";

    return {
      success: true,
      message: result.existing
        ? `Memory already exists`
        : `Memory queued for processing${pendingInfo}`,
      memoryId: result.id,
    };
  }));

const forgetMemorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  namespace: z.string().default("default"),
});

export const forgetMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => forgetMemorySchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await ops.forget(data.name, data.namespace);

    if (!result.deleted) {
      throw new Error(`Nothing found with name "${data.name}"`);
    }

    return {
      success: true,
      message: `Removed "${data.name}"`,
    };
  }));

const forgetEdgeSchema = z.object({
  edgeId: z.string().min(1, "Edge ID is required"),
  reason: z.string().min(1, "Reason is required for audit trail"),
  namespace: z.string().default("default"),
});

export const forgetEdge = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => forgetEdgeSchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await ops.forgetEdge(data.edgeId, data.reason, data.namespace);

    if (!result.invalidatedEdge) {
      throw new Error(`Edge not found: "${data.edgeId}"`);
    }

    return {
      success: true,
      message: `Invalidated: "${result.invalidatedEdge.fact}"`,
      invalidatedEdge: {
        id: result.invalidatedEdge.id,
        fact: result.invalidatedEdge.fact,
        sourceEntity: result.invalidatedEdge.sourceEntityName,
        targetEntity: result.invalidatedEdge.targetEntityName,
        relationType: result.invalidatedEdge.relationType,
        invalidAt: result.invalidatedEdge.invalidAt,
      },
      auditMemoryId: result.auditMemoryId,
    };
  }));

// ============================================================================
// Admin Operations
// ============================================================================

// Re-extraction state (in-memory, lives for the server process lifetime)
const reextractState = {
  running: false,
  current: 0,
  total: 0,
  currentName: "",
  phase: "" as "" | "extracting" | "embedding-memory" | "embedding-edges" | "storing",
  edgeCurrent: 0,
  edgeTotal: 0,
  success: 0,
  failed: 0,
  errors: [] as string[],
  lastEntities: 0,
  lastEdges: 0,
};

export const getReextractStatus = createServerFn().handler(async () => ({ ...reextractState }));
export const resetReextract = createServerFn({ method: "POST" }).handler(async () => {
  reextractState.running = false;
  return { reset: true };
});

export const deduplicateEntities = createServerFn({ method: "POST" }).handler(async () => {
  const gp = await ops.getProvider() as any;
  const conn = gp.conn;
  if (!conn) return { error: "No connection available" };

  // Get all active entities
  const result = await conn.query(
    `MATCH (e:Entity) WHERE e.deletedAt = '' RETURN e.uuid as uuid, e.name as name, e.namespace as ns ORDER BY e.name`,
  );
  const rows = await result.getAll();

  // Group by name+namespace
  const groups = new Map<string, Array<{ uuid: string; name: string; ns: string }>>();
  for (const r of rows) {
    const key = `${r.name}::${r.ns}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ uuid: r.uuid as string, name: r.name as string, ns: r.ns as string });
  }

  let merged = 0;
  let removed = 0;
  const details: string[] = [];

  for (const [, entities] of groups) {
    if (entities.length <= 1) continue;

    const keep = entities[0]!;
    const dupes = entities.slice(1);

    for (const dupe of dupes) {
      // Re-point Fact nodes referencing the duplicate
      await conn.query(`MATCH (f:Fact) WHERE f.sourceUuid = '${dupe.uuid}' SET f.sourceUuid = '${keep.uuid}'`);
      await conn.query(`MATCH (f:Fact) WHERE f.targetUuid = '${dupe.uuid}' SET f.targetUuid = '${keep.uuid}'`);

      // Re-point RELATES_TO edges: copy to kept entity, then delete from dupe.
      // Kuzu can't change edge endpoints — must create new + delete old.
      // Outgoing edges: dupe -> X becomes keep -> X
      const outResult = await conn.query(
        `MATCH (e:Entity {uuid: '${dupe.uuid}'})-[r:RELATES_TO]->(t:Entity)
         RETURN r.id as id, r.relationType as relationType, r.fact as fact,
                r.sentiment as sentiment, r.confidence as confidence,
                r.confidenceReason as confidenceReason, r.episodes as episodes,
                r.validAt as validAt, r.invalidAt as invalidAt,
                r.namespace as namespace, r.createdAt as createdAt,
                t.uuid as targetUuid`,
      );
      for (const row of await outResult.getAll()) {
        // Skip if equivalent edge already exists on kept entity (same target + relationType)
        const exists = await conn.query(
          `MATCH (s:Entity {uuid: '${keep.uuid}'})-[r:RELATES_TO]->(t:Entity {uuid: '${row.targetUuid}'})
           WHERE r.relationType = '${row.relationType}' RETURN r.id`,
        );
        if ((await exists.getAll()).length === 0) {
          await conn.query(
            `MATCH (s:Entity {uuid: '${keep.uuid}'})
             MATCH (t:Entity {uuid: '${row.targetUuid}'})
             CREATE (s)-[:RELATES_TO {
               id: '${row.id}', relationType: '${row.relationType}',
               fact: '${(row.fact as string).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}',
               sentiment: ${row.sentiment ?? 0}, confidence: ${row.confidence ?? 1},
               confidenceReason: '${((row.confidenceReason as string) ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'")}',
               episodes: ${JSON.stringify(row.episodes ?? [])},
               validAt: '${row.validAt ?? ""}', invalidAt: '${row.invalidAt ?? ""}',
               namespace: '${row.namespace ?? ""}', createdAt: '${row.createdAt ?? ""}'
             }]->(t)`,
          );
        }
      }

      // Incoming edges: X -> dupe becomes X -> keep
      const inResult = await conn.query(
        `MATCH (s:Entity)-[r:RELATES_TO]->(e:Entity {uuid: '${dupe.uuid}'})
         RETURN r.id as id, r.relationType as relationType, r.fact as fact,
                r.sentiment as sentiment, r.confidence as confidence,
                r.confidenceReason as confidenceReason, r.episodes as episodes,
                r.validAt as validAt, r.invalidAt as invalidAt,
                r.namespace as namespace, r.createdAt as createdAt,
                s.uuid as sourceUuid`,
      );
      for (const row of await inResult.getAll()) {
        // Skip if equivalent edge already exists on kept entity (same source + relationType)
        const exists = await conn.query(
          `MATCH (s:Entity {uuid: '${row.sourceUuid}'})-[r:RELATES_TO]->(t:Entity {uuid: '${keep.uuid}'})
           WHERE r.relationType = '${row.relationType}' RETURN r.id`,
        );
        if ((await exists.getAll()).length === 0) {
          await conn.query(
            `MATCH (s:Entity {uuid: '${row.sourceUuid}'})
             MATCH (t:Entity {uuid: '${keep.uuid}'})
             CREATE (s)-[:RELATES_TO {
               id: '${row.id}', relationType: '${row.relationType}',
               fact: '${(row.fact as string).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}',
               sentiment: ${row.sentiment ?? 0}, confidence: ${row.confidence ?? 1},
               confidenceReason: '${((row.confidenceReason as string) ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'")}',
               episodes: ${JSON.stringify(row.episodes ?? [])},
               validAt: '${row.validAt ?? ""}', invalidAt: '${row.invalidAt ?? ""}',
               namespace: '${row.namespace ?? ""}', createdAt: '${row.createdAt ?? ""}'
             }]->(t)`,
          );
        }
      }

      // Now safe to delete old edges from duplicate
      await conn.query(`MATCH (e:Entity {uuid: '${dupe.uuid}'})-[r:RELATES_TO]->() DELETE r`);
      await conn.query(`MATCH ()-[r:RELATES_TO]->(e:Entity {uuid: '${dupe.uuid}'}) DELETE r`);

      // Soft-delete the duplicate
      await conn.query(`MATCH (e:Entity {uuid: '${dupe.uuid}'}) SET e.deletedAt = '${new Date().toISOString()}'`);
      removed++;
    }

    details.push(`"${keep.name}": kept 1, removed ${dupes.length}`);
    merged++;
  }

  return { merged, removed, total: rows.length, remaining: rows.length - removed, details };
});

export const reextractAll = createServerFn({ method: "POST" }).handler(async () => {
  if (reextractState.running) return { started: false, reason: "already running" };

  // Start async — don't await, return immediately
  (async () => {
    const { extract } = await import("../lib/extractor.js");
    const { embedDual } = await import("../lib/embedder.js");
    const gp = await ops.getProvider();
    const memories = await gp.findMemories({});

    reextractState.running = true;
    reextractState.current = 0;
    reextractState.total = memories.length;
    reextractState.success = 0;
    reextractState.failed = 0;
    reextractState.errors = [];

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i]!;
      reextractState.current = i + 1;
      reextractState.currentName = memory.name || memory.id;
      reextractState.phase = "extracting";
      reextractState.edgeCurrent = 0;
      reextractState.edgeTotal = 0;
      try {
        const extraction = await extract(memory.text);
        reextractState.lastEntities = extraction.entities.length;
        reextractState.lastEdges = extraction.edges.length;
        reextractState.edgeTotal = extraction.edges.length;

        reextractState.phase = "embedding-memory";
        const memEmb = await embedDual(memory.text);

        reextractState.phase = "embedding-edges";
        const edgeEmbeddings = [];
        for (let j = 0; j < extraction.edges.length; j++) {
          reextractState.edgeCurrent = j + 1;
          edgeEmbeddings.push(await embedDual(extraction.edges[j]!.fact));
        }

        reextractState.phase = "storing";
        await gp.store(
          { ...memory, abstract: extraction.abstract ?? "", summary: extraction.summary },
          extraction.entities,
          extraction.edges,
          memEmb,
          edgeEmbeddings,
        );
        reextractState.success++;
      } catch (err) {
        reextractState.failed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        reextractState.errors.push(`${memory.name}: ${errMsg}`);
        console.error(`[reextract] Failed ${memory.name}:`, errMsg);
      }
    }
    reextractState.running = false;
    reextractState.currentName = "";
  })();

  return { started: true, total: reextractState.total };
});

// ============================================================================
// LLM-Powered Answer
// ============================================================================

import { prompt } from "unifai";

function edgeSentimentLabel(s: number) {
  if (s > 0.3) return " (positive)";
  if (s < -0.3) return " (negative)";
  return "";
}

function buildSearchContext(searchResult: Awaited<ReturnType<typeof ops.search>>) {
  const sections: string[] = [];

  const edgeLines = searchResult.edges.map((edge) => {
    const sentiment = edgeSentimentLabel(edge.sentiment);
    return `- ${edge.sourceEntityName} → ${edge.relationType} → ${edge.targetEntityName}: ${edge.fact}${sentiment}`;
  });
  if (edgeLines.length > 0) sections.push("**Relevant Facts (as relationships):**\n" + edgeLines.join("\n"));

  const memLines = searchResult.memories
    .filter((m) => m.summary)
    .map((m) => `- ${m.name || "Memory"}: ${m.summary}`);
  if (memLines.length > 0) sections.push("**Related Memories:**\n" + memLines.join("\n"));

  const entLines = searchResult.entities.map((e) => {
    const desc = e.description ? ` - ${e.description}` : "";
    const summary = e.summary ? ` (${e.summary})` : "";
    return `- ${e.name} (${e.type})${desc}${summary}`;
  });
  if (entLines.length > 0) sections.push("**Related Entities:**\n" + entLines.join("\n"));

  return sections.length > 0
    ? sections.join("\n\n")
    : "No directly relevant information found in the knowledge base.";
}

const askLLMSchema = z.object({
  question: z.string().min(1, "Question is required"),
});

export const askLLM = createServerFn()
  .inputValidator((data: unknown) => askLLMSchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const searchResult = await ops.search(data.question, undefined, 5);
    const context = buildSearchContext(searchResult);

    const result = await prompt("claude", `You are a helpful assistant with access to a personal knowledge base.

Context from the knowledge base:
${context}

User question: ${data.question}

Instructions:
- Answer the question using the provided context if relevant
- If the context doesn't contain relevant information, say so honestly
- Be concise but helpful
- If you can make reasonable inferences from the context, do so
- Don't make up information that isn't supported by the context`, {
      maxTurns: 1,
      allowedTools: [],
      model: "haiku",
    });
    const answer = result.text;

    return {
      answer: answer || "I couldn't generate an answer. Please try rephrasing your question.",
      hasContext: searchResult.edges.length > 0 || searchResult.memories.length > 0 || searchResult.entities.length > 0,
      edgesUsed: searchResult.edges.length,
      memoriesUsed: searchResult.memories.length,
      entitiesUsed: searchResult.entities.length,
    };
  }));

// ============================================================================
// Streaming
// ============================================================================

// ============================================================================
// Browse APIs (paginated listing)
// ============================================================================

const listMemoriesSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(30),
  namespace: z.string().optional(),
  category: z.enum(["preference", "event", "pattern", "general"]).optional(),
  sortBy: z.enum(["createdAt", "name"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const listMemories = createServerFn()
  .inputValidator((data: unknown) => listMemoriesSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const gp = await ops.getProvider();
    const filter: Record<string, unknown> = {};
    if (data.namespace) filter.namespace = data.namespace;
    if (data.category) filter.category = data.category;

    const items = await gp.findMemories(filter as any, data.limit, {
      offset: data.offset,
      limit: data.limit,
      sortBy: data.sortBy,
      sortDir: data.sortDir,
    });

    const total = await gp.stats(data.namespace || undefined);
    return { items, total: total.memories };
  });

const listEntitiesSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(30),
  namespace: z.string().optional(),
  type: z.enum(["person", "organization", "project", "technology", "concept"]).optional(),
  sortBy: z.enum(["createdAt", "name"]).default("name"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});

export const listEntities = createServerFn()
  .inputValidator((data: unknown) => listEntitiesSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const gp = await ops.getProvider();
    const filter: Record<string, unknown> = {};
    if (data.namespace) filter.namespace = data.namespace;
    if (data.type) filter.type = data.type;

    const items = await gp.findEntities(filter as any, data.limit, {
      offset: data.offset,
      limit: data.limit,
      sortBy: data.sortBy,
      sortDir: data.sortDir,
    });

    const total = await gp.stats(data.namespace || undefined);
    return { items, total: total.entities };
  });

const listEdgesSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(30),
  namespace: z.string().optional(),
  relationType: z.string().optional(),
  includeInvalidated: z.boolean().default(false),
  sortBy: z.enum(["createdAt", "name"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const listEdges = createServerFn()
  .inputValidator((data: unknown) => listEdgesSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const gp = await ops.getProvider();
    const filter: Record<string, unknown> = {
      includeInvalidated: data.includeInvalidated,
    };
    if (data.namespace) filter.namespace = data.namespace;
    if (data.relationType) filter.relationType = data.relationType;

    const items = await gp.findEdges(filter as any, data.limit, {
      offset: data.offset,
      limit: data.limit,
      sortBy: data.sortBy,
      sortDir: data.sortDir,
    });

    const total = await gp.stats(data.namespace || undefined);
    return { items, total: total.edges };
  });

const getEntitySchema = z.object({
  name: z.string().min(1, "Name is required"),
  namespace: z.string().optional(),
});

export const getEntity = createServerFn()
  .inputValidator((data: unknown) => getEntitySchema.parse(data))
  .handler(async ({ data }) => {
    const gp = await ops.getProvider();
    // Find entity by exact name — namespace filter is optional
    const filter: Record<string, unknown> = { name: data.name };
    if (data.namespace) filter.namespace = data.namespace;
    const entities = await gp.findEntities(filter as any, 10);
    const entity = entities.find((e) => e.name === data.name);
    if (!entity) throw new Error(`Entity not found: "${data.name}"`);

    // Find all connected edges (both directions)
    const edgeFilter: Record<string, unknown> = {};
    if (data.namespace) edgeFilter.namespace = data.namespace;
    const outgoing = await gp.findEdges({ ...edgeFilter, sourceEntityName: data.name } as any, 100);
    const incoming = await gp.findEdges({ ...edgeFilter, targetEntityName: data.name } as any, 100);

    return {
      entity: {
        name: entity.name,
        type: entity.type,
        description: entity.description,
        summary: entity.summary,
        namespace: entity.namespace,
      },
      edges: [...outgoing, ...incoming].map((e) => ({
        id: e.id,
        sourceEntity: e.sourceEntityName,
        targetEntity: e.targetEntityName,
        relationType: e.relationType,
        fact: e.fact,
        sentiment: e.sentiment,
        confidence: e.confidence,
        confidenceReason: e.confidenceReason,
        validAt: e.validAt,
        invalidAt: e.invalidAt,
        createdAt: e.createdAt,
      })),
    };
  });

// ============================================================================
// Streaming
// ============================================================================

const streamingSearchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  limit: z.number().int().positive().default(10),
});

export const streamingSearch = createServerFn()
  .inputValidator((data: unknown) => streamingSearchSchema.parse(data))
  .handler(async function* ({ data }) {
    const result = await analyticsContext.run({ source: "web" }, () =>
      ops.search(data.query, undefined, data.limit),
    );

    yield {
      type: "intent" as const,
      data: { intent: result.intent },
    };

    for (const memory of result.memories) {
      yield {
        type: "memory" as const,
        data: {
          id: memory.id,
          name: memory.name,
          summary: memory.summary,
          category: memory.category,
          createdAt: memory.createdAt,
        },
      };
    }

    for (const edge of result.edges) {
      yield {
        type: "edge" as const,
        data: {
          id: edge.id,
          sourceEntity: edge.sourceEntityName,
          targetEntity: edge.targetEntityName,
          relationType: edge.relationType,
          fact: edge.fact,
          sentiment: edge.sentiment,
          confidence: edge.confidence,
          confidenceReason: edge.confidenceReason,
          validAt: edge.validAt,
          createdAt: edge.createdAt,
        },
      };
    }

    for (const entity of result.entities) {
      yield {
        type: "entity" as const,
        data: {
          name: entity.name,
          type: entity.type,
          description: entity.description,
          summary: entity.summary,
        },
      };
    }

    yield {
      type: "guidance" as const,
      data: { message: result.guidance },
    };
  });
