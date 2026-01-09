import { test, expect, describe } from "bun:test";
import { Item, Relation, Memory, Extraction } from "../src/types";

describe("Type Validation", () => {
  test("should validate Item schema", () => {
    const validItem = {
      name: "Alice",
      type: "person" as const,
      description: "A software engineer",
    };

    const parsed = Item.parse(validItem);
    expect(parsed.name).toBe("Alice");
    expect(parsed.type).toBe("person");
  });

  test("should validate Relation schema", () => {
    const validRelation = {
      from: "Alice",
      relation: "uses",
      to: "TypeScript",
    };

    const parsed = Relation.parse(validRelation);
    expect(parsed.from).toBe("Alice");
    expect(parsed.relation).toBe("uses");
    expect(parsed.to).toBe("TypeScript");
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
      items: [
        { name: "Alice", type: "person" as const },
        { name: "TypeScript", type: "technology" as const },
      ],
      relations: [{ from: "Alice", relation: "prefers", to: "TypeScript" }],
      summary: "Alice prefers TypeScript",
    };

    const parsed = Extraction.parse(validExtraction);
    expect(parsed.items.length).toBe(2);
    expect(parsed.relations.length).toBe(1);
  });

  test("should reject invalid item types", () => {
    expect(() => {
      Item.parse({
        name: "Test",
        type: "invalid_type",
      });
    }).toThrow();
  });
});
