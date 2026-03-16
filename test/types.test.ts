import { test, expect, describe } from "bun:test";
import { Entity, ExtractedEdge, Memory, Extraction, MemoryCategory } from "../src/types";

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
    expect(parsed.confidence).toBe(1); // default
  });

  test("should validate ExtractedEdge with confidence", () => {
    const edgeWithConfidence = {
      relationType: "prefers",
      sourceIndex: 0,
      targetIndex: 1,
      fact: "Alice prefers TypeScript",
      sentiment: 0.8,
      confidence: 0.6,
      confidenceReason: "inferred from context",
    };

    const parsed = ExtractedEdge.parse(edgeWithConfidence);
    expect(parsed.confidence).toBe(0.6);
    expect(parsed.confidenceReason).toBe("inferred from context");
  });

  test("should reject confidence outside 0-1 range", () => {
    expect(() => {
      ExtractedEdge.parse({
        relationType: "uses",
        sourceIndex: 0,
        targetIndex: 1,
        fact: "test",
        confidence: 1.5,
      });
    }).toThrow();

    expect(() => {
      ExtractedEdge.parse({
        relationType: "uses",
        sourceIndex: 0,
        targetIndex: 1,
        fact: "test",
        confidence: -0.1,
      });
    }).toThrow();
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
      abstract: "Alice prefers TypeScript over other languages",
      summary: "Alice prefers TypeScript",
      category: "preference" as const,
    };

    const parsed = Extraction.parse(validExtraction);
    expect(parsed.entities.length).toBe(2);
    expect(parsed.edges.length).toBe(1);
    expect(parsed.category).toBe("preference");
    expect(parsed.abstract).toBe("Alice prefers TypeScript over other languages");
  });

  test("should accept Extraction without category (optional for LLM resilience)", () => {
    const parsed = Extraction.parse({
      entities: [],
      edges: [],
      abstract: "test abstract",
      summary: "test",
    });
    expect(parsed.category).toBeUndefined();
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

describe("MemoryCategory", () => {
  test("should accept valid categories", () => {
    expect(MemoryCategory.parse("preference")).toBe("preference");
    expect(MemoryCategory.parse("event")).toBe("event");
    expect(MemoryCategory.parse("pattern")).toBe("pattern");
    expect(MemoryCategory.parse("general")).toBe("general");
  });

  test("should reject invalid categories", () => {
    expect(() => MemoryCategory.parse("entity")).toThrow();
    expect(() => MemoryCategory.parse("case")).toThrow();
    expect(() => MemoryCategory.parse("")).toThrow();
  });

  test("Memory should accept optional category", () => {
    const withCategory = Memory.parse({
      id: "test-1",
      name: "Test",
      text: "I prefer Bun",
      summary: "Preference for Bun",
      category: "preference",
      namespace: "default",
      createdAt: new Date(),
    });
    expect(withCategory.category).toBe("preference");

    const withoutCategory = Memory.parse({
      id: "test-2",
      name: "Test",
      text: "Some text",
      summary: "A summary",
      namespace: "default",
      createdAt: new Date(),
    });
    expect(withoutCategory.category).toBeUndefined();
  });

  test("Memory should reject invalid category", () => {
    expect(() =>
      Memory.parse({
        id: "test-3",
        name: "Test",
        text: "Some text",
        summary: "A summary",
        category: "invalid",
        namespace: "default",
        createdAt: new Date(),
      }),
    ).toThrow();
  });

  test("category fallback: undefined extraction category defaults to general in queue", () => {
    // Simulates what queue.ts does: extraction returns undefined category → fallback to "general"
    const extractionResult = Extraction.parse({
      entities: [],
      edges: [],
      abstract: "test abstract",
      summary: "test",
    });
    const category = extractionResult.category ?? "general";
    expect(category).toBe("general");
  });
});
