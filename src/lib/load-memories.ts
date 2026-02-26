/**
 * Load memories from memories.json into the knowledgebase
 * Useful for initializing the knowledgebase with its own documentation
 *
 * Usage: bun run src/lib/load-memories.ts
 */

import { addMemory } from "./operations.js";

interface MemoryEntry {
  namespace: string;
  text: string;
  name?: string;
}

async function loadMemories() {
  console.log("Loading memories from memories.json...\n");

  // Load memories from JSON file
  const file = Bun.file("memories.json");
  const memories: MemoryEntry[] = await file.json();

  console.log(`Found ${memories.length} memories to load\n`);

  // Add each memory
  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i]!;
    console.log(`[${i + 1}/${memories.length}] Adding memory to namespace "${memory.namespace}"...`);

    try {
      const result = await addMemory(
        memory.text,
        memory.name,
        memory.namespace,
      );
      console.log(`✓ Queued (ID: ${result.id})\n`);
    } catch (error) {
      console.error(`✗ Failed: ${error}\n`);
    }
  }

  console.log("Done! All memories have been queued for processing.");
  console.log("Check the queue status to see when processing completes.");
}

loadMemories().catch(console.error);
