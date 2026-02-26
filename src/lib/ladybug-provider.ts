import { Database, Connection } from "lbug";
import { randomUUID } from "crypto";
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
import type {
  GraphProvider,
  SearchResult,
  GetResult,
  ForgetResult,
  ForgetEdgeResult,
  GraphData,
  Stats,
} from "./graph-provider.js";

export class LadybugProvider implements GraphProvider {
  private db: Database;
  private conn!: Connection;
  private dataPath: string;

  constructor(dataPath?: string) {
    this.dataPath = dataPath ?? process.env.LADYBUG_DATA_PATH ?? "./.ladybug";
    this.db = new Database(this.dataPath);
  }

  private static readonly EMBEDDING_DIM = 2560;
  private static readonly ZERO_EMBEDDING = new Array(
    LadybugProvider.EMBEDDING_DIM,
  ).fill(0);

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

  private zeroEmbeddingStr(): string {
    return `[${LadybugProvider.ZERO_EMBEDDING.join(",")}]`;
  }

  private escapeFtsQuery(query: string): string {
    // LadybugDB FTS has strict syntax - remove problematic characters
    return query
      .replace(/'/g, "")
      .replace(/"/g, "")
      .replace(/\\/g, "")
      .replace(/&/g, " ")
      .replace(/\|/g, " ")
      .replace(/!/g, " ")
      .replace(/\(/g, " ")
      .replace(/\)/g, " ");
  }

  private async tryQuery(query: string): Promise<void> {
    try {
      await this.conn.query(query);
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("already exists")))
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
      targetUuid STRING, sentiment DOUBLE, episodes STRING[], validAt STRING,
      invalidAt STRING, namespace STRING, createdAt STRING, deletedAt STRING
    )`);

    await this.tryQuery(`CREATE REL TABLE IF NOT EXISTS RELATES_TO(
      FROM Entity TO Entity, id STRING, relationType STRING, fact STRING,
      sentiment DOUBLE, factEmbedding DOUBLE[2560], episodes STRING[],
      validAt STRING, invalidAt STRING, namespace STRING, createdAt STRING
    )`);

    await this.tryQuery(
      `CALL CREATE_VECTOR_INDEX('Memory', 'memory_vec_idx', 'embedding', metric := 'cosine')`,
    );

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

  async store(
    memory: Memory,
    entities: Entity[],
    edges: ExtractedEdge[],
    memoryEmbedding: number[],
    edgeEmbeddings: number[][],
  ): Promise<void> {
    const embeddingStr = `[${memoryEmbedding.join(",")}]`;
    const createdAt = memory.createdAt.toISOString();

    // LadybugDB: vector-indexed properties can't be updated with MERGE, use delete+create
    await this.executeQuery(
      `MATCH (m:Memory {id: $id, deletedAt: ''}) DELETE m`,
      { id: memory.id },
    );
    await this.executeQuery(
      `CREATE (m:Memory {
         id: $id, name: $name, text: $text, summary: $summary,
         category: $category, namespace: $namespace, status: $status, error: $error,
         embedding: ${embeddingStr}, createdAt: $createdAt, deletedAt: ''
       })`,
      {
        id: memory.id,
        name: memory.name,
        text: memory.text,
        summary: memory.summary,
        category: memory.category ?? "",
        namespace: memory.namespace,
        status: memory.status ?? "completed",
        error: memory.error ?? "",
        createdAt,
      },
    );

    for (const entity of entities) {
      if (!entity.uuid) {
        (entity as Entity & { uuid: string }).uuid = randomUUID();
      }
      const entityWithScope = entity as Entity & {
        namespace?: string;
        scope?: string;
      };
      const entityNamespace = entityWithScope.namespace ?? memory.namespace;
      const entityScope = entityWithScope.scope ?? "project";
      const finalNamespace = entityScope === "global" ? "" : entityNamespace;

      await this.executeQuery(
        `MERGE (e:Entity {uuid: $uuid, deletedAt: ''})
         ON CREATE SET e.name = $name, e.type = $type, e.description = $description,
           e.namespace = $namespace, e.scope = $scope
         ON MATCH SET e.description = COALESCE($description, e.description)`,
        {
          uuid: entity.uuid,
          name: entity.name,
          type: entity.type,
          description: entity.description ?? "",
          namespace: finalNamespace,
          scope: entityScope,
        },
      );
    }

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]!;
      const embedding = edgeEmbeddings[i] ?? [];
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
        embedding,
        sourceEntity,
        targetEntity,
        memory.id,
        memory.namespace,
      );
    }
  }

  private async storeEdge(
    edge: ExtractedEdge,
    embedding: number[],
    sourceEntity: Entity,
    targetEntity: Entity,
    memoryId: string,
    memoryNamespace: string,
  ): Promise<void> {
    const sourceUuid = sourceEntity.uuid!;
    const targetUuid = targetEntity.uuid!;
    const edgeId = randomUUID();
    const embStr = `[${embedding.join(",")}]`;
    const now = new Date().toISOString();
    const sourceEntityWithScope = sourceEntity as Entity & {
      namespace?: string;
      scope?: string;
    };
    const sourceNamespace =
      sourceEntityWithScope.scope === "global"
        ? ""
        : (sourceEntityWithScope.namespace ?? memoryNamespace);

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
      );
    } else {
      await this.createNewEdge(
        edge,
        edgeId,
        embStr,
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
  ): Promise<void> {
    const existingEpisodes = (existing.episodes as string[]) || [];
    const newEpisodes = [...existingEpisodes, memoryId];
    const existingFact = (existing.fact as string) || "";
    const newFact =
      edge.fact.length > existingFact.length ? edge.fact : existingFact;

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
  }

  private async createNewEdge(
    edge: ExtractedEdge,
    edgeId: string,
    embStr: string,
    sourceUuid: string,
    targetUuid: string,
    memoryId: string,
    namespace: string,
    createdAt: string,
  ): Promise<void> {
    await this.executeQuery(
      `MATCH (source:Entity {uuid: $sourceUuid})
       MATCH (target:Entity {uuid: $targetUuid})
       CREATE (source)-[r:RELATES_TO {
         id: $id, relationType: $relationType, fact: $fact, sentiment: $sentiment,
         factEmbedding: ${embStr}, episodes: $episodes, validAt: $validAt,
         invalidAt: $invalidAt, namespace: $namespace, createdAt: $createdAt
       }]->(target)`,
      {
        sourceUuid,
        targetUuid,
        id: edgeId,
        relationType: edge.relationType,
        fact: edge.fact,
        sentiment: edge.sentiment,
        episodes: [memoryId],
        validAt: edge.validAt ?? "",
        invalidAt: "",
        namespace,
        createdAt,
      },
    );

    await this.executeQuery(
      `CREATE (f:Fact {
         id: $id, text: $text, relationType: $relationType, sourceUuid: $sourceUuid,
         targetUuid: $targetUuid, sentiment: $sentiment, episodes: $episodes,
         validAt: $validAt, invalidAt: $invalidAt, namespace: $namespace,
         createdAt: $createdAt, deletedAt: ''
       })`,
      {
        id: edgeId,
        text: edge.fact,
        relationType: edge.relationType,
        sourceUuid,
        targetUuid,
        sentiment: edge.sentiment,
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
  ): Promise<SearchResult> {
    const memories = embedding.length > 0 ? await this.vectorSearch(embedding, limit) : [];
    const edges = await this.fullTextSearchEdges(query, limit);

    const entityResult = await this.executeQuery(
      `MATCH (e:Entity)
       WHERE LOWER(e.name) CONTAINS LOWER($query) AND e.deletedAt = ''
       RETURN e.uuid as uuid, e.name as name, e.type as type, e.scope as scope,
              e.description as description, e.summary as summary, e.namespace as namespace
       LIMIT $limit`,
      { query, limit },
    );

    const entityRows = await entityResult.getAll();
    const entities: StoredEntity[] = entityRows.map((r) => ({
      uuid: r.uuid as string,
      name: r.name as string,
      type: r.type as StoredEntity["type"],
      scope: (r.scope as "project" | "global") ?? "project",
      description: (r.description as string) || undefined,
      summary: (r.summary as string) || undefined,
      namespace: (r.namespace as string) || undefined,
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
    if (filter?.namespace === null) {
      conditions.push("node.namespace = ''");
    } else if (filter?.namespace !== undefined) {
      conditions.push(`node.namespace = '${filter.namespace}'`);
    }
    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const embeddingStr = `[${embedding.join(",")}]`;
    const result = await this.conn.query(
      `CALL QUERY_VECTOR_INDEX('Memory', 'memory_vec_idx', ${embeddingStr}, ${overfetchLimit})
       WITH node, distance
       ${whereClause}
       RETURN node.id as id, node.name as name, node.text as text, node.summary as summary,
              node.category as category, node.namespace as namespace, node.status as status,
              node.error as error, node.createdAt as createdAt, distance
       ORDER BY distance ASC`,
    );

    const rows = await result.getAll();
    return rows.slice(0, limit).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      text: r.text as string,
      summary: r.summary as string,
      category: ((r.category as string) || undefined) as Memory["category"],
      namespace: r.namespace as string,
      status: (r.status as Memory["status"]) ?? "completed",
      error: (r.error as string) || undefined,
      createdAt: new Date(r.createdAt as string),
    }));
  }

  async fullTextSearchEdges(
    query: string,
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]> {
    const conditions: string[] = ["node.deletedAt = ''"];
    if (filter?.namespace === null) {
      conditions.push("node.namespace = ''");
    } else if (filter?.namespace !== undefined) {
      conditions.push(`node.namespace = '${filter.namespace}'`);
    }
    if (!filter?.includeInvalidated) {
      conditions.push("node.invalidAt = ''");
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const escapedQuery = this.escapeFtsQuery(query);
    const result = await this.conn.query(
      `CALL QUERY_FTS_INDEX('Fact', 'fact_fts_idx', '${escapedQuery}', top := ${limit * 3})
       WITH node, score
       ${whereClause}
       MATCH (source:Entity {uuid: node.sourceUuid, deletedAt: ''})
       MATCH (target:Entity {uuid: node.targetUuid, deletedAt: ''})
       RETURN node.id as id, source.name as sourceEntityName, target.name as targetEntityName,
              node.relationType as relationType, node.text as fact, node.sentiment as sentiment,
              node.episodes as episodes, node.namespace as namespace, node.validAt as validAt,
              node.invalidAt as invalidAt, node.createdAt as createdAt, score
       ORDER BY score DESC
       LIMIT ${limit}`,
    );

    const rows = await result.getAll();
    return rows.map((r) => ({
      id: r.id as string,
      sourceEntityName: r.sourceEntityName as string,
      targetEntityName: r.targetEntityName as string,
      relationType: r.relationType as string,
      fact: r.fact as string,
      sentiment: (r.sentiment as number) ?? 0,
      episodes: (r.episodes as string[]) ?? [],
      namespace: r.namespace as string,
      validAt: r.validAt ? new Date(r.validAt as string) : undefined,
      invalidAt:
        r.invalidAt && r.invalidAt !== ""
          ? new Date(r.invalidAt as string)
          : undefined,
      createdAt: new Date(r.createdAt as string),
    }));
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
            category: ((memRows[0].category as string) || undefined) as Memory["category"],
            namespace: memRows[0].namespace as string,
            status: (memRows[0].status as Memory["status"]) ?? "completed",
            error: (memRows[0].error as string) || undefined,
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
            namespace: (entityRows[0].namespace as string) || undefined,
          }
        : undefined;

    let edges: StoredEdge[] = [];

    if (memory) {
      const edgeResult = await this.executeQuery(
        `MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
         WHERE $memoryId IN r.episodes
         RETURN r.id as id, source.name as sourceEntityName, target.name as targetEntityName,
                r.relationType as relationType, r.fact as fact, r.sentiment as sentiment,
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

    const zeroEmb = this.zeroEmbeddingStr();
    await this.executeQuery(
      `CREATE (m:Memory {
         id: $id, name: $name, text: $text, summary: $summary, category: $category,
         namespace: $namespace, status: 'completed', error: '', embedding: ${zeroEmb},
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
    const zeroEmb = this.zeroEmbeddingStr();
    await this.executeQuery(
      `CREATE (m:Memory {
         id: $id, name: $name, text: $text, summary: $summary, category: $category,
         namespace: $namespace, status: $status, error: $error, embedding: ${zeroEmb},
         createdAt: $createdAt, deletedAt: ''
       })`,
      {
        id: memory.id,
        name: memory.name,
        text: memory.text,
        summary: memory.summary,
        category: memory.category ?? "",
        namespace: memory.namespace,
        status: memory.status,
        error: memory.error ?? "",
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
    let whereClause = "WHERE m.status = 'pending' AND m.deletedAt = ''";
    if (namespace !== undefined) {
      whereClause += ` AND m.namespace = '${namespace}'`;
    }

    const result = await this.conn.query(
      `MATCH (m:Memory) ${whereClause} RETURN m ORDER BY m.createdAt ASC LIMIT ${limit}`,
    );

    const rows = await result.getAll();
    return rows.map((row) => {
      const m = row.m;
      return {
        id: m.id as string,
        name: m.name as string,
        text: m.text as string,
        summary: m.summary as string,
        category: ((m.category as string) || undefined) as Memory["category"],
        namespace: m.namespace as string,
        status: (m.status as Memory["status"]) ?? "pending",
        error: (m.error as string) || undefined,
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
  ): Promise<StoredEntity[]> {
    const conditions: string[] = ["e.deletedAt = ''"];
    if (filter.uuid) conditions.push(`e.uuid = '${filter.uuid}'`);
    if (filter.name)
      conditions.push(`LOWER(e.name) CONTAINS LOWER('${filter.name}')`);
    if (filter.namespace === null) conditions.push("e.namespace = ''");
    else if (filter.namespace !== undefined)
      conditions.push(`e.namespace = '${filter.namespace}'`);
    if (filter.scope) conditions.push(`e.scope = '${filter.scope}'`);
    if (filter.type) conditions.push(`e.type = '${filter.type}'`);

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const result = await this.conn.query(
      `MATCH (e:Entity) ${whereClause} RETURN e LIMIT ${limit}`,
    );

    const rows = await result.getAll();
    return rows.map((row) => {
      const e = row.e;
      return {
        uuid: e.uuid as string,
        name: e.name as string,
        type: e.type as StoredEntity["type"],
        description: (e.description as string) || undefined,
        namespace: (e.namespace as string) || undefined,
        scope: (e.scope as "project" | "global") ?? "project",
        summary: (e.summary as string) || undefined,
      };
    });
  }

  async findEdges(filter: EdgeFilter, limit = 100): Promise<StoredEdge[]> {
    const conditions: string[] = [
      "source.deletedAt = ''",
      "target.deletedAt = ''",
    ];
    if (filter.id) conditions.push(`r.id = '${filter.id}'`);
    if (filter.namespace === null) conditions.push("source.namespace = ''");
    else if (filter.namespace !== undefined)
      conditions.push(`source.namespace = '${filter.namespace}'`);
    if (filter.sourceEntityName)
      conditions.push(`source.name = '${filter.sourceEntityName}'`);
    if (filter.targetEntityName)
      conditions.push(`target.name = '${filter.targetEntityName}'`);
    if (filter.relationType)
      conditions.push(`r.relationType = '${filter.relationType}'`);
    if (!filter.includeInvalidated) conditions.push("r.invalidAt = ''");

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const result = await this.conn.query(
      `MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
       ${whereClause}
       RETURN r.id as id, source.name as sourceEntityName, target.name as targetEntityName,
              r.relationType as relationType, r.fact as fact, r.sentiment as sentiment,
              r.episodes as episodes, source.namespace as namespace, r.validAt as validAt,
              r.invalidAt as invalidAt, r.createdAt as createdAt
       LIMIT ${limit}`,
    );

    const rows = await result.getAll();
    return this.mapEdgeRows(rows);
  }

  async findMemories(filter: MemoryFilter, limit = 100): Promise<Memory[]> {
    const conditions: string[] = ["m.deletedAt = ''"];
    if (filter.id) conditions.push(`m.id = '${filter.id}'`);
    if (filter.name)
      conditions.push(`LOWER(m.name) CONTAINS LOWER('${filter.name}')`);
    if (filter.namespace === null) conditions.push("m.namespace = ''");
    else if (filter.namespace !== undefined)
      conditions.push(`m.namespace = '${filter.namespace}'`);
    if (filter.category) conditions.push(`m.category = '${filter.category}'`);

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const result = await this.conn.query(
      `MATCH (m:Memory) ${whereClause}
       RETURN m.id as id, m.name as name, m.text as text, m.summary as summary,
              m.category as category, m.namespace as namespace, m.status as status,
              m.error as error, m.createdAt as createdAt
       LIMIT ${limit}`,
    );

    const rows = await result.getAll();
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      text: r.text as string,
      summary: r.summary as string,
      category: ((r.category as string) || undefined) as Memory["category"],
      namespace: r.namespace as string,
      status: (r.status as Memory["status"]) ?? "completed",
      error: (r.error as string) || undefined,
      createdAt: new Date(r.createdAt as string),
    }));
  }

  async stats(namespace?: string): Promise<Stats> {
    const memConditions = ["m.deletedAt = ''"];
    const entityConditions = ["e.deletedAt = ''"];
    const edgeConditions = ["source.deletedAt = ''", "target.deletedAt = ''"];

    if (namespace) {
      memConditions.push(`m.namespace = '${namespace}'`);
      entityConditions.push(`e.namespace = '${namespace}'`);
      edgeConditions.push(`source.namespace = '${namespace}'`);
    }

    const memWhere = `WHERE ${memConditions.join(" AND ")}`;
    const entityWhere = `WHERE ${entityConditions.join(" AND ")}`;
    const edgeWhere = `WHERE ${edgeConditions.join(" AND ")}`;

    const memResult = await this.conn.query(
      `MATCH (m:Memory) ${memWhere} RETURN count(m) as count`,
    );
    const memRows = await memResult.getAll();
    const memories = Number(memRows[0]?.count ?? 0);

    const entityResult = await this.conn.query(
      `MATCH (e:Entity) ${entityWhere} RETURN count(e) as count`,
    );
    const entityRows = await entityResult.getAll();
    const entities = Number(entityRows[0]?.count ?? 0);

    const edgeResult = await this.conn.query(
      `MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity) ${edgeWhere} RETURN count(r) as count`,
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

  async getGraphData(
    _namespace?: string,
    _nodeLimit?: number,
  ): Promise<GraphData> {
    return { nodes: [], links: [] };
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
}
