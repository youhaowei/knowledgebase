# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Knowledgebase is a personal knowledge graph that auto-extracts entities and relations from text, stores them in Neo4j with vector embeddings, and provides semantic search. Three access methods: Web UI, MCP tools for Claude Code, and REST API.

## Commands

```bash
# Development
bun run dev              # TanStack Start dev server (port 8000, SSR + HMR)
bun run start:api        # Standalone API server (port 4000, REST + MCP)

# Database
bun run db:init          # Initialize Neo4j schema + vector index
bun run db:reembed       # Re-embed all memories (after model change)

# Testing & Quality
bun test                 # Run all tests
bun run lint             # ESLint check
```

## Architecture

### Data Flow
```
User text → Queue → Claude extraction → Ollama embeddings → Neo4j storage
                    (items, relations)   (768-dim vectors)   (graph + vector index)
```

### Key Design Decisions

1. **Read-time conflict detection** - Contradictions (e.g., "Alice prefers TypeScript" vs "Alice prefers Python") are detected when reading, not writing. This keeps writes fast and lets users resolve conflicts via UI.

2. **Per-namespace queues** (`src/lib/queue.ts`) - Each namespace has its own processing queue to prevent race conditions.

3. **Dual server modes**:
   - `bun run dev` - TanStack Start with SSR, file-based routing, server functions
   - `bun run start:api` - Standalone Bun server for production (REST + MCP endpoints)

4. **Zero API costs** - Uses Claude Agent SDK with OAuth subscription for extraction, Ollama for local embeddings.

### Core Files

| File | Purpose |
|------|---------|
| `src/lib/extractor.ts` | Claude-powered entity/relation extraction |
| `src/lib/embedder.ts` | Ollama embedding generation |
| `src/lib/graph.ts` | Neo4j operations + conflict detection |
| `src/lib/queue.ts` | Async processing pipeline |
| `src/types.ts` | Zod schemas (Item, Relation, Memory, Extraction) |
| `src/server/functions.ts` | TanStack server functions (type-safe API) |
| `src/api-server.ts` | Standalone HTTP/MCP server |
| `src/web/components/Graph.tsx` | Vega force-directed visualization |

### Neo4j Model

- **Nodes**: `Memory` (text + embedding + summary), `Item` (extracted entities)
- **Relationships**: `RELATION` (labeled directed edges between items)
- **Vector Index**: `memory_embedding` for semantic search (768 dims, cosine)

## Code Conventions

- Use `@/*` path alias for imports (e.g., `import { Item } from "@/types"`)
- All data structures validated with Zod schemas in `src/types.ts`
- Routes are file-based in `src/routes/` (auto-generates `routeTree.gen.ts`)
- UI components in `src/web/components/ui/` follow shadcn/ui patterns
- Design tokens documented in `DESIGN_SYSTEM.md` (neon cyber aesthetic)

## Bun-Specific

- Use `bun test` (not jest/vitest) - tests in `test/*.test.ts`
- Use `bun run <script>` (not npm/yarn/pnpm)
- Bun auto-loads `.env` - no dotenv needed
- Prefer `Bun.file()` over `fs.readFile()`

## Dependencies

- **Frontend**: React 19, TanStack Router/Start, Vite, Tailwind CSS v4, Vega
- **Backend**: Bun runtime, neo4j-driver, @modelcontextprotocol/sdk
- **AI**: @anthropic-ai/claude-agent-sdk (extraction), Ollama (embeddings)
- **Validation**: Zod
