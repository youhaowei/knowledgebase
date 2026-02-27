# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Knowledgebase is a personal knowledge graph that auto-extracts entities and edges (facts as relationships) from text, stores them with vector embeddings, and provides semantic search. Three access methods: Web UI, MCP tools for Claude Code, and REST API.

## Commands

```bash
# Development
bun run dev              # TanStack Start dev server (port 8000, SSR + HMR + MCP)

# Database
bun run db:init          # Initialize Neo4j schema + indexes
bun run db:reembed       # Re-embed all memories (after model change)
bun run db:reextract     # Re-extract edges from all memories (after prompt change)

# Testing & Quality
bun test                 # Run unit tests (excludes CLI tests)
bun run test:cli         # Run CLI E2E tests (slow, requires Gemini)
bun run test:all         # Run all tests (unit + CLI, separate processes)
bun run lint             # ESLint check

# CLI
bun run kb <cmd>         # Knowledgebase CLI (add, search, get, forget, stats)
bun run kb-test <cmd>    # CLI with --env test (isolated data)
```

## Architecture

### Data Model: Edge-as-Fact (Graphiti-style)

Facts ARE edges between entities with semantic relation types. This enables:
- Semantic queries: "What do we use for state management?" → finds `uses` edges
- Sentiment tracking: -1 (rejected) to 1 (preferred) on each edge
- Temporal validity: `validAt` / `invalidAt` for time-aware knowledge

```
User text → Queue → Claude extraction → Ollama embeddings → GraphProvider storage
                    (entities, edges)    (2560-dim vectors)   (graph + vector + FTS index)
```

**Core Types:**
- **Entity** - Named things: "DashFrame", "Zustand", "Redux"
- **Edge (RELATES_TO)** - Facts as relationships: "DashFrame uses Zustand" (sentiment: 0.8)
- **Memory** - Source text that edges are extracted from

**Example extraction:**
```json
{
  "entities": [
    { "name": "DashFrame", "type": "project" },
    { "name": "Zustand", "type": "technology" },
    { "name": "Redux", "type": "technology" }
  ],
  "edges": [
    { "relationType": "uses", "sourceIndex": 0, "targetIndex": 1,
      "fact": "DashFrame uses Zustand for state management", "sentiment": 0 },
    { "relationType": "prefers", "sourceIndex": 0, "targetIndex": 1,
      "fact": "DashFrame chose Zustand over Redux for simpler API", "sentiment": 0.8 }
  ]
}
```

### Contradiction Handling

**Philosophy:** The KB stores data passively - it doesn't decide which facts are more valid.

- **At ingestion:** Store all edges, even contradictory ones
- **At retrieval:** MCP response includes `guidance` asking agent to seek user input
- **Resolution:** User/agent calls `forgetEdge(edgeId, reason)` → creates audit trail

### Key Design Decisions

1. **Edge-as-Fact model** - Facts are RELATES_TO edges with relationType, sentiment, and natural language description. Enables semantic queries.

2. **Sentiment scoring** - Each edge has -1 to 1 sentiment: rejected (-1), neutral (0), preferred (+1). Enables opinion-aware queries.

3. **Manual contradiction resolution** - KB stores, doesn't judge. Agents ask users to resolve conflicts. `forgetEdge` creates audit Memory.

4. **Index-based entity references** - Extraction outputs entities first (indexed 0,1,2), edges reference by index. Efficient for LLM output.

5. **Full-text search on edges** - LadybugDB uses separate `Fact` node table mirroring `RELATES_TO` edges, with FTS index on `text` property.

6. **Per-namespace queues** (`src/lib/queue.ts`) - Each namespace has its own processing queue to prevent race conditions.

7. **Zero API costs** - Uses unifai (Claude backend) with OAuth subscription for extraction, Ollama for local embeddings.

8. **Both backends are production** — Neo4j was the original backend; LadybugDB is the newer embedded alternative. Both must receive full feature implementations, not stubs.

### Storage Backend

