/**
 * Hybrid Search
 *
 * Runs file-based search (always available) and graph search (semantic) in
 * parallel. Graph results win on dedup by memory ID. If graph search fails
 * (e.g., embedder error, DB unavailable), returns file-only results gracefully.
 */

import * as ops from "./operations.js";
import { fileSearch, type FileSearchResult } from "./file-search.js";
import { listMemoryFiles, normalizeTags } from "./fs-memory.js";
import type { Memory, StoredEdge, StoredEntity, Intent } from "../types.js";

export type { FileSearchResult };

/**
 * Structured signals describing the health of a search response per Spec
 * Decision #8. Consumers render these into surface-appropriate language
 * (CLI text, MCP prose, UI badges). Replaces the single `guidance` string
 * for anything beyond legacy contradiction prompts.
 */
export interface SearchSignals {
  degraded: boolean;              // graph unavailable — filesystem-only results
  unindexedCount: number;         // result files lacking indexedAt (pending indexing)
  staleCount: number;             // result files with mtime > indexedAt (edited since last index)
  contradictionsDetected: boolean; // graph surfaced opposing sentiments for the same entity pair
}

export interface HybridSearchResult {
  // Graph search results (unchanged shape)
  memories: Memory[];
  edges: StoredEdge[];
  entities: StoredEntity[];
  intent: Intent;
  guidance: string;               // deprecated for new consumers — read `signals` instead
  // File search results
  files: FileSearchResult[];
  // Structured response health (Spec Decision #8)
  signals: SearchSignals;
}

type GraphSearchPayload = {
  memories: Memory[];
  edges: StoredEdge[];
  entities: StoredEntity[];
  intent: Intent;
  guidance: string;
};

const defaultHybridSearchDependencies = {
  graphSearch: ops.graphSearch,
};
const hybridSearchDependencies = {
  ...defaultHybridSearchDependencies,
};

