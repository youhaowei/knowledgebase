/**
 * Re-extract entities and relations from all memories
 *
 * Run this when changing the extraction prompt to update the graph structure.
 * This will:
 * 1. Delete all existing Item nodes and RELATION edges
 * 2. Re-run extraction on each memory's text
 * 3. Store the new items and relations
 *
 * Usage: bun run db:reextract
 */

import neo4j from "neo4j-driver";
import { extract } from "./extractor";
import { randomUUID } from "crypto";

const NEO4J_URI = process.env.NEO4J_URI ?? "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "password";

async function reextractMemories(): Promise<void> {
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
      RETURN m.id as id, m.text as text, m.name as name, m.namespace as namespace
      ORDER BY m.createdAt
    `);

    const memories = result.records.map((r) => ({
      id: r.get("id") as string,
      text: r.get("text") as string,
      name: r.get("name") as string,
      namespace: (r.get("namespace") as string) || "default",
    }));

    console.log(`Found ${memories.length} memories to re-extract\n`);

    if (memories.length === 0) {
      console.log("No memories to re-extract.");
      return;
    }

    // Clear existing items and relations
    console.log("Clearing existing Items and Relations...");
    await session.run(`
      MATCH (i:Item)
      DETACH DELETE i
    `);
    console.log("✓ Cleared existing graph data\n");

    // Re-extract each memory
    let success = 0;
    let failed = 0;
    let totalItems = 0;
    let totalRelations = 0;

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i]!;
      const progress = `[${i + 1}/${memories.length}]`;

      try {
        // Extract entities and relations
        console.log(`${progress} Extracting: ${memory.name || memory.id}`);
        const extraction = await extract(memory.text);

        // Update memory summary if changed
        await session.run(
          `
          MATCH (m:Memory {id: $id})
          SET m.summary = $summary
          `,
          { id: memory.id, summary: extraction.summary },
        );

        // Create items
        for (const item of extraction.items) {
          await session.run(
            `
            MERGE (i:Item {name: $name, namespace: $namespace})
            ON CREATE SET i.type = $type, i.description = $description
            ON MATCH SET i.description = COALESCE($description, i.description)
            `,
            {
              name: item.name,
              type: item.type,
              description: item.description ?? null,
              namespace: memory.namespace,
            },
          );
        }

        // Create relations
        for (const rel of extraction.relations) {
          await session.run(
            `
            MATCH (a:Item {name: $from, namespace: $namespace})
            MATCH (b:Item {name: $to, namespace: $namespace})
            CREATE (a)-[:RELATION {
              id: $relId,
              type: $relation,
              memoryId: $memoryId,
              createdAt: datetime($createdAt)
            }]->(b)
            `,
            {
              from: rel.from,
              to: rel.to,
              relation: rel.relation,
              relId: randomUUID(),
              memoryId: memory.id,
              namespace: memory.namespace,
              createdAt: new Date().toISOString(),
            },
          );
        }

        console.log(
          `         → ${extraction.items.length} items, ${extraction.relations.length} relations`,
        );
        totalItems += extraction.items.length;
        totalRelations += extraction.relations.length;
        success++;
      } catch (error) {
        console.error(`${progress} ✗ ${memory.name || memory.id}: ${error}`);
        failed++;
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Re-extraction complete!`);
    console.log(`  ✓ Memories processed: ${success}`);
    console.log(`  ✓ Total items: ${totalItems}`);
    console.log(`  ✓ Total relations: ${totalRelations}`);
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
  reextractMemories()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Re-extraction failed:", error);
      process.exit(1);
    });
}
