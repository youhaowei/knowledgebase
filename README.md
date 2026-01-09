# 🧠 Knowledgebase

**A personal knowledge graph that remembers everything.** Accessible via Claude Code (MCP), beautiful web interface, or type-safe API.

```
Input: "Alice prefers TypeScript over JavaScript"
  ↓
  [Auto-extract with Claude] → Items: Alice, TypeScript, JavaScript
  ↓                             Relations: Alice → prefers → TypeScript
  [Embed with Ollama] → Vector: [0.234, -0.512, ...] (768 dims)
  ↓
  [Store in Neo4j] → Graph + Vector Index
  ↓
Search: "what does Alice like?" → Semantic results + Conflict detection
```

## ✨ Features

- **Zero API Costs** - Claude via subscription OAuth, Ollama local embeddings
- **Auto-Extraction** - Entities, relations, summaries extracted automatically
- **Semantic Search** - Find by meaning, not just keywords
- **Conflict Detection** - Detects contradictions, asks you to resolve
- **3 Access Methods** - MCP tools, Web UI, or tRPC API
- **Graph Storage** - Neo4j for relations + vector search

## 🚀 Quick Start (5 minutes)

### 1. Install

```bash
bun install
```

### 2. Start Services

**Neo4j:**

```bash
docker run -d --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:latest

# Create vector index
docker exec -it neo4j cypher-shell -u neo4j -p password << 'EOF'
CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
FOR (m:Memory) ON (m.embedding)
OPTIONS {indexConfig: {
  `vector.dimensions`: 768,
  `vector.similarity_function`: 'cosine'
}};
EOF
```

**Ollama:**

```bash
ollama pull qwen3-embedding:4b
```

**Claude (for MCP only):**

```bash
claude setup-token
```

### 3. Configure

```bash
cp .env.example .env
# Add your CLAUDE_CODE_OAUTH_TOKEN (only needed for MCP)
```

### 4. Run

**Web Interface** (Recommended):

```bash
bun run api
```

→ Open **http://localhost:4000** 🎉

**MCP Server** (for Claude Code):

```bash
bun start
```

## 📱 Access Methods

### 1. Web Interface (Svelte + Tailwind)

Visit **http://localhost:4000** after running `bun run api`

**Features:**

- ➕ **Add Memory** - Paste text, auto-extracts entities & relations
- 🔍 **Search** - Semantic search with visual results
- 🕸️ **Graph View** - Explore items and their relations
- ⚠️ **Conflict Detection** - Visual warnings for contradictions

