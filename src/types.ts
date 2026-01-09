import { z } from "zod";

// Item types that can be extracted from text
export const ItemType = z.enum([
  "person",
  "organization",
  "project",
  "technology",
  "concept",
  "preference",
  "decision",
]);

// An extracted entity from text
export const Item = z.object({
  name: z.string(),
  type: ItemType,
  description: z.string().optional(),
});

// A relation between two items
export const Relation = z.object({
  from: z.string(), // Item name (source)
  relation: z.string(), // Relation type: "uses", "prefers", "works_on", etc.
  to: z.string(), // Item name (target)
});

// Stored relation includes metadata
export const StoredRelation = Relation.extend({
  id: z.string(),
  memoryId: z.string(), // Which memory this relation came from
  createdAt: z.date(),
});

// Resolution record for conflict resolution
export const Resolution = z.object({
  id: z.string(),
  conflictingRelations: z.array(z.string()), // Relation IDs that conflicted
  decision: z.enum(["keep_newer", "keep_older", "keep_both", "keep_neither"]),
  keptRelationId: z.string().optional(), // Which relation was kept (if not both/neither)
  createdAt: z.date(),
});

// Extraction result from Claude
export const Extraction = z.object({
  items: z.array(Item),
  relations: z.array(Relation),
  summary: z.string(),
});

// A memory node in the graph
export const Memory = z.object({
  id: z.string(),
  name: z.string(), // User-provided or auto-generated from summary
  text: z.string(), // Original text
  summary: z.string(), // Claude-generated summary
  namespace: z.string().default("default"),
  createdAt: z.date(),
});

// Type exports
export type ItemType = z.infer<typeof ItemType>;
export type Item = z.infer<typeof Item>;
export type Relation = z.infer<typeof Relation>;
export type StoredRelation = z.infer<typeof StoredRelation>;
export type Resolution = z.infer<typeof Resolution>;
export type Extraction = z.infer<typeof Extraction>;
export type Memory = z.infer<typeof Memory>;
