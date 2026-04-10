#!/usr/bin/env bun
/**
 * Debug single-finding extraction to see the full Zod failure.
 * Prints the raw Ollama response AND the parse error verbatim.
 */

import { spawn } from "bun";
import { extract, extractionPrompt } from "../src/lib/extractor.ts";
import { Extraction } from "../src/types.ts";

const MODEL = process.env.EXTRACTION_MODEL ?? "gemma4:e4b";
const FINDING_ID = parseInt(process.env.FINDING ?? "141", 10);

interface RetroFinding {
  id: number;
  title: string;
  description: string;
  category: string;
  severity: string;
  proposed_fix: string | null;
}

function findingText(f: RetroFinding): string {
  const parts = [`[${f.category}/${f.severity}] ${f.title}`, f.description];
  if (f.proposed_fix) parts.push(`Fix: ${f.proposed_fix}`);
  return parts.join("\n\n");
}

async function main() {
  console.error(`[debug] model=${MODEL} finding=#${FINDING_ID}`);
  const proc = spawn({ cmd: ["retro", "list"], stdout: "pipe", stderr: "pipe" });
  const all: RetroFinding[] = JSON.parse(await new Response(proc.stdout).text());
  await proc.exited;
  const finding = all.find((f) => f.id === FINDING_ID);
  if (!finding) {
    console.error(`Finding #${FINDING_ID} not found`);
    process.exit(1);
  }
  console.error(`Title: ${finding.title}`);

  const prompt = extractionPrompt(findingText(finding)) +
    "\n\nRespond with ONLY valid JSON matching the schema. No markdown fencing, no explanation.";

  const resp = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      think: false,
      options: { temperature: 0.2, num_predict: 4096 },
    }),
  });

  if (!resp.ok) {
    console.error("Ollama error:", resp.status, await resp.text());
    process.exit(1);
  }

  const result = (await resp.json()) as { response: string };
  console.log("=== RAW OLLAMA RESPONSE ===");
  console.log(result.response);
  console.log("=== END RAW ===\n");

  // Try to parse
  let data: unknown = null;
  try { data = JSON.parse(result.response); } catch {}
  if (!data) {
    const fenced = result.response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenced) try { data = JSON.parse(fenced[1]!); } catch {}
  }
  if (!data) {
    const start = result.response.indexOf("{");
    const end = result.response.lastIndexOf("}");
    if (start >= 0 && end > start) try { data = JSON.parse(result.response.slice(start, end + 1)); } catch {}
  }

  if (!data) {
    console.error("[debug] JSON parse failed");
    process.exit(1);
  }

  console.log("=== PARSED JSON (top-level keys) ===");
  console.log(Object.keys(data as object));
  console.log();

  // Apply the existing extractor's coercion
  const validTypes = new Set(["person", "organization", "project", "technology", "concept"]);
  if (typeof data === "object" && data && "entities" in data && Array.isArray((data as { entities: unknown[] }).entities)) {
    const entities = (data as { entities: Array<{ name?: string; type?: string }> }).entities;
    console.log("=== ENTITY TYPES (before coercion) ===");
    for (const e of entities) console.log(`  ${e.name} → ${e.type}`);
    for (const entity of entities) {
      if (!entity.type || !validTypes.has(entity.type)) {
        console.log(`  COERCE: ${entity.name} "${entity.type ?? "missing"}" → "concept"`);
        entity.type = "concept";
      }
    }
  }

  console.log("\n=== ZOD VALIDATION (manual path) ===");
  try {
    const validated = Extraction.parse(data);
    console.log(`OK: ${validated.entities.length} entities, ${validated.edges.length} edges`);
  } catch (err) {
    if (err instanceof Error) {
      console.log("FAILED:");
      console.log(err.message);
    } else {
      console.log("FAILED (unknown):", err);
    }
  }

  console.log("\n=== PRODUCTION EXTRACTOR PATH ===");
  try {
    const result = await extract(findingText(finding));
    console.log(`OK: ${result.entities.length} entities, ${result.edges.length} edges`);
    for (const e of result.edges) {
      console.log(`  [${e.relationType}] ${e.fact}`);
    }
  } catch (err) {
    if (err instanceof Error) {
      console.log("FAILED:", err.message.slice(0, 300));
    } else {
      console.log("FAILED (unknown):", err);
    }
  }
}

main().catch((err) => {
  console.error("Debug failed:", err);
  process.exit(1);
});
