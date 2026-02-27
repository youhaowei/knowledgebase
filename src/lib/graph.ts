/**
 * Neo4j Graph Storage - Edge-as-Fact Model (Graphiti-style)
 *
 * Stores:
 * - Memory: Source episodes/inputs with embeddings
 * - Entity: Named things with summaries
 * - RELATES_TO edges: Facts as relationships between entities
 *
 * Facts are edges, not nodes. Each edge has:
 * - relationType, fact text, sentiment, factEmbedding
 * - episodes[] for provenance
 * - validAt/invalidAt for temporal tracking
 */

import neo4j, { Driver } from "neo4j-driver";
import type { Memory, Entity, ExtractedEdge, StoredEdge, StoredEntity } from "../types.js";
import { randomUUID } from "crypto";

// =============================================================================
// SEARCH RESULT TYPES
// =============================================================================

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

// =============================================================================
// GRAPH CLASS
// =============================================================================

export class Graph {
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

  async close(): Promise<void> {
    await this.driver.close();
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async init(): Promise<void> {
    const session = this.driver.session();
    try {
      // Constraints
      await session.run(`
        CREATE CONSTRAINT memory_id IF NOT EXISTS
        FOR (m:Memory) REQUIRE m.id IS UNIQUE
      `);

      await session.run(`
        CREATE CONSTRAINT entity_name_namespace IF NOT EXISTS
        FOR (e:Entity) REQUIRE (e.name, e.namespace) IS UNIQUE
      `);

      // Indexes
      await session.run(`
        CREATE INDEX memory_namespace IF NOT EXISTS
        FOR (m:Memory) ON (m.namespace)
      `);

      await session.run(`
        CREATE INDEX entity_namespace IF NOT EXISTS
        FOR (e:Entity) ON (e.namespace)
      `);

      // Vector index for memory embeddings
      await session.run(`
        CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
        FOR (m:Memory) ON (m.embedding)
        OPTIONS {indexConfig: {
          \`vector.dimensions\`: 2560,
          \`vector.similarity_function\`: 'cosine'
        }}
      `);

      // Full-text index for edge fact search
      await session.run(`
        CREATE FULLTEXT INDEX edge_fact_text IF NOT EXISTS
        FOR ()-[r:RELATES_TO]-()
        ON EACH [r.fact]
      `);
    } finally {
      await session.close();
    }
  }

  // ===========================================================================
  // STORAGE
  // ===========================================================================

  /**
   * Store memory with entities and edges (facts as relationships)
   */
  async store(
    memory: Memory,
    entities: Entity[],
    edges: ExtractedEdge[],
    memoryEmbedding: number[],
    edgeEmbeddings: number[][], // One embedding per edge
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        // 1. Store memory with embedding
        await tx.run(
          `
          CREATE (m:Memory {
            id: $id,
            name: $name,
            text: $text,
            summary: $summary,
            namespace: $namespace,
            embedding: $embedding,
            createdAt: datetime($createdAt)
          })
          `,
          {
            id: memory.id,
            name: memory.name,
            text: memory.text,
            summary: memory.summary,
            namespace: memory.namespace,
            embedding: memoryEmbedding,
            createdAt: memory.createdAt.toISOString(),
          },
        );

        // 2. Upsert entities (merge by name + namespace)
        for (const entity of entities) {
          await tx.run(
            `
            MERGE (e:Entity {name: $name, namespace: $namespace})
            ON CREATE SET e.type = $type, e.description = $description
            ON MATCH SET e.description = COALESCE($description, e.description)
            `,
            {
              name: entity.name,
              type: entity.type,
              description: entity.description ?? null,
              namespace: memory.namespace,
            },
          );
        }

        // 3. Create edges (facts as relationships between entities)
        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i]!;
          const embedding = edgeEmbeddings[i] ?? [];

          // Validate indices
          const sourceEntity = entities[edge.sourceIndex];
          const targetEntity = entities[edge.targetIndex];
          if (!sourceEntity || !targetEntity) {
            console.warn(
              `Invalid edge indices: ${edge.sourceIndex} -> ${edge.targetIndex} for entities length ${entities.length}`,
            );
            continue;
          }

          const edgeId = randomUUID();

          // Create or update RELATES_TO edge
          // If edge with same relationType exists between these entities, add to episodes
          await tx.run(
            `
            MATCH (source:Entity {name: $sourceName, namespace: $namespace})
            MATCH (target:Entity {name: $targetName, namespace: $namespace})
            MERGE (source)-[r:RELATES_TO {relationType: $relationType}]->(target)
            ON CREATE SET
              r.id = $id,
              r.fact = $fact,
              r.sentiment = $sentiment,
              r.confidence = $confidence,
              r.confidenceReason = $confidenceReason,
              r.factEmbedding = $embedding,
              r.episodes = [$memoryId],
              r.validAt = CASE WHEN $validAt IS NOT NULL THEN datetime($validAt) ELSE null END,
              r.invalidAt = null,
              r.createdAt = datetime()
            ON MATCH SET
              r.episodes = r.episodes + $memoryId,
              r.fact = CASE WHEN size($fact) > size(r.fact) THEN $fact ELSE r.fact END
            `,
            {
              sourceName: sourceEntity.name,
              targetName: targetEntity.name,
              namespace: memory.namespace,
              relationType: edge.relationType,
              id: edgeId,
              fact: edge.fact,
              sentiment: edge.sentiment,
              confidence: edge.confidence ?? 1,
              confidenceReason: edge.confidenceReason ?? null,
              embedding,
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

  // ===========================================================================
  // SEARCH
  // ===========================================================================

  /**
   * Search by vector similarity on memories and full-text on edge facts
   * Also fuzzy matches entity names
   */
  async search(
    embedding: number[],
    query: string,
    limit = 10,
  ): Promise<SearchResult> {
    const session = this.driver.session();
    try {
      // 1. Vector search for similar memories
      const memoryResult = await session.run(
        `
        CALL db.index.vector.queryNodes('memory_embedding', $limit, $embedding)
        YIELD node, score
        RETURN node.id as id,
               node.name as name,
               node.text as text,
               node.summary as summary,
               node.namespace as namespace,
               node.createdAt as createdAt,
               score
        ORDER BY score DESC
        `,
        { embedding, limit: neo4j.int(limit) },
      );

      const memories: Memory[] = memoryResult.records.map((r) => ({
        id: r.get("id"),
        name: r.get("name"),
        text: r.get("text"),
        summary: r.get("summary"),
        namespace: r.get("namespace"),
        createdAt: new Date(r.get("createdAt")),
      }));

      // 2. Full-text search for edges by fact content
      const edgeResult = await session.run(
        `
        CALL db.index.fulltext.queryRelationships('edge_fact_text', $query)
        YIELD relationship, score
        WITH relationship as r, score
        MATCH (source:Entity)-[r]->(target:Entity)
        WHERE r.invalidAt IS NULL
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
        { query, limit: neo4j.int(limit) },
      );

      const edges: StoredEdge[] = edgeResult.records.map((r) => ({
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
        invalidAt: r.get("invalidAt") ? new Date(r.get("invalidAt")) : undefined,
        createdAt: new Date(r.get("createdAt")),
      }));

      // 3. Fuzzy match entities by name
      const entityResult = await session.run(
        `
        MATCH (e:Entity)
        WHERE e.name =~ $pattern
        RETURN e.name as name,
               e.type as type,
               e.description as description,
               e.summary as summary,
               e.namespace as namespace
        LIMIT $limit
        `,
        { pattern: `(?i).*${query}.*`, limit: neo4j.int(limit) },
      );

      const entities: StoredEntity[] = entityResult.records.map((r) => ({
        name: r.get("name"),
        type: r.get("type"),
        description: r.get("description") ?? undefined,
        summary: r.get("summary") ?? undefined,
        namespace: r.get("namespace"),
      }));

      return { memories, edges, entities };
    } finally {
      await session.close();
    }
  }

  // ===========================================================================
  // GET BY NAME
  // ===========================================================================

  /**
   * Get memory or entity by exact name lookup
   * Returns all edges associated with the found item
   */
  async get(name: string, namespace = "default"): Promise<GetResult> {
    const session = this.driver.session();
    try {
      // Try to find a Memory with this name
      const memResult = await session.run(
        `
        MATCH (m:Memory {name: $name, namespace: $namespace})
        RETURN m.id as id,
               m.name as name,
               m.text as text,
               m.summary as summary,
               m.namespace as namespace,
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
            namespace: memoryRecord.get("namespace"),
            createdAt: new Date(memoryRecord.get("createdAt")),
          }
        : undefined;

      // Try to find an Entity with this name
      const entityResult = await session.run(
        `
        MATCH (e:Entity {name: $name, namespace: $namespace})
        RETURN e.name as name,
               e.type as type,
               e.description as description,
               e.summary as summary,
               e.namespace as namespace
        `,
        { name, namespace },
      );

      const entityRecord = entityResult.records[0];
      const entity: StoredEntity | undefined = entityRecord
        ? {
            name: entityRecord.get("name"),
            type: entityRecord.get("type"),
            description: entityRecord.get("description") ?? undefined,
            summary: entityRecord.get("summary") ?? undefined,
            namespace: entityRecord.get("namespace"),
          }
        : undefined;

      // Get edges
      let edges: StoredEdge[] = [];

      if (memory) {
        // Get edges from memories in this episode
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
          invalidAt: r.get("invalidAt") ? new Date(r.get("invalidAt")) : undefined,
          createdAt: new Date(r.get("createdAt")),
        }));
      } else if (entity) {
        // Get edges involving this entity (as source or target)
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
          invalidAt: r.get("invalidAt") ? new Date(r.get("invalidAt")) : undefined,
          createdAt: new Date(r.get("createdAt")),
        }));
      }

      return { memory, entity, edges };
    } finally {
      await session.close();
    }
  }

  // ===========================================================================
  // FORGET (with reason - creates audit memory)
  // ===========================================================================

  /**
   * Invalidate an edge with reason, creating an audit trail
   */
  async forgetEdge(
    edgeId: string,
    reason: string,
    namespace = "default",
  ): Promise<{
    invalidatedEdge?: StoredEdge;
    auditMemoryId?: string;
  }> {
    const session = this.driver.session();
    try {
      let invalidatedEdge: StoredEdge | undefined;
      let auditMemoryId: string | undefined;

      await session.executeWrite(async (tx) => {
        // Find and invalidate the edge
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
            validAt: record.get("validAt") ? new Date(record.get("validAt")) : undefined,
            invalidAt: record.get("invalidAt") ? new Date(record.get("invalidAt")) : undefined,
            createdAt: new Date(record.get("createdAt")),
          };

          // Create audit memory recording the decision
          auditMemoryId = randomUUID();
          const auditText = `Invalidated fact "${invalidatedEdge.fact}" because: ${reason}`;

          await tx.run(
            `
            CREATE (m:Memory {
              id: $id,
              name: $name,
              text: $text,
              summary: $summary,
              namespace: $namespace,
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

  /**
   * Remove by name - handles both Memories and Entities
   */
  async forget(
    name: string,
    namespace = "default",
  ): Promise<{
    deletedMemory: boolean;
    deletedEntity: boolean;
  }> {
    const session = this.driver.session();
    try {
      let deletedMemory = false;
      let deletedEntity = false;

      await session.executeWrite(async (tx) => {
        // Delete Memory (edges referencing this memory stay but lose provenance)
        const memResult = await tx.run(
          `
          MATCH (m:Memory {name: $name, namespace: $namespace})
          DETACH DELETE m
          RETURN count(m) as deleted
          `,
          { name, namespace },
        );
        deletedMemory = (memResult.records[0]?.get("deleted") ?? 0) > 0;

        // Delete Entity and all edges involving it
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

  // ===========================================================================
  // STATS
  // ===========================================================================

  async stats(namespace = "default"): Promise<{
    memories: number;
    entities: number;
    edges: number;
  }> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (m:Memory {namespace: $namespace})
        WITH count(m) as memCount
        MATCH (e:Entity {namespace: $namespace})
        WITH memCount, count(e) as entityCount
        MATCH (e1:Entity {namespace: $namespace})-[r:RELATES_TO]->()
        RETURN memCount as memories, entityCount as entities, count(r) as edges
        `,
        { namespace },
      );

      const record = result.records[0];
      return {
        memories: record?.get("memories") ?? 0,
        entities: record?.get("entities") ?? 0,
        edges: record?.get("edges") ?? 0,
      };
    } finally {
      await session.close();
    }
  }

  // ===========================================================================
  // GRAPH DATA FOR VISUALIZATION
  // ===========================================================================

  async getGraphData(namespace = "default"): Promise<{
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
      edgeId: string;
    }>;
  }> {
    const session = this.driver.session();
    try {
      // Get all entities as nodes
      const nodeResult = await session.run(
        `
        MATCH (e:Entity {namespace: $namespace})
        RETURN e.name as id,
               e.name as name,
               e.type as type,
               e.description as description,
               e.summary as summary
        `,
        { namespace },
      );

      const nodes = nodeResult.records.map((r) => ({
        id: r.get("id"),
        name: r.get("name"),
        type: r.get("type"),
        description: r.get("description") ?? undefined,
        summary: r.get("summary") ?? undefined,
      }));

      // Get edges as links (only active, non-invalidated)
      const linkResult = await session.run(
        `
        MATCH (source:Entity {namespace: $namespace})-[r:RELATES_TO]->(target:Entity)
        WHERE r.invalidAt IS NULL
        RETURN source.name as source,
               target.name as target,
               r.relationType as relationType,
               r.fact as fact,
               r.sentiment as sentiment,
               r.confidence as confidence,
               r.id as edgeId
        `,
        { namespace },
      );

      const links = linkResult.records.map((r) => ({
        source: r.get("source"),
        target: r.get("target"),
        relationType: r.get("relationType"),
        fact: r.get("fact"),
        sentiment: r.get("sentiment") ?? 0,
        confidence: r.get("confidence") ?? 1,
        edgeId: r.get("edgeId"),
      }));

      return { nodes, links };
    } finally {
      await session.close();
    }
  }
}
