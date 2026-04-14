import { Database, Connection } from "lbug";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdirSync, unlinkSync } from "fs";
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
import type {
  GraphProvider,
  SearchResult,
  GetResult,
  ForgetResult,
  ForgetEdgeResult,
  GraphData,
  Stats,
} from "./graph-provider.js";
import { rrfFuse } from "./search-utils.js";
import { getActiveDimension, isZeroEmbedding } from "./embedder.js";
import { normalizeEntityName } from "./entity-matcher.js";

type MutableEntity = Entity & {
  uuid?: string;
  namespace?: string;
  scope?: "project" | "global";
  summary?: string;
};

/**
 * Coerce a pagination integer from MCP/HTTP to a safe non-negative int.
 * LadybugDB interpolates LIMIT/SKIP directly (no bound params) so NaN /
 * Infinity / non-integer input would either produce invalid Cypher or
 * trigger a runaway scan (review pass 7 finding #7). Matches the pattern
 * already used in getPendingMemories.
 */
function safePagInt(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.trunc(v));
}

export class LadybugProvider implements GraphProvider {
  private db: Database;
  private conn!: Connection;
  private dataPath: string;

  constructor(dataPath?: string) {
    this.dataPath = dataPath ?? process.env.LADYBUG_DATA_PATH ?? join(homedir(), ".kb", "ladybug");
    mkdirSync(dirname(this.dataPath), { recursive: true });

    // Auto-recover from corrupted WAL (LadybugDB crashes on unclean shutdown)
    const walPath = this.dataPath + ".wal";
    try {
      this.db = new Database(this.dataPath);
    } catch (err) {
      if (String(err).includes("wal_record") || String(err).includes("KU_UNREACHABLE")) {
        console.error(`[kb] Corrupted WAL detected, removing ${walPath} and retrying...`);
        this.removeWalFile(walPath);
        this.db = new Database(this.dataPath);
      } else {
        throw err;
      }
    }
  }

  /** Maps dimension → column/index names for Memory and Fact tables */
  private dimensionRegistry = new Map<number, {
    memoryCol: string;
    factCol: string;
    memoryIndex: string;
    factIndex: string;
  }>();

  /** Known dimensions registered at init time (backward compat) */
  private static readonly KNOWN_DIMENSIONS: Array<{
    dim: number;
    memoryCol: string;
    factCol: string;
    memoryIndex: string;
    factIndex: string;
  }> = [
    { dim: 2560, memoryCol: "embedding", factCol: "factEmbedding", memoryIndex: "memory_vec_idx", factIndex: "fact_vec_idx" },
    { dim: 384, memoryCol: "embedding384", factCol: "factEmbedding384", memoryIndex: "memory_vec_384", factIndex: "fact_vec_384" },
  ];

  /**
   * Execute a query with optional parameters.
   * LadybugDB requires prepare() + execute() for parameterized queries.
   */
  private async executeQuery(
    statement: string,
    params: Record<string, unknown> = {},
  ): Promise<{ getAll(): Promise<Record<string, unknown>[]> }> {
    if (Object.keys(params).length === 0) {
      return this.conn.query(statement);
    }
    const prepared = await this.conn.prepare(statement);
    return this.conn.execute(prepared, params);
  }

  private zeroEmbeddingStr(dim: number): string {
    return `[${new Array(dim).fill(0).join(",")}]`;
  }

