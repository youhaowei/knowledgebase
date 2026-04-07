#!/usr/bin/env bun
/**
 * Migration script: LadybugDB → filesystem
 *
 * Exports all active memories from LadybugDB to ~/.kb/memories/{namespace}/{uuid}.md
 * Safe to re-run: skips files that already exist (idempotent by UUID filename).
 *
 * Usage:
 *   bun run src/lib/migrate-to-fs.ts [--dry-run]
 *   kb migrate [--dry-run]
 */

import { createGraphProvider } from "./graph-provider.js";
import { writeMemoryFile } from "./fs-memory.js";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { MemoryFrontmatter, Origin } from "./fs-memory.js";

interface MemorySummary {
  id: string;
  name: string;
  namespace: string;
}

function originForNamespace(namespace: string): Origin {
  if (namespace === "retro") return "retro";
  return "import";
}

export async function migrate(dryRun = false): Promise<void> {
  console.error(`[migrate] Starting migration${dryRun ? " (dry-run)" : ""}...`);

  const gp = await createGraphProvider();
  await gp.init();

  const namespaces = await gp.listNamespaces();
  console.error(`[migrate] Found namespaces: ${namespaces.join(", ") || "(none)"}`);

  // -------------------------------------------------------------------------
  // Phase 1: Collect all active memories for preflight name-collision check
  // -------------------------------------------------------------------------
  const allSummaries: MemorySummary[] = [];

  for (const ns of namespaces) {
    const memories = await gp.findMemories({ namespace: ns }, 10000);
    const active = memories.filter((m) => m.name !== "__ns_rollup__");
    for (const m of active) {
      allSummaries.push({ id: m.id, name: m.name, namespace: ns });
    }
  }

  // Detect name collisions (same name appearing in multiple namespaces)
  const nameToNamespaces = new Map<string, string[]>();
  for (const { name, namespace } of allSummaries) {
    if (!name) continue; // skip unnamed memories
    const list = nameToNamespaces.get(name) ?? [];
    list.push(namespace);
    nameToNamespaces.set(name, list);
  }

  let collisionCount = 0;
  for (const [name, nsList] of nameToNamespaces) {
    if (nsList.length > 1) {
      console.error(
        `[migrate] WARNING: name collision — "${name}" exists in namespaces: ${nsList.join(", ")}`,
      );
      collisionCount++;
    }
  }

  if (collisionCount > 0) {
    console.error(
      `[migrate] ${collisionCount} name collision(s) detected. Files will still be written (different UUIDs), but queries by name may return multiple results.`,
    );
  }

  // -------------------------------------------------------------------------
  // Phase 2: Write memory files
  // -------------------------------------------------------------------------
  const now = new Date().toISOString();
  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (const ns of namespaces) {
    const memories = await gp.findMemories({ namespace: ns }, 10000);
    const active = memories.filter((m) => m.name !== "__ns_rollup__");

    console.error(`[migrate] Namespace "${ns}": ${active.length} memories`);

    for (const m of active) {
      // Use a pre-computed path for existence check (avoids creating dirs in dry-run)
      const expectedPath = join(homedir(), ".kb", "memories", ns, `${m.id}.md`);

      if (existsSync(expectedPath)) {
        console.error(`[migrate]   skip (exists): ${m.id} (${m.name || "(unnamed)"})`);
        skipped++;
        continue;
      }

      if (dryRun) {
        console.error(`[migrate]   (dry-run) would write: ${m.id} (${m.name || "(unnamed)"})`);
        written++;
        continue;
      }

      const createdAt =
        m.createdAt instanceof Date
          ? m.createdAt.toISOString()
          : String(m.createdAt ?? now);

      const frontmatter: MemoryFrontmatter = {
        id: m.id,
        name: m.name || "",
        origin: originForNamespace(ns),
        namespace: ns,
        tags: [],
        createdAt,
        indexedAt: now, // already extracted/indexed in graph
      };

      try {
        await writeMemoryFile(m.id, m.text ?? "", frontmatter);
        console.error(`[migrate]   wrote: ${m.id} (${m.name || "(unnamed)"})`);
        written++;
      } catch (err) {
        console.error(`[migrate]   ERROR writing ${m.id}: ${err}`);
        failed++;
      }
    }
  }

  console.error(
    `[migrate] Done. written=${written}, skipped=${skipped}, failed=${failed}`,
  );

  if (failed > 0) {
    process.exit(1);
  }
}

// Script entry point
if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  migrate(dryRun).catch((err) => {
    console.error("[migrate] Fatal error:", err);
    process.exit(1);
  });
}
