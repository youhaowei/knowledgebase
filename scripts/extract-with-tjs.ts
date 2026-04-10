#!/usr/bin/env bun
/**
 * Extract edges from cc-retro corpus using transformers.js + Gemma 4 E4B
 * (in-process, no Ollama daemon).
 *
 * Loads the model ONCE then iterates over findings, caching output to a JSON
 * file the rerank benchmark can consume. CPU-bound on Bun: expect ~3-5
 * minutes per finding for Gemma 4 E4B at q4f16.
 *
 * Usage:
 *   bun run scripts/extract-with-tjs.ts
 *   SAMPLE=10 bun run scripts/extract-with-tjs.ts  (smaller sample for iteration)
 */

import { spawn } from "bun";
import { AutoProcessor, AutoModelForCausalLM, type Tensor } from "@huggingface/transformers";
import { extractionPrompt } from "../src/lib/extractor.ts";
import { Extraction } from "../src/types.ts";

const MODEL_ID = "onnx-community/gemma-4-E4B-it-ONNX";
const SAMPLE_SIZE = parseInt(process.env.SAMPLE ?? "30", 10);
const CACHE_FILE = `/tmp/retro-edges-gemma4-e4b-tjs-sample-${SAMPLE_SIZE}.json`;

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

// Normalize JSON keys to lowercase recursively. Gemma 4 sometimes uppercases
// top-level keys (ENTITIES, EDGES) which the Zod schema rejects.
function lowercaseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(lowercaseKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k.toLowerCase()] = lowercaseKeys(v);
    }
    return out;
  }
  return value;
}

function parseJsonFromText(text: string): Record<string, unknown> | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      const lowered = lowercaseKeys(parsed);
      if (typeof lowered === "object" && lowered !== null) return lowered as Record<string, unknown>;
    } catch {}
    return null;
  };

  let result = tryParse(text);
  if (result) return result;

  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) {
    result = tryParse(fenced[1]!);
    if (result) return result;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    result = tryParse(text.slice(start, end + 1));
    if (result) return result;
  }
  return null;
}

interface LoadedModel {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any;
}

async function loadModel(): Promise<LoadedModel> {
  console.error(`[tjs] loading ${MODEL_ID}...`);
  const t0 = performance.now();
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, { dtype: "q4f16" });
  console.error(`[tjs] loaded in ${(performance.now() - t0).toFixed(0)}ms\n`);
  return { processor, model };
}

async function extractOne(
  text: string,
  loaded: LoadedModel,
): Promise<{ entities: Array<{ name: string; type: string }>; edges: Array<{ relationType: string; sourceIndex: number; targetIndex: number; fact: string; sentiment: number }>; ms: number }> {
  const prompt = extractionPrompt(text) +
    "\n\nRespond with ONLY valid JSON matching the schema. No markdown fencing, no explanation.";
  const messages = [{ role: "user", content: prompt }];
  const chatTemplate = loaded.processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await loaded.processor(chatTemplate);
  const inputLen = (inputs.input_ids as Tensor).dims.at(-1) as number;

  const t0 = performance.now();
  const outputs = (await loaded.model.generate({
    ...inputs,
    max_new_tokens: 2048,
    do_sample: false,
  })) as Tensor;
  const ms = performance.now() - t0;

  const newTokenSlice = outputs.slice(null, [inputLen, null]);
  const decoded = loaded.processor.batch_decode(newTokenSlice, { skip_special_tokens: true });
  const responseText = decoded[0] as string;

  const parsed = parseJsonFromText(responseText);
  if (!parsed) {
    throw new Error(`Could not parse JSON from response: ${responseText.slice(0, 200)}`);
  }

  // Coerce invalid entity types to "concept"
  const validTypes = new Set(["person", "organization", "project", "technology", "concept"]);
  if (parsed && "entities" in parsed && Array.isArray(parsed.entities)) {
    for (const entity of parsed.entities as Array<{ type?: string }>) {
      if (entity.type && !validTypes.has(entity.type)) entity.type = "concept";
    }
  }
  // Drop unknown top-level fields Zod doesn't expect
  const cleaned: Record<string, unknown> = {
    entities: parsed.entities ?? [],
    edges: parsed.edges ?? [],
  };
  if ("abstract" in parsed) cleaned.abstract = parsed.abstract;
  if ("summary" in parsed) cleaned.summary = parsed.summary;
  if ("category" in parsed) cleaned.category = parsed.category;

  const validated = Extraction.parse(cleaned);
  return { entities: validated.entities, edges: validated.edges, ms };
}

async function main() {
  // Cache hit?
  try {
    const cached = await Bun.file(CACHE_FILE).json();
    if (Array.isArray(cached) && cached.length > 0) {
      console.error(`[tjs] cache hit: ${cached.length} edges in ${CACHE_FILE}, skipping`);
      process.exit(0);
    }
  } catch {}

  const loaded = await loadModel();
  const all = await loadCorpus();
  const sample = [...all].sort((a, b) => b.id - a.id).slice(0, SAMPLE_SIZE);
  console.error(`[tjs] sampled ${sample.length} most-recent findings\n`);

  const edges: ExtractedEdge[] = [];
  let succeeded = 0, failed = 0;
  const start = performance.now();

  for (let i = 0; i < sample.length; i++) {
    const f = sample[i]!;
    const progress = `[${i + 1}/${sample.length}]`;
    try {
      const result = await extractOne(findingText(f), loaded);
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
      console.error(`${progress} #${f.id} → ${result.edges.length} edges (${(result.ms / 1000).toFixed(0)}s): ${f.title.slice(0, 55)}`);

      // Incremental cache save in case of crash mid-run
      await Bun.write(CACHE_FILE, JSON.stringify(edges, null, 2));
    } catch (err) {
      failed++;
      console.error(`${progress} #${f.id} FAILED: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
    }
  }

  const totalMs = Math.round(performance.now() - start);
  console.error(`\n[tjs] done: ${edges.length} edges from ${succeeded}/${sample.length} findings (${failed} failures) in ${(totalMs / 1000 / 60).toFixed(1)} min`);
  console.error(`[tjs] avg ${(totalMs / sample.length / 1000).toFixed(0)}s/finding, ${(edges.length / Math.max(succeeded, 1)).toFixed(1)} edges/finding`);
  console.error(`[tjs] cached to ${CACHE_FILE}`);
}

main().catch((err) => {
  console.error("Extraction failed:", err);
  process.exit(1);
});
