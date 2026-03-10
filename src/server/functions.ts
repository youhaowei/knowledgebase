/**
 * TanStack Start Server Functions
 *
 * Edge-as-Fact knowledge graph API using native server functions.
 * Provides:
 * - add: Save memories → extract entities + edges (mutation)
 * - search: Semantic search on memories AND edge facts (query + streaming)
 * - get: Exact lookup by name (query)
 * - forget: Remove entities (mutation)
 * - forgetEdge: Invalidate edge with reason (mutation) - creates audit trail
 * - graph: Full graph data for visualization (query)
 * - stats: Statistics (query)
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Graph } from "../lib/graph.js";
import { Queue } from "../lib/queue.js";
import { embedWithDimension, isZeroEmbedding } from "../lib/embedder.js";
import { randomUUID } from "crypto";
import { classifyIntent, boostEdgesByIntent } from "../lib/intents.js";

// Shared instances (singleton pattern for server-side)
const graph = new Graph();
const queue = new Queue(graph);

// ============================================================================
// Queries (GET by default)
// ============================================================================

/**
 * Get all graph data for visualization with computed metrics
 *
 * Returns Entity nodes and RELATES_TO edges for visualization.
 *
 * Node types:
 * - Entity: people, orgs, projects, technologies, concepts
 *
 * Edge types:
 * - RELATES_TO: Facts as relationships between entities with relationType, sentiment
 */
export const getGraphData = createServerFn().handler(async () => {
  const result = await graph.getGraphData();
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

/**
 * Get graph statistics
 *
 * Returns counts of:
 * - memories: Input episodes/text
 * - entities: Extracted named things (people, tech, etc.)
 * - edges: Facts as relationships between entities
 */
export const getStats = createServerFn().handler(async () => {
  const stats = await graph.stats();
  return {
    memories: stats.memories,
    entities: stats.entities,
    edges: stats.edges,
  };
});

/**
 * Search the knowledge graph using semantic similarity
 *
 * Searches both memory embeddings AND edge fact text,
 * returning relevant memories, edges, and entities.
 *
 * Includes guidance for agents to ask users about contradictory/outdated results.
 */
const searchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  limit: z.number().int().positive().default(10),
});

