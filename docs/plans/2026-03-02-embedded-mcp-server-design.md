# Embedded MCP Server for Knowledgebase (TASK-206)

**Date**: 2026-03-02
**Status**: Implemented

## Problem

Workforce (desktop agentic orchestrator) needs knowledgebase as a built-in context engine. KB was a standalone app only — no way to import it as a library.

## Design Decisions

1. **Library first, MCP second** — operations.ts is the primary API, MCP wraps it for agent tool access
2. **No getContext()** — agents use `search` for focused retrieval; CLAUDE.md handles static preferences
3. **KB = storage + retrieval; Workforce = intelligence** — extraction can use Workforce's own agents
4. **Shared LadybugDB** — single source of truth across standalone KB and Workforce
5. **SDK-native MCP** — uses `McpServer` from `@modelcontextprotocol/sdk`, not hand-rolled JSON-RPC

## Package Exports

```
"knowledgebase/operations" → addMemory, search, getByName, forget, forgetEdge, stats
"knowledgebase/mcp"        → createKnowledgebaseMcpServer()
"knowledgebase/types"      → Entity, Memory, StoredEdge, etc.
```

## Consumer Patterns

**Agent tools (MCP):**
```typescript
import { createKnowledgebaseMcpServer } from "knowledgebase/mcp"
const server = createKnowledgebaseMcpServer()
await server.connect(transport)
```

**Server-side hooks (direct):**
```typescript
import { addMemory, search } from "knowledgebase/operations"
await addMemory(text, name, namespace)
```

## Files Changed

- `src/mcp-server.ts` — NEW: McpServer factory with 5 tool registrations
- `src/operations.ts` — NEW: Public re-export of operations API
- `src/routes/mcp.tsx` — MODIFIED: SDK transport replaces hand-rolled JSON-RPC
- `package.json` — MODIFIED: Added exports field
- `src/lib/graph.ts` — DELETED: Legacy Neo4j-only class
