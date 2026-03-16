# H: Edge Cases

## cli.ts — very-large (12K+ lines)

_391 lines, 12239 chars_

### AST Skeleton
_884 chars (7.2% of original)_

```
**Internal:**
- interface ParsedArgs { flags: Record<string, string>;; positional: string[]; }
- class UsageError {  }
- function parseArgs(argv: string[]): ParsedArgs
- interface CmdContext { positional: string[];; flags: Record<string, string>;; json: boolean;; namespace: string; }
- function ctxFrom(args: ParsedArgs, defaults?: Partial<ParsedArgs>): CmdContext
- function out(ctx: CmdContext, data: unknown)
- function formatEdge(e:
- function formatEntity(e:
- async function handleAdd(ctx: CmdContext)
- async function handleSearch(ctx: CmdContext)
- async function handleGet(ctx: CmdContext)
- async function handleForget(ctx: CmdContext)
- async function handleForgetEdge(ctx: CmdContext)
- async function handleStats(ctx: CmdContext)
- async function handleAnalytics(ctx: CmdContext)
- function showHelp()
- async function runCommand(ctx: CmdContext)
- async function repl()
```

### Hybrid (AST→LLM) _(10073ms)_

The `cli.ts` file serves as the entry point for a command-line interface, parsing arguments via `parseArgs` and constructing execution contexts using `ctxFrom`. It defines core error handling with the `UsageError` class and utility functions like `out` for output formatting and `showHelp` for displaying usage instructions. The module implements specific async handlers for graph operations including `handleAdd`, `handleSearch`, `handleGet`, `handleForget`, and analytics via `handleAnalytics`. Finally, it orchestrates execution through `runCommand` and provides an interactive shell via the `repl` function.

### Full LLM _(29518ms)_

The `cli.ts` file serves as the entry point for the Knowledgebase CLI, providing commands like `add`, `search`, `get`, `forget`, `forget-edge`, `stats`, and `analytics` to interact with the underlying graph system. It implements a custom argument parser that handles flags such as `--namespace`, `--json`, and `--since` before dynamically importing operations from `./lib/operations.js` and analytics modules, ensuring environment variables like `LADYBUG_DATA_PATH` are set prior to singleton initialization. The file defines helper functions for formatting output (`formatEdge`, `formatEntity`) and manages both single-command execution via `runCommand` and an interactive REPL mode through the `repl` function. Notable patterns include the use of `UsageError` exceptions instead of direct process exits, conditional JSON logging based on the `--json` flag, and a dispatch switch statement that routes commands to specific async handlers while optionally wrapping non-analytic operations in an `analyticsContext`.

## errors.ts — very-small (6 lines)

_7 lines, 181 chars_

### AST Skeleton
_43 chars (23.8% of original)_

```
**Exports:**
- class NotSupportedError {  }
```

### Hybrid (AST→LLM) _(6137ms)_

The `errors.ts` file defines a single custom exception class named `NotSupportedError`. This class is exported to handle scenarios where specific features or operations are not supported by the system. As the only export in this module, it provides a dedicated error type for signaling unsupported functionality rather than relying on generic errors. The implementation currently contains no additional properties or methods beyond its class declaration.

### Full LLM _(8512ms)_

The `errors.ts` file defines a custom exception class named `NotSupportedError` that extends the standard `Error` class. This class is specifically designed to handle scenarios where a requested method is unavailable in LadybugDB mode, as indicated by its constructor message. The implementation captures the unsupported `method` name in the error message and explicitly sets the error's `name` property to "NotSupportedError" for consistent identification. It serves as a dedicated export for gracefully signaling unsupported operations within the application's logic.

### Notes
- Very small file — skeleton may be as large as source

## routeTree.gen.ts — generated code

_105 lines, 2807 chars_

### AST Skeleton
_1402 chars (49.9% of original)_

