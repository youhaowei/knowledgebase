# C: AST + LLM Hybrid


## analytics.ts

_206 lines, skeleton 774 chars (13% of 6142), 9820ms_

The `analytics.ts` file serves as the central orchestration module for a Bun-based SQLite analytics system, managing database connections and event tracking across multiple sources like MCP, CLI, and web. Its primary public API allows consumers to track operations via the `track` function, execute raw SQL queries through `queryDb`, and retrieve aggregated insights using helper functions such as `getOperationSummary` and `getSourceBreakdown`. Architecturally, this module acts as a dedicated analytics provider that initializes contexts with `analyticsContext`, configures storage paths, and handles lifecycle events like closing the connection or resetting the environment.

## embedder.ts

_186 lines, skeleton 704 chars (14% of 5188), 9813ms_

The `embedder.ts` file serves as the central orchestration layer for generating text embeddings, managing logic to switch between a primary Ollama provider and a fallback mechanism. Its public API exposes high-level asynchronous functions like `embed`, `embedWithDimension`, and `embedDual` that abstract away the underlying source selection, while also providing utility methods to inspect active dimensions and verify embedder availability. Architecturally, this module acts as an intelligent adapter or factory that ensures consistent embedding output regardless of whether the request is handled by Ollama or a fallback service, with types defining the result structure and available sources.

## errors.ts

_7 lines, skeleton 43 chars (24% of 181), 7058ms_

This file defines a custom error class named `NotSupportedError` to handle scenarios where specific features or operations are not available. Its primary responsibility is to provide a standardized exception type for indicating unsupported functionality within the application. As a utility module, it serves as a foundational building block for error handling logic rather than managing complex business rules or configuration. Consumers of this file should import and throw `NotSupportedError` whenever they encounter an unimplemented feature or capability.

## extractor-gemini.ts

_127 lines, skeleton 401 chars (11% of 3751), 9031ms_

The `extractor-gemini.ts` file serves as a specialized adapter that bridges the core extraction logic with Google's Gemini AI model. Its primary responsibility is to handle raw text responses from Gemini, parsing them into structured JSON data while managing markdown formatting and session metadata. The public API exposes a single asynchronous function, `extractWithGemini`, which consumers use to submit text and receive parsed extraction results. Architecturally, this module acts as a provider or adapter layer that encapsulates model-specific interactions like output parsing and response cleaning within the broader extraction system.

## extractor.ts

_241 lines, skeleton 311 chars (3% of 9363), 11104ms_

The `extractor.ts` file serves as a central orchestration module responsible for processing text inputs and generating structured extraction results using various AI models. Its primary public API, the `extract` function, acts as a unified entry point that intelligently routes requests to available providers like Gemini or Claude based on runtime availability checks. Internally, it manages model-specific logic through dedicated handlers such as `extractWithClaude` and availability detection via `isGeminiAvailable`, while leveraging external prompts and type definitions to maintain consistency across different AI backends. Architecturally, this file functions as a provider aggregator that abstracts away the complexity of multiple LLM integrations, offering a stable interface for consumers regardless of which underlying model is active.

## fallback-embedder.ts

_91 lines, skeleton 383 chars (14% of 2778), 8917ms_

The `fallback-embedder.ts` file serves as a utility module that manages fallback embedding logic using the Hugging Face Transformers library. Its primary public API allows consumers to check for model availability via `isFallbackAvailable`, retrieve the embedding dimension with `getFallbackDim`, and generate embeddings from text using `embedFallback`. Internally, it handles the lazy loading and lifecycle management of a feature extraction pipeline through private helper functions. Architecturally, this module acts as a resilient fallback mechanism, ensuring embedding operations can proceed even when primary models are unavailable or fail to load.

## fix-index.ts

_43 lines, skeleton 25 chars (2% of 1048), 8804ms_

