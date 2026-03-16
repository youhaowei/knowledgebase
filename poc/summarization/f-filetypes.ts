/**
 * F: Non-TypeScript file types — markdown, JSON, config files.
 * AST extraction doesn't apply here, so we compare:
 *   - Structural extraction (headers/sections for markdown, keys for JSON)
 *   - Full LLM summary
 */
import { writeResult, summarizeWithLLM } from "./shared";
import { resolve, basename } from "path";

interface TestFile {
  path: string;
  filename: string;
  content: string;
  lines: number;
  type: "markdown" | "json" | "config";
}

const TEST_FILES: { path: string; type: TestFile["type"] }[] = [
  { path: "README.md", type: "markdown" },
  { path: "DESIGN_SYSTEM.md", type: "markdown" },
  { path: "CLAUDE.md", type: "markdown" },
  { path: "tsconfig.json", type: "json" },
  { path: "components.json", type: "json" },
  { path: "package.json", type: "json" },
  { path: "eslint.config.js", type: "config" },
  { path: "vite.config.ts", type: "config" },
];

function extractMarkdownStructure(content: string): string {
  const lines = content.split("\n");
  const structure: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (line.startsWith("#")) {
      structure.push(line);
    }
  }
  return structure.join("\n") || "(no headers found)";
}

function extractJsonStructure(content: string): string {
  try {
    const obj = JSON.parse(content);
    const describe = (val: unknown, depth = 0): string => {
      if (depth > 2) return "...";
      if (Array.isArray(val)) return `[${val.length} items]`;
      if (typeof val === "object" && val !== null) {
        const keys = Object.keys(val);
        if (depth === 2) return `{${keys.length} keys}`;
        return (
          "{\n" +
          keys.map((k) => `${"  ".repeat(depth + 1)}${k}: ${describe((val as Record<string, unknown>)[k], depth + 1)}`).join("\n") +
          "\n" +
          "  ".repeat(depth) +
          "}"
        );
      }
      return JSON.stringify(val);
    };
    return describe(obj);
  } catch {
    return "(invalid JSON)";
  }
}

function extractConfigStructure(content: string): string {
  // For config files, extract exports and key assignments
  const lines = content.split("\n");
  return lines
    .filter(
      (l) =>
        l.includes("export") ||
        l.includes("module.exports") ||
        l.match(/^\s*\w+:/) ||
        l.startsWith("import"),
    )
    .join("\n") || content.slice(0, 500);
}

const LLM_SYSTEM = `You are summarizing a project file for a code knowledge base.
Produce a 3-5 sentence summary covering:
1. What this file documents or configures
2. Key sections, settings, or information it contains
3. Who would reference this file and why

Be specific — mention actual section names, settings, or content. No generic filler.`;

const sections: string[] = [`# F: Non-TypeScript File Types\n`];

for (const { path: relPath, type } of TEST_FILES) {
  const fullPath = resolve(relPath);
  const file = Bun.file(fullPath);
  if (!(await file.exists())) {
    console.error(`  Skipping ${relPath} — not found`);
    continue;
  }

  const content = await file.text();
  const filename = basename(relPath);
  const lines = content.split("\n").length;

  console.error(`Processing ${filename} (${type}, ${lines} lines)...`);

  // Structural extraction based on file type
  let structure: string;
  let structureLabel: string;
  switch (type) {
    case "markdown":
      structure = extractMarkdownStructure(content);
      structureLabel = "Header Structure";
      break;
    case "json":
      structure = extractJsonStructure(content);
      structureLabel = "Key Structure";
      break;
    case "config":
      structure = extractConfigStructure(content);
      structureLabel = "Config Structure";
      break;
  }

  const structRatio = ((structure.length / content.length) * 100).toFixed(0);

  // Structural → LLM hybrid
  const { text: hybridText, elapsedMs: hybridMs } = await summarizeWithLLM(
    LLM_SYSTEM,
    `File: ${filename} (${type}, ${lines} lines)\n\nStructure:\n${structure}`,
  );

  // Full LLM
  // Truncate very large files to avoid overwhelming the model
  const truncated = content.length > 30000 ? content.slice(0, 30000) + "\n...(truncated)" : content;
  const { text: llmText, elapsedMs: llmMs } = await summarizeWithLLM(
    LLM_SYSTEM,
    `File: ${filename} (${type}, ${lines} lines)\n\n${truncated}`,
  );

  sections.push(`## ${filename} (${type})

_${lines} lines, structure ${structure.length} chars (${structRatio}% of ${content.length})_

**${structureLabel}:**
\`\`\`
${structure}
\`\`\`

**Structure→LLM** _(${hybridMs}ms)_:
${hybridText}

**Full LLM** _(${llmMs}ms)_:
${llmText}
`);

  console.error(`  ✓ hybrid ${hybridMs}ms, full ${llmMs}ms`);
}

writeResult("f-filetypes", sections.join("\n"));
