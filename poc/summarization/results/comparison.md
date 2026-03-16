# Summarization POC: Side-by-Side Comparison

## errors.ts

### A: AST Skeleton

**Exports:**
- class NotSupportedError {  }

### B: LLM Summary

This file defines the `NotSupportedError` class, a custom error type specifically designed to signal when an operation is unavailable within LadybugDB mode. The primary responsibility of this export is to provide a clear, typed exception for unsupported methods by capturing the specific method name in its message. It extends the standard `Error` class and overrides the `name` property to ensure consistent error identification in debugging contexts. This design decision isolates mode-specific limitations into a dedicated error hierarchy rather than relying on generic error strings.

### C: Hybrid (AST→LLM)

This file defines a custom error class named `NotSupportedError` to handle scenarios where specific features or operations are not available. Its primary responsibility is to provide a standardized exception type for indicating unsupported functionality within the application. As a utility module, it serves as a foundational building block for error handling logic rather than managing complex business rules or configuration. Consumers of this file should import and throw `NotSupportedError` whenever they encounter an unimplemented feature or capability.

## queue.ts

### A: AST Skeleton

**Imports:** ./extractor.js, ./embedder.js, ./graph-provider.js, ../types.js, ./analytics.js

**Exports:**
- class Queue { async add(memory: Memory): Promise<void>; private async process(namespace: string): Promise<void>; pending(namespace?: string): number }

**Internal:**
- type QueueEntry = {
  memory: Memory;
  resolve: () => void;
  reject: (e: Error) => void;
};

### B: LLM Summary

This file implements the `Queue` class to asynchronously process incoming memories by extracting entities/edges via LLMs, generating dual embeddings with Ollama, and persisting data through a provided `GraphProvider`. It exposes an `add` method to enqueue memories (returning a completion promise) and a `pending` utility to track queue depth per namespace or globally. The implementation relies on imported modules like `extractor`, `embedder`, and `analytics` while enforcing sequential processing within each namespace using internal `Map` and `Set` structures to prevent race conditions. A key design decision is the separation of concerns where the class accepts a `GraphProvider` dependency, allowing flexibility between default implementations (LadybugDB) and optional backends like Neo4j.

### C: Hybrid (AST→LLM)

The `queue.ts` file serves as a central job scheduler that manages asynchronous tasks by queuing `Memory` objects for processing via external extractor and embedder services. Its primary public API exposes the `Queue` class, allowing consumers to add items with `add()`, check pending counts with `pending()`, while internally handling task execution through the private `process()` method. Architecturally, this module acts as a middleware orchestrator that decouples task submission from execution, leveraging dependency injection for analytics and graph providers to facilitate robust, observable workflows.

## ladybug-provider.ts

### A: AST Skeleton

**Imports:** lbug, crypto, os, path, fs, ../types.js, ./graph-provider.js, ./search-utils.js, ./embedder.js

