import { getInputFiles, writeResult, summarizeWithLLM } from "./shared";
import { extractSkeleton } from "./a-ast";

const SYSTEM = `You are summarizing a TypeScript file based on its AST skeleton (exports, types, function signatures).
Write a 3-5 sentence natural-language summary covering:
1. The file's primary responsibility
2. Key public API (what consumers use)
3. Architectural role (is it a provider, utility, config, etc.)

You're seeing signatures only — infer purpose from names, types, and structure.`;

const files = await getInputFiles();
console.error(`Hybrid (AST→LLM) summarizing ${files.length} files...`);

const sections: string[] = [`# C: AST + LLM Hybrid\n`];
let totalMs = 0;
let totalSkeletonChars = 0;
let totalFullChars = 0;

for (const file of files) {
  const skeleton = extractSkeleton(file.filename, file.content);
  totalSkeletonChars += skeleton.length;
  totalFullChars += file.content.length;

  const input = `File: ${file.filename} (${file.lines} lines)\n\n${skeleton}`;
  const { text, elapsedMs } = await summarizeWithLLM(SYSTEM, input);
  totalMs += elapsedMs;

  const ratio = ((skeleton.length / file.content.length) * 100).toFixed(0);
  sections.push(
    `## ${file.filename}\n\n_${file.lines} lines, skeleton ${skeleton.length} chars (${ratio}% of ${file.content.length}), ${elapsedMs}ms_\n\n${text}`,
  );
  console.error(
    `  ✓ ${file.filename} (skeleton ${skeleton.length}/${file.content.length} chars = ${ratio}%, ${elapsedMs}ms)`,
  );
}

const overallRatio = ((totalSkeletonChars / totalFullChars) * 100).toFixed(0);
sections.push(
  `\n---\n**Totals:** ${files.length} files, ${totalSkeletonChars} skeleton chars (${overallRatio}% of ${totalFullChars} full), ${totalMs}ms (${Math.round(totalMs / files.length)}ms avg)`,
);

writeResult("c-hybrid", sections.join("\n\n"));