```
**Imports:** ./routes/__root, ./routes/mcp, ./routes/health, ./routes/index, ./router.tsx, @tanstack/react-start

**Exports:**
- const routeTree

**Types:**
- interface FileRoutesByFullPath { '/': typeof IndexRoute; '/health': typeof HealthRoute; '/mcp': typeof McpRoute }
- interface FileRoutesByTo { '/': typeof IndexRoute; '/health': typeof HealthRoute; '/mcp': typeof McpRoute }
- interface FileRoutesById { __root__: typeof rootRouteImport; '/': typeof IndexRoute; '/health': typeof HealthRoute; '/mcp': typeof McpRoute }
- interface FileRouteTypes { fileRoutesByFullPath: FileRoutesByFullPath; fullPaths: '/' | '/health' | '/mcp'; fileRoutesByTo: FileRoutesByTo; to: '/' | '/health' | '/mcp'; id: '__root__' | '/' | '/health' | '/mcp'; fileRoutesById: FileRoutesById }
- interface RootRouteChildren { IndexRoute: typeof IndexRoute; HealthRoute: typeof HealthRoute; McpRoute: typeof McpRoute }

**Internal:**
- interface FileRoutesByPath { '/mcp': {
      id: '/mcp'
      path: '/mcp'
      fullPath: '/mcp'
      preLoaderRoute: typeof McpRouteImport
      p...; '/health': {
      id: '/health'
      path: '/health'
      fullPath: '/health'
      preLoaderRoute: typeof HealthRout...; '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute... }
- interface Register { ssr: true; router: Awaited<ReturnType<typeof getRouter>> }
```

### Hybrid (AST→LLM) _(12748ms)_

The `routeTree.gen.ts` file serves as a generated route tree for the application, exporting a single `routeTree` constant that defines the routing structure. It explicitly maps three primary routes—`/`, `/health`, and `/mcp`—linking them to their respective components: `IndexRoute`, `HealthRoute`, and `McpRoute`. The file utilizes TanStack Start's router system to define interfaces like `FileRoutesByFullPath` and `RootRouteChildren`, which organize route metadata by path, ID, and parent relationships. Additionally, it exports a `Register` interface that configures server-side rendering (SSR) settings and provides the necessary router instance for application initialization.

### Full LLM _(15740ms)_

This automatically generated file, `routeTree.gen.ts`, defines the routing structure for a TanStack Router application by exporting a central `routeTree` object that aggregates three specific routes: `/`, `/health`, and `/mcp`. It establishes type-safe interfaces such as `FileRoutesByFullPath`, `FileRoutesById`, and `RootRouteChildren` to map route identifiers, paths, and their corresponding parent relationships. The file also extends the `@tanstack/react-start` module to register server-side rendering (SSR) capabilities by declaring `ssr: true` and linking the router instance from `./router.tsx`. Notable patterns include the use of `update()` methods to configure route metadata like IDs and paths, alongside strict TypeScript declarations that prevent manual modifications to ensure consistency with future code generation.

### Notes
- Generated file — should these be summarized?

## lbug.d.ts — type definitions (.d.ts)

_36 lines, 857 chars_

### AST Skeleton
_455 chars (53.1% of original)_

```
**Exports:**
- class Database { close(): Promise<void>; }
- class Connection { init(): Promise<void>;; query(; prepare(cypher: string): Promise<PreparedStatement>;; execute(; close(): Promise<void>; }

**Types:**
- interface QueryResult { hasNext(): Promise<boolean>;; getNext(): Promise<Row>;; getAll(): Promise<Row[]>; }
- interface PreparedStatement { isSuccess(): boolean;; getErrorMessage(): string; }

**Internal:**
- type Row = Record<string, any>;
```

### Hybrid (AST→LLM) _(13894ms)_

The `lbug.d.ts` file defines the TypeScript interfaces for a lightweight database client library named "lbug," exposing core classes like `Database` and `Connection` alongside utility types such as `QueryResult` and `PreparedStatement`. The `Database` class manages high-level operations including initialization via `init()` and resource cleanup through `close()`, while the `Connection` class handles specific query execution using methods like `query()` for raw commands and `prepare()` for parameterized statements. Data handling is standardized through the `Row` type, which represents records as generic objects, and the `QueryResult` interface provides asynchronous iteration capabilities via `hasNext()`, `getNext()`, and `getAll()` to retrieve database rows. Error management is centralized within the `PreparedStatement` interface, offering direct access to execution status via `isSuccess()` and detailed diagnostics through `getErrorMessage()`.