Uses a `GraphProvider` interface (`src/lib/graph-provider.ts`) with two implementations:
- **LadybugProvider** (default) — Embedded graph DB at `.ladybug/`, uses `lbug` package
- **Neo4jProvider** (optional) — Remote Neo4j, activated by `NEO4J_URI` env var

`createGraphProvider()` picks the backend automatically based on environment.

### Core Files

| File | Purpose |
|------|---------|
| `src/types.ts` | Zod schemas (Entity, ExtractedEdge, StoredEdge, Memory, Extraction) |
| `src/lib/graph-provider.ts` | GraphProvider interface + factory |
| `src/lib/ladybug-provider.ts` | LadybugDB implementation (default) |
| `src/lib/neo4j-provider.ts` | Neo4j implementation (optional) |
| `src/lib/extractor.ts` | Claude/Gemini-powered entity/edge extraction |
| `src/lib/embedder.ts` | Ollama embedding generation (2560-dim) |
| `src/lib/queue.ts` | Async processing pipeline |
| `src/server/functions.ts` | TanStack server functions (type-safe API) |
| `src/routes/mcp.tsx` | MCP protocol endpoint for Claude Code |
| `src/web/components/Graph.tsx` | react-force-graph-2d visualization |

### Graph Model

**Node tables:**
- `Memory` — Source text + embedding + summary + status
- `Entity` — Named entities with type, description, scope (project/global)
- `Fact` — Mirrors RELATES_TO edges for FTS indexing (LadybugDB workaround)

**Relationships:**
- `(Entity)-[RELATES_TO {
    id, relationType, fact, sentiment, factEmbedding,
    episodes[], validAt, invalidAt, namespace, createdAt
  }]->(Entity)` — Facts as relationships

**Indexes:**
- `memory_vec_idx` — Vector index for semantic search (2560 dims, cosine)
- `fact_fts_idx` — Full-text index on Fact.text property

**Soft deletes:** All nodes use `deletedAt` property (empty string = active, ISO date = deleted).

### MCP Tools

- `add` - Save new memory (extracts entities + edges)
- `search` - Semantic search (returns memories, edges, entities, guidance)
- `get` - Exact lookup by name
- `forget` - Remove memory or entity by name
- `forgetEdge` - Invalidate edge with reason (creates audit trail)

## Code Conventions

- Use `@/*` path alias for imports (e.g., `import { Entity } from "@/types"`)
- All data structures validated with Zod schemas in `src/types.ts`
- Routes are file-based in `src/routes/` (auto-generates `routeTree.gen.ts`)
- UI components in `src/web/components/ui/` follow shadcn/ui patterns
- Design tokens documented in `DESIGN_SYSTEM.md` (neon cyber aesthetic)
- CLI stdout is for machine-readable output only. All diagnostics/progress → `console.error` (stderr)

## Bun-Specific

- Use `bun test` (not jest/vitest) - tests in `test/*.test.ts`
- Use `bun run <script>` (not npm/yarn/pnpm)
- Bun auto-loads `.env` - no dotenv needed
- Prefer `Bun.file()` over `fs.readFile()`
- LadybugDB (lbug) native addon: Bun segfaults on `close()` — skip explicit close in test teardown
- LadybugDB creates `.wal` files as siblings (e.g., `.ladybug-test.wal` alongside `.ladybug-test/`). Clean up both directory AND `.wal` file in test teardown
- Native addon tests (`provider.test.ts`) and CLI tests (`cli.test.ts`) must run in separate processes — `bun run test` handles this via explicit file listing and `&&` chaining. Bun's `--exclude` flag doesn't support multiple values in v1.3.5.

## Dependencies

- **Frontend**: React 19, TanStack Router/Start, Vite, Tailwind CSS v4
- **Backend**: Bun runtime, lbug (LadybugDB), neo4j-driver (optional), @modelcontextprotocol/sdk
- **AI**: unifai (Claude extraction), Ollama (embeddings)
- **Validation**: Zod
