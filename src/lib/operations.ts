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
import { join } from "path";
import type { Memory, StoredEntity, StoredEdge, Intent } from "../types.js";
import type { GraphData } from "./graph-provider.js";
import { classifyIntent, boostEdgesByIntent } from "./intents.js";
import { tracked } from "./analytics.js";
import {
  writeMemoryFile, readMemoryFile, appendToIndex, deleteMemoryFile, generateIndex,
  assertValidMemoryId, ensureNamespacePath, resolveNamespacePath, listMemoryFiles, listNamespaceDirs, normalizeTags, withNamespaceLock,
} from "./fs-memory.js";
import type { MemoryFrontmatter, Origin } from "./fs-memory.js";

let providerPromise: Promise<GraphProvider> | null = null;
let queue: Queue;
const inFlightIndexing = new Set<string>();
const addLocks = new Map<string, Promise<void>>();

function buildPendingMemory(frontmatter: MemoryFrontmatter, text: string): Memory {
  return {
    id: frontmatter.id,
    name: frontmatter.name,
    text,
    abstract: frontmatter.abstract ?? "",
    summary: frontmatter.summary ?? "",
    category: frontmatter.category,
    namespace: frontmatter.namespace,
    status: "pending",
    schemaVersion: frontmatter.schemaVersion ?? "0.0.0",
    versionedAt: frontmatter.versionedAt,
    createdAt: new Date(frontmatter.createdAt),
  };
}

async function persistProcessedMemory(
  frontmatter: MemoryFrontmatter,
  memory: Memory,
): Promise<void> {
  const nextFrontmatter: MemoryFrontmatter = {
    ...frontmatter,
    name: memory.name,
    indexedAt: new Date().toISOString(),
    abstract: memory.abstract || undefined,
    summary: memory.summary || undefined,
    category: memory.category,
    schemaVersion: memory.schemaVersion || "0.0.0",
    versionedAt: memory.versionedAt,
  };

  await withNamespaceLock(frontmatter.namespace, async () => {
    await writeMemoryFile(memory.id, memory.text, nextFrontmatter);
    generateIndex(resolveNamespacePath(frontmatter.namespace));
  });
}

function getIndexingKey(id: string, namespace: string): string {
  return `${namespace}:${id}`;
}

function getDedupKey(namespace: string, name: string): string {
  return `${namespace}:${name.trim().toLowerCase()}`;
}

function resolveMemoryName(text: string, name?: string): string {
  const provided = name?.trim();
  if (provided) return provided;

  const firstNonEmptyLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  return firstNonEmptyLine?.slice(0, 80) ?? "Untitled Memory";
}

async function withAddLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = addLocks.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  addLocks.set(key, current);

  if (previous) {
    await previous;
  }

  try {
    return await fn();
  } finally {
    release();
    if (addLocks.get(key) === current) {
      addLocks.delete(key);
    }
  }
}

async function addMemoryLocked(
  text: string,
  resolvedName: string,
  namespace: string,
  origin: Origin,
  tags: string[],
): Promise<{ id: string; name: string; path: string; status: "written" | "existing" }> {
  return withNamespaceLock(namespace, async () => {
    const files = listMemoryFiles(namespace);
    const existing = files.find((f) => f.name.trim().toLowerCase() === resolvedName.toLowerCase());
    if (existing) {
      return { id: existing.id, name: existing.name, path: existing.path, status: "existing" as const };
    }

    const id = randomUUID();
    const nsPath = ensureNamespacePath(namespace);
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

    triggerRemoteIndex(id, namespace);

    return { id, name: resolvedName, path: filePath, status: "written" as const };
  });
}

const pendingNotifications = new Set<Promise<void>>();

