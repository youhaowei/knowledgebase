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

import { extract } from "./extractor.js";
import { embedDual } from "./embedder.js";
import type { GraphProvider } from "./graph-provider.js";
import type { Memory, EmbeddingMap } from "../types.js";
import { track } from "./analytics.js";
import { summarySchema } from "./versions.js";
import {
  semver,
  isoFrom,
} from "../../libs/wystack/packages/version/src/index";

type QueueEntry = {
  memory: Memory;
  resolve: () => void;
  reject: (e: Error) => void;
};

export class Queue {
  private entries: Map<string, QueueEntry[]> = new Map();
  private processing: Set<string> = new Set();
  private graph: GraphProvider;

  constructor(graph: GraphProvider) {
    this.graph = graph;
  }

  /**
   * Add a memory to the processing queue
   * Returns a promise that resolves when processing completes
   */
  async add(memory: Memory): Promise<void> {
    return new Promise((resolve, reject) => {
      const ns = memory.namespace;

      if (!this.entries.has(ns)) {
        this.entries.set(ns, []);
      }

      this.entries.get(ns)!.push({ memory, resolve, reject });

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

      const { memory, resolve, reject } = entry;

      try {
        const ns = memory.namespace;

        // 1. Extract entities and edges using Claude/Gemini (Edge-as-Fact model)
        console.error(`[Queue] Extracting entities and edges from memory ${memory.id}...`);
        const extractStart = performance.now();
        const { entities, edges, abstract, summary, category } = await extract(memory.text);
        memory.abstract = abstract;
        memory.summary = summary;
        memory.category = category ?? "general";
        memory.schemaVersion = String(summarySchema.current);
        memory.versionedAt = new Date().toISOString();
        track("queue.extract", {
          namespace: ns,
          duration_ms: performance.now() - extractStart,
          meta: { memoryId: memory.id, entityCount: entities.length, edgeCount: edges.length, category: memory.category },
        });

        console.error(`[Queue] Extracted ${entities.length} entities, ${edges.length} edges`);

        // 2. Auto-generate name from summary if not provided
        if (!memory.name || memory.name === "") {
          // Take first 50 chars of summary, or first line
          const firstLine = summary.slice(0, 50).split("\n")[0];
          memory.name = firstLine ? firstLine.trim() : "Untitled Memory";
        }

        // 3. Generate dual embeddings for memory text (all available dimensions)
        console.error(`[Queue] Generating memory embeddings (dual)...`);
        const embedStart = performance.now();
        const memEmb = await embedDual(memory.text);

        // 4. Generate dual embeddings for each edge's fact description
        console.error(`[Queue] Generating embeddings for ${edges.length} edge facts...`);
        const edgeEmbeddings: EmbeddingMap[] = [];
        for (const edge of edges) {
          edgeEmbeddings.push(await embedDual(edge.fact));
        }
        const embedDuration = performance.now() - embedStart;
        const dimensions = memEmb.size > 0 ? [...memEmb.keys()] : [];
        track("queue.embed", {
          namespace: ns,
          duration_ms: embedDuration,
          meta: { memoryId: memory.id, edgeCount: edges.length, dimensions },
        });

        // 5. Store everything (entities + RELATES_TO edges) with all embedding dimensions
        console.error(`[Queue] Storing...`);
        const storeStart = performance.now();
        await this.graph.store(memory, entities, edges, memEmb, edgeEmbeddings);
        track("queue.store", {
          namespace: ns,
          duration_ms: performance.now() - storeStart,
          meta: { memoryId: memory.id, entityCount: entities.length, edgeCount: edges.length },
        });

        console.error(`[Queue] Memory ${memory.id} processed successfully`);

        // 6. Self-evolving: regenerate one stale memory per cycle (fire-and-forget)
        this.regenerateOneStale(ns).catch((err: unknown) =>
          console.error(`[Queue] Self-evolving maintenance error:`, err),
        );

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
   * Self-evolving: find one stale memory in this namespace and regenerate its summary.
   * Checks version lag, then time-based staleness. Processes at most one per call.
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

    console.error(`[Queue] Regenerating stale memory ${staleMemory.id} (${staleMemory.name})...`);
    const { abstract: newAbstract, summary: newSummary } = await extract(staleMemory.text);
    await this.graph.updateMemorySummary(staleMemory.id, {
      abstract: newAbstract,
      summary: newSummary,
      schemaVersion: String(summarySchema.current),
      versionedAt: new Date().toISOString(),
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
