/**
 * Async Queue Processor
 *
 * Processes memories asynchronously in background:
 * 1. Extract items & relations (Claude)
 * 2. Generate embeddings (Ollama)
 * 3. Store in Neo4j (with conflict detection at read time)
 *
 * Per-namespace queues to avoid race conditions
 */

import { extract } from "./extractor.js";
import { embed } from "./embedder.js";
import { Graph } from "./graph.js";
import type { Memory } from "../types.js";

type QueueEntry = {
  memory: Memory;
  resolve: () => void;
  reject: (e: Error) => void;
};

export class Queue {
  private entries: Map<string, QueueEntry[]> = new Map();
  private processing: Set<string> = new Set();
  private graph: Graph;

  constructor(graph: Graph) {
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
        // 1. Extract items and relations using Claude
        const { items, relations, summary } = await extract(memory.text);
        memory.summary = summary;

        // 2. Auto-generate name from summary if not provided
        if (!memory.name || memory.name === "") {
          // Take first 50 chars of summary, or first line
          const firstLine = summary.slice(0, 50).split("\n")[0];
          memory.name = firstLine ? firstLine.trim() : "Untitled Memory";
        }

        // 3. Generate embedding using Ollama
        const embedding = await embed(memory.text);

        // 4. Store everything (conflicts detected at read time, not here)
        await this.graph.store(memory, items, relations, embedding);

        resolve();
      } catch (error) {
        reject(error as Error);
      }
    }

    this.processing.delete(namespace);
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
