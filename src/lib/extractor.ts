/**
 * Knowledge Extractor - extracts structured knowledge from text
 *
 * Edge-as-Fact Model (Graphiti-style):
 * - Extracts entities first (indexed 0, 1, 2...)
 * - Extracts edges (facts) as relationships between entities
 * - Each edge has relationType, sentiment, and natural language description
 *
 * Uses Ollama (qwen3.5) for local, fast extraction with no external API dependency.
 */

import { Extraction } from "../types.js";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EXTRACTION_MODEL = process.env.EXTRACTION_MODEL || "qwen3.5";

// JSON schema for edge-based extraction
const extractionSchema = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      description: "Named entities extracted from text (indexed 0, 1, 2...)",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Canonical name (1-3 words)",
          },
          type: {
            type: "string",
            enum: ["person", "organization", "project", "technology", "concept"],
          },
          description: {
            type: "string",
            description: "Brief description (optional)",
          },
        },
        required: ["name", "type"],
      },
    },
    edges: {
      type: "array",
      description: "Relationships between entities as fact triples",
      items: {
        type: "object",
        properties: {
          relationType: {
            type: "string",
            description: "camelCase relation type (uses, prefers, hasAdvantageOver, worksAt, rejected, etc.)",
          },
          sourceIndex: {
            type: "integer",
            description: "Index of source entity in entities array",
          },
          targetIndex: {
            type: "integer",
            description: "Index of target entity in entities array",
          },
          fact: {
            type: "string",
            description: "Natural language description of the relationship",
          },
          sentiment: {
            type: "number",
            description: "Sentiment from -1 (negative/rejected) to 1 (positive/preferred). 0 = neutral factual.",
          },
          confidence: {
            type: "number",
            description: "Confidence score from 0 (uncertain) to 1 (explicitly stated). 1.0 = explicitly stated, 0.8 = strongly implied, 0.6 = inferred from context.",
          },
          confidenceReason: {
            type: "string",
            description: "Brief reason for the confidence level (e.g., 'directly stated', 'implied by usage context')",
          },
          validAt: {
            type: "string",
            description: "ISO 8601 date when relationship became true (optional)",
          },
          invalidAt: {
            type: "string",
            description: "ISO 8601 date when relationship ended (optional)",
          },
        },
        required: ["relationType", "sourceIndex", "targetIndex", "fact", "sentiment", "confidence"],
      },
    },
    abstract: {
      type: "string",
      description: "1-2 sentence abstract, maximally information-dense. Include primary topic, key entities, and one notable decision or pattern.",
    },
    summary: {
      type: "string",
      description: "1 paragraph (4-6 sentences) summary with thorough coverage. Capture key facts, entities, relationships, context, and nuance. A reader should understand the memory without needing the full text.",
    },
    category: {
      type: "string",
      enum: ["preference", "event", "pattern", "general"],
      description: "Memory category: preference (opinions/choices), event (time-specific happenings), pattern (recurring practices/rules), general (everything else)",
    },
  },
  required: ["entities", "edges", "abstract", "summary", "category"],
};

interface EntityCatalogEntry {
  name: string;
  type: string;
}

function formatEntityCatalog(entities: EntityCatalogEntry[]): string {
  if (entities.length === 0) return "";
  const grouped = new Map<string, string[]>();
  for (const e of entities) {
    if (!grouped.has(e.type)) grouped.set(e.type, []);
    grouped.get(e.type)!.push(e.name);
  }
  const lines = [...grouped.entries()].map(([type, names]) => `   - ${type}: ${names.join(", ")}`);
  return `
EXISTING ENTITIES (reuse these exact names when referring to the same thing):
${lines.join("\n")}

   When an entity in the text matches or is equivalent to an existing entity above,
   you MUST use the EXACT existing name. This includes abbreviations, acronyms, plurals,
   alternate names, and semantic equivalents (e.g., "DnD" → "drag-and-drop").
   Only create a NEW entity if nothing above is semantically equivalent.

`;
}

