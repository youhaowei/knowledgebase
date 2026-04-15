#!/usr/bin/env bun
/**
 * Debug single-finding extraction to see the full Zod failure.
 * Prints the raw Ollama response AND the parse error verbatim.
 */

import { spawn } from "bun";
import { extract, extractionPrompt, parseJsonFromText } from "../src/lib/extractor.ts";
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

type ParsedExtraction = {
  entities?: Array<{ name?: string; type?: string }>;
};

const VALID_ENTITY_TYPES = new Set([
  "person",
  "organization",
  "project",
  "technology",
  "concept",
]);

function findingText(f: RetroFinding): string {
  const parts = [`[${f.category}/${f.severity}] ${f.title}`, f.description];
  if (f.proposed_fix) parts.push(`Fix: ${f.proposed_fix}`);
  return parts.join("\n\n");
}

async function loadFinding(): Promise<RetroFinding> {
  const proc = spawn({ cmd: ["retro", "list"], stdout: "pipe", stderr: "pipe" });
  const all: RetroFinding[] = JSON.parse(await new Response(proc.stdout).text());
  await proc.exited;

  const finding = all.find((entry) => entry.id === FINDING_ID);
  if (!finding) {
    console.error(`Finding #${FINDING_ID} not found`);
    process.exit(1);
  }
  return finding;
}

async function fetchRawResponse(finding: RetroFinding): Promise<string> {
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
  return result.response;
}

function logEntityTypes(data: ParsedExtraction): void {
  if (!Array.isArray(data.entities)) return;

  console.log("=== ENTITY TYPES (before coercion) ===");
  for (const entity of data.entities) {
    console.log(`  ${entity.name} → ${entity.type}`);
  }
}

function coerceEntityTypes(data: ParsedExtraction): void {
  if (!Array.isArray(data.entities)) return;

  for (const entity of data.entities) {
    if (entity.type && VALID_ENTITY_TYPES.has(entity.type)) continue;

    console.log(`  COERCE: ${entity.name} "${entity.type ?? "missing"}" → "concept"`);
    entity.type = "concept";
  }
}

function logManualValidation(data: unknown): void {
  console.log("\n=== ZOD VALIDATION (manual path) ===");
  try {
    const validated = Extraction.parse(data);
    console.log(`OK: ${validated.entities.length} entities, ${validated.edges.length} edges`);
  } catch (err) {
    if (err instanceof Error) {
      console.log("FAILED:");
      console.log(err.message);
      return;
    }
    console.log("FAILED (unknown):", err);
  }
}

async function logProductionValidation(finding: RetroFinding): Promise<void> {
  console.log("\n=== PRODUCTION EXTRACTOR PATH ===");
  try {
    const result = await extract(findingText(finding));
    console.log(`OK: ${result.entities.length} entities, ${result.edges.length} edges`);
    for (const edge of result.edges) {
      console.log(`  [${edge.relationType}] ${edge.fact}`);
    }
  } catch (err) {
    if (err instanceof Error) {
      console.log("FAILED:", err.message.slice(0, 300));
      return;
    }
    console.log("FAILED (unknown):", err);
  }
}

async function main() {
  console.error(`[debug] model=${MODEL} finding=#${FINDING_ID}`);
  const finding = await loadFinding();
  console.error(`Title: ${finding.title}`);

  const responseText = await fetchRawResponse(finding);
  console.log("=== RAW OLLAMA RESPONSE ===");
  console.log(responseText);
  console.log("=== END RAW ===\n");

  const data = parseJsonFromText(responseText) as ParsedExtraction | null;
  if (!data) {
    console.error("[debug] JSON parse failed");
    process.exit(1);
  }

  console.log("=== PARSED JSON (top-level keys) ===");
  console.log(Object.keys(data as object));
  console.log();

  logEntityTypes(data);
  coerceEntityTypes(data);
  logManualValidation(data);
  await logProductionValidation(finding);
}

main().catch((err) => {
  console.error("Debug failed:", err);
  process.exit(1);
});
