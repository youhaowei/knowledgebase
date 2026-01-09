#!/usr/bin/env bun

/**
 * Standalone HTTP API Server - serves REST API + MCP endpoints
 *
 * NOTE: For development, prefer `bun run dev` which uses TanStack Start.
 * This server is for standalone API access without the frontend.
 *
 * Runs on http://localhost:8000
 * - /api/* - REST API endpoints
 * - /mcp - MCP protocol (JSON-RPC)
 * - /health - Health check
 */

import { Graph } from "./lib/graph.js";
import { Queue } from "./lib/queue.js";
import { embed } from "./lib/embedder.js";
import { randomUUID } from "crypto";
import type { ServerWebSocket } from "bun";
import type { Record as Neo4jRecord } from "neo4j-driver";

const PORT = parseInt(process.env.PORT ?? "8000");
const graph = new Graph();
const queue = new Queue(graph);

// Track WebSocket connections for broadcasting
const wsConnections = new Set<ServerWebSocket<unknown>>();

// CORS headers for all API requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

// Type guard for objects with string properties
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// MCP tool call handler
async function handleMCPToolCall(name: string, args: unknown) {
  try {
    const argsObj = isRecord(args) ? args : {};

    switch (name) {
      case "add": {
        const memory = {
          id: randomUUID(),
          name: (argsObj.name as string) ?? "",
          text: argsObj.text as string,
          summary: "",
          namespace: (argsObj.namespace as string) ?? "default",
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
        const query = argsObj.query as string;
        const limit = (argsObj.limit as number) ?? 10;
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
        const name = argsObj.name as string;
        const result = await graph.get(name);

        if (!result.memory && !result.item) {
          return {
            content: [
              { type: "text", text: `✗ Nothing found with name "${name}"` },
            ],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "forget": {
        const name = argsObj.name as string;
        const result = await graph.forget(name);

        if (!result.deletedMemory && !result.deletedItem) {
          return {
            content: [
              { type: "text", text: `✗ Nothing found with name "${name}"` },
            ],
          };
        }

        return {
          content: [{ type: "text", text: `✓ Removed "${name}"` }],
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

// ============================================================================
// REST API Handlers (replacing tRPC)
// ============================================================================

async function handleAdd(body: unknown) {
  const bodyObj = isRecord(body) ? body : {};
  const memory = {
    id: randomUUID(),
    name: (bodyObj.name as string) ?? "",
    text: bodyObj.text as string,
    summary: "",
    namespace: (bodyObj.namespace as string) ?? "default",
    createdAt: new Date(),
  };

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
}

async function handleSearch(query: string, limit = 10) {
  const embedding = await embed(query);
  const result = await graph.search(embedding, query, limit);

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
}

async function handleGet(name: string) {
  const result = await graph.get(name);

  if (!result.memory && !result.item) {
    throw new Error(`Nothing found with name "${name}"`);
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
}

async function handleForget(name: string) {
  const result = await graph.forget(name);

  if (!result.deletedMemory && !result.deletedItem) {
    throw new Error(`Nothing found with name "${name}"`);
  }

  const deleted = [];
  if (result.deletedMemory) deleted.push("memory");
  if (result.deletedItem) deleted.push("item");

  return {
    success: true,
    message: `Removed ${deleted.join(" and ")} "${name}" and its relations`,
    deletedMemory: result.deletedMemory,
    deletedItem: result.deletedItem,
  };
}

async function handleStats() {
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
}

async function handleGraph() {
  // @ts-expect-error - accessing private driver property for graph visualization
  const session = graph.driver.session();
  try {
    const nodesResult = await session.run(`
      MATCH (n)
      WHERE n:Memory OR n:Item
      RETURN
        labels(n) as labels,
        n.id as id,
        n.name as name,
        n.type as type,
        n.namespace as namespace
    `);

    const nodes = nodesResult.records.map((r: Neo4jRecord) => ({
      id: r.get("id") || r.get("name"),
      name: r.get("name"),
      type: r.get("labels")[0],
      itemType: r.get("type"),
      namespace: r.get("namespace") || "default",
    }));

    const edgesResult = await session.run(`
      MATCH (a)-[r:RELATION]->(b)
      RETURN
        a.name as source,
        b.name as target,
        r.type as relation,
        r.namespace as namespace
    `);

    const edges = edgesResult.records.map((r: Neo4jRecord) => ({
      source: r.get("source"),
      target: r.get("target"),
      relation: r.get("relation"),
      namespace: r.get("namespace") || "default",
    }));

    return { nodes, edges };
  } finally {
    await session.close();
  }
}

// ============================================================================
// Request Handlers
// ============================================================================

/**
 * Generate API documentation HTML
 */
function getApiDocumentation(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Knowledgebase API</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; }
    h1 { color: #333; }
    h2 { color: #666; margin-top: 32px; }
    .endpoint { margin: 20px 0; }
    .method { display: inline-block; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .get { background: #3b82f6; color: white; }
    .post { background: #10b981; color: white; }
  </style>
</head>
<body>
  <h1>Knowledgebase API</h1>
  <p>A personal knowledge graph with semantic search and conflict detection.</p>
  <p><strong>Note:</strong> For the full web interface, run <code>bun run dev</code> instead.</p>

  <h2>REST API Endpoints</h2>

  <div class="endpoint">
    <span class="method post">POST</span>
    <code>/api/add</code>
    <p>Save a new memory to the knowledge graph</p>
    <pre>curl -X POST http://localhost:${PORT}/api/add \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Alice prefers TypeScript","name":"optional name"}'</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <code>/api/search?query=...&limit=10</code>
    <p>Search using semantic similarity</p>
    <pre>curl "http://localhost:${PORT}/api/search?query=what+does+Alice+prefer"</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <code>/api/get?name=...</code>
    <p>Get memory or item by exact name</p>
    <pre>curl "http://localhost:${PORT}/api/get?name=Alice"</pre>
  </div>

  <div class="endpoint">
    <span class="method post">POST</span>
    <code>/api/forget</code>
    <p>Remove memory or item by name</p>
    <pre>curl -X POST http://localhost:${PORT}/api/forget \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Alice"}'</pre>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <code>/api/stats</code>
    <p>Get graph statistics</p>
  </div>

  <div class="endpoint">
    <span class="method get">GET</span>
    <code>/api/graph</code>
    <p>Get full graph data for visualization</p>
  </div>

  <h2>MCP Protocol</h2>
  <p>POST <code>/mcp</code> - JSON-RPC endpoint for MCP tools</p>

  <h2>Links</h2>
  <ul>
    <li><a href="/health">Health Check</a></li>
  </ul>
</body>
</html>
  `;
}

/**
 * Handle MCP JSON-RPC requests
 */
async function handleMCPRequest(request: Request): Promise<Response> {
  try {
    const body = await request.json();

    let result;
    if (body.method === "initialize") {
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "knowledgebase", version: "1.0.0" },
      };
    } else if (body.method === "tools/list") {
      result = { tools: MCP_TOOLS };
    } else if (body.method === "tools/call") {
      const { name, arguments: args } = body.params;
      result = await handleMCPToolCall(name, args);
    } else if (body.method === "ping") {
      result = {};
    } else {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32601, message: "Method not found" },
        },
        { headers: corsHeaders },
      );
    }

    return Response.json(
      { jsonrpc: "2.0", id: body.id, result },
      { headers: corsHeaders },
    );
  } catch (error) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : "Internal error",
        },
      },
      { headers: corsHeaders },
    );
  }
}

/**
 * Handle POST /api/add
 */
async function handleAddRequest(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const result = await handleAdd(body);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 400, headers: corsHeaders },
    );
  }
}

/**
 * Handle GET /api/search
 */
async function handleSearchRequest(url: URL): Promise<Response> {
  try {
    const query = url.searchParams.get("query") || "";
    const limit = parseInt(url.searchParams.get("limit") || "10");
    const result = await handleSearch(query, limit);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 400, headers: corsHeaders },
    );
  }
}

/**
 * Handle GET /api/get
 */
async function handleGetRequest(url: URL): Promise<Response> {
  try {
    const name = url.searchParams.get("name") || "";
    const result = await handleGet(name);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 400, headers: corsHeaders },
    );
  }
}

/**
 * Handle POST /api/forget
 */
async function handleForgetRequest(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const result = await handleForget(body.name);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error" },
      { status: 400, headers: corsHeaders },
    );
  }
}

/**
 * Handle GET /api/stats
 */
async function handleStatsRequest(): Promise<Response> {
  const result = await handleStats();
  return Response.json(result, { headers: corsHeaders });
}

/**
 * Handle GET /api/graph
 */
async function handleGraphRequest(): Promise<Response> {
  const result = await handleGraph();
  return Response.json(result, { headers: corsHeaders });
}

/**
 * Handle GET /api/queue
 */
function handleQueueRequest(): Response {
  return Response.json({ pending: queue.pending() }, { headers: corsHeaders });
}

/**
 * Handle GET /health
 */
function handleHealthRequest(): Response {
  return Response.json(
    {
      status: "ok",
      mode: "standalone-api",
      timestamp: new Date().toISOString(),
      queuePending: queue.pending(),
    },
    { headers: corsHeaders },
  );
}

/**
 * Handle WebSocket upgrade
 */
function handleWebSocketUpgrade(
  request: Request,
  server: ReturnType<typeof Bun.serve>,
): Response | undefined {
  const upgraded = server.upgrade(request);
  if (upgraded) return undefined;
  return new Response("WebSocket upgrade failed", { status: 400 });
}

// ============================================================================
// Server
// ============================================================================

const server = Bun.serve({
  port: PORT,

  development: {
    hmr: true,
    console: true,
  },

  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // MCP JSON-RPC endpoint
    if (
      (url.pathname === "/mcp" || url.pathname === "/mcp/") &&
      request.method === "POST"
    ) {
      return handleMCPRequest(request);
    }

    // REST API endpoints
    if (url.pathname === "/api/add" && request.method === "POST") {
      return handleAddRequest(request);
    }

    if (url.pathname === "/api/search") {
      return handleSearchRequest(url);
    }

    if (url.pathname === "/api/get") {
      return handleGetRequest(url);
    }

    if (url.pathname === "/api/forget" && request.method === "POST") {
      return handleForgetRequest(request);
    }

    if (url.pathname === "/api/stats") {
      return await handleStatsRequest();
    }

    if (url.pathname === "/api/graph") {
      return await handleGraphRequest();
    }

    if (url.pathname === "/api/queue") {
      return handleQueueRequest();
    }

    if (url.pathname === "/health") {
      return handleHealthRequest();
    }

    if (url.pathname === "/ws") {
      return handleWebSocketUpgrade(request, server);
    }

    // API documentation
    if (url.pathname === "/" || url.pathname === "/api") {
      return new Response(getApiDocumentation(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      wsConnections.add(ws);
      console.log("WebSocket connected. Total:", wsConnections.size);
    },
    message(ws, message) {
      console.log("WebSocket message:", message);
    },
    close(ws) {
      wsConnections.delete(ws);
      console.log("WebSocket disconnected. Total:", wsConnections.size);
    },
  },
});

console.log(`
┌─────────────────────────────────────────────────────────────┐
│  🧠 Knowledgebase Standalone API Server                     │
│  http://localhost:${PORT}                                        │
│                                                              │
│  REST API:                                                   │
│  - POST /api/add (add memory)                               │
│  - GET  /api/search?query=... (semantic search)             │
│  - GET  /api/get?name=... (get by name)                     │
│  - POST /api/forget (remove memory/item)                    │
│  - GET  /api/stats (graph statistics)                       │
│  - GET  /api/graph (visualization data)                     │
│                                                              │
│  MCP Protocol:                                               │
│  - POST /mcp (JSON-RPC)                                     │
│                                                              │
│  For full web interface: bun run dev                        │
└─────────────────────────────────────────────────────────────┘
`);
