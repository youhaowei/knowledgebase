/**
 * Re-embed memories and edge facts with the current embedding model(s)
 *
 * Generates both Ollama (2560-dim) and fallback (384-dim) embeddings.
 * Run this when changing embedding models or after installing Ollama.
 * Uses createGraphProvider() for backend-agnostic operation.
 *
 * Usage:
 *   bun run db:reembed             # Re-embed ALL memories and edges
 *   bun run db:reembed --backfill  # Only fill zero-vector gaps
 */

import { embedDual, checkAnyEmbedder } from "./embedder";
import { createGraphProvider, type GraphProvider } from "./graph-provider";
import type { Memory } from "../types.js";

const backfill = process.argv.includes("--backfill");

async function reembedMemories(
  provider: GraphProvider,
  memories: Memory[],
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i]!;
    const progress = `[${i + 1}/${memories.length}]`;

    try {
      const { ollama: emb2560, fallback: emb384 } = await embedDual(memory.text);
      await provider.updateMemoryEmbeddings(memory.id, emb2560, emb384);
      console.error(`${progress} ✓ memory: ${memory.name || memory.id}`);
      success++;
    } catch (error) {
      console.error(`${progress} ✗ memory: ${memory.name || memory.id}: ${error}`);
      failed++;
    }
  }

  return { success, failed };
}

async function reembedEdges(
  provider: GraphProvider,
  edges: Array<{ id: string; fact: string }>,
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    const progress = `[${i + 1}/${edges.length}]`;

    try {
      const { ollama: emb2560, fallback: emb384 } = await embedDual(edge.fact);
      await provider.updateFactEmbeddings(edge.id, emb2560, emb384);
      console.error(`${progress} ✓ edge: ${edge.id}`);
      success++;
    } catch (error) {
      console.error(`${progress} ✗ edge: ${edge.id}: ${error}`);
      failed++;
    }
  }

  return { success, failed };
}

async function reembed(): Promise<void> {
  const { ollama, fallback, any } = await checkAnyEmbedder();
  if (!any) {
    console.error(
      "No embedders available. Install Ollama or ensure transformers.js can load.",
    );
    process.exit(1);
  }

  console.error(
    `[reembed] mode=${backfill ? "backfill" : "full"} Ollama=${ollama ? "yes" : "no"} Fallback=${fallback ? "yes" : "no"}`,
  );

  const provider = await createGraphProvider();

  // --- Memories ---
  let memories: Memory[];
  if (backfill) {
    // Find memories missing embeddings in either dimension
    const [need2560, need384] = await Promise.all([
      ollama ? provider.findMemoriesNeedingEmbedding(2560) : Promise.resolve([]),
      fallback ? provider.findMemoriesNeedingEmbedding(384) : Promise.resolve([]),
    ]);
    // Dedupe by id (a memory may need both dimensions)
    const seen = new Set<string>();
    memories = [];
    for (const m of [...need2560, ...need384]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        memories.push(m);
      }
    }
  } else {
    memories = await provider.findMemories({});
  }

  console.error(`\nMemories to re-embed: ${memories.length}`);
  const memResult = memories.length > 0
    ? await reembedMemories(provider, memories)
    : { success: 0, failed: 0 };

  // --- Edges ---
  let edges: Array<{ id: string; fact: string }>;
  if (backfill) {
    const [need2560, need384] = await Promise.all([
      ollama ? provider.findEdgesNeedingEmbedding(2560) : Promise.resolve([]),
      fallback ? provider.findEdgesNeedingEmbedding(384) : Promise.resolve([]),
    ]);
    const seen = new Set<string>();
    edges = [];
    for (const e of [...need2560, ...need384]) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        edges.push(e);
      }
    }
  } else {
    // Full mode: get all edges via findEdges
    const allEdges = await provider.findEdges({});
    edges = allEdges.map((e) => ({ id: e.id, fact: e.fact }));
  }

  console.error(`Edges to re-embed: ${edges.length}`);
  const edgeResult = edges.length > 0
    ? await reembedEdges(provider, edges)
    : { success: 0, failed: 0 };

  // --- Summary ---
  const totalSuccess = memResult.success + edgeResult.success;
  const totalFailed = memResult.failed + edgeResult.failed;

  console.error(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.error(`Re-embedding complete! (${backfill ? "backfill" : "full"})`);
  console.error(`  Memories: ${memResult.success} ok, ${memResult.failed} failed`);
  console.error(`  Edges:    ${edgeResult.success} ok, ${edgeResult.failed} failed`);
  if (totalFailed > 0) {
    console.error(`  ✗ Total failed: ${totalFailed}`);
  }
  if (totalSuccess === 0 && totalFailed === 0) {
    console.error(`  Nothing to do — all embeddings are populated.`);
  }
  console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

if (import.meta.main) {
  reembed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Re-embedding failed:", error);
      process.exit(1);
    });
}
