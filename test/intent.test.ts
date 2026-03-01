import { test, expect, describe } from "bun:test";
import { classifyIntent, boostEdgesByIntent } from "../src/lib/intents";
import type { StoredEdge } from "../src/types";

// =============================================================================
// Intent Classification Tests (20+ examples)
// =============================================================================

describe("classifyIntent", () => {
  describe("factual intent", () => {
    const factualQueries = [
      "What is DashFrame?",
      "What are the main components?",
      "What does the queue module do?",
      "What do we use for state management?",
      "What tools do we use for testing?",
      "What technology stack does the project use?",
      "What framework are we using?",
      "What libraries are installed?",
      "How does the search work?",
      "How do we handle authentication?",
      "Tell me about the graph provider",
      "Describe the edge extraction process",
      "Explain the RRF algorithm",
      "Which database is used for storage?",
    ];

    for (const query of factualQueries) {
      test(`"${query}" → factual`, () => {
        expect(classifyIntent(query)).toBe("factual");
      });
    }
  });

  describe("decision intent", () => {
    const decisionQueries = [
      "Why did we choose Zustand over Redux?",
      "Why should we use Bun?",
      "Why not use PostgreSQL?",
      "Should we switch to Drizzle?",
      "Should I use React or Solid?",
      "Which is better than the other?",
      "What are the advantages of LadybugDB over Neo4j?",
      "Compare Tailwind vs CSS modules",
      "Zustand vs Redux?",
      "What are the pros and cons of edge-as-fact?",
      "Why did we reject GraphQL?",
      "Should we prefer server components?",
      "What are the tradeoffs of using Bun?",
      "React instead of Svelte?",
    ];

    for (const query of decisionQueries) {
      test(`"${query}" → decision`, () => {
        expect(classifyIntent(query)).toBe("decision");
      });
    }
  });

  describe("ambiguous queries (decision wins over factual)", () => {
    const ambiguousQueries: [string, "factual" | "decision"][] = [
      ["Why do we use Zustand?", "decision"],           // "why do" (decision) + "use" (factual context)
      ["What are the advantages of Bun?", "decision"],  // "what are" (factual) + "advantages" (decision)
      ["Should we use TypeScript?", "decision"],        // "should we" (decision) + "use" (factual context)
    ];

    for (const [query, expected] of ambiguousQueries) {
      test(`"${query}" → ${expected}`, () => {
        expect(classifyIntent(query)).toBe(expected);
      });
    }
  });

  describe("general intent", () => {
    const generalQueries = [
      "TypeScript",
      "knowledgebase project",
      "graph database stuff",
      "embedding model",
      "recent changes",
      "list all entities",
    ];

    for (const query of generalQueries) {
      test(`"${query}" → general`, () => {
        expect(classifyIntent(query)).toBe("general");
      });
    }
  });
});

// =============================================================================
// Edge Boosting Tests
// =============================================================================

function makeEdge(overrides: Partial<StoredEdge>): StoredEdge {
  return {
    id: overrides.id ?? "edge-1",
    sourceEntityName: "A",
    targetEntityName: "B",
    relationType: overrides.relationType ?? "uses",
    fact: overrides.fact ?? "A uses B",
    sentiment: overrides.sentiment ?? 0,
    confidence: overrides.confidence ?? 1,
    episodes: [],
    namespace: "default",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("boostEdgesByIntent", () => {
  const mixedEdges = [
    makeEdge({ id: "e1", relationType: "worksAt", fact: "Alice works at Acme" }),
    makeEdge({ id: "e2", relationType: "prefers", fact: "Team prefers Zustand", sentiment: 0.8 }),
    makeEdge({ id: "e3", relationType: "uses", fact: "Project uses TypeScript" }),
    makeEdge({ id: "e4", relationType: "chose", fact: "Team chose Bun over Node", sentiment: 0.6 }),
    makeEdge({ id: "e5", relationType: "hasFeature", fact: "Bun has native test runner" }),
  ];

  test("general intent preserves original order", () => {
    const result = boostEdgesByIntent(mixedEdges, "general");
    expect(result.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  test("factual intent boosts uses/hasFeature/worksAt edges", () => {
    const result = boostEdgesByIntent(mixedEdges, "factual");
    // worksAt (e1), uses (e3), hasFeature (e5) should come first
    const boostedIds = result.slice(0, 3).map((e) => e.id);
    expect(boostedIds).toContain("e1");
    expect(boostedIds).toContain("e3");
    expect(boostedIds).toContain("e5");
    // prefers (e2) and chose (e4) should be after
    const restIds = result.slice(3).map((e) => e.id);
    expect(restIds).toContain("e2");
    expect(restIds).toContain("e4");
  });

  test("decision intent boosts prefers/chose edges", () => {
    const result = boostEdgesByIntent(mixedEdges, "decision");
    // prefers (e2) and chose (e4) should come first
    const boostedIds = result.slice(0, 2).map((e) => e.id);
    expect(boostedIds).toContain("e2");
    expect(boostedIds).toContain("e4");
  });

  test("decision intent sorts by absolute sentiment within boosted group", () => {
    const result = boostEdgesByIntent(mixedEdges, "decision");
    const boosted = result.filter((e) => ["prefers", "chose"].includes(e.relationType));
    // e2 (sentiment 0.8) should come before e4 (sentiment 0.6)
    expect(boosted[0]!.id).toBe("e2");
    expect(boosted[1]!.id).toBe("e4");
  });

  test("does not remove any edges", () => {
    for (const intent of ["factual", "decision", "general"] as const) {
      const result = boostEdgesByIntent(mixedEdges, intent);
      expect(result.length).toBe(mixedEdges.length);
    }
  });

  test("handles empty edge list", () => {
    expect(boostEdgesByIntent([], "factual")).toEqual([]);
    expect(boostEdgesByIntent([], "decision")).toEqual([]);
    expect(boostEdgesByIntent([], "general")).toEqual([]);
  });

  test("does not mutate original array", () => {
    const original = [...mixedEdges];
    boostEdgesByIntent(mixedEdges, "factual");
    expect(mixedEdges.map((e) => e.id)).toEqual(original.map((e) => e.id));
  });

  test("negative sentiment edges boosted in decision intent", () => {
    const edges = [
      makeEdge({ id: "e1", relationType: "uses", fact: "uses X" }),
      makeEdge({ id: "e2", relationType: "rejected", fact: "rejected Y", sentiment: -0.9 }),
      makeEdge({ id: "e3", relationType: "avoids", fact: "avoids Z", sentiment: -0.5 }),
    ];
    const result = boostEdgesByIntent(edges, "decision");
    // rejected and avoids should come first, rejected first (higher abs sentiment)
    expect(result[0]!.id).toBe("e2");
    expect(result[1]!.id).toBe("e3");
  });
});
