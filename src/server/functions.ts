/**
 * TanStack Start Server Functions
 *
 * Thin wrappers around the operations layer (src/lib/operations.ts)
 * that add input validation and response shaping for the Web UI.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import * as ops from "../lib/operations.js";
import { withGraphFallback, withGraphRequired } from "../lib/operations.js";
import { hybridSearch } from "../lib/hybrid-search.js";
import { analyticsContext } from "../lib/analytics.js";
import { groupDuplicateEntities } from "../lib/entity-matcher.js";
import { ensureServerIndexerStarted } from "./indexer.js";
import { withNamespaceLock, listMemoryFiles, listNamespaceDirs, readMemoryFile } from "../lib/fs-memory.js";
import { namespaceSchema, optionalNamespaceSchema } from "../types.js";
import type { MemoryFilter, EntityFilter, EdgeFilter, StoredEntity, Memory } from "../types.js";

if (process.env.KB_DISABLE_SERVER_INDEXER !== "true") {
  ensureServerIndexerStarted();
}

// ============================================================================
// Queries (GET by default)
// ============================================================================

const namespaceFilterSchema = z.object({
  namespace: optionalNamespaceSchema,
});

export const getGraphData = createServerFn()
  .inputValidator((data: unknown) => namespaceFilterSchema.parse(data ?? {}))
  .handler(async ({ data }) =>
    // Graph viz has no filesystem equivalent — entities and edges are graph-derived.
    // Degraded mode returns empty + `degraded: true`; UI renders "indexer offline" state.
    withGraphFallback("getGraphData",
      async () => {
        const result = await ops.getGraphData(data.namespace);
        return {
          nodes: result.nodes,
          edges: result.links.map((link) => ({
            source: link.source,
            target: link.target,
            relationType: link.relationType,
            fact: link.fact,
            sentiment: link.sentiment,
            confidence: link.confidence,
            edgeId: link.edgeId,
          })),
          degraded: false,
        };
      },
      { nodes: [], edges: [], degraded: true },
    )
  );

export const getStats = createServerFn()
  .inputValidator((data: unknown) => namespaceFilterSchema.parse(data ?? {}))
  .handler(({ data }) =>
    analyticsContext.run({ source: "web" }, () => ops.stats(data.namespace)),
  );

export const listNamespaces = createServerFn().handler(async () => {
  return ops.listNamespaces();
});

const searchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  limit: z.number().int().positive().max(100).default(10),
  namespace: namespaceSchema,
});

export const searchMemories = createServerFn()
  .inputValidator((data: unknown) => searchSchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await hybridSearch(data.query, data.namespace, data.limit);

    return {
      intent: result.intent,
      memories: result.memories.map((m) => ({
        id: m.id,
        name: m.name,
        summary: m.summary,
        category: m.category,
        createdAt: m.createdAt,
      })),
      edges: result.edges.map((e) => ({
        id: e.id,
        sourceEntity: e.sourceEntityName,
        targetEntity: e.targetEntityName,
        relationType: e.relationType,
        fact: e.fact,
        sentiment: e.sentiment,
        confidence: e.confidence,
        confidenceReason: e.confidenceReason,
        validAt: e.validAt,
        createdAt: e.createdAt,
      })),
      entities: result.entities.map((e) => ({
        name: e.name,
        type: e.type,
        description: e.description,
        summary: e.summary,
      })),
      files: result.files,
      // Spec Decision #8: `signals` is the public health contract — UI badges
      // (degraded, unindexed, stale, contradictions) read this directly.
      // `guidance` remains for legacy consumers but is deprecated for new ones.
      signals: result.signals,
      guidance: result.guidance,
    };
  }));

const getMemorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  namespace: namespaceSchema,
});

export const getMemory = createServerFn()
  .inputValidator((data: unknown) => getMemorySchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await ops.getByName(data.name, data.namespace);

    if (!result.memory && !result.entity) {
      throw new Error(`Nothing found with name "${data.name}"`);
    }

    return {
      memory: result.memory
        ? {
            id: result.memory.id,
            name: result.memory.name,
            text: result.memory.text,
            summary: result.memory.summary,
            category: result.memory.category,
            createdAt: result.memory.createdAt,
          }
        : undefined,
      entity: result.entity
        ? {
            name: result.entity.name,
            type: result.entity.type,
            description: result.entity.description,
            summary: result.entity.summary,
          }
        : undefined,
      edges: result.edges.map((e) => ({
        id: e.id,
        sourceEntity: e.sourceEntityName,
        targetEntity: e.targetEntityName,
        relationType: e.relationType,
        fact: e.fact,
        sentiment: e.sentiment,
        confidence: e.confidence,
        confidenceReason: e.confidenceReason,
        validAt: e.validAt,
        invalidAt: e.invalidAt,
        createdAt: e.createdAt,
      })),
    };
  }));

export const getHealth = createServerFn().handler(async () => {
  // Principle #3: health/queue probes must never 500 on a degraded graph —
  // they are the liveness signal that monitoring polls to detect outages.
  // Filesystem writes stay live; only the queue counter is inaccessible.
  let queuePending = 0;
  let degraded = false;
  try {
    queuePending = await ops.getQueueStatus();
  } catch {
    degraded = true;
  }
  return {
    status: degraded ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    queuePending,
    degraded,
  };
});

export const getQueueStatus = createServerFn().handler(async () => {
  try {
    return { pending: await ops.getQueueStatus(), degraded: false };
  } catch {
    return { pending: 0, degraded: true };
  }
});

// ============================================================================
// Mutations (POST)
// ============================================================================

const addMemorySchema = z.object({
  text: z.string().min(1, "Text is required"),
  name: z.string().optional(),
  namespace: namespaceSchema,
  origin: z.enum(["manual", "retro", "mcp", "import"]).default("manual"),
  tags: z.array(z.string()).default([]),
});

export const addMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => addMemorySchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await ops.addMemory(data.text, data.name, data.namespace, data.origin, data.tags);
    return {
      success: true,
      message: result.status === "existing"
        ? `Memory already exists`
        : `Memory written to filesystem`,
      memoryId: result.id,
    };
  }));

const forgetMemorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  namespace: namespaceSchema,
});

export const forgetMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => forgetMemorySchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const result = await ops.forget(data.name, data.namespace);

    if (!result.deleted) {
      throw new Error(`Nothing found with name "${data.name}"`);
    }

    return {
      success: true,
      message: `Removed "${data.name}"`,
    };
  }));

const forgetEdgeSchema = z.object({
  edgeId: z.string().min(1, "Edge ID is required"),
  reason: z.string().min(1, "Reason is required for audit trail"),
  namespace: namespaceSchema,
});

export const forgetEdge = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => forgetEdgeSchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    // Server holds a live provider — apply the graph invalidation now and
    // record JSONL for the Phase 2 reconciler to replay if the graph call
    // failed. The web UI sees the change immediately on success.
    const result = await ops.forgetEdgeViaGraph(data.edgeId, data.reason, data.namespace);

    return {
      success: true,
      message: result.appliedToGraph
        ? `Invalidated edge "${data.edgeId}" in namespace "${data.namespace}".`
        : `Recorded intent for edge "${data.edgeId}" — graph unavailable, will apply on next reconciler sweep.`,
      edgeId: data.edgeId,
      namespace: data.namespace,
      appliedToGraph: result.appliedToGraph,
    };
  }));

// ============================================================================
// Admin Operations
// ============================================================================

// Re-extraction state (in-memory, lives for the server process lifetime)
const reextractState = {
  running: false,
  current: 0,
  total: 0,
  currentName: "",
  phase: "" as "" | "extracting" | "embedding-memory" | "embedding-edges" | "storing",
  edgeCurrent: 0,
  edgeTotal: 0,
  success: 0,
  failed: 0,
  errors: [] as string[],
  lastEntities: 0,
  lastEdges: 0,
};

export const getReextractStatus = createServerFn().handler(async () => ({ ...reextractState }));
export const resetReextract = createServerFn({ method: "POST" }).handler(async () => {
  reextractState.running = false;
  return { reset: true };
});

type ReextractDependencies = {
  getProvider: typeof ops.getProvider;
  importExtract: () => Promise<typeof import("../lib/extractor.js")>;
  importEmbed: () => Promise<typeof import("../lib/embedder.js")>;
};

const defaultReextractDependencies: ReextractDependencies = {
  getProvider: ops.getProvider,
  importExtract: () => import("../lib/extractor.js"),
  importEmbed: () => import("../lib/embedder.js"),
};

export async function startReextractAll(
  deps: ReextractDependencies = defaultReextractDependencies,
): Promise<{ started: boolean; reason?: string }> {
  if (reextractState.running) return { started: false, reason: "already running" };

  reextractState.running = true;
  reextractState.current = 0;
  reextractState.total = 0;
  reextractState.success = 0;
  reextractState.failed = 0;
  reextractState.errors = [];
  reextractState.currentName = "";
  reextractState.phase = "";
  reextractState.edgeCurrent = 0;
  reextractState.edgeTotal = 0;

  // Start async — don't await, return immediately.
  //
  // Round 8 Theme E: the previous return shape `{ started, total }` was a trap
  // — `total` was always `0` because the count is resolved inside the IIFE
  // below, after the sync return. Callers that read `total` got a misleading
  // zero; the UI rendered "0/0" until the next status poll populated the real
  // count. Drop the field entirely — consumers must poll `getReextractStatus`
  // for progress, which is the only path that carries accurate state.
  //
  // The sync mutex claim (reextractState.running = true above) must stay
  // above any `await` so concurrent starts are rejected — see the "marks the
  // run as active before the async job yields" test.
  void (async () => {
    try {
      const [{ extract }, { embedDual }, gp] = await Promise.all([
        deps.importExtract(),
        deps.importEmbed(),
        deps.getProvider(),
      ]);
      const memories = await gp.findMemories({});

      reextractState.total = memories.length;

      for (let i = 0; i < memories.length; i++) {
        const memory = memories[i]!;
        reextractState.current = i + 1;
        reextractState.currentName = memory.name || memory.id;
        reextractState.phase = "extracting";
        reextractState.edgeCurrent = 0;
        reextractState.edgeTotal = 0;
        try {
          const extraction = await extract(memory.text);
          reextractState.lastEntities = extraction.entities.length;
          reextractState.lastEdges = extraction.edges.length;
          reextractState.edgeTotal = extraction.edges.length;

          reextractState.phase = "embedding-memory";
          const memEmb = await embedDual(memory.text);

          reextractState.phase = "embedding-edges";
          const edgeEmbeddings: Awaited<ReturnType<typeof embedDual>>[] = [];
          for (let j = 0; j < extraction.edges.length; j++) {
            reextractState.edgeCurrent = j + 1;
            edgeEmbeddings.push(await embedDual(extraction.edges[j]!.fact));
          }

          reextractState.phase = "storing";
          // Serialize the graph write under the namespace lock so we don't race
          // the indexer (which holds the lock around store + file write per
          // Decision #8). Without this, two concurrent stores against the same
          // memory id race the MATCH...DELETE / CREATE pair inside gp.store().
          const ns = memory.namespace;
          await withNamespaceLock(ns, async () => {
            await gp.store(
              { ...memory, abstract: extraction.abstract ?? "", summary: extraction.summary },
              extraction.entities,
              extraction.edges,
              memEmb,
              edgeEmbeddings,
            );
          });
          reextractState.success++;
        } catch (err) {
          reextractState.failed++;
          const errMsg = err instanceof Error ? err.message : String(err);
          reextractState.errors.push(`${memory.name}: ${errMsg}`);
          console.error(`[reextract] Failed ${memory.name}:`, errMsg);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      reextractState.errors.push(`startup: ${errMsg}`);
      console.error("[reextract] Failed to start:", errMsg);
    } finally {
      reextractState.running = false;
      reextractState.currentName = "";
      reextractState.phase = "";
      reextractState.edgeCurrent = 0;
      reextractState.edgeTotal = 0;
    }
  })();

  return { started: true };
}

/** Find duplicate entity groups using fuzzy name matching (graph-only). */
export const findDuplicateCandidates = createServerFn().handler(async () =>
  withGraphFallback("findDuplicateCandidates",
    async (gp) => {
      // Fetch all entities across all namespaces via provider interface
      const namespaces = await gp.listNamespaces();
      const allEntities: Array<StoredEntity & { uuid: string }> = [];
      for (const ns of namespaces) {
        const entities = await gp.findEntities({ namespace: ns }, 10000);
        for (const e of entities) {
          const withUuid = e as StoredEntity & { uuid?: string };
          if (withUuid.uuid) {
            allEntities.push({ ...e, uuid: withUuid.uuid });
          }
        }
      }
      // Also fetch global-scope entities
      const globalEntities = await gp.findEntities({ namespace: null }, 10000);
      for (const e of globalEntities) {
        const withUuid = e as StoredEntity & { uuid?: string };
        if (withUuid.uuid) {
          allEntities.push({ ...e, uuid: withUuid.uuid });
        }
      }

      const groups = groupDuplicateEntities(allEntities);

      // Enrich with edge counts
      const candidates = [];
      for (const group of groups) {
        const edges = await gp.findEdges({ sourceEntityName: group.keep.name }, 1000);
        const inEdges = await gp.findEdges({ targetEntityName: group.keep.name }, 1000);

        candidates.push({
          keep: { uuid: group.keep.uuid, name: group.keep.name },
          duplicates: group.duplicates.map((d) => ({ uuid: d.uuid, name: d.name })),
          normalizedName: group.normalizedName,
          totalEdges: edges.length + inEdges.length,
        });
      }

      return { candidates, degraded: false };
    },
    { candidates: [], degraded: true },
  )
);