**Exports:**
- class LadybugProvider { private async executeQuery(
    statement: string,
    params: Record<string, unknown> =; private zeroEmbeddingStr(dim: number): string; private getDimInfo(dim: number); private embeddingColumns(embeddings: EmbeddingMap): Record<string, string>; async ensureDimension(dim: number): Promise<void>; private escapeFtsQuery(query: string): string; private async tryQuery(query: string): Promise<void>; private async loadExtension(name: string): Promise<void>; async init(): Promise<void>; async close(): Promise<void>; private async ensureAllDimensions(memEmb: EmbeddingMap, edgeEmbs: EmbeddingMap[]); private buildMemoryEmbCols(embeddings: EmbeddingMap): string[]; async store(
    memory: Memory,
    entities: Entity[],
    edges: ExtractedEdge[],
    memoryEmbeddings: EmbeddingMap,
    edgeEmbeddings: EmbeddingMap[],
  ): Promise<void>; private async storeEdge(
    edge: ExtractedEdge,
    embeddings: EmbeddingMap,
    sourceEntity: Entity,
    targetEntity: Entity,
    memoryId: string,
    memoryNamespace: string,
  ): Promise<void>; private async updateExistingEdge(
    existing: Record<string, unknown>,
    edge: ExtractedEdge,
    sourceUuid: string,
    targetUuid: string,
    memoryId: string,
    embeddings: EmbeddingMap,
  ): Promise<void>; private async createNewEdge(
    edge: ExtractedEdge,
    edgeId: string,
    embeddings: EmbeddingMap,
    sourceUuid: string,
    targetUuid: string,
    memoryId: string,
    namespace: string,
    createdAt: string,
  ): Promise<void>; async search(
    embedding: number[],
    query: string,
    limit = 10,
  ): Promise<SearchResult>; async vectorSearch(
    embedding: number[],
    limit: number,
    filter?: MemoryFilter,
  ): Promise<Memory[]>; async vectorSearchEdges(
    embedding: number[],
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]>; async fullTextSearchEdges(
    query: string,
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]>; async get(name: string, namespace = "default"): Promise<GetResult>; private mapEdgeRows(rows: Record<string, unknown>[]): StoredEdge[]; async forget(name: string, namespace = "default"): Promise<ForgetResult>; async forgetEdge(
    edgeId: string,
    reason: string,
    namespace = "default",
  ): Promise<ForgetEdgeResult>; async storeMemoryOnly(memory: Memory): Promise<void>; async updateMemoryStatus(
    id: string,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string,
  ): Promise<void>; async getPendingMemories(namespace?: string, limit = 10): Promise<Memory[]>; async storeEntity(entity: StoredEntity): Promise<void>; async findEntities(
    filter: EntityFilter,
    limit = 100,
  ): Promise<StoredEntity[]>; async findEdges(filter: EdgeFilter, limit = 100): Promise<StoredEdge[]>; async findMemories(filter: MemoryFilter, limit = 100): Promise<Memory[]>; async stats(namespace?: string): Promise<Stats>; async listNamespaces(): Promise<string[]>; async deleteByNamespace(namespace: string): Promise<void>; async getGraphData(namespace?: string, nodeLimit?: number): Promise<GraphData>; async findMemoriesNeedingEmbedding(
    dimension: number,
  ): Promise<Memory[]>; async findEdgesNeedingEmbedding(
    dimension: number,
  ): Promise<Array<; async updateMemoryEmbeddings(
    memoryId: string,
    embeddings: EmbeddingMap,
  ): Promise<void>; async updateFactEmbeddings(
    factId: string,
    embeddings: EmbeddingMap,
  ): Promise<void>; async purgeDeleted(): Promise< }

### B: LLM Summary

This file implements the `LadybugProvider` class, which acts as a TypeScript adapter for the LadybugDB graph database to manage knowledge graphs involving Memories, Entities, and Facts. It exports core CRUD operations like `store`, `search`, `get`, and `forget`, alongside specialized methods for handling embeddings (`updateMemoryEmbeddings`, `updateFactEmbeddings`) and data lifecycle management (`purgeDeleted`). The implementation relies heavily on the `lbug` library's `Database` and `Connection` APIs, utilizing Cypher-like queries with dynamic column interpolation to support multi-dimensional vector embeddings. A key design decision is the use of a "delete + create" pattern for updating vector-indexed columns, as LadybugDB does not allow direct `SET` operations on indexed properties; it also employs soft deletes via `deletedAt` timestamps and implements RRF fusion for combining vector and full-text search results.

### C: Hybrid (AST→LLM)

The `ladybug-provider.ts` file serves as the core implementation of a graph-based data provider, responsible for managing entities, edges, and memories within a vectorized knowledge graph. Its public API exposes a comprehensive set of methods for storing and retrieving data via vector search, full-text search, and entity filtering, alongside utilities for managing memory states, embeddings, and namespaces. Architecturally, this module acts as the primary interface for interacting with the underlying database layer, handling complex operations like edge creation, graph data retrieval, and asynchronous query execution while delegating lower-level tasks to internal helper modules.

## Directory Rollup (L0/L1)

# D: Bottom-Up Directory Rollup

Generates L0 (abstract) and L1 (overview) for `src/lib/` from pre-computed file summaries.

### From B (LLM per-file)

**L0 Abstract** _(9868ms)_:
> Resilient knowledge infrastructure abstracting AI backends (Ollama/Gemini/transformers.js) and graph stores (Neo4j/LadybugDB) into a unified API for the "edge-as-fact" schema. The system orchestrates async ingestion via fire-and-forget queues, implements hybrid vector/text search with RRF fusion and intent boosting, and ensures stability through automatic fallbacks to local embeddings when primary services fail.

**L1 Overview** _(72734ms)_:

# src/lib/

## Purpose
This directory serves as the core infrastructure layer for the application's knowledge management and data processing pipeline. It abstracts complex interactions with external AI services (Ollama, Gemini, Claude), graph databases (Neo4j, LadybugDB), and local file systems into a unified, resilient API. The module implements a robust "edge-as-fact" graph schema, handling the full lifecycle of knowledge from ingestion and extraction to embedding generation and retrieval. A key architectural priority is stability through graceful degradation: if primary services like Ollama fail, the system automatically falls back to `transformers.js`, and all analytics are handled via fire-and-forget mechanisms to prevent application crashes during heavy processing loads.

## Key Components
*   **Graph Abstraction & Providers**: Centralizes database interactions by dynamically selecting between `Neo4jProvider` and `LadybugProvider` based on environment variables (`graph-provider.ts`). This layer manages the "edge-as-fact" schema, handling CRUD operations for Memories, Entities, and Facts while supporting hybrid vector/text search via RRF fusion.
*   **AI Orchestration & Extraction**: Manages the dynamic selection of LLM backends for knowledge extraction (`extractor.ts`) and text embedding (`embedder.ts`). It prioritizes local tools (Gemini CLI, Ollama) but seamlessly degrades to `transformers.js` fallbacks if primary sources are unavailable.
*   **Data Ingestion & Queue Management**: Orchestrates the asynchronous processing of incoming data through the `Queue` class (`queue.ts`), which coordinates extraction, embedding generation, and database persistence. It handles batch operations like memory initialization (`load-memories.ts`) and re-embedding/re-extraction scripts (`reembed.ts`, `reextract.ts`).
*   **Search & Intent Logic**: Implements semantic search capabilities including intent classification via regex heuristics (`intents.ts`) to boost specific relationship types (e.g., `uses` vs. `prefers`). It includes specialized utilities for retro-specific tasks like finding similar findings and recurring patterns (`retro-search.ts`).
*   **Analytics & Observability**: Provides a lightweight, fire-and-forget analytics system (`analytics.ts`) that tracks operation timing, success rates, and source context using `AsyncLocalStorage`. This ensures visibility into system performance without impacting the main execution flow.
*   **Error Handling & Utilities**: Defines custom error hierarchies for unsupported operations (`errors.ts`) and provides centralized utility functions for class merging (`utils.ts`) and database initialization scripts (`init-db.ts`, `fix-index.ts`).

## Data Flow
The data pipeline begins when a memory or fact is ingested, triggering the `Queue` to process it sequentially. The queue first invokes the `extractor`, which dynamically selects an LLM backend (Gemini CLI > Claude > others) to parse entities and relationships into a structured JSON schema. These extracted facts are then passed to the `embedder`, which attempts to generate embeddings via Ollama; if unavailable, it falls back to `transformers.js`. The resulting data is handed off to the `GraphProvider` (Neo4j or LadybugDB) for persistence using idempotent `MERGE` operations. When a search query arrives, the `operations` layer classifies its intent via regex, performs hybrid vector and full-text searches against the graph, merges results using the RRF algorithm (`search-utils.ts`), and finally boosts rankings based on the detected intent before returning the unified result set to the caller.

## Dependencies
*   **Database Drivers**: `neo4j-driver` (for Neo4j connectivity) and the `lbug` library (for LadybugDB interactions).
*   **AI & Embedding Libraries**: `transformers.js` (for fallback embeddings), `unifai` (for Claude API access), and local CLI tools (`gemini`, `ollama`) invoked via Bun's spawn API.
*   **Utility Libraries**: `clsx` and `tailwind-merge` (for CSS class manipulation), and standard Node/Bun globals like `AsyncLocalStorage`.
*   **External Systems**: Ollama service, Gemini CLI, and LadybugDB/Neo4j instances configured via environment variables (`NEO4J_URI`, etc.).

---

### From C (AST+LLM hybrid)

**L0 Abstract** _(8775ms)_:
> Bun-based orchestration layer integrating Neo4j graph persistence with dual-embedding pipelines (Ollama/Hugging Face fallbacks) and pluggable AI extractors (Gemini/Claude). The system manages full data lifecycles via async queues, intent classification for edge boosting, and resilient middleware that handles provider failures while fusing search results through RRF logic.

**L1 Overview** _(64321ms)_:

# src/lib/

## Purpose
This directory serves as the core orchestration and infrastructure layer for a knowledge graph application built on Bun, SQLite, and Neo4j. It abstracts complex backend operations—such as vector embeddings, semantic search, entity storage, and intent classification—into high-level APIs. The module manages the full lifecycle of data, from initializing the database and loading memories to executing background tasks like re-embedding and re-extracting data. It acts as a resilient middleware that handles provider failures (e.g., switching between Ollama and Hugging Face fallbacks) and integrates external AI services (Gemini, Claude) with internal graph logic to deliver consistent domain-specific insights.

## Key Components
*   **Graph Orchestration & Storage**: `operations.ts` acts as the main controller interface for CRUD actions on graph entities, delegating to `graph-provider.ts`, which aggregates logic from `neo4j-provider.ts` (persistence) and `ladybug-provider.ts` (vector search).
*   **AI Embedding Pipeline**: The embedding layer is managed by `embedder.ts` (primary Ollama adapter), supported by `fallback-embedder.ts` (Hugging Face resilience), and specialized re-processing logic in `reembed.ts`.
*   **Extraction & Intelligence**: Text processing is handled by the aggregator `extractor.ts`, which routes to specific adapters like `extractor-gemini.ts`. Semantic understanding is provided by `intents.ts` for classification and edge boosting.
*   **Data Loading & Maintenance**: Initialization tasks are handled by `init-db.ts` (Neo4j setup) and `load-memories.ts`. Background maintenance jobs, such as memory refreshing via `reextract.ts`, are queued and managed by `queue.ts`.
*   **Search & Analytics Utilities**: Search results are fused using `search-utils.ts` (RRF logic), while retrospective analysis is handled by `retro-search.ts`. System-wide analytics and event tracking are coordinated by `analytics.ts`.
*   **Error Handling & Helpers**: The module relies on `errors.ts` for standardized exceptions (`NotSupportedError`) and `utils.ts` for CSS class merging, with specialized index management in `fix-index.ts`.

## Data Flow
The application flow begins with initialization via `init-db.ts` to establish the Neo4j environment. When a user query arrives, `operations.ts` receives the request and routes it through `intents.ts` to classify the intent, which may trigger edge adjustments. The core logic delegates to `graph-provider.ts`, which handles storage and retrieval by interacting with `neo4j-provider.ts` for graph data and `embedder.ts` (or its fallback) for vectorization. If specific extraction is needed, `extractor.ts` orchestrates the call to model-specific adapters like `extractor-gemini.ts`. For complex workflows requiring multiple steps, tasks are submitted to `queue.ts`, which decouples submission from execution by leveraging injected providers and analytics hooks. Finally, search results generated by various backends are consolidated by `search-utils.ts` before being returned to the consumer, while `analytics.ts` logs the operation throughout this process.

## Dependencies
*   **Database Drivers**: `neo4j-driver` (for graph persistence), `bun:sqlite` (implied via analytics context).
*   **AI & Embedding Libraries**: `ollama` (primary embeddings), `huggingface`/`transformers` (fallback embeddings), `google-generativeai` (Gemini extraction), `anthropic` (Claude extraction - implied by extractor logic).
*   **Utility Libraries**: `clsx`, `tailwind-merge` (via `utils.ts`), `ladybug` (implied vector search capabilities).
*   **External Systems**: Ollama service, Hugging Face Inference API, Google Gemini API, Neo4j Graph Database.
