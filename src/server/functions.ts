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
});

export const getMemory = createServerFn()
  .inputValidator((data: unknown) => getMemorySchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await ops.getByName(data.name);

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

export const reextractAll = createServerFn({ method: "POST" }).handler(async () => {
  const { extract } = await import("../lib/extractor.js");
  const { embedDual } = await import("../lib/embedder.js");
  const gp = await ops.getProvider();
  const memories = await gp.findMemories({});

  let success = 0;
  let failed = 0;

  for (const memory of memories) {
    try {
      const extraction = await extract(memory.text);
      const memEmb = await embedDual(memory.text);
      const edgeEmbeddings = [];
      for (const edge of extraction.edges) {
        edgeEmbeddings.push(await embedDual(edge.fact));
      }
      await gp.store(
        { ...memory, abstract: extraction.abstract ?? "", summary: extraction.summary },
        extraction.entities,
        extraction.edges,
        memEmb,
        edgeEmbeddings,
      );
      success++;
    } catch (err) {
      failed++;
    }
  }

  return { success, failed, total: memories.length };
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
