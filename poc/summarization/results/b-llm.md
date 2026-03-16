# B: LLM Per-File Summary


## analytics.ts

_206 lines, 6142 input chars, 21254ms_

This file implements a lightweight, fire-and-forget analytics system using Bun's SQLite to track usage events like operation timing, success/failure status, and source context without risking application stability. Key exports include the `track()` function for manual event logging, the `tracked()` wrapper for automatic instrumentation of async functions with metadata extraction, and several query helpers like `getOperationSummary` and `getSourceBreakdown` for aggregating data by operation or source. The implementation relies on `AsyncLocalStorage` to capture execution context (e.g., distinguishing between "mcp", "cli", or "web" sources) without altering function signatures, while using a singleton pattern guarded by a global `db` variable to ensure database initialization only occurs once. Design decisions prioritize resilience through silent error handling in the catch blocks of both `track()` and `queryDb()`, alongside lazy database initialization via `getDb()` that defers connection costs until the first event is recorded.

## embedder.ts

_186 lines, 5188 input chars, 16066ms_

This file orchestrates text embedding generation by prioritizing Ollama as the primary source while automatically falling back to `transformers.js` via `embedFallback` if Ollama is unavailable. It exports core functions like `embed`, `embedWithDimension`, and `embedDual` to handle single-source requests, dimension-aware responses, or dual-index ingestion strategies respectively. The module manages runtime state through global variables (`ollamaAvailable`, `ollamaDim`) to detect model dimensions dynamically and handle connection failures gracefully. A key design decision is the use of `Promise.all` in `embedDual` to fetch embeddings from both sources concurrently, ensuring robustness during database backfill operations.

## errors.ts

_7 lines, 181 input chars, 7703ms_

This file defines the `NotSupportedError` class, a custom error type specifically designed to signal when an operation is unavailable within LadybugDB mode. The primary responsibility of this export is to provide a clear, typed exception for unsupported methods by capturing the specific method name in its message. It extends the standard `Error` class and overrides the `name` property to ensure consistent error identification in debugging contexts. This design decision isolates mode-specific limitations into a dedicated error hierarchy rather than relying on generic error strings.

## extractor-gemini.ts

_127 lines, 3751 input chars, 14853ms_

This file implements the `extractWithGemini` function, which orchestrates structured knowledge extraction by invoking the local `gemini` CLI in headless sandbox mode using Bun's spawn API. It relies on shared prompts from `./extractor.js` and strictly enforces JSON-only output via a custom instruction appended to the prompt. The implementation includes robust error handling for CLI failures and malformed responses, featuring utility functions like `parseGeminiCliOutput`, `stripMarkdownCodeBlock`, and `extractJsonObject` to sanitize raw text before parsing. A key design decision is the use of an "Edge-as-Fact" model strategy, where entities are extracted first followed by relationship edges, validated against the `Extraction` type from `../types.js`.

## extractor.ts

_241 lines, 9363 input chars, 24168ms_

This file serves as the central orchestration layer for extracting structured knowledge from text using an Edge-as-Fact graph model. Its primary responsibility is to dynamically select and invoke LLM backends—prioritizing the free `gemini` CLI when available, falling back to `claude` via the `unifai` library, or respecting explicit `EXTRACTOR_BACKEND` environment overrides. Key exports include the main `extract` function for automatic backend selection, along with `extractionSchema` and `extractionPrompt` which define the JSON schema and detailed instructions sent to the models. The implementation enforces a specific extraction pattern where entities are indexed 0, 1, 2... and relationships are defined as triples containing a `relationType`, sentiment score, confidence level, and validity dates. Notable design decisions include caching the availability check for the Gemini CLI to avoid repeated system calls and using `Bun.spawn` for lightweight process execution rather than heavy external dependencies.

## fallback-embedder.ts

_91 lines, 2778 input chars, 14025ms_

This file implements a zero-dependency fallback embedding strategy using HuggingFace's `transformers.js` library with the Snowflake Arctic model when the primary Ollama service is unavailable. It exports utility functions including `getFallbackDim()` to retrieve the detected vector dimension, `isFallbackAvailable()` to check readiness, and `embedFallback()` to generate normalized 384-dimensional embeddings from text. The implementation relies on a singleton pattern via `ensurePipeline()` to lazily load the `FeatureExtractionPipeline` while preventing duplicate initialization attempts through guarded state flags like `initPromise`. A key design decision is the graceful degradation strategy where failed model loads or embedding generation silently return `null` or empty arrays after logging warnings, ensuring system stability without hard failures.

## fix-index.ts

_43 lines, 1048 input chars, 12351ms_

This file serves as a migration script to repair Neo4j vector indexes by dropping an existing definition and recreating it with the correct 2560 dimensions required for the `qwen3-embedding:4b` model. It exposes no public exports, functioning instead as an internal utility that initializes a session using environment variables or defaults for the URI, user, and password. The script relies on the `neo4j-driver` package to execute Cypher queries that drop the `memory_embedding` index if it exists and then establishes a new one with cosine similarity. A key design decision is the use of a `try/finally` block to ensure the database session and driver are always closed, preventing resource leaks regardless of whether the migration succeeds or fails.