  private removeWalFile(walPath: string): void {
    try {
      unlinkSync(walPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  /** Get dimension info from registry, throw if unknown */
  private getDimInfo(dim: number) {
    const info = this.dimensionRegistry.get(dim);
    if (!info) throw new Error(`Unknown embedding dimension: ${dim}. Run ensureDimension() first.`);
    return info;
  }

  /** Build embedding column strings from an EmbeddingMap for SQL interpolation */
  private embeddingColumns(embeddings: EmbeddingMap): Record<string, string> {
    const cols: Record<string, string> = {};
    for (const [dim, info] of this.dimensionRegistry) {
      const vec = embeddings.get(dim);
      cols[info.memoryCol] = vec && !isZeroEmbedding(vec)
        ? `[${vec.join(",")}]`
        : this.zeroEmbeddingStr(dim);
      cols[info.factCol] = vec && !isZeroEmbedding(vec)
        ? `[${vec.join(",")}]`
        : this.zeroEmbeddingStr(dim);
    }
    return cols;
  }

  /** Auto-create columns and indexes for a new dimension */
  async ensureDimension(dim: number): Promise<void> {
    if (this.dimensionRegistry.has(dim)) return;

    const memoryCol = `embedding_${dim}`;
    const factCol = `factEmbedding_${dim}`;
    const memoryIndex = `memory_vec_${dim}`;
    const factIndex = `fact_vec_${dim}`;

    const zeroStr = this.zeroEmbeddingStr(dim);
    await this.tryQuery(`ALTER TABLE Memory ADD ${memoryCol} DOUBLE[${dim}] DEFAULT ${zeroStr}`);
    await this.tryQuery(`ALTER TABLE Fact ADD ${factCol} DOUBLE[${dim}] DEFAULT ${zeroStr}`);
    await this.tryQuery(`CALL CREATE_VECTOR_INDEX('Memory', '${memoryIndex}', '${memoryCol}', metric := 'cosine')`);
    await this.tryQuery(`CALL CREATE_VECTOR_INDEX('Fact', '${factIndex}', '${factCol}', metric := 'cosine')`);

    this.dimensionRegistry.set(dim, { memoryCol, factCol, memoryIndex, factIndex });
    console.error(`[ladybug] Auto-created indexes for ${dim}-dim embeddings`);
  }

  /**
   * Sanitize a user-supplied FTS query for safe interpolation into
   * `CALL QUERY_FTS_INDEX('Fact', 'fact_fts_idx', '<escaped>', ...)`.
   *
   * **Load-bearing invariant** (review pass 7 finding #9): the output of
   * this function is the ONLY defense against Cypher injection in the FTS
   * path — LadybugDB does not currently accept bound parameters inside
   * `CALL QUERY_FTS_INDEX(...)`. Any character that can terminate a
   * single-quoted Cypher string literal must be stripped here, full stop.
   * A strict allowlist (alphanumerics, whitespace, `.,?_-`) is the
   * enforcement mechanism; see `test/provider.test.ts` injection fixtures
   * for the regression contract.
   *
   * If you loosen the allowlist, add a corresponding fixture that proves
   * the new characters cannot escape the quoted string. Do not add
   * characters by "it looked safe" — the burden is on the change.
   *
   * Earlier versions used a blacklist (`'"\&|!()`) which missed colons,
   * newlines, unicode quote variants, and every future LadybugDB FTS
   * syntax extension. Allowlist + test = durable contract.
   */
  private escapeFtsQuery(query: string): string {
    return query
      .replace(/[^A-Za-z0-9_\-\s.,?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private async tryQuery(query: string): Promise<void> {
    try {
      await this.conn.query(query);
    } catch (e) {
      if (
        !(
          e instanceof Error &&
          (e.message.includes("already exists") ||
            e.message.includes("already has property"))
        )
      )
        throw e;
    }
  }

  private async loadExtension(name: string): Promise<void> {
    try {
      await this.conn.query(`INSTALL ${name}`);
      await this.conn.query(`LOAD ${name}`);
    } catch {
      /* Extension may already be loaded */
    }
  }

  async init(): Promise<void> {
    this.conn = new Connection(this.db);

    await this.loadExtension("vector");
    await this.loadExtension("fts");

    await this.tryQuery(`CREATE NODE TABLE IF NOT EXISTS Memory(
      id STRING PRIMARY KEY, name STRING, text STRING, summary STRING,
      category STRING, namespace STRING, status STRING, error STRING,
      embedding DOUBLE[2560], createdAt STRING, deletedAt STRING
    )`);

    await this.tryQuery(`CREATE NODE TABLE IF NOT EXISTS Entity(
      uuid STRING PRIMARY KEY, name STRING, type STRING, description STRING,
      namespace STRING, scope STRING, summary STRING, deletedAt STRING
    )`);

    await this.tryQuery(`CREATE NODE TABLE IF NOT EXISTS Fact(
      id STRING PRIMARY KEY, text STRING, relationType STRING, sourceUuid STRING,
      targetUuid STRING, sentiment DOUBLE, confidence DOUBLE, confidenceReason STRING,
      factEmbedding DOUBLE[2560], episodes STRING[], validAt STRING,
      invalidAt STRING, namespace STRING, createdAt STRING, deletedAt STRING
    )`);

    // Migration: add factEmbedding column to existing Fact tables
    await this.tryQuery(
      `ALTER TABLE Fact ADD factEmbedding DOUBLE[2560] DEFAULT ${this.zeroEmbeddingStr(2560)}`,
    );

    // Migration: add confidence scoring columns
    await this.tryQuery(
      `ALTER TABLE Fact ADD confidence DOUBLE DEFAULT 1.0`,
    );
    await this.tryQuery(
      `ALTER TABLE Fact ADD confidenceReason STRING DEFAULT ''`,
    );

    await this.tryQuery(`CREATE REL TABLE IF NOT EXISTS RELATES_TO(
      FROM Entity TO Entity, id STRING, relationType STRING, fact STRING,
      sentiment DOUBLE, confidence DOUBLE, confidenceReason STRING,
      factEmbedding DOUBLE[2560], episodes STRING[],
      validAt STRING, invalidAt STRING, namespace STRING, createdAt STRING
    )`);

    // Migration: add confidence scoring columns to RELATES_TO rel table
    await this.tryQuery(
      `ALTER TABLE RELATES_TO ADD confidence DOUBLE DEFAULT 1.0`,
    );
    await this.tryQuery(
      `ALTER TABLE RELATES_TO ADD confidenceReason STRING DEFAULT ''`,
    );

    // Migration: add tiered summary fields
    await this.tryQuery(`ALTER TABLE Memory ADD abstract STRING DEFAULT ''`);
    await this.tryQuery(`ALTER TABLE Memory ADD schemaVersion STRING DEFAULT '0.0.0'`);
    await this.tryQuery(`ALTER TABLE Memory ADD versionedAt STRING DEFAULT ''`);

    // Migration: add canonicalName for entity dedup
    await this.tryQuery(`ALTER TABLE Entity ADD canonicalName STRING DEFAULT ''`);

    // Migration: add 384-dim fallback embedding columns
    await this.tryQuery(
      `ALTER TABLE Memory ADD embedding384 DOUBLE[384] DEFAULT ${this.zeroEmbeddingStr(384)}`,
    );
    await this.tryQuery(
      `ALTER TABLE Fact ADD factEmbedding384 DOUBLE[384] DEFAULT ${this.zeroEmbeddingStr(384)}`,
    );

    // Register known dimensions and create vector indexes
    for (const known of LadybugProvider.KNOWN_DIMENSIONS) {
      this.dimensionRegistry.set(known.dim, {
        memoryCol: known.memoryCol,
        factCol: known.factCol,
        memoryIndex: known.memoryIndex,
        factIndex: known.factIndex,
      });
      await this.tryQuery(
        `CALL CREATE_VECTOR_INDEX('Memory', '${known.memoryIndex}', '${known.memoryCol}', metric := 'cosine')`,
      );
      await this.tryQuery(
        `CALL CREATE_VECTOR_INDEX('Fact', '${known.factIndex}', '${known.factCol}', metric := 'cosine')`,
      );
    }

    // Full-text search index
    await this.tryQuery(
      `CALL CREATE_FTS_INDEX('Fact', 'fact_fts_idx', ['text'])`,
    );
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
    }
    if (this.db) {
      await this.db.close();
    }
  }

  /** Ensure all dimensions in the given embedding maps are registered */
  private async ensureAllDimensions(memEmb: EmbeddingMap, edgeEmbs: EmbeddingMap[]) {
    for (const dim of memEmb.keys()) await this.ensureDimension(dim);
    for (const emb of edgeEmbs) {
      for (const dim of emb.keys()) await this.ensureDimension(dim);
    }
  }

  /** Build memory embedding column strings for SQL interpolation */
  private buildMemoryEmbCols(embeddings: EmbeddingMap): string[] {
    const cols: string[] = [];
    for (const [dim, info] of this.dimensionRegistry) {
      const vec = embeddings.get(dim);
      const str = vec && !isZeroEmbedding(vec)
        ? `[${vec.join(",")}]`
        : this.zeroEmbeddingStr(dim);
      cols.push(`${info.memoryCol}: ${str}`);
    }
    return cols;
  }

  async store(
    memory: Memory,
    entities: Entity[],
    edges: ExtractedEdge[],
    memoryEmbeddings: EmbeddingMap,
    edgeEmbeddings: EmbeddingMap[],
  ): Promise<void> {
    await this.ensureAllDimensions(memoryEmbeddings, edgeEmbeddings);

    const embCols = this.buildMemoryEmbCols(memoryEmbeddings);
    const createdAt = memory.createdAt.toISOString();

    // LadybugDB: vector-indexed properties can't be updated with MERGE, use delete+create
    await this.executeQuery(
      `MATCH (m:Memory {id: $id, deletedAt: ''}) DELETE m`,
      { id: memory.id },
    );
    await this.executeQuery(
      `CREATE (m:Memory {
         id: $id, name: $name, text: $text, abstract: $abstract, summary: $summary,
         category: $category, namespace: $namespace, status: $status, error: $error,
         schemaVersion: $schemaVersion, versionedAt: $versionedAt,
         ${embCols.join(", ")},
         createdAt: $createdAt, deletedAt: ''
       })`,
      {
        id: memory.id,
        name: memory.name,
        text: memory.text,
        abstract: memory.abstract ?? "",
        summary: memory.summary,
        category: memory.category ?? "",
        namespace: memory.namespace,
        status: memory.status ?? "completed",
        error: memory.error ?? "",
        schemaVersion: memory.schemaVersion ?? "0.0.0",
        versionedAt: memory.versionedAt ?? new Date().toISOString(),
        createdAt,
      },
    );

    // Dedup entities by canonicalName+namespace: O(1) indexed lookup
    for (const entity of entities) {
      const entityWithScope = entity as Entity & {
        uuid?: string;
        namespace?: string;
        scope?: string;
      };
      const entityNamespace = entityWithScope.namespace ?? memory.namespace;
      const entityScope = entityWithScope.scope ?? "project";
      const finalNamespace = entityScope === "global" ? "" : entityNamespace;
      const canonicalName = normalizeEntityName(entity.name);

      // Check for existing entity by canonicalName+namespace (indexed, O(1))
      const existingResult = await this.executeQuery(
        `MATCH (e:Entity {canonicalName: $canonicalName, namespace: $namespace}) RETURN e.uuid as uuid, e.deletedAt as deletedAt`,
        { canonicalName, namespace: finalNamespace },
      );
      const existingRows = await existingResult.getAll();

      if (existingRows[0]?.uuid) {
        // Reuse existing uuid, reactivate if soft-deleted, update fields
        entityWithScope.uuid = existingRows[0].uuid as string;
        await this.executeQuery(
          `MATCH (e:Entity {uuid: $uuid})
           SET e.type = $type, e.description = COALESCE($description, e.description), e.deletedAt = ''`,
          { uuid: entityWithScope.uuid, type: entity.type, description: entity.description ?? "" },
        );
      } else {
        // Create new entity with canonicalName
        if (!entityWithScope.uuid) entityWithScope.uuid = randomUUID();
        await this.executeQuery(
          `CREATE (e:Entity {uuid: $uuid, name: $name, type: $type, description: $description,
             namespace: $namespace, scope: $scope, canonicalName: $canonicalName, deletedAt: ''})`,
          {
            uuid: entityWithScope.uuid,
            name: entity.name,
            type: entity.type,
            description: entity.description ?? "",
            namespace: finalNamespace,
            scope: entityScope,
            canonicalName,
          },
        );
      }
    }

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]!;
      const edgeEmb = edgeEmbeddings[i] ?? new Map();
      const sourceEntity = entities[edge.sourceIndex];
      const targetEntity = entities[edge.targetIndex];

      if (!sourceEntity || !targetEntity) {
        console.warn(
          `Invalid edge indices: ${edge.sourceIndex} -> ${edge.targetIndex}`,
        );
        continue;
      }

      await this.storeEdge(
        edge,
        edgeEmb,
        sourceEntity,
        targetEntity,
        memory.id,
        memory.namespace,
      );
    }
  }

  private async storeEdge(
    edge: ExtractedEdge,
    embeddings: EmbeddingMap,
    sourceEntity: MutableEntity,
    targetEntity: MutableEntity,
    memoryId: string,
    memoryNamespace: string,
  ): Promise<void> {
    const sourceUuid = sourceEntity.uuid!;
    const targetUuid = targetEntity.uuid!;
    const edgeId = randomUUID();
    const now = new Date().toISOString();
    const sourceNamespace =
      sourceEntity.scope === "global"
        ? ""
        : (sourceEntity.namespace ?? memoryNamespace);

    const existingEdge = await this.executeQuery(
      `MATCH (source:Entity {uuid: $sourceUuid})-[r:RELATES_TO]->(target:Entity {uuid: $targetUuid})
       WHERE r.relationType = $relationType
       RETURN r.id as id, r.fact as fact, r.episodes as episodes`,
      { sourceUuid, targetUuid, relationType: edge.relationType },
    );

    const rows = await existingEdge.getAll();
    if (rows.length > 0) {
      await this.updateExistingEdge(
        rows[0],
        edge,
        sourceUuid,
        targetUuid,
        memoryId,
        embeddings,
      );
    } else {
      await this.createNewEdge(
        edge,
        edgeId,
        embeddings,
        sourceUuid,
        targetUuid,
        memoryId,
        sourceNamespace,
        now,
      );
    }
  }

  private async updateExistingEdge(
    existing: Record<string, unknown>,
    edge: ExtractedEdge,
    sourceUuid: string,
    targetUuid: string,
    memoryId: string,
    embeddings: EmbeddingMap,
  ): Promise<void> {
    const existingEpisodes = (existing.episodes as string[]) || [];
    const newEpisodes = [...existingEpisodes, memoryId];
    const existingFact = (existing.fact as string) || "";
    const factChanged = edge.fact.length > existingFact.length;
    const newFact = factChanged ? edge.fact : existingFact;

    await this.executeQuery(
      `MATCH (source:Entity {uuid: $sourceUuid})-[r:RELATES_TO]->(target:Entity {uuid: $targetUuid})
       WHERE r.relationType = $relationType
       SET r.episodes = $episodes, r.fact = $fact`,
      {
        sourceUuid,
        targetUuid,
        relationType: edge.relationType,
        episodes: newEpisodes,
        fact: newFact,
      },
    );

    await this.executeQuery(
      `MATCH (f:Fact {id: $factId, deletedAt: ''}) SET f.episodes = $episodes, f.text = $fact`,
      { factId: existing.id, episodes: newEpisodes, fact: newFact },
    );

    // Re-embed when fact text changes to prevent stale vector search results
    if (factChanged && embeddings.size > 0) {
      await this.updateFactEmbeddings(existing.id as string, embeddings);
    }
  }

  private async createNewEdge(
    edge: ExtractedEdge,
    edgeId: string,
    embeddings: EmbeddingMap,
    sourceUuid: string,
    targetUuid: string,
    memoryId: string,
    namespace: string,
    createdAt: string,
  ): Promise<void> {
    // RELATES_TO has a single fixed-dimension factEmbedding column (2560)
    // for historical compat — the Fact node mirror carries both 2560 and 384.
    // We name the dimension explicitly here rather than reading the first
    // Map.keys() slot, which depended on insertion order from
    // KNOWN_DIMENSIONS and would silently break if that literal were reordered.
    const EDGE_EMB_DIM = 2560;
    const edgeInfo = this.dimensionRegistry.get(EDGE_EMB_DIM);
    const relEmbStr = edgeInfo
      ? (() => {
          const vec = embeddings.get(EDGE_EMB_DIM);
          return vec && !isZeroEmbedding(vec)
            ? `[${vec.join(",")}]`
            : this.zeroEmbeddingStr(EDGE_EMB_DIM);
        })()
      : `[${new Array(EDGE_EMB_DIM).fill(0).join(",")}]`;

    await this.executeQuery(
      `MATCH (source:Entity {uuid: $sourceUuid})
       MATCH (target:Entity {uuid: $targetUuid})
       CREATE (source)-[r:RELATES_TO {
         id: $id, relationType: $relationType, fact: $fact, sentiment: $sentiment,
         confidence: $confidence, confidenceReason: $confidenceReason,
         factEmbedding: ${relEmbStr}, episodes: $episodes, validAt: $validAt,
         invalidAt: $invalidAt, namespace: $namespace, createdAt: $createdAt
       }]->(target)`,
      {
        sourceUuid,
        targetUuid,
        id: edgeId,
        relationType: edge.relationType,
        fact: edge.fact,
        sentiment: edge.sentiment,
        confidence: edge.confidence ?? 1,
        confidenceReason: edge.confidenceReason ?? "",
        episodes: [memoryId],
        validAt: edge.validAt ?? "",
        invalidAt: "",
        namespace,
        createdAt,
      },
    );

    // Build embedding columns for Fact node (all registered dimensions)
    const factEmbCols: string[] = [];
    for (const [dim, info] of this.dimensionRegistry) {
      const vec = embeddings.get(dim);
      const str = vec && !isZeroEmbedding(vec)
        ? `[${vec.join(",")}]`
        : this.zeroEmbeddingStr(dim);
      factEmbCols.push(`${info.factCol}: ${str}`);
    }

    await this.executeQuery(
      `CREATE (f:Fact {
         id: $id, text: $text, relationType: $relationType, sourceUuid: $sourceUuid,
         targetUuid: $targetUuid, sentiment: $sentiment, confidence: $confidence,
         confidenceReason: $confidenceReason,
         ${factEmbCols.join(", ")},
         episodes: $episodes, validAt: $validAt, invalidAt: $invalidAt,
         namespace: $namespace, createdAt: $createdAt, deletedAt: ''
       })`,
      {
        id: edgeId,
        text: edge.fact,
        relationType: edge.relationType,
        sourceUuid,
        targetUuid,
        sentiment: edge.sentiment,
        confidence: edge.confidence ?? 1,
        confidenceReason: edge.confidenceReason ?? "",
        episodes: [memoryId],
        validAt: edge.validAt ?? "",
        invalidAt: "",
        namespace,
        createdAt,
      },
    );
  }

  async search(
    embedding: number[],
    query: string,
    limit = 10,
    namespace?: string,
  ): Promise<SearchResult> {
    const hasEmbedding = embedding.length > 0;
    const filter = namespace ? { namespace } : undefined;
    const memories = hasEmbedding ? await this.vectorSearch(embedding, limit, filter) : [];
    const [vectorEdges, ftsEdges] = await Promise.all([
      hasEmbedding ? this.vectorSearchEdges(embedding, limit, filter) : Promise.resolve([]),
      this.fullTextSearchEdges(query, limit, filter),
    ]);
    const edges = rrfFuse(vectorEdges, ftsEdges, limit);

    const entityWhere = namespace
      ? "WHERE LOWER(e.name) CONTAINS LOWER($query) AND e.deletedAt = '' AND e.namespace = $namespace"
      : "WHERE LOWER(e.name) CONTAINS LOWER($query) AND e.deletedAt = ''";
    const entityParams: Record<string, unknown> = { query, limit };
    if (namespace) entityParams.namespace = namespace;
    const entityResult = await this.executeQuery(
      `MATCH (e:Entity)
       ${entityWhere}
       RETURN e.uuid as uuid, e.name as name, e.type as type, e.scope as scope,
              e.description as description, e.summary as summary, e.namespace as namespace
       LIMIT $limit`,
      entityParams,
    );

    const entityRows = await entityResult.getAll();
    const entities: StoredEntity[] = entityRows.map((r) => ({
      uuid: r.uuid as string,
      name: r.name as string,
      type: r.type as StoredEntity["type"],
      scope: (r.scope as "project" | "global") ?? "project",
      description: (r.description as string) || undefined,
      summary: (r.summary as string) || undefined,
      namespace: (r.namespace as string) ?? "",
    }));

    return { memories, edges, entities };
  }

  async vectorSearch(
    embedding: number[],
    limit: number,
    filter?: MemoryFilter,
  ): Promise<Memory[]> {
    const overfetchLimit = limit * 3;
    const conditions: string[] = ["node.deletedAt = ''"];
    const params: Record<string, unknown> = {};
    if (filter?.namespace === null) {
      conditions.push("node.namespace = ''");
    } else if (filter?.namespace !== undefined) {
      conditions.push("node.namespace = $namespace");
      params.namespace = filter.namespace;
    }
    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const embeddingStr = `[${embedding.join(",")}]`;
    const activeDim = getActiveDimension();
    const dimInfo = activeDim ? this.dimensionRegistry.get(activeDim) : undefined;
    const indexName = dimInfo?.memoryIndex ?? "memory_vec_idx";
    const result = await this.executeQuery(
      `CALL QUERY_VECTOR_INDEX('Memory', '${indexName}', ${embeddingStr}, ${overfetchLimit})
       WITH node, distance
       ${whereClause}
       RETURN node.id as id, node.name as name, node.text as text, node.summary as summary,
              node.category as category, node.namespace as namespace, node.status as status,
              node.error as error, node.createdAt as createdAt, distance
       ORDER BY distance ASC`,
      params,
    );

    const rows = await result.getAll();
    return rows.slice(0, limit).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      text: r.text as string,
      summary: r.summary as string,
      abstract: (r.abstract as string) || "",
      category: ((r.category as string) || undefined) as Memory["category"],
      namespace: r.namespace as string,
      status: (r.status as Memory["status"]) ?? "completed",
      error: (r.error as string) || undefined,
      schemaVersion: (r.schemaVersion as string) || "0.0.0",
      versionedAt: (r.versionedAt as string) || undefined,
      createdAt: new Date(r.createdAt as string),
    }));
  }

