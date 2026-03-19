/**
 * Backfill canonicalName for existing entities.
 * Run with: bun run db:backfill-canonical
 */

import { createGraphProvider } from "./graph-provider.js";
import { normalizeEntityName } from "./entity-matcher.js";

async function main() {
  const provider = await createGraphProvider();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration script accesses internal conn/driver
  const gp = provider as any;

  if (gp.executeQuery) {
    // LadybugDB path — use executeQuery for parameterized queries
    const result = await gp.executeQuery(
      `MATCH (e:Entity) WHERE e.canonicalName = '' RETURN e.uuid as uuid, e.name as name`,
    );
    const rows = await result.getAll();

    let updated = 0;
    for (const row of rows) {
      const canonical = normalizeEntityName(row.name as string);
      await gp.executeQuery(
        `MATCH (e:Entity {uuid: $uuid}) SET e.canonicalName = $canonical`,
        { uuid: row.uuid as string, canonical },
      );
      updated++;
    }

    console.error(`[backfill-canonical] Updated ${updated} entities`);
  } else if (gp.driver) {
    // Neo4j path
    const session = gp.driver.session();
    try {
      const result = await session.run(
        `MATCH (e:Entity) WHERE e.canonicalName IS NULL OR e.canonicalName = '' RETURN e.uuid AS uuid, e.name AS name`,
      );
      let updated = 0;
      for (const record of result.records) {
        const canonical = normalizeEntityName(record.get("name") as string);
        await session.run(
          `MATCH (e:Entity {uuid: $uuid}) SET e.canonicalName = $canonical`,
          { uuid: record.get("uuid"), canonical },
        );
        updated++;
      }
      console.error(`[backfill-canonical] Updated ${updated} entities`);
    } finally {
      await session.close();
    }
  }

  await provider.close();
}

main().catch((err) => {
  console.error("[backfill-canonical] Fatal:", err);
  process.exit(1);
});