## graph-provider.ts

_171 lines, 3906 input chars, 15574ms_

This file defines the `GraphProvider` interface and a factory function that abstracts graph storage operations, dynamically selecting between `Neo4jProvider` and `LadybugProvider` based on the `NEO4J_URI` environment variable. It exports core result interfaces like `SearchResult` and `GetResult`, alongside utility types such as `GraphData` for visualization and `Stats` for metrics. The implementation supports a full lifecycle of knowledge management, including storing memories and edges via `store()`, performing hybrid searches with `vectorSearch()` and `fullTextSearchEdges()`, and managing embeddings through dedicated update methods like `updateMemoryEmbeddings`. Key design decisions include the use of an optional `purgeDeleted` method for cleanup and specific handling of zero-embedding dimensions to preserve existing data integrity.

## init-db.ts

_126 lines, 4033 input chars, 15128ms_

This file serves as an idempotent initialization script for a Neo4j database implementing an "edge-as-fact" knowledge graph schema. It exports the `initDatabase` function, which orchestrates the creation of uniqueness constraints (e.g., `memory_id`, `entity_name_namespace`) and performance indexes across Memory nodes, Entity nodes, and `RELATES_TO` relationships. The script leverages the Neo4j driver to define specific vector indexes for 2560-dimensional embeddings using cosine similarity and a full-text index on relationship properties for semantic search capabilities. A key design decision is the separation of concerns where constraints ensure data integrity while distinct indexes optimize lookups by namespace, name, and fact content without relying on unsupported vector indexing on relationships.

## intents.ts

_131 lines, 3456 input chars, 20431ms_

This file implements intent-aware retrieval by classifying search queries into `factual`, `decision`, or `general` categories using pure regex heuristics without LLM calls. It exports two primary functions: `classifyIntent`, which iterates through ordered pattern sets to detect query semantics, and `boostEdgesByIntent`, which re-ranks search results by prioritizing specific relation types like `uses` for factual queries or `prefers` for decision queries. The code relies on predefined constants `FACTUAL_RELATION_TYPES` and `DECISION_RELATION_TYPES` to map intent categories to their relevant graph edges, ensuring that only matching relations are boosted while preserving original order for non-matching cases. A key design decision is the strict ordering of pattern checks, where specific "decision" patterns are evaluated before broader "factual" ones to prevent misclassification, and sentiment magnitude is used as a secondary sort key exclusively for decision intents.

## ladybug-provider.ts

_1380 lines, 50437 input chars, 89058ms_

This file implements the `LadybugProvider` class, which acts as a TypeScript adapter for the LadybugDB graph database to manage knowledge graphs involving Memories, Entities, and Facts. It exports core CRUD operations like `store`, `search`, `get`, and `forget`, alongside specialized methods for handling embeddings (`updateMemoryEmbeddings`, `updateFactEmbeddings`) and data lifecycle management (`purgeDeleted`). The implementation relies heavily on the `lbug` library's `Database` and `Connection` APIs, utilizing Cypher-like queries with dynamic column interpolation to support multi-dimensional vector embeddings. A key design decision is the use of a "delete + create" pattern for updating vector-indexed columns, as LadybugDB does not allow direct `SET` operations on indexed properties; it also employs soft deletes via `deletedAt` timestamps and implements RRF fusion for combining vector and full-text search results.

## load-memories.ts

_47 lines, 1241 input chars, 10087ms_

This file orchestrates the initialization of a knowledgebase by reading `memories.json` and sequentially adding each entry via the `addMemory` operation from `./operations.js`. It defines a `MemoryEntry` interface to structure data containing a required `namespace`, `text`, and optional `name` field. The script iterates through loaded memories, logging progress and handling errors individually for each addition while queuing successful entries with their returned IDs. A key design decision is the use of synchronous file reading (`Bun.file`) combined with asynchronous processing to ensure all memories are queued before reporting completion.

## neo4j-provider.ts

_1619 lines, 51554 input chars, 72527ms_

This file implements `Neo4jProvider`, a TypeScript class that acts as the primary interface for interacting with a Neo4j graph database to store and retrieve knowledge graphs. It manages `Memory` nodes, `Entity` nodes, and `RELATES_TO` relationships, handling operations like storing embeddings via dynamic Cypher queries, performing hybrid vector/text searches using `rrfFuse`, and managing entity scopes (project vs. global). Key exports include the main `Neo4jProvider` class which exposes methods such as `store`, `search`, `get`, `forget`, and `findEdges`, alongside utility methods for updating embeddings and migrating entities to a global scope. The implementation relies heavily on the `neo4j-driver` package for connection management and utilizes custom dimension registration logic to support multiple embedding dimensions (e.g., 2560, 384) with backward compatibility. Notable design decisions include the use of `MERGE`/`ON CREATE SET` patterns for idempotent writes, dynamic construction of Cypher `SET` clauses to handle variable embedding lengths, and a robust error handling strategy that ensures sessions are always closed in `finally` blocks.

