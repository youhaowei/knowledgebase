import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Set KB_MEMORY_PATH before importing fs-memory
const tempDir = mkdtempSync(join(tmpdir(), "kb-search-test-"));
process.env.KB_MEMORY_PATH = tempDir;

import { writeMemoryFile, ensureNamespacePath, type MemoryFrontmatter } from "../src/lib/fs-memory";
import { fileSearch } from "../src/lib/file-search";

// ---------------------------------------------------------------------------
// Test namespace — unique per run, cleaned up in afterAll
// ---------------------------------------------------------------------------

const TEST_NS = `file-search-test-${randomUUID().slice(0, 8)}`;

function makeFrontmatter(overrides: Partial<MemoryFrontmatter> & { id: string; name: string }): MemoryFrontmatter {
  return {
    origin: "manual",
    namespace: TEST_NS,
    tags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// Seed memories before tests
let idAlpha: string;
let idBeta: string;
let idGamma: string;
let idTagged: string;
let idIndexedNotes: string;

beforeAll(async () => {
  idAlpha = randomUUID();
  idBeta = randomUUID();
  idGamma = randomUUID();
  idTagged = randomUUID();
  idIndexedNotes = randomUUID();

  // "alpha memory" — name matches "alpha"
  await writeMemoryFile(
    idAlpha,
    "This is the alpha memory body text.",
    makeFrontmatter({ id: idAlpha, name: "alpha memory", tags: ["tech"] }),
  );

  // "beta project" — name matches "beta", body has "ripgrep target"
  await writeMemoryFile(
    idBeta,
    "This file contains a ripgrep target string for body search.",
    makeFrontmatter({ id: idBeta, name: "beta project", indexedAt: new Date().toISOString() }),
  );

  // "gamma notes" — only body matches "exclusive-body-phrase"
  await writeMemoryFile(
    idGamma,
    "Here is an exclusive-body-phrase that only rg can find.",
    makeFrontmatter({ id: idGamma, name: "gamma notes" }),
  );

  // "tagged item" — has tags ["important"], name matches "tagged"
  await writeMemoryFile(
    idTagged,
    "Tagged item body.",
    makeFrontmatter({ id: idTagged, name: "tagged item", tags: ["important"] }),
  );

  // "indexed notes" — indexed, shares "notes" with gamma (unindexed) for sort testing
  writeMemoryFile(
    idIndexedNotes,
    "Some indexed notes body.",
    makeFrontmatter({ id: idIndexedNotes, name: "indexed notes", indexedAt: new Date().toISOString() }),
  );
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.KB_MEMORY_PATH;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fileSearch — name matching (index scan)", () => {
  test("returns result matching name", async () => {
    const results = await fileSearch("alpha", TEST_NS);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const found = results.find((r) => r.id === idAlpha);
    expect(found).toBeDefined();
    expect(found!.name).toBe("alpha memory");
    expect(found!.source).toBe("file");
    expect(found!.stale).toBe(false);
  });

  test("is case-insensitive", async () => {
    const results = await fileSearch("ALPHA", TEST_NS);
    expect(results.find((r) => r.id === idAlpha)).toBeDefined();
  });

  test("matches substring in name", async () => {
    const results = await fileSearch("lph", TEST_NS);
    expect(results.find((r) => r.id === idAlpha)).toBeDefined();
  });

  test("returns indexed status correctly", async () => {
    const results = await fileSearch("beta", TEST_NS);
    const found = results.find((r) => r.id === idBeta);
    expect(found).toBeDefined();
    expect(found!.indexed).toBe(true);

    const alphaResults = await fileSearch("alpha", TEST_NS);
    const alphaFound = alphaResults.find((r) => r.id === idAlpha);
    expect(alphaFound!.indexed).toBe(false);
  });

  test("indexed files sort before unindexed", async () => {
    // "notes" matches both "gamma notes" (unindexed) and "indexed notes" (indexed)
    const results = await fileSearch("notes", TEST_NS);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const gammaIdx = results.findIndex((r) => r.id === idGamma);
    const indexedNotesIdx = results.findIndex((r) => r.id === idIndexedNotes);
    expect(gammaIdx).not.toBe(-1);
    expect(indexedNotesIdx).not.toBe(-1);
    // Indexed should come before unindexed
    expect(indexedNotesIdx).toBeLessThan(gammaIdx);
  });
});

describe("fileSearch — body text matching (ripgrep)", () => {
  test("returns result matching body text", async () => {
    const results = await fileSearch("ripgrep target", TEST_NS);
    const found = results.find((r) => r.id === idBeta);
    expect(found).toBeDefined();
  });

  test("returns matchContext snippet for body matches", async () => {
    const results = await fileSearch("ripgrep target", TEST_NS);
    const found = results.find((r) => r.id === idBeta);
    expect(found).toBeDefined();
    expect(found!.matchContext).toBeDefined();
    expect(found!.matchContext!.toLowerCase()).toContain("ripgrep");
  });

  test("finds exclusive body phrase not in name", async () => {
    const results = await fileSearch("exclusive-body-phrase", TEST_NS);
    const found = results.find((r) => r.id === idGamma);
    expect(found).toBeDefined();
    expect(found!.name).toBe("gamma notes");
  });
});

describe("fileSearch — deduplication", () => {
  test("deduplicates by ID when name and body both match", async () => {
    // "beta project" name matches "beta" AND body has "ripgrep target"
    // If we search "ripgrep", beta appears via rg
    // If we search "beta", beta appears via index scan
    // Either way it should appear only once
    const results = await fileSearch("beta", TEST_NS);
    const betaMatches = results.filter((r) => r.id === idBeta);
    expect(betaMatches.length).toBe(1);
  });

  test("index scan result wins for metadata when both sources match", async () => {
    // "beta" matches both name AND body has "ripgrep target"
    // After a broader search, beta should appear once with index scan metadata
    const results = await fileSearch("beta", TEST_NS);
    const found = results.find((r) => r.id === idBeta);
    expect(found).toBeDefined();
    expect(found!.source).toBe("file");
  });
});

describe("fileSearch — tag filter", () => {
  test("returns only results with matching tag", async () => {
    const results = await fileSearch("", TEST_NS, { tags: ["important"] });
    // All results should have the "important" tag
    for (const r of results) {
      expect(r.tags).toContain("important");
    }
    expect(results.find((r) => r.id === idTagged)).toBeDefined();
  });

  test("excludes results without matching tag", async () => {
    const results = await fileSearch("alpha", TEST_NS, { tags: ["important"] });
    // "alpha memory" has tags ["tech"], not ["important"]
    expect(results.find((r) => r.id === idAlpha)).toBeUndefined();
  });

  test("tag filter works alongside name match", async () => {
    const results = await fileSearch("tagged", TEST_NS, { tags: ["important"] });
    expect(results.find((r) => r.id === idTagged)).toBeDefined();
  });

  test("normalizes tag filters before matching", async () => {
    const results = await fileSearch("alpha", TEST_NS, { tags: ["Tech"] });
    expect(results.find((r) => r.id === idAlpha)).toBeDefined();
  });
});

describe("fileSearch — edge cases", () => {
  test("handles missing namespace gracefully (returns empty array)", async () => {
    const results = await fileSearch("anything", `nonexistent-ns-${randomUUID()}`);
    expect(results).toEqual([]);
  });

  test("respects limit option", async () => {
    // Write many files to verify limit
    const ns = `limit-test-${randomUUID().slice(0, 8)}`;
    try {
      for (let i = 0; i < 5; i++) {
        const id = randomUUID();
        await writeMemoryFile(
          id,
          `Memory number ${i} with matching text`,
          {
            id,
            name: `memory ${i}`,
            origin: "manual",
            namespace: ns,
            tags: [],
            createdAt: new Date().toISOString(),
          },
        );
      }
      const results = await fileSearch("memory", ns, { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    } finally {
      rmSync(ensureNamespacePath(ns), { recursive: true, force: true });
    }
  });

  test("works when rg finds nothing (index scan still returns results)", async () => {
    // Search for a name that exists but with a body query that won't match rg
    // The index scan path should still work
    const results = await fileSearch("alpha", TEST_NS);
    // Should still get index scan results even if rg returned nothing useful
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
