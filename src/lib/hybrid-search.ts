/**
 * Hybrid Search
 *
 * Runs file-based search (always fast, filesystem) and graph search (semantic,
 * requires DB + embedder) in parallel. Graph results win on dedup by memory ID.
 * If graph search fails or times out (3s), returns file-only results gracefully.
 */

import * as ops from "./operations.js";
import { fileSearch, type FileSearchResult } from "./file-search.js";
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

const GRAPH_TIMEOUT_MS = 3000;

async function graphSearchWithTimeout(
  query: string,
  namespace: string | undefined,
  limit: number,
): Promise<{ memories: Memory[]; edges: StoredEdge[]; entities: StoredEntity[]; intent: Intent; guidance: string } | null> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    const result = await Promise.race([
      ops.search(query, namespace, limit),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Graph search timeout")), GRAPH_TIMEOUT_MS);
      }),
    ]);
    return result;
  } catch (err) {
    console.error(`[hybrid-search] Graph search failed/timed out: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timer!);
  }
}

export async function hybridSearch(
  query: string,
  namespace?: string,
  limit = 10,
  tags?: string[],
): Promise<HybridSearchResult> {
  const [graphResult, fileResults] = await Promise.all([
    graphSearchWithTimeout(query, namespace, limit),
    fileSearch(query, namespace ?? "default", { limit, tags }),
  ]);

  // Build set of memory IDs from graph results for dedup (graph wins)
  const graphMemoryIds = new Set(graphResult?.memories.map((m) => m.id) ?? []);

  // Filter file results to exclude IDs already covered by graph
  const dedupedFiles = fileResults.filter((f) => !graphMemoryIds.has(f.id));

  return {
    memories: graphResult?.memories ?? [],
    edges: graphResult?.edges ?? [],
    entities: graphResult?.entities ?? [],
    intent: graphResult?.intent ?? "general",
    guidance: graphResult?.guidance ?? "If any facts appear contradictory, use forgetEdge to invalidate with a reason.",
    files: dedupedFiles,
  };
}
