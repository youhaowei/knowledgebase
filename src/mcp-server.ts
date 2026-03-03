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

export function createKnowledgebaseMcpServer() {
  const server = new McpServer(
    { name: "knowledgebase", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.tool(
    "add",
    "Save a new memory to the knowledge graph. Extracts entities and relationships automatically.",
    {
      text: z.string().describe("The text to remember"),
      name: z.string().optional().describe("Optional name for the memory"),
      namespace: z
        .string()
        .default("default")
        .describe("Namespace for isolation (e.g., project name)"),
    },
    async ({ text, name, namespace }) => {
      try {
        const result = await ops.addMemory(text, name, namespace);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                id: result.id,
                message: "Memory queued for processing",
              }),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "search",
    "Search the knowledge graph. Returns edges (facts as relationships), memories, and entities. Check the guidance field for instructions on handling contradictory results.",
    {
      query: z.string().describe("Search query"),
      namespace: z
        .string()
        .default("default")
        .describe("Namespace to search within"),
      limit: z.number().default(10).describe("Max results"),
    },
    async ({ query, namespace, limit }) => {
      try {
        const result = await ops.search(query, namespace, limit);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  intent: result.intent,
                  memories: result.memories.map((m) => ({
                    id: m.id,
                    name: m.name,
                    summary: m.summary,
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
                  })),
                  entities: result.entities.map((e) => ({
                    name: e.name,
                    type: e.type,
                    description: e.description,
                    summary: e.summary,
                  })),
                  guidance: result.guidance,
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
    },
  );

  server.tool(
    "get",
    "Get entity by exact name. Returns the entity and its related edges (facts).",
    {
      name: z.string().describe("Exact entity name"),
      namespace: z
        .string()
        .default("default")
        .describe("Namespace to search in"),
    },
    async ({ name, namespace }) => {
      try {
        const result = await ops.getByName(name, namespace);
        if (!result.entity) {
          return {
            content: [
              { type: "text" as const, text: `Nothing found with name "${name}"` },
            ],
          };
        }
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
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
    async ({ name, namespace }) => {
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
    },
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
    async ({ edgeId, reason, namespace }) => {
      try {
        const result = await ops.forgetEdge(edgeId, reason, namespace);
        if (!result.invalidatedEdge) {
          return {
            content: [
              { type: "text" as const, text: `Edge not found: "${edgeId}"` },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: `Invalidated: "${result.invalidatedEdge.fact}"`,
                  invalidatedEdge: {
                    id: result.invalidatedEdge.id,
                    fact: result.invalidatedEdge.fact,
                    sourceEntity: result.invalidatedEdge.sourceEntityName,
                    targetEntity: result.invalidatedEdge.targetEntityName,
                  },
                  auditMemoryId: result.auditMemoryId,
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
    },
  );

  return server;
}
