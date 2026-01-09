/**
 * Neo4j Graph Storage with Conflict Detection
 *
 * Stores memories, items, and relations in Neo4j
 * Detects conflicts at READ time (not write time)
 * Supports vector search via Neo4j vector index
 */

import neo4j, { Driver } from "neo4j-driver";
import type {
  Memory,
  Item,
  Relation,
  StoredRelation,
  Resolution,
} from "../types.js";
import { randomUUID } from "crypto";

export interface SearchResult {
  memories: Memory[];
  relations: StoredRelation[];
  conflicts: Conflict[];
}

export interface Conflict {
  itemName: string;
  relationType: string;
  relations: StoredRelation[]; // 2+ conflicting relations
  resolution?: Resolution; // null if unresolved
}

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

  /**
   * Store memory with items and relations (no conflict checking at write time)
   */
  async store(
    memory: Memory,
    items: Item[],
    relations: Relation[],
    embedding: number[],
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.executeWrite(async (tx) => {
        // Store memory with embedding
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
            embedding,
            createdAt: memory.createdAt.toISOString(),
          },
        );

        // Upsert items (merge by name + namespace)
        for (const item of items) {
          await tx.run(
            `
            MERGE (i:Item {name: $name, namespace: $namespace})
            ON CREATE SET i.type = $type, i.description = $description
            ON MATCH SET i.description = COALESCE($description, i.description)
            `,
            {
              name: item.name,
              type: item.type,
              description: item.description ?? null,
              namespace: memory.namespace,
            },
          );
        }

        // Create relations with unique IDs and timestamps
        for (const rel of relations) {
          await tx.run(
            `
            MATCH (a:Item {name: $from, namespace: $namespace})
            MATCH (b:Item {name: $to, namespace: $namespace})
            CREATE (a)-[:RELATION {
              id: $relId,
              type: $relation,
              memoryId: $memoryId,
              createdAt: datetime($createdAt)
            }]->(b)
            `,
            {
              from: rel.from,
              to: rel.to,
              relation: rel.relation,
              relId: randomUUID(),
              memoryId: memory.id,
              namespace: memory.namespace,
              createdAt: new Date().toISOString(),
            },
          );
        }
      });
    } finally {
      await session.close();
    }
  }

  /**
   * Search memories by vector similarity + text matching
   * Returns memories, relations, and detected conflicts
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
        { embedding, limit },
      );

      const memories: Memory[] = memoryResult.records.map((r) => ({
        id: r.get("id"),
        name: r.get("name"),
        text: r.get("text"),
        summary: r.get("summary"),
        namespace: r.get("namespace"),
        createdAt: new Date(r.get("createdAt")),
      }));

      // 2. Also look up items by name (fuzzy match on query)
      const relResult = await session.run(
        `
        MATCH (a:Item)-[r:RELATION]->(b:Item)
        WHERE a.name =~ $pattern OR b.name =~ $pattern
        RETURN r.id as id,
               a.name as from,
               r.type as relation,
               b.name as to,
               r.memoryId as memoryId,
               r.createdAt as createdAt
        ORDER BY r.createdAt DESC
        `,
        { pattern: `(?i).*${query}.*` },
      );

      const relations: StoredRelation[] = relResult.records.map((r) => ({
        id: r.get("id"),
        from: r.get("from"),
        relation: r.get("relation"),
        to: r.get("to"),
        memoryId: r.get("memoryId"),
        createdAt: new Date(r.get("createdAt")),
      }));

      // 3. Detect conflicts
      const conflicts = await this.detectConflicts(relations);

      return { memories, relations, conflicts };
    } finally {
      await session.close();
    }
  }

  /**
   * Get memory or item by exact name lookup
   */
  async get(name: string): Promise<{
    memory?: Memory;
    relatedItems?: Item[];
    item?: Item;
    relations: StoredRelation[];
    conflicts: Conflict[];
  }> {
    const session = this.driver.session();
    try {
      // Check for Memory with this name
      const memResult = await session.run(
        `
        MATCH (m:Memory {name: $name})
        OPTIONAL MATCH (a:Item)-[r:RELATION {memoryId: m.id}]->(b:Item)
        RETURN m.id as memId,
               m.name as memName,
               m.text as memText,
               m.summary as memSummary,
               m.namespace as memNamespace,
               m.createdAt as memCreatedAt,
               collect(DISTINCT {name: a.name, type: a.type, description: a.description}) +
               collect(DISTINCT {name: b.name, type: b.type, description: b.description}) as items
        `,
        { name },
      );

      const memoryRecord = memResult.records[0];
      const memory =
        memoryRecord && memoryRecord.get("memId")
          ? {
              id: memoryRecord.get("memId"),
              name: memoryRecord.get("memName"),
              text: memoryRecord.get("memText"),
              summary: memoryRecord.get("memSummary"),
              namespace: memoryRecord.get("memNamespace"),
              createdAt: new Date(memoryRecord.get("memCreatedAt")),
            }
          : undefined;

      interface ItemData {
        name: string;
        type: string;
        description?: string;
      }
      const relatedItems: Item[] = memoryRecord
        ? memoryRecord
            .get("items")
            .filter((i: ItemData) => i.name) // Remove nulls
            .map((i: ItemData) => ({
              name: i.name,
              type: i.type,
              description: i.description,
            }))
        : [];

      // Check for Item with this name
      const itemResult = await session.run(
        `
        MATCH (i:Item {name: $name})
        RETURN i.name as name,
               i.type as type,
               i.description as description
        `,
        { name },
      );

      const itemRecord = itemResult.records[0];
      const item: Item | undefined = itemRecord
        ? {
            name: itemRecord.get("name") as string,
            type: itemRecord.get("type") as Item["type"],
            description: itemRecord.get("description") as string | undefined,
          }
        : undefined;

      // Get all relations involving this item
      const relResult = await session.run(
        `
        MATCH (a:Item {name: $name})-[r:RELATION]->(b:Item)
        RETURN r.id as id,
               a.name as from,
               r.type as relation,
               b.name as to,
               r.memoryId as memoryId,
               r.createdAt as createdAt
        UNION
        MATCH (a:Item)-[r:RELATION]->(b:Item {name: $name})
        RETURN r.id as id,
               a.name as from,
               r.type as relation,
               b.name as to,
               r.memoryId as memoryId,
               r.createdAt as createdAt
        ORDER BY createdAt DESC
        `,
        { name },
      );

      const relations: StoredRelation[] = relResult.records.map((r) => ({
        id: r.get("id"),
        from: r.get("from"),
        relation: r.get("relation"),
        to: r.get("to"),
        memoryId: r.get("memoryId"),
        createdAt: new Date(r.get("createdAt")),
      }));

      const conflicts = await this.detectConflicts(relations);

      return {
        memory,
        relatedItems: relatedItems.length > 0 ? relatedItems : undefined,
        item,
        relations,
        conflicts,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Detect conflicts in a set of relations
   * Conflict = same subject + EXCLUSIVE relation type, different objects
   *
   * Only certain relation types are exclusive (can only have one target):
   * - prefers: A person typically has ONE preference for a category
   * - is: Identity relations are exclusive
   * - decided: A decision typically resolves to one choice
   *
   * Non-exclusive relations (can have multiple targets):
   * - uses, knows, works_on, created, depends_on, related_to, alternative_to, etc.
   */
  private async detectConflicts(
    relations: StoredRelation[],
  ): Promise<Conflict[]> {
    // Relation types where having multiple targets indicates a conflict
    const exclusiveRelations = new Set(["prefers", "is", "decided"]);

    const conflicts: Conflict[] = [];
    const grouped = new Map<string, StoredRelation[]>();

    // Group by "from + relationType"
    for (const rel of relations) {
      const key = `${rel.from}::${rel.relation}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(rel);
    }

    // Find groups with different "to" values, but only for exclusive relations
    for (const [key, rels] of grouped) {
      const parts = key.split("::");
      const relationType = parts[1] ?? "";

      // Skip non-exclusive relation types
      if (!exclusiveRelations.has(relationType)) continue;

      const uniqueTos = new Set(rels.map((r) => r.to));
      if (uniqueTos.size > 1) {
        const itemName = parts[0] ?? "";

        // Check if there's an existing resolution
        const resolution = await this.getResolution(rels.map((r) => r.id));

        conflicts.push({
          itemName,
          relationType,
          relations: rels,
          resolution,
        });
      }
    }

    return conflicts;
  }

  /**
   * Get resolution for a set of relation IDs (if one exists)
   */
  private async getResolution(
    relationIds: string[],
  ): Promise<Resolution | undefined> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `
        MATCH (res:Resolution)
        WHERE ALL(id IN $relationIds WHERE id IN res.conflictingRelations)
        RETURN res.id as id,
               res.conflictingRelations as conflictingRelations,
               res.decision as decision,
               res.keptRelationId as keptRelationId,
               res.createdAt as createdAt
        ORDER BY res.createdAt DESC
        LIMIT 1
        `,
        { relationIds },
      );

      const record = result.records[0];
      if (record) {
        return {
          id: record.get("id"),
          conflictingRelations: record.get("conflictingRelations"),
          decision: record.get("decision"),
          keptRelationId: record.get("keptRelationId") ?? undefined,
          createdAt: new Date(record.get("createdAt")),
        };
      }
      return undefined;
    } finally {
      await session.close();
    }
  }

  /**
   * Store a resolution decision
   */
  async storeResolution(
    conflictingRelationIds: string[],
    decision: "keep_newer" | "keep_older" | "keep_both" | "keep_neither",
    keptRelationId?: string,
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `
        CREATE (res:Resolution {
          id: $id,
          conflictingRelations: $conflictingRelations,
          decision: $decision,
          keptRelationId: $keptRelationId,
          createdAt: datetime($createdAt)
        })
        `,
        {
          id: randomUUID(),
          conflictingRelations: conflictingRelationIds,
          decision,
          keptRelationId: keptRelationId ?? null,
          createdAt: new Date().toISOString(),
        },
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Remove by name - handles both Memories and Items
   */
  async forget(name: string): Promise<{
    deletedMemory: boolean;
    deletedItem: boolean;
  }> {
    const session = this.driver.session();
    try {
      let deletedMemory = false;
      let deletedItem = false;

      await session.executeWrite(async (tx) => {
        // Try to delete Memory with this name (and its relations)
        const memResult = await tx.run(
          `
          MATCH (m:Memory {name: $name})
          OPTIONAL MATCH ()-[r:RELATION {memoryId: m.id}]->()
          DELETE r, m
          RETURN count(m) as deleted
          `,
          { name },
        );
        deletedMemory = memResult.records[0]?.get("deleted") > 0;

        // Try to delete Item with this name (and its relations)
        const itemResult = await tx.run(
          `
          MATCH (i:Item {name: $name})
          OPTIONAL MATCH (i)-[r:RELATION]-()
          DELETE r, i
          RETURN count(i) as deleted
          `,
          { name },
        );
        deletedItem = itemResult.records[0]?.get("deleted") > 0;
      });

      return { deletedMemory, deletedItem };
    } finally {
      await session.close();
    }
  }
}
