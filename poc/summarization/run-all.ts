import { existsSync, mkdirSync } from "fs";
import { join } from "path";

const RESULTS_DIR = join(import.meta.dir, "results");
const SCRIPTS = ["a-ast", "b-llm", "c-hybrid", "d-rollup"] as const;
const SAMPLE_FILES = ["errors.ts", "queue.ts", "ladybug-provider.ts"];

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

// Run each script sequentially
for (const script of SCRIPTS) {
  console.error(`\n${"=".repeat(50)}`);
  console.error(`Running ${script}...`);
  console.error("=".repeat(50));

  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, `${script}.ts`)], {
    stdout: "inherit",
    stderr: "inherit",
    cwd: process.cwd(),
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    console.error(`\n✗ ${script} failed with exit code ${proc.exitCode}`);
    process.exit(1);
  }
  console.error(`✓ ${script} done`);
}

// Generate comparison report
console.error(`\n${"=".repeat(50)}`);
console.error("Generating comparison report...");
console.error("=".repeat(50));

function extractSection(content: string, filename: string): string {
  const marker = `## ${filename}`;
  const start = content.indexOf(marker);
  if (start < 0) return "(not found)";
  const afterHeader = content.indexOf("\n", start) + 1;
  const nextSection = content.indexOf("\n## ", afterHeader);
  const section = nextSection > 0
    ? content.slice(afterHeader, nextSection).trim()
    : content.slice(afterHeader).trim();
  // Strip leading metadata line
  const lines = section.split("\n");
  const contentStart = lines.findIndex((l, i) => i > 0 && !l.startsWith("_") && l.trim());
  if (contentStart > 0) return lines.slice(contentStart).join("\n").trim();
  return lines.slice(1).join("\n").trim();
}

const results: Record<string, string> = {};
for (const script of ["a-ast", "b-llm", "c-hybrid"] as const) {
  const path = join(RESULTS_DIR, `${script}.md`);
  if (existsSync(path)) results[script] = await Bun.file(path).text();
}

const comparison: string[] = [`# Summarization POC: Side-by-Side Comparison\n`];

for (const sample of SAMPLE_FILES) {
  comparison.push(`## ${sample}\n`);
  for (const [key, label] of [
    ["a-ast", "A: AST Skeleton"],
    ["b-llm", "B: LLM Summary"],
    ["c-hybrid", "C: Hybrid (AST→LLM)"],
  ] as const) {
    const content = results[key];
    if (!content) continue;
    const section = extractSection(content, sample);
    comparison.push(`### ${label}\n\n${section}\n`);
  }
}

// Add D rollup
const dPath = join(RESULTS_DIR, "d-rollup.md");
if (existsSync(dPath)) {
  const dContent = await Bun.file(dPath).text();
  comparison.push(`## Directory Rollup (L0/L1)\n\n${dContent}`);
}

Bun.write(join(RESULTS_DIR, "comparison.md"), comparison.join("\n"));
console.error(`\n✓ Comparison report written to ${join(RESULTS_DIR, "comparison.md")}`);
