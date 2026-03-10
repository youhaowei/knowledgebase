/**
 * Re-embed memories and edge facts with the current embedding model(s)
 *
 * Generates embeddings for all detected dimensions (dynamic, not hardcoded).
 * Run this when changing embedding models or after installing Ollama.
 * Uses createGraphProvider() for backend-agnostic operation.
 *
 * Usage:
 *   bun run db:reembed             # Re-embed ALL memories and edges
 *   bun run db:reembed --backfill  # Only fill zero-vector gaps
 */

import { embedDual, checkAnyEmbedder, getRegisteredDimensions } from "./embedder";
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
      const embeddings = await embedDual(memory.text);
      await provider.updateMemoryEmbeddings(memory.id, embeddings);
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
      const embeddings = await embedDual(edge.fact);
      await provider.updateFactEmbeddings(edge.id, embeddings);
      console.error(`${progress} ✓ edge: ${edge.id}`);
      success++;
    } catch (error) {
      console.error(`${progress} ✗ edge: ${edge.id}: ${error}`);
      failed++;
    }
  }

  return { success, failed };
}

function dedupeById<T extends { id: string }>(lists: T[][]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }
  }
  return result;
}

async function collectMemories(provider: GraphProvider): Promise<Memory[]> {
  if (!backfill) return provider.findMemories({});

  const dims = getRegisteredDimensions();
  console.error(`[reembed] Registered dimensions: ${dims.join(", ") || "(none detected yet)"}`);
  const needLists = await Promise.all(
    dims.map((dim) => provider.findMemoriesNeedingEmbedding(dim)),
  );
  return dedupeById(needLists);
}

async function collectEdges(provider: GraphProvider): Promise<Array<{ id: string; fact: string }>> {
  if (!backfill) {
    const allEdges = await provider.findEdges({});
    return allEdges.map((e) => ({ id: e.id, fact: e.fact }));
  }

  const dims = getRegisteredDimensions();
  const needLists = await Promise.all(
    dims.map((dim) => provider.findEdgesNeedingEmbedding(dim)),
  );
  return dedupeById(needLists);
}

function printSummary(memResult: { success: number; failed: number }, edgeResult: { success: number; failed: number }) {
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

  const memories = await collectMemories(provider);
  console.error(`\nMemories to re-embed: ${memories.length}`);
  const memResult = memories.length > 0
    ? await reembedMemories(provider, memories)
    : { success: 0, failed: 0 };

  const edges = await collectEdges(provider);
  console.error(`Edges to re-embed: ${edges.length}`);
  const edgeResult = edges.length > 0
    ? await reembedEdges(provider, edges)
    : { success: 0, failed: 0 };

  printSummary(memResult, edgeResult);
}

if (import.meta.main) {
  reembed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Re-embedding failed:", error);
      process.exit(1);
    });
}
