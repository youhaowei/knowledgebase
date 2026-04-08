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
import type { GraphData } from "./graph-provider.js";
import { classifyIntent, boostEdgesByIntent } from "./intents.js";
import { tracked } from "./analytics.js";
import { writeMemoryFile, appendToIndex, getNamespacePath, listMemoryFiles, normalizeTags } from "./fs-memory.js";
import type { MemoryFrontmatter, Origin } from "./fs-memory.js";

let providerPromise: Promise<GraphProvider> | null = null;
let queue: Queue;

/** Shared provider singleton. Exported for modules that need direct provider access. */
export async function getProvider() {
  if (!providerPromise) {
    providerPromise = createGraphProvider().then((p) => {
      queue = new Queue(p);
      return p;
    });
  }
  return providerPromise;
}

export async function getQueue() {
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
  origin: Origin = "manual",
  tags: string[] = [],
): Promise<{ id: string; name: string; path: string; status: "written" | "existing" }> {
  return tracked("add", { namespace }, async () => {
    // Dedup by exact name match within namespace (filesystem-based).
    if (name) {
      const files = listMemoryFiles(namespace);
      const existing = files.find((f) => f.name === name);
      if (existing) return { id: existing.id, name, path: existing.path, status: "existing" as const };
    }

    const id = randomUUID();
    const resolvedName = name ?? "";
    const nsPath = getNamespacePath(namespace);
    const frontmatter: MemoryFrontmatter = {
      id,
      name: resolvedName,
      origin,
      namespace,
      tags: normalizeTags(tags),
      createdAt: new Date().toISOString(),
    };

    const filePath = await writeMemoryFile(id, text, frontmatter);
    appendToIndex(nsPath, frontmatter);

    // Fire-and-forget: notify server to background-index this file
    const serverUrl = process.env.KB_SERVER_URL ?? "http://localhost:8000";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(`${serverUrl}/api/trigger-index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, namespace }),
      signal: controller.signal,
    }).then((res) => {
      if (!res.ok) console.error(`[kb] Server returned ${res.status}`);
    }).catch(() => {
      console.error("[kb] Server not running — file written, indexing deferred");
    }).finally(() => clearTimeout(timeout));

    return { id, name: resolvedName, path: filePath, status: "written" as const };
  }, (result) => ({
    textLength: text.length,
    name: name ?? null,
    existing: result.status === "existing",
    memoryId: result.id,
  }));
}

export async function search(
  query: string,
  namespace = "default",
  limit = 10,
): Promise<{
  memories: Memory[];
  edges: StoredEdge[];
  entities: StoredEntity[];
  intent: Intent;
  guidance: string;
}> {
  return tracked("search", { namespace }, async () => {
    const gp = await getProvider();
    const { embedding } = await embedWithDimension(query);
    // Fetch extra results — provider searches all namespaces, we post-filter
    const fetchLimit = limit * 3;
    const result = await gp.search(isZeroEmbedding(embedding) ? [] : embedding, query, fetchLimit);
    const intent = classifyIntent(query);

    // Post-filter by namespace (provider doesn't support namespace-scoped search)
    const memories = result.memories.filter((m) => m.namespace === namespace).slice(0, limit);
    const edges = result.edges.filter((e) => e.namespace === namespace).slice(0, limit);
    const entities = result.entities.filter((e) => e.namespace === namespace).slice(0, limit);

    return {
      memories,
      edges: boostEdgesByIntent(edges, intent),
      entities,
      intent,
      guidance:
        "If any facts appear contradictory, use forgetEdge to invalidate with a reason.",
    };
  }, (result) => ({
    query,
    queryLength: query.length,
    limit,
    resultCount: {
      memories: result.memories.length,
      edges: result.edges.length,
      entities: result.entities.length,
    },
    intent: result.intent,
    emptyResult: result.memories.length === 0 && result.edges.length === 0 && result.entities.length === 0,
  }));
}

export async function getByName(
  name: string,
  namespace?: string,
): Promise<{
  memory?: Memory;
  entity?: StoredEntity;
  edges: StoredEdge[];
}> {
  const ns = namespace ?? "default";
  return tracked("get", { namespace: ns }, async () => {
    const gp = await getProvider();
    const result = await gp.get(name, ns);
    return { memory: result.memory, entity: result.entity, edges: result.edges };
  }, (result) => ({
    name,
    found: !!(result.memory || result.entity),
  }));
}

export async function forget(
  name: string,
  namespace: string,
): Promise<{ deleted: boolean; reason?: string }> {
  return tracked("forget", { namespace }, async () => {
    const gp = await getProvider();
    const result = await gp.forget(name, namespace);
    if (!result.deletedMemory && !result.deletedEntity) {
      return { deleted: false, reason: "Not found" };
    }
    return { deleted: true };
  }, (result) => ({
    name,
    deleted: result.deleted,
  }));
}

export async function forgetEdge(edgeId: string, reason: string, namespace = "default") {
  return tracked("forgetEdge", { namespace }, async () => {
    const gp = await getProvider();
    return gp.forgetEdge(edgeId, reason, namespace);
  }, () => ({
    edgeId,
    reason,
  }));
}

export async function stats(namespace?: string) {
  return tracked("stats", { namespace: namespace ?? "all" }, async () => {
    const gp = await getProvider();
    const graphStats = await gp.stats(namespace);
    // Filesystem is the source of truth for memory count
    const ns = namespace ?? "default";
    const files = listMemoryFiles(ns);
    const indexed = files.filter((f) => f.indexed).length;
    return {
      ...graphStats,
      memories: Math.max(graphStats.memories, files.length),
      filesOnDisk: files.length,
      indexed,
    };
  });
}

export async function listNamespaces(): Promise<string[]> {
  return tracked("listNamespaces", {}, async () => {
    const gp = await getProvider();
    return gp.listNamespaces();
  });
}

export async function getGraphData(namespace?: string, nodeLimit?: number): Promise<GraphData> {
  return tracked("getGraphData", { namespace: namespace ?? "default" }, async () => {
    const gp = await getProvider();
    return gp.getGraphData(namespace, nodeLimit);
  });
}


export async function close() {
  // LadybugDB close() triggers a Bun segfault (native addon issue).
  // Process exit handles cleanup, so explicit close is skipped.
  // if (provider) await provider.close();
}
