import { test, expect, describe } from "bun:test";
import { Entity, ExtractedEdge, Memory, Extraction } from "../src/types";

describe("Type Validation", () => {
  test("should validate Entity schema", () => {
    const validEntity = {
      name: "Alice",
      type: "person" as const,
      description: "A software engineer",
    };

    const parsed = Entity.parse(validEntity);
    expect(parsed.name).toBe("Alice");
    expect(parsed.type).toBe("person");
  });

  test("should validate ExtractedEdge schema", () => {
    const validEdge = {
      relationType: "uses",
      sourceIndex: 0,
      targetIndex: 1,
      fact: "Alice uses TypeScript for development",
    };

    const parsed = ExtractedEdge.parse(validEdge);
    expect(parsed.relationType).toBe("uses");
    expect(parsed.sourceIndex).toBe(0);
    expect(parsed.targetIndex).toBe(1);
    expect(parsed.fact).toBe("Alice uses TypeScript for development");
  });

  test("should validate Memory schema", () => {
    const validMemory = {
      id: "test-123",
      name: "Test Memory",
      text: "Alice prefers TypeScript",
      summary: "Alice's preference for TypeScript",
      namespace: "default",
      createdAt: new Date(),
    };

    const parsed = Memory.parse(validMemory);
    expect(parsed.id).toBe("test-123");
    expect(parsed.name).toBe("Test Memory");
  });

  test("should validate Extraction schema", () => {
    const validExtraction = {
      entities: [
        { name: "Alice", type: "person" as const },
        { name: "TypeScript", type: "technology" as const },
      ],
      edges: [
        {
          relationType: "prefers",
          sourceIndex: 0,
          targetIndex: 1,
          fact: "Alice prefers TypeScript",
        },
      ],
      summary: "Alice prefers TypeScript",
    };

    const parsed = Extraction.parse(validExtraction);
    expect(parsed.entities.length).toBe(2);
    expect(parsed.edges.length).toBe(1);
  });

  test("should reject invalid entity types", () => {
    expect(() => {
      Entity.parse({
        name: "Test",
        type: "invalid_type",
      });
    }).toThrow();
  });
});
