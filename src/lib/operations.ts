/**
 * Business Operations Layer
 *
 * High-level operations that combine graph CRUD with business logic:
 * - addMemory: Queue memory for processing
 * - search: Semantic search with namespace filtering and global entity preference
 * - getByName: Lookup with global-first fallback
 * - forget: Remove project-scoped entities only
 */

import { Graph } from "./graph.js";
import { Queue } from "./queue.js";
import { embed } from "./embedder.js";
import { randomUUID } from "crypto";
import type { Memory, StoredEntity, StoredEdge } from "../types.js";

const graph = new Graph();
const queue = new Queue(graph);

// Export queue status for UI visibility
export async function getQueueStatus(namespace?: string): Promise<number> {
  return await queue.pending(namespace);
}

/**
 * Add a memory to the processing queue
 */
export async function addMemory(
  text: string,
  name?: string,
  namespace = "default",
): Promise<{ id: string; queued: boolean }> {
  const memory: Memory = {
    id: randomUUID(),
    name: name ?? "",
    text,
    summary: "",
    namespace,
    status: "pending",
    createdAt: new Date(),
  };
  await queue.add(memory);
  return { id: memory.id, queued: true };
}

/**
 * Search the knowledge graph
 * Returns memories, edges, entities (with global preference), and guidance
 */
export async function search(
  query: string,
  namespace?: string,
  limit = 10,
): Promise<{
  memories: Memory[];
  edges: StoredEdge[];
  entities: StoredEntity[];
  guidance: string;
}> {
  const embedding = await embed(query);

  // Get memories (namespace-filtered)
  const memories = await graph.vectorSearch(
    embedding,
    limit,
    namespace ? { namespace } : undefined,
  );

  // Get edges (namespace-filtered)
  const edges = await graph.fullTextSearchEdges(
    query,
    limit,
    namespace ? { namespace } : undefined,
  );

  // Get entities: namespace-specific + ALL global (with preference)
  const entities = await graph.findEntitiesWithGlobalPreference(
    namespace,
    limit,
  );

  return {
    memories,
    edges,
    entities,
    guidance:
      "If any facts appear contradictory, use forgetEdge to invalidate with a reason.",
  };
}

/**
 * Get entity by name (checks global first, then namespace)
 */
export async function getByName(
  name: string,
  namespace?: string,
): Promise<{
  entity?: StoredEntity;
  edges: StoredEdge[];
}> {
  // Check global first
  let entity = (await graph.findEntities({ name, scope: "global" }))[0];
  if (!entity && namespace) {
    // Then check namespace
    entity = (
      await graph.findEntities({ name, namespace, scope: "project" })
    )[0];
  }

  const edges = entity
    ? await graph.findEdges({
        sourceEntityName: name,
        includeInvalidated: false,
      })
    : [];

  return { entity, edges };
}

/**
 * Forget a project-scoped entity or memory
 * Only forgets project-scoped entities (global entities require forgetGlobal)
 */
export async function forget(
  name: string,
  namespace: string,
): Promise<{ deleted: boolean; reason?: string }> {
  // Only forget project-scoped entities
  const entities = await graph.findEntities({
    name,
    namespace,
    scope: "project",
  });
  if (entities.length === 0) {
    return {
      deleted: false,
      reason: "Not found or is global (use forgetGlobal)",
    };
  }
  await graph.deleteEntity(entities[0]!.uuid);
  return { deleted: true };
}
