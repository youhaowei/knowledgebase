import { z } from "zod";

// =============================================================================
// ENTITY TYPES
// =============================================================================

export const EntityType = z.enum([
  "person",
  "organization",
  "project",
  "technology",
  "concept",
]);

// An extracted entity from text
export const Entity = z.object({
  name: z.string(),
  type: EntityType,
  description: z.string().optional(),
});

// Stored entity includes namespace and summary
export const StoredEntity = Entity.extend({
  namespace: z.string().default("default"),
  summary: z.string().optional(), // LLM-generated summary of what we know about this entity
});

// =============================================================================
// EDGE TYPES - Facts as edges between entities (Graphiti-style)
// =============================================================================

// An extracted edge (fact as relationship between entities)
export const ExtractedEdge = z.object({
  relationType: z.string(),           // camelCase relation type (uses, prefers, hasAdvantageOver)
  sourceIndex: z.number().int(),      // Index into entities array
  targetIndex: z.number().int(),      // Index into entities array
  fact: z.string(),                   // Natural language description of the relationship
  sentiment: z.number().min(-1).max(1).default(0), // -1 (negative) to 1 (positive)
  confidence: z.number().min(0).max(1).default(1), // 0 (uncertain) to 1 (explicitly stated)
  confidenceReason: z.string().optional(), // Why this confidence level was assigned
  validAt: z.string().optional(),     // ISO 8601 when relationship became true
  invalidAt: z.string().optional(),   // ISO 8601 when relationship ended
});

// Stored edge includes metadata
export const StoredEdge = z.object({
  id: z.string(),
  sourceEntityName: z.string(),       // Source entity name
  targetEntityName: z.string(),       // Target entity name
  relationType: z.string(),           // camelCase relation type
  fact: z.string(),                   // Natural language description
  sentiment: z.number().min(-1).max(1), // -1 to 1
  confidence: z.number().min(0).max(1).default(1), // 0 (uncertain) to 1 (explicitly stated)
  confidenceReason: z.string().optional(), // Why this confidence level was assigned

  // Provenance
  episodes: z.array(z.string()),      // Memory IDs that reference this edge
  namespace: z.string().default("default"),

  // Temporal validity
  validAt: z.date().optional(),       // When relationship became true
  invalidAt: z.date().optional(),     // When relationship ended (human-set via forget)
  createdAt: z.date(),

  // Multi-user attribution
  createdBy: z.string().optional(),
});

// =============================================================================
// EXTRACTION TYPES
// =============================================================================

// Extraction result from Claude (edge-as-fact format)
export const Extraction = z.object({
  entities: z.array(Entity),          // Extract entities first (indexed 0, 1, 2...)
  edges: z.array(ExtractedEdge),      // Edges reference entities by index
  summary: z.string(),
});

// =============================================================================
// MEMORY TYPES
// =============================================================================

export const Memory = z.object({
  id: z.string(),
  name: z.string(),                    // User-provided or auto-generated from summary
  text: z.string(),                    // Original text
  summary: z.string(),                 // Claude-generated summary
  namespace: z.string().default("default"),
  createdAt: z.date(),
  createdBy: z.string().optional(),
});

// =============================================================================
// INTENT TYPES - Query intent classification for search boosting
// =============================================================================

export const Intent = z.enum(["factual", "decision", "general"]);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type EntityType = z.infer<typeof EntityType>;
export type Entity = z.infer<typeof Entity>;
export type StoredEntity = z.infer<typeof StoredEntity>;
export type ExtractedEdge = z.infer<typeof ExtractedEdge>;
export type StoredEdge = z.infer<typeof StoredEdge>;
export type Extraction = z.infer<typeof Extraction>;
export type Memory = z.infer<typeof Memory>;
export type Intent = z.infer<typeof Intent>;
