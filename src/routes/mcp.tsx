/**
 * MCP (Model Context Protocol) route handler for TanStack Start
 * Handles POST /mcp requests with JSON-RPC protocol
 */

import { createFileRoute } from "@tanstack/react-router";
import { Graph } from "@/lib/graph";
import { Queue } from "@/lib/queue";
import { embed } from "@/lib/embedder";
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
    description: "Search the knowledge graph",
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
    description: "Get memory/item by name",
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
    description: "Remove memory/item by name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact name" },
      },
      required: ["name"],
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
        const embedding = await embed(query);
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
                  relations: result.relations.map((r) => ({
                    from: r.from,
                    relation: r.relation,
                    to: r.to,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      case "get": {
        const itemName = args?.name as string;
        const result = await graph.get(itemName);

        if (!result.memory && !result.item) {
          return {
            content: [
              { type: "text", text: `✗ Nothing found with name "${itemName}"` },
            ],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "forget": {
        const itemName = args?.name as string;
        const result = await graph.forget(itemName);

        if (!result.deletedMemory && !result.deletedItem) {
          return {
            content: [
              { type: "text", text: `✗ Nothing found with name "${itemName}"` },
            ],
          };
        }

        return {
          content: [{ type: "text", text: `✓ Removed "${itemName}"` }],
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
