/**
 * Migration script for entity scoping
 *
 * Adds uuid and scope to existing entities:
 * 1. Add uuid to existing entities that don't have one
 * 2. Set scope='project' for all existing entities
 * 3. Ensure namespace is set (default if missing)
 *
 * Run this before deploying the new scoping code.
 */

import { Graph } from "./graph.js";

export async function migrateToScoping(): Promise<void> {
  const graph = new Graph();
  const session = graph.getSession();

  try {
    console.log("Starting migration to entity scoping...\n");

    // 1. Add uuid to existing entities that don't have one
    console.log("Step 1: Adding UUIDs to entities without them...");
    const uuidResult = await session.run(`
      MATCH (e:Entity)
      WHERE e.uuid IS NULL
      SET e.uuid = randomUUID()
      RETURN count(e) as updated
    `);
    const uuidCount = uuidResult.records[0]?.get("updated")?.toNumber() ?? 0;
    console.log(`✓ Added UUIDs to ${uuidCount} entities`);

    // 2. Set scope='project' for all existing entities
    console.log("\nStep 2: Setting scope='project' for all entities...");
    const scopeResult = await session.run(`
      MATCH (e:Entity)
      WHERE e.scope IS NULL
      SET e.scope = 'project'
      RETURN count(e) as updated
    `);
    const scopeCount = scopeResult.records[0]?.get("updated")?.toNumber() ?? 0;
    console.log(`✓ Set scope for ${scopeCount} entities`);

    // 3. Ensure namespace is set (default if missing)
    console.log("\nStep 3: Ensuring namespace is set...");
    const namespaceResult = await session.run(`
      MATCH (e:Entity)
      WHERE e.namespace IS NULL
      SET e.namespace = 'default'
      RETURN count(e) as updated
    `);
    const namespaceCount =
      namespaceResult.records[0]?.get("updated")?.toNumber() ?? 0;
    console.log(`✓ Set namespace for ${namespaceCount} entities`);

    // Verify migration
    console.log("\nVerifying migration...");
    const verifyResult = await session.run(`
      MATCH (e:Entity)
      WHERE e.scope IS NULL OR e.uuid IS NULL OR e.namespace IS NULL
      RETURN count(e) as remaining
    `);
    const remaining =
      verifyResult.records[0]?.get("remaining")?.toNumber() ?? 0;

    if (remaining === 0) {
      console.log(
        "\n✅ Migration complete! All entities have uuid, scope, and namespace.",
      );
    } else {
      console.log(
        `\n⚠️  Warning: ${remaining} entities still missing required fields. Please investigate.`,
      );
    }
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await session.close();
    await graph.close();
  }
}

// Run if executed directly
if (import.meta.main) {
  migrateToScoping()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
