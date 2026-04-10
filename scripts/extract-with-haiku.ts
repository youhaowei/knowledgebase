#!/usr/bin/env bun
/**
 * Extract edges from cc-retro corpus using Claude Haiku 4.5 via unifai.
 *
 * Uses the existing extraction prompt but routes through unifai's `prompt()`
 * function with `model: "haiku"`. Unifai wraps Anthropic's Claude Agent SDK
 * and uses OAuth subscription, so there's no API billing — same free-tier
 * story as the existing askLLM path in src/server/functions.ts.
 *
 * Expected to be DRAMATICALLY faster than local Ollama extractions because
 * Anthropic's inference infra is vastly more optimized than running a 4B
 * model on a laptop. Target: ~2-4 min for 30 findings (vs ~20 min for gemma4:e4b).
 */

import { spawn } from "bun";
import { prompt } from "unifai";
import { extractionPrompt, coerceExtractionShape, parseJsonFromText } from "../src/lib/extractor.ts";
import { Extraction } from "../src/types.ts";

const SAMPLE_SIZE = parseInt(process.env.SAMPLE ?? "30", 10);
const CACHE_FILE = `/tmp/retro-edges-haiku-sample-${SAMPLE_SIZE}.json`;

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

async function loadCorpus(): Promise<RetroFinding[]> {
  const proc = spawn({ cmd: ["retro", "list"], stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const all: RetroFinding[] = JSON.parse(output);
  return all.filter((f) => !isTestEntry(f));
}

async function extractOne(text: string): Promise<{ entities: Array<{ name: string; type: string }>; edges: Array<{ relationType: string; sourceIndex: number; targetIndex: number; fact: string; sentiment: number }>; ms: number }> {
  const message = extractionPrompt(text) +
    "\n\nRespond with ONLY valid JSON matching the schema. No markdown fencing, no explanation.";

  const t0 = performance.now();
  const result = await prompt("claude", message, {
    model: "haiku",
    maxTurns: 1,
    allowedTools: [],
    // Unset CLAUDECODE to let the Claude Agent SDK spawn a nested session.
    // Without this, the SDK refuses to launch because it detects this script
    // is already running inside a Claude Code session.
    env: { ...process.env, CLAUDECODE: undefined },
  });
  const ms = performance.now() - t0;

  const parsed = parseJsonFromText(result.text);
  if (!parsed) {
    throw new Error(`Could not parse JSON from Haiku response: ${result.text.slice(0, 200)}`);
  }

  coerceExtractionShape(parsed);
  const validated = Extraction.parse(parsed);
  return { entities: validated.entities, edges: validated.edges, ms };
}

async function main() {
  // Cache hit?
  try {
    const cached = await Bun.file(CACHE_FILE).json();
    if (Array.isArray(cached) && cached.length > 0) {
      console.error(`Cache hit: ${cached.length} edges in ${CACHE_FILE}, skipping`);
      process.exit(0);
    }
  } catch { /* no cache */ }

  console.error("Loading cc-retro corpus...");
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
      const result = await extractOne(findingText(f));
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
      console.error(`${progress} #${f.id} → ${result.edges.length} edges (${(result.ms / 1000).toFixed(1)}s): ${f.title.slice(0, 55)}`);

      // Incremental cache save — remote API calls are valuable, don't lose them on crash
      await Bun.write(CACHE_FILE, JSON.stringify(edges, null, 2));
    } catch (err) {
      failed++;
      console.error(`${progress} #${f.id} FAILED: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
    }
  }

  const totalMs = Math.round(performance.now() - start);
  console.error(`\nDone: ${edges.length} edges from ${succeeded}/${sample.length} findings (${failed} failures) in ${(totalMs / 1000).toFixed(1)}s`);
  console.error(`Avg ${(totalMs / sample.length / 1000).toFixed(1)}s/finding, ${(edges.length / Math.max(succeeded, 1)).toFixed(1)} edges/finding`);
  console.error(`Cached to ${CACHE_FILE}`);
}

main().catch((err) => {
  console.error("Extraction failed:", err);
  process.exit(1);
});
