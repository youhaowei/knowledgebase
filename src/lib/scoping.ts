/**
 * Entity Scope Management
 *
 * Handles promotion of project-scoped entities to global:
 * - previewPromotion: Preview what will be merged
 * - confirmPromotion: Execute promotion (atomic transaction)
 * - findDuplicateEntities: Find entities in multiple namespaces
 * - listGlobalEntities: List all global entities
 * - forgetGlobal: Delete global entity (with edge protection)
 */

import { Graph } from "./graph.js";
import { randomUUID } from "crypto";
import type { StoredEntity, DuplicateReport } from "../types.js";

const graph = new Graph();

/**
 * Preview what will happen if entity is promoted to global
 * Returns candidates from all namespaces
 */
export async function previewPromotion(entityName: string): Promise<{
  canPromote: boolean;
  reason?: string;
  warning?: string;
  candidates?: StoredEntity[];
  willMerge?: string[];
}> {
  const candidates = await graph.findEntities({
    name: entityName,
    scope: "project",
  });

  if (candidates.length === 0) {
    return {
      canPromote: false,
      reason: "No project-scoped entities found with this name",
    };
  }

  if (candidates.length === 1) {
    return {
      canPromote: true,
      warning:
        "Only one namespace has this entity - are you sure you want to make it global?",
      candidates,
      willMerge: candidates.map((c) => c.namespace ?? "default"),
    };
  }

  return {
    canPromote: true,
    candidates,
    willMerge: candidates.map((c) => c.namespace ?? "default"),
  };
}

/**
 * Confirm promotion after preview
 * Executes promotion atomically in a transaction
 */
export async function confirmPromotion(entityName: string): Promise<{
  promoted: boolean;
  globalEntityUuid: string;
  mergedFrom: string[];
  edgesUpdated: { outgoing: number; incoming: number };
}> {
  // Re-query candidates (don't trust stale preview data)
  const candidates = await graph.findEntities({
    name: entityName,
    scope: "project",
  });

  if (candidates.length === 0) {
    throw new Error(
      "No project-scoped entities found - may have been promoted already",
    );
  }

  // Execute in single transaction for atomicity
  let globalEntityUuid: string;
  let edgesUpdated: { outgoing: number; incoming: number };
  const mergedFrom: string[] = [];

  await graph.withTransaction(async (tx) => {
    // 1. Create global entity (merge descriptions from all candidates)
    const descriptions = candidates
      .map((c) => c.description)
      .filter(Boolean) as string[];
    const mergedDescription =
      descriptions.length > 1
        ? descriptions.join(" | ")
        : (descriptions[0] ?? undefined);

    globalEntityUuid = randomUUID();
    const globalEntity: StoredEntity = {
      uuid: globalEntityUuid,
      name: entityName,
      type: candidates[0]!.type,
      scope: "global",
      namespace: undefined,
      description: mergedDescription,
      summary: candidates[0]!.summary,
    };

    // Store global entity
    await tx.run(
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
        uuid: globalEntity.uuid,
        name: globalEntity.name,
        type: globalEntity.type,
        description: globalEntity.description ?? null,
        namespace: null,
        scope: "global",
        summary: globalEntity.summary ?? null,
      },
    );

    // 2. Update all edges to point to global entity (both directions)
    // Outgoing edges
    const outgoingResult = await tx.run(
      `
      MATCH (oldE:Entity {name: $name, scope: 'project'})
      MATCH (newE:Entity {uuid: $uuid})
      MATCH (oldE)-[r:RELATES_TO]->(target:Entity)
      WHERE target.uuid <> $uuid
      MERGE (newE)-[newR:RELATES_TO {relationType: r.relationType}]->(target)
      SET newR = properties(r)
      DELETE r
      RETURN count(r) as updated
      `,
      { name: entityName, uuid: globalEntityUuid },
    );

    // Incoming edges
    const incomingResult = await tx.run(
      `
      MATCH (oldE:Entity {name: $name, scope: 'project'})
      MATCH (newE:Entity {uuid: $uuid})
      MATCH (source:Entity)-[r:RELATES_TO]->(oldE)
      WHERE source.uuid <> $uuid
      MERGE (source)-[newR:RELATES_TO {relationType: r.relationType}]->(newE)
      SET newR = properties(r)
      DELETE r
      RETURN count(r) as updated
      `,
      { name: entityName, uuid: globalEntityUuid },
    );

    edgesUpdated = {
      outgoing: outgoingResult.records[0]?.get("updated")?.toNumber() ?? 0,
      incoming: incomingResult.records[0]?.get("updated")?.toNumber() ?? 0,
    };

    // 3. Delete project-scoped duplicates
    for (const candidate of candidates) {
      mergedFrom.push(candidate.namespace ?? "default");
      await tx.run(
        `
        MATCH (e:Entity {uuid: $uuid})
        DETACH DELETE e
        `,
        { uuid: candidate.uuid },
      );
    }
  });

  return {
    promoted: true,
    globalEntityUuid: globalEntityUuid!,
    mergedFrom,
    edgesUpdated: edgesUpdated!,
  };
}

/**
 * Find entities that exist in multiple namespaces (candidates for promotion)
 */
export async function findDuplicateEntities(): Promise<DuplicateReport[]> {
  const session = graph.getSession();
  try {
    const result = await session.run(
      `
      MATCH (e:Entity)
      WHERE e.scope = 'project'
      WITH e.name AS name,
           e.type AS type,
           collect(DISTINCT e.namespace) AS namespaces,
           collect(e) AS entities
      WHERE size(namespaces) > 1
      RETURN name, type, namespaces,
             [x IN entities | {uuid: x.uuid, namespace: x.namespace, description: x.description}] AS candidates
      ORDER BY size(namespaces) DESC
      `,
    );

    return result.records.map((r) => ({
      name: r.get("name"),
      type: r.get("type"),
      namespaces: r.get("namespaces"),
      candidates: r.get("candidates"),
      suggestPromotion: true,
    }));
  } finally {
    await session.close();
  }
}

/**
 * List all global entities
 */
export async function listGlobalEntities(): Promise<StoredEntity[]> {
  return graph.findEntities({ scope: "global" });
}

/**
 * Delete a global entity (refuses if edges exist)
 */
export async function forgetGlobal(entityName: string): Promise<{
  deleted: boolean;
  reason?: string;
  edgeIds?: string[];
}> {
  const entities = await graph.findEntities({
    name: entityName,
    scope: "global",
  });

  if (entities.length === 0) {
    return { deleted: false, reason: "No global entity found with this name" };
  }

  const entity = entities[0]!;

  // Check for existing edges (both directions)
  const outgoingEdges = await graph.findEdges({
    sourceEntityName: entityName,
    includeInvalidated: false,
  });
  const incomingEdges = await graph.findEdges({
    targetEntityName: entityName,
    includeInvalidated: false,
  });

  const allEdges = [...outgoingEdges, ...incomingEdges];

  if (allEdges.length > 0) {
    return {
      deleted: false,
      reason: `Cannot delete: ${allEdges.length} edges reference this entity. Use forgetEdge first.`,
      edgeIds: allEdges.map((e) => e.id),
    };
  }

  // Delete associated edges first (should be none, but be safe)
  await graph.deleteEdgesForEntity(entity.uuid);
  await graph.deleteEntity(entity.uuid);

  return { deleted: true };
}