const mergeDuplicateGroupSchema = z.object({
  keepUuid: z.string(),
  duplicateUuids: z.array(z.string()),
});

/** Merge a single duplicate group via provider interface (parameterized queries, both backends) */
export const mergeDuplicateGroup = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => mergeDuplicateGroupSchema.parse(data))
  .handler(async ({ data }) =>
    // Write operation — no safe filesystem fallback. Throws ProviderUnavailableError
    // when the graph is down; UI renders "Graph required for this action".
    withGraphRequired("mergeDuplicateGroup",
      (gp) => gp.mergeEntities(data.keepUuid, data.duplicateUuids),
    )
  );

/** Merge all duplicate groups at once (batch mode) */
export const deduplicateEntities = createServerFn({ method: "POST" }).handler(async () => {
  const result = await findDuplicateCandidates();
  // If findDuplicateCandidates itself degraded, surface an honest empty result
  // instead of pretending a batch merge ran. The caller (UI) already sees the
  // degraded flag through the individual response.
  if (result.degraded) {
    return { merged: 0, removed: 0, total: 0, remaining: 0, details: [], degraded: true };
  }

  return withGraphRequired("deduplicateEntities", async (gp) => {
    let merged = 0;
    let removed = 0;
    const details: string[] = [];

    for (const candidate of result.candidates) {
      const mergeResult = await gp.mergeEntities(candidate.keep.uuid, candidate.duplicates.map((d) => d.uuid));
      removed += mergeResult.removed;
      merged++;
      details.push(`"${candidate.keep.name}": kept 1, removed ${candidate.duplicates.length}`);
    }

    return { merged, removed, total: 0, remaining: 0, details, degraded: false };
  });
});