  async vectorSearchEdges(
    embedding: number[],
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]> {
    const overfetchLimit = limit * 3;
    const conditions: string[] = ["node.deletedAt = ''"];
    const params: Record<string, unknown> = { limit };
    if (filter?.namespace === null) {
      conditions.push("node.namespace = ''");
    } else if (filter?.namespace !== undefined) {
      conditions.push("node.namespace = $namespace");
      params.namespace = filter.namespace;
    }
    if (!filter?.includeInvalidated) {
      conditions.push("node.invalidAt = ''");
    }
    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const embeddingStr = `[${embedding.join(",")}]`;
    const activeDim = getActiveDimension();
    const dimInfo = activeDim ? this.dimensionRegistry.get(activeDim) : undefined;
    const indexName = dimInfo?.factIndex ?? "fact_vec_idx";
    const result = await this.executeQuery(
      `CALL QUERY_VECTOR_INDEX('Fact', '${indexName}', ${embeddingStr}, ${overfetchLimit})
       WITH node, distance
       ${whereClause}
       MATCH (source:Entity {uuid: node.sourceUuid, deletedAt: ''})
       MATCH (target:Entity {uuid: node.targetUuid, deletedAt: ''})
       RETURN node.id as id, source.name as sourceEntityName, target.name as targetEntityName,
              node.relationType as relationType, node.text as fact, node.sentiment as sentiment,
              node.confidence as confidence, node.confidenceReason as confidenceReason,
              node.episodes as episodes, node.namespace as namespace, node.validAt as validAt,
              node.invalidAt as invalidAt, node.createdAt as createdAt, distance
       ORDER BY distance ASC
       LIMIT $limit`,
      params,
    );

    const rows = await result.getAll();
    return this.mapEdgeRows(rows);
  }

