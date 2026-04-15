# Knowledgebase

A personal knowledge graph that auto-extracts entities and facts from text, stores them with vector embeddings, and serves semantic search via three surfaces: a CLI (`kb`), MCP tools for Claude Code, and a web UI.

Filesystem-first by design (Spec Decision #1, #11): markdown files in `~/.kb/memories/{namespace}/{uuid}.md` are the source of truth. The graph database (LadybugDB by default, optional Neo4j) is a derived index that can be rebuilt from files at any time.

```
Input: "Alice prefers TypeScript over JavaScript"
       ↓
       kb add  →  writes markdown file (instant, <100ms)
       ↓
       background indexer (Phase 2 sweep)
       ├─→ extracts entities (Alice, TypeScript, JavaScript)
       ├─→ extracts edges (Alice --[prefers]--> TypeScript, sentiment +0.8)
       ├─→ embeds memory + edge facts
       └─→ writes to LadybugDB graph index
       ↓
       kb search  →  ripgrep + graph hybrid (works without server)
```

## Quick Start

```bash
bun install                 # install deps
bun link                    # makes the `kb` command global (optional)

bun run dev                 # TanStack Start dev server on port 8000
                            # serves web UI + MCP endpoint at /mcp + indexer

# In another terminal:
kb add "Bun is fast"        # write a memory (instant)
kb search "fast"            # search (file-only or hybrid if server is up)
kb stats                    # show counts
kb --help                   # full command list
```

The CLI works without a running server — file search via ripgrep keeps you productive even when the indexer is offline (Spec Decision #5, US-7).

## Commands

```bash
bun run dev                 # Dev server (port 8000) — UI + MCP + indexer
bun run db:reindex          # Rebuild graph from filesystem source of truth
bun run db:reembed          # Re-embed all memories + edges (after model change)
bun run db:backfill         # Embed only entries with zero-vector gaps
bun run db:reextract        # Re-extract edges from all memories

bun test                    # Unit tests (CLAUDE.md notes the bun-vs-bun-run nuance)
bun run lint                # ESLint
bun run kb <cmd>            # Local CLI invocation without `bun link`
bun run kb-test <cmd>       # CLI with --env test (isolated data)
```

## Architecture

```
CLI / MCP / Web  →  filesystem write  →  background indexer  →  LadybugDB
                    (~.kb/memories/)     (60s sweep)            (entities, edges, vectors)
```

- **Source of truth**: markdown files with YAML frontmatter (`id`, `name`, `tags`, `indexedAt`, etc.).
- **Derived index**: LadybugDB stores entities, edges, embeddings for semantic search and graph traversal.
- **Sync indicator**: frontmatter `indexedAt` timestamp — missing means the graph hasn't picked it up yet.
- **Reconciliation** (Phase 2): server sweep catches dropped FS events, re-indexes modified files, drains tombstone JSONLs.
- **Degraded mode** (Spec Decision #8): without server, `kb search` returns ripgrep + index-scan results with `signals.degraded: true`.

## Edge-as-Fact Model

Facts ARE edges between entities, with semantic relation types and sentiment:

```json
{
  "entities": [
    { "name": "DashFrame", "type": "project" },
    { "name": "Zustand", "type": "technology" }
  ],
  "edges": [
    { "relationType": "uses", "sourceIndex": 0, "targetIndex": 1,
      "fact": "DashFrame uses Zustand for state", "sentiment": 0 },
    { "relationType": "prefers", "sourceIndex": 0, "targetIndex": 1,
      "fact": "Chose Zustand over Redux for simpler API", "sentiment": 0.8 }
  ]
}
```

Sentiment lets queries surface preference: `"what state library do we use?"` ranks the `prefers` edge (+0.8) above the neutral `uses` edge.

## Configuration

All env vars are optional. Defaults shown make the project work offline.

| Variable | Default | Purpose |
|---|---|---|
| `KB_MEMORY_PATH` | `~/.kb/memories` | Memory filesystem root (Spec Decision #1). |
| `LADYBUG_DATA_PATH` | `~/.kb/ladybug` | Graph index location. `kb --env <name>` swaps to repo-local `./.ladybug-<name>` alongside `./.kb-<name>/memories`. |
| `EXTRACTION_MODEL` | `gemma4:e4b` | Ollama model for entity/edge extraction. |
| `EMBEDDING_MODEL` | `built-in` | `built-in` (Snowflake Arctic xs, 384-dim, in-process) or `ollama` (2560-dim, requires Ollama). |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL. |
| `NEO4J_URI` | unset | Opt-in: replaces LadybugDB with remote Neo4j. Requires `NEO4J_USER`, `NEO4J_PASSWORD`. |
| `KB_DISABLE_SERVER_INDEXER` | unset | Set to `"true"` to skip the 60s reconciliation sweep (tests, short-lived runs). |
| `CLAUDE_CODE_OAUTH_TOKEN` | unset | Optional: enables Claude/unifai extraction (otherwise Ollama is used). |

See `.env.example` for a copy-paste template.

## CLI Output Contract

`stdout` is human prose by default; `--json` switches to machine-readable. All progress and diagnostics go to `stderr` regardless. Every JSON command emits a payload with the same shape as the corresponding MCP response (Spec Decision #8 — `signals` object included on `search`).

## MCP Tools

- `add` — save a memory (instant write, background indexing).
- `search` — hybrid search; returns `{ memories, edges, entities, signals, guidance }`.
- `get` — exact lookup by name.
- `forget` — tombstone a memory file (Spec Decision #11; recoverable via `mv`).
- `forgetEdge` — invalidate an edge in-graph (server-side path applies immediately; CLI path queues for the Phase 2 reconciler).

## Storage Backends

- **LadybugDB** (default) — embedded graph DB at `~/.kb/ladybug/`, no setup required.
- **Neo4j** (opt-in) — remote Neo4j 5.x with vector indexes, activated by `NEO4J_URI`.

Both implementations satisfy the full `GraphProvider` interface (`src/lib/graph-provider.ts`); pick by setting environment variables, not flags.

## Tests

`bun run test` runs unit + provider + CLI tests in separate processes (CLAUDE.md notes why the bare `bun test` invocation can segfault with the lbug native addon). `bun run lint` runs ESLint.

## Phase Status

This branch ships **Instant KB Phase 1**: filesystem writes, hybrid search, signals contract, tombstone JSONLs. Phase 2 (server reconciler that drains tombstones and `_forget_edges.jsonl`) is on deck. Phase 3 (pi-ai extraction, parallel embeddings) and Phase 4 (dreaming, conflict resolution) are roadmap.