export const reextractAll = createServerFn({ method: "POST" }).handler(async () => {
  return startReextractAll();
});

// ============================================================================
// LLM-Powered Answer
// ============================================================================

import { prompt } from "unifai";

function edgeSentimentLabel(s: number) {
  if (s > 0.3) return " (positive)";
  if (s < -0.3) return " (negative)";
  return "";
}

function buildSearchContext(searchResult: Awaited<ReturnType<typeof hybridSearch>>) {
  const sections: string[] = [];

  const fileLines = searchResult.files
    .map((f) => {
      const ctx = f.matchContext ? `: ${f.matchContext.slice(0, 100)}` : "";
      return `- ${f.name}${f.indexed ? "" : " [unindexed]"}${ctx}`;
    });
  if (fileLines.length > 0) sections.push("**File Results:**\n" + fileLines.join("\n"));

  const edgeLines = searchResult.edges.map((edge) => {
    const sentiment = edgeSentimentLabel(edge.sentiment);
    return `- ${edge.sourceEntityName} → ${edge.relationType} → ${edge.targetEntityName}: ${edge.fact}${sentiment}`;
  });
  if (edgeLines.length > 0) sections.push("**Relevant Facts (as relationships):**\n" + edgeLines.join("\n"));

  const memLines = searchResult.memories
    .filter((m) => m.summary)
    .map((m) => `- ${m.name || "Memory"}: ${m.summary}`);
  if (memLines.length > 0) sections.push("**Related Memories:**\n" + memLines.join("\n"));

  const entLines = searchResult.entities.map((e) => {
    const desc = e.description ? ` - ${e.description}` : "";
    const summary = e.summary ? ` (${e.summary})` : "";
    return `- ${e.name} (${e.type})${desc}${summary}`;
  });
  if (entLines.length > 0) sections.push("**Related Entities:**\n" + entLines.join("\n"));

  return sections.length > 0
    ? sections.join("\n\n")
    : "No directly relevant information found in the knowledge base.";
}

