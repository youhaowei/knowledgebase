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

/** Pre-computed path for existence check without creating directories. */
function expectedFilePath(namespace: string, id: string): string {
  return join(homedir(), ".kb", "memories", namespace, `${id}.md`);
}

/** Detect name collisions across namespaces. */
function checkNameCollisions(summaries: MemorySummary[]): void {
  const nameToNamespaces = new Map<string, string[]>();
  for (const { name, namespace } of summaries) {
    if (!name) continue;
    const list = nameToNamespaces.get(name) ?? [];
    list.push(namespace);
    nameToNamespaces.set(name, list);
  }

  let collisionCount = 0;
  for (const [name, nsList] of nameToNamespaces) {
    if (nsList.length > 1) {
      console.error(`[migrate] WARNING: name collision — "${name}" in namespaces: ${nsList.join(", ")}`);
      collisionCount++;
    }
  }

  if (collisionCount > 0) {
    console.error(`[migrate] ${collisionCount} name collision(s) detected. Files use different UUIDs, but name queries may return multiple results.`);
  }
}

type MigrateMemory = { id: string; name: string; text?: string; createdAt: Date | string };
type MigrateCounter = { written: number; skipped: number; failed: number };

/** Migrate a single memory: skip if exists, preview if dry-run, write otherwise. */
async function migrateOne(
  m: MigrateMemory, ns: string, dryRun: boolean, now: string, counters: MigrateCounter,
): Promise<void> {
  const label = m.name || "(unnamed)";

  if (existsSync(expectedFilePath(ns, m.id))) {
    console.error(`[migrate]   skip (exists): ${m.id} (${label})`);
    counters.skipped++;
    return;
  }
  if (dryRun) {
    console.error(`[migrate]   (dry-run) would write: ${m.id} (${label})`);
    counters.written++;
    return;
  }

  const createdAt = m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt ?? now);
  const frontmatter: MemoryFrontmatter = {
    id: m.id, name: m.name || "", origin: originForNamespace(ns),
    namespace: ns, tags: [], createdAt, indexedAt: now,
  };

  try {
    await writeMemoryFile(m.id, m.text ?? "", frontmatter);
    console.error(`[migrate]   wrote: ${m.id} (${label})`);
    counters.written++;
  } catch (err) {
    console.error(`[migrate]   ERROR writing ${m.id}: ${err}`);
    counters.failed++;
  }
}

/** Filter active (non-rollup) memories from a provider query. */
function filterActive<T extends { name: string }>(memories: T[]): T[] {
  return memories.filter((m) => m.name !== "__ns_rollup__");
}

export async function migrate(dryRun = false): Promise<void> {
  console.error(`[migrate] Starting migration${dryRun ? " (dry-run)" : ""}...`);

  const gp = await createGraphProvider();
  await gp.init();

  const namespaces = await gp.listNamespaces();
  console.error(`[migrate] Found namespaces: ${namespaces.join(", ") || "(none)"}`);

  // Phase 1: Collect + preflight
  const allSummaries: MemorySummary[] = [];
  for (const ns of namespaces) {
    const active = filterActive(await gp.findMemories({ namespace: ns }, 10000));
    for (const m of active) {
      allSummaries.push({ id: m.id, name: m.name, namespace: ns });
    }
  }
  checkNameCollisions(allSummaries);

  // Phase 2: Write files
  const now = new Date().toISOString();
  const counters: MigrateCounter = { written: 0, skipped: 0, failed: 0 };

  for (const ns of namespaces) {
    const active = filterActive(await gp.findMemories({ namespace: ns }, 10000));
    console.error(`[migrate] Namespace "${ns}": ${active.length} memories`);
    for (const m of active) {
      await migrateOne(m, ns, dryRun, now, counters);
    }
  }

  console.error(`[migrate] Done. written=${counters.written}, skipped=${counters.skipped}, failed=${counters.failed}`);
  if (counters.failed > 0) process.exit(1);
}

// Script entry point
if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  migrate(dryRun).catch((err) => {
    console.error("[migrate] Fatal error:", err);
    process.exit(1);
  });
}
