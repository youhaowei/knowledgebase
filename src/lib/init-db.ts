/**
 * Database initialization script
 * Creates required Neo4j indexes including vector index for semantic search
 */

import neo4j from "neo4j-driver";

const NEO4J_URI = process.env.NEO4J_URI ?? "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "password";

// qwen3-embedding:4b produces 2560-dimensional vectors
const EMBEDDING_DIMENSIONS = 2560;

export async function initDatabase(): Promise<void> {
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
  );

  const session = driver.session();

  try {
    console.log("Initializing Neo4j database...");

    // Create vector index for memory embeddings
    await session.run(`
      CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
      FOR (m:Memory)
      ON m.embedding
      OPTIONS {
        indexConfig: {
          \`vector.dimensions\`: ${EMBEDDING_DIMENSIONS},
          \`vector.similarity_function\`: 'cosine'
        }
      }
    `);
    console.log("✓ Vector index 'memory_embedding' ready");

    // Create index on Memory.name for faster lookups
    await session.run(`
      CREATE INDEX memory_name IF NOT EXISTS
      FOR (m:Memory)
      ON (m.name)
    `);
    console.log("✓ Index 'memory_name' ready");

    // Create index on Item.name for faster lookups
    await session.run(`
      CREATE INDEX item_name IF NOT EXISTS
      FOR (i:Item)
      ON (i.name)
    `);
    console.log("✓ Index 'item_name' ready");

    // Create index on Memory.namespace for filtering
    await session.run(`
      CREATE INDEX memory_namespace IF NOT EXISTS
      FOR (m:Memory)
      ON (m.namespace)
    `);
    console.log("✓ Index 'memory_namespace' ready");

    console.log("Database initialization complete!");
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  } finally {
    await session.close();
    await driver.close();
  }
}

// Run if executed directly
if (import.meta.main) {
  initDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
