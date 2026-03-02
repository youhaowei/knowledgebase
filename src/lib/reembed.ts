/**
 * Re-embed all memory text with the current embedding model(s)
 *
 * Generates both Ollama (2560-dim) and fallback (384-dim) embeddings.
 * Run this when changing embedding models or after installing Ollama.
 * Uses createGraphProvider() for backend-agnostic operation.
 *
 * NOTE: Only re-embeds Memory nodes, not edge facts. To update edge
 * embeddings, use db:reextract (which also re-runs extraction).
 *
 * Usage: bun run db:reembed
 */

import { embedDual, checkAnyEmbedder } from "./embedder";
import { createGraphProvider } from "./graph-provider";

async function reembed(): Promise<void> {
  const { ollama, fallback, any } = await checkAnyEmbedder();
  if (!any) {
    console.error(
      "No embedders available. Install Ollama or ensure transformers.js can load.",
    );
    process.exit(1);
  }

  console.error(
    `[reembed] Embedders: Ollama=${ollama ? "yes" : "no"}, Fallback=${fallback ? "yes" : "no"}`,
  );

  const provider = await createGraphProvider();

  // Get all memories
  console.error("Fetching all memories...");
  const memories = await provider.findMemories({});

  console.error(`Found ${memories.length} memories to re-embed\n`);

  if (memories.length === 0) {
    console.error("No memories to re-embed.");
    return;
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i]!;
    const progress = `[${i + 1}/${memories.length}]`;

    try {
      const { ollama: emb2560, fallback: emb384 } = await embedDual(
        memory.text,
      );

      // LadybugDB requires delete+create for vector-indexed properties,
      // so we use store() which handles this. Empty arrays = no entity/edge changes.
      await provider.store(memory, [], [], emb2560, [], emb384, []);

      console.error(`${progress} ✓ ${memory.name || memory.id}`);
      success++;
    } catch (error) {
      console.error(`${progress} ✗ ${memory.name || memory.id}: ${error}`);
      failed++;
    }
  }

  console.error(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.error(`Re-embedding complete!`);
  console.error(`  ✓ Success: ${success}`);
  if (failed > 0) {
    console.error(`  ✗ Failed: ${failed}`);
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