### Full LLM _(12220ms)_

The `lbug` module defines a TypeScript API for interacting with a database, exporting core classes like `Database` and `Connection` along with utility types such as `Row`, `QueryResult`, and `PreparedStatement`. The `Database` class manages the connection lifecycle via its constructor accepting a path and a `close()` method, while the `Connection` class handles initialization, Cypher query execution, and prepared statement management. Key methods include `query()` for executing raw Cypher queries with parameters and `prepare()` to create reusable statements that return objects exposing success status and error messages. The `QueryResult` interface provides asynchronous iteration capabilities through `hasNext()`, `getNext()`, and `getAll()` to retrieve rows as generic records.

### Notes
- Type-only file — AST captures everything

## CommandPalette.tsx — large React/TSX component

_647 lines, 24880 chars_

### AST Skeleton
_609 chars (2.4% of original)_

```
**Imports:** react, lucide-react, @/server/functions, ./DetailPanel

**Exports:**
- function CommandPalette(

**Internal:**
- type ResultType = "memory" | "edge" | "entity" | "llm";
- interface SearchResult { id: string;; type: ResultType;; title: string;; subtitle?: string;; meta?: string;; name?: string;; edgeData?: {
    sourceEntity: string;
    targetEntity: string;
    relationType: string;
    fact: string;
    sentime... }
- function sentimentLabel(s: number)
- function mapSearchResults(result:
- type PaletteMode = "search" | "add";
- interface CommandPaletteProps { onRefreshData: () => void; }
```

### Hybrid (AST→LLM) _(10235ms)_

The `CommandPalette.tsx` component serves as a unified search and command interface, leveraging Lucide icons and server functions to display results categorized by memory, edge, entity, or LLM types. It defines a `SearchResult` interface that structures complex data including graph relations (source/target entities) and sentiment analysis, while exposing a `CommandPalette` function that switches between "search" and "add" modes. The component utilizes helper utilities like `sentimentLabel` to process numerical sentiment scores and `mapSearchResults` to transform raw server data into the UI-ready format required by the application's detail panel integration.

### Full LLM _(38827ms)_

The `CommandPalette` component implements a Spotlight-style unified search and add interface accessible via `Cmd+K`, managing two distinct modes: searching for existing data and adding new memories. It exports the main `CommandPalette` function, which integrates with server utilities like `searchMemories`, `addMemory`, and `askLLM` to handle queries across memories, edges, entities, and LLM responses. The component features a debounced search mechanism that falls back to an AI-generated answer when no direct matches are found, alongside keyboard navigation support for arrow keys and Enter. Notable patterns include the use of `useCallback` for performance-critical handlers like `openPalette` and `handleSearch`, dynamic icon rendering based on result types (`memory`, `edge`, `entity`, `llm`), and a responsive floating trigger bar with a backdrop blur effect.

### Notes
- JSX file — AST misses template structure

## vite-env.d.ts — tiny type shim

_10 lines, 182 chars_

### AST Skeleton
_12 chars (6.6% of original)_

```
(empty file)
```

### Hybrid (AST→LLM) _(6922ms)_

The provided source file `vite-env.d.ts` is currently empty and contains no declarations, exports, or logic. As a result, it does not define any types for Vite-specific globals like `import.meta.env` or expose any utilities to the codebase. This file serves as a placeholder that would typically be used to augment TypeScript's type definitions for the Vite environment but has not yet been populated with its intended content.

### Full LLM _(9133ms)_

This file, `vite-env.d.ts`, serves as a TypeScript declaration file specifically for the Vite bundler to handle CSS imports with the `?url` suffix. It declares that importing any `.css?url` module results in a default export containing the resolved URL string rather than the raw CSS content. By referencing `vite/client` at the top, it ensures compatibility with Vite's built-in type definitions for other asset types like images and fonts. This pattern allows developers to dynamically import stylesheets and access their file paths within TypeScript code without encountering type errors.

### Notes
- Type-only file — AST captures everything
