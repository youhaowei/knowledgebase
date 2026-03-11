/**
 * Retro-specific search helpers
 *
 * Built on top of the operations layer (shared provider singleton).
 * Adds retro-finding-specific logic: similarity search and recurring pattern detection.
 *
 * Note: Currently unused — intended for future retro CLI `search-kb` and `patterns` commands.
 */

import { search, getProvider } from "./operations.js";
import type { Memory, StoredEdge } from "../types.js";

const RETRO_NAMESPACE = "retro";

/**
 * Find existing retro findings similar to the given text.
 * Uses the shared operations.search() which combines vector + FTS via RRF.
 * Useful for dedup before inserting a new finding.
 */
export async function findSimilarFindings(
  text: string,
  limit = 5,
): Promise<Memory[]> {
  const result = await search(text, RETRO_NAMESPACE, limit);
  return result.memories;
}

/**
 * Find recurring patterns in retro findings.
 * Looks for edges (facts) in the retro namespace that reference multiple
 * memory episodes — indicating the same insight was extracted from multiple findings.
 *
 * Current approach: fetches ALL edges in the retro namespace and filters in JS.
 * This is fine for the expected scale (dozens to low hundreds of edges).
 * If the retro namespace grows past ~1000 edges, consider adding a Cypher-level
 * filter: `WHERE size(r.episodes) >= $minEpisodes` to the provider layer.
 *
 * @param minEpisodes Minimum number of source memories referencing the edge (default: 2)
 */
export async function findRecurringPatterns(
  minEpisodes = 2,
  limit = 20,
): Promise<StoredEdge[]> {
  const gp = await getProvider();
  const allEdges = await gp.findEdges({ namespace: RETRO_NAMESPACE });
  return allEdges
    .filter((e) => e.episodes.length >= minEpisodes)
    .sort((a, b) => b.episodes.length - a.episodes.length)
    .slice(0, limit);
}
