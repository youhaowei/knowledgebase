/**
 * H: Edge cases — extreme file sizes, generated code, type definitions.
 *
 * Tests:
 *   1. Very large file (cli.ts, 12K+ lines) — truncation handling
 *   2. Very small file (errors.ts, 6 lines) — minimal content
 *   3. Generated file (routeTree.gen.ts) — machine-generated code
 *   4. Type definition (.d.ts) — declarations only
 *   5. Mixed JSX + logic (CommandPalette.tsx, 646 lines)
 */
import { writeResult, summarizeWithLLM } from "./shared";
import { extractSkeleton } from "./a-ast";
import { resolve, basename } from "path";

const SYSTEM = `You are summarizing a source file for a code knowledge base.
Produce a 3-5 sentence summary covering what this file does, key exports, and notable patterns.
Be specific — mention actual names. No generic filler.`;

const EDGE_CASES = [
  { path: "src/cli.ts", label: "very-large (12K+ lines)", truncateAt: 30000 },
  { path: "src/lib/errors.ts", label: "very-small (6 lines)" },
  { path: "src/routeTree.gen.ts", label: "generated code" },
  { path: "src/lib/lbug.d.ts", label: "type definitions (.d.ts)" },
  { path: "src/web/components/CommandPalette.tsx", label: "large React/TSX component" },
  { path: "src/vite-env.d.ts", label: "tiny type shim" },
];

const sections: string[] = [`# H: Edge Cases\n`];

for (const { path: relPath, label, truncateAt } of EDGE_CASES) {
  const fullPath = resolve(relPath);
  const file = Bun.file(fullPath);
  if (!(await file.exists())) {
    console.error(`  Skipping ${relPath} — not found`);
    continue;
  }

  const content = await file.text();
  const filename = basename(relPath);
  const lines = content.split("\n").length;

  console.error(`\n--- ${filename} [${label}] (${lines} lines, ${content.length} chars) ---`);
  sections.push(`## ${filename} — ${label}\n\n_${lines} lines, ${content.length} chars_\n`);

  // AST skeleton
  const skeleton = extractSkeleton(filename, content);
  const skeletonRatio = ((skeleton.length / content.length) * 100).toFixed(1);
  sections.push(
    `### AST Skeleton\n_${skeleton.length} chars (${skeletonRatio}% of original)_\n\n\`\`\`\n${skeleton.slice(0, 2000)}${skeleton.length > 2000 ? "\n...(truncated for display)" : ""}\n\`\`\`\n`,
  );
  console.error(`  AST: ${skeleton.length} chars (${skeletonRatio}%)`);

  // Hybrid (AST → LLM)
  const { text: hybridText, elapsedMs: hybridMs } = await summarizeWithLLM(
    SYSTEM,
    `File: ${filename} (${lines} lines)\n\n${skeleton.slice(0, 15000)}`,
  );
  sections.push(`### Hybrid (AST→LLM) _(${hybridMs}ms)_\n\n${hybridText}\n`);
  console.error(`  Hybrid: ${hybridMs}ms`);

  // Full LLM (with truncation for large files)
  const maxChars = truncateAt || 30000;
  const truncated =
    content.length > maxChars ? content.slice(0, maxChars) + "\n...(truncated)" : content;
  const { text: llmText, elapsedMs: llmMs } = await summarizeWithLLM(
    SYSTEM,
    `File: ${filename} (${lines} lines)\n\n${truncated}`,
  );
  const truncNote = content.length > maxChars ? ` (truncated to ${maxChars} chars)` : "";
  sections.push(`### Full LLM _(${llmMs}ms${truncNote})_\n\n${llmText}\n`);
  console.error(`  Full LLM: ${llmMs}ms${truncNote}`);

  // Analysis notes
  const notes: string[] = [];
  if (lines < 10) notes.push("Very small file — skeleton may be as large as source");
  if (lines > 1000) notes.push(`Large file — skeleton compression ${skeletonRatio}%`);
  if (filename.endsWith(".gen.ts")) notes.push("Generated file — should these be summarized?");
  if (filename.endsWith(".d.ts")) notes.push("Type-only file — AST captures everything");
  if (filename.endsWith(".tsx")) notes.push("JSX file — AST misses template structure");

  if (notes.length) {
    const noteList = notes.map((note) => `- ${note}`).join("\n");
    sections.push(`### Notes\n${noteList}\n`);
  }
}

writeResult("h-edge-cases", sections.join("\n"));