The `fix-index` file serves as a specialized utility for managing Neo4j database indexes, likely addressing schema inconsistencies or missing index definitions. Its primary public API revolves around functions that interact with the `neo4j-driver` to create, drop, or repair indexes within a graph database instance. Architecturally, this module acts as an operational tool rather than a core provider, designed to be executed during deployment pipelines or maintenance scripts to ensure optimal query performance. By leveraging the Neo4j driver directly, it encapsulates logic for index lifecycle management without exposing internal implementation details to consumers.

## graph-provider.ts

_171 lines, skeleton 2925 chars (75% of 3906), 14382ms_

The `graph-provider.ts` file serves as the central interface for managing a knowledge graph, likely backed by Neo4j and augmented with vector search capabilities via Ladybug. Its primary responsibility is to abstract complex data operations into a unified API that handles storing entities and edges, performing semantic and full-text searches, updating embeddings, and retrieving statistics across multiple namespaces. Consumers interact with this provider through methods like `createGraphProvider` to instantiate the service, followed by calls to `store`, `search`, `forget`, and `getGraphData` for CRUD operations and retrieval tasks. Architecturally, it acts as an orchestration layer that delegates specific backend logic (Neo4j persistence and vector indexing) while exposing a high-level domain model for applications to query and maintain their graph data.

## init-db.ts

_126 lines, skeleton 86 chars (2% of 4033), 5564ms_

The `init-db.ts` file serves as the primary initialization module for setting up a Neo4j database instance. Its sole public API is the exported `initDatabase` function, which orchestrates the asynchronous creation or configuration of the graph database environment. Architecturally, this acts as a setup utility that ensures the required data infrastructure exists before application logic runs.

## intents.ts

_131 lines, skeleton 250 chars (7% of 3456), 9943ms_

The `intents.ts` file serves as a core utility module dedicated to semantic classification and graph manipulation based on user queries. Its primary public API exposes a `classifyIntent` function that analyzes input strings to determine their specific intent, alongside a `boostEdgesByIntent` function designed to adjust edge weights in a stored graph according to the detected intent. Internally, it relies on an `IntentPattern` interface to define regex-based rules for matching intents, indicating its role as a pattern-matching engine within a larger system. Architecturally, this module acts as a bridge between raw user input and the underlying graph structure, enabling dynamic routing or scoring based on semantic categories.

## ladybug-provider.ts

_1380 lines, skeleton 3627 chars (7% of 50437), 12247ms_

The `ladybug-provider.ts` file serves as the core implementation of a graph-based data provider, responsible for managing entities, edges, and memories within a vectorized knowledge graph. Its public API exposes a comprehensive set of methods for storing and retrieving data via vector search, full-text search, and entity filtering, alongside utilities for managing memory states, embeddings, and namespaces. Architecturally, this module acts as the primary interface for interacting with the underlying database layer, handling complex operations like edge creation, graph data retrieval, and asynchronous query execution while delegating lower-level tasks to internal helper modules.

## load-memories.ts

_47 lines, skeleton 153 chars (12% of 1241), 6275ms_

This file serves as a utility module responsible for loading memory data into the application. Its primary public API is the `loadMemories` function, which asynchronously retrieves and likely initializes a collection of `MemoryEntry` objects containing namespace, text, and optional name properties. Architecturally, it acts as a data provider that depends on external operations defined in `./operations.js` to fetch or construct this memory state.

## neo4j-provider.ts

_1619 lines, skeleton 2914 chars (6% of 51554), 11856ms_

The `neo4j-provider.ts` file serves as the primary implementation of a Neo4j graph database interface, responsible for managing data persistence, retrieval, and vector search operations within a knowledge graph system. Its public API exposes a comprehensive set of methods for storing entities and edges, performing both full-text and vector-based searches, managing memory embeddings, and handling namespace-level lifecycle operations like creation, deletion, and statistics gathering. Architecturally, this module acts as a core provider that abstracts the underlying Neo4j driver, integrating graph-specific logic with external utilities for embedding generation and search optimization to enable scalable graph interactions.

