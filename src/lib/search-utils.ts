import type { StoredEdge } from "../types.js";

/**
 * Reciprocal Rank Fusion (RRF) — merges two ranked edge lists into one.
 *
 * Score per item = Σ 1/(K + rank) for each list containing it.
 * Items found by both methods score highest. K=60 is the standard constant
 * from Cormack et al. 2009, used by Elasticsearch and MongoDB Atlas Search.
 */
export function rrfFuse(
  vectorResults: StoredEdge[],
  ftsResults: StoredEdge[],
  limit: number,
  K = 60,
): StoredEdge[] {
  const scoreMap = new Map<string, number>();
  const edgeMap = new Map<string, StoredEdge>();

  for (let rank = 0; rank < vectorResults.length; rank++) {
    const edge = vectorResults[rank]!;
    scoreMap.set(edge.id, 1 / (K + rank));
    edgeMap.set(edge.id, edge);
  }

  for (let rank = 0; rank < ftsResults.length; rank++) {
    const edge = ftsResults[rank]!;
    const existing = scoreMap.get(edge.id) ?? 0;
    scoreMap.set(edge.id, existing + 1 / (K + rank));
    if (!edgeMap.has(edge.id)) {
      edgeMap.set(edge.id, edge);
    }
  }

  return [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => edgeMap.get(id)!);
}
