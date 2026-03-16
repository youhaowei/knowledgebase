# G: Prompt Variations

## errors.ts (7 lines)

### terse
_(3206ms, 175 chars output)_

This file defines a `NotSupportedError` class that throws when specific methods are unavailable in LadybugDB mode, ensuring graceful error handling for unsupported operations.

### structured
_(4675ms, 269 chars output)_

**Purpose:** Defines a custom error class for when specific methods are unavailable in LadybugDB mode.
**Key API:** NotSupportedError, constructor
**Dependencies:** Error (built-in)
**Pattern:** Custom exception subclassing to enforce mode-specific method restrictions.

### contextual
_(6287ms, 455 chars output)_

You would need this file when your application attempts to use a database method that conflicts with the specific constraints of LadybugDB mode. This `NotSupportedError` class provides a clear, typed way to catch and handle situations where a requested operation is explicitly disabled in that environment. Reading it helps you understand how the system gracefully rejects unsupported features rather than failing silently or with a generic error message.

## queue.ts (151 lines)

### terse
_(10063ms, 380 chars output)_

This async queue processor manages per-namespace memory ingestion by sequentially extracting entities/edges via LLMs, generating dual-mode embeddings for both memories and edge facts, and persisting data to a graph database. It handles concurrent requests through namespace isolation to prevent race conditions while automatically deriving memory names from summaries when absent.

### structured
_(12684ms, 495 chars output)_

**Purpose:** Asynchronously processes incoming memories by extracting entities/edges, generating embeddings, and storing them in a graph database while preventing race conditions via per-namespace queues.
**Key API:** `add`, `pending`
**Dependencies:** `./extractor.js`, `./embedder.js`, `./graph-provider.js`, `../types.js`, `./analytics.js`
**Pattern:** Per-namespace sequential processing queue that manages asynchronous tasks with promise-based resolution/rejection and performance tracking.

### contextual
_(13761ms, 713 chars output)_

You would need this file when your application needs to handle asynchronous ingestion of memories without blocking the main thread or causing race conditions between different namespaces. This file orchestrates the entire background processing pipeline, which extracts entities and edges using an LLM, generates dual embeddings for both the memory text and individual edge facts via Ollama, and finally persists everything to your graph database. It specifically solves the problem of managing a backlog of incoming data by queuing items per namespace and processing them sequentially to ensure stability while providing callbacks so you can track when each specific memory has been successfully stored or failed.

## embedder.ts (186 lines)

### terse
_(11662ms, 383 chars output)_

This dual-mode embedder prioritizes Ollama (configurable via `EMBEDDING_MODEL`) for vector generation while gracefully falling back to HuggingFace transformers.js when unavailable. It exposes `embed()`, `embedDual()`, and `getActiveDimension()` to support single-source or simultaneous multi-dimension ingestion, with dimensions dynamically detected at runtime rather than hardcoded.

### structured
_(13274ms, 485 chars output)_

**Purpose:** Generates text vector embeddings by prioritizing Ollama and falling back to HuggingFace transformers.js if unavailable.
**Key API:** embed, embedWithDimension, embedDual, checkOllama, checkAnyEmbedder, getActiveDimension, isZeroEmbedding
**Dependencies:** fetch (via Node.js built-in), ./fallback-embedder.js, ../types.js
**Pattern:** Implements a primary-secondary fallback architecture with runtime dimension detection and concurrent dual-source embedding for ingestion.

### contextual
_(13881ms, 655 chars output)_

You need this file whenever your application processes text into vectors for search or retrieval, as it orchestrates a resilient strategy that prioritizes Ollama but automatically falls back to `transformers.js` if the local server is down. It solves the problem of inconsistent vector dimensions by dynamically detecting the model's output size at runtime and providing utility functions to check which embedding source is currently active. Additionally, its dual-generation logic allows you to populate multiple vector indexes simultaneously during data ingestion, ensuring your system remains functional even if one backend service becomes unavailable.

## operations.ts (206 lines)

### terse
_(14006ms, 559 chars output)_

