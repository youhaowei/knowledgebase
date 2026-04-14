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

import { createGraphProvider as defaultCreateGraphProvider, type GraphProvider } from "./graph-provider.js";
import { Queue } from "./queue.js";
import { embedWithDimension, isZeroEmbedding } from "./embedder.js";
import { randomUUID } from "crypto";
import { join } from "path";
import { utimesSync } from "fs";
import type { Memory, StoredEntity, StoredEdge, Intent } from "../types.js";
import type { GraphData } from "./graph-provider.js";
import { classifyIntent, boostEdgesByIntent } from "./intents.js";
import { tracked } from "./analytics.js";
import {
  writeMemoryFile, readMemoryFile, appendToIndex, updateIndexEntry, generateIndex,
  assertValidMemoryId, ensureNamespacePath, resolveNamespacePath, listMemoryFiles, listNamespaceDirs, normalizeTags, normalizeNameForLookup, withNamespaceLock,
  tombstoneMemoryFile, recordForgetEdge,
} from "./fs-memory.js";
import type { MemoryFrontmatter, Origin } from "./fs-memory.js";

type OperationsState = {
  providerPromise: Promise<GraphProvider> | null;
  queue: Queue | null;
  inFlightIndexing: Set<string>;
  addLocks: Map<string, Promise<void>>;
  // Cooldown after a provider init failure. Without this, every degraded-mode
  // call re-attempts native addon init / DB open and re-emits the same error,
  // turning a single graph outage into a torrent of repeated failures (and
  // logs). Callers that catch the throw and fall back to fs-only get the
  // intended behaviour: try again later, not on the next request.
  providerFailedUntilMs: number;
};

const PROVIDER_FAILURE_COOLDOWN_MS = 30_000;

function createInitialState(): OperationsState {
  return {
    providerPromise: null,
    queue: null,
    inFlightIndexing: new Set(),
    addLocks: new Map(),
    providerFailedUntilMs: 0,
  };
}

let state: OperationsState = createInitialState();
const DEFAULT_UNINDEXED_SWEEP_BATCH_LIMIT = 100;
const defaultOperationDependencies = {
  createGraphProvider: defaultCreateGraphProvider,
  createQueue: (provider: GraphProvider) => new Queue(provider),
};
const operationDependencies = {
  ...defaultOperationDependencies,
};

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

/**
 * Write extraction results back to the file. Does NOT take the namespace lock —
 * the caller (queue.processEntry) holds it across {mtime recheck, gp.store, file
 * write} so the Decision #8 ordering invariant covers the entire commit window.
 *
 * Two callers:
 *   - queue.processEntry passes this in as `onStored` and runs it under its lock.
 *   - direct callers go through `persistProcessedMemory` which wraps this in a lock.
 */
async function persistProcessedMemoryUnlocked(
  originalFrontmatter: MemoryFrontmatter,
  memory: Memory,
): Promise<void> {
  const ns = originalFrontmatter.namespace;

  // Re-read from disk to avoid overwriting user edits made during async extraction.
  // The extraction window (30-120s) is long enough for the file to be modified or deleted.
  const path = join(resolveNamespacePath(ns), `${memory.id}.md`);
  let currentFrontmatter: MemoryFrontmatter;
  let currentText: string;
  try {
    const current = readMemoryFile(path);
    currentFrontmatter = current.frontmatter;
    currentText = current.text;
  } catch {
    // File was deleted during extraction — nothing to persist
    return;
  }

  // Use `??` (not `||`) for abstract/summary so extractor-returned empty
  // strings are respected instead of silently falling back to stale values.
  const nextAbstract = memory.abstract ?? currentFrontmatter.abstract;
  const nextSummary = memory.summary ?? currentFrontmatter.summary;

  // Spec Decision #8 ordering: stamp indexedAt to match the file's final
  // mtime so `stale = mtime > indexedAt` is NOT true immediately after a
  // successful write. Stamping Date.now() before writeMemoryFile leaves
  // indexedAt behind the actual mtime by however long the write takes,
  // which read-back would misinterpret as the user having edited the
  // file post-index.
  const stampedAt = new Date();
  const nextFrontmatter: MemoryFrontmatter = {
    ...currentFrontmatter,
    // Preserve the current on-disk name so user edits made during async
    // extraction are not clobbered by the queue-time snapshot.
    name: currentFrontmatter.name,
    indexedAt: stampedAt.toISOString(),
    schemaVersion: memory.schemaVersion ?? currentFrontmatter.schemaVersion ?? "0.0.0",
    ...(nextAbstract !== undefined ? { abstract: nextAbstract } : {}),
    ...(nextSummary !== undefined ? { summary: nextSummary } : {}),
    ...(memory.category ?? currentFrontmatter.category
      ? { category: memory.category ?? currentFrontmatter.category }
      : {}),
    ...(memory.versionedAt ?? currentFrontmatter.versionedAt
      ? { versionedAt: memory.versionedAt ?? currentFrontmatter.versionedAt }
      : {}),
  };

  const writtenPath = writeMemoryFile(memory.id, currentText, nextFrontmatter);
  // Align the file's mtime with the stamped indexedAt so the staleness
  // invariant is self-consistent at write time. Any subsequent real user
  // edit will bump mtime past indexedAt and correctly flag the file as
  // stale for the next indexer sweep.
  try {
    utimesSync(writtenPath, stampedAt, stampedAt);
  } catch (err) {
    // Non-fatal: if we can't set the mtime (e.g., readonly mount in
    // tests), the file is still written correctly. The next sweep may
    // briefly see stale=true but will re-extract against the same body.
    console.error(`[kb] Failed to align mtime for ${memory.id}:`, err);
  }
  updateIndexEntry(resolveNamespacePath(ns), nextFrontmatter);
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
  const previous = state.addLocks.get(key);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.addLocks.set(key, current);

  if (previous) {
    await previous;
  }

  try {
    return await fn();
  } finally {
    release();
    if (state.addLocks.get(key) === current) {
      state.addLocks.delete(key);
    }
  }
}