![Web Interface](https://placehold.co/800x400?text=Screenshot+Coming+Soon)

### 2. MCP Tools (Claude Code)

Add to `~/.config/claude/config.json`:

```json
{
  "mcpServers": {
    "knowledgebase": {
      "command": "bun",
      "args": ["run", "/path/to/knowledgebase/src/server.ts"]
    }
  }
}
```

**Usage:**

```
add "Alice prefers TypeScript over JavaScript"
search "what does Alice prefer"
get "Alice"
forget "Alice"
```

### 3. tRPC API (Type-Safe)

**TypeScript Client:**

```typescript
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "./src/api/router";

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "http://localhost:4000/trpc" })],
});

// Add memory
await client.add.mutate({
  text: "Bob works on the DashFrame project",
});

// Search
const results = await client.search.query({
  query: "who works on DashFrame?",
});
```

**cURL (REST):**

```bash
# Add
curl -X POST http://localhost:4000/trpc/add \
  -H "Content-Type: application/json" \
  -d '{"text":"Alice prefers TypeScript"}'

# Search
curl "http://localhost:4000/trpc/search?input={\"query\":\"Alice\"}"
```

**Endpoints:** http://localhost:4000/trpc/\* | Docs: http://localhost:4000/api

## 🏗️ How It Works

### Data Model

| Type         | Description             | Example                                     |
| ------------ | ----------------------- | ------------------------------------------- |
| **Memory**   | Original text you saved | "Alice prefers TypeScript over JavaScript"  |
| **Item**     | Extracted entities      | `Alice` (person), `TypeScript` (technology) |
| **Relation** | How items connect       | `Alice → prefers → TypeScript`              |

### Item Types

- `person` - Alice, Bob, "the client"
- `project` - DashFrame, "the dashboard"
- `technology` - React, TypeScript, Neo4j
- `concept` - "microservices", "event sourcing"
- `preference` - "dark mode", "TypeScript over JS"
- `decision` - "use Neo4j for storage"

### Relation Types

- `uses`, `works_on`, `prefers`, `avoids`, `decided`, `knows`, `created`, `depends_on`, `related_to`

### Conflict Handling

**Conflicts detected at READ time, not write time:**

```
✅ Write: "Alice prefers TypeScript" (2024-01-01)
✅ Write: "Alice prefers Python" (2024-01-02)

❌ Read: get("Alice")
→ ⚠️  Conflict: Alice → prefers → [TypeScript, Python]
→ User resolves: keep newer | keep older | keep both | neither
→ Decision stored, no re-asking
```

## 🎨 Design System

See **[DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)** for comprehensive documentation on:
- Color palette & neon cyber aesthetic
- Typography scale & font usage
- Component patterns & animations
- Accessibility guidelines
- Code style conventions

## 🛠️ Tech Stack

| Component  | Technology                      | Why                                       |
| ---------- | ------------------------------- | ----------------------------------------- |
| Runtime    | **Bun**                         | Fast, native TypeScript, built-in bundler |
| Web UI     | **React + TanStack Router + Tailwind** | Type-safe routing, modern React patterns |
| API        | **tRPC**                        | End-to-end type safety                    |
| Graph Viz  | **Vega**                        | Declarative force-directed layouts        |
| MCP        | `@modelcontextprotocol/sdk`     | Claude Code integration                   |
| Extraction | **Claude Agent SDK**            | OAuth subscription (no API costs)         |
| Embeddings | **Ollama** `qwen3-embedding:4b` | Local, fast, free (768 dims)              |
| Storage    | **Neo4j**                       | Graph + vector search in one DB           |
| Validation | **Zod**                         | Runtime type safety                       |

## 📁 Project Structure

```
knowledgebase/
├── src/
│   ├── server.ts           # MCP server (4 tools)
│   ├── types.ts            # Zod schemas
│   ├── api/
│   │   ├── router.ts       # tRPC router (5 procedures)
│   │   └── server.ts       # HTTP server (Bun.serve)
│   └── lib/
│       ├── extractor.ts    # Claude extraction
│       ├── embedder.ts     # Ollama embeddings
│       ├── graph.ts        # Neo4j + conflict detection
│       └── queue.ts        # Async processing
├── web/
│   ├── index.html          # Entry point
│   ├── App.svelte          # Main component
│   ├── styles.css          # Tailwind
│   └── components/
│       ├── AddMemory.svelte
│       ├── Search.svelte
│       └── Graph.svelte
├── test/
│   ├── types.test.ts
│   └── embedder.test.ts
└── examples/
    └── client.ts           # tRPC usage example
```

## 🧪 Development

```bash
# Run tests
bun test

# MCP server (auto-restart on changes)
bun run dev

# API server (hot reload)
bun run api

# Type check
bun run tsc --noEmit
```

## 🔧 Configuration

**Environment Variables** (`.env`):

```bash
# Claude OAuth (for MCP only)
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...

# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# Ollama
OLLAMA_URL=http://localhost:11434
EMBEDDING_MODEL=qwen3-embedding:4b

# API Server
API_PORT=4000
```

## 📊 Example Workflow

1. **Add Knowledge:**

   ```
   add "Alice prefers TypeScript over JavaScript"
   add "Bob works on the DashFrame project"
   add "DashFrame uses React and TypeScript"
   ```

2. **Search Semantically:**

   ```
   search "what languages does Alice like?"
   → Memory: "Alice prefers TypeScript over JavaScript"
   → Relation: Alice → prefers → TypeScript
   ```

3. **Explore Graph:**

   ```
   get "DashFrame"
   → Item: DashFrame (project)
   → Relations:
     - Bob → works_on → DashFrame
     - DashFrame → uses → React
     - DashFrame → uses → TypeScript
   ```

4. **Handle Conflicts:**

   ```
   add "Alice prefers Python for data science"

   get "Alice"
   → ⚠️  Conflict detected!
   → Alice → prefers → [TypeScript, Python]
   → Options:
     - TypeScript (2024-01-01)
     - Python (2024-01-02)
   → (User resolves in web UI or via API)
   ```

## 🐛 Troubleshooting

### Neo4j Connection Failed

```bash
docker ps                    # Check if running
docker logs neo4j            # View logs
docker restart neo4j         # Restart
```

### Ollama Model Not Found

```bash
ollama list                  # Check models
ollama pull qwen3-embedding:4b
```

### Web Interface Not Loading

```bash
curl http://localhost:4000/health
lsof -i :4000                # Check port conflicts
API_PORT=4001 bun run api    # Try different port
```

### Claude Extraction Fails

```bash
echo $CLAUDE_CODE_OAUTH_TOKEN
claude setup-token           # Regenerate
```

## 🤝 Contributing

Issues and PRs welcome! Please:

1. Run `bun test` before submitting
2. Follow existing code style
3. Add tests for new features

## 📄 License

MIT

## 🔗 Links

- [Claude Code](https://claude.ai/code)
- [MCP Documentation](https://modelcontextprotocol.io)
- [tRPC](https://trpc.io)
- [Svelte](https://svelte.dev)
- [Bun](https://bun.sh)
- [Neo4j](https://neo4j.com)
- [Ollama](https://ollama.ai)

---

**Built with ❤️ using Bun, Svelte, tRPC, and Neo4j**

Enjoy your personal knowledge graph! 🧠✨
