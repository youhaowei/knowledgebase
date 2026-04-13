/**
 * Embeddable MCP Server Factory
 *
 * Creates an MCP server with knowledgebase tools using the official SDK.
 * Two consumption patterns:
 *
 * 1. HTTP endpoint (standalone KB app):
 *    const server = createKnowledgebaseMcpServer()
 *    server.connect(new WebStandardStreamableHTTPServerTransport())
 *
 * 2. Embedded in Workforce (or any consumer):
 *    import { createKnowledgebaseMcpServer } from "knowledgebase/mcp"
 *    const server = createKnowledgebaseMcpServer()
 *    server.connect(new StdioServerTransport())
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as ops from "@/lib/operations.js";
import { hybridSearch } from "@/lib/hybrid-search.js";
import { analyticsContext } from "@/lib/analytics.js";
import type { Memory, StoredEdge, StoredEntity, DetailLevel } from "@/types.js";

function formatMemory(m: Memory, detail: DetailLevel) {
  if (detail === "summary") return { id: m.id, name: m.name, abstract: m.abstract };
  if (detail === "source") return { id: m.id, name: m.name, text: m.text, abstract: m.abstract, summary: m.summary, category: m.category, schemaVersion: m.schemaVersion, createdAt: m.createdAt };
  return { id: m.id, name: m.name, summary: m.summary, category: m.category };
}

function formatEdge(e: StoredEdge, detail: DetailLevel) {
  if (detail === "summary") return { sourceEntity: e.sourceEntityName, targetEntity: e.targetEntityName, relationType: e.relationType, sentiment: e.sentiment };
  if (detail === "source") return { id: e.id, sourceEntity: e.sourceEntityName, targetEntity: e.targetEntityName, relationType: e.relationType, fact: e.fact, sentiment: e.sentiment, confidence: e.confidence, confidenceReason: e.confidenceReason, episodes: e.episodes, validAt: e.validAt, invalidAt: e.invalidAt, createdAt: e.createdAt };
  return { id: e.id, sourceEntity: e.sourceEntityName, targetEntity: e.targetEntityName, relationType: e.relationType, fact: e.fact, sentiment: e.sentiment, confidence: e.confidence, confidenceReason: e.confidenceReason };
}

function formatEntity(e: StoredEntity, detail: DetailLevel) {
  if (detail === "summary") return { name: e.name, type: e.type };
  if (detail === "source") return { name: e.name, type: e.type, description: e.description, summary: e.summary, namespace: e.namespace };
  return { name: e.name, type: e.type, description: e.description, summary: e.summary };
}

function errorResult(err: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true as const,
  };
}

/** Wrap an MCP tool handler with analytics source context */
function withMcpSource<A, R>(fn: (args: A) => Promise<R>) {
  return (args: A) => analyticsContext.run({ source: "mcp" }, () => fn(args));
}

export function createKnowledgebaseMcpServer() {
  const server = new McpServer(
    { name: "knowledgebase", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.tool(
    "add",
    "Save a memory to disk. Background indexing extracts entities and relationships when the server is running.",
    {
      text: z.string().describe("The text to remember"),
      name: z.string().optional().describe("Optional name for the memory"),
      namespace: z
        .string()
        .default("default")
        .describe("Namespace for isolation (e.g., project name)"),
      tags: z.array(z.string()).default([]).describe("Tags for organization (e.g., ['bug', 'worktree'])"),
      origin: z.enum(["manual", "retro", "mcp", "import"]).default("mcp").describe("Origin of the memory"),
    },
    withMcpSource(async ({ text, name, namespace, tags, origin }) => {
      try {
        const result = await ops.addMemory(text, name, namespace, origin, tags);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                id: result.id,
                name: result.name,
                path: result.path,
                message: result.status === "existing"
                  ? "Memory already exists with this name"
                  : "Memory written to filesystem",
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.tool(
    "search",
    "Search the knowledge graph. Returns edges (facts as relationships), memories, and entities. Use detail parameter to control response granularity: 'summary' (cheapest, abstracts only), 'full' (default, summaries + facts), 'source' (everything including full text).",
    {
      query: z.string().describe("Search query"),
      namespace: z
        .string()
        .default("default")
        .describe("Namespace to search within"),
      limit: z.number().default(10).describe("Max results"),
      detail: z.enum(["summary", "full", "source"]).default("full").describe("Response detail level: summary (L0 abstracts), full (L1 summaries, default), source (L2 full text)"),
      tags: z.array(z.string()).optional().describe("Filter by tags (e.g., ['bug', 'worktree'])"),
    },
    withMcpSource(async ({ query, namespace, limit, detail, tags }) => {
      try {
        const result = await hybridSearch(query, namespace, limit, tags);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  intent: result.intent,
                  memories: result.memories.map((m) => formatMemory(m, detail)),
                  edges: result.edges.map((e) => formatEdge(e, detail)),
                  entities: result.entities.map((e) => formatEntity(e, detail)),
                  files: result.files,
                  guidance: result.guidance
                    + (result.files.some((f) => !f.indexed)
                      ? " Some results are recently added and not yet indexed — entities/edges haven't been extracted. Full text is available at the file path."
                      : ""),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.tool(
    "get",
    "Get entity by exact name. Returns the entity and its related edges (facts). Use detail parameter to control response granularity.",
    {
      name: z.string().describe("Exact entity name"),
      namespace: z
        .string()
        .default("default")
        .describe("Namespace to search in"),
      detail: z.enum(["summary", "full", "source"]).default("full").describe("Response detail level"),
    },
    withMcpSource(async ({ name, namespace, detail }) => {
      try {
        const result = await ops.getByName(name, namespace);
        if (!result.entity && !result.memory) {
          return {
            content: [
              { type: "text" as const, text: `Nothing found with name "${name}"` },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                memory: result.memory ? formatMemory(result.memory, detail) : undefined,
                entity: result.entity ? formatEntity(result.entity, detail) : undefined,
                edges: result.edges.map((e) => formatEdge(e, detail)),
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.tool(
    "forget",
    "Remove memory or entity by name (soft delete).",
    {
      name: z.string().describe("Exact name to remove"),
      namespace: z
        .string()
        .default("default")
        .describe("Namespace to remove from"),
    },
    withMcpSource(async ({ name, namespace }) => {
      try {
        const result = await ops.forget(name, namespace);
        if (!result.deleted) {
          return {
            content: [
              { type: "text" as const, text: `Nothing found with name "${name}"` },
            ],
          };
        }
        return {
          content: [
            { type: "text" as const, text: `Removed "${name}"` },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  server.tool(
    "forgetEdge",
    "Invalidate a specific edge (fact) with a reason. Creates an audit trail. Use when a fact is contradictory or outdated.",
    {
      edgeId: z.string().describe("The ID of the edge to invalidate"),
      reason: z
        .string()
        .describe("Reason for invalidation (required for audit trail)"),
      namespace: z
        .string()
        .default("default")
        .describe("Namespace of the edge"),
    },
    withMcpSource(async ({ edgeId, reason, namespace }) => {
      try {
        // Spec Decision #11: forgetEdge records intent to _forget_edges.jsonl.
        // Graph invalidation happens on the next server reconciler sweep (Phase 2).
        await ops.forgetEdge(edgeId, reason, namespace);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Queued edge "${edgeId}" for invalidation in namespace "${namespace}". Graph cleanup happens on the next reconciler sweep.`,
                  edgeId,
                  namespace,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }),
  );

  return server;
}
