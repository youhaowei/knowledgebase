/**
 * Hybrid Search
 *
 * Runs file-based search (always fast, filesystem) and graph search (semantic,
 * requires DB + embedder) in parallel with a timeout. Graph results win on
 * dedup by memory ID. If graph search fails or times out, returns file-only
 * results gracefully.
 */

import * as ops from "./operations.js";
import { fileSearch, type FileSearchResult } from "./file-search.js";
import { normalizeTags } from "./fs-memory.js";
import type { Memory, StoredEdge, StoredEntity, Intent } from "../types.js";

export type { FileSearchResult };

export interface HybridSearchResult {
  // Graph search results (unchanged shape)
  memories: Memory[];
  edges: StoredEdge[];
  entities: StoredEntity[];
  intent: Intent;
  guidance: string;
  // File search results
  files: FileSearchResult[];
}

type GraphSearchPayload = {
  memories: Memory[];
  edges: StoredEdge[];
  entities: StoredEntity[];
  intent: Intent;
  guidance: string;
};

const GRAPH_TIMEOUT_MS = 3000;
const GRAPH_FAILURE_COOLDOWN_MS = 30_000;

// Exported for test reset
export const _state = {
  graphFailureCooldownUntil: 0,
  reset() {
    this.graphFailureCooldownUntil = 0;
  },
};

async function graphSearchWithTimeout(
  query: string,
  namespace: string | undefined,
  limit: number,
): Promise<GraphSearchPayload | null> {
  if (Date.now() < _state.graphFailureCooldownUntil) {
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      ops.search(query, namespace, limit),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Graph search timeout")),
          GRAPH_TIMEOUT_MS,
        );
      }),
    ]);
    _state.graphFailureCooldownUntil = 0;
    return result;
  } catch (err) {
    _state.graphFailureCooldownUntil = Date.now() + GRAPH_FAILURE_COOLDOWN_MS;
    console.error(`[hybrid-search] Graph search failed/timed out: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
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
  namespace?: string,
  limit = 10,
  tags?: string[],
): Promise<HybridSearchResult> {
  const normalizedTags = tags && tags.length > 0 ? normalizeTags(tags) : undefined;

  // Run both searches in parallel — graph has a timeout cap
  const [graphResult, fileResults] = await Promise.all([
    graphSearchWithTimeout(query, namespace, limit),
    fileSearch(query, namespace ?? "default", { limit, tags: normalizedTags }),
  ]);

  let memories = graphResult?.memories ?? [];
  let edges = graphResult?.edges ?? [];
  let entities = graphResult?.entities ?? [];

  // When filtering by tags, restrict graph results to tagged file IDs.
  // fileSearch already returns tagged entries, so reuse its IDs instead of
  // calling listMemoryFiles again.
  if (normalizedTags && normalizedTags.length > 0) {
    const taggedFileIds = new Set(fileResults.map((f) => f.id));
    ({ memories, edges, entities } = filterGraphResultsByTaggedFileIds(
      graphResult,
      taggedFileIds,
    ));
  }

  // Build set of memory IDs from graph results for dedup (graph wins)
  const graphMemoryIds = new Set(memories.map((m) => m.id));

  // Filter file results to exclude IDs already covered by graph
  const dedupedFiles = fileResults.filter((f) => !graphMemoryIds.has(f.id));

  return {
    memories,
    edges,
    entities,
    intent: graphResult?.intent ?? "general",
    guidance:
      graphResult?.guidance ??
      "If any facts appear contradictory, use forgetEdge to invalidate with a reason.",
    files: dedupedFiles,
  };
}