  async fullTextSearchEdges(
    query: string,
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]> {
    const conditions: string[] = ["node.deletedAt = ''"];
    const params: Record<string, unknown> = { limit };
    if (filter?.namespace === null) {
      conditions.push("node.namespace = ''");
    } else if (filter?.namespace !== undefined) {
      conditions.push("node.namespace = $namespace");
      params.namespace = filter.namespace;
    }
    if (!filter?.includeInvalidated) {
      conditions.push("node.invalidAt = ''");
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const escapedQuery = this.escapeFtsQuery(query);
    const result = await this.executeQuery(
      `CALL QUERY_FTS_INDEX('Fact', 'fact_fts_idx', '${escapedQuery}', top := ${limit * 3})
       WITH node, score
       ${whereClause}
       MATCH (source:Entity {uuid: node.sourceUuid, deletedAt: ''})
       MATCH (target:Entity {uuid: node.targetUuid, deletedAt: ''})
       RETURN node.id as id, source.name as sourceEntityName, target.name as targetEntityName,
              node.relationType as relationType, node.text as fact, node.sentiment as sentiment,
              node.confidence as confidence, node.confidenceReason as confidenceReason,
              node.episodes as episodes, node.namespace as namespace, node.validAt as validAt,
              node.invalidAt as invalidAt, node.createdAt as createdAt, score
       ORDER BY score DESC
       LIMIT $limit`,
      params,
    );

    const rows = await result.getAll();
    return this.mapEdgeRows(rows);
  }

  async get(name: string, namespace = "default"): Promise<GetResult> {
    const memResult = await this.executeQuery(
      `MATCH (m:Memory {name: $name, namespace: $namespace, deletedAt: ''})
       RETURN m.id as id, m.name as name, m.text as text, m.summary as summary,
              m.category as category, m.namespace as namespace, m.status as status,
              m.error as error, m.createdAt as createdAt`,
      { name, namespace },
    );

    const memRows = await memResult.getAll();
    const memory: Memory | undefined =
      memRows.length > 0
        ? {
            id: memRows[0].id as string,
            name: memRows[0].name as string,
            text: memRows[0].text as string,
            summary: memRows[0].summary as string,
            abstract: (memRows[0].abstract as string) || "",
            category: ((memRows[0].category as string) || undefined) as Memory["category"],
            namespace: memRows[0].namespace as string,
            status: (memRows[0].status as Memory["status"]) ?? "completed",
            error: (memRows[0].error as string) || undefined,
            schemaVersion: (memRows[0].schemaVersion as string) || "0.0.0",
            versionedAt: (memRows[0].versionedAt as string) || undefined,
            createdAt: new Date(memRows[0].createdAt as string),
          }
        : undefined;

    const entityResult = await this.executeQuery(
      `MATCH (e:Entity {name: $name, namespace: $namespace, deletedAt: ''})
       RETURN e.uuid as uuid, e.name as name, e.type as type, e.scope as scope,
              e.description as description, e.summary as summary, e.namespace as namespace`,
      { name, namespace },
    );

    const entityRows = await entityResult.getAll();
    const entity: StoredEntity | undefined =
      entityRows.length > 0
        ? {
            uuid: entityRows[0].uuid as string,
            name: entityRows[0].name as string,
            type: entityRows[0].type as StoredEntity["type"],
            scope: (entityRows[0].scope as "project" | "global") ?? "project",
            description: (entityRows[0].description as string) || undefined,
            summary: (entityRows[0].summary as string) || undefined,
            namespace: (entityRows[0].namespace as string) ?? "",
          }
        : undefined;

    let edges: StoredEdge[] = [];

    if (memory) {
      const edgeResult = await this.executeQuery(
        `MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
         WHERE $memoryId IN r.episodes
         RETURN r.id as id, source.name as sourceEntityName, target.name as targetEntityName,
                r.relationType as relationType, r.fact as fact, r.sentiment as sentiment,
                r.confidence as confidence, r.confidenceReason as confidenceReason,
                r.episodes as episodes, source.namespace as namespace, r.validAt as validAt,
                r.invalidAt as invalidAt, r.createdAt as createdAt`,
        { memoryId: memory.id },
      );
      const edgeRows = await edgeResult.getAll();
      edges = this.mapEdgeRows(edgeRows);
    } else if (entity) {
      const edgeResult = await this.executeQuery(
        `MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
         WHERE (source.name = $name OR target.name = $name) AND source.namespace = $namespace
         RETURN r.id as id, source.name as sourceEntityName, target.name as targetEntityName,
                r.relationType as relationType, r.fact as fact, r.sentiment as sentiment,
                r.confidence as confidence, r.confidenceReason as confidenceReason,
                r.episodes as episodes, source.namespace as namespace, r.validAt as validAt,
                r.invalidAt as invalidAt, r.createdAt as createdAt
         ORDER BY r.createdAt DESC`,
        { name, namespace },
      );
      const edgeRows = await edgeResult.getAll();
      edges = this.mapEdgeRows(edgeRows);
    }

    return { memory, entity, edges };
  }

  private mapEdgeRows(rows: Record<string, unknown>[]): StoredEdge[] {
    return rows.map((r) => ({
      id: r.id as string,
      sourceEntityName: r.sourceEntityName as string,
      targetEntityName: r.targetEntityName as string,
      relationType: r.relationType as string,
      fact: r.fact as string,
      sentiment: (r.sentiment as number) ?? 0,
      confidence: (r.confidence as number) ?? 1,
      confidenceReason: ((r.confidenceReason as string) || undefined),
      episodes: (r.episodes as string[]) ?? [],
      namespace: r.namespace as string,
      validAt:
        r.validAt && r.validAt !== ""
          ? new Date(r.validAt as string)
          : undefined,
      invalidAt:
        r.invalidAt && r.invalidAt !== ""
          ? new Date(r.invalidAt as string)
          : undefined,
      createdAt: new Date(r.createdAt as string),
    }));
  }

  async forget(name: string, namespace = "default"): Promise<ForgetResult> {
    const now = new Date().toISOString();
    let deletedMemory = false;
    let deletedEntity = false;

    const memResult = await this.executeQuery(
      `MATCH (m:Memory {name: $name, namespace: $namespace, deletedAt: ''})
       SET m.deletedAt = $now
       RETURN count(m) as deleted`,
      { name, namespace, now },
    );
    const memRows = await memResult.getAll();
    deletedMemory = ((memRows[0]?.deleted as number) ?? 0) > 0;

    const entityUuidResult = await this.executeQuery(
      `MATCH (e:Entity {name: $name, namespace: $namespace, deletedAt: ''})
       RETURN e.uuid as uuid`,
      { name, namespace },
    );
    const entityUuidRows = await entityUuidResult.getAll();

    if (entityUuidRows.length > 0) {
      const entityUuid = entityUuidRows[0].uuid as string;

      await this.executeQuery(
        `MATCH (f:Fact {deletedAt: ''})
         WHERE f.sourceUuid = $uuid OR f.targetUuid = $uuid
         SET f.deletedAt = $now`,
        { uuid: entityUuid, now },
      );

      const entityResult = await this.executeQuery(
        `MATCH (e:Entity {name: $name, namespace: $namespace, deletedAt: ''})
         SET e.deletedAt = $now
         RETURN count(e) as deleted`,
        { name, namespace, now },
      );
      const entityRows = await entityResult.getAll();
      deletedEntity = ((entityRows[0]?.deleted as number) ?? 0) > 0;
    }

    return { deletedMemory, deletedEntity };
  }

  async forgetEdge(
    edgeId: string,
    reason: string,
    namespace = "default",
  ): Promise<ForgetEdgeResult> {
    const now = new Date().toISOString();

    const result = await this.executeQuery(
      `MATCH (source:Entity)-[r:RELATES_TO {id: $edgeId}]->(target:Entity)
       WHERE source.namespace = $namespace
       SET r.invalidAt = $now
       RETURN r.id as id, source.name as sourceEntityName, target.name as targetEntityName,
              r.relationType as relationType, r.fact as fact, r.sentiment as sentiment,
              r.confidence as confidence, r.confidenceReason as confidenceReason,
              r.episodes as episodes, source.namespace as namespace, r.validAt as validAt,
              r.invalidAt as invalidAt, r.createdAt as createdAt`,
      { edgeId, namespace, now },
    );

    const rows = await result.getAll();
    if (rows.length === 0) return {};

    const r = rows[0];
    const invalidatedEdge: StoredEdge = {
      id: r.id as string,
      sourceEntityName: r.sourceEntityName as string,
      targetEntityName: r.targetEntityName as string,
      relationType: r.relationType as string,
      fact: r.fact as string,
      sentiment: (r.sentiment as number) ?? 0,
      confidence: (r.confidence as number) ?? 1,
      confidenceReason: ((r.confidenceReason as string) || undefined),
      episodes: (r.episodes as string[]) ?? [],
      namespace: r.namespace as string,
      validAt:
        r.validAt && r.validAt !== ""
          ? new Date(r.validAt as string)
          : undefined,
      invalidAt:
        r.invalidAt && r.invalidAt !== ""
          ? new Date(r.invalidAt as string)
          : undefined,
      createdAt: new Date(r.createdAt as string),
    };

    await this.executeQuery(
      `MATCH (f:Fact {id: $edgeId}) SET f.invalidAt = $now`,
      { edgeId, now },
    );

    const auditMemoryId = randomUUID();
    const auditText = `Invalidated fact "${invalidatedEdge.fact}" because: ${reason}`;

    // Build zero embedding columns for audit memory
    const auditEmbCols: string[] = [];
    for (const [dim, info] of this.dimensionRegistry) {
      auditEmbCols.push(`${info.memoryCol}: ${this.zeroEmbeddingStr(dim)}`);
    }
    await this.executeQuery(
      `CREATE (m:Memory {
         id: $id, name: $name, text: $text, summary: $summary, category: $category,
         namespace: $namespace, status: 'completed', error: '',
         ${auditEmbCols.join(", ")},
         createdAt: $createdAt, deletedAt: ''
       })`,
      {
        id: auditMemoryId,
        name: `Invalidation: ${invalidatedEdge.fact.slice(0, 50)}...`,
        text: auditText,
        summary: auditText,
        category: "",
        namespace,
        createdAt: now,
      },
    );

    return { invalidatedEdge, auditMemoryId };
  }

  async storeMemoryOnly(memory: Memory): Promise<void> {
    const embCols: string[] = [];
    for (const [dim, info] of this.dimensionRegistry) {
      embCols.push(`${info.memoryCol}: ${this.zeroEmbeddingStr(dim)}`);
    }
    await this.executeQuery(
      `CREATE (m:Memory {
         id: $id, name: $name, text: $text, abstract: $abstract, summary: $summary,
         category: $category, namespace: $namespace, status: $status, error: $error,
         schemaVersion: $schemaVersion, versionedAt: $versionedAt,
         ${embCols.join(", ")},
         createdAt: $createdAt, deletedAt: ''
       })`,
      {
        id: memory.id,
        name: memory.name,
        text: memory.text,
        abstract: memory.abstract ?? "",
        summary: memory.summary,
        category: memory.category ?? "",
        namespace: memory.namespace,
        status: memory.status,
        error: memory.error ?? "",
        schemaVersion: memory.schemaVersion ?? "0.0.0",
        versionedAt: memory.versionedAt ?? new Date().toISOString(),
        createdAt: memory.createdAt.toISOString(),
      },
    );
  }

  async updateMemoryStatus(
    id: string,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string,
  ): Promise<void> {
    await this.executeQuery(
      `MATCH (m:Memory {id: $id, deletedAt: ''}) SET m.status = $status, m.error = $error`,
      {
        id,
        status,
        error: error ?? "",
      },
    );
  }

  async getPendingMemories(namespace?: string, limit = 10): Promise<Memory[]> {
    // Parameterized to prevent Cypher injection and match the rest of the
    // provider's query style. Limit is interpolated because LadybugDB does
    // not yet support LIMIT bound params — guarded by a numeric coercion.
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 10;
    const whereClause = namespace !== undefined
      ? "WHERE m.status = 'pending' AND m.deletedAt = '' AND m.namespace = $namespace"
      : "WHERE m.status = 'pending' AND m.deletedAt = ''";

    const result = await this.executeQuery(
      `MATCH (m:Memory) ${whereClause} RETURN m ORDER BY m.createdAt ASC LIMIT ${safeLimit}`,
      namespace !== undefined ? { namespace } : {},
    );

    const rows = await result.getAll();
    return rows.map((row) => {
      const m = row.m as Record<string, unknown>;
      return {
        id: m.id as string,
        name: m.name as string,
        text: m.text as string,
        summary: m.summary as string,
        abstract: (m.abstract as string) || "",
        category: ((m.category as string) || undefined) as Memory["category"],
        namespace: m.namespace as string,
        status: (m.status as Memory["status"]) ?? "pending",
        error: (m.error as string) || undefined,
        schemaVersion: (m.schemaVersion as string) || "0.0.0",
        versionedAt: (m.versionedAt as string) || undefined,
        createdAt: new Date(m.createdAt as string),
      };
    });
  }

  async storeEntity(entity: StoredEntity): Promise<void> {
    await this.executeQuery(
      `MERGE (e:Entity {uuid: $uuid, deletedAt: ''})
       SET e.name = $name, e.type = $type, e.description = $description,
           e.namespace = $namespace, e.scope = $scope, e.summary = $summary`,
      {
        uuid: entity.uuid,
        name: entity.name,
        type: entity.type,
        description: entity.description ?? "",
        namespace: entity.namespace ?? "",
        scope: entity.scope ?? "project",
        summary: entity.summary ?? "",
      },
    );
  }

  async findEntities(
    filter: EntityFilter,
    limit = 100,
    pagination?: PaginationParams,
  ): Promise<StoredEntity[]> {
    // User-supplied filter values flow through MCP search and HTTP routes.
    // String interpolation here would be a Cypher injection vector — every
    // value-bearing predicate is bound via $params and executeQuery's
    // prepare/execute path.
    const conditions: string[] = ["e.deletedAt = ''"];
    const params: Record<string, unknown> = {};
    if (filter.uuid) { conditions.push(`e.uuid = $uuid`); params.uuid = filter.uuid; }
    if (filter.name) { conditions.push(`LOWER(e.name) CONTAINS LOWER($name)`); params.name = filter.name; }
    if (filter.namespace === null) conditions.push("e.namespace = ''");
    else if (filter.namespace !== undefined) {
      conditions.push(`e.namespace = $namespace`);
      params.namespace = filter.namespace;
    }
    if (filter.scope) { conditions.push(`e.scope = $scope`); params.scope = filter.scope; }
    if (filter.type) { conditions.push(`e.type = $type`); params.type = filter.type; }

    // LadybugDB doesn't bind LIMIT/SKIP as params — these are interpolated.
    // Guard against NaN / Infinity / non-integer from MCP or HTTP callers
    // (review pass 7 finding #7; matches the pattern already used in
    // getPendingMemories).
    const safeLimit = safePagInt(pagination?.limit ?? limit, 100);
    const safeOffset = safePagInt(pagination?.offset ?? 0, 0);
    const sortCol = "e.name";
    const sortDir = "ASC";
    // Tiebreak on uuid for stable pagination across rows with duplicate names.
    const tiebreak = `, e.uuid ${sortDir}`;

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const result = await this.executeQuery(
      `MATCH (e:Entity) ${whereClause} RETURN e ORDER BY ${sortCol} ${sortDir}${tiebreak} SKIP ${safeOffset} LIMIT ${safeLimit}`,
      params,
    );

    const rows = await result.getAll();
    return rows.map((row) => {
      const e = row.e as Record<string, unknown>;
      return {
        uuid: e.uuid as string,
        name: e.name as string,
        type: e.type as StoredEntity["type"],
        description: (e.description as string) || undefined,
        namespace: (e.namespace as string) ?? "",
        scope: (e.scope as "project" | "global") ?? "project",
        summary: (e.summary as string) || undefined,
      };
    });
  }

  async findEdges(filter: EdgeFilter, limit = 100, pagination?: PaginationParams): Promise<StoredEdge[]> {
    // See findEntities — every value-bearing predicate is parameterized to
    // close the Cypher injection vector for MCP/HTTP-supplied filters.
    const conditions: string[] = [
      "source.deletedAt = ''",
      "target.deletedAt = ''",
    ];
    const params: Record<string, unknown> = {};
    if (filter.id) { conditions.push(`r.id = $id`); params.id = filter.id; }
    if (filter.namespace === null) conditions.push("source.namespace = ''");
    else if (filter.namespace !== undefined) {
      conditions.push(`source.namespace = $namespace`);
      params.namespace = filter.namespace;
    }
    if (filter.sourceEntityName) {
      conditions.push(`source.name = $sourceEntityName`);
      params.sourceEntityName = filter.sourceEntityName;
    }
    if (filter.targetEntityName) {
      conditions.push(`target.name = $targetEntityName`);
      params.targetEntityName = filter.targetEntityName;
    }
    if (filter.relationType) {
      conditions.push(`r.relationType = $relationType`);
      params.relationType = filter.relationType;
    }
    if (!filter.includeInvalidated) conditions.push("r.invalidAt = ''");

    // See findEntities: LadybugDB does not bind LIMIT/SKIP as params.
    const safeLimit = safePagInt(pagination?.limit ?? limit, 100);
    const safeOffset = safePagInt(pagination?.offset ?? 0, 0);
    const sortCol = pagination?.sortBy === "name" ? "r.fact" : "r.createdAt";
    const sortDir = pagination?.sortDir === "asc" ? "ASC" : "DESC";
    // Tiebreak on r.id for stable pagination across rows with duplicate
    // createdAt or fact text.
    const tiebreak = `, r.id ${sortDir}`;

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const result = await this.executeQuery(
      `MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
       ${whereClause}
       RETURN r.id as id, source.name as sourceEntityName, target.name as targetEntityName,
              r.relationType as relationType, r.fact as fact, r.sentiment as sentiment,
              r.confidence as confidence, r.confidenceReason as confidenceReason,
              r.episodes as episodes, source.namespace as namespace, r.validAt as validAt,
              r.invalidAt as invalidAt, r.createdAt as createdAt
       ORDER BY ${sortCol} ${sortDir}${tiebreak}
       SKIP ${safeOffset}
       LIMIT ${safeLimit}`,
      params,
    );

    const rows = await result.getAll();
    return this.mapEdgeRows(rows);
  }

  async findMemories(filter: MemoryFilter, limit = 100, pagination?: PaginationParams): Promise<Memory[]> {
    // See findEntities — every value-bearing predicate is parameterized to
    // close the Cypher injection vector for MCP/HTTP-supplied filters.
    const conditions: string[] = ["m.deletedAt = ''"];
    const params: Record<string, unknown> = {};
    if (filter.id) { conditions.push(`m.id = $id`); params.id = filter.id; }
    if (filter.name) { conditions.push(`LOWER(m.name) CONTAINS LOWER($name)`); params.name = filter.name; }
    if (filter.namespace === null) conditions.push("m.namespace = ''");
    else if (filter.namespace !== undefined) {
      conditions.push(`m.namespace = $namespace`);
      params.namespace = filter.namespace;
    }
    if (filter.category) { conditions.push(`m.category = $category`); params.category = filter.category; }
    if (filter.cursorCreatedAt !== undefined) {
      // Cursor-based pagination: `createdAt > $cursor` OR (tied createdAt AND
      // `id > $cursorId`). Parity with the PaginationParams sort direction —
      // the cursor comparator flips for descending scans. Review pass 7 #14.
      const iso = filter.cursorCreatedAt.toISOString();
      params.cursorCreatedAt = iso;
      const dir = pagination?.sortDir === "asc" ? ">" : "<";
      if (filter.cursorId !== undefined) {
        params.cursorId = filter.cursorId;
        conditions.push(`(m.createdAt ${dir} $cursorCreatedAt OR (m.createdAt = $cursorCreatedAt AND m.id ${dir} $cursorId))`);
      } else {
        conditions.push(`m.createdAt ${dir} $cursorCreatedAt`);
      }
    }

    // See findEntities: LadybugDB does not bind LIMIT/SKIP as params.
    const safeLimit = safePagInt(pagination?.limit ?? limit, 100);
    const safeOffset = safePagInt(pagination?.offset ?? 0, 0);
    const sortCol = pagination?.sortBy === "name" ? "m.name" : "m.createdAt";
    const sortDir = pagination?.sortDir === "asc" ? "ASC" : "DESC";
    // Always tiebreak on m.id — without it, rows sharing createdAt (or name)
    // shuffle between pages under offset-based pagination, producing duplicates
    // and silently skipping rows. The migration spec mandates stable order.
    const tiebreak = `, m.id ${sortDir}`;

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const result = await this.executeQuery(
      `MATCH (m:Memory) ${whereClause}
       RETURN m.id as id, m.name as name, m.text as text, m.summary as summary,
              m.category as category, m.namespace as namespace, m.status as status,
              m.error as error, m.createdAt as createdAt
       ORDER BY ${sortCol} ${sortDir}${tiebreak}
       SKIP ${safeOffset}
       LIMIT ${safeLimit}`,
      params,
    );

    const rows = await result.getAll();
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      text: r.text as string,
      summary: r.summary as string,
      abstract: (r.abstract as string) || "",
      category: ((r.category as string) || undefined) as Memory["category"],
      namespace: r.namespace as string,
      status: (r.status as Memory["status"]) ?? "completed",
      error: (r.error as string) || undefined,
      schemaVersion: (r.schemaVersion as string) || "0.0.0",
      versionedAt: (r.versionedAt as string) || undefined,
      createdAt: new Date(r.createdAt as string),
    }));
  }

  async stats(namespace?: string): Promise<Stats> {
    const memConditions = ["m.deletedAt = ''"];
    const entityConditions = ["e.deletedAt = ''"];
    const edgeConditions = ["source.deletedAt = ''", "target.deletedAt = ''"];
    const params: Record<string, unknown> = {};

    if (namespace) {
      memConditions.push("m.namespace = $namespace");
      entityConditions.push("e.namespace = $namespace");
      edgeConditions.push("source.namespace = $namespace");
      params.namespace = namespace;
    }

    const memWhere = `WHERE ${memConditions.join(" AND ")}`;
    const entityWhere = `WHERE ${entityConditions.join(" AND ")}`;
    const edgeWhere = `WHERE ${edgeConditions.join(" AND ")}`;

    const memResult = await this.executeQuery(
      `MATCH (m:Memory) ${memWhere} RETURN count(m) as count`,
      params,
    );
    const memRows = await memResult.getAll();
    const memories = Number(memRows[0]?.count ?? 0);

    const entityResult = await this.executeQuery(
      `MATCH (e:Entity) ${entityWhere} RETURN count(e) as count`,
      params,
    );
    const entityRows = await entityResult.getAll();
    const entities = Number(entityRows[0]?.count ?? 0);

    const edgeResult = await this.executeQuery(
      `MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity) ${edgeWhere} RETURN count(r) as count`,
      params,
    );
    const edgeRows = await edgeResult.getAll();
    const edges = Number(edgeRows[0]?.count ?? 0);

    return { memories, entities, edges };
  }

  async listNamespaces(): Promise<string[]> {
    const result = await this.conn.query(
      `MATCH (e:Entity) WHERE e.namespace <> '' AND e.deletedAt = '' RETURN DISTINCT e.namespace as namespace ORDER BY namespace`,
    );
    const rows = await result.getAll();
    return rows.map((r) => r.namespace as string);
  }

  async deleteByNamespace(namespace: string): Promise<void> {
    const now = new Date().toISOString();
    await this.executeQuery(
      `MATCH (m:Memory {namespace: $namespace, deletedAt: ''}) SET m.deletedAt = $now`,
      { namespace, now },
    );
    await this.executeQuery(
      `MATCH (f:Fact {namespace: $namespace, deletedAt: ''}) SET f.deletedAt = $now`,
      { namespace, now },
    );
    await this.executeQuery(
      `MATCH (e:Entity {namespace: $namespace, deletedAt: ''}) SET e.deletedAt = $now`,
      { namespace, now },
    );
  }

  async getGraphData(namespace?: string): Promise<GraphData> {
    const params: Record<string, unknown> = {};
    const entityNsFilter = namespace ? "AND e.namespace = $namespace" : "";
    const relNsFilter = namespace ? "AND s.namespace = $namespace" : "";
    if (namespace) params.namespace = namespace;

    const entityResult = await this.executeQuery(
      `MATCH (e:Entity)
       WHERE e.deletedAt = '' ${entityNsFilter}
       RETURN e.uuid as id, e.name as name, e.type as type,
              e.namespace as namespace, e.description as description, e.summary as summary
       ORDER BY e.name`,
      params,
    );
    const entityRows = await entityResult.getAll();
    const nodes = entityRows.map((r) => ({
      id: (r.name as string) || (r.id as string),
      name: r.name as string,
      type: r.type as string,
      namespace: (r.namespace as string) || undefined,
      description: (r.description as string) || undefined,
      summary: (r.summary as string) || undefined,
    }));

    const nodeNames = new Set(nodes.map((n) => n.name));

    const relResult = await this.executeQuery(
      `MATCH (s:Entity)-[r:RELATES_TO]->(t:Entity)
       WHERE (r.invalidAt IS NULL OR r.invalidAt = '') ${relNsFilter}
       RETURN s.name as source, t.name as target,
              r.relationType as relationType, r.fact as fact,
              r.sentiment as sentiment, r.confidence as confidence,
              r.id as edgeId
       ORDER BY s.name, t.name`,
      params,
    );
    const relRows = await relResult.getAll();
    const links = relRows
      .map((r) => ({
        source: r.source as string,
        target: r.target as string,
        relationType: r.relationType as string,
        fact: r.fact as string,
        sentiment: (r.sentiment as number) ?? 0,
        confidence: (r.confidence as number) ?? 1,
        edgeId: r.edgeId as string,
      }))
      .filter((l) => nodeNames.has(l.source) && nodeNames.has(l.target));

    return { nodes, links };
  }

  async findMemoriesNeedingEmbedding(
    dimension: number,
  ): Promise<Memory[]> {
    const info = this.dimensionRegistry.get(dimension);
    if (!info) return [];
    const col = info.memoryCol;
    // Zero-vector sentinel: first element is 0.0 (real embeddings never have exactly 0)
    const result = await this.conn.query(
      `MATCH (m:Memory)
       WHERE m.deletedAt = '' AND m.${col}[1] = 0.0 AND m.text IS NOT NULL AND m.text <> ''
       RETURN m.id as id, m.name as name, m.text as text, m.abstract as abstract,
              m.summary as summary, m.category as category, m.namespace as namespace,
              m.status as status, m.error as error, m.schemaVersion as schemaVersion,
              m.versionedAt as versionedAt, m.createdAt as createdAt`,
    );
    const rows = await result.getAll();
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      text: r.text as string,
      summary: r.summary as string,
      abstract: (r.abstract as string) || "",
      category: ((r.category as string) || undefined) as Memory["category"],
      namespace: r.namespace as string,
      status: (r.status as Memory["status"]) ?? "completed",
      error: (r.error as string) || undefined,
      schemaVersion: (r.schemaVersion as string) || "0.0.0",
      versionedAt: (r.versionedAt as string) || undefined,
      createdAt: new Date(r.createdAt as string),
    }));
  }

  async findEdgesNeedingEmbedding(
    dimension: number,
  ): Promise<Array<{ id: string; fact: string }>> {
    const info = this.dimensionRegistry.get(dimension);
    if (!info) return [];
    const col = info.factCol;
    const result = await this.conn.query(
      `MATCH (f:Fact)
       WHERE f.deletedAt = '' AND f.${col}[1] = 0.0 AND f.text IS NOT NULL AND f.text <> ''
       RETURN f.id as id, f.text as fact`,
    );
    const rows = await result.getAll();
    return rows.map((r) => ({
      id: r.id as string,
      fact: r.fact as string,
    }));
  }

  async updateMemoryEmbeddings(
    memoryId: string,
    embeddings: EmbeddingMap,
  ): Promise<void> {
    // Check if any embedding is real (non-zero)
    let hasAny = false;
    for (const [, vec] of embeddings) {
      if (!isZeroEmbedding(vec)) { hasAny = true; break; }
    }
    if (!hasAny) return;

    // Ensure dimensions exist in schema
    for (const dim of embeddings.keys()) {
      await this.ensureDimension(dim);
    }

    // Read existing memory fields (including current embeddings to preserve)
    const embReturnCols = [...this.dimensionRegistry.entries()]
      .map(([, info]) => `m.${info.memoryCol} as ${info.memoryCol}`)
      .join(", ");
    const result = await this.executeQuery(
      `MATCH (m:Memory {id: $id, deletedAt: ''})
       RETURN m.id as id, m.name as name, m.text as text, m.summary as summary,
              m.category as category, m.namespace as namespace, m.status as status,
              m.error as error, ${embReturnCols}, m.createdAt as createdAt`,
      { id: memoryId },
    );
    const rows = await result.getAll();
    if (rows.length === 0) return;
    const m = rows[0]!;

    // Build embedding column strings, preserving existing when new is zero
    const embCols: string[] = [];
    for (const [dim, info] of this.dimensionRegistry) {
      const newVec = embeddings.get(dim);
      const hasNew = newVec && !isZeroEmbedding(newVec);
      const finalVec = hasNew ? newVec : (m[info.memoryCol] as number[]);
      embCols.push(`${info.memoryCol}: [${finalVec.join(",")}]`);
    }

    // Delete + recreate (LadybugDB can't SET vector-indexed columns)
    await this.executeQuery(
      `MATCH (m:Memory {id: $id, deletedAt: ''}) DELETE m`,
      { id: memoryId },
    );
    await this.executeQuery(
      `CREATE (m:Memory {
         id: $id, name: $name, text: $text, summary: $summary,
         category: $category, namespace: $namespace, status: $status, error: $error,
         ${embCols.join(", ")},
         createdAt: $createdAt, deletedAt: ''
       })`,
      {
        id: m.id as string,
        name: (m.name as string) ?? "",
        text: (m.text as string) ?? "",
        summary: (m.summary as string) ?? "",
        category: (m.category as string) ?? "",
        namespace: (m.namespace as string) ?? "",
        status: (m.status as string) ?? "completed",
        error: (m.error as string) ?? "",
        createdAt: (m.createdAt as string) ?? new Date().toISOString(),
      },
    );
  }

  async updateFactEmbeddings(
    factId: string,
    embeddings: EmbeddingMap,
  ): Promise<void> {
    // Check if any embedding is real (non-zero)
    let hasAny = false;
    for (const [, vec] of embeddings) {
      if (!isZeroEmbedding(vec)) { hasAny = true; break; }
    }
    if (!hasAny) return;

    // Ensure dimensions exist in schema
    for (const dim of embeddings.keys()) {
      await this.ensureDimension(dim);
    }

    // Read existing fact fields (including current embeddings to preserve)
    const embReturnCols = [...this.dimensionRegistry.entries()]
      .map(([, info]) => `f.${info.factCol} as ${info.factCol}`)
      .join(", ");
    const result = await this.executeQuery(
      `MATCH (f:Fact {id: $id, deletedAt: ''})
       RETURN f.id as id, f.text as text, f.relationType as relationType,
              f.sourceUuid as sourceUuid, f.targetUuid as targetUuid,
              f.sentiment as sentiment, f.confidence as confidence,
              f.confidenceReason as confidenceReason, f.episodes as episodes,
              ${embReturnCols},
              f.validAt as validAt, f.invalidAt as invalidAt,
              f.namespace as namespace, f.createdAt as createdAt`,
      { id: factId },
    );
    const rows = await result.getAll();
    if (rows.length === 0) return;
    const f = rows[0]!;

    // Build embedding column strings, preserving existing when new is zero
    const embCols: string[] = [];
    for (const [dim, info] of this.dimensionRegistry) {
      const newVec = embeddings.get(dim);
      const hasNew = newVec && !isZeroEmbedding(newVec);
      const finalVec = hasNew ? newVec : (f[info.factCol] as number[]);
      embCols.push(`${info.factCol}: [${finalVec.join(",")}]`);
    }

    // Delete + recreate (LadybugDB can't SET vector-indexed columns)
    await this.executeQuery(
      `MATCH (f:Fact {id: $id, deletedAt: ''}) DELETE f`,
      { id: factId },
    );
    await this.executeQuery(
      `CREATE (f:Fact {
         id: $id, text: $text, relationType: $relationType, sourceUuid: $sourceUuid,
         targetUuid: $targetUuid, sentiment: $sentiment, confidence: $confidence,
         confidenceReason: $confidenceReason,
         ${embCols.join(", ")},
         episodes: $episodes, validAt: $validAt, invalidAt: $invalidAt,
         namespace: $namespace, createdAt: $createdAt, deletedAt: ''
       })`,
      {
        id: f.id as string,
        text: f.text as string,
        relationType: f.relationType as string,
        sourceUuid: f.sourceUuid as string,
        targetUuid: f.targetUuid as string,
        sentiment: f.sentiment as number,
        confidence: (f.confidence as number) ?? 1,
        confidenceReason: (f.confidenceReason as string) ?? "",
        episodes: (f.episodes as string[]) ?? [],
        validAt: (f.validAt as string) ?? "",
        invalidAt: (f.invalidAt as string) ?? "",
        namespace: (f.namespace as string) ?? "",
        createdAt: (f.createdAt as string) ?? new Date().toISOString(),
      },
    );
  }

  async purgeDeleted(): Promise<{
    memories: number;
    entities: number;
    facts: number;
  }> {
    const memResult = await this.conn.query(
      `MATCH (m:Memory) WHERE m.deletedAt <> '' DELETE m RETURN count(m) as count`,
    );
    const memRows = await memResult.getAll();
    const memories = Number(memRows[0]?.count ?? 0);

    const factResult = await this.conn.query(
      `MATCH (f:Fact) WHERE f.deletedAt <> '' DELETE f RETURN count(f) as count`,
    );
    const factRows = await factResult.getAll();
    const facts = Number(factRows[0]?.count ?? 0);

    const entityResult = await this.conn.query(
      `MATCH (e:Entity) WHERE e.deletedAt <> '' DELETE e RETURN count(e) as count`,
    );
    const entityRows = await entityResult.getAll();
    const entities = Number(entityRows[0]?.count ?? 0);

    return { memories, entities, facts };
  }

  async updateMemorySummary(
    memoryId: string,
    fields: { abstract: string; summary: string; schemaVersion: string; versionedAt: string },
  ): Promise<void> {
    await this.executeQuery(
      `MATCH (m:Memory {id: $id, deletedAt: ''})
       SET m.abstract = $abstract, m.summary = $summary,
           m.schemaVersion = $schemaVersion, m.versionedAt = $versionedAt`,
      { id: memoryId, ...fields },
    );
  }

  async countMemories(namespace: string): Promise<number> {
    const result = await this.conn.query(
      `MATCH (m:Memory) WHERE m.namespace = $ns AND m.deletedAt = '' AND m.name <> '__ns_rollup__' RETURN count(m) as count`,
      { ns: namespace },
    );
    const rows = await result.getAll();
    return Number(rows[0]?.count ?? 0);
  }

  async getEntityCatalog(namespace: string): Promise<Array<{ name: string; type: string }>> {
    const result = await this.executeQuery(
      `MATCH (e:Entity {namespace: $namespace}) WHERE e.deletedAt = '' RETURN e.name as name, e.type as type`,
      { namespace },
    );
    return (await result.getAll()).map((r) => ({ name: r.name as string, type: r.type as string }));
  }

  private factEmbeddingString(value: unknown): string {
    return Array.isArray(value)
      ? `[${(value as number[]).join(",")}]`
      : this.zeroEmbeddingStr(2560);
  }

  private mergedRelationParams(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id as string,
      relationType: row.relationType as string,
      fact: row.fact as string,
      sentiment: row.sentiment ?? 0,
      confidence: row.confidence ?? 1,
      confidenceReason: (row.confidenceReason as string) ?? "",
      episodes: (row.episodes as string[]) ?? [],
      validAt: (row.validAt as string) ?? "",
      invalidAt: (row.invalidAt as string) ?? "",
      namespace: (row.namespace as string) ?? "",
      createdAt: (row.createdAt as string) ?? "",
    };
  }

  private async copyOutgoingMergeEdges(keepUuid: string, dupeUuid: string): Promise<void> {
    const outResult = await this.executeQuery(
      `MATCH (e:Entity {uuid: $dupeUuid})-[r:RELATES_TO]->(t:Entity)
       RETURN r.id as id, r.relationType as relationType, r.fact as fact,
              r.sentiment as sentiment, r.confidence as confidence,
              r.confidenceReason as confidenceReason, r.factEmbedding as factEmbedding,
              r.episodes as episodes, r.validAt as validAt, r.invalidAt as invalidAt,
              r.namespace as namespace, r.createdAt as createdAt,
              t.uuid as targetUuid`,
      { dupeUuid },
    );

    for (const row of await outResult.getAll()) {
      const targetUuid = row.targetUuid as string;
      const relationType = row.relationType as string;
      const exists = await this.executeQuery(
        `MATCH (s:Entity {uuid: $keepUuid})-[r:RELATES_TO]->(t:Entity {uuid: $targetUuid})
         WHERE r.relationType = $relationType RETURN r.id`,
        { keepUuid, targetUuid, relationType },
      );
      if ((await exists.getAll()).length > 0) continue;

      const embStr = this.factEmbeddingString(row.factEmbedding);
      await this.executeQuery(
        `MATCH (s:Entity {uuid: $keepUuid})
         MATCH (t:Entity {uuid: $targetUuid})
         CREATE (s)-[:RELATES_TO {
           id: $id, relationType: $relationType, fact: $fact,
           sentiment: $sentiment, confidence: $confidence,
           confidenceReason: $confidenceReason, factEmbedding: ${embStr},
           episodes: $episodes, validAt: $validAt,
           invalidAt: $invalidAt, namespace: $namespace, createdAt: $createdAt
         }]->(t)`,
        {
          keepUuid,
          targetUuid,
          ...this.mergedRelationParams(row),
        },
      );
    }
  }

  private async copyIncomingMergeEdges(keepUuid: string, dupeUuid: string): Promise<void> {
    const inResult = await this.executeQuery(
      `MATCH (s:Entity)-[r:RELATES_TO]->(e:Entity {uuid: $dupeUuid})
       RETURN r.id as id, r.relationType as relationType, r.fact as fact,
              r.sentiment as sentiment, r.confidence as confidence,
              r.confidenceReason as confidenceReason, r.factEmbedding as factEmbedding,
              r.episodes as episodes, r.validAt as validAt, r.invalidAt as invalidAt,
              r.namespace as namespace, r.createdAt as createdAt,
              s.uuid as sourceUuid`,
      { dupeUuid },
    );

    for (const row of await inResult.getAll()) {
      const sourceUuid = row.sourceUuid as string;
      const relationType = row.relationType as string;
      const exists = await this.executeQuery(
        `MATCH (s:Entity {uuid: $sourceUuid})-[r:RELATES_TO]->(t:Entity {uuid: $keepUuid})
         WHERE r.relationType = $relationType RETURN r.id`,
        { sourceUuid, keepUuid, relationType },
      );
      if ((await exists.getAll()).length > 0) continue;

      const embStr = this.factEmbeddingString(row.factEmbedding);
      await this.executeQuery(
        `MATCH (s:Entity {uuid: $sourceUuid})
         MATCH (t:Entity {uuid: $keepUuid})
         CREATE (s)-[:RELATES_TO {
           id: $id, relationType: $relationType, fact: $fact,
           sentiment: $sentiment, confidence: $confidence,
           confidenceReason: $confidenceReason, factEmbedding: ${embStr},
           episodes: $episodes, validAt: $validAt,
           invalidAt: $invalidAt, namespace: $namespace, createdAt: $createdAt
         }]->(t)`,
        {
          sourceUuid,
          keepUuid,
          ...this.mergedRelationParams(row),
        },
      );
    }
  }

  async mergeEntities(keepUuid: string, dupeUuids: string[]): Promise<{ removed: number }> {
    let removed = 0;

    for (const dupeUuid of dupeUuids) {
      // Re-point Fact nodes
      await this.executeQuery(
        `MATCH (f:Fact) WHERE f.sourceUuid = $dupeUuid SET f.sourceUuid = $keepUuid`,
        { dupeUuid, keepUuid },
      );
      await this.executeQuery(
        `MATCH (f:Fact) WHERE f.targetUuid = $dupeUuid SET f.targetUuid = $keepUuid`,
        { dupeUuid, keepUuid },
      );

      await this.copyOutgoingMergeEdges(keepUuid, dupeUuid);
      await this.copyIncomingMergeEdges(keepUuid, dupeUuid);

      // Delete old edges and soft-delete duplicate
      await this.executeQuery(`MATCH (e:Entity {uuid: $dupeUuid})-[r:RELATES_TO]->() DELETE r`, { dupeUuid });
      await this.executeQuery(`MATCH ()-[r:RELATES_TO]->(e:Entity {uuid: $dupeUuid}) DELETE r`, { dupeUuid });
      await this.executeQuery(
        `MATCH (e:Entity {uuid: $dupeUuid}) SET e.deletedAt = $deletedAt`,
        { dupeUuid, deletedAt: new Date().toISOString() },
      );
      removed++;
    }

    return { removed };
  }
}
