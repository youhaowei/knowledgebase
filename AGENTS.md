# AGENTS.md

Instructions for AI coding agents working in this repository.

## Quick Reference

```bash
# Development
bun run dev                    # Start dev server (port 8000)
bun run build                  # Production build

# Testing
bun test                       # Run all tests
bun test test/types.test.ts    # Run single test file
bun test --grep "pattern"      # Run tests matching pattern

# Quality
bun run lint                   # ESLint check

# Database
bun run db:init                # Initialize Neo4j schema
bun run db:reembed             # Re-embed all memories
bun run db:reextract           # Re-extract edges from memories
```

## Critical: Bun Only

This project uses **Bun exclusively**. Never use Node.js, npm, yarn, pnpm, or npx.

| Do NOT use      | Use instead   |
| --------------- | ------------- |
| `node file.ts`  | `bun file.ts` |
| `npm install`   | `bun install` |
| `npm run dev`   | `bun run dev` |
| `npx <pkg>`     | `bunx <pkg>`  |
| `jest`/`vitest` | `bun test`    |

## Project Structure

```
src/
  types.ts              # Zod schemas - Entity, Edge, Memory, Extraction
  lib/
    graph.ts            # Neo4j operations (store, search, get, forget)
    queue.ts            # Async processing with Neo4j persistence
    operations.ts       # Business operations layer
    extractor.ts        # Claude entity/edge extraction
    embedder.ts         # Ollama embedding generation
  routes/               # TanStack file-based routes (auto-generates routeTree.gen.ts)
    mcp.tsx             # MCP protocol endpoint
  server/
    functions.ts        # TanStack server functions (type-safe API)
  web/
    components/         # React components
      ui/               # shadcn/ui components
test/
  *.test.ts             # Bun test files
```

## Code Style

### TypeScript & Types

All data structures use Zod schemas with inferred types:

```typescript
// Define schema
export const Entity = z.object({
  uuid: z.string().optional(),
  name: z.string(),
  type: EntityType,
});

// Export inferred type (same name as schema)
export type Entity = z.infer<typeof Entity>;
```

- Use Zod schemas for all data validation
- Prefer `z.infer<typeof Schema>` over manual interface definitions
- Enable `strictNullChecks` - handle null/undefined explicitly

### Imports

Use the `@/*` path alias for all internal imports:

```typescript
// External imports first
import { z } from "zod";
import neo4j from "neo4j-driver";

// Internal imports with @/ alias
import { Entity, Memory } from "@/types";
import { createKnowledgebaseMcpServer } from "@/mcp-server";
```

### Formatting

- **Indentation:** 2 spaces
- **Quotes:** Double quotes for strings
- **Semicolons:** Always use semicolons
- **Trailing commas:** Yes, in multiline constructs

### Naming Conventions

| Type              | Convention | Example                            |
| ----------------- | ---------- | ---------------------------------- |
| Files (utilities) | kebab-case | `init-db.ts`, `migrate-scoping.ts` |
| Files (React)     | PascalCase | `CommandPalette.tsx`               |
| Functions         | camelCase  | `searchMemories`, `handleAddTool`  |
| Components        | PascalCase | `function CommandPalette()`        |
| Constants         | UPPER_CASE | `OLLAMA_URL`, `MODEL`              |
| Variables         | camelCase  | `memoryEmbedding`, `edgeResult`    |

### Error Handling

```typescript
try {
  await someOperation();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Operation failed:", message);
}
```

### Async Patterns

- Always use `async/await` (no raw promises)
- Use `Promise.all()` for parallel operations
- Clean up resources with `try/finally`:

```typescript
const session = graph.getSession();
try {
  await session.executeWrite(async (tx) => {
    /* ... */
  });
} finally {
  await session.close();
}
```

## Testing

Tests use Bun's built-in test runner:

```typescript
import { test, expect, describe } from "bun:test";

describe("Feature", () => {
  test("should do something", () => {
    expect(true).toBe(true);
  });

  test("async operation", async () => {
    const result = await someAsyncFunction();
    expect(result).toBeDefined();
  });
});
```

- Tests live in `test/*.test.ts`
- Use descriptive test names in sentence form
- Group related tests with `describe` blocks
- Tests can gracefully skip when external dependencies (Ollama) are unavailable

## Lint Rules

ESLint with typescript-eslint and sonarjs plugins. Key rules:

- **Avoid lint suppressions** - Fix issues instead of using `eslint-disable`
- **No @ts-ignore** - Fix type errors properly
- If suppression is necessary, use specific rules with explanation comments

## React & UI

- React 19 with functional components only
- TanStack Router for file-based routing
- Tailwind CSS v4 for styling
- shadcn/ui patterns for components
- Use `cn()` utility for conditional classNames:

```typescript
import { cn } from "@/lib/utils";

<div className={cn("base-class", isActive && "active-class")} />
```

## Key Files to Know

| File                    | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `src/types.ts`          | All Zod schemas - start here for data structures |
| `src/lib/graph.ts`      | Neo4j operations - the main data layer           |
| `src/lib/operations.ts` | Business logic for search, add, forget           |
| `src/routes/mcp.tsx`    | MCP protocol endpoint for Claude Code            |
| `CLAUDE.md`             | Full architecture documentation                  |
| `DESIGN_SYSTEM.md`      | UI design tokens and visual style                |

## Environment

- Bun auto-loads `.env` files - no dotenv needed
- Prefer `Bun.file()` over `fs.readFile()`
- Neo4j connection via `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`

## Before Completing Work

1. Run `bun run lint` to check for issues
2. Run `bun test` if you modified tested code
3. Ensure no lint suppression comments were added unnecessarily
