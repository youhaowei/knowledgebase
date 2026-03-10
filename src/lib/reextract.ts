/**
 * Re-extract entities and edges from all memories
 *
 * Run this when changing the extraction prompt to update the graph structure.
 * This will:
 * 1. Re-run extraction on each memory's text
 * 2. Generate dual embeddings for each edge fact
 * 3. Store entities (MERGE) and edges via the provider
 *
 * Entities and edges are upserted via MERGE — stale entities from previous
 * extractions are not deleted (they become orphans but cause no harm).
 * Uses createGraphProvider() for backend-agnostic operation.
 *
 * Usage: bun run db:reextract
 */

import { extract } from "./extractor";
import { embedDual, checkAnyEmbedder } from "./embedder";
import { createGraphProvider } from "./graph-provider";
import type { EmbeddingMap } from "../types.js";

async function reextractMemories(): Promise<void> {
  const { ollama, fallback, any } = await checkAnyEmbedder();
  if (!any) {
    console.error(
      "No embedders available. Install Ollama or ensure transformers.js can load.",
    );
    process.exit(1);
  }

  console.error(
    `[reextract] Embedders: Ollama=${ollama ? "yes" : "no"}, Fallback=${fallback ? "yes" : "no"}`,
  );

  const provider = await createGraphProvider();

  // Get all memories
  console.error("Fetching all memories...");
  const memories = await provider.findMemories({});

  console.error(`Found ${memories.length} memories to re-extract\n`);

  if (memories.length === 0) {
    console.error("No memories to re-extract.");
    return;
  }

  // Re-extract each memory
  let success = 0;
  let failed = 0;
  let totalEntities = 0;
  let totalEdges = 0;

  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i]!;
    const progress = `[${i + 1}/${memories.length}]`;

    try {
      // Extract entities and edges
      console.error(`${progress} Extracting: ${memory.name || memory.id}`);
      const extraction = await extract(memory.text);

      // Generate dual embeddings for memory text
      const memEmb = await embedDual(memory.text);

      // Generate dual embeddings for each edge fact
      const edgeEmbeddings: EmbeddingMap[] = [];
      for (const edge of extraction.edges) {
        console.error(
          `         Embedding edge: ${edge.fact.slice(0, 50)}...`,
        );
        edgeEmbeddings.push(await embedDual(edge.fact));
      }

      // Store via provider — handles entity MERGE, edge creation, embeddings
      const memoryWithSummary = { ...memory, summary: extraction.summary };
      await provider.store(
        memoryWithSummary,
        extraction.entities,
        extraction.edges,
        memEmb,
        edgeEmbeddings,
      );

      console.error(
        `         → ${extraction.entities.length} entities, ${extraction.edges.length} edges`,
      );
      totalEntities += extraction.entities.length;
      totalEdges += extraction.edges.length;
      success++;
    } catch (error) {
      console.error(`${progress} ✗ ${memory.name || memory.id}: ${error}`);
      failed++;
    }
  }

  console.error(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.error(`Re-extraction complete!`);
  console.error(`  ✓ Memories processed: ${success}`);
  console.error(`  ✓ Total entities: ${totalEntities}`);
  console.error(`  ✓ Total edges: ${totalEdges}`);
  if (failed > 0) {
    console.error(`  ✗ Failed: ${failed}`);
  }
  console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

// Run if executed directly
if (import.meta.main) {
  reextractMemories()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Re-extraction failed:", error);
      process.exit(1);
    });
}
