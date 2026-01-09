/**
 * Fix vector index dimensions
 * Drops old index and recreates with correct 2560 dimensions
 */

import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI ?? "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER ?? "neo4j",
    process.env.NEO4J_PASSWORD ?? "password",
  ),
);
const session = driver.session();

try {
  // Drop old index
  console.log("Dropping old vector index...");
  await session.run("DROP INDEX memory_embedding IF EXISTS");
  console.log("✓ Old index dropped");

  // Create new index with correct dimensions
  console.log(
    "Creating new vector index with 2560 dimensions (qwen3-embedding:4b)...",
  );
  await session.run(`
    CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
    FOR (m:Memory)
    ON m.embedding
    OPTIONS {
      indexConfig: {
        \`vector.dimensions\`: 2560,
        \`vector.similarity_function\`: 'cosine'
      }
    }
  `);
  console.log("✓ New vector index created");
} finally {
  await session.close();
  await driver.close();
}
