/**
 * Re-extract entities and edges from all memories
 *
 * Run this when changing the extraction prompt to update the graph structure.
 * This will:
 * 1. Delete all existing Entity nodes and RELATES_TO edges
 * 2. Re-run extraction on each memory's text
 * 3. Generate embeddings for each edge fact
 * 4. Store the new entities and edges
 *
 * Usage: bun run db:reextract
 */

import neo4j from "neo4j-driver";
import { extract } from "./extractor";
import { embed } from "./embedder";
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

    // Clear existing entities (edges are deleted via DETACH DELETE)
    console.log("Clearing existing Entities and RELATES_TO edges...");
    await session.run(`
      MATCH (e:Entity)
      DETACH DELETE e
    `);
    console.log("✓ Cleared existing graph data\n");

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

        // Create entities
        for (const entity of extraction.entities) {
          await session.run(
            `
            MERGE (e:Entity {name: $name, namespace: $namespace})
            ON CREATE SET e.type = $type, e.description = $description
            ON MATCH SET e.description = COALESCE($description, e.description)
            `,
            {
              name: entity.name,
              type: entity.type,
              description: entity.description ?? null,
              namespace: memory.namespace,
            },
          );
        }

        // Create edges (facts as relationships between entities)
        for (const edge of extraction.edges) {
          // Validate indices
          const sourceEntity = extraction.entities[edge.sourceIndex];
          const targetEntity = extraction.entities[edge.targetIndex];
          if (!sourceEntity || !targetEntity) {
            console.warn(
              `         ⚠ Invalid edge indices: ${edge.sourceIndex} -> ${edge.targetIndex}`,
            );
            continue;
          }

          // Generate embedding for edge fact
          console.log(`         Embedding edge: ${edge.fact.slice(0, 50)}...`);
          const embedding = await embed(edge.fact);
          const edgeId = randomUUID();

          // Create RELATES_TO edge
          await session.run(
            `
            MATCH (source:Entity {name: $sourceName, namespace: $namespace})
            MATCH (target:Entity {name: $targetName, namespace: $namespace})
            MERGE (source)-[r:RELATES_TO {relationType: $relationType}]->(target)
            ON CREATE SET
              r.id = $id,
              r.fact = $fact,
              r.sentiment = $sentiment,
              r.confidence = $confidence,
              r.confidenceReason = $confidenceReason,
              r.factEmbedding = $embedding,
              r.episodes = [$memoryId],
              r.validAt = CASE WHEN $validAt IS NOT NULL THEN datetime($validAt) ELSE null END,
              r.invalidAt = null,
              r.createdAt = datetime()
            ON MATCH SET
              r.episodes = r.episodes + $memoryId,
              r.fact = CASE WHEN size($fact) > size(r.fact) THEN $fact ELSE r.fact END
            `,
            {
              sourceName: sourceEntity.name,
              targetName: targetEntity.name,
              namespace: memory.namespace,
              relationType: edge.relationType,
              id: edgeId,
              fact: edge.fact,
              sentiment: edge.sentiment,
              confidence: edge.confidence ?? 1,
              confidenceReason: edge.confidenceReason ?? null,
              embedding,
              memoryId: memory.id,
              validAt: edge.validAt ?? null,
            },
          );
        }

        console.log(
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

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Re-extraction complete!`);
    console.log(`  ✓ Memories processed: ${success}`);
    console.log(`  ✓ Total entities: ${totalEntities}`);
    console.log(`  ✓ Total edges: ${totalEdges}`);
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
