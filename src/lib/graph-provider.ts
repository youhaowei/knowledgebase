import type {
  Memory,
  Entity,
  ExtractedEdge,
  StoredEdge,
  StoredEntity,
  EntityFilter,
  EdgeFilter,
  MemoryFilter,
  PaginationParams,
  EmbeddingMap,
} from "../types.js";
export interface SearchResult {
  memories: Memory[];
  edges: StoredEdge[];
  entities: StoredEntity[];
}

export interface GetResult {
  memory?: Memory;
  entity?: StoredEntity;
  edges: StoredEdge[];
}

export interface ForgetResult {
  deletedMemory: boolean;
  deletedEntity: boolean;
}

export interface ForgetEdgeResult {
  invalidatedEdge?: StoredEdge;
  auditMemoryId?: string;
}

export interface GraphData {
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    namespace?: string;
    description?: string;
    summary?: string;
  }>;
  links: Array<{
    source: string;
    target: string;
    relationType: string;
    fact: string;
    sentiment: number;
    confidence: number;
    edgeId: string;
  }>;
}

export interface Stats {
  memories: number;
  entities: number;
  edges: number;
}

/**
 * GraphProvider interface contract — shared by LadybugDB (default) and Neo4j.
 *
 * Soft-delete sentinel: every writable node MUST set `deletedAt = ''` on
 * creation and `deletedAt = <ISO timestamp>` on soft-deletion. Read queries
 * filter on `deletedAt = ''` to exclude deleted rows. Neo4j additionally
 * tolerates legacy rows with a missing `deletedAt` property by accepting
 * `(deletedAt IS NULL OR deletedAt = '')`; this is a compat shim, not a
 * semantic divergence — new writes on both backends set the empty string.
 * LadybugDB's schema requires the property to be present, so equality check
 * alone is sufficient there.
 *
 * namespace sentinel: `''` (empty string) represents "global scope" — used
 * by entities that should be visible across namespaces (project-level
 * constants). User-created memories always have a concrete namespace.
 */
export interface GraphProvider {
  init(): Promise<void>;
  close(): Promise<void>;

  store(
    memory: Memory,
    entities: Entity[],
    edges: ExtractedEdge[],
    memoryEmbeddings: EmbeddingMap,
    edgeEmbeddings: EmbeddingMap[],
  ): Promise<void>;

  search(
    embedding: number[],
    query: string,
    limit?: number,
    namespace?: string,
  ): Promise<SearchResult>;

  vectorSearch(
    embedding: number[],
    limit: number,
    filter?: MemoryFilter,
  ): Promise<Memory[]>;

  vectorSearchEdges(
    embedding: number[],
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]>;

  fullTextSearchEdges(
    query: string,
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]>;

  get(name: string, namespace: string): Promise<GetResult>;

  forget(name: string, namespace: string): Promise<ForgetResult>;

  /**
   * Exact-memory delete used by the reconciler when replaying tombstones from
   * the filesystem. Unlike `forget(name, namespace)`, this must only touch the
   * targeted memory row so a replacement memory with the same name is not
   * removed on replay.
   */
  forgetMemoryById(id: string, namespace: string): Promise<boolean>;

  forgetEdge(
    edgeId: string,
    reason: string,
    namespace?: string,
  ): Promise<ForgetEdgeResult>;

  storeMemoryOnly(memory: Memory): Promise<void>;

  updateMemoryStatus(
    id: string,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string,
  ): Promise<void>;

  getPendingMemories(namespace?: string, limit?: number): Promise<Memory[]>;

  storeEntity(entity: StoredEntity): Promise<void>;

  findEntities(filter: EntityFilter, limit?: number, pagination?: PaginationParams): Promise<StoredEntity[]>;

  findEdges(filter: EdgeFilter, limit?: number, pagination?: PaginationParams): Promise<StoredEdge[]>;

  findMemories(filter: MemoryFilter, limit?: number, pagination?: PaginationParams): Promise<Memory[]>;

  stats(namespace?: string): Promise<Stats>;

  listNamespaces(): Promise<string[]>;

  deleteByNamespace(namespace: string): Promise<void>;

  getGraphData(namespace?: string, nodeLimit?: number): Promise<GraphData>;

  purgeDeleted?(): Promise<{
    memories: number;
    entities: number;
    facts: number;
  }>;

  /** Find memories where the embedding for the given dimension is all zeros */
  findMemoriesNeedingEmbedding(dimension: number): Promise<Memory[]>;

  /** Find edges (facts) where the embedding for the given dimension is all zeros */
  findEdgesNeedingEmbedding(
    dimension: number,
  ): Promise<Array<{ id: string; fact: string }>>;

  /** Update embeddings on a Memory node. Skips empty/zero values to preserve existing data. */
  updateMemoryEmbeddings(
    memoryId: string,
    embeddings: EmbeddingMap,
  ): Promise<void>;

  /** Update embeddings on a Fact/edge. Skips empty/zero values to preserve existing data. */
  updateFactEmbeddings(
    factId: string,
    embeddings: EmbeddingMap,
  ): Promise<void>;

  /** Update summary fields on a Memory (for self-evolving regeneration). */
  updateMemorySummary(
    memoryId: string,
    fields: { abstract: string; summary: string; schemaVersion: string; versionedAt: string },
  ): Promise<void>;

  /** Count memories in a namespace (for rollup threshold). */
  countMemories(namespace: string): Promise<number>;

  /** Lightweight entity catalog for extraction context — returns name + type for active entities. */
  getEntityCatalog(namespace: string): Promise<Array<{ name: string; type: string }>>;

  /** Merge duplicate entities: re-point all edges from dupeUuids to keepUuid, soft-delete dupes. */
  mergeEntities(keepUuid: string, dupeUuids: string[]): Promise<{ removed: number }>;
}

export async function createGraphProvider(): Promise<GraphProvider> {
  if (process.env.NEO4J_URI) {
    const { Neo4jProvider } = await import("./neo4j-provider.js");
    const provider = new Neo4jProvider();
    await provider.init();
    return provider;
  }
  const { LadybugProvider } = await import("./ladybug-provider.js");
  const provider = new LadybugProvider();
  await provider.init();
  return provider;
}
