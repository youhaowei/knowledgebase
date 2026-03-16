import { writeResult, summarizeWithLLM } from "./shared";

function parseResultFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const sections = content.split("\n## ");
  for (const section of sections.slice(1)) {
    const newline = section.indexOf("\n");
    if (newline < 0) continue;
    const filename = section.slice(0, newline).trim();
    // Skip metadata line (starts with _)
    const body = section.slice(newline + 1).trim();
    const lines = body.split("\n");
    const contentStart = lines.findIndex((l, i) => i > 0 && !l.startsWith("_") && l.trim());
    const summary = lines
      .slice(contentStart >= 0 ? contentStart : 1)
      .join("\n")
      .trim();
    map.set(filename, summary);
  }
  return map;
}

const OVERVIEW_SYSTEM = `You are creating a structured overview of a TypeScript source directory for a code knowledge base.
Given per-file summaries, produce:

# [Directory Name]

## Purpose
What this directory/module does as a whole (1-2 paragraphs).

## Key Components
Group files by responsibility (3-7 bullet points). Reference actual filenames.

## Data Flow
How the pieces connect — what calls what, what depends on what (1 paragraph).

## Dependencies
External systems and libraries this module relies on.`;

const ABSTRACT_SYSTEM = `Produce a 1-2 sentence abstract of this directory.
This will be used for quick retrieval — be maximally information-dense.
Example: "Graph-backed knowledge store with dual embedding (Ollama/local), async extraction pipeline, and pluggable storage (Neo4j/LadybugDB)."
Output ONLY the abstract, nothing else.`;

async function generateRollup(
  label: string,
  summaries: Map<string, string>,
): Promise<string> {
  const allSummaries = [...summaries.entries()]
    .map(([f, s]) => `### ${f}\n${s}`)
    .join("\n\n");

  console.error(`  Generating L1 overview from ${label}...`);
  const { text: overview, elapsedMs: overviewMs } = await summarizeWithLLM(
    OVERVIEW_SYSTEM,
    `Directory: src/lib/ (${summaries.size} files)\n\n${allSummaries}`,
  );

  console.error(`  Generating L0 abstract from ${label}...`);
  const { text: abstract, elapsedMs: abstractMs } = await summarizeWithLLM(
    ABSTRACT_SYSTEM,
    overview,
  );

  return `### From ${label}\n\n**L0 Abstract** _(${abstractMs}ms)_:\n> ${abstract}\n\n**L1 Overview** _(${overviewMs}ms)_:\n\n${overview}`;
}

// --- Main ---
const bFile = Bun.file("poc/summarization/results/b-llm.md");
const cFile = Bun.file("poc/summarization/results/c-hybrid.md");

if (!(await bFile.exists()) || !(await cFile.exists())) {
  console.error("Error: Run b-llm.ts and c-hybrid.ts first to generate input files.");
  process.exit(1);
}

const bSummaries = parseResultFile(await bFile.text());
const cSummaries = parseResultFile(await cFile.text());

console.error(`Rollup: ${bSummaries.size} B summaries, ${cSummaries.size} C summaries`);

const bRollup = await generateRollup("B (LLM per-file)", bSummaries);
const cRollup = await generateRollup("C (AST+LLM hybrid)", cSummaries);

const output = `# D: Bottom-Up Directory Rollup

Generates L0 (abstract) and L1 (overview) for \`src/lib/\` from pre-computed file summaries.

${bRollup}

---

${cRollup}
`;

writeResult("d-rollup", output);
