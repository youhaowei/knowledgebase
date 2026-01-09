/**
 * Knowledge Extractor - extracts structured knowledge from text
 *
 * Supports multiple LLM backends:
 * - Claude: Uses Claude Agent SDK with OAuth subscription (no API costs)
 * - Gemini: Uses Gemini CLI in sandbox mode (free with Google account)
 *
 * Set EXTRACTOR_BACKEND env var to choose: "claude" (default) or "gemini"
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { Extraction } from "../types.js";
import { extractWithGemini } from "./extractor-gemini.js";

// Type guard for assistant messages with content
interface AssistantMessage {
  type: "assistant";
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      input?: unknown;
    }>;
  };
}

function isAssistantMessage(msg: unknown): msg is AssistantMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    msg.type === "assistant"
  );
}

async function extractWithClaude(text: string): Promise<Extraction> {
  // Manually construct JSON schema that the Claude API accepts
  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: {
              type: "string",
              enum: [
                "person",
                "organization",
                "project",
                "technology",
                "concept",
                "preference",
                "decision",
              ],
            },
            description: { type: "string" },
          },
          required: ["name", "type"],
        },
      },
      relations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            relation: { type: "string" },
            to: { type: "string" },
          },
          required: ["from", "relation", "to"],
        },
      },
      summary: { type: "string" },
    },
    required: ["items", "relations", "summary"],
  };

  for await (const msg of query({
    prompt: `Extract structured knowledge from this text:

${text}

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

Return a JSON object matching the schema.`,
    options: {
      outputFormat: { type: "json_schema", schema },
      maxTurns: 1,
      allowedTools: [],
      model: "haiku",
    },
  })) {
    // Handle assistant message with StructuredOutput tool use
    if (isAssistantMessage(msg) && msg.message?.content) {
      const content = msg.message.content;
      for (const block of content) {
        if (
          block.type === "tool_use" &&
          block.name === "StructuredOutput" &&
          block.input
        ) {
          console.log(
            "Found structured output:",
            JSON.stringify(block.input, null, 2),
          );
          const result = Extraction.parse(block.input);
          return result;
        }
      }
    }
  }

  throw new Error("Extraction failed - no structured_output in response");
}

// Cache for gemini availability check
let geminiAvailable: boolean | null = null;

async function isGeminiAvailable(): Promise<boolean> {
  if (geminiAvailable !== null) return geminiAvailable;

  try {
    const proc = Bun.spawn(["which", "gemini"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    geminiAvailable = proc.exitCode === 0;
  } catch {
    geminiAvailable = false;
  }

  return geminiAvailable;
}

/**
 * Main extraction function - auto-detects best available backend
 *
 * Priority:
 * 1. EXTRACTOR_BACKEND env var if set ("claude" or "gemini")
 * 2. Gemini CLI if available (free with Google account)
 * 3. Claude Agent SDK as fallback
 */
export async function extract(text: string): Promise<Extraction> {
  const backendOverride = process.env.EXTRACTOR_BACKEND;

  // Explicit override
  if (backendOverride === "claude") {
    console.log("Using Claude Agent SDK for extraction (explicit)...");
    return extractWithClaude(text);
  }
  if (backendOverride === "gemini") {
    console.log("Using Gemini CLI for extraction (explicit)...");
    return extractWithGemini(text);
  }

  // Auto-detect: prefer Gemini if available
  if (await isGeminiAvailable()) {
    console.log("Using Gemini CLI for extraction (auto-detected)...");
    try {
      return await extractWithGemini(text);
    } catch (error) {
      console.warn("Gemini extraction failed, falling back to Claude:", error);
      return extractWithClaude(text);
    }
  }

  // Fallback to Claude
  console.log("Using Claude Agent SDK for extraction (fallback)...");
  return extractWithClaude(text);
}