This module orchestrates business operations like semantic search and memory management by combining a singleton GraphProvider with a processing queue to handle deduplication and namespace filtering. It exports high-level functions such as `addMemory`, `search`, and `forget` that utilize intent classification and edge boosting while gracefully handling native addon limitations by skipping explicit provider closure. A notable design decision is the use of a CONTAINS query with post-filtering to mitigate prefix collision issues during memory name lookups.

### structured
_(16877ms, 661 chars output)_

**Purpose:** This file serves as the business operations layer that combines a GraphProvider with logic for managing memories, performing semantic searches, and handling entity lookups or deletion.
**Key API:** addMemory, search, getByName, forget, forgetEdge, stats, listNamespaces, getGraphData, close, getQueueStatus, getProvider, getQueue
**Dependencies:** ./graph-provider.js, ./queue.js, ./embedder.js, crypto/randomUUID, ../types.js, ./intents.js, ./analytics.js
**Pattern:** The module utilizes a lazy-initialized singleton provider pattern with an internal processing queue to deduplicate and buffer high-volume memory operations before executing them.

### contextual
_(14258ms, 629 chars output)_

You need this file when you want to perform high-level business operations like adding new memories, searching for information across namespaces, or deleting outdated entities without worrying about the underlying graph implementation details. This module handles complex logic such as deduplicating entries by name, classifying search intents to boost relevant edges, and managing a processing queue to prevent system overload. You will find utility functions here that abstract away provider initialization, namespace filtering, and error handling for common tasks like forgetting specific edges or retrieving graph statistics.

## ladybug-provider.ts (1380 lines)

### terse
_(39066ms, 438 chars output)_

LadybugProvider serves as a dual-mode graph database interface supporting 2560-dim primary and 384-dim fallback embeddings via LadybugDB, exporting Memory/Entity/Fact nodes with vector-indexed edges and full-text search results. A key design decision is its use of `delete+create` instead of `MERGE` for updating vector-indexed properties to maintain index integrity, alongside automatic schema migration for multi-dimensional embeddings.

### structured
_(42175ms, 594 chars output)_

**Purpose:** Implements a graph database provider that manages memory, entities, and fact relationships using vector embeddings, full-text search, and RRF fusion for retrieval.
**Key API:** store, search, get, forget, init, close, ensureDimension, updateFactEmbeddings
**Dependencies:** lbug (Database, Connection), crypto (randomUUID), os (homedir), path (join, dirname), fs (mkdirSync)
**Pattern:** Adapter pattern wrapping a native graph database client with custom schema migrations, multi-dimensional embedding support, and hybrid search combining vector similarity with full-text ranking.

### contextual
_(38524ms, 520 chars output)_

You need this file when you are implementing the core data persistence logic for your application, specifically to handle the creation and management of a knowledge graph containing `Memory`, `Entity`, and `Fact` nodes. This file solves the problem of storing structured data with multi-dimensional embeddings by automatically initializing the underlying database schema, creating vector indexes for semantic search, and handling the complex logic required to upsert edges while managing versioning via episode tracking.

## Metrics Summary

| File | Prompt | Time (ms) | Output (chars) |
|------|--------|-----------|----------------|
| errors.ts | terse | 3206 | 175 |
| errors.ts | structured | 4675 | 269 |
| errors.ts | contextual | 6287 | 455 |
| queue.ts | terse | 10063 | 380 |
| queue.ts | structured | 12684 | 495 |
| queue.ts | contextual | 13761 | 713 |
| embedder.ts | terse | 11662 | 383 |
| embedder.ts | structured | 13274 | 485 |
| embedder.ts | contextual | 13881 | 655 |
| operations.ts | terse | 14006 | 559 |
| operations.ts | structured | 16877 | 661 |
| operations.ts | contextual | 14258 | 629 |
| ladybug-provider.ts | terse | 39066 | 438 |
| ladybug-provider.ts | structured | 42175 | 594 |
| ladybug-provider.ts | contextual | 38524 | 520 |

**Averages per prompt style:**

- **terse**: 15601ms avg, 387 chars avg output
- **structured**: 17937ms avg, 501 chars avg output
- **contextual**: 17342ms avg, 594 chars avg output