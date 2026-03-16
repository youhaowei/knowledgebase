/**
 * E: Multi-corpus test — runs AST + Hybrid (C) on React/TSX components
 * to see how well approaches handle JSX, hooks, and UI patterns.
 */
import { getInputFiles, writeResult, summarizeWithLLM } from "./shared";
import { extractSkeleton } from "./a-ast";

const HYBRID_SYSTEM = `You are summarizing a TypeScript/React file based on its AST skeleton (exports, types, function signatures).
Write a 3-5 sentence natural-language summary covering:
1. The component's primary responsibility and user-facing behavior
2. Key props, hooks, and state management patterns
3. Architectural role (page, layout, widget, utility component, etc.)

You're seeing signatures only — infer purpose from names, types, and structure.`;

const LLM_SYSTEM = `You are a senior React developer summarizing source files for a code knowledge base.
Produce a 3-5 sentence summary covering:
1. What this component does (user-facing behavior)
2. Key exports, props, and hooks used
3. Notable patterns (state management, effects, event handling)
4. Design decisions visible in the code

Be specific — mention actual component/function names. No generic filler.`;

const corpuses = [
  { name: "web-components", dir: "src/web/components" },
  { name: "web-ui", dir: "src/web/components/ui" },
  { name: "routes", dir: "src/routes" },
];

const allSections: string[] = [`# E: Multi-Corpus Test\n`];

for (const corpus of corpuses) {
  let files;
  try {
    files = await getInputFiles(corpus.dir);
  } catch {
    console.error(`  Skipping ${corpus.name} — directory not found or empty`);
    continue;
  }
  if (files.length === 0) {
    console.error(`  Skipping ${corpus.name} — no .ts files found`);
    continue;
  }

  console.error(`\n--- ${corpus.name} (${files.length} files) ---`);
  allSections.push(`## Corpus: ${corpus.name} (${corpus.dir}/)\n`);

  for (const file of files) {
    console.error(`  Processing ${file.filename}...`);

    // AST skeleton
    const skeleton = extractSkeleton(file.filename, file.content);
    const ratio = ((skeleton.length / file.content.length) * 100).toFixed(0);

    // Hybrid summary (AST → LLM)
    const hybridInput = `File: ${file.filename} (${file.lines} lines)\n\n${skeleton}`;
    const { text: hybridText, elapsedMs: hybridMs } = await summarizeWithLLM(
      HYBRID_SYSTEM,
      hybridInput,
    );

    // Full LLM summary
    const fullInput = `File: ${file.filename} (${file.lines} lines)\n\n${file.content}`;
    const { text: llmText, elapsedMs: llmMs } = await summarizeWithLLM(LLM_SYSTEM, fullInput);

    allSections.push(`### ${file.filename}

_${file.lines} lines, skeleton ${skeleton.length} chars (${ratio}% of ${file.content.length})_

**AST Skeleton:**
\`\`\`
${skeleton}
\`\`\`

**Hybrid (AST→LLM)** _(${hybridMs}ms)_:
${hybridText}

**Full LLM** _(${llmMs}ms)_:
${llmText}
`);

    console.error(`    ✓ hybrid ${hybridMs}ms, full ${llmMs}ms`);
  }
}

writeResult("e-corpus", allSections.join("\n"));
