import neo4j, { Driver, Session, ManagedTransaction } from "neo4j-driver";
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
import { rrfFuse } from "./search-utils.js";
import { getActiveDimension, OLLAMA_DIM, FALLBACK_DIM, isZeroEmbedding } from "./embedder.js";

const ZERO_EMBEDDING_384 = new Array(FALLBACK_DIM).fill(0);

export class Neo4jProvider implements GraphProvider {
  private driver: Driver;

  constructor() {
    this.driver = neo4j.driver(
      process.env.NEO4J_URI ?? "bolt://localhost:7687",
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? "neo4j",
        process.env.NEO4J_PASSWORD ?? "password",
      ),
    );
  }

  async init(): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(`
        CREATE CONSTRAINT memory_id IF NOT EXISTS
        FOR (m:Memory) REQUIRE m.id IS UNIQUE
      `);

      await session.run(`
        CREATE CONSTRAINT entity_name_namespace IF NOT EXISTS
        FOR (e:Entity) REQUIRE (e.name, e.namespace) IS UNIQUE
      `);

      await session.run(`
        CREATE INDEX memory_namespace IF NOT EXISTS
        FOR (m:Memory) ON (m.namespace)
      `);

      await session.run(`
        CREATE INDEX entity_namespace IF NOT EXISTS
        FOR (e:Entity) ON (e.namespace)
      `);

      await session.run(`
        CREATE INDEX memory_category IF NOT EXISTS
        FOR (m:Memory) ON (m.category)
      `);

      await session.run(`
        CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
        FOR (m:Memory) ON (m.embedding)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: 2560,
          \`vector.similarity_function\`: 'cosine'
        }}
      `);

      await session.run(`
        CREATE VECTOR INDEX edge_factEmbedding IF NOT EXISTS
        FOR ()-[r:RELATES_TO]-()
        ON (r.factEmbedding)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: 2560,
          \`vector.similarity_function\`: 'cosine'
        }}
      `);

      // 384-dim fallback vector indexes
      await session.run(`
        CREATE VECTOR INDEX memory_embedding_384 IF NOT EXISTS
        FOR (m:Memory) ON (m.embedding384)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: 384,
          \`vector.similarity_function\`: 'cosine'
        }}
      `);

      await session.run(`
        CREATE VECTOR INDEX edge_factEmbedding_384 IF NOT EXISTS
        FOR ()-[r:RELATES_TO]-()
        ON (r.factEmbedding384)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: 384,
          \`vector.similarity_function\`: 'cosine'
        }}
      `);

      await session.run(`
        CREATE FULLTEXT INDEX edge_fact_text IF NOT EXISTS
        FOR ()-[r:RELATES_TO]-()
        ON EACH [r.fact]
      `);
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  async withTransaction<T>(
    fn: (tx: ManagedTransaction) => Promise<T>,
  ): Promise<T> {
    const session = this.driver.session();
    try {
      return await session.executeWrite(async (tx) => {
        return await fn(tx);
      });
    } finally {
      await session.close();
    }
  }

  getSession(): Session {
    return this.driver.session();
  }

  async store(
    memory: Memory,
    entities: Entity[],
    edges: ExtractedEdge[],
    memoryEmbedding: number[],
    edgeEmbeddings: number[][],
    memoryEmbedding384?: number[],
    edgeEmbeddings384?: number[][],
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(
          `
          MERGE (m:Memory {id: $id})
          ON CREATE SET
            m.name = $name,
            m.text = $text,
            m.summary = $summary,
            m.category = $category,
            m.namespace = $namespace,
            m.status = $status,
            m.error = $error,
            m.embedding = $embedding,
            m.embedding384 = $embedding384,
            m.createdAt = datetime($createdAt)
          ON MATCH SET
            m.name = $name,
            m.summary = $summary,
            m.category = $category,
            m.status = $status,
            m.error = $error,
            m.embedding = $embedding,
            m.embedding384 = $embedding384
          `,
          {
            id: memory.id,
            name: memory.name,
            text: memory.text,
            summary: memory.summary,
            category: memory.category ?? null,
            namespace: memory.namespace,
            status: memory.status ?? "completed",
            error: memory.error ?? null,
            embedding: memoryEmbedding,
            embedding384: memoryEmbedding384 ?? ZERO_EMBEDDING_384,
            createdAt: memory.createdAt.toISOString(),
          },
        );

        for (const entity of entities) {
          if (!entity.uuid) {
            throw new Error(
              `Entity "${entity.name}" missing UUID - should be assigned by queue`,
            );
          }
          const uuid = entity.uuid;
          const entityWithScope = entity as Entity & {
            namespace?: string;
            scope?: string;
          };
          const entityNamespace =
            entityWithScope.namespace !== undefined
              ? entityWithScope.namespace
              : memory.namespace;
          const entityScope = entityWithScope.scope ?? "project";

          await tx.run(
            `
            MERGE (e:Entity {uuid: $uuid})
            ON CREATE SET 
              e.name = $name,
              e.type = $type,
              e.description = $description,
              e.namespace = $namespace,
              e.scope = $scope
            ON MATCH SET 
              e.description = COALESCE($description, e.description)
            `,
            {
              uuid,
              name: entity.name,
              type: entity.type,
              description: entity.description ?? null,
              namespace: entityScope === "global" ? null : entityNamespace,
              scope: entityScope,
            },
          );
        }

        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i]!;
          const embedding = edgeEmbeddings[i] ?? [];
          const embedding384 = edgeEmbeddings384?.[i] ?? ZERO_EMBEDDING_384;

          const sourceEntity = entities[edge.sourceIndex];
          const targetEntity = entities[edge.targetIndex];
          if (!sourceEntity || !targetEntity) {
            console.warn(
              `Invalid edge indices: ${edge.sourceIndex} -> ${edge.targetIndex} for entities length ${entities.length}`,
            );
            continue;
          }

          const edgeId = randomUUID();
          const sourceUuid = entities[edge.sourceIndex]?.uuid;
          const targetUuid = entities[edge.targetIndex]?.uuid;

          await tx.run(
            `
            MATCH (source:Entity)
            WHERE (source.uuid = $sourceUuid OR (source.name = $sourceName AND source.namespace = $namespace))
            MATCH (target:Entity)
            WHERE (target.uuid = $targetUuid OR (target.name = $targetName AND target.namespace = $namespace))
            MERGE (source)-[r:RELATES_TO {relationType: $relationType}]->(target)
            ON CREATE SET
              r.id = $id,
              r.fact = $fact,
              r.sentiment = $sentiment,
              r.confidence = $confidence,
              r.confidenceReason = $confidenceReason,
              r.factEmbedding = $embedding,
              r.factEmbedding384 = $embedding384,
              r.episodes = [$memoryId],
              r.validAt = CASE WHEN $validAt IS NOT NULL THEN datetime($validAt) ELSE null END,
              r.invalidAt = null,
              r.createdAt = datetime()
            ON MATCH SET
              r.episodes = r.episodes + $memoryId,
              r.fact = CASE WHEN size($fact) > size(r.fact) THEN $fact ELSE r.fact END
            `,
            {
              sourceUuid: sourceUuid ?? null,
              sourceName: sourceEntity.name,
              targetUuid: targetUuid ?? null,
              targetName: targetEntity.name,
              namespace: memory.namespace,
              relationType: edge.relationType,
              id: edgeId,
              fact: edge.fact,
              sentiment: edge.sentiment,
              confidence: edge.confidence ?? 1,
              confidenceReason: edge.confidenceReason ?? null,
              embedding,
              embedding384,
              memoryId: memory.id,
              validAt: edge.validAt ?? null,
            },
          );
        }
      });
    } finally {
      await session.close();
    }
  }

  async search(
    embedding: number[],
    query: string,
    limit = 10,
  ): Promise<SearchResult> {
    const session = this.driver.session();
    try {
      let memories: Memory[] = [];
      if (embedding.length > 0) {
        const memIndexName = getActiveDimension() === OLLAMA_DIM ? "memory_embedding" : "memory_embedding_384";
        const memoryResult = await session.run(
        `
        CALL db.index.vector.queryNodes('${memIndexName}', $limit, $embedding)
        YIELD node, score
        RETURN node.id as id,
               node.name as name,
               node.text as text,
               node.summary as summary,
               node.category as category,
               node.namespace as namespace,
               node.status as status,
               node.error as error,
               node.createdAt as createdAt,
               score
        ORDER BY score DESC
        `,
        { embedding, limit: neo4j.int(limit) },
      );

      memories = memoryResult.records.map((r) => ({
        id: r.get("id"),
        name: r.get("name"),
        text: r.get("text"),
        summary: r.get("summary"),
        category: r.get("category") ?? undefined,
        namespace: r.get("namespace"),
        status: r.get("status") ?? "completed",
        error: r.get("error") ?? undefined,
        createdAt: new Date(r.get("createdAt")),
      }));
      }

      const [vectorEdges, ftsEdges] = await Promise.all([
        this.vectorSearchEdges(embedding, limit),
        this.fullTextSearchEdges(query, limit),
      ]);
      const edges = rrfFuse(vectorEdges, ftsEdges, limit);

      const entityResult = await session.run(
        `
        MATCH (e:Entity)
        WHERE e.name =~ $pattern
        RETURN e.uuid as uuid,
               e.name as name,
               e.type as type,
               e.scope as scope,
               e.description as description,
               e.summary as summary,
               e.namespace as namespace
        LIMIT $limit
        `,
        { pattern: `(?i).*${query}.*`, limit: neo4j.int(limit) },
      );

      const entities: StoredEntity[] = entityResult.records.map((r) => ({
        uuid: r.get("uuid"),
        name: r.get("name"),
        type: r.get("type"),
        scope: r.get("scope") ?? "project",
        description: r.get("description") ?? undefined,
        summary: r.get("summary") ?? undefined,
        namespace: r.get("namespace"),
      }));

      return { memories, edges, entities };
    } finally {
      await session.close();
    }
  }

  async vectorSearch(
    embedding: number[],
    limit: number,
    filter?: MemoryFilter,
  ): Promise<Memory[]> {
    const session = this.driver.session();
    try {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {
        embedding,
        limit: neo4j.int(limit),
      };

      if (filter?.namespace === null) {
        conditions.push("node.namespace IS NULL");
      } else if (filter?.namespace !== undefined) {
        conditions.push("node.namespace = $namespace");
        params.namespace = filter.namespace;
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const vsIndexName = getActiveDimension() === OLLAMA_DIM ? "memory_embedding" : "memory_embedding_384";
      const result = await session.run(
        `
        CALL db.index.vector.queryNodes('${vsIndexName}', $limit, $embedding)
        YIELD node, score
        ${where}
        RETURN node.id as id,
               node.name as name,
               node.text as text,
               node.summary as summary,
               node.category as category,
               node.namespace as namespace,
               node.status as status,
               node.error as error,
               node.createdAt as createdAt
        ORDER BY score DESC
        `,
        params,
      );

      return result.records.map((r) => ({
        id: r.get("id"),
        name: r.get("name"),
        text: r.get("text"),
        summary: r.get("summary"),
        category: r.get("category") ?? undefined,
        namespace: r.get("namespace"),
        status: r.get("status") ?? "completed",
        error: r.get("error") ?? undefined,
        createdAt: new Date(r.get("createdAt")),
      }));
    } finally {
      await session.close();
    }
  }

  async vectorSearchEdges(
    embedding: number[],
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]> {
    const session = this.driver.session();
    try {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {
        embedding,
        limit: neo4j.int(limit),
      };

      if (filter?.namespace === null) {
        conditions.push("source.namespace IS NULL");
      } else if (filter?.namespace !== undefined) {
        conditions.push("source.namespace = $namespace");
        params.namespace = filter.namespace;
      }
      if (!filter?.includeInvalidated) {
        conditions.push("r.invalidAt IS NULL");
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const edgeIndexName = getActiveDimension() === OLLAMA_DIM ? "edge_factEmbedding" : "edge_factEmbedding_384";
      const result = await session.run(
        `
        CALL db.index.vector.queryRelationships('${edgeIndexName}', $limit, $embedding)
        YIELD relationship, score
        WITH relationship as r, score
        MATCH (source:Entity)-[r]->(target:Entity)
        ${where}
        RETURN r.id as id,
               source.name as sourceEntityName,
               target.name as targetEntityName,
               r.relationType as relationType,
               r.fact as fact,
               r.sentiment as sentiment,
               r.confidence as confidence,
               r.confidenceReason as confidenceReason,
               r.episodes as episodes,
               source.namespace as namespace,
               r.validAt as validAt,
               r.invalidAt as invalidAt,
               r.createdAt as createdAt,
               score
        ORDER BY score DESC
        LIMIT $limit
        `,
        params,
      );

      return result.records.map((r) => ({
        id: r.get("id"),
        sourceEntityName: r.get("sourceEntityName"),
        targetEntityName: r.get("targetEntityName"),
        relationType: r.get("relationType"),
        fact: r.get("fact"),
        sentiment: r.get("sentiment")?.toNumber?.() ?? r.get("sentiment") ?? 0,
        confidence: r.get("confidence")?.toNumber?.() ?? r.get("confidence") ?? 1,
        confidenceReason: r.get("confidenceReason") ?? undefined,
        episodes: r.get("episodes") ?? [],
        namespace: r.get("namespace") ?? undefined,
        validAt: r.get("validAt")?.toString() ?? undefined,
        invalidAt: r.get("invalidAt")?.toString() ?? undefined,
        createdAt: new Date(r.get("createdAt")?.toString() ?? Date.now()),
      }));
    } finally {
      await session.close();
    }
  }

  async fullTextSearchEdges(
    query: string,
    limit: number,
    filter?: EdgeFilter,
  ): Promise<StoredEdge[]> {
    const session = this.driver.session();
    try {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {
        query,
        limit: neo4j.int(limit),
      };

      if (filter?.namespace === null) {
        conditions.push("source.namespace IS NULL");
      } else if (filter?.namespace !== undefined) {
        conditions.push("source.namespace = $namespace");
        params.namespace = filter.namespace;
      }
      if (!filter?.includeInvalidated) {
        conditions.push("r.invalidAt IS NULL");
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const result = await session.run(
        `
        CALL db.index.fulltext.queryRelationships('edge_fact_text', $query)
        YIELD relationship, score
        WITH relationship as r, score
        MATCH (source:Entity)-[r]->(target:Entity)
        ${where}
        RETURN r.id as id,
               source.name as sourceEntityName,
               target.name as targetEntityName,
               r.relationType as relationType,
               r.fact as fact,
               r.sentiment as sentiment,
               r.confidence as confidence,
               r.confidenceReason as confidenceReason,
               r.episodes as episodes,
               source.namespace as namespace,
               r.validAt as validAt,
               r.invalidAt as invalidAt,
               r.createdAt as createdAt,
               score
        ORDER BY score DESC
        LIMIT $limit
        `,
        params,
      );

      return result.records.map((r) => ({
        id: r.get("id"),
        sourceEntityName: r.get("sourceEntityName"),
        targetEntityName: r.get("targetEntityName"),
        relationType: r.get("relationType"),
        fact: r.get("fact"),
        sentiment: r.get("sentiment") ?? 0,
        confidence: r.get("confidence") ?? 1,
        confidenceReason: r.get("confidenceReason") ?? undefined,
        episodes: r.get("episodes") ?? [],
        namespace: r.get("namespace"),
        validAt: r.get("validAt") ? new Date(r.get("validAt")) : undefined,
        invalidAt: r.get("invalidAt")
          ? new Date(r.get("invalidAt"))
          : undefined,
        createdAt: new Date(r.get("createdAt")),
      }));
    } finally {
      await session.close();
    }
  }

  async get(name: string, namespace = "default"): Promise<GetResult> {
    const session = this.driver.session();
    try {
      const memResult = await session.run(
        `
        MATCH (m:Memory {name: $name, namespace: $namespace})
        RETURN m.id as id,
               m.name as name,
               m.text as text,
               m.summary as summary,
               m.category as category,
               m.namespace as namespace,
               m.status as status,
               m.error as error,
               m.createdAt as createdAt
        `,
        { name, namespace },
      );

      const memoryRecord = memResult.records[0];
      const memory: Memory | undefined = memoryRecord
        ? {
            id: memoryRecord.get("id"),
            name: memoryRecord.get("name"),
            text: memoryRecord.get("text"),
            summary: memoryRecord.get("summary"),
            category: memoryRecord.get("category") ?? undefined,
            namespace: memoryRecord.get("namespace"),
            status: memoryRecord.get("status") ?? "completed",
            error: memoryRecord.get("error") ?? undefined,
            createdAt: new Date(memoryRecord.get("createdAt")),
          }
        : undefined;

      const entityResult = await session.run(
        `
        MATCH (e:Entity {name: $name, namespace: $namespace})
        RETURN e.uuid as uuid,
               e.name as name,
               e.type as type,
               e.scope as scope,
               e.description as description,
               e.summary as summary,
               e.namespace as namespace
        `,
        { name, namespace },
      );

      const entityRecord = entityResult.records[0];
      const entity: StoredEntity | undefined = entityRecord
        ? {
            uuid: entityRecord.get("uuid"),
            name: entityRecord.get("name"),
            type: entityRecord.get("type"),
            scope: entityRecord.get("scope") ?? "project",
            description: entityRecord.get("description") ?? undefined,
            summary: entityRecord.get("summary") ?? undefined,
            namespace: entityRecord.get("namespace"),
          }
        : undefined;

      let edges: StoredEdge[] = [];

      if (memory) {
        const edgeResult = await session.run(
          `
          MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
          WHERE $memoryId IN r.episodes
          RETURN r.id as id,
                 source.name as sourceEntityName,
                 target.name as targetEntityName,
                 r.relationType as relationType,
                 r.fact as fact,
                 r.sentiment as sentiment,
                 r.confidence as confidence,
                 r.confidenceReason as confidenceReason,
                 r.episodes as episodes,
                 source.namespace as namespace,
                 r.validAt as validAt,
                 r.invalidAt as invalidAt,
                 r.createdAt as createdAt
          `,
          { memoryId: memory.id },
        );

        edges = edgeResult.records.map((r) => ({
          id: r.get("id"),
          sourceEntityName: r.get("sourceEntityName"),
          targetEntityName: r.get("targetEntityName"),
          relationType: r.get("relationType"),
          fact: r.get("fact"),
          sentiment: r.get("sentiment") ?? 0,
          confidence: r.get("confidence") ?? 1,
          confidenceReason: r.get("confidenceReason") ?? undefined,
          episodes: r.get("episodes") ?? [],
          namespace: r.get("namespace"),
          validAt: r.get("validAt") ? new Date(r.get("validAt")) : undefined,
          invalidAt: r.get("invalidAt")
            ? new Date(r.get("invalidAt"))
            : undefined,
          createdAt: new Date(r.get("createdAt")),
        }));
      } else if (entity) {
        const edgeResult = await session.run(
          `
          MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
          WHERE (source.name = $name OR target.name = $name) AND source.namespace = $namespace
          RETURN r.id as id,
                 source.name as sourceEntityName,
                 target.name as targetEntityName,
                 r.relationType as relationType,
                 r.fact as fact,
                 r.sentiment as sentiment,
                 r.confidence as confidence,
                 r.confidenceReason as confidenceReason,
                 r.episodes as episodes,
                 source.namespace as namespace,
                 r.validAt as validAt,
                 r.invalidAt as invalidAt,
                 r.createdAt as createdAt
          ORDER BY r.createdAt DESC
          `,
          { name, namespace },
        );

        edges = edgeResult.records.map((r) => ({
          id: r.get("id"),
          sourceEntityName: r.get("sourceEntityName"),
          targetEntityName: r.get("targetEntityName"),
          relationType: r.get("relationType"),
          fact: r.get("fact"),
          sentiment: r.get("sentiment") ?? 0,
          confidence: r.get("confidence") ?? 1,
          confidenceReason: r.get("confidenceReason") ?? undefined,
          episodes: r.get("episodes") ?? [],
          namespace: r.get("namespace"),
          validAt: r.get("validAt") ? new Date(r.get("validAt")) : undefined,
          invalidAt: r.get("invalidAt")
            ? new Date(r.get("invalidAt"))
            : undefined,
          createdAt: new Date(r.get("createdAt")),
        }));
      }

      return { memory, entity, edges };
    } finally {
      await session.close();
    }
  }

  async forget(name: string, namespace = "default"): Promise<ForgetResult> {
    const session = this.driver.session();
    try {
      let deletedMemory = false;
      let deletedEntity = false;

      await session.executeWrite(async (tx) => {
        const memResult = await tx.run(
          `
          MATCH (m:Memory {name: $name, namespace: $namespace})
          DETACH DELETE m
          RETURN count(m) as deleted
          `,
          { name, namespace },
        );
        deletedMemory = (memResult.records[0]?.get("deleted") ?? 0) > 0;

        const entityResult = await tx.run(
          `
          MATCH (e:Entity {name: $name, namespace: $namespace})
          OPTIONAL MATCH (e)-[r:RELATES_TO]-()
          DELETE r
          DETACH DELETE e
          RETURN count(e) as deleted
          `,
          { name, namespace },
        );
        deletedEntity = (entityResult.records[0]?.get("deleted") ?? 0) > 0;
      });

      return { deletedMemory, deletedEntity };
    } finally {
      await session.close();
    }
  }

  async forgetEdge(
    edgeId: string,
    reason: string,
    namespace = "default",
  ): Promise<ForgetEdgeResult> {
    const session = this.driver.session();
    try {
      let invalidatedEdge: StoredEdge | undefined;
      let auditMemoryId: string | undefined;

      await session.executeWrite(async (tx) => {
        const result = await tx.run(
          `
          MATCH (source:Entity)-[r:RELATES_TO {id: $edgeId}]->(target:Entity)
          WHERE source.namespace = $namespace
          SET r.invalidAt = datetime()
          RETURN r.id as id,
                 source.name as sourceEntityName,
                 target.name as targetEntityName,
                 r.relationType as relationType,
                 r.fact as fact,
                 r.sentiment as sentiment,
                 r.confidence as confidence,
                 r.confidenceReason as confidenceReason,
                 r.episodes as episodes,
                 source.namespace as namespace,
                 r.validAt as validAt,
                 r.invalidAt as invalidAt,
                 r.createdAt as createdAt
          `,
          { edgeId, namespace },
        );

        const record = result.records[0];
        if (record) {
          invalidatedEdge = {
            id: record.get("id"),
            sourceEntityName: record.get("sourceEntityName"),
            targetEntityName: record.get("targetEntityName"),
            relationType: record.get("relationType"),
            fact: record.get("fact"),
            sentiment: record.get("sentiment") ?? 0,
            confidence: record.get("confidence") ?? 1,
            confidenceReason: record.get("confidenceReason") ?? undefined,
            episodes: record.get("episodes") ?? [],
            namespace: record.get("namespace"),
            validAt: record.get("validAt")
              ? new Date(record.get("validAt"))
              : undefined,
            invalidAt: record.get("invalidAt")
              ? new Date(record.get("invalidAt"))
              : undefined,
            createdAt: new Date(record.get("createdAt")),
          };

          auditMemoryId = randomUUID();
          const auditText = `Invalidated fact "${invalidatedEdge.fact}" because: ${reason}`;

          await tx.run(
            `
            CREATE (m:Memory {
              id: $id,
              name: $name,
              text: $text,
              summary: $summary,
              category: null,
              namespace: $namespace,
              status: 'completed',
              embedding: [],
              createdAt: datetime()
            })
            `,
            {
              id: auditMemoryId,
              name: `Invalidation: ${invalidatedEdge.fact.slice(0, 50)}...`,
              text: auditText,
              summary: auditText,
              namespace,
            },
          );
        }
      });

      return { invalidatedEdge, auditMemoryId };
    } finally {
      await session.close();
    }
  }

  async storeMemoryOnly(memory: Memory): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        CREATE (m:Memory {
          id: $id,
          name: $name,
          text: $text,
          summary: $summary,
          category: $category,
          namespace: $namespace,
          status: $status,
          error: $error,
          embedding: $embedding,
          createdAt: datetime($createdAt)
        })
        `,
        {
          id: memory.id,
          name: memory.name,
          text: memory.text,
          summary: memory.summary,
          category: memory.category ?? null,
          namespace: memory.namespace,
          status: memory.status,
          error: memory.error ?? null,
          embedding: [],
          createdAt: memory.createdAt.toISOString(),
        },
      );
    } finally {
      await session.close();
    }
  }

  async updateMemoryStatus(
    id: string,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string,
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (m:Memory {id: $id})
        SET m.status = $status,
            m.error = $error
        `,
        { id, status, error: error ?? null },
      );
    } finally {
      await session.close();
    }
  }

  async getPendingMemories(namespace?: string, limit = 10): Promise<Memory[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory)
        WHERE m.status = 'pending'
          AND ($namespace IS NULL OR m.namespace = $namespace)
        RETURN m
        ORDER BY m.createdAt ASC
        LIMIT $limit
        `,
        {
          namespace: namespace ?? null,
          limit: neo4j.int(limit),
        },
      );

      return result.records.map((r) => {
        const m = r.get("m");
        return {
          id: m.properties.id,
          name: m.properties.name,
          text: m.properties.text,
          summary: m.properties.summary,
          category: m.properties.category ?? undefined,
          namespace: m.properties.namespace,
          status: m.properties.status ?? "pending",
          error: m.properties.error ?? undefined,
          createdAt: new Date(m.properties.createdAt),
        };
      });
    } finally {
      await session.close();
    }
  }

  async storeEntity(entity: StoredEntity): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MERGE (e:Entity {uuid: $uuid})
        SET e.name = $name,
            e.type = $type,
            e.description = $description,
            e.namespace = $namespace,
            e.scope = $scope,
            e.summary = $summary
        `,
        {
          uuid: entity.uuid,
          name: entity.name,
          type: entity.type,
          description: entity.description ?? null,
          namespace: entity.namespace ?? null,
          scope: entity.scope ?? "project",
          summary: entity.summary ?? null,
        },
      );
    } finally {
      await session.close();
    }
  }

  async findEntities(
    filter: EntityFilter,
    limit = 100,
  ): Promise<StoredEntity[]> {
    const session = this.driver.session();
    try {
      const conditions: string[] = [];
      const params: Record<string, unknown> = { limit: neo4j.int(limit) };

      if (filter.uuid) {
        conditions.push("e.uuid = $uuid");
        params.uuid = filter.uuid;
      }
      if (filter.name) {
        conditions.push("e.name =~ $namePattern");
        params.namePattern = `(?i).*${filter.name}.*`;
      }
      if (filter.namespace === null) {
        conditions.push("e.namespace IS NULL");
      } else if (filter.namespace !== undefined) {
        conditions.push("e.namespace = $namespace");
        params.namespace = filter.namespace;
      }
      if (filter.scope) {
        conditions.push("e.scope = $scope");
        params.scope = filter.scope;
      }
      if (filter.type) {
        conditions.push("e.type = $type");
        params.type = filter.type;
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const result = await session.run(
        `MATCH (e:Entity) ${where} RETURN e LIMIT $limit`,
        params,
      );

      return result.records.map((r) => {
        const e = r.get("e");
        return {
          uuid: e.properties.uuid,
          name: e.properties.name,
          type: e.properties.type,
          description: e.properties.description ?? undefined,
          namespace: e.properties.namespace ?? undefined,
          scope: (e.properties.scope ?? "project") as "project" | "global",
          summary: e.properties.summary ?? undefined,
        };
      });
    } finally {
      await session.close();
    }
  }

  async findEdges(filter: EdgeFilter, limit = 100): Promise<StoredEdge[]> {
    const session = this.driver.session();
    try {
      const conditions: string[] = [];
      const params: Record<string, unknown> = { limit: neo4j.int(limit) };

      if (filter.id) {
        conditions.push("r.id = $id");
        params.id = filter.id;
      }
      if (filter.namespace === null) {
        conditions.push("source.namespace IS NULL");
      } else if (filter.namespace !== undefined) {
        conditions.push("source.namespace = $namespace");
        params.namespace = filter.namespace;
      }
      if (filter.sourceEntityName) {
        conditions.push("source.name = $sourceEntityName");
        params.sourceEntityName = filter.sourceEntityName;
      }
      if (filter.targetEntityName) {
        conditions.push("target.name = $targetEntityName");
        params.targetEntityName = filter.targetEntityName;
      }
      if (filter.relationType) {
        conditions.push("r.relationType = $relationType");
        params.relationType = filter.relationType;
      }
      if (!filter.includeInvalidated) {
        conditions.push("r.invalidAt IS NULL");
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const result = await session.run(
        `
        MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
        ${where}
        RETURN r.id as id,
               source.name as sourceEntityName,
               target.name as targetEntityName,
               r.relationType as relationType,
               r.fact as fact,
               r.sentiment as sentiment,
               r.confidence as confidence,
               r.confidenceReason as confidenceReason,
               r.episodes as episodes,
               source.namespace as namespace,
               r.validAt as validAt,
               r.invalidAt as invalidAt,
               r.createdAt as createdAt
        LIMIT $limit
        `,
        params,
      );

      return result.records.map((r) => ({
        id: r.get("id"),
        sourceEntityName: r.get("sourceEntityName"),
        targetEntityName: r.get("targetEntityName"),
        relationType: r.get("relationType"),
        fact: r.get("fact"),
        sentiment: r.get("sentiment") ?? 0,
        confidence: r.get("confidence") ?? 1,
        confidenceReason: r.get("confidenceReason") ?? undefined,
        episodes: r.get("episodes") ?? [],
        namespace: r.get("namespace"),
        validAt: r.get("validAt") ? new Date(r.get("validAt")) : undefined,
        invalidAt: r.get("invalidAt")
          ? new Date(r.get("invalidAt"))
          : undefined,
        createdAt: new Date(r.get("createdAt")),
      }));
    } finally {
      await session.close();
    }
  }

  async findMemories(filter: MemoryFilter, limit = 100): Promise<Memory[]> {
    const session = this.driver.session();
    try {
      const conditions: string[] = [];
      const params: Record<string, unknown> = { limit: neo4j.int(limit) };

      if (filter.id) {
        conditions.push("m.id = $id");
        params.id = filter.id;
      }
      if (filter.name) {
        conditions.push("m.name =~ $namePattern");
        params.namePattern = `(?i).*${filter.name}.*`;
      }
      if (filter.namespace === null) {
        conditions.push("m.namespace IS NULL");
      } else if (filter.namespace !== undefined) {
        conditions.push("m.namespace = $namespace");
        params.namespace = filter.namespace;
      }

      if (filter.category) {
        conditions.push("m.category = $category");
        params.category = filter.category;
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const result = await session.run(
        `
        MATCH (m:Memory) ${where}
        RETURN m.id as id,
               m.name as name,
               m.text as text,
               m.summary as summary,
               m.category as category,
               m.namespace as namespace,
               m.status as status,
               m.error as error,
               m.createdAt as createdAt
        LIMIT $limit
        `,
        params,
      );

      return result.records.map((r) => ({
        id: r.get("id"),
        name: r.get("name"),
        text: r.get("text"),
        summary: r.get("summary"),
        category: r.get("category") ?? undefined,
        namespace: r.get("namespace"),
        status: r.get("status") ?? "completed",
        error: r.get("error") ?? undefined,
        createdAt: new Date(r.get("createdAt")),
      }));
    } finally {
      await session.close();
    }
  }

  async stats(namespace?: string): Promise<Stats> {
    const session = this.driver.session();
    try {
      const whereClause = namespace ? `{namespace: $namespace}` : ``;
      const result = await session.run(
        `
        MATCH (m:Memory ${whereClause})
        WITH count(m) as memCount
        MATCH (e:Entity ${whereClause})
        WITH memCount, count(e) as entityCount
        MATCH (e1:Entity ${whereClause})-[r:RELATES_TO]->()
        RETURN memCount as memories, entityCount as entities, count(r) as edges
        `,
        namespace ? { namespace } : {},
      );

      const record = result.records[0];
      return {
        memories: record?.get("memories")?.toNumber() ?? 0,
        entities: record?.get("entities")?.toNumber() ?? 0,
        edges: record?.get("edges")?.toNumber() ?? 0,
      };
    } finally {
      await session.close();
    }
  }

  async listNamespaces(): Promise<string[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (e:Entity)
        WHERE e.namespace IS NOT NULL
        RETURN DISTINCT e.namespace as namespace
        ORDER BY e.namespace
      `);

      return result.records.map((r) => r.get("namespace") as string);
    } finally {
      await session.close();
    }
  }

  async deleteByNamespace(namespace: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(
          `MATCH (m:Memory {namespace: $namespace}) DETACH DELETE m`,
          { namespace },
        );
        await tx.run(
          `MATCH (e:Entity {namespace: $namespace}) DETACH DELETE e`,
          { namespace },
        );
      });
    } finally {
      await session.close();
    }
  }

  async getGraphData(namespace?: string, nodeLimit = 100): Promise<GraphData> {
    const session = this.driver.session();
    try {
      const nodeWhereClause = namespace ? `WHERE e.namespace = $namespace` : ``;
      const nodeResult = await session.run(
        `
        MATCH (e:Entity)
        ${nodeWhereClause}
        OPTIONAL MATCH (e)-[r:RELATES_TO]-()
        WITH e, count(r) as edgeCount
        ORDER BY edgeCount DESC
        LIMIT $nodeLimit
        RETURN e.name as id,
               e.name as name,
               e.type as type,
               e.description as description,
               e.summary as summary
        `,
        namespace
          ? { namespace, nodeLimit: neo4j.int(nodeLimit) }
          : { nodeLimit: neo4j.int(nodeLimit) },
      );

      const nodes = nodeResult.records.map((r) => ({
        id: r.get("id"),
        name: r.get("name"),
        type: r.get("type"),
        description: r.get("description") ?? undefined,
        summary: r.get("summary") ?? undefined,
      }));

      const nodeNames = new Set(nodes.map((n) => n.name));

      const linkWhereClause = namespace
        ? `WHERE source.namespace = $namespace AND r.invalidAt IS NULL`
        : `WHERE r.invalidAt IS NULL`;
      const linkResult = await session.run(
        `
        MATCH (source:Entity)-[r:RELATES_TO]->(target:Entity)
        ${linkWhereClause}
        RETURN source.name as source,
               target.name as target,
               r.relationType as relationType,
               r.fact as fact,
               r.sentiment as sentiment,
               r.confidence as confidence,
               r.id as edgeId
        `,
        namespace ? { namespace } : {},
      );

      const links = linkResult.records
        .map((r) => ({
          source: r.get("source"),
          target: r.get("target"),
          relationType: r.get("relationType"),
          fact: r.get("fact"),
          sentiment: r.get("sentiment") ?? 0,
          confidence: r.get("confidence") ?? 1,
          edgeId: r.get("edgeId"),
        }))
        .filter((l) => nodeNames.has(l.source) && nodeNames.has(l.target));

      return { nodes, links };
    } finally {
      await session.close();
    }
  }

  async findEntitiesWithGlobalPreference(
    namespace: string | undefined,
    limit: number,
  ): Promise<StoredEntity[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (e:Entity)
        WHERE e.scope = 'global' OR (e.scope = 'project' AND ($namespace IS NULL OR e.namespace = $namespace))
        WITH e.name AS name, collect(e) AS entities
        WITH name, 
             [x IN entities WHERE x.scope = 'global'] + [x IN entities WHERE x.scope = 'project'] AS sorted
        WITH name, head(sorted) AS entity
        RETURN entity
        LIMIT $limit
        `,
        {
          namespace: namespace ?? null,
          limit: neo4j.int(limit),
        },
      );

      const entities: StoredEntity[] = [];
      for (const r of result.records) {
        const e = r.get("entity");
        if (e) {
          entities.push({
            uuid: e.properties.uuid as string,
            name: e.properties.name as string,
            type: e.properties.type as StoredEntity["type"],
            description: e.properties.description ?? undefined,
            namespace: e.properties.namespace ?? undefined,
            scope: (e.properties.scope ?? "project") as "project" | "global",
            summary: e.properties.summary ?? undefined,
          });
        }
      }
      return entities;
    } finally {
      await session.close();
    }
  }

  async deleteEntity(uuid: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (e:Entity {uuid: $uuid})
        DETACH DELETE e
        `,
        { uuid },
      );
    } finally {
      await session.close();
    }
  }

  async deleteEdgesForEntity(uuid: string): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (e:Entity {uuid: $uuid})-[r:RELATES_TO]-()
        DELETE r
        `,
        { uuid },
      );
    } finally {
      await session.close();
    }
  }

  async findMemoriesNeedingEmbedding(
    dimension: 2560 | 384,
  ): Promise<Memory[]> {
    const col = dimension === 2560 ? "embedding" : "embedding384";
    const session = this.driver.session();
    try {
      // IS NULL catches pre-migration nodes that lack the property entirely
      const result = await session.run(
        `MATCH (m:Memory)
         WHERE (m.${col} IS NULL OR m.${col}[0] = 0.0)
           AND m.text IS NOT NULL AND m.text <> ''
         RETURN m.id as id, m.name as name, m.text as text, m.summary as summary,
                m.category as category, m.namespace as namespace, m.status as status,
                m.error as error, m.createdAt as createdAt`,
      );
      return result.records.map((r) => ({
        id: r.get("id"),
        name: r.get("name") ?? "",
        text: r.get("text"),
        summary: r.get("summary") ?? "",
        category: r.get("category") ?? undefined,
        namespace: r.get("namespace") ?? "",
        status: r.get("status") ?? "completed",
        error: r.get("error") ?? undefined,
        createdAt: new Date(r.get("createdAt")),
      }));
    } finally {
      await session.close();
    }
  }

  async findEdgesNeedingEmbedding(
    dimension: 2560 | 384,
  ): Promise<Array<{ id: string; fact: string }>> {
    const col = dimension === 2560 ? "factEmbedding" : "factEmbedding384";
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (:Entity)-[r:RELATES_TO]->(:Entity)
         WHERE (r.${col} IS NULL OR r.${col}[0] = 0.0)
           AND r.fact IS NOT NULL AND r.fact <> ''
         RETURN r.id as id, r.fact as fact`,
      );
      return result.records.map((r) => ({
        id: r.get("id"),
        fact: r.get("fact"),
      }));
    } finally {
      await session.close();
    }
  }

  async updateMemoryEmbeddings(
    memoryId: string,
    embedding2560: number[],
    embedding384: number[],
  ): Promise<void> {
    const has2560 = !isZeroEmbedding(embedding2560);
    const has384 = !isZeroEmbedding(embedding384);
    if (!has2560 && !has384) return;

    const session = this.driver.session();
    try {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { memoryId };
      if (has2560) {
        setClauses.push("m.embedding = $emb2560");
        params.emb2560 = embedding2560;
      }
      if (has384) {
        setClauses.push("m.embedding384 = $emb384");
        params.emb384 = embedding384;
      }
      await session.run(
        `MATCH (m:Memory {id: $memoryId})
         SET ${setClauses.join(", ")}`,
        params,
      );
    } finally {
      await session.close();
    }
  }

  async updateFactEmbeddings(
    factId: string,
    embedding2560: number[],
    embedding384: number[],
  ): Promise<void> {
    const has2560 = !isZeroEmbedding(embedding2560);
    const has384 = !isZeroEmbedding(embedding384);
    if (!has2560 && !has384) return;

    const session = this.driver.session();
    try {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { factId };
      if (has2560) {
        setClauses.push("r.factEmbedding = $emb2560");
        params.emb2560 = embedding2560;
      }
      if (has384) {
        setClauses.push("r.factEmbedding384 = $emb384");
        params.emb384 = embedding384;
      }
      await session.run(
        `MATCH (:Entity)-[r:RELATES_TO]->(:Entity)
         WHERE r.id = $factId
         SET ${setClauses.join(", ")}`,
        params,
      );
    } finally {
      await session.close();
    }
  }

  async updateEdgesToGlobal(
    entityName: string,
  ): Promise<{ outgoing: number; incoming: number }> {
    const session = this.driver.session();
    try {
      const outgoingResult = await session.run(
        `
        MATCH (oldE:Entity {name: $name, scope: 'project'})
        MATCH (newE:Entity {name: $name, scope: 'global'})
        MATCH (oldE)-[r:RELATES_TO]->(target:Entity)
        WHERE target.uuid <> newE.uuid
        MERGE (newE)-[newR:RELATES_TO {relationType: r.relationType}]->(target)
        SET newR = properties(r)
        DELETE r
        RETURN count(r) as updated
        `,
        { name: entityName },
      );

      const incomingResult = await session.run(
        `
        MATCH (oldE:Entity {name: $name, scope: 'project'})
        MATCH (newE:Entity {name: $name, scope: 'global'})
        MATCH (source:Entity)-[r:RELATES_TO]->(oldE)
        WHERE source.uuid <> newE.uuid
        MERGE (source)-[newR:RELATES_TO {relationType: r.relationType}]->(newE)
        SET newR = properties(r)
        DELETE r
        RETURN count(r) as updated
        `,
        { name: entityName },
      );

      return {
        outgoing: outgoingResult.records[0]?.get("updated")?.toNumber() ?? 0,
        incoming: incomingResult.records[0]?.get("updated")?.toNumber() ?? 0,
      };
    } finally {
      await session.close();
    }
  }
}