const askLLMSchema = z.object({
  question: z.string().min(1, "Question is required"),
  // Explicit namespace keeps intent visible at the boundary. hybridSearch
  // also defaults to "default" internally, but relying on that default at
  // both layers made it easy to miss that this endpoint never considered
  // non-default namespaces.
  namespace: namespaceSchema,
});

export const askLLM = createServerFn()
  .inputValidator((data: unknown) => askLLMSchema.parse(data))
  .handler(({ data }) => analyticsContext.run({ source: "web" }, async () => {
    const searchResult = await hybridSearch(data.question, data.namespace, 5);
    const context = buildSearchContext(searchResult);

    const result = await prompt("claude", `You are a helpful assistant with access to a personal knowledge base.

Context from the knowledge base:
${context}

User question: ${data.question}

Instructions:
- Answer the question using the provided context if relevant
- If the context doesn't contain relevant information, say so honestly
- Be concise but helpful
- If you can make reasonable inferences from the context, do so
- Don't make up information that isn't supported by the context`, {
      maxTurns: 1,
      allowedTools: [],
      model: "haiku",
    });
    const answer = result.text;

    return {
      answer: answer || "I couldn't generate an answer. Please try rephrasing your question.",
      hasContext: searchResult.edges.length > 0 || searchResult.memories.length > 0 || searchResult.entities.length > 0 || searchResult.files.length > 0,
      edgesUsed: searchResult.edges.length,
      memoriesUsed: searchResult.memories.length,
      entitiesUsed: searchResult.entities.length,
      filesUsed: searchResult.files.length,
    };
  }));

