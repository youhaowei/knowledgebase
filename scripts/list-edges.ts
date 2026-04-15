#!/usr/bin/env bun
/**
 * Dump existing graph edges from the default LadybugDB.
 * Used to bootstrap the edge-fact benchmark without running new extractions.
 */

import { createGraphProvider } from "../src/lib/graph-provider.ts";

const gp = await createGraphProvider();
console.error("[list-edges] provider created");

try {
  const edges = await gp.findEdges({});
  console.error(`[list-edges] total edges: ${edges.length}`);
  // Output as JSON for downstream consumption
  const slim = edges.map((e) => ({
    id: e.id,
    fact: e.fact,
    relationType: e.relationType,
    namespace: e.namespace,
    episodes: e.episodes,
  }));
  console.log(JSON.stringify(slim, null, 2));
} catch (err) {
  console.error("[list-edges] findEdges failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

process.exit(0);
