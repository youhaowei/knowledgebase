/**
 * MCP (Model Context Protocol) route handler for TanStack Start
 * Handles POST /mcp requests with JSON-RPC protocol
 */

import { createFileRoute } from "@tanstack/react-router";
import { Graph } from "@/lib/graph";
import { Queue } from "@/lib/queue";
import { embed, isVectorEnabled } from "@/lib/embedder";
import { randomUUID } from "crypto";

// Shared instances
const graph = new Graph();
const queue = new Queue(graph);

// MCP tool definitions
const MCP_TOOLS = [
  {
    name: "add",
    description: "Save a new memory to the knowledge graph",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to remember" },
        name: { type: "string", description: "Optional name" },
        namespace: {
          type: "string",
          description: "Optional namespace",
          default: "default",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "search",
    description:
      "Search the knowledge graph. Returns edges (facts as relationships), memories, and entities. Check the guidance field for instructions on handling contradictory results.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "get",
    description: "Get memory/entity by name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact name" },
      },
      required: ["name"],
    },
  },
  {
    name: "forget",
    description: "Remove memory/entity by name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact name" },
      },
      required: ["name"],
    },
  },
  {
    name: "forgetEdge",
    description:
      "Invalidate a specific edge (fact) with a reason. Creates an audit trail. Use this when a fact is contradictory or outdated.",
    inputSchema: {
      type: "object",
      properties: {
        edgeId: { type: "string", description: "The ID of the edge to invalidate" },
        reason: {
          type: "string",
          description: "Reason for invalidation (required for audit trail)",
        },
        namespace: {
          type: "string",
          description: "Optional namespace",
          default: "default",
        },
      },
      required: ["edgeId", "reason"],
    },
  },
];

// MCP tool call handler
async function handleMCPToolCall(name: string, args: Record<string, unknown>) {
  try {
    switch (name) {
      case "add": {
        const memory = {
          id: randomUUID(),
          name: (args?.name as string) ?? "",
          text: args?.text as string,
          summary: "",
          namespace: (args?.namespace as string) ?? "default",
          createdAt: new Date(),
        };

        queue.add(memory).catch((error) => {
          console.error("Queue processing error:", error);
        });

        return {
          content: [{ type: "text", text: `✓ Memory queued for processing` }],
        };
      }

      case "search": {
        const query = args?.query as string;
        const limit = (args?.limit as number) ?? 10;
        const embedding = isVectorEnabled() ? await embed(query) : [];
        const result = await graph.search(embedding, query, limit);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
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
                  guidance:
                    "If any of these facts appear contradictory or outdated, please ask the user whether to invalidate them using the forgetEdge tool with a reason.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "get": {
        const entityName = args?.name as string;
        const result = await graph.get(entityName);

        if (!result.memory && !result.entity) {
          return {
            content: [
              { type: "text", text: `✗ Nothing found with name "${entityName}"` },
            ],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "forget": {
        const entityName = args?.name as string;
        const result = await graph.forget(entityName);

        if (!result.deletedMemory && !result.deletedEntity) {
          return {
            content: [
              { type: "text", text: `✗ Nothing found with name "${entityName}"` },
            ],
          };
        }

        return {
          content: [{ type: "text", text: `✓ Removed "${entityName}"` }],
        };
      }

      case "forgetEdge": {
        const edgeId = args?.edgeId as string;
        const reason = args?.reason as string;
        const namespace = (args?.namespace as string) ?? "default";

        const result = await graph.forgetEdge(edgeId, reason, namespace);

        if (!result.invalidatedEdge) {
          return {
            content: [{ type: "text", text: `✗ Edge not found: "${edgeId}"` }],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `✓ Invalidated: "${result.invalidatedEdge.fact}"`,
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
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            method: string;
            id?: string | number | null;
            params?: { name?: string; arguments?: Record<string, unknown> };
          };

          let result: unknown;

          if (body.method === "initialize") {
            result = {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: "knowledgebase",
                version: "1.0.0",
              },
            };
          } else if (body.method === "tools/list") {
            result = { tools: MCP_TOOLS };
          } else if (body.method === "tools/call") {
            const { name, arguments: args } = body.params ?? {};
            result = await handleMCPToolCall(name ?? "", args ?? {});
          } else if (body.method === "ping") {
            result = {};
          } else {
            return Response.json({
              jsonrpc: "2.0",
              id: body.id,
              error: { code: -32601, message: "Method not found" },
            });
          }

          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result,
          });
        } catch (error) {
          return Response.json({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32603,
              message:
                error instanceof Error ? error.message : "Internal error",
            },
          });
        }
      },
      OPTIONS: async () => {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
    },
  },
});
