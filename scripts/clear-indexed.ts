/**
 * db:reindex — Rebuilds the graph index from the filesystem source of truth.
 *
 * Two phases:
 *   1. Soft-delete every namespace's existing graph rows so orphaned
 *      memories/entities/edges (from forgotten files, schema drift, or
 *      partial prior runs) don't survive the rebuild.
 *   2. Clear `indexedAt` from every file so the server sweep re-extracts
 *      and re-stores them.
 *
 * Decision #11 EXEMPTION: this script owns the DB lifecycle and may write
 * to LadybugDB directly. The CLI's normal CRUD path stays JSONL-only.
 *
 * Usage: bun run db:reindex [--dry-run]
 */

import { listNamespaceDirs, listMemoryFiles, readMemoryFile, writeMemoryFile } from "../src/lib/fs-memory.js";
import { createGraphProvider } from "../src/lib/graph-provider.js";

const dryRun = process.argv.includes("--dry-run");
let cleared = 0;
let skipped = 0;
let purgedNamespaces = 0;

const namespaces = listNamespaceDirs();

if (!dryRun) {
  const gp = await createGraphProvider();
  for (const ns of namespaces) {
    try {
      await gp.deleteByNamespace(ns);
      console.error(`[reindex] purged graph rows in namespace: ${ns}`);
      purgedNamespaces++;
    } catch (err) {
      console.error(`[reindex] WARN: failed to purge ${ns} — orphans may remain after rebuild: ${err instanceof Error ? err.message : err}`);
    }
  }
} else {
  console.error(`[reindex] (dry-run) would purge graph rows in ${namespaces.length} namespace(s)`);
}

for (const ns of namespaces) {
  for (const file of listMemoryFiles(ns)) {
    const { frontmatter, text } = readMemoryFile(file.path);
    if (!frontmatter.indexedAt) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.error(`[reindex] (dry-run) would clear indexedAt: ${file.name} (${ns})`);
      cleared++;
      continue;
    }

    const updatedFrontmatter = { ...frontmatter };
    delete updatedFrontmatter.indexedAt;
    writeMemoryFile(file.id, text, updatedFrontmatter);
    console.error(`[reindex] cleared indexedAt: ${file.name} (${ns})`);
    cleared++;
  }
}

console.error(`[reindex] Done. Purged namespaces: ${purgedNamespaces}, Cleared: ${cleared}, Already unindexed: ${skipped}${dryRun ? " (dry-run)" : ""}`);