## operations.ts

_206 lines, 6485 input chars, 17569ms_

This file serves as the primary business operations layer, orchestrating high-level interactions with a knowledge graph by combining `GraphProvider` capabilities with semantic search and queue management logic. It exports core functions including `addMemory` for deduplicated memory ingestion, `search` for intent-classified vector queries, and `forget`/`forgetEdge` for entity cleanup with audit trails. The implementation relies heavily on a lazy-initialized singleton pattern via `getProvider()` to manage the underlying graph instance and a `Queue` for asynchronous processing. Notable design decisions include post-filtering search results by namespace (since the provider lacks native scoping) and wrapping all operations in `tracked` analytics hooks that normalize return values while preserving detailed internal metrics.

## queue.ts

_151 lines, 5149 input chars, 16042ms_

This file implements the `Queue` class to asynchronously process incoming memories by extracting entities/edges via LLMs, generating dual embeddings with Ollama, and persisting data through a provided `GraphProvider`. It exposes an `add` method to enqueue memories (returning a completion promise) and a `pending` utility to track queue depth per namespace or globally. The implementation relies on imported modules like `extractor`, `embedder`, and `analytics` while enforcing sequential processing within each namespace using internal `Map` and `Set` structures to prevent race conditions. A key design decision is the separation of concerns where the class accepts a `GraphProvider` dependency, allowing flexibility between default implementations (LadybugDB) and optional backends like Neo4j.

## reembed.ts

_162 lines, 5152 input chars, 15263ms_

This file orchestrates the re-embedding of all stored memories and edge facts using a dynamic, backend-agnostic approach via `createGraphProvider()`. It exports no public functions but defines internal utilities like `reembedMemories`, `reembedEdges`, and `dedupeById` to handle batch processing with progress tracking and error resilience. The script leverages `embedDual` for generating embeddings while supporting a `--backfill` flag to selectively update only missing dimensions detected by `getRegisteredDimensions()`. A key design decision is the separation of full re-embedding from gap-filling logic, ensuring efficient resource usage when Ollama or fallback embedders are available.

## reextract.ts

_117 lines, 3616 input chars, 13478ms_

This file orchestrates the re-extraction of knowledge graph entities and edges from stored memories, specifically designed to update the graph structure when extraction prompts change. It exports no public functions but relies on internal logic that imports `extract` for parsing text, `embedDual` for generating dual embeddings of facts, and `createGraphProvider` for backend-agnostic storage operations. The implementation uses a robust error-handling loop to process memories sequentially while tracking success/failure counts and aggregate statistics for entities and edges. A key design decision is the use of MERGE operations via the provider to upsert data without deleting stale entities, ensuring that orphaned nodes from previous extractions do not cause harm.

## retro-search.ts

_51 lines, 1812 input chars, 14164ms_

This file provides retro-specific search utilities built on top of the shared `operations` layer, focusing on similarity matching and recurring pattern detection within the "retro" namespace. It exports two primary functions: `findSimilarFindings`, which leverages the RRF-based vector + FTS search to locate existing memories similar to a given text for deduplication, and `findRecurringPatterns`, which identifies insights extracted from multiple findings by filtering edges that reference at least a specified number of memory episodes. The implementation relies on the `search` and `getProvider` helpers from `./operations.js` alongside custom types like `Memory` and `StoredEdge`. A key design decision is the current client-side filtering strategy for pattern detection, which is optimized for small scales but explicitly noted as a candidate for future Cypher-level optimization if the edge count exceeds ~1000.

## search-utils.ts

_39 lines, 1154 input chars, 12188ms_

This file implements the Reciprocal Rank Fusion (RRF) algorithm to merge ranked lists of search results from vector and full-text sources into a single unified ranking. Its primary export, `rrfFuse`, accepts two arrays of `StoredEdge` objects (`vectorResults` and `ftsResults`) along with a result limit and an optional constant `K`. The function utilizes a `Map` to accumulate scores calculated as $1/(K + \text{rank})$ for each edge found in either list, prioritizing items appearing in both sources. Notably, it defaults `K` to 60, adhering to the standard established by Cormack et al. (2009) and adopted by major search engines like Elasticsearch.

## utils.ts

_15 lines, 310 input chars, 8219ms_

This file serves as a centralized utility module for managing and merging Tailwind CSS class names, specifically tailored for use within shadcn/ui components. It exports a single `cn` function that combines the `clsx` library for conditional class handling with `twMerge` to ensure proper CSS specificity precedence. The implementation relies entirely on external dependencies `clsx` and `tailwind-merge`, avoiding any internal state or complex logic. This design decision isolates class manipulation concerns into a reusable, dependency-driven helper that prevents style conflicts across the application.


---
**Totals:** 20 files, 167415 input chars, 430148ms (21507ms avg)