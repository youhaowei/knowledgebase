/**
 * Shared TypeScript types for the frontend
 */

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  itemType?: string;
  namespace: string;
  // Importance metrics for visual encoding
  importance: number; // 0-1, normalized score from degree + references
  degree: number; // Connection count (in + out)
  referenceCount: number; // How many memories reference this item
  // Position fields (managed by Vega force simulation)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relation: string;
  // Strength metrics for visual encoding
  strength: number; // 0-1, normalized from frequency
  frequency: number; // How many times this relation was asserted
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
  items: number;
  relations: number;
}
