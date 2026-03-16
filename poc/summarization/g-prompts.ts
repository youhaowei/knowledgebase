/**
 * G: Prompt variations — tests 3 different prompt styles on the same files
 * to find the optimal summarization prompt.
 *
 * Styles:
 *   1. Terse (1-2 sentences, maximum density)
 *   2. Structured (bullet points with fixed sections)
 *   3. Contextual (role-aware, asks "why would someone read this?")
 */
import { writeResult, summarizeWithLLM } from "./shared";
import { resolve } from "path";

const PROMPTS = {
  terse: `Summarize this file in 1-2 sentences. Be maximally information-dense.
Include: primary purpose, key exports, and one notable design decision.
Example: "Dual-mode embedder (Ollama 2560-dim primary, transformers.js 384-dim fallback) exposing embed(), embedDual(), and getActiveDimension(). Falls back gracefully when Ollama is unavailable."
Output ONLY the summary.`,

  structured: `Summarize this file using exactly this format:

**Purpose:** [One sentence — what this file does]
**Key API:** [Comma-separated list of main exports/functions]
**Dependencies:** [External imports that matter]
**Pattern:** [One sentence — the main design pattern or architectural decision]`,

  contextual: `You are helping a developer who has never seen this codebase decide whether to read this file.
Answer: "When would I need this file, and what would I find in it?"
Write 2-3 sentences from the perspective of someone navigating the codebase.
Be specific about what problems this file solves.`,
};

// Representative files spanning different sizes and types
const TEST_FILES = [
  "src/lib/errors.ts",           // tiny (6 lines)
  "src/lib/queue.ts",            // medium (150 lines)
  "src/lib/embedder.ts",         // medium (185 lines)
  "src/lib/operations.ts",       // medium (205 lines)
  "src/lib/ladybug-provider.ts", // large (1379 lines)
];

const sections: string[] = [`# G: Prompt Variations\n`];
const metrics: { file: string; prompt: string; ms: number; chars: number }[] = [];

for (const relPath of TEST_FILES) {
  const fullPath = resolve(relPath);
  const file = Bun.file(fullPath);
  if (!(await file.exists())) {
    console.error(`  Skipping ${relPath} — not found`);
    continue;
  }

  const content = await file.text();
  const filename = relPath.split("/").pop()!;
  const lines = content.split("\n").length;
  // Truncate for very large files
  const truncated = content.length > 30000 ? content.slice(0, 30000) + "\n...(truncated)" : content;

  console.error(`\n--- ${filename} (${lines} lines) ---`);
  sections.push(`## ${filename} (${lines} lines)\n`);

  for (const [style, systemPrompt] of Object.entries(PROMPTS)) {
    const { text, elapsedMs } = await summarizeWithLLM(
      systemPrompt,
      `File: ${filename} (${lines} lines)\n\n${truncated}`,
    );

    metrics.push({ file: filename, prompt: style, ms: elapsedMs, chars: text.length });
    sections.push(`### ${style}\n_(${elapsedMs}ms, ${text.length} chars output)_\n\n${text}\n`);
    console.error(`  ✓ ${style} (${elapsedMs}ms, ${text.length} chars)`);
  }
}

// Metrics summary
sections.push(`## Metrics Summary\n`);
sections.push("| File | Prompt | Time (ms) | Output (chars) |");
sections.push("|------|--------|-----------|----------------|");
for (const m of metrics) {
  sections.push(`| ${m.file} | ${m.prompt} | ${m.ms} | ${m.chars} |`);
}

// Averages per prompt style
sections.push("\n**Averages per prompt style:**\n");
for (const style of Object.keys(PROMPTS)) {
  const styleMetrics = metrics.filter((m) => m.prompt === style);
  const avgMs = Math.round(styleMetrics.reduce((s, m) => s + m.ms, 0) / styleMetrics.length);
  const avgChars = Math.round(
    styleMetrics.reduce((s, m) => s + m.chars, 0) / styleMetrics.length,
  );
  sections.push(`- **${style}**: ${avgMs}ms avg, ${avgChars} chars avg output`);
}

writeResult("g-prompts", sections.join("\n"));
