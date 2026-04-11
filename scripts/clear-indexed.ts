/**
 * db:reindex — Clears `indexedAt` from all filesystem memory files so the
 * server sweep re-extracts and re-indexes them into the graph.
 *
 * Usage: bun run db:reindex [--dry-run]
 */

import { listNamespaceDirs, listMemoryFiles, readMemoryFile, writeMemoryFile } from "../src/lib/fs-memory.js";

const dryRun = process.argv.includes("--dry-run");
let cleared = 0;
let skipped = 0;

for (const ns of listNamespaceDirs()) {
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

console.error(`[reindex] Done. Cleared: ${cleared}, Already unindexed: ${skipped}${dryRun ? " (dry-run)" : ""}`);
