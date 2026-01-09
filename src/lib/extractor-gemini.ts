/**
 * Gemini Extractor - extracts structured knowledge from text
 *
 * Uses Gemini CLI in headless mode (no API costs with personal Google account)
 * Extracts: items (entities), relations (how they connect), and summary
 */

import { Extraction } from "../types.js";

// The extraction prompt (shared with Claude extractor)
const EXTRACTION_PROMPT = `Extract structured knowledge from this text and return ONLY a valid JSON object (no markdown, no explanation).

Your task:
1. Identify **items** - named entities mentioned in the text. Each item has a type:
   - person: Individual people (e.g., "Alice", "Marie Curie", "my manager")
   - organization: Companies, teams, institutions (e.g., "Google", "MIT", "our team")
   - project: Projects, products, initiatives (e.g., "React", "my thesis", "Q4 campaign")
   - technology: Tools, languages, systems (e.g., "TypeScript", "Notion", "Excel")
   - concept: Ideas, patterns, topics (e.g., "REST", "stoicism", "agile")
   - preference: Preferences or opinions (e.g., "dark mode", "morning workouts")
   - decision: Choices or conclusions (e.g., "use Postgres", "move to Austin")

   **CRITICAL RULES for item names**:
   - Names MUST be 1-3 words maximum
   - Use proper nouns, acronyms, or short phrases
   - GOOD: "GraphQL", "Meta", "REST", "morning routine", "Alice"
   - BAD: "Query language for APIs", "My preference for working in the morning"
   - If it doesn't have a short canonical name, it's probably a description, not an entity

2. Identify **relations** - directed edges between items.

   Choose the most SPECIFIC relation type:
   - created_by: thing → creator (e.g., "GraphQL" → created_by → "Meta")
   - uses: user → tool (e.g., "Alice" → uses → "Notion")
   - works_at: person → organization
   - works_on: person/org → project
   - built_by: project → creator
   - prefers: agent → preference (EXCLUSIVE: one preference per category)
   - avoids: agent → avoided_thing
   - knows: person → person/topic
   - depends_on: dependent → dependency
   - alternative_to: thing → alternative
   - part_of: component → whole
   - is_a: specific → general
   - located_in: thing → place
   - related_to: (fallback) generic connection

   **IMPORTANT**:
   - Direction matters! "GraphQL created_by Meta" not "Meta created GraphQL"
   - Prefer specific relations over "related_to"
   - Only extract relations explicitly stated or strongly implied

3. Generate a **summary** - a concise 1-2 sentence summary of the key information.

Return ONLY this JSON structure (no other text):
{
  "items": [{"name": "...", "type": "person|organization|project|technology|concept|preference|decision", "description": "optional"}],
  "relations": [{"from": "item_name", "relation": "relation_type", "to": "item_name"}],
  "summary": "..."
}`;

interface GeminiJsonOutput {
  session_id: string;
  response: string;
  stats: unknown;
}

/**
 * Parse the CLI JSON output to extract the GeminiJsonOutput structure
 */
function parseGeminiCliOutput(output: string): GeminiJsonOutput {
  // Find the start of the JSON output (look for opening brace with session_id)
  let jsonStartIndex = output.indexOf('{"session_id"');

  if (jsonStartIndex === -1) {
    // Try alternate format - find session_id and work backwards
    const altStart = output.indexOf('"session_id"');
    if (altStart === -1) {
      throw new Error("No session_id found in output");
    }
    jsonStartIndex = output.lastIndexOf("{", altStart);
    if (jsonStartIndex === -1) {
      throw new Error("No JSON object found in output");
    }
  }

  return JSON.parse(output.slice(jsonStartIndex));
}

/**
 * Remove markdown code block wrapper if present
 */
function stripMarkdownCodeBlock(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const firstNewline = trimmed.indexOf("\n");
  const lastBackticks = trimmed.lastIndexOf("```");

  if (firstNewline !== -1 && lastBackticks > firstNewline) {
    return trimmed.slice(firstNewline + 1, lastBackticks).trim();
  }

  return trimmed;
}

/**
 * Extract JSON object from string by matching balanced braces
 */
function extractJsonObject(text: string): string {
  const startBrace = text.indexOf("{");
  if (startBrace === -1) {
    throw new Error("No JSON object found");
  }

  let depth = 0;
  for (let i = startBrace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(startBrace, i + 1);
      }
    }
  }

  throw new Error("Unmatched braces in JSON");
}

export async function extractWithGemini(text: string): Promise<Extraction> {
  const fullPrompt = `${EXTRACTION_PROMPT}\n\nText to extract from:\n${text}`;

  // Use Bun's spawn to call gemini CLI in sandbox mode (no file/shell access)
  const proc = Bun.spawn(["gemini", "-o", "json", "--sandbox", fullPrompt], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("Gemini CLI stderr:", stderr);
    throw new Error(`Gemini CLI failed with exit code ${exitCode}`);
  }

  // Parse the CLI output
  let geminiOutput: GeminiJsonOutput;
  try {
    geminiOutput = parseGeminiCliOutput(output);
  } catch (e) {
    console.error("Failed to parse Gemini CLI output:", output);
    throw new Error(`Failed to parse Gemini JSON output: ${e}`);
  }

  // Extract the extraction JSON from the model's response
  const responseText = geminiOutput.response;
  const jsonStr = stripMarkdownCodeBlock(responseText);

  let jsonContent: string;
  try {
    jsonContent = extractJsonObject(jsonStr);
  } catch (e) {
    console.error("No valid JSON object in response:", responseText);
    throw new Error(`No valid JSON in Gemini response: ${e}`);
  }

  // Parse and validate the extraction result
  try {
    const parsed = JSON.parse(jsonContent);
    console.log("Gemini extraction result:", JSON.stringify(parsed, null, 2));
    return Extraction.parse(parsed);
  } catch (e) {
    console.error("Failed to parse extraction JSON:", jsonContent);
    throw new Error(`Failed to parse extraction result: ${e}`);
  }
}
