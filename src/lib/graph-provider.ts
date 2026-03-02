import type {
  Memory,
  Entity,
  ExtractedEdge,
  StoredEdge,
  StoredEntity,
  EntityFilter,
  EdgeFilter,
  MemoryFilter,
} from "../types.js";
import { Neo4jProvider } from "./neo4j-provider.js";
import { LadybugProvider } from "./ladybug-provider.js";

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

export interface GraphProvider {
  init(): Promise<void>;
  close(): Promise<void>;

  store(
    memory: Memory,
    entities: Entity[],
    edges: ExtractedEdge[],
    memoryEmbedding: number[],
    edgeEmbeddings: number[][],
    memoryEmbedding384?: number[],
    edgeEmbeddings384?: number[][],
  ): Promise<void>;

  search(
    embedding: number[],
    query: string,
    limit?: number,
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

  findEntities(filter: EntityFilter, limit?: number): Promise<StoredEntity[]>;

  findEdges(filter: EdgeFilter, limit?: number): Promise<StoredEdge[]>;

  findMemories(filter: MemoryFilter, limit?: number): Promise<Memory[]>;

  stats(namespace?: string): Promise<Stats>;

  listNamespaces(): Promise<string[]>;

  deleteByNamespace(namespace: string): Promise<void>;

  getGraphData(namespace?: string, nodeLimit?: number): Promise<GraphData>;

  purgeDeleted?(): Promise<{
    memories: number;
    entities: number;
    facts: number;
  }>;
}

export async function createGraphProvider(): Promise<GraphProvider> {
  if (process.env.NEO4J_URI) {
    const provider = new Neo4jProvider();
    await provider.init();
    return provider;
  }
  const provider = new LadybugProvider();
  await provider.init();
  return provider;
}
