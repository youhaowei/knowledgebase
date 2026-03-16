/**
 * MCP (Model Context Protocol) route handler for TanStack Start
 *
 * Uses the official MCP SDK with WebStandardStreamableHTTPServerTransport.
 * Creates one McpServer + transport per session (SDK requires 1:1 binding).
 * The server factory is shared with the embeddable export in src/mcp-server.ts.
 */

import { createFileRoute } from "@tanstack/react-router";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createKnowledgebaseMcpServer } from "@/mcp-server";

type Session = {
  transport: WebStandardStreamableHTTPServerTransport;
  server: ReturnType<typeof createKnowledgebaseMcpServer>;
};

const sessions = new Map<string, Session>();

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
  };
}

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const sessionId = request.headers.get("mcp-session-id");

  if (request.method === "GET" || request.method === "DELETE") {
    if (!sessionId || !sessions.has(sessionId)) {
      return withCors(new Response("Session not found", { status: 404 }));
    }
    const { transport } = sessions.get(sessionId)!;
    const response = await transport.handleRequest(request);
    if (request.method === "DELETE") {
      sessions.delete(sessionId);
    }
    return withCors(response);
  }

  // POST — route to existing session or create new one
  if (sessionId && sessions.has(sessionId)) {
    const { transport } = sessions.get(sessionId)!;
    return withCors(await transport.handleRequest(request));
  }

  // New session — register via callback since sessionId is set during handleRequest
  const mcpServer = createKnowledgebaseMcpServer();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { transport, server: mcpServer });
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  await mcpServer.connect(transport);
  return withCors(await transport.handleRequest(request));
}

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => handleMcpRequest(request),
      POST: async ({ request }) => handleMcpRequest(request),
      DELETE: async ({ request }) => handleMcpRequest(request),
      OPTIONS: async () => new Response(null, { headers: corsHeaders() }),
    },
  },
});
