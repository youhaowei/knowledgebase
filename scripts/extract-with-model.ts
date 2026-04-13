#!/usr/bin/env bun
/**
 * Extract edges from cc-retro corpus using a specified LLM.
 * Caches output per-model so the rerank benchmark can be run repeatedly
 * against the same extracted edges without re-extracting.
 *
 * Usage:
 *   EXTRACTION_MODEL=gemma3:4b bun run scripts/extract-with-model.ts
 *   EXTRACTION_MODEL=qwen3:1.7b bun run scripts/extract-with-model.ts
 */

import { spawn } from "bun";
import { extract } from "../src/lib/extractor.ts";

interface RetroFinding {
  id: number;
  title: string;
  description: string;
  category: string;
  severity: string;
  proposed_fix: string | null;
}

interface ExtractedEdge {
  edgeId: string;
  findingId: number;
  fact: string;
  relationType: string;
  source: string;
  target: string;
}

const SAMPLE_SIZE = parseInt(process.env.SAMPLE ?? "30", 10);
// Default tracks the extractor benchmark result (see scripts/README.md):
// gemma4:e4b replaced qwen3.5 across all metrics. Pass EXTRACTION_MODEL
// to reproduce historical qwen3.5 runs.
const MODEL = process.env.EXTRACTION_MODEL ?? "gemma4:e4b";
const CACHE_FILE = `/tmp/retro-edges-${MODEL.replace(/[:/]/g, "-")}-sample-${SAMPLE_SIZE}.json`;

function isTestEntry(f: RetroFinding): boolean {
  const t = f.title.toLowerCase();
  const d = f.description.trim().toLowerCase();
  return t.startsWith("test") || t.includes("sandbox") || t.includes("delete me") ||
         d === "test" || d === "updated desc" || d === "a test finding for dashboard" ||
         d === "this should show as draft";
}

function findingText(f: RetroFinding): string {
  const parts = [`[${f.category}/${f.severity}] ${f.title}`, f.description];
  if (f.proposed_fix) parts.push(`Fix: ${f.proposed_fix}`);
  return parts.join("\n\n");
}

async function loadCachedEdges(): Promise<ExtractedEdge[] | null> {
  const file = Bun.file(CACHE_FILE);
  if (!(await file.exists())) return null;

  try {
    const cached = await file.json();
    return Array.isArray(cached) ? (cached as ExtractedEdge[]) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Ignoring unreadable cache file ${CACHE_FILE}: ${message}`);
    return null;
  }
}

async function loadCorpus(): Promise<RetroFinding[]> {
  const proc = spawn({ cmd: ["retro", "list"], stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const all: RetroFinding[] = JSON.parse(output);
  return all.filter((f) => !isTestEntry(f));
}

async function main() {
  console.error(`Extraction model: ${MODEL}`);
  console.error(`Sample size: ${SAMPLE_SIZE}`);
  console.error(`Cache file: ${CACHE_FILE}\n`);

  const cached = await loadCachedEdges();
  if (cached && cached.length > 0) {
    console.error(`Cache hit: ${cached.length} edges already extracted, skipping`);
    process.exit(0);
  }

  const all = await loadCorpus();
  const sample = [...all].sort((a, b) => b.id - a.id).slice(0, SAMPLE_SIZE);
  console.error(`Sampled ${sample.length} most-recent findings\n`);

  const edges: ExtractedEdge[] = [];
  let succeeded = 0, failed = 0;
  const start = performance.now();

  for (let i = 0; i < sample.length; i++) {
    const f = sample[i]!;
    const progress = `[${i + 1}/${sample.length}]`;
    try {
      const fStart = performance.now();
      const result = await extract(findingText(f));
      const fMs = Math.round(performance.now() - fStart);
      for (let j = 0; j < result.edges.length; j++) {
        const e = result.edges[j]!;
        const src = result.entities[e.sourceIndex];
        const tgt = result.entities[e.targetIndex];
        if (!src || !tgt) continue;
        edges.push({
          edgeId: `${f.id}-${j}`,
          findingId: f.id,
          fact: e.fact,
          relationType: e.relationType,
          source: src.name,
          target: tgt.name,
        });
      }
      succeeded++;
      console.error(`${progress} #${f.id} → ${result.edges.length} edges (${fMs}ms): ${f.title.slice(0, 55)}`);
    } catch (err) {
      failed++;
      console.error(`${progress} #${f.id} FAILED: ${err instanceof Error ? err.message.slice(0, 80) : err}`);
    }
  }

  const totalMs = Math.round(performance.now() - start);
  console.error(`\nDone: ${edges.length} edges from ${succeeded}/${sample.length} findings (${failed} failures) in ${(totalMs / 1000).toFixed(1)}s`);
  console.error(`Avg ${(totalMs / sample.length).toFixed(0)}ms/finding, ${(edges.length / Math.max(succeeded, 1)).toFixed(1)} edges/finding`);

  await Bun.write(CACHE_FILE, JSON.stringify(edges, null, 2));
  console.error(`Cached to ${CACHE_FILE}`);
}

main().catch((err) => {
  console.error("Extraction failed:", err);
  process.exit(1);
});
