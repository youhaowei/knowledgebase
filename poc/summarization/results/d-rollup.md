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
