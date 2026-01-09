/**
 * Database initialization script
 *
 * Creates required Neo4j indexes for the edge-as-fact knowledge graph:
 * - Memory nodes with vector embeddings
 * - Entity nodes
 * - RELATES_TO edges (facts as relationships between entities)
 *
 * This is idempotent - safe to run multiple times.
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
    console.log("Initializing Neo4j database (edge-as-fact model)...\n");

    // ===========================================================================
    // CONSTRAINTS (uniqueness)
    // ===========================================================================

    await session.run(`
      CREATE CONSTRAINT memory_id IF NOT EXISTS
      FOR (m:Memory) REQUIRE m.id IS UNIQUE
    `);
    console.log("✓ Constraint 'memory_id' ready");

    await session.run(`
      CREATE CONSTRAINT entity_name_namespace IF NOT EXISTS
      FOR (e:Entity) REQUIRE (e.name, e.namespace) IS UNIQUE
    `);
    console.log("✓ Constraint 'entity_name_namespace' ready");

    // ===========================================================================
    // INDEXES (for faster lookups)
    // ===========================================================================

    await session.run(`
      CREATE INDEX memory_namespace IF NOT EXISTS
      FOR (m:Memory) ON (m.namespace)
    `);
    console.log("✓ Index 'memory_namespace' ready");

    await session.run(`
      CREATE INDEX memory_name IF NOT EXISTS
      FOR (m:Memory) ON (m.name)
    `);
    console.log("✓ Index 'memory_name' ready");

    await session.run(`
      CREATE INDEX entity_namespace IF NOT EXISTS
      FOR (e:Entity) ON (e.namespace)
    `);
    console.log("✓ Index 'entity_namespace' ready");

    // ===========================================================================
    // VECTOR INDEXES (for semantic search)
    // ===========================================================================

    await session.run(`
      CREATE VECTOR INDEX memory_embedding IF NOT EXISTS
      FOR (m:Memory) ON (m.embedding)
      OPTIONS {
        indexConfig: {
          \`vector.dimensions\`: ${EMBEDDING_DIMENSIONS},
          \`vector.similarity_function\`: 'cosine'
        }
      }
    `);
    console.log("✓ Vector index 'memory_embedding' ready");

    // ===========================================================================
    // FULL-TEXT INDEX (for edge fact search)
    // ===========================================================================
    // Note: Neo4j doesn't support vector indexes on relationship properties,
    // so we use full-text search for finding edges by fact content.

    await session.run(`
      CREATE FULLTEXT INDEX edge_fact_text IF NOT EXISTS
      FOR ()-[r:RELATES_TO]-()
      ON EACH [r.fact]
    `);
    console.log("✓ Full-text index 'edge_fact_text' ready");

    console.log("\n✅ Database initialization complete!");
    console.log(`
Schema summary:
- Memory: id (unique), name, text, summary, embedding (vector), namespace
- Entity: name+namespace (unique), type, description, summary

Edges (facts as relationships):
- Entity -[RELATES_TO {
    id, relationType, fact, sentiment, factEmbedding,
    episodes[], validAt, invalidAt, createdAt
  }]-> Entity
`);
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
