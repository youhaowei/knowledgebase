/**
 * Business Operations Layer
 *
 * High-level operations that combine GraphProvider with business logic:
 * - addMemory: Queue memory for processing
 * - search: Semantic + full-text search with vector fallback
 * - getByName: Lookup entity by name
 * - forget: Remove entities/memories by name
 * - forgetEdge: Invalidate edge with audit trail
 * - stats: Namespace statistics
 */

import { createGraphProvider, type GraphProvider } from "./graph-provider.js";
import { Queue } from "./queue.js";
import { embedWithDimension, isZeroEmbedding } from "./embedder.js";
import { randomUUID } from "crypto";
import type { Memory, StoredEntity, StoredEdge, Intent } from "../types.js";
import { classifyIntent, boostEdgesByIntent } from "./intents.js";

let provider: GraphProvider;
let queue: Queue;

/** Shared provider singleton. Exported for modules that need direct provider access. */
export async function getProvider() {
  if (!provider) {
    provider = await createGraphProvider();
    queue = new Queue(provider);
  }
  return provider;
}

async function getQueue() {
  await getProvider();
  return queue;
}

export async function getQueueStatus(namespace?: string): Promise<number> {
  const q = await getQueue();
  return q.pending(namespace);
}

export async function addMemory(
  text: string,
  name?: string,
  namespace = "default",
): Promise<{ id: string; queued: boolean; existing?: boolean }> {
  // Dedup by exact name match within namespace.
  // Uses CONTAINS query + post-filter because the provider doesn't support exact match.
  // High limit (200) to handle prefix collisions (e.g., "retro-1" CONTAINS-matches "retro-10"..."retro-199").
  if (name) {
    const gp = await getProvider();
    const candidates = await gp.findMemories({ name, namespace }, 200);
    const exact = candidates.find((m) => m.name === name);
    if (exact) return { id: exact.id, queued: false, existing: true };
  }

  const q = await getQueue();
  const memory: Memory = {
    id: randomUUID(),
    name: name ?? "",
    text,
    summary: "",
    namespace,
    status: "pending",
    createdAt: new Date(),
  };
  await q.add(memory);
  return { id: memory.id, queued: true };
}

export async function search(
  query: string,
  namespace?: string,
  limit = 10,
): Promise<{
  memories: Memory[];
  edges: StoredEdge[];
  entities: StoredEntity[];
  intent: Intent;
  guidance: string;
}> {
  const gp = await getProvider();
  const { embedding } = await embedWithDimension(query);
  const result = await gp.search(isZeroEmbedding(embedding) ? [] : embedding, query, limit);
  const intent = classifyIntent(query);

  return {
    ...result,
    edges: boostEdgesByIntent(result.edges, intent),
    intent,
    guidance:
      "If any facts appear contradictory, use forgetEdge to invalidate with a reason.",
  };
}

export async function getByName(
  name: string,
  namespace?: string,
): Promise<{
  entity?: StoredEntity;
  edges: StoredEdge[];
}> {
  const gp = await getProvider();
  const result = await gp.get(name, namespace ?? "default");
  return { entity: result.entity, edges: result.edges };
}

export async function forget(
  name: string,
  namespace: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const gp = await getProvider();
  const result = await gp.forget(name, namespace);
  if (!result.deletedMemory && !result.deletedEntity) {
    return { deleted: false, reason: "Not found" };
  }
  return { deleted: true };
}

export async function forgetEdge(edgeId: string, reason: string, namespace = "default") {
  const gp = await getProvider();
  return gp.forgetEdge(edgeId, reason, namespace);
}

export async function stats(namespace = "default") {
  const gp = await getProvider();
  return gp.stats(namespace);
}

export async function close() {
  // LadybugDB close() triggers a Bun segfault (native addon issue).
  // Process exit handles cleanup, so explicit close is skipped.
  // if (provider) await provider.close();
}
