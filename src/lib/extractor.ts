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
const EXTRACTION_MODEL = process.env.EXTRACTION_MODEL || "gemma4:e4b";

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

const MAX_EXTRACT_RETRIES = 3;

async function extractWithOllama(text: string, existingEntities?: EntityCatalogEntry[]): Promise<Extraction> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_EXTRACT_RETRIES; attempt++) {
    try {
      return await singleOllamaExtraction(text, existingEntities);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_EXTRACT_RETRIES) {
        console.error(`[extractor] attempt ${attempt}/${MAX_EXTRACT_RETRIES} failed: ${lastError.message.slice(0, 80)}. Retrying...`);
      }
    }
  }
  throw lastError!;
}

async function singleOllamaExtraction(text: string, existingEntities?: EntityCatalogEntry[]): Promise<Extraction> {
  // 120s per-request timeout prevents stuck generations (small models can
  // enter token loops and consume the full num_predict budget).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);

  let resp: Response;
  try {
    resp = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        prompt: extractionPrompt(text, existingEntities) + "\n\nRespond with ONLY valid JSON matching the schema. No markdown fencing, no explanation.",
        format: "json",  // Grammar-constrained: model can only emit valid JSON tokens
        stream: false,
        think: false,
        options: { temperature: 0.2, num_predict: 2048 },
      }),
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Ollama extraction timeout (120s)");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!resp.ok) {
    throw new Error(`Ollama extraction error: ${resp.status} ${await resp.text()}`);
  }

  const result = (await resp.json()) as { response: string };
  const data = parseJsonFromText(result.response);
  if (!data) {
    throw new Error("Extraction failed - could not parse JSON from response");
  }
  // Coerce model output to schema-compliant shapes before Zod validation.
  // Small models (gemma4:e4b, etc.) frequently emit semantically-correct but
  // type-wrong values: "sentiment": "negative" instead of -0.5, sourceIndex as
  // a string, missing entity.type, etc. We normalize these to their numeric
  // equivalents so Zod doesn't reject otherwise-valid extractions.
  coerceExtractionShape(data);
  return Extraction.parse(data);
}

// Map text sentiment values to the -1..1 numeric range the schema expects.
// Returns undefined for unknown strings (caller falls back to 0).
function coerceSentiment(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Try numeric string first
    const asNum = Number(trimmed);
    if (!isNaN(asNum)) return Math.max(-1, Math.min(1, asNum));
    const key = trimmed.toLowerCase();
    const map: Record<string, number> = {
      "strong positive": 1.0, "strongly positive": 1.0, "preferred": 1.0, "chosen": 1.0, "recommended": 1.0,
      "positive": 0.5, "good": 0.5, "useful": 0.5, "mildly positive": 0.5,
      "neutral": 0.0, "factual": 0.0, "": 0.0, "none": 0.0,
      "negative": -0.5, "issues": -0.5, "deprecated": -0.5, "mildly negative": -0.5,
      "strong negative": -1.0, "strongly negative": -1.0, "rejected": -1.0, "avoid": -1.0, "problematic": -1.0,
    };
    if (key in map) return map[key];
  }
  return undefined;
}

// Map text confidence values to the 0..1 numeric range. Unknown → undefined.
function coerceConfidence(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const asNum = Number(trimmed);
    if (!isNaN(asNum)) return Math.max(0, Math.min(1, asNum));
    const key = trimmed.toLowerCase();
    const map: Record<string, number> = {
      "high": 1.0, "explicit": 1.0, "stated": 1.0, "certain": 1.0, "explicitly stated": 1.0,
      "medium": 0.8, "implied": 0.8, "strong": 0.8, "strongly implied": 0.8,
      "low": 0.6, "inferred": 0.6, "weak": 0.6, "guessed": 0.6,
    };
    if (key in map) return map[key];
  }
  return undefined;
}

// Coerce string-or-number to integer index. Returns undefined on failure.
function coerceIndex(value: unknown): number | undefined {
  if (typeof value === "number") return Math.trunc(value);
  if (typeof value === "string") {
    const asNum = Number(value.trim());
    if (!isNaN(asNum)) return Math.trunc(asNum);
  }
  return undefined;
}

// Walk the extraction payload and repair type mismatches in-place.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coerceExtractionShape(data: any): void {
  if (typeof data !== "object" || data === null) return;

  // Entities: coerce or default the type field
  const validTypes = new Set(["person", "organization", "project", "technology", "concept"]);
  if (Array.isArray(data.entities)) {
    for (const entity of data.entities) {
      if (!entity || typeof entity !== "object") continue;
      if (!entity.type || !validTypes.has(entity.type)) entity.type = "concept";
      if (typeof entity.name !== "string") entity.name = String(entity.name ?? "");
    }
  }

  // Edges: coerce numeric fields, default missing values.
  // Drop edges whose sourceIndex/targetIndex can't be coerced to a number —
  // these represent extraction failures the model itself couldn't resolve.
  if (Array.isArray(data.edges)) {
    data.edges = data.edges.filter((edge: unknown) => {
      if (!edge || typeof edge !== "object") return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = edge as any;
      const src = coerceIndex(e.sourceIndex);
      const tgt = coerceIndex(e.targetIndex);
      if (src === undefined || tgt === undefined) return false;
      e.sourceIndex = src;
      e.targetIndex = tgt;
      return true;
    });
    for (const edge of data.edges) {

      // sentiment must be number in [-1, 1], default 0
      const sentiment = coerceSentiment(edge.sentiment);
      edge.sentiment = sentiment ?? 0;

      // confidence must be number in [0, 1], default 1
      const confidence = coerceConfidence(edge.confidence);
      edge.confidence = confidence ?? 1;

      // relationType must be string
      if (typeof edge.relationType !== "string") {
        edge.relationType = String(edge.relationType ?? "relatesTo");
      }

      // fact must be string
      if (typeof edge.fact !== "string") {
        edge.fact = String(edge.fact ?? "");
      }

      // confidenceReason must be string if present
      if (edge.confidenceReason !== undefined && typeof edge.confidenceReason !== "string") {
        edge.confidenceReason = String(edge.confidenceReason);
      }
    }
  }
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

export { extractionSchema, extractionPrompt, coerceExtractionShape, parseJsonFromText };