function triggerRemoteIndex(id: string, namespace: string): void {
  const serverUrl = process.env.KB_SERVER_URL ?? "http://localhost:8000";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  const p = fetch(`${serverUrl}/api/trigger-index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, namespace }),
    signal: controller.signal,
  }).then((res) => {
    if (!res.ok) {
      console.error(`[kb] Saved. Server returned ${res.status} — will be indexed on next start.`);
    }
  }).catch(() => {
    console.error("[kb] Saved. Server not running — will be indexed on next start.");
  }).finally(() => {
    clearTimeout(timeout);
    pendingNotifications.delete(p);
  });
  pendingNotifications.add(p);
}

/** Drains in-flight server notifications. Call before process exit in CLI. */
export function drainPendingNotifications(): Promise<void[]> {
  return Promise.all([...pendingNotifications]);
}

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

export async function queueMemoryForIndexing(id: string, namespace: string): Promise<boolean> {
  assertValidMemoryId(id);
  const key = getIndexingKey(id, namespace);
  if (inFlightIndexing.has(key)) {
    return false;
  }

  inFlightIndexing.add(key);
  const path = join(resolveNamespacePath(namespace), `${id}.md`);
  try {
    const { frontmatter, text } = await readMemoryFile(path);
    if (frontmatter.indexedAt) {
      return false;
    }

    const memory = buildPendingMemory(frontmatter, text);
    const q = await getQueue();
    await q.add(memory);
    await persistProcessedMemory(frontmatter, memory);
    return true;
  } finally {
    inFlightIndexing.delete(key);
  }
}

export async function queueUnindexedMemories(namespace?: string): Promise<number> {
  const namespaces = namespace ? [namespace] : listNamespaceDirs();
  let queued = 0;

  for (const ns of namespaces) {
    const files = listMemoryFiles(ns);
    for (const file of files) {
      if (file.indexed) continue;
      if (await queueMemoryForIndexing(file.id, ns)) {
        queued += 1;
      }
    }
  }

  return queued;
}

export async function addMemory(
  text: string,
  name?: string,
  namespace = "default",
  origin: Origin = "manual",
  tags: string[] = [],
): Promise<{ id: string; name: string; path: string; status: "written" | "existing" }> {
  return tracked("add", { namespace }, async () => {
    const resolvedName = resolveMemoryName(text, name);
    return withAddLock(
      getDedupKey(namespace, resolvedName),
      () => addMemoryLocked(text, resolvedName, namespace, origin, tags),
    );
  }, (result) => ({
    textLength: text.length,
    name: result.name,
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

    // Filesystem fallback: if graph doesn't have this memory, check files
    // Case-insensitive to match addMemory dedup behavior
    if (!result.memory) {
      const files = listMemoryFiles(ns);
      const nameLower = name.toLowerCase();
      const match = files.find((f) => f.name.toLowerCase() === nameLower);
      if (match) {
        const { frontmatter, text } = readMemoryFile(match.path);
        result.memory = buildPendingMemory(frontmatter, text);
        if (frontmatter.indexedAt) {
          result.memory.status = "completed";
        }
      }
    }

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

    // Also delete the filesystem file (source of truth)
    const fsResult = await withNamespaceLock(namespace, async () => {
      const deleted = deleteMemoryFile(name, namespace);
      if (deleted) {
        generateIndex(resolveNamespacePath(namespace));
      }
      return deleted;
    });

    if (!result.deletedMemory && !result.deletedEntity && !fsResult) {
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

    // Count filesystem memories — scope must match graph query
    let totalFiles = 0;
    let totalIndexed = 0;
    if (namespace) {
      const files = listMemoryFiles(namespace);
      totalFiles = files.length;
      totalIndexed = files.filter((f) => f.indexed).length;
    } else {
      // No namespace filter: count all filesystem namespaces
      for (const ns of listNamespaceDirs()) {
        const files = listMemoryFiles(ns);
        totalFiles += files.length;
        totalIndexed += files.filter((f) => f.indexed).length;
      }
    }

    return {
      ...graphStats,
      memories: Math.max(graphStats.memories, totalFiles),
      filesOnDisk: totalFiles,
      indexed: totalIndexed,
    };
  });
}

export async function listNamespaces(): Promise<string[]> {
  return tracked("listNamespaces", {}, async () => {
    const gp = await getProvider();
    const graphNs = await gp.listNamespaces();
    const fsNs = listNamespaceDirs();
    return [...new Set([...graphNs, ...fsNs])].sort();
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
