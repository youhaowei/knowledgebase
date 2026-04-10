import { describe, expect, test } from "bun:test";

import { filterGraphResultsByTaggedFileIds } from "../src/lib/hybrid-search";

describe("filterGraphResultsByTaggedFileIds", () => {
  test("filters memories, edges, and entities to the tagged memory set", () => {
    const taggedOnly = new Set(["mem-tagged"]);
    const result = filterGraphResultsByTaggedFileIds(
      {
        memories: [
          {
            id: "mem-tagged",
            name: "Tagged Memory",
            text: "tagged text",
            abstract: "tagged abstract",
            summary: "tagged summary",
            namespace: "default",
            schemaVersion: "0.0.0",
            createdAt: new Date("2026-04-08T00:00:00.000Z"),
          },
          {
            id: "mem-other",
            name: "Other Memory",
            text: "other text",
            abstract: "other abstract",
            summary: "other summary",
            namespace: "default",
            schemaVersion: "0.0.0",
            createdAt: new Date("2026-04-08T00:00:00.000Z"),
          },
        ],
        edges: [
          {
            id: "edge-tagged",
            sourceEntityName: "Tagged Entity",
            targetEntityName: "Shared Entity",
            relationType: "mentions",
            fact: "Tagged memory mentions the shared entity",
            sentiment: 0,
            confidence: 1,
            episodes: ["mem-tagged"],
            namespace: "default",
            createdAt: new Date("2026-04-08T00:00:00.000Z"),
          },
          {
            id: "edge-other",
            sourceEntityName: "Other Entity",
            targetEntityName: "Leak Entity",
            relationType: "mentions",
            fact: "Other memory should be filtered out",
            sentiment: 0,
            confidence: 1,
            episodes: ["mem-other"],
            namespace: "default",
            createdAt: new Date("2026-04-08T00:00:00.000Z"),
          },
        ],
        entities: [
          { name: "Tagged Entity", type: "concept", namespace: "default" },
          { name: "Shared Entity", type: "concept", namespace: "default" },
          { name: "Leak Entity", type: "concept", namespace: "default" },
        ],
        intent: "general",
        guidance: "guidance",
      },
      taggedOnly,
    );

    expect(result.memories.map((memory) => memory.id)).toEqual(["mem-tagged"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["edge-tagged"]);
    expect(result.entities.map((entity) => entity.name)).toEqual(["Tagged Entity", "Shared Entity"]);
  });
});