const extractionPrompt = (text: string, existingEntities?: EntityCatalogEntry[]) => `Extract structured knowledge from this text:

${text}

Your task:

1. **ENTITIES** - Extract named things first. They will be indexed 0, 1, 2, etc.

   Types:
   - person: Individual people
   - organization: Companies, teams, institutions
   - project: Projects, products, packages (e.g., "DashFrame", "@dashframe/core")
   - technology: Tools, languages, systems, formats (e.g., "Zustand", "Arrow IPC")
   - concept: Patterns, abstractions, ideas (e.g., "DataFrame", "state management")
${existingEntities?.length ? formatEntityCatalog(existingEntities) : ""}
   Rules:
   - Names must be 1-3 words maximum
   - Use canonical/proper names${existingEntities?.length ? "\n   - REUSE existing entity names from the list above when applicable" : ""}

2. **EDGES** - Extract relationships as fact triples between entities.

   For each relationship:
   - relationType: camelCase verb describing the relationship
   - sourceIndex: Index of the "subject" entity (0, 1, 2...)
   - targetIndex: Index of the "object" entity (0, 1, 2...)
   - fact: Natural language description of the relationship
   - sentiment: -1 to 1 indicating positive/negative association:
     - -1.0: Strongly negative (rejected, problematic, avoid)
     - -0.5: Mildly negative (has issues, deprecated)
     -  0.0: Neutral (factual statement)
     -  0.5: Mildly positive (good, useful)
     -  1.0: Strongly positive (preferred, chosen, recommended)
   - confidence: 0 to 1 indicating how certain the relationship is:
     -  1.0: Explicitly stated ("We decided to use Zustand")
     -  0.8: Strongly implied ("Zustand has been great for our state management")
     -  0.6: Inferred from context ("The project uses React and several state libraries")
   - confidenceReason: Brief explanation for the confidence level

   Common relation types:
   - uses, usedBy: Neutral usage (sentiment: 0)
   - prefers, chooses: Positive choice (sentiment: 0.5-1.0)
   - hasAdvantageOver: Comparison (sentiment: 0.5)
   - rejected, replaced: Negative decision (sentiment: -0.5 to -1.0)
   - worksAt, memberOf: Neutral association (sentiment: 0)
   - created, developed: Neutral authorship (sentiment: 0)

   Examples:
   - Entity 0: "DashFrame", Entity 1: "Zustand", Entity 2: "Redux"
   - {relationType: "uses", sourceIndex: 0, targetIndex: 1, fact: "DashFrame uses Zustand for state management", sentiment: 0, confidence: 1.0, confidenceReason: "directly stated"}
   - {relationType: "prefers", sourceIndex: 0, targetIndex: 1, fact: "DashFrame chose Zustand for its simpler API", sentiment: 0.8, confidence: 0.8, confidenceReason: "implied by positive comparison"}
   - {relationType: "hasAdvantageOver", sourceIndex: 1, targetIndex: 2, fact: "Zustand has simpler API than Redux", sentiment: 0.5, confidence: 0.8, confidenceReason: "implied by choice rationale"}
   - {relationType: "rejected", sourceIndex: 0, targetIndex: 2, fact: "DashFrame rejected Redux due to boilerplate", sentiment: -0.8, confidence: 1.0, confidenceReason: "explicitly stated rejection"}

3. **ABSTRACT** - A 1-2 sentence abstract that is maximally information-dense. Include the primary topic, key entities, and one notable decision or pattern.

4. **SUMMARY** - A 1-paragraph summary (4-6 sentences) with thorough coverage. Capture key facts, entities, relationships, context, and nuance. A reader should understand the memory without needing the full text.

5. **CATEGORY** - Classify the overall memory into exactly one category:
   - preference: Opinions, choices, likes/dislikes ("I prefer Zustand over Redux", "We chose Bun for speed")
   - event: Time-specific happenings, milestones, incidents ("Migrated to Bun on Jan 15", "Deploy failed yesterday")
   - pattern: Recurring practices, rules, how-tos ("Always run db:init after schema changes", "Use kebab-case for routes")
   - general: Everything else that doesn't fit the above categories

Return a JSON object matching the schema.`;

async function extractWithOllama(text: string, existingEntities?: EntityCatalogEntry[]): Promise<Extraction> {
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      prompt: extractionPrompt(text, existingEntities) + "\n\nRespond with ONLY valid JSON matching the schema. No markdown fencing, no explanation.",
      stream: false,
      think: false,
      options: { temperature: 0.2, num_predict: 4096 },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama extraction error: ${resp.status} ${await resp.text()}`);
  }

  const result = (await resp.json()) as { response: string };
  const data = parseJsonFromText(result.response);
  if (!data) {
    throw new Error("Extraction failed - could not parse JSON from response");
  }
  // Coerce invalid entity types to "concept" before Zod validation
  const validTypes = new Set(["person", "organization", "project", "technology", "concept"]);
  if (typeof data === "object" && data && "entities" in data && Array.isArray((data as any).entities)) {
    for (const entity of (data as any).entities) {
      if (entity.type && !validTypes.has(entity.type)) entity.type = "concept";
    }
  }
  return Extraction.parse(data);
}

function parseJsonFromText(text: string): unknown | null {
  // Try direct parse
  try { return JSON.parse(text); } catch {}
  // Try extracting from markdown code block
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) try { return JSON.parse(fenced[1]!); } catch {}
  // Try finding first { to last }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  return null;
}

/**
 * Extract structured knowledge from text using Ollama (local, fast).
 * Pass existingEntities to enable context-aware entity resolution.
 */
export async function extract(text: string, existingEntities?: EntityCatalogEntry[]): Promise<Extraction> {
  return extractWithOllama(text, existingEntities);
}

export { extractionSchema, extractionPrompt };
