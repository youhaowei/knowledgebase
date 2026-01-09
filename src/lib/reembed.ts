/**
 * Re-embed all memories with the current embedding model
 *
 * Run this when changing embedding models to update all stored vectors.
 * Usage: bun run db:reembed
 */

import neo4j from "neo4j-driver";
import { embed } from "./embedder";

const NEO4J_URI = process.env.NEO4J_URI ?? "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "password";

async function reembedMemories(): Promise<void> {
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
  );

  const session = driver.session();

  try {
    // Get all memories
    console.log("Fetching all memories...");
    const result = await session.run(`
      MATCH (m:Memory)
      RETURN m.id as id, m.text as text, m.name as name
      ORDER BY m.createdAt
    `);

    const memories = result.records.map((r) => ({
      id: r.get("id") as string,
      text: r.get("text") as string,
      name: r.get("name") as string,
    }));

    console.log(`Found ${memories.length} memories to re-embed\n`);

    if (memories.length === 0) {
      console.log("No memories to re-embed.");
      return;
    }

    // Re-embed each memory
    let success = 0;
    let failed = 0;

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i]!;
      const progress = `[${i + 1}/${memories.length}]`;

      try {
        // Generate new embedding
        const embedding = await embed(memory.text);

        // Update in database
        await session.run(
          `
          MATCH (m:Memory {id: $id})
          SET m.embedding = $embedding
          `,
          { id: memory.id, embedding },
        );

        console.log(`${progress} ✓ ${memory.name || memory.id}`);
        success++;
      } catch (error) {
        console.error(`${progress} ✗ ${memory.name || memory.id}: ${error}`);
        failed++;
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Re-embedding complete!`);
    console.log(`  ✓ Success: ${success}`);
    if (failed > 0) {
      console.log(`  ✗ Failed: ${failed}`);
    }
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  } finally {
    await session.close();
    await driver.close();
  }
}

// Run if executed directly
if (import.meta.main) {
  reembedMemories()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Re-embedding failed:", error);
      process.exit(1);
    });
}