## operations.ts

_206 lines, skeleton 925 chars (14% of 6485), 9125ms_

The `operations.ts` file serves as the central orchestration layer for managing a knowledge graph system, bridging core components like providers, queues, and embedders with external analytics and intent logic. Its primary public API exposes a suite of asynchronous functions designed for full lifecycle management of graph data, including retrieving providers, searching nodes, adding or forgetting memory entries, and inspecting queue status across configurable namespaces. Architecturally, this module acts as the main controller interface that abstracts complex internal interactions into high-level operations for CRUD actions on graph entities and system statistics.

## queue.ts

_151 lines, skeleton 370 chars (7% of 5149), 8305ms_

The `queue.ts` file serves as a central job scheduler that manages asynchronous tasks by queuing `Memory` objects for processing via external extractor and embedder services. Its primary public API exposes the `Queue` class, allowing consumers to add items with `add()`, check pending counts with `pending()`, while internally handling task execution through the private `process()` method. Architecturally, this module acts as a middleware orchestrator that decouples task submission from execution, leveraging dependency injection for analytics and graph providers to facilitate robust, observable workflows.

## reembed.ts

_162 lines, skeleton 495 chars (10% of 5152), 10228ms_

The `reembed.ts` file serves as an orchestration module responsible for the core logic of re-embedding graph data, including memories and edges. Its primary public API revolves around the top-level `reembed()` function, which likely triggers a full pipeline that collects existing data via `collectMemories` and `collectEdges`, then processes them through specialized handlers like `reembedMemories` and `reembedEdges`. Architecturally, this file acts as a high-level utility or orchestrator that bridges the gap between raw graph providers (`GraphProvider`) and the embedding logic defined in `./embedder`, while also offering helper functions for data deduplication and summary printing.

## reextract.ts

_117 lines, skeleton 134 chars (4% of 3616), 6542ms_

The `reextract.ts` file serves as an orchestration module responsible for triggering a memory re-extraction process. Its primary public API consists of the `reextractMemories` function, which acts as an asynchronous entry point to refresh stored memories using imported extractor and embedder components. Architecturally, this file functions as a background job or scheduled task provider that integrates with external graph providers and type definitions to maintain data consistency.

## retro-search.ts

_51 lines, skeleton 241 chars (13% of 1812), 9595ms_

The `retro-search.ts` file serves as a specialized search utility within the application's architecture, likely handling retrospective analysis of memory data. Its primary responsibility is to expose two asynchronous functions that enable users to discover similar past findings based on text input and identify recurring behavioral patterns across episodes. Consumers interact with this module by calling `findSimilarFindings` to retrieve related memories or `findRecurringPatterns` to extract significant edges from stored data, both of which return typed results defined in the shared type system. Architecturally, it acts as a domain-specific service layer that bridges raw memory storage with higher-level analytical insights for the application's core logic.

## search-utils.ts

_39 lines, skeleton 160 chars (14% of 1154), 6678ms_

The `search-utils.ts` file serves as a utility module dedicated to combining and ranking search results. Its primary public API is the exported `rrfFuse` function, which implements Reciprocal Rank Fusion logic to merge vector-based and full-text search outcomes into a single unified list. Architecturally, this file acts as a post-processing helper that accepts raw stored edges from different sources and returns a consolidated array of top-ranked results.

## utils.ts

_15 lines, skeleton 86 chars (28% of 310), 7003ms_

This file serves as a lightweight utility module designed to streamline CSS class name construction for React projects using Tailwind CSS. Its primary public API is the exported `cn` function, which accepts variable arguments of type `ClassValue` and merges them into a single string. By leveraging the `clsx` and `tailwind-merge` dependencies, it acts as a convenience helper that simplifies conditional class application while automatically handling Tailwind's arbitrary value syntax.


---
**Totals:** 20 files, 15007 skeleton chars (9% of 166756 full), 182290ms (9115ms avg)