async function runGraphSearch(
  query: string,
  namespace: string,
  limit: number,
): Promise<GraphSearchPayload | null> {
  try {
    return await hybridSearchDependencies.graphSearch(query, namespace, limit);
  } catch (err) {
    console.error(`[hybrid-search] Graph search failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Filters graph results to only include items linked to tagged file IDs.
 * Entity allowlist is built from edge connections only (not memory names,
 * since memory names rarely match entity names).
 */
export function filterGraphResultsByTaggedFileIds(
  graphResult: GraphSearchPayload | null,
  taggedFileIds: Set<string>,
): Pick<HybridSearchResult, "memories" | "edges" | "entities"> {
  if (!graphResult) {
    return { memories: [], edges: [], entities: [] };
  }

  const memories = graphResult.memories.filter((memory) => taggedFileIds.has(memory.id));
  const edges = graphResult.edges.filter((edge) =>
    edge.episodes.some((episodeId) => taggedFileIds.has(episodeId)),
  );
  // Build entity allowlist from edge connections only
  const allowedEntityNames = new Set<string>();
  for (const edge of edges) {
    allowedEntityNames.add(edge.sourceEntityName);
    allowedEntityNames.add(edge.targetEntityName);
  }
  const entities = graphResult.entities.filter((entity) => allowedEntityNames.has(entity.name));

  return { memories, edges, entities };
}

export async function hybridSearch(
  query: string,
  namespace = "default",
  limit = 10,
  tags?: string[],
): Promise<HybridSearchResult> {
  const normalizedTags = tags && tags.length > 0 ? normalizeTags(tags) : undefined;

  const [graphResult, fileResults] = await Promise.all([
    runGraphSearch(query, namespace, limit),
    fileSearch(query, namespace, { limit, tags: normalizedTags }),
  ]);

  let memories = graphResult?.memories ?? [];
  let edges = graphResult?.edges ?? [];
  let entities = graphResult?.entities ?? [];

  // When filtering by tags, restrict graph results to the tagged allowlist.
  // The allowlist must be built from ALL tagged files in the namespace, not
  // the paginated fileSearch slice — a tagged memory outside the top-N file
  // results would otherwise be incorrectly dropped from graph results even
  // when graph ranks it highly (US-8 breaks at scale).
  if (normalizedTags && normalizedTags.length > 0) {
    const taggedFileIds = new Set(
      listMemoryFiles(namespace)
        .filter((entry) => normalizedTags.every((tag) => entry.tags.includes(tag)))
        .map((entry) => entry.id),
    );
    ({ memories, edges, entities } = filterGraphResultsByTaggedFileIds(
      graphResult,
      taggedFileIds,
    ));
  }

  // Build set of memory IDs from graph results for dedup (graph wins)
  const graphMemoryIds = new Set(memories.map((m) => m.id));

  // Filter file results to exclude IDs already covered by graph
  const dedupedFiles = fileResults.filter((f) => !graphMemoryIds.has(f.id));

  // Spec Decision #8: signals describe the *response population*, not just the
  // file-only slice. Stale/unindexed metadata lives on the FileSearchResult,
  // so a graph-covered memory whose file was edited post-indexing must still
  // increment staleCount even though we drop it from `files` to avoid a
  // duplicated row. Build counts from pre-dedup file metadata.
  const signals = buildSignals(graphResult, fileResults, edges);
  const guidance = buildGuidance(graphResult, signals);

  return {
    memories,
    edges,
    entities,
    intent: graphResult?.intent ?? "general",
    guidance,
    files: dedupedFiles,
    signals,
  };
}

/**
 * Compose the structured signals object from graph + file slices of the result.
 * Decision #8 contract: consumers rely on these counts, not on parsed prose.
 */
function buildSignals(
  graphResult: GraphSearchPayload | null,
  files: FileSearchResult[],
  edges: StoredEdge[],
): SearchSignals {
  const unindexedCount = files.filter((f) => !f.indexed).length;
  const staleCount = files.filter((f) => f.stale).length;
  return {
    degraded: graphResult === null,
    unindexedCount,
    staleCount,
    contradictionsDetected: detectPotentialContradictions(edges),
  };
}

/**
 * Detects the "two edges on the same entity pair with the same relationType
 * and opposing sentiment" pattern. Cheap approximate check — Phase 4 replaces
 * this with the full contradiction clustering.
 *
 * Same `relationType` is required because temporal sequences ("we used to
 * prefer X" → -0.5; "we now prefer X" → 0.8) on the *same* relation are
 * legitimate updates, not contradictions. Without the relationType filter,
 * MCP consumers would see false-positive contradiction prompts on benign
 * history shifts.
 */
function detectPotentialContradictions(edges: StoredEdge[]): boolean {
  const byPairAndRelation = new Map<string, number[]>();
  for (const edge of edges) {
    const key = `${edge.sourceEntityName}\u0000${edge.targetEntityName}\u0000${edge.relationType}`;
    const sentiments = byPairAndRelation.get(key) ?? [];
    sentiments.push(edge.sentiment ?? 0);
    byPairAndRelation.set(key, sentiments);
  }
  for (const sentiments of byPairAndRelation.values()) {
    if (sentiments.length < 2) continue;
    const min = Math.min(...sentiments);
    const max = Math.max(...sentiments);
    if (max - min > 1.0) return true;
  }
  return false;
}

/**
 * Render `signals` into a single prose guidance string for legacy MCP/CLI
 * consumers. New consumers should read `signals` directly. Kept intentionally
 * short — surface-specific polish belongs to each caller.
 */
function buildGuidance(
  graphResult: GraphSearchPayload | null,
  signals: SearchSignals,
): string {
  const parts: string[] = [];

  if (signals.degraded) {
    parts.push("Graph index unavailable — results are filesystem-only. Semantic and relationship signals are absent until the server reconciler runs.");
  } else if (graphResult?.guidance) {
    parts.push(graphResult.guidance);
  } else {
    parts.push("If any facts appear contradictory, use forgetEdge to invalidate with a reason.");
  }

  if (signals.unindexedCount > 0) {
    parts.push(`${signals.unindexedCount} result${signals.unindexedCount === 1 ? "" : "s"} not yet indexed — semantic enrichment pending.`);
  }
  if (signals.staleCount > 0) {
    parts.push(`${signals.staleCount} result${signals.staleCount === 1 ? "" : "s"} edited since last index — the index may lag the file.`);
  }
  if (signals.contradictionsDetected) {
    parts.push("Contradictions detected — consider resolving with forgetEdge.");
  }

  return parts.join(" ");
}

export function configureHybridSearchDependenciesForTests(
  overrides: Partial<typeof defaultHybridSearchDependencies>,
): void {
  hybridSearchDependencies.graphSearch = overrides.graphSearch
    ?? defaultHybridSearchDependencies.graphSearch;
}

export function resetHybridSearchForTests(): void {
  configureHybridSearchDependenciesForTests({});
}

export const __testing__ = {
  runGraphSearch,
};
