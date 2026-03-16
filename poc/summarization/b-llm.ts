import { getInputFiles, writeResult, summarizeWithLLM } from "./shared";

const SYSTEM = `You are a senior TypeScript developer summarizing source files for a code knowledge base.
Produce a 3-5 sentence summary covering:
1. What this file does (primary responsibility)
2. Key exports and their purpose
3. Notable dependencies or patterns
4. Any important design decisions visible in the code

Be specific — mention actual function/type names. No generic filler.`;

const files = await getInputFiles();
console.error(`LLM summarizing ${files.length} files...`);

const sections: string[] = [`# B: LLM Per-File Summary\n`];
let totalMs = 0;
let totalInputChars = 0;

for (const file of files) {
  const input = `File: ${file.filename} (${file.lines} lines)\n\n${file.content}`;
  totalInputChars += input.length;

  const { text, elapsedMs } = await summarizeWithLLM(SYSTEM, input);
  totalMs += elapsedMs;

  sections.push(
    `## ${file.filename}\n\n_${file.lines} lines, ${file.content.length} input chars, ${elapsedMs}ms_\n\n${text}`,
  );
  console.error(`  ✓ ${file.filename} (${elapsedMs}ms)`);
}

sections.push(
  `\n---\n**Totals:** ${files.length} files, ${totalInputChars} input chars, ${totalMs}ms (${Math.round(totalMs / files.length)}ms avg)`,
);

writeResult("b-llm", sections.join("\n\n"));
