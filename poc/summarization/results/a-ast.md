# A: AST Skeleton Extraction


## analytics.ts

_206 lines → 774 chars skeleton (13% of original)_

**Imports:** bun:sqlite, async_hooks, path, os

**Exports:**
- const analyticsContext
- function track(
  operation: string,
  data:
- async function tracked<T>(
  operation: string,
  opts:
- function queryDb(
  sql: string,
  params: QueryParam[] = [],
): Record<string, unknown>[]
- function getOperationSummary(where = "", params: QueryParam[] = [])
- function getSourceBreakdown(where = "", params: QueryParam[] = [])
- function getEventTotals(where = "", params: QueryParam[] = [])
- function closeAnalytics()
- function setAnalyticsPath(path: string)
- function resetAnalyticsPath()

**Types:**
- export type AnalyticsSource = "mcp" | "cli" | "web";

**Internal:**
- type QueryParam = string | number | null;
- function getDbPath()
- function getDb(): Database | null

## embedder.ts

_186 lines → 704 chars skeleton (14% of original)_

**Imports:** ./fallback-embedder.js, ../types.js

**Exports:**
- function isZeroEmbedding(embedding: number[]): boolean
- function getOllamaDim(): number | null
- function getActiveDimension(): number | null
- function getRegisteredDimensions(): number[]
- async function embed(text: string): Promise<number[]>
- async function embedWithDimension(text: string): Promise<EmbedResult>
- async function embedDual(text: string): Promise<EmbeddingMap>
- async function checkOllama(): Promise<boolean>
- async function checkAnyEmbedder(): Promise<

**Types:**
- export type EmbedSource = "ollama" | "fallback";
- export type EmbedResult = {
  embedding: number[];
  dimension: number;
  source: EmbedSource;
};

## errors.ts

_7 lines → 43 chars skeleton (24% of original)_

**Exports:**
- class NotSupportedError {  }

## extractor-gemini.ts

_127 lines → 401 chars skeleton (11% of original)_

**Imports:** ../types.js, ./extractor.js

**Exports:**
- async function extractWithGemini(text: string): Promise<Extraction>

**Internal:**
- interface GeminiJsonOutput { session_id: string;; response: string;; stats: unknown; }
- function parseGeminiCliOutput(output: string): GeminiJsonOutput
- function stripMarkdownCodeBlock(text: string): string
- function extractJsonObject(text: string): string

## extractor.ts

_241 lines → 311 chars skeleton (3% of original)_

**Imports:** unifai, ../types.js, ./extractor-gemini.js

**Exports:**
- async function extract(text: string): Promise<Extraction>

**Internal:**
- const extractionPrompt = (text: string)
- async function extractWithClaude(text: string): Promise<Extraction>
- async function isGeminiAvailable(): Promise<boolean>

## fallback-embedder.ts

_91 lines → 383 chars skeleton (14% of original)_

**Imports:** @huggingface/transformers

**Exports:**
- function getFallbackDim(): number | null
- async function isFallbackAvailable(): Promise<boolean>
- async function embedFallback(text: string): Promise<number[]>

**Internal:**
- async function loadPipeline(): Promise<FeatureExtractionPipeline | null>
- async function ensurePipeline(): Promise<FeatureExtractionPipeline | null>

## fix-index.ts

_43 lines → 25 chars skeleton (2% of original)_

**Imports:** neo4j-driver

## graph-provider.ts

_171 lines → 2925 chars skeleton (75% of original)_

**Imports:** ../types.js, ./neo4j-provider.js, ./ladybug-provider.js

**Exports:**
- async function createGraphProvider(): Promise<GraphProvider>

**Types:**
- interface SearchResult { memories: Memory[];; edges: StoredEdge[];; entities: StoredEntity[]; }
- interface GetResult { memory?: Memory;; entity?: StoredEntity;; edges: StoredEdge[]; }
- interface ForgetResult { deletedMemory: boolean;; deletedEntity: boolean; }
- interface ForgetEdgeResult { invalidatedEdge?: StoredEdge;; auditMemoryId?: string; }
- interface GraphData { nodes: Array<{
    id: string;
    name: string;
    type: string;
    description?: string;
    summary?: string;
  }>;; links: Array<{
    source: string;
    target: string;
    relationType: string;
    fact: string;
    sentiment: number... }
- interface Stats { memories: number;; entities: number;; edges: number; }
- interface GraphProvider { init(): Promise<void>;; close(): Promise<void>;; store(
    memory: Memory,
    entities: Entity[],
    edges: ExtractedEdge[],
    memoryEmbeddings: EmbeddingMap,
    e...; search(
    embedding: number[],
    query: string,
    limit?: number,
  ): Promise<SearchResult>;; vectorSearch(
    embedding: number[],
    limit: number,
    filter?: MemoryFilter,
  ): Promise<Memory[]>;; vectorSearchEdges(
    embedding: number[],
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]>;; fullTextSearchEdges(
    query: string,
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]>;; get(name: string, namespace: string): Promise<GetResult>;; forget(name: string, namespace: string): Promise<ForgetResult>;; forgetEdge(
    edgeId: string,
    reason: string,
    namespace?: string,
  ): Promise<ForgetEdgeResult>;; storeMemoryOnly(memory: Memory): Promise<void>;; updateMemoryStatus(
    id: string,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string,
 ...; getPendingMemories(namespace?: string, limit?: number): Promise<Memory[]>;; storeEntity(entity: StoredEntity): Promise<void>;; findEntities(filter: EntityFilter, limit?: number): Promise<StoredEntity[]>;; findEdges(filter: EdgeFilter, limit?: number): Promise<StoredEdge[]>;; findMemories(filter: MemoryFilter, limit?: number): Promise<Memory[]>;; stats(namespace?: string): Promise<Stats>;; listNamespaces(): Promise<string[]>;; deleteByNamespace(namespace: string): Promise<void>;; getGraphData(namespace?: string, nodeLimit?: number): Promise<GraphData>;; purgeDeleted?(): Promise<{
    memories: number;
    entities: number;
    facts: number;
  }>;; findMemoriesNeedingEmbedding(dimension: number): Promise<Memory[]>;; findEdgesNeedingEmbedding(
    dimension: number,
  ): Promise<Array<{ id: string; fact: string }>>;; updateMemoryEmbeddings(
    memoryId: string,
    embeddings: EmbeddingMap,
  ): Promise<void>;; updateFactEmbeddings(
    factId: string,
    embeddings: EmbeddingMap,
  ): Promise<void>; }

## init-db.ts

_126 lines → 86 chars skeleton (2% of original)_

**Imports:** neo4j-driver

**Exports:**
- async function initDatabase(): Promise<void>

## intents.ts

_131 lines → 250 chars skeleton (7% of original)_

**Imports:** ../types.js

**Exports:**
- function classifyIntent(query: string): Intent
- function boostEdgesByIntent(edges: StoredEdge[], intent: Intent): StoredEdge[]

**Internal:**
- interface IntentPattern { intent: Intent;; patterns: RegExp[]; }

## ladybug-provider.ts

_1380 lines → 3627 chars skeleton (7% of original)_

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

## load-memories.ts

_47 lines → 153 chars skeleton (12% of original)_

**Imports:** ./operations.js

**Internal:**
- interface MemoryEntry { namespace: string;; text: string;; name?: string; }
- async function loadMemories()

## neo4j-provider.ts

_1619 lines → 2914 chars skeleton (6% of original)_

**Imports:** neo4j-driver, crypto, ../types.js, ./graph-provider.js, ./search-utils.js, ./embedder.js

**Exports:**
- class Neo4jProvider { private getDimInfo(dim: number); private async ensureDimension(dim: number, session: Session); async init(): Promise<void>; async close(): Promise<void>; async withTransaction<T>(
    fn: (tx: ManagedTransaction) => Promise<T>,
  ): Promise<T>; getSession(): Session; async store(
    memory: Memory,
    entities: Entity[],
    edges: ExtractedEdge[],
    memoryEmbeddings: EmbeddingMap,
    edgeEmbeddings: EmbeddingMap[],
  ): Promise<void>; private async storeEdge(
    tx: ManagedTransaction,
    edge: ExtractedEdge,
    edgeEmbMap: EmbeddingMap,
    entities: Entity[],
    memory: Memory,
  ); async search(
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
  ): Promise<StoredEdge[]>; async get(name: string, namespace = "default"): Promise<GetResult>; async forget(name: string, namespace = "default"): Promise<ForgetResult>; async forgetEdge(
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
  ): Promise<StoredEntity[]>; async findEdges(filter: EdgeFilter, limit = 100): Promise<StoredEdge[]>; async findMemories(filter: MemoryFilter, limit = 100): Promise<Memory[]>; async stats(namespace?: string): Promise<Stats>; async listNamespaces(): Promise<string[]>; async deleteByNamespace(namespace: string): Promise<void>; async getGraphData(namespace?: string, nodeLimit = 100): Promise<GraphData>; async findEntitiesWithGlobalPreference(
    namespace: string | undefined,
    limit: number,
  ): Promise<StoredEntity[]>; async deleteEntity(uuid: string): Promise<void>; async deleteEdgesForEntity(uuid: string): Promise<void>; async findMemoriesNeedingEmbedding(
    dimension: number,
  ): Promise<Memory[]>; async findEdgesNeedingEmbedding(
    dimension: number,
  ): Promise<Array<; async updateMemoryEmbeddings(
    memoryId: string,
    embeddings: EmbeddingMap,
  ): Promise<void>; async updateFactEmbeddings(
    factId: string,
    embeddings: EmbeddingMap,
  ): Promise<void>; async updateEdgesToGlobal(
    entityName: string,
  ): Promise< }

## operations.ts

_206 lines → 925 chars skeleton (14% of original)_

**Imports:** ./graph-provider.js, ./queue.js, ./embedder.js, crypto, ../types.js, ./graph-provider.js, ./intents.js, ./analytics.js

**Exports:**
- async function getProvider()
- async function getQueueStatus(namespace?: string): Promise<number>
- async function addMemory(
  text: string,
  name?: string,
  namespace = "default",
): Promise<
- async function search(
  query: string,
  namespace?: string,
  limit = 10,
): Promise<
- async function getByName(
  name: string,
  namespace?: string,
): Promise<
- async function forget(
  name: string,
  namespace: string,
): Promise<
- async function forgetEdge(edgeId: string, reason: string, namespace = "default")
- async function stats(namespace = "default")
- async function listNamespaces(): Promise<string[]>
- async function getGraphData(namespace?: string, nodeLimit?: number): Promise<GraphData>
- async function close()

**Internal:**
- async function getQueue()

## queue.ts

_151 lines → 370 chars skeleton (7% of original)_

**Imports:** ./extractor.js, ./embedder.js, ./graph-provider.js, ../types.js, ./analytics.js

**Exports:**
- class Queue { async add(memory: Memory): Promise<void>; private async process(namespace: string): Promise<void>; pending(namespace?: string): number }

**Internal:**
- type QueueEntry = {
  memory: Memory;
  resolve: () => void;
  reject: (e: Error) => void;
};

## reembed.ts

_162 lines → 495 chars skeleton (10% of original)_

**Imports:** ./embedder, ./graph-provider, ../types.js

**Internal:**
- async function reembedMemories(
  provider: GraphProvider,
  memories: Memory[],
): Promise<
- async function reembedEdges(
  provider: GraphProvider,
  edges: Array<
- function dedupeById<T extends
- async function collectMemories(provider: GraphProvider): Promise<Memory[]>
- async function collectEdges(provider: GraphProvider): Promise<Array<
- function printSummary(memResult:
- async function reembed(): Promise<void>

## reextract.ts

_117 lines → 134 chars skeleton (4% of original)_

**Imports:** ./extractor, ./embedder, ./graph-provider, ../types.js

**Internal:**
- async function reextractMemories(): Promise<void>

## retro-search.ts

_51 lines → 241 chars skeleton (13% of original)_

**Imports:** ./operations.js, ../types.js

**Exports:**
- async function findSimilarFindings(
  text: string,
  limit = 5,
): Promise<Memory[]>
- async function findRecurringPatterns(
  minEpisodes = 2,
  limit = 20,
): Promise<StoredEdge[]>

## search-utils.ts

_39 lines → 160 chars skeleton (14% of original)_

**Imports:** ../types.js

**Exports:**
- function rrfFuse(
  vectorResults: StoredEdge[],
  ftsResults: StoredEdge[],
  limit: number,
  K = 60,
): StoredEdge[]

## utils.ts

_15 lines → 86 chars skeleton (28% of original)_

**Imports:** clsx, tailwind-merge

**Exports:**
- function cn(...inputs: ClassValue[])