export const searchMemories = createServerFn()
  .inputValidator((data: unknown) => searchSchema.parse(data))
  .handler(async ({ data }) => {
    const embResult = await embedWithDimension(data.query);
    const embedding = isZeroEmbedding(embResult.embedding) ? [] : embResult.embedding;
    const result = await graph.search(embedding, data.query, data.limit);
    const intent = classifyIntent(data.query);
    const boostedEdges = boostEdgesByIntent(result.edges, intent);

    return {
      intent,
      memories: result.memories.map((m) => ({
        id: m.id,
        name: m.name,
        summary: m.summary,
        category: m.category,
        createdAt: m.createdAt,
      })),
      edges: boostedEdges.map((e) => ({
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
      guidance:
        "If any of these facts appear contradictory or outdated, please ask the user whether to invalidate them using the forget tool with a reason.",
    };
  });

/**
 * Get a memory or entity by exact name
 *
 * If name matches a Memory, returns the memory and all edges extracted from it.
 * If name matches an Entity, returns the entity and all edges involving it.
 */
const getMemorySchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export const getMemory = createServerFn()
  .inputValidator((data: unknown) => getMemorySchema.parse(data))
  .handler(async ({ data }) => {
    const result = await graph.get(data.name);

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
 * Remove a memory or entity by name
 *
 * If a Memory is deleted, edges stay but lose provenance from this memory.
 * If an Entity is deleted, all edges involving it are also deleted.
 */
const forgetMemorySchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export const forgetMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => forgetMemorySchema.parse(data))
  .handler(async ({ data }) => {
    const result = await graph.forget(data.name);

    if (!result.deletedMemory && !result.deletedEntity) {
      throw new Error(`Nothing found with name "${data.name}"`);
    }

    const deleted = [];
    if (result.deletedMemory) deleted.push("memory");
    if (result.deletedEntity) deleted.push("entity");

    return {
      success: true,
      message: `Removed ${deleted.join(" and ")} "${data.name}"`,
      deletedMemory: result.deletedMemory,
      deletedEntity: result.deletedEntity,
    };
  });

/**
 * Invalidate an edge (fact) with reason
 *
 * This creates an audit trail by:
 * 1. Setting invalidAt on the edge (soft delete)
 * 2. Creating an audit Memory recording the decision and reason
 *
 * Use this when a fact is contradictory or outdated.
 */
const forgetEdgeSchema = z.object({
  edgeId: z.string().min(1, "Edge ID is required"),
  reason: z.string().min(1, "Reason is required for audit trail"),
  namespace: z.string().default("default"),
});

export const forgetEdge = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => forgetEdgeSchema.parse(data))
  .handler(async ({ data }) => {
    const result = await graph.forgetEdge(data.edgeId, data.reason, data.namespace);

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
  });

// ============================================================================
// LLM-Powered Answer (when no direct results found)
// ============================================================================

import { prompt } from "unifai";

function edgeSentimentLabel(s: number) {
  if (s > 0.3) return " (positive)";
  if (s < -0.3) return " (negative)";
  return "";
}

function formatEdges(edges: Array<{ sourceEntityName: string; relationType: string; targetEntityName: string; fact: string; sentiment: number }>) {
  return edges.map((edge) => {
    const sentiment = edgeSentimentLabel(edge.sentiment);
    return `- ${edge.sourceEntityName} → ${edge.relationType} → ${edge.targetEntityName}: ${edge.fact}${sentiment}`;
  });
}

function formatMemories(memories: Array<{ name?: string; summary?: string }>) {
  return memories
    .filter((m) => m.summary)
    .map((m) => `- ${m.name || "Memory"}: ${m.summary}`);
}

function formatEntities(entities: Array<{ name: string; type: string; description?: string; summary?: string }>) {
  return entities.map((e) => {
    const desc = e.description ? ` - ${e.description}` : "";
    const summary = e.summary ? ` (${e.summary})` : "";
    return `- ${e.name} (${e.type})${desc}${summary}`;
  });
}

function buildSearchContext(searchResult: { edges: Array<{ sourceEntityName: string; relationType: string; targetEntityName: string; fact: string; sentiment: number }>; memories: Array<{ name?: string; summary?: string }>; entities: Array<{ name: string; type: string; description?: string; summary?: string }> }) {
  const sections: string[] = [];

  const edgeLines = formatEdges(searchResult.edges);
  if (edgeLines.length > 0) sections.push("**Relevant Facts (as relationships):**\n" + edgeLines.join("\n"));

  const memLines = formatMemories(searchResult.memories);
  if (memLines.length > 0) sections.push("**Related Memories:**\n" + memLines.join("\n"));

  const entLines = formatEntities(searchResult.entities);
  if (entLines.length > 0) sections.push("**Related Entities:**\n" + entLines.join("\n"));

  return sections.length > 0
    ? sections.join("\n\n")
    : "No directly relevant information found in the knowledge base.";
}

/**
 * Ask LLM to answer a question using knowledge graph context
 *
 * When search returns no direct results, this uses the LLM to
 * synthesize an answer from the available knowledge.
 */
const askLLMSchema = z.object({
  question: z.string().min(1, "Question is required"),
});

export const askLLM = createServerFn()
  .inputValidator((data: unknown) => askLLMSchema.parse(data))
  .handler(async ({ data }) => {
    // First, search for relevant context
    const embResult = await embedWithDimension(data.question);
    const embedding = isZeroEmbedding(embResult.embedding) ? [] : embResult.embedding;
    const searchResult = await graph.search(embedding, data.question, 5);

    const context = buildSearchContext(searchResult);

    // Query LLM with context
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
  });

// ============================================================================
// Streaming (NEW - not available in tRPC easily)
// ============================================================================

/**
 * Streaming search - yields results one at a time
 *
 * Perfect for real-time UI updates as results come in.
 * Yields memories first, then edges, then entities, finally guidance.
 */
const streamingSearchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  limit: z.number().int().positive().default(10),
});

export const streamingSearch = createServerFn()
  .inputValidator((data: unknown) => streamingSearchSchema.parse(data))
  .handler(async function* ({ data }) {
    const embResult = await embedWithDimension(data.query);
    const embedding = isZeroEmbedding(embResult.embedding) ? [] : embResult.embedding;
    const result = await graph.search(embedding, data.query, data.limit);
    const intent = classifyIntent(data.query);
    const boostedEdges = boostEdgesByIntent(result.edges, intent);

    // Yield intent classification first
    yield {
      type: "intent" as const,
      data: { intent },
    };

    // Yield memories one at a time for streaming UI
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

    // Then yield boosted edges
    for (const edge of boostedEdges) {
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

    // Then yield entities
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

    // Finally yield guidance for contradiction handling
    yield {
      type: "guidance" as const,
      data: {
        message:
          "If any of these facts appear contradictory or outdated, please ask the user whether to invalidate them using the forget tool with a reason.",
      },
    };
  });