export type AddMemoryResult = {
  id: string;
  name: string;
  path: string;
  status: "written" | "existing";
  /** @deprecated Use `status === "existing"` instead. Kept for backwards compatibility. */
  readonly existing: boolean;
};

function makeResult(base: { id: string; name: string; path: string; status: "written" | "existing" }): AddMemoryResult {
  return {
    ...base,
    get existing() {
      return base.status === "existing";
    },
  };
}

async function addMemoryLocked(
  text: string,
  resolvedName: string,
  namespace: string,
  origin: Origin,
  tags: string[],
): Promise<AddMemoryResult> {
  return withNamespaceLock(namespace, async () => {
    const files = listMemoryFiles(namespace);
    const existing = files.find((f) => normalizeNameForLookup(f.name) === normalizeNameForLookup(resolvedName));
    if (existing) {
      return makeResult({ id: existing.id, name: existing.name, path: existing.path, status: "existing" });
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

    const filePath = writeMemoryFile(id, text, frontmatter);
    appendToIndex(nsPath, frontmatter);

    return makeResult({ id, name: resolvedName, path: filePath, status: "written" });
  });
}

/** Shared provider singleton. Exported for modules that need direct provider access. */
export async function getProvider() {
  // Inside the cooldown window, fail fast with the same shape the original
  // init error would produce. Degraded-mode callers (search, stats, get, ...)
  // already catch and fall back; this just keeps them from paying the init
  // cost on every call when the provider is known to be down.
  if (state.providerFailedUntilMs > Date.now()) {
    throw new Error("Graph provider unavailable (in failure cooldown)");
  }
  if (!state.providerPromise) {
    state.providerPromise = operationDependencies.createGraphProvider()
      .then((p) => {
        state.queue = operationDependencies.createQueue(p);
        state.providerFailedUntilMs = 0;
        return p;
      })
      .catch((error) => {
        state.providerPromise = null;
        state.queue = null;
        state.providerFailedUntilMs = Date.now() + PROVIDER_FAILURE_COOLDOWN_MS;
        throw error;
      });
  }
  return state.providerPromise;
}

export async function getQueue() {
  await getProvider();
  if (!state.queue) {
    throw new Error("Queue was not initialized");
  }
  return state.queue;
}

export async function getQueueStatus(namespace?: string): Promise<number> {
  const q = await getQueue();
  return q.pending(namespace);
}

export async function queueMemoryForIndexing(id: string, namespace: string): Promise<boolean> {
  assertValidMemoryId(id);
  const key = getIndexingKey(id, namespace);
  // NOTE: inFlightIndexing is process-local — does not dedup across CLI + server.
  // Accepted tradeoff: gp.store() is idempotent, so a rare duplicate extraction
  // costs one LLM call but is not incorrect.
  if (state.inFlightIndexing.has(key)) {
    return false;
  }

  state.inFlightIndexing.add(key);
  let releaseKey = true;

  try {
    // NOTE: TOCTOU — another process may set indexedAt between the `add` above
    // and this read. The cost of the race is at most one duplicate extraction;
    // the filesystem write via atomic rename stays consistent.
    const path = join(resolveNamespacePath(namespace), `${id}.md`);
    const { frontmatter, text } = readMemoryFile(path);
    if (frontmatter.indexedAt) {
      return false;
    }

    const memory = buildPendingMemory(frontmatter, text);
    const q = await getQueue();

    // Fire-and-forget: enqueue and let the Queue drain in the background.
    // The queue does not resolve until graph storage and filesystem finalization
    // both complete, which avoids a crash window between them.
    releaseKey = false;
    q.add(memory, async (processedMemory) => persistProcessedMemoryUnlocked(frontmatter, processedMemory))
      .catch((err) => console.error(`[kb] Indexing failed for ${id}:`, err))
      .finally(() => state.inFlightIndexing.delete(key));

    return true;
  } finally {
    if (releaseKey) {
      state.inFlightIndexing.delete(key);
    }
  }
}

async function queueUnindexedFilesForNamespace(
  namespace: string,
  remaining: number,
): Promise<number> {
  let queued = 0;
  const files = listMemoryFiles(namespace);

  for (const file of files) {
    if (queued >= remaining) {
      break;
    }
    if (file.indexed) continue;
    try {
      if (await queueMemoryForIndexing(file.id, namespace)) {
        queued += 1;
      }
    } catch (err) {
      // File may have been deleted between list and read — skip and continue
      console.error(`[kb] Skipping ${file.id} in ${namespace}:`, (err as Error).message);
    }
  }

  return queued;
}

export async function processUnindexedMemories(
  namespace?: string,
  limit = DEFAULT_UNINDEXED_SWEEP_BATCH_LIMIT,
): Promise<number> {
  const namespaces = namespace ? [namespace] : listNamespaceDirs();
  let queued = 0;

  for (const ns of namespaces) {
    if (queued >= limit) {
      break;
    }
    queued += await queueUnindexedFilesForNamespace(ns, limit - queued);
  }

  return queued;
}

export async function addMemory(
  text: string,
  name?: string,
  namespace = "default",
  origin: Origin = "manual",
  tags: string[] = [],
): Promise<AddMemoryResult> {
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

/** Graph-only search. For combined file + graph results, use hybridSearch. */
export async function graphSearch(
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
    const result = await gp.search(
      isZeroEmbedding(embedding) ? [] : embedding,
      query,
      limit,
      namespace,
    );
    const intent = classifyIntent(query);

    const memories = result.memories.slice(0, limit);
    const edges = result.edges.slice(0, limit);
    const entities = result.entities.slice(0, limit);

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
    // Degraded-mode contract (Spec): `get` must return file content even when
    // the graph is unavailable. The graph enriches with entities/edges; the
    // file is the source of truth.
    let result: { memory?: Memory; entity?: StoredEntity; edges: StoredEdge[] };
    try {
      const gp = await getProvider();
      result = await gp.get(name, ns);
    } catch (err) {
      console.error(`[kb] Graph unavailable on get — serving filesystem-only: ${err instanceof Error ? err.message : err}`);
      result = { edges: [] };
    }

    // Filesystem fallback: if graph doesn't have this memory, check files.
    // Use the canonical name normalizer so trailing whitespace doesn't make
    // a file findable by `add` but invisible to `get`.
    if (!result.memory) {
      const files = listMemoryFiles(ns);
      const nameLower = normalizeNameForLookup(name);
      const match = files.find((f) => normalizeNameForLookup(f.name) === nameLower);
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
  reason = "forget",
): Promise<{ deleted: boolean; reason?: string; tombstonePath?: string }> {
  return tracked("forget", { namespace }, async () => {
    // Spec Decision #11: tombstone via filesystem. The CLI never opens
    // LadybugDB. The server reconciler consumes `_tombstones.jsonl` on its
    // sweep (Phase 2) and applies graph cleanup. Graph state is stale until
    // the reconciler runs — consistent with Degraded Mode contract.
    const tombstoned = await withNamespaceLock(namespace, async () => {
      const result = tombstoneMemoryFile(name, namespace, reason);
      if (result) {
        generateIndex(resolveNamespacePath(namespace));
      }
      return result;
    });

    if (!tombstoned) {
      return { deleted: false, reason: "Not found" };
    }

    // Surface the .deleted path so callers can render a recovery hint —
    // forget renames rather than unlinks for exactly this reason.
    return { deleted: true, tombstonePath: tombstoned.tombstonePath };
  }, (result) => ({
    name,
    deleted: result.deleted,
  }));
}

export async function forgetEdge(edgeId: string, reason: string, namespace = "default") {
  return tracked("forgetEdge", { namespace }, async () => {
    // Spec Decision #11: CLI path — append to _forget_edges.jsonl. The
    // reconciler sweep (Phase 2) will apply the graph-side invalidation.
    // Until Phase 2 lands the reconciler, the edge stays visible until the
    // next manual db:reindex; callers should surface this expectation.
    // Server-side callers that already hold a provider should use
    // `forgetEdgeViaGraph` instead so the change applies immediately.
    await withNamespaceLock(namespace, async () => {
      recordForgetEdge(edgeId, reason, namespace);
    });
    return { edgeId, reason, namespace };
  }, () => ({
    edgeId,
    reason,
  }));
}

/**
 * Server-side forgetEdge: applies the graph-side invalidation immediately
 * (the server already holds an open provider) AND records the JSONL audit
 * line so the Phase 2 reconciler stays the durable source of intent. Use
 * this from MCP/HTTP handlers; the CLI uses `forgetEdge` (JSONL-only) per
 * Decision #11.
 */
export async function forgetEdgeViaGraph(edgeId: string, reason: string, namespace = "default") {
  return tracked("forgetEdgeViaGraph", { namespace }, async () => {
    await withNamespaceLock(namespace, async () => {
      recordForgetEdge(edgeId, reason, namespace);
    });
    let appliedToGraph = false;
    try {
      const gp = await getProvider();
      await gp.forgetEdge(edgeId, reason, namespace);
      appliedToGraph = true;
    } catch (err) {
      console.error(`[kb] forgetEdgeViaGraph: graph unavailable, JSONL recorded for reconciler replay: ${err instanceof Error ? err.message : err}`);
    }
    return { edgeId, reason, namespace, appliedToGraph };
  }, (result) => ({
    edgeId,
    reason,
    appliedToGraph: result.appliedToGraph,
  }));
}

export async function stats(namespace?: string) {
  return tracked("stats", { namespace: namespace ?? "all" }, async () => {
    // Degraded-mode contract (Spec): when the graph is unavailable, return
    // filesystem counts only with graph-derived fields reported as null.
    // Callers depend on filesOnDisk/indexed regardless of graph state.
    let graphStats: Awaited<ReturnType<GraphProvider["stats"]>> | null = null;
    try {
      const gp = await getProvider();
      graphStats = await gp.stats(namespace);
    } catch (err) {
      console.error(`[kb] Graph unavailable on stats — serving filesystem-only: ${err instanceof Error ? err.message : err}`);
    }

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
      ...(graphStats ?? { entities: null, edges: null }),
      memories: totalFiles,
      filesOnDisk: totalFiles,
      indexed: totalIndexed,
      degraded: graphStats === null,
    };
  });
}

export async function listNamespaces(): Promise<string[]> {
  return tracked("listNamespaces", {}, async () => {
    // Degraded mode (Spec): the filesystem is the source of truth, so
    // namespaces are always available from disk. Graph state is additive —
    // when the provider is unavailable, fall back to fs-only rather than
    // failing the call (which would break Sidebar, AddMemoryDialog, etc.).
    const fsNs = listNamespaceDirs();
    let graphNs: string[] = [];
    try {
      const gp = await getProvider();
      graphNs = await gp.listNamespaces();
    } catch (err) {
      console.error("[operations] listNamespaces: graph unavailable, returning fs-only namespaces:", err);
    }
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

export function resetOperationStateForTests(): void {
  operationDependencies.createGraphProvider = defaultOperationDependencies.createGraphProvider;
  operationDependencies.createQueue = defaultOperationDependencies.createQueue;
  state = createInitialState();
}

export function configureOperationDependenciesForTests(overrides: Partial<typeof defaultOperationDependencies>): void {
  operationDependencies.createGraphProvider = overrides.createGraphProvider
    ?? defaultOperationDependencies.createGraphProvider;
  operationDependencies.createQueue = overrides.createQueue
    ?? defaultOperationDependencies.createQueue;
}

/**
 * Test-only escape hatch: clear the post-failure cooldown so the next
 * getProvider() call attempts init again. Production code paths just wait
 * for the cooldown to expire — this exists so tests can exercise recovery
 * without sleeping for the full 30s window.
 */
export function clearProviderFailureCooldownForTests(): void {
  state.providerFailedUntilMs = 0;
}
