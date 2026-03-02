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
import type { Memory } from "../types.js";

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
        // 1. Extract entities and edges using Claude/Gemini (Edge-as-Fact model)
        console.error(`[Queue] Extracting entities and edges from memory ${memory.id}...`);
        const { entities, edges, summary } = await extract(memory.text);
        memory.summary = summary;

        console.error(`[Queue] Extracted ${entities.length} entities, ${edges.length} edges`);

        // 2. Auto-generate name from summary if not provided
        if (!memory.name || memory.name === "") {
          // Take first 50 chars of summary, or first line
          const firstLine = summary.slice(0, 50).split("\n")[0];
          memory.name = firstLine ? firstLine.trim() : "Untitled Memory";
        }

        // 3. Generate dual embeddings for memory text (Ollama 2560-dim + fallback 384-dim)
        console.error(`[Queue] Generating memory embeddings (dual)...`);
        const memEmb = await embedDual(memory.text);

        // 4. Generate dual embeddings for each edge's fact description
        console.error(`[Queue] Generating embeddings for ${edges.length} edge facts...`);
        const edgeEmbeddings: number[][] = [];
        const edgeEmbeddings384: number[][] = [];
        for (const edge of edges) {
          const edgeEmb = await embedDual(edge.fact);
          edgeEmbeddings.push(edgeEmb.ollama);
          edgeEmbeddings384.push(edgeEmb.fallback);
        }

        // 5. Store everything (entities + RELATES_TO edges) with both embedding dimensions
        console.error(`[Queue] Storing...`);
        await this.graph.store(
          memory, entities, edges,
          memEmb.ollama, edgeEmbeddings,
          memEmb.fallback, edgeEmbeddings384,
        );

        console.error(`[Queue] Memory ${memory.id} processed successfully`);
        resolve();
      } catch (error) {
        console.error(`[Queue] Error processing memory ${memory.id}:`, error);
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
