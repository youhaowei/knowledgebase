import { test, expect, describe } from "bun:test";
import {
  normalizeEntityName,
  findMatchingEntity,
  groupDuplicateEntities,
} from "../src/lib/entity-matcher";

describe("normalizeEntityName", () => {
  test("lowercases", () => {
    expect(normalizeEntityName("Sonnet Agent")).toBe("sonnet agent");
    expect(normalizeEntityName("ZUSTAND")).toBe("zustand");
  });

  test("strips leading slash", () => {
    expect(normalizeEntityName("/bugfix skill")).toBe("bugfix skill");
    expect(normalizeEntityName("//foo")).toBe("foo");
  });

  test("normalizes hyphens and underscores to spaces", () => {
    expect(normalizeEntityName("drag-and-drop")).toBe("drag and drop");
    expect(normalizeEntityName("some_thing")).toBe("some thing");
  });

  test("collapses whitespace", () => {
    expect(normalizeEntityName("  motion   animation  ")).toBe("motion animation");
  });

  test("trims", () => {
    expect(normalizeEntityName("  hello  ")).toBe("hello");
  });

  test("does NOT singularize (LLM handles semantics)", () => {
    // Normalization is intentionally minimal — no singularization
    expect(normalizeEntityName("animations")).toBe("animations");
    expect(normalizeEntityName("categories")).toBe("categories");
    expect(normalizeEntityName("series")).toBe("series");
  });
});

describe("findMatchingEntity", () => {
  const candidates = [
    { uuid: "a", name: "Bugfix Skill" },
    { uuid: "b", name: "React" },
    { uuid: "c", name: "drag-and-drop" },
  ];

  test("finds case-insensitive match", () => {
    const match = findMatchingEntity("bugfix skill", candidates);
    expect(match?.uuid).toBe("a");
  });

  test("finds slash-prefix match", () => {
    const match = findMatchingEntity("/bugfix skill", candidates);
    expect(match?.uuid).toBe("a");
  });

  test("finds hyphen-to-space match", () => {
    const match = findMatchingEntity("drag and drop", candidates);
    expect(match?.uuid).toBe("c");
  });

  test("returns null for no match", () => {
    const match = findMatchingEntity("Zustand", candidates);
    expect(match).toBeNull();
  });
});

describe("groupDuplicateEntities", () => {
  test("groups entities with same normalized name", () => {
    const entities = [
      { uuid: "1", name: "Bugfix Skill", type: "concept" as const, namespace: "default" },
      { uuid: "2", name: "/bugfix skill", type: "concept" as const, namespace: "default" },
      { uuid: "3", name: "React", type: "technology" as const, namespace: "default" },
    ];

    const groups = groupDuplicateEntities(entities);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.keep.uuid).toBe("1");
    expect(groups[0]!.duplicates).toHaveLength(1);
    expect(groups[0]!.duplicates[0]!.uuid).toBe("2");
  });

  test("respects namespace boundaries", () => {
    const entities = [
      { uuid: "1", name: "React", type: "technology" as const, namespace: "project-a" },
      { uuid: "2", name: "react", type: "technology" as const, namespace: "project-b" },
    ];

    const groups = groupDuplicateEntities(entities);
    expect(groups).toHaveLength(0);
  });

  test("returns empty for no duplicates", () => {
    const entities = [
      { uuid: "1", name: "React", type: "technology" as const, namespace: "default" },
      { uuid: "2", name: "Zustand", type: "technology" as const, namespace: "default" },
    ];

    const groups = groupDuplicateEntities(entities);
    expect(groups).toHaveLength(0);
  });
});