// ============================================================================
// Streaming
// ============================================================================

// ============================================================================
// Browse APIs (paginated listing)
// ============================================================================

const listMemoriesSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(30),
  namespace: optionalNamespaceSchema,
  category: z.enum(["preference", "event", "pattern", "general"]).optional(),
  sortBy: z.enum(["createdAt", "name"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

type ListMemoriesInput = z.infer<typeof listMemoriesSchema>;
type ListMemoriesResponse = {
  items: Memory[];
  indexed: number;
  total: number;
  degraded: boolean;
};

function sortMemories(items: Memory[], sortBy: ListMemoriesInput["sortBy"], sortDir: ListMemoriesInput["sortDir"]): Memory[] {
  return [...items].sort((a, b) => {
    const cmp = sortBy === "name"
      ? a.name.localeCompare(b.name)
      : a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
    return sortDir === "asc" ? cmp : -cmp;
  });
}

type ReadMemoryResult = ReturnType<typeof readMemoryFile>;

function memoryFromRead(read: ReadMemoryResult): Memory {
  const { frontmatter, text } = read;
  return {
    id: frontmatter.id,
    name: frontmatter.name,
    text,
    abstract: frontmatter.abstract ?? "",
    summary: frontmatter.summary ?? "",
    category: frontmatter.category,
    namespace: frontmatter.namespace,
    status: frontmatter.indexedAt ? "completed" : "pending",
    schemaVersion: frontmatter.schemaVersion ?? "0.0.0",
    versionedAt: frontmatter.versionedAt,
    createdAt: new Date(frontmatter.createdAt),
  };
}

function readDegradedMemory(path: string, category?: ListMemoriesInput["category"]): Memory | null {
  try {
    const read = readMemoryFile(path);
    if (category && read.frontmatter.category !== category) return null;
    return memoryFromRead(read);
  } catch (err) {
    console.error(`[kb] listMemories degraded: failed to read ${path}`, err);
    return null;
  }
}

/**
 * Single-namespace degraded list.
 *
 * Round 8 Theme F: d770e65 regressed this to full `Memory` object
 * construction for every file. Keep full object construction limited to the
 * page slice; candidate reads still validate frontmatter where correctness
 * depends on file truth rather than `_index.md` metadata.
 *
 * Sort dispatch:
 * - `sortBy: "name"` — `listMemoryFiles` metadata carries name, but `_index.md`
 *   can outlive later user edits that make a file unparseable. Read and
 *   validate candidates before counting, so parse failures cannot inflate
 *   `total`.
 * - `sortBy: "createdAt"` — `_index.md` does NOT carry createdAt, and the
 *   slow path (index missing / stale) returns files in `readdirSync`
 *   (filename ≈ UUID) order. We cannot trust `listMemoryFiles` ordering
 *   for createdAt. Codex round-8 review finding: using it here produces
 *   incorrect results when the index is stale or missing. So: always read
 *   every file (O(N) disk), sort by the frontmatter createdAt, and hand
 *   the already-read result for the paged slice to `memoryFromRead` so we
 *   only allocate the `Memory` wrapper for the page — avoiding the N×
 *   `Memory` allocation that d770e65 added.
 *
 * Category filter: always needs frontmatter. Falls into the same "read all,
 * filter, sort, paginate" shape but reuses the read for the page slice.
 */
function listDegradedNamespace(namespace: string, input: ListMemoriesInput): { items: Memory[]; indexed: number; total: number } {
  let files;
  try {
    files = listMemoryFiles(namespace);
  } catch {
    return { items: [], indexed: 0, total: 0 };
  }

  // createdAt sort, or category filter: scan frontmatter for all files,
  // sort by frontmatter.createdAt (trustworthy regardless of index state),
  // then only construct `Memory` objects for the paged slice.
  const reads: ReadMemoryResult[] = [];
  const validIds = new Set<string>();
  for (const f of files) {
    try {
      const read = readMemoryFile(f.path);
      validIds.add(f.id);
      if (input.category && read.frontmatter.category !== input.category) continue;
      reads.push(read);
    } catch (err) {
      console.error(`[kb] listMemories degraded: failed to read ${f.path}`, err);
    }
  }
  const indexed = files.filter((f) => f.indexed && validIds.has(f.id)).length;

  reads.sort((a, b) => {
    const cmp = input.sortBy === "name"
      ? a.frontmatter.name.localeCompare(b.frontmatter.name)
      : a.frontmatter.createdAt.localeCompare(b.frontmatter.createdAt)
        || a.frontmatter.id.localeCompare(b.frontmatter.id);
    return input.sortDir === "asc" ? cmp : -cmp;
  });

  const paged = reads.slice(input.offset, input.offset + input.limit);
  const items = paged.map(memoryFromRead);
  return { items, indexed, total: reads.length };
}

export function listMemoriesDegradedFallback(data: ListMemoriesInput): ListMemoriesResponse {
  const namespaces = data.namespace ? [data.namespace] : listNamespaceDirs();

  // Hot path: single namespace. Paginate on metadata, only read paged bodies.
  if (namespaces.length === 1) {
    const r = listDegradedNamespace(namespaces[0]!, data);
    return { ...r, degraded: true };
  }

  // Cross-namespace admin view. Can't cheaply merge per-namespace pages, so
  // accept the O(total) cost here — this path is rare (dashboard all-ns view)
  // and there's no equivalent index across namespaces.
  const allItems: Memory[] = [];
  let indexed = 0;
  for (const ns of namespaces) {
    let files;
    try {
      files = listMemoryFiles(ns);
    } catch {
      continue;
    }
    indexed += files.filter((f) => f.indexed).length;
    for (const entry of files) {
      const m = readDegradedMemory(entry.path, data.category);
      if (m) allItems.push(m);
    }
  }
  const sorted = sortMemories(allItems, data.sortBy, data.sortDir);
  return {
    items: sorted.slice(data.offset, data.offset + data.limit),
    indexed,
    total: sorted.length,
    degraded: true,
  };
}

export const listMemories = createServerFn()
  .inputValidator((data: unknown) => listMemoriesSchema.parse(data ?? {}))
  .handler(async ({ data }) =>
    withGraphFallback("listMemories",
      async (gp) => {
        const filter: MemoryFilter = {};
        if (data.namespace) filter.namespace = data.namespace;
        if (data.category) filter.category = data.category;

        const items = await gp.findMemories(filter, data.limit, {
          offset: data.offset,
          limit: data.limit,
          sortBy: data.sortBy,
          sortDir: data.sortDir,
        });

        const stats = await ops.stats(data.namespace || undefined);
        return { items, indexed: stats.indexed, total: stats.memories, degraded: false };
      },
      () => listMemoriesDegradedFallback(data),
    )
  );

const listEntitiesSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(30),
  namespace: optionalNamespaceSchema,
  type: z.enum(["person", "organization", "project", "technology", "concept"]).optional(),
  sortBy: z.enum(["createdAt", "name"]).default("name"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});

export const listEntities = createServerFn()
  .inputValidator((data: unknown) => listEntitiesSchema.parse(data ?? {}))
  .handler(async ({ data }) =>
    // Entities are graph-derived (extracted from memory text) — no filesystem
    // equivalent. Degraded mode returns empty; UI renders "indexer offline".
    withGraphFallback("listEntities",
      async (gp) => {
        const filter: EntityFilter = {};
        if (data.namespace) filter.namespace = data.namespace;
        if (data.type) filter.type = data.type;

        // Overfetch by 1 to detect "more available" without a separate count query.
        const fetched = await gp.findEntities(filter, data.limit + 1, {
          offset: data.offset,
          limit: data.limit + 1,
          sortBy: data.sortBy,
          sortDir: data.sortDir,
        });
        const hasMore = fetched.length > data.limit;
        const items = hasMore ? fetched.slice(0, data.limit) : fetched;

        // LIMITATION: when a non-namespace filter (type) is active, gp.stats() can't
        // express it, so `total` reflects unfiltered namespace counts. UI should
        // prefer `hasMore` for pagination math when filters are active. Tracked as
        // a follow-up: add countEntities(filter) to the GraphProvider interface.
        const total = await gp.stats(data.namespace || undefined);
        return { items, total: total.entities, hasMore, degraded: false };
      },
      { items: [], total: 0, hasMore: false, degraded: true },
    )
  );

const listEdgesSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(30),
  namespace: optionalNamespaceSchema,
  relationType: z.string().optional(),
  includeInvalidated: z.boolean().default(false),
  sortBy: z.enum(["createdAt", "name"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export const listEdges = createServerFn()
  .inputValidator((data: unknown) => listEdgesSchema.parse(data ?? {}))
  .handler(async ({ data }) =>
    // Edges are graph-derived (RELATES_TO between extracted entities) — no
    // filesystem equivalent. Degraded mode returns empty.
    withGraphFallback("listEdges",
      async (gp) => {
        const filter: EdgeFilter = {
          includeInvalidated: data.includeInvalidated,
        };
        if (data.namespace) filter.namespace = data.namespace;
        if (data.relationType) filter.relationType = data.relationType;

        const fetched = await gp.findEdges(filter, data.limit + 1, {
          offset: data.offset,
          limit: data.limit + 1,
          sortBy: data.sortBy,
          sortDir: data.sortDir,
        });
        const hasMore = fetched.length > data.limit;
        const items = hasMore ? fetched.slice(0, data.limit) : fetched;

        // LIMITATION: see listEntities above — total is unfiltered when
        // relationType / includeInvalidated filters narrow the results.
        const total = await gp.stats(data.namespace || undefined);
        return { items, total: total.edges, hasMore, degraded: false };
      },
      { items: [], total: 0, hasMore: false, degraded: true },
    )
  );

const getEntitySchema = z.object({
  name: z.string().min(1, "Name is required"),
  namespace: optionalNamespaceSchema,
});

export const getEntity = createServerFn()
  .inputValidator((data: unknown) => getEntitySchema.parse(data))
  .handler(async ({ data }) =>
    // Entity detail has no filesystem equivalent — entities exist only in the
    // graph. Throws ProviderUnavailableError when graph is down so the UI can
    // render "entity view requires indexer" rather than "Entity not found".
    withGraphRequired("getEntity", async (gp) => {
      const filter: EntityFilter = { name: data.name };
      if (data.namespace) filter.namespace = data.namespace;
      const entities = await gp.findEntities(filter, 10);
      const entity = entities.find((e) => e.name === data.name);
      if (!entity) throw new Error(`Entity not found: "${data.name}"`);

      const edgeFilter: EdgeFilter = {};
      if (data.namespace) edgeFilter.namespace = data.namespace;
      const outgoing = await gp.findEdges({ ...edgeFilter, sourceEntityName: data.name }, 100);
      const incoming = await gp.findEdges({ ...edgeFilter, targetEntityName: data.name }, 100);

      return {
        entity: {
          name: entity.name,
          type: entity.type,
          description: entity.description,
          summary: entity.summary,
          namespace: entity.namespace,
        },
        edges: [...outgoing, ...incoming].map((e) => ({
          id: e.id,
          sourceEntity: e.sourceEntityName,
          targetEntity: e.targetEntityName,
          relationType: e.relationType,
          fact: e.fact,
          sentiment: e.sentiment,
          confidence: e.confidence,
          confidenceReason: e.confidenceReason,
          validAt: e.validAt,
          invalidAt: e.invalidAt,
          createdAt: e.createdAt,
        })),
      };
    })
  );

// ============================================================================
// Streaming
// ============================================================================

const streamingSearchSchema = z.object({
  query: z.string().min(1, "Query is required"),
  limit: z.number().int().positive().default(10),
  namespace: namespaceSchema,
});

export const streamingSearch = createServerFn()
  .inputValidator((data: unknown) => streamingSearchSchema.parse(data))
  .handler(async function* ({ data }) {
    const result = await analyticsContext.run({ source: "web" }, () =>
      hybridSearch(data.query, data.namespace, data.limit),
    );

    yield {
      type: "intent" as const,
      data: { intent: result.intent },
    };

    for (const file of result.files) {
      yield {
        type: "file" as const,
        // Spec Decision #8: `path`, `indexed`, `stale`, `indexedAt`, `source`
        // are the public per-result contract. Streaming consumers must receive
        // the same shape as non-streaming ones to render staleness/freshness.
        data: {
          id: file.id,
          name: file.name,
          source: file.source,
          path: file.path,
          indexed: file.indexed,
          stale: file.stale,
          indexedAt: file.indexedAt,
          tags: file.tags,
          matchContext: file.matchContext,
        },
      };
    }

    for (const memory of result.memories) {
      yield {
        type: "memory" as const,
        data: {
          id: memory.id,
          name: memory.name,
          summary: memory.summary,
          category: memory.category,
          createdAt: memory.createdAt,
        },
      };
    }

    for (const edge of result.edges) {
      yield {
        type: "edge" as const,
        data: {
          id: edge.id,
          sourceEntity: edge.sourceEntityName,
          targetEntity: edge.targetEntityName,
          relationType: edge.relationType,
          fact: edge.fact,
          sentiment: edge.sentiment,
          confidence: edge.confidence,
          confidenceReason: edge.confidenceReason,
          validAt: edge.validAt,
          createdAt: edge.createdAt,
        },
      };
    }

    for (const entity of result.entities) {
      yield {
        type: "entity" as const,
        data: {
          name: entity.name,
          type: entity.type,
          description: entity.description,
          summary: entity.summary,
        },
      };
    }

    // Spec Decision #8: `signals` is the structured health contract. Emit
    // before the deprecated `guidance` event so consumers can prefer it.
    yield {
      type: "signals" as const,
      data: result.signals,
    };

    yield {
      type: "guidance" as const,
      data: { message: result.guidance },
    };
  });
