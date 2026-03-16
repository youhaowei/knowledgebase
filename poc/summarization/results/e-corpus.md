# E: Multi-Corpus Test

## Corpus: web-components (src/web/components/)

### types.ts

_55 lines, skeleton 676 chars (43% of 1565)_

**AST Skeleton:**
```
**Types:**
- interface GraphNode { id: string;; name: string;; type: string;; itemType?: string;; namespace?: string;; description?: string;; summary?: string;; importance?: number;; degree?: number;; x?: number;; y?: number;; fx?: number | null;; fy?: number | null; }
- interface GraphLink { source: string | GraphNode;; target: string | GraphNode;; relationType: string;; fact: string;; sentiment: number;; confidence: number;; edgeId: string;; relation?: string;; strength?: number; }
- interface Memory { id: string;; name: string;; type?: string;; summary?: string;; createdAt?: Date | string; }
- interface Stats { memories: number;; entities: number;; edges: number; }
```

**Hybrid (AST→LLM)** _(22054ms)_:
This file defines the core data models for a knowledge graph application, establishing interfaces for nodes, links, and system metadata. The `GraphNode` and `GraphLink` interfaces represent the fundamental units of a semantic network, capturing entity attributes like importance and degree alongside relational facts with sentiment analysis. Supporting structures include `Memory` for temporal context management and `Stats` for tracking aggregate metrics such as entity counts and edge density. These types serve as the architectural foundation for rendering interactive graph visualizations and managing underlying knowledge base operations.

**Full LLM** _(12117ms)_:
This file defines the core TypeScript interfaces for an "edge-as-fact" knowledge graph, modeling entities as nodes and relationships as directed edges with semantic properties. It exports `GraphNode` and `GraphLink` interfaces that enforce a specific data model where links carry explicit `relationType`, natural language `fact` descriptions, and sentiment/confidence scores for visualization logic. The `Memory` interface supports metadata tracking for stored items, while `Stats` provides aggregate counts for entities and edges to drive dashboard rendering. Design decisions include normalizing importance metrics to 0-1 ranges for visual encoding and supporting legacy `relation` aliases alongside the primary `relationType` for backward compatibility.
