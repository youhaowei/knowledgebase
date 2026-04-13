/**
 * Shared TypeScript types for the frontend
 *
 * Updated for edge-as-fact knowledge graph model:
 * - Entities are nodes
 * - Facts are edges (RELATES_TO relationships between entities)
 * - Each edge has relationType and sentiment
 */

export interface GraphNode {
  id: string;
  name: string;
  type: string; // "Entity"
  itemType?: string; // Entity type: person, organization, project, technology, concept
  namespace?: string;
  description?: string;
  summary?: string;
  // Importance metrics for visual encoding
  importance?: number; // 0-1, normalized score
  degree?: number; // Number of edges involving this entity
  // Position fields (managed by force simulation)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  // Edge-as-Fact properties
  relationType: string; // camelCase relation (uses, prefers, hasAdvantageOver, etc.)
  fact: string; // Natural language description of the relationship
  sentiment: number; // -1 (negative) to 1 (positive)
  confidence: number; // 0 (uncertain) to 1 (explicitly stated)
  edgeId: string; // UUID for the edge
  // Legacy support (can be computed from relationType)
  relation?: string; // Alias for relationType
  strength?: number; // Can be derived from sentiment (0-1)
}

export interface Memory {
  id: string;
  name: string;
  type?: string;
  summary?: string;
  createdAt?: Date | string;
}

export interface Stats {
  memories: number;
  entities: number | null;  // null when graph is unavailable (degraded mode)
  edges: number | null;     // null when graph is unavailable (degraded mode)
  degraded?: boolean;       // true when graph stats were skipped
  filesOnDisk?: number;
  indexed?: number;
}
