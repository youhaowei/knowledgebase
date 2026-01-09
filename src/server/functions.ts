/**
 * TanStack Start Server Functions
 *
 * Replaces tRPC router with native server functions.
 * Provides the same operations plus streaming support:
 * - add: Save memories (mutation)
 * - search: Semantic search (query + streaming)
 * - get: Exact lookup (query)
 * - forget: Remove items (mutation)
 * - graph: Full graph data (query)
 * - stats: Statistics (query)
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Graph } from "../lib/graph.js";
import { Queue } from "../lib/queue.js";
import { embed } from "../lib/embedder.js";
import { randomUUID } from "crypto";
import type { Record as Neo4jRecord } from "neo4j-driver";

// Shared instances (singleton pattern for server-side)
const graph = new Graph();
const queue = new Queue(graph);

// ============================================================================
// Queries (GET by default)
// ============================================================================

/**
 * Get all graph data for visualization with computed metrics
 *
 * Computes node importance (degree centrality + reference count) and
 * edge strength (frequency of same relation) at query time for fresh data.
 */
export const getGraphData = createServerFn().handler(async () => {
  // @ts-expect-error - accessing private driver property for graph visualization
  const session = graph.driver.session();
  try {
    // Get all Item nodes with degree centrality and reference count
    const nodesResult = await session.run(`
      MATCH (n:Item)
      OPTIONAL MATCH (n)-[r:RELATION]-()
      WITH n, count(DISTINCT r) as degree
      OPTIONAL MATCH (n)-[r2:RELATION]-()
      WITH n, degree, count(DISTINCT r2.memoryId) as referenceCount
      RETURN
        n.name as id,
        n.name as name,
        'Item' as type,
        n.type as itemType,
        n.namespace as namespace,
        degree,
        referenceCount
    `);

    const nodes = nodesResult.records.map((r: Neo4jRecord) => ({
      id: r.get("id") || r.get("name"),
      name: r.get("name"),
      type: r.get("type"),
      itemType: r.get("itemType"),
      namespace: r.get("namespace") || "default",
      degree: r.get("degree")?.toNumber?.() ?? r.get("degree") ?? 0,
      referenceCount:
        r.get("referenceCount")?.toNumber?.() ?? r.get("referenceCount") ?? 0,
    }));

    // Get all edges with frequency (how many times same source-relation-target exists)
    const edgesResult = await session.run(`
      MATCH (a:Item)-[r:RELATION]->(b:Item)
      WITH a.name as source, b.name as target, r.type as relation,
           a.namespace as namespace, count(r) as frequency
      RETURN source, target, relation, namespace, frequency
    `);

    const edges = edgesResult.records.map((r: Neo4jRecord) => ({
      source: r.get("source"),
      target: r.get("target"),
      relation: r.get("relation"),
      namespace: r.get("namespace") || "default",
      frequency: r.get("frequency")?.toNumber?.() ?? r.get("frequency") ?? 1,
    }));

    return { nodes, edges };
  } finally {
    await session.close();
  }
});

/**
 * Get graph statistics
 */
export const getStats = createServerFn().handler(async () => {
  // @ts-expect-error - accessing private driver property for stats
  const session = graph.driver.session();
  try {
    const memoriesResult = await session.run(
      `MATCH (m:Memory) RETURN count(m) as count`,
    );
    const itemsResult = await session.run(
      `MATCH (i:Item) RETURN count(i) as count`,
    );
    const relationsResult = await session.run(
      `MATCH ()-[r:RELATION]->() RETURN count(r) as count`,
    );

    return {
      memories: memoriesResult.records[0]?.get("count").toNumber() ?? 0,
      items: itemsResult.records[0]?.get("count").toNumber() ?? 0,
      relations: relationsResult.records[0]?.get("count").toNumber() ?? 0,
    };
  } finally {
    await session.close();
  }
});

/**
 * Search the knowledge graph using semantic similarity
 */
const searchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  limit: z.number().int().positive().default(10),
});

export const searchMemories = createServerFn()
  .inputValidator((data: unknown) => searchSchema.parse(data))
  .handler(async ({ data }) => {
    const embedding = await embed(data.query);
    const result = await graph.search(embedding, data.query, data.limit);

    return {
      memories: result.memories.map((m) => ({
        id: m.id,
        name: m.name,
        summary: m.summary,
        createdAt: m.createdAt,
      })),
      relations: result.relations.map((r) => ({
        from: r.from,
        relation: r.relation,
        to: r.to,
        createdAt: r.createdAt,
      })),
      conflicts: result.conflicts.map((c) => ({
        item: c.itemName,
        relation: c.relationType,
        options: c.relations.map((r) => ({
          id: r.id,
          value: r.to,
          createdAt: r.createdAt,
        })),
        resolved: c.resolution != null,
      })),
    };
  });

