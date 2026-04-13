/**
 * Async Queue Processor
 *
 * Processes memories asynchronously in background:
 * 1. Extract entities & edges (Claude/Gemini) - Edge-as-Fact model
 * 2. Generate embeddings for memory AND each edge fact (Ollama)
 * 3. Store via GraphProvider (LadybugDB default, Neo4j optional)
 *
 * Per-namespace queues to avoid race conditions
 */

import { statSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import { readFileSync, writeFileSync, renameSync } from "fs";
import { extract } from "./extractor.js";
import { embedDual } from "./embedder.js";
import type { GraphProvider } from "./graph-provider.js";
import type { Memory, EmbeddingMap } from "../types.js";
import { track } from "./analytics.js";
import { summarySchema } from "./versions.js";
import { resolveNamespacePath, type MemoryFrontmatter } from "./fs-memory.js";
import {
  semver,
  isoFrom,
} from "../../libs/wystack/packages/version/src/index";

type QueueEntry = {
  memory: Memory;
  onStored?: (memory: Memory) => Promise<void>;
  resolve: () => void;
  reject: (e: Error) => void;
};

/**
 * Returns the file's mtime in ms, or null if the file doesn't exist.
 * Used for the Decision #8 snapshot-mtime ordering invariant — synthetic
 * memories from test harnesses without on-disk files return null and skip
 * the invariant.
 *
 * Exported for testing the Decision #8 invariant directly.
 */
export function safeMtimeMs(filePath: string): number | null {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Returns true if the file's mtime differs from the snapshot, or if the file
 * has disappeared. Returns false when `snapshot` is null (no invariant to check).
 *
 * Exported for testing the Decision #8 invariant directly.
 */
export function isFileChangedSince(filePath: string, snapshot: number | null): boolean {
  if (snapshot === null) return false;
  const current = safeMtimeMs(filePath);
  return current === null || current !== snapshot;
}

/**
 * Reads a memory file for regeneration. Returns null if the file is missing
 * or unreadable — callers treat that as "abandon the regen pass".
 */
async function readFileFromDiskForRegen(
  filePath: string,
): Promise<{ frontmatter: MemoryFrontmatter; text: string } | null> {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = matter(raw);
    return {
      frontmatter: parsed.data as MemoryFrontmatter,
      text: parsed.content,
    };
  } catch {
    return null;
  }
}

/**
 * Atomically writes regenerated frontmatter (abstract/summary/schemaVersion/
 * versionedAt) back to the file, preserving the body verbatim. Unknown user
 * frontmatter keys survive per Spec Decision #12. Uses tempfile + rename so
 * a crash mid-write leaves either the old or new content, never partial.
 */
function writeRegeneratedFrontmatter(
  filePath: string,
  current: { frontmatter: MemoryFrontmatter; text: string },
  updates: {
    abstract: string;
    summary: string;
    schemaVersion: string;
    versionedAt: string;
  },
): void {
  const merged = {
    ...current.frontmatter,
    abstract: updates.abstract,
    summary: updates.summary,
    schemaVersion: updates.schemaVersion,
    versionedAt: updates.versionedAt,
  };
  const content = matter.stringify(current.text, merged as Record<string, unknown>);
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}

export class Queue {
  private entries: Map<string, QueueEntry[]> = new Map();
  private processing: Set<string> = new Set();
  // Per-namespace guard: at most one fire-and-forget regenerateOneStale
  // in flight. Without this, a sweep that drains 100 unindexed entries
  // kicks off 100 concurrent regenerations — each calling extract() +
  // updateMemorySummary() against the same graph connection.
  private regeneratingNamespaces: Set<string> = new Set();
  private graph: GraphProvider;

  constructor(graph: GraphProvider) {
    this.graph = graph;
  }

  /**
   * Add a memory to the processing queue
   * Returns a promise that resolves when processing completes
   */
  async add(memory: Memory, onStored?: (memory: Memory) => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const ns = memory.namespace;

      if (!this.entries.has(ns)) {
        this.entries.set(ns, []);
      }

      this.entries.get(ns)!.push({ memory, onStored, resolve, reject });

      // Start processing if not already running for this namespace
      if (!this.processing.has(ns)) {
        this.process(ns);
      }
    });
  }

  /**
   * Process all entries in a namespace's queue sequentially
   */
  private async process(namespace: string): Promise<void> {
    this.processing.add(namespace);
    const queue = this.entries.get(namespace)!;

    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;

      const { memory, onStored, resolve, reject } = entry;

      try {
        const processed = await this.processEntry(memory, onStored);
        if (processed && !this.regeneratingNamespaces.has(memory.namespace)) {
          // Self-evolving: regenerate one stale memory per cycle
          // (fire-and-forget, deduped per namespace).
          const ns = memory.namespace;
          this.regeneratingNamespaces.add(ns);
          this.regenerateOneStale(ns)
            .catch((err: unknown) => console.error(`[Queue] Self-evolving maintenance error:`, err))
            .finally(() => this.regeneratingNamespaces.delete(ns));
        }
        resolve();
      } catch (error) {
        console.error(`[Queue] Error processing memory ${memory.id}:`, error);
        track("queue.error", {
          namespace: memory.namespace,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          meta: { memoryId: memory.id },
        });
        reject(error as Error);
      }
    }

    this.processing.delete(namespace);
  }

  /**
   * Process a single queued memory. Returns true if the memory was stored,
   * false if the pass was abandoned (e.g., file changed during extraction).
   *
   * Spec Decision #8 ordering invariant: snapshot the file's mtime before
   * extraction, re-stat before commit. If the file changed, abandon the pass —
   * do not write stale extraction to the graph or stamp indexedAt on edited content.
   */
  private async processEntry(
    memory: Memory,
    onStored?: (memory: Memory) => Promise<void>,
  ): Promise<boolean> {
    const ns = memory.namespace;
    const start = performance.now();

    const filePath = join(resolveNamespacePath(ns), `${memory.id}.md`);
    const snapshotMtime = safeMtimeMs(filePath);

    const entityCatalog = await this.graph.getEntityCatalog(ns);
    const { entities, edges, abstract, summary, category } = await extract(memory.text, entityCatalog);
    memory.abstract = abstract;
    memory.summary = summary;
    memory.category = category ?? "general";
    memory.schemaVersion = String(summarySchema.current);
    memory.versionedAt = new Date().toISOString();
    const extractMs = Math.round(performance.now() - start);

    if (!memory.name || memory.name === "") {
      const firstLine = summary.slice(0, 50).split("\n")[0];
      memory.name = firstLine ? firstLine.trim() : "Untitled Memory";
    }

    const embedStart = performance.now();
    const memEmb = await embedDual(memory.text);
    const edgeEmbeddings: EmbeddingMap[] = [];
    for (const edge of edges) {
      edgeEmbeddings.push(await embedDual(edge.fact));
    }
    const embedMs = Math.round(performance.now() - embedStart);

    if (isFileChangedSince(filePath, snapshotMtime)) {
      console.error(`[kb] File changed during indexing ${memory.id} — abandoning pass, retry on next sweep`);
      track("queue.abandoned", {
        namespace: ns,
        meta: { memoryId: memory.id, reason: "mtime-changed" },
      });
      return false;
    }

    const storeStart = performance.now();
    await this.graph.store(memory, entities, edges, memEmb, edgeEmbeddings);
    await onStored?.(memory);
    const storeMs = Math.round(performance.now() - storeStart);

    const totalMs = Math.round(performance.now() - start);
    console.error(`[kb] ${memory.name} → ${entities.length}E ${edges.length}R (${extractMs}ms extract, ${embedMs}ms embed, ${storeMs}ms store = ${totalMs}ms)`);

    track("queue.process", {
      namespace: ns,
      duration_ms: totalMs,
      meta: { memoryId: memory.id, entityCount: entities.length, edgeCount: edges.length, extractMs, embedMs, storeMs },
    });

    return true;
  }

  /**
   * Self-evolving: find one stale memory in this namespace and regenerate its
   * summary. Rewrites the source file's frontmatter FIRST (Spec Decision #11:
   * files are canonical), then the graph. If the file write fails, the graph
   * is left untouched — a subsequent sweep will retry against a consistent
   * starting state. Before the file write, we re-read from disk: the in-graph
   * memory.text may be stale relative to the current file body, and running
   * extraction on stale text would commit a regenerated summary that describes
   * content the user already edited away.
   *
   * Previously only the graph was updated, which meant db:reindex from files
   * silently dropped the regeneration — a filesystem-first invariant violation.
   */
  private async regenerateOneStale(namespace: string): Promise<void> {
    const memories = await this.graph.findMemories({ namespace }, 50);
    const staleMemory = memories.find((m) => {
      if (m.name === "__ns_rollup__") return false;
      const result = summarySchema.checkStaleness({
        schemaVersion: semver(m.schemaVersion || "0.0.0"),
        versionedAt: isoFrom(m.versionedAt || new Date(0).toISOString()),
      });
      return result.stale;
    });

    if (!staleMemory) return;

    const filePath = join(resolveNamespacePath(namespace), `${staleMemory.id}.md`);
    const currentFile = await readFileFromDiskForRegen(filePath);
    if (!currentFile) {
      // File was deleted or unreadable — nothing to regenerate against.
      // The stale graph memory will be cleaned up by Phase 2 reconciliation.
      return;
    }

    console.error(`[Queue] Regenerating stale memory ${staleMemory.id} (${staleMemory.name})...`);
    const { abstract: newAbstract, summary: newSummary } = await extract(currentFile.text);
    const schemaVersion = String(summarySchema.current);
    const versionedAt = new Date().toISOString();

    // Write the file first. If this throws, the graph remains untouched.
    try {
      writeRegeneratedFrontmatter(filePath, currentFile, {
        abstract: newAbstract,
        summary: newSummary,
        schemaVersion,
        versionedAt,
      });
    } catch (err) {
      console.error(`[Queue] File write-back failed for ${staleMemory.id}, abandoning regen:`, err);
      return;
    }

    await this.graph.updateMemorySummary(staleMemory.id, {
      abstract: newAbstract,
      summary: newSummary,
      schemaVersion,
      versionedAt,
    });
    track("queue.regenerate", {
      namespace,
      meta: { memoryId: staleMemory.id, reason: "self-evolving" },
    });
    console.error(`[Queue] Regenerated stale memory ${staleMemory.id}`);
  }

  /**
   * Get number of pending entries in queue
   * @param namespace - optional, return count for specific namespace
   */
  pending(namespace?: string): number {
    if (namespace) {
      return this.entries.get(namespace)?.length ?? 0;
    }
    return Array.from(this.entries.values()).reduce(
      (sum, q) => sum + q.length,
      0,
    );
  }
}
