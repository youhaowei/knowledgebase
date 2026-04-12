/**
 * Hybrid Search
 *
 * Runs file-based search (always available) and graph search (semantic) in
 * parallel. Graph results win on dedup by memory ID. If graph search fails
 * (e.g., embedder error, DB unavailable), returns file-only results gracefully.
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