/**
 * Get a memory or item by exact name
 */
const getMemorySchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export const getMemory = createServerFn()
  .inputValidator((data: unknown) => getMemorySchema.parse(data))
  .handler(async ({ data }) => {
    const result = await graph.get(data.name);

    if (!result.memory && !result.item) {
      throw new Error(`Nothing found with name "${data.name}"`);
    }

    return {
      memory: result.memory
        ? {
            id: result.memory.id,
            name: result.memory.name,
            text: result.memory.text,
            summary: result.memory.summary,
            createdAt: result.memory.createdAt,
          }
        : undefined,
      relatedItems: result.relatedItems,
      item: result.item,
      relations: result.relations.map((r) => ({
        from: r.from,
        relation: r.relation,
        to: r.to,
        createdAt: r.createdAt,
      })),
      conflicts: result.conflicts.map((c) => ({
        item: c.itemName,
        relation: c.relationType,
        options: c.relations.map((r) => ({
          id: r.id,
          value: r.to,
          createdAt: r.createdAt,
        })),
        resolved: c.resolution != null,
      })),
    };
  });

/**
 * Health check endpoint
 */
export const getHealth = createServerFn().handler(async () => {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
    queuePending: queue.pending(),
  };
});

/**
 * Get queue status
 */
export const getQueueStatus = createServerFn().handler(async () => {
  return {
    pending: queue.pending(),
  };
});

// ============================================================================
// Mutations (POST)
// ============================================================================

/**
 * Add a new memory to the knowledge graph
 */
const addMemorySchema = z.object({
  text: z.string().min(1, "Text is required"),
  name: z.string().optional(),
  namespace: z.string().default("default"),
});

export const addMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => addMemorySchema.parse(data))
  .handler(async ({ data }) => {
    const memory = {
      id: randomUUID(),
      name: data.name ?? "",
      text: data.text,
      summary: "",
      namespace: data.namespace,
      createdAt: new Date(),
    };

    // Queue for async processing (fire and forget)
    queue.add(memory).catch((error) => {
      console.error("Queue processing error:", error);
    });

    const pending = queue.pending(memory.namespace);
    const pendingInfo = pending > 0 ? ` (${pending} pending)` : "";

    return {
      success: true,
      message: `Memory queued for processing${pendingInfo}`,
      memoryId: memory.id,
    };
  });

/**
 * Remove a memory or item by name
 */
const forgetMemorySchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export const forgetMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => forgetMemorySchema.parse(data))
  .handler(async ({ data }) => {
    const result = await graph.forget(data.name);

    if (!result.deletedMemory && !result.deletedItem) {
      throw new Error(`Nothing found with name "${data.name}"`);
    }

    const deleted = [];
    if (result.deletedMemory) deleted.push("memory");
    if (result.deletedItem) deleted.push("item");

    return {
      success: true,
      message: `Removed ${deleted.join(" and ")} "${data.name}" and its relations`,
      deletedMemory: result.deletedMemory,
      deletedItem: result.deletedItem,
    };
  });

// ============================================================================
// Streaming (NEW - not available in tRPC easily)
// ============================================================================

/**
 * Streaming search - yields results one at a time
 * Perfect for real-time UI updates as results come in
 */
const streamingSearchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  limit: z.number().int().positive().default(10),
});

export const streamingSearch = createServerFn()
  .inputValidator((data: unknown) => streamingSearchSchema.parse(data))
  .handler(async function* ({ data }) {
    const embedding = await embed(data.query);
    const result = await graph.search(embedding, data.query, data.limit);

    // Yield memories one at a time for streaming UI
    for (const memory of result.memories) {
      yield {
        type: "memory" as const,
        data: {
          id: memory.id,
          name: memory.name,
          summary: memory.summary,
          createdAt: memory.createdAt,
        },
      };
    }

    // Then yield relations
    for (const relation of result.relations) {
      yield {
        type: "relation" as const,
        data: {
          from: relation.from,
          relation: relation.relation,
          to: relation.to,
          createdAt: relation.createdAt,
        },
      };
    }

    // Finally yield conflicts
    for (const conflict of result.conflicts) {
      yield {
        type: "conflict" as const,
        data: {
          item: conflict.itemName,
          relation: conflict.relationType,
          options: conflict.relations.map((r) => ({
            id: r.id,
            value: r.to,
            createdAt: r.createdAt,
          })),
          resolved: conflict.resolution != null,
        },
      };
    }
  });
