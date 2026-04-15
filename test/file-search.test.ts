import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, utimesSync } from "fs";
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

  // "indexed notes" — indexed, shares "notes" with gamma (unindexed) for sort testing.
  // Use an indexedAt explicitly 1 minute in the future so mtime (stamped at write
  // time) is deterministically less than indexedAt, avoiding flaky stale=true on
  // fast machines where file write lands after the new Date() call.
  const futureIndexedAt = new Date(Date.now() + 60_000).toISOString();
  writeMemoryFile(
    idIndexedNotes,
    "Some indexed notes body.",
    makeFrontmatter({ id: idIndexedNotes, name: "indexed notes", indexedAt: futureIndexedAt }),
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

describe("fileSearch — staleness (Spec Decision #8)", () => {
  test("unindexed entry is not stale", async () => {
    const results = await fileSearch("alpha", TEST_NS);
    const found = results.find((r) => r.id === idAlpha);
    expect(found!.indexed).toBe(false);
    expect(found!.stale).toBe(false);
  });

  test("indexed entry with mtime <= indexedAt is not stale", async () => {
    const results = await fileSearch("indexed notes", TEST_NS);
    const found = results.find((r) => r.id === idIndexedNotes);
    expect(found!.indexed).toBe(true);
    expect(found!.stale).toBe(false);
  });

  test("indexed entry with mtime > indexedAt is stale", async () => {
    // Bump the file's mtime to 1h after its indexedAt
    const ns = ensureNamespacePath(TEST_NS);
    const path = join(ns, `${idIndexedNotes}.md`);
    const futureMs = Date.now() + 60 * 60 * 1000;
    utimesSync(path, new Date(futureMs), new Date(futureMs));

    const results = await fileSearch("indexed notes", TEST_NS);
    const found = results.find((r) => r.id === idIndexedNotes);
    expect(found!.indexed).toBe(true);
    expect(found!.stale).toBe(true);

    // Reset mtime so later tests aren't affected
    const now = new Date();
    utimesSync(path, now, now);
  });

  test("Decision #8: mtime == indexedAt boundary — NOT stale (strict `>`)", async () => {
    // Spec says `stale = mtime > indexedAt`. Equality is the boundary that
    // distinguishes a correct `>` check from an off-by-one `>=`: right after
    // persistProcessedMemory stamps indexedAt and aligns mtime with utimesSync,
    // mtime === indexedAt. That file must read as NOT stale. An implementation
    // using `>=` would pass every other staleness test but fail here.
    const ns = ensureNamespacePath(TEST_NS);
    const id = randomUUID();
    const aligned = new Date(Date.now() - 1000); // past, to avoid setup-time jitter
    writeMemoryFile(
      id,
      "boundary body",
      makeFrontmatter({ id, name: "boundary notes", indexedAt: aligned.toISOString() }),
    );
    utimesSync(join(ns, `${id}.md`), aligned, aligned);

    const results = await fileSearch("boundary", TEST_NS);
    const found = results.find((r) => r.id === id);
    expect(found).toBeDefined();
    expect(found!.indexed).toBe(true);
    expect(found!.stale).toBe(false);
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
    // idBeta has body containing "ripgrep" AND name containing "ripgrep" would
    // never happen in practice, so use a query that matches both surfaces.
    // "ripgrep" query: body match via rg.
    // "beta" query: name match via index scan.
    // Either way beta should appear exactly once — the dedup contract.
    const results = await fileSearch("beta", TEST_NS);
    const betaMatches = results.filter((r) => r.id === idBeta);
    expect(betaMatches.length).toBe(1);
  });

  test("M18: name-only match stays source=\"index\" (frontmatter is not a body match)", async () => {
    // "beta" matches the frontmatter `name:` field of idBeta but does NOT
    // appear anywhere in the body. Before the M18 fix, ripgrep surfaced the
    // frontmatter line as a body hit and upgraded source to "file", feeding
    // LLM consumers a YAML fragment as the snippet. Correct behavior: the
    // index-scan name match wins, source stays "index", matchContext absent.
    const results = await fileSearch("beta", TEST_NS);
    const found = results.find((r) => r.id === idBeta);
    expect(found).toBeDefined();
    expect(found!.source).toBe("index");
    expect(found!.matchContext).toBeUndefined();
  });

  test("M18: body match upgrades source to \"file\" with a real body snippet", async () => {
    // "ripgrep target" appears in the body of idBeta only. A body match
    // must populate matchContext with the actual body line, not the
    // frontmatter `name:` line.
    const results = await fileSearch("ripgrep target", TEST_NS);
    const found = results.find((r) => r.id === idBeta);
    expect(found).toBeDefined();
    expect(found!.source).toBe("file");
    expect(found!.matchContext).toBeDefined();
    expect(found!.matchContext).toContain("ripgrep target");
    // Sanity: the frontmatter `name:` line is not what we surface.
    expect(found!.matchContext).not.toContain("name:");
  });
});

describe("fileSearch — tag filter", () => {
  test("returns only results with matching tag", async () => {
    const results = await fileSearch("", TEST_NS, { tags: ["important"] });
    expect(results.length).toBeGreaterThan(0);
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
      expect(results.length).toBe(3);
    } finally {
      rmSync(ensureNamespacePath(ns), { recursive: true, force: true });
    }
  });

  test("PRD edge case: extraction-failed (unindexed) memories remain keyword-searchable", async () => {
    // PRD edge-case table: "Extraction fails (LLM unavailable) → File remains
    // unindexed. Retried on next cycle. File is still searchable via keywords."
    // The cheapest way to simulate this without mocking the extractor is to
    // write a memory file without `indexedAt` — that's the on-disk shape an
    // unindexed file takes. ripgrep body-match must still find it, and the
    // result must carry indexed=false so consumers know enrichment is pending.
    const ns = `unindexed-keyword-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    try {
      writeMemoryFile(
        id,
        "platypus venom evolution research notes",
        {
          id,
          name: "platypus-research",
          origin: "manual",
          namespace: ns,
          tags: [],
          createdAt: new Date().toISOString(),
          // indexedAt deliberately omitted — extraction never completed.
        },
      );

      const results = await fileSearch("platypus", ns);
      const match = results.find((r) => r.id === id);
      expect(match).toBeDefined();
      expect(match!.indexed).toBe(false);
      expect(match!.indexedAt).toBeNull();
      // Stale only applies to indexed files (Decision #8: stale = mtime > indexedAt;
      // unindexed is "pending", not "stale").
      expect(match!.stale).toBe(false);
    } finally {
      rmSync(ensureNamespacePath(ns), { recursive: true, force: true });
    }
  });

  test("Decision #3: hard namespace isolation — search in ns-A returns nothing from ns-B", async () => {
    // Spec Decision #3: namespaces are hard isolation boundaries. A query
    // targeting ns-B must never surface a memory from ns-A — both via the
    // index-scan name-match path and the ripgrep body-match path.
    const nsA = `iso-a-${randomUUID().slice(0, 8)}`;
    const nsB = `iso-b-${randomUUID().slice(0, 8)}`;
    const aId = randomUUID();
    const bId = randomUUID();
    try {
      writeMemoryFile(aId, "Quokka habits and habitat",
        { id: aId, name: "quokka-notes", origin: "manual", namespace: nsA, tags: [], createdAt: new Date().toISOString() });
      writeMemoryFile(bId, "Different topic about engines",
        { id: bId, name: "engine-notes", origin: "manual", namespace: nsB, tags: [], createdAt: new Date().toISOString() });

      // Body query that only matches ns-A; searching from ns-B must return [].
      const fromBBody = await fileSearch("quokka", nsB);
      expect(fromBBody.find((r) => r.id === aId)).toBeUndefined();

      // Name query that only matches ns-A; searching from ns-B must return [].
      const fromBName = await fileSearch("quokka-notes", nsB);
      expect(fromBName.find((r) => r.id === aId)).toBeUndefined();

      // Sanity: from ns-A we still find ns-A's memory.
      const fromASelf = await fileSearch("quokka", nsA);
      expect(fromASelf.find((r) => r.id === aId)).toBeDefined();
    } finally {
      rmSync(ensureNamespacePath(nsA), { recursive: true, force: true });
      rmSync(ensureNamespacePath(nsB), { recursive: true, force: true });
    }
  });

  test("treats queries starting with dashes as literals, not ripgrep flags", async () => {
    const ns = `dash-query-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();

    try {
      writeMemoryFile(
        id,
        "Body contains --literal-query for ripgrep.",
        {
          id,
          name: "dash query memory",
          origin: "manual",
          namespace: ns,
          tags: [],
          createdAt: new Date().toISOString(),
        },
      );

      const results = await fileSearch("--literal-query", ns);
      expect(results.find((result) => result.id === id)).toBeDefined();
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
