import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  utimesSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Set KB_MEMORY_PATH BEFORE importing fs-memory — the module reads env lazily
// via getKbRoot(), so this must be set before any fs-memory function is called.
const tempDir = mkdtempSync(join(tmpdir(), "kb-fs-test-"));
process.env.KB_MEMORY_PATH = tempDir;

const TEST_NAMESPACE = "test-ns";
const testNsPath = join(tempDir, TEST_NAMESPACE);

import {
  normalizeTags,
  parseFrontmatter,
  writeMemoryFile,
  readMemoryFile,
  listMemoryFiles,
  generateIndex,
  appendToIndex,
  ensureNamespacePath,
  resolveNamespacePath,
  deleteMemoryFile,
  withNamespaceLock,
  configureFsMemoryTimingForTests,
  resetFsMemoryTimingForTests,
  MemoryFrontmatter,
} from "../src/lib/fs-memory";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  mkdirSync(testNsPath, { recursive: true });
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.KB_MEMORY_PATH;
  resetFsMemoryTimingForTests();
});

afterEach(() => {
  resetFsMemoryTimingForTests();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrontmatter(overrides?: Partial<MemoryFrontmatter>): MemoryFrontmatter {
  return {
    id: randomUUID(),
    name: "Test Memory",
    origin: "manual",
    namespace: "default",
    tags: ["tech", "test"],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeTags
// ---------------------------------------------------------------------------

describe("normalizeTags", () => {
  test("lowercases tags", () => {
    expect(normalizeTags(["Tech", "PROJECT"])).toEqual(["tech", "project"]);
  });

  test("converts spaces to hyphens", () => {
    expect(normalizeTags(["my tag", "another tag"])).toEqual(["my-tag", "another-tag"]);
  });

  test("converts underscores to hyphens", () => {
    expect(normalizeTags(["my_tag", "some_thing"])).toEqual(["my-tag", "some-thing"]);
  });

  test("strips special characters", () => {
    expect(normalizeTags(["c++ tips", "node.js"])).toEqual(["c-tips", "nodejs"]);
  });

  test("collapses multiple hyphens", () => {
    expect(normalizeTags(["my--tag", "a - b"])).toEqual(["my-tag", "a-b"]);
  });

  test("strips leading/trailing hyphens", () => {
    expect(normalizeTags(["-leading", "trailing-"])).toEqual(["leading", "trailing"]);
  });

  test("filters empty results", () => {
    expect(normalizeTags(["---", "!!!", ""])).toEqual([]);
  });

  test("handles already-normalized tags", () => {
    expect(normalizeTags(["my-tag", "project"])).toEqual(["my-tag", "project"]);
  });

  test("handles empty array", () => {
    expect(normalizeTags([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  test("parses valid frontmatter", () => {
    const id = randomUUID();
    const content = `---
id: "${id}"
name: My Memory
origin: manual
namespace: default
tags:
  - tech
createdAt: "2026-04-06T12:00:00.000Z"
---

Body text here.`;

    const { frontmatter, text } = parseFrontmatter(content);
    expect(frontmatter.id).toBe(id);
    expect(frontmatter.name).toBe("My Memory");
    expect(frontmatter.origin).toBe("manual");
    expect(frontmatter.namespace).toBe("default");
    expect(frontmatter.tags).toEqual(["tech"]);
    expect(text).toBe("Body text here.");
  });

  test("handles optional fields absent", () => {
    const id = randomUUID();
    const content = `---
id: "${id}"
name: Simple
origin: retro
namespace: retro
tags: []
createdAt: "2026-04-06T12:00:00.000Z"
---

Text.`;
    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.indexedAt).toBeUndefined();
    expect(frontmatter.abstract).toBeUndefined();
  });

  test("throws on invalid frontmatter", () => {
    const content = `---
id: "not-a-uuid"
name: Bad
origin: invalid-origin
namespace: default
tags: []
createdAt: "2026-04-06T12:00:00.000Z"
---

Text.`;
    expect(() => parseFrontmatter(content)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// writeMemoryFile + readMemoryFile
// ---------------------------------------------------------------------------

describe("writeMemoryFile + readMemoryFile", () => {
  test("rejects invalid memory ids before writing", () => {
    const fm = makeFrontmatter({ id: randomUUID(), namespace: "default" });
    expect(() => writeMemoryFile("../escape", "bad", fm)).toThrow("Invalid memory id");
  });

  test("creates file with correct frontmatter", async () => {
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: "default" });
    const text = "This is my memory text.";

    // writeMemoryFile uses ensureNamespacePath which writes to ~/.kb
    // For testing, we override by writing to the namespace inside tempDir
    // We test the real ensureNamespacePath since we can't easily override it,
    // but we can verify file creation by checking path existence
    const filePath = writeMemoryFile(id, text, fm);
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, "utf-8");
    expect(raw).toContain(`id: ${id}`);
    expect(raw).toContain("name: Test Memory");
    expect(raw).toContain("origin: manual");
    expect(raw).toContain("namespace: default");

    // Cleanup
    rmSync(filePath);
  });

  test("atomic write: temp file is cleaned up", async () => {
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: "default" });

    writeMemoryFile(id, "Some text", fm);

    // Find the namespace path
    const nsPath = ensureNamespacePath("default");
    const tmpPath = join(nsPath, `${id}.md.tmp`);
    expect(existsSync(tmpPath)).toBe(false); // temp file must be gone

    // Cleanup
    rmSync(join(nsPath, `${id}.md`));
  });

  test("round-trips correctly via readMemoryFile", async () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const fm = makeFrontmatter({
      id,
      name: "Round Trip Test",
      namespace: "default",
      tags: ["round-trip", "test"],
      createdAt: now,
      indexedAt: now,
      abstract: "Round trip abstract",
      summary: "Round trip summary",
      category: "pattern",
      schemaVersion: "1.2.3",
      versionedAt: now,
    });
    const text = "Round trip memory body.";

    const filePath = writeMemoryFile(id, text, fm);
    const result = readMemoryFile(filePath);

    expect(result.frontmatter.id).toBe(id);
    expect(result.frontmatter.name).toBe("Round Trip Test");
    expect(result.frontmatter.tags).toEqual(["round-trip", "test"]);
    expect(result.frontmatter.indexedAt).toBe(now);
    expect(result.frontmatter.abstract).toBe("Round trip abstract");
    expect(result.frontmatter.summary).toBe("Round trip summary");
    expect(result.frontmatter.category).toBe("pattern");
    expect(result.frontmatter.schemaVersion).toBe("1.2.3");
    expect(result.frontmatter.versionedAt).toBe(now);
    expect(result.text).toBe(text);

    // Cleanup
    rmSync(filePath);
  });

  test("trims whitespace from body text", async () => {
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: "default" });

    const filePath = writeMemoryFile(id, "  trimmed text  \n", fm);
    const result = readMemoryFile(filePath);
    expect(result.text).toBe("trimmed text");

    // Cleanup
    rmSync(filePath);
  });
});

// ---------------------------------------------------------------------------
// listMemoryFiles
// ---------------------------------------------------------------------------

describe("listMemoryFiles", () => {
  test("returns entries for memory files, excludes _index.md", async () => {
    const ns = `list-test-${randomUUID().slice(0, 8)}`;
    const id1 = randomUUID();
    const id2 = randomUUID();

    writeMemoryFile(id1, "Memory 1", makeFrontmatter({ id: id1, namespace: ns, name: "First" }));
    writeMemoryFile(id2, "Memory 2", makeFrontmatter({ id: id2, namespace: ns, name: "Second", indexedAt: new Date().toISOString() }));

    // Write an _index.md that should be excluded
    const nsPath = ensureNamespacePath(ns);
    await Bun.write(join(nsPath, "_index.md"), "# index\n");

    const entries = listMemoryFiles(ns);
    expect(entries.length).toBe(2);

    const ids = entries.map((e) => e.id).sort();
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);

    const second = entries.find((e) => e.id === id2)!;
    expect(second.indexed).toBe(true);
    expect(second.name).toBe("Second");
  });

  test("returns empty array for missing namespace", () => {
    const entries = listMemoryFiles(`nonexistent-ns-${randomUUID()}`);
    // listMemoryFiles calls resolveNamespacePath (read-only) — returns empty array for missing dirs
    expect(entries).toEqual([]);
  });

  test("uses _index.md as a metadata cache when the disk matches", async () => {
    const ns = `index-cache-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const id = randomUUID();
    const indexedAt = new Date().toISOString();
    writeMemoryFile(id, "Indexed body", makeFrontmatter({
      id,
      namespace: ns,
      name: "Indexed Entry",
      tags: ["cached"],
      indexedAt,
    }));
    generateIndex(nsPath);

    // File still present — fast path trusts the index; indexedAt is not carried
    // by the _index.md row, so it's undefined on the fast path.
    const entries = listMemoryFiles(ns);
    expect(entries).toEqual([
      {
        id,
        name: "Indexed Entry",
        path: join(nsPath, `${id}.md`),
        indexed: true,
        tags: ["cached"],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// generateIndex
// ---------------------------------------------------------------------------

describe("generateIndex", () => {
  test("creates _index.md with correct format", async () => {
    const ns = `gen-idx-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const id1 = randomUUID();
    const id2 = randomUUID();
    const now = new Date().toISOString();

    writeMemoryFile(id1, "Alpha text", makeFrontmatter({ id: id1, namespace: ns, name: "Alpha", tags: ["a"], createdAt: "2026-01-01T00:00:00.000Z" }));
    writeMemoryFile(id2, "Beta text", makeFrontmatter({ id: id2, namespace: ns, name: "Beta", tags: ["b", "c"], createdAt: "2026-02-01T00:00:00.000Z", indexedAt: now }));

    generateIndex(nsPath);

    const indexPath = join(nsPath, "_index.md");
    expect(existsSync(indexPath)).toBe(true);

    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("2 memories");
    expect(content).toContain("1 unindexed");
    expect(content).toContain("| ID | Name | Tags | Indexed |");
    expect(content).toContain("Alpha");
    expect(content).toContain("Beta");
    expect(content).toContain("b, c");
    // Beta has later createdAt, should appear first (sorted desc)
    const betaPos = content.indexOf("Beta");
    const alphaPos = content.indexOf("Alpha");
    expect(betaPos).toBeLessThan(alphaPos);
  });

  test("generates empty index for namespace with no memories", () => {
    const ns = `empty-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);

    generateIndex(nsPath);

    const indexPath = join(nsPath, "_index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("0 memories");
  });

  test("Spec 'Dedup check': names and tags with `|` round-trip through _index.md fast path", () => {
    const ns = `pipe-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const id1 = randomUUID();
    const id2 = randomUUID();

    // Name with pipes + tag with pipe — both must survive write → read
    writeMemoryFile(id1, "body", makeFrontmatter({
      id: id1, namespace: ns, name: "A | B | C",
      tags: ["tag|one", "plain"],
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    writeMemoryFile(id2, "body", makeFrontmatter({
      id: id2, namespace: ns, name: "Normal",
      tags: ["simple"],
      createdAt: "2026-02-01T00:00:00.000Z",
    }));

    generateIndex(nsPath);

    // parseIndexEntries (fast path) must recover the original strings.
    const entries = listMemoryFiles(ns);
    expect(entries.length).toBe(2);

    const piped = entries.find((e) => e.id === id1);
    expect(piped).toBeDefined();
    expect(piped!.name).toBe("A | B | C");
    expect(piped!.tags).toEqual(["tag|one", "plain"]);

    const normal = entries.find((e) => e.id === id2);
    expect(normal!.name).toBe("Normal");
    expect(normal!.tags).toEqual(["simple"]);
  });

  test("Spec 'Dedup check': names with `\\|` and `\\\\` survive the _index.md round-trip", () => {
    const ns = `pipe-backslash-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const id = randomUUID();

    // Literal chars: backslash, pipe, space, backslash, backslash, word.
    // Without `\` escaping, the writer would emit `\\|` (backslash + escape
    // sequence for pipe) which the parser would read as a single escaped
    // pipe — the original backslash would vanish.
    const tricky = "foo\\|bar \\\\baz";
    writeMemoryFile(id, "body", makeFrontmatter({
      id, namespace: ns, name: tricky, tags: ["plain\\tag"],
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    generateIndex(nsPath);

    const entries = listMemoryFiles(ns);
    const match = entries.find((e) => e.id === id);
    expect(match).toBeDefined();
    expect(match!.name).toBe(tricky);
    expect(match!.tags).toEqual(["plain\\tag"]);
  });

  test("MemoryFrontmatter rejects non-ISO createdAt/indexedAt values", () => {
    // User hand-edits the frontmatter to a human-friendly date. Downstream
    // code does `Date.parse` / `localeCompare` / `new Date(...)` on these
    // values — invalid strings would surface as crashes or mis-sorts far
    // from the source. Validation must fail loudly at read time.
    expect(() =>
      MemoryFrontmatter.parse({
        id: randomUUID(),
        name: "x",
        origin: "manual",
        namespace: "default",
        tags: [],
        createdAt: "not-a-date",
      }),
    ).toThrow();

    expect(() =>
      MemoryFrontmatter.parse({
        id: randomUUID(),
        name: "x",
        origin: "manual",
        namespace: "default",
        tags: [],
        createdAt: "2026-01-01T00:00:00Z",
        indexedAt: "yesterday",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// appendToIndex
// ---------------------------------------------------------------------------

describe("appendToIndex", () => {
  test("appends a row without regenerating the whole file", async () => {
    const ns = `append-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const id1 = randomUUID();
    const id2 = randomUUID();

    writeMemoryFile(id1, "First", makeFrontmatter({ id: id1, namespace: ns, name: "First" }));
    generateIndex(nsPath); // create initial index with 1 entry

    const indexPath = join(nsPath, "_index.md");
    const linesBefore = readFileSync(indexPath, "utf-8").split("\n").length;

    // Append second entry
    const fm2 = makeFrontmatter({ id: id2, namespace: ns, name: "Second", indexedAt: new Date().toISOString() });
    appendToIndex(nsPath, fm2);

    const linesAfter = readFileSync(indexPath, "utf-8").split("\n").length;
    expect(linesAfter).toBe(linesBefore + 1); // exactly one new line added

    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("2 memories");
    expect(content).toContain("1 unindexed");
    expect(content).toContain("Second");
    expect(content).toContain("✓"); // indexed
  });

  test("creates _index.md with header if it doesn't exist", () => {
    const ns = `append-new-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const fm = makeFrontmatter({ id: randomUUID(), namespace: ns, name: "OnlyEntry" });

    appendToIndex(nsPath, fm);

    const indexPath = join(nsPath, "_index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("1 memories");
    expect(content).toContain("1 unindexed");
    expect(content).toContain("| ID | Name | Tags | Indexed |");
    expect(content).toContain("OnlyEntry");
  });
});

// ---------------------------------------------------------------------------
// deleteMemoryFile
// ---------------------------------------------------------------------------

describe("deleteMemoryFile", () => {
  test("throws underlying filesystem errors instead of masking them as not found", async () => {
    const ns = `delete-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const id = randomUUID();
    const name = "Protected";

    writeMemoryFile(id, "Protected body", makeFrontmatter({ id, namespace: ns, name }));

    chmodSync(nsPath, 0o555);
    try {
      expect(() => deleteMemoryFile(name, ns)).toThrow();
    } finally {
      chmodSync(nsPath, 0o755);
      rmSync(nsPath, { recursive: true, force: true });
    }
  });

  test("deletes case-insensitively to match addMemory dedup", () => {
    const ns = `delete-ci-${randomUUID().slice(0, 8)}`;
    const id = randomUUID();
    const name = "React Hooks";

    writeMemoryFile(id, "body", makeFrontmatter({ id, namespace: ns, name }));
    const result = deleteMemoryFile("react hooks", ns);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// resolveNamespacePath — path traversal
// ---------------------------------------------------------------------------

describe("resolveNamespacePath", () => {
  test("rejects path traversal with ../", () => {
    expect(() => resolveNamespacePath("../etc")).toThrow("Invalid namespace");
  });

  test("rejects namespaces starting with .", () => {
    expect(() => resolveNamespacePath(".locks")).toThrow("Invalid namespace");
    expect(() => resolveNamespacePath(".hidden")).toThrow("Invalid namespace");
  });

  test("accepts valid namespace names", () => {
    const path = resolveNamespacePath("default");
    expect(path).toContain("default");
  });
});

// ---------------------------------------------------------------------------
// listMemoryFiles — malformed frontmatter
// ---------------------------------------------------------------------------

describe("listMemoryFiles — Decision #1: files win on _index.md drift", () => {
  test("ghost entry (index row without file) is filtered; index self-heals", () => {
    const ns = `ghost-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const idKeep = randomUUID();
    const idGone = randomUUID();

    writeMemoryFile(idKeep, "stays", makeFrontmatter({ id: idKeep, namespace: ns, name: "Keep" }));
    writeMemoryFile(idGone, "deleted", makeFrontmatter({ id: idGone, namespace: ns, name: "Gone" }));
    generateIndex(nsPath);

    // Simulate external deletion — file vanishes but _index.md still references it
    rmSync(join(nsPath, `${idGone}.md`));

    const entries = listMemoryFiles(ns);
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe(idKeep);

    // Self-heal: second call should see a regenerated, clean index
    const secondCall = listMemoryFiles(ns);
    expect(secondCall.length).toBe(1);
    expect(secondCall[0]!.id).toBe(idKeep);

    // _index.md should no longer mention the gone id
    const indexContent = readFileSync(join(nsPath, "_index.md"), "utf-8");
    expect(indexContent).not.toContain(idGone);
    expect(indexContent).toContain(idKeep);
  });

  test("orphan file (on disk, not in index — e.g. crash mid-write) is surfaced", () => {
    const ns = `orphan-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const idIndexed = randomUUID();
    const idOrphan = randomUUID();

    writeMemoryFile(idIndexed, "in index", makeFrontmatter({ id: idIndexed, namespace: ns, name: "Indexed" }));
    generateIndex(nsPath);

    // Simulate a crash between writeMemoryFile and appendToIndex — file exists, index doesn't know
    writeMemoryFile(idOrphan, "orphan", makeFrontmatter({ id: idOrphan, namespace: ns, name: "Orphan" }));
    // (intentionally skip appendToIndex/updateIndexEntry — this is the crash-window scenario)

    const entries = listMemoryFiles(ns);
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.id).sort()).toEqual([idIndexed, idOrphan].sort());

    // Self-heal: next call sees a regenerated index with both
    const indexContent = readFileSync(join(nsPath, "_index.md"), "utf-8");
    expect(indexContent).toContain(idIndexed);
    expect(indexContent).toContain(idOrphan);
  });

  test("Decision #1: file edited in place (name/tags) invalidates _index.md cache via mtime", async () => {
    const ns = `drift-mtime-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);
    const id = randomUUID();

    writeMemoryFile(id, "body", makeFrontmatter({ id, namespace: ns, name: "Original Name", tags: ["a"] }));
    generateIndex(nsPath);

    // Prime the fast path
    const firstCall = listMemoryFiles(ns);
    expect(firstCall[0]!.name).toBe("Original Name");

    // Ensure the memory file's mtime crosses the 1ms boundary above _index.md's mtime.
    // On fast filesystems writes can land in the same ms tick as the index regeneration,
    // which would make the drift check miss a real edit. Real user edits take longer
    // than this gap — we bump explicitly so the test exercises the invariant.
    await new Promise((r) => setTimeout(r, 10));

    // Simulate a user editing frontmatter in place via text editor. Same ID, new name.
    writeMemoryFile(id, "body", makeFrontmatter({ id, namespace: ns, name: "Renamed", tags: ["a", "b"] }));

    // Fast path must detect the drift and serve the updated metadata (Decision #1:
    // files win on disagreement, not the cache).
    const afterEdit = listMemoryFiles(ns);
    expect(afterEdit[0]!.name).toBe("Renamed");
    expect(afterEdit[0]!.tags).toContain("b");
  });
});

describe("listMemoryFiles — malformed files", () => {
  test("skips files with invalid frontmatter without crashing", () => {
    const ns = `malformed-${randomUUID().slice(0, 8)}`;
    const nsPath = ensureNamespacePath(ns);

    // Write a valid file
    const validId = randomUUID();
    writeMemoryFile(validId, "valid body", makeFrontmatter({ id: validId, namespace: ns, name: "Valid" }));

    // Write a malformed file directly (bad YAML)
    writeFileSync(join(nsPath, `${randomUUID()}.md`), "---\nid: not-a-uuid\n---\nbad");

    const entries = listMemoryFiles(ns);
    expect(entries.length).toBe(1);
    expect(entries[0]!.name).toBe("Valid");
  });
});

// ---------------------------------------------------------------------------
// Frontmatter — preserve unknown user-added keys
// ---------------------------------------------------------------------------

describe("MemoryFrontmatter — Goal #3 / edge case: human-editable file preserved through indexer write-back", () => {
  test("preserves unknown user-added keys through parse + write round-trip", () => {
    const ns = `passthrough-${randomUUID().slice(0, 8)}`;
    ensureNamespacePath(ns);

    const id = randomUUID();
    const raw = `---
id: ${id}
name: With extras
origin: manual
namespace: ${ns}
tags: []
createdAt: "2026-04-13T00:00:00Z"
priority: high
author: youhao
custom_block:
  nested: value
  count: 3
---
body`;

    writeFileSync(join(resolveNamespacePath(ns), `${id}.md`), raw);

    // Read parses through Zod — unknown keys must survive
    const { frontmatter } = readMemoryFile(join(resolveNamespacePath(ns), `${id}.md`));
    const fm = frontmatter as Record<string, unknown>;
    expect(fm.priority).toBe("high");
    expect(fm.author).toBe("youhao");
    expect(fm.custom_block).toEqual({ nested: "value", count: 3 });

    // Re-write (simulating indexer write-back) preserves them on disk
    writeMemoryFile(id, "body", { ...frontmatter, indexedAt: new Date().toISOString() });
    const reread = readMemoryFile(join(resolveNamespacePath(ns), `${id}.md`));
    const fm2 = reread.frontmatter as Record<string, unknown>;
    expect(fm2.priority).toBe("high");
    expect(fm2.author).toBe("youhao");
    expect(fm2.custom_block).toEqual({ nested: "value", count: 3 });
    expect(fm2.indexedAt).toBeDefined();
  });
});

describe("withNamespaceLock", () => {
  test("retries until a lock is released", async () => {
    configureFsMemoryTimingForTests({ timeoutMs: 100, retryMs: 5 });

    const ns = `lock-retry-${randomUUID().slice(0, 8)}`;
    const lockPath = join(tempDir, ".locks", `${encodeURIComponent(ns)}.lock`);
    mkdirSync(lockPath, { recursive: true });
    setTimeout(() => rmSync(lockPath, { recursive: true, force: true }), 20);

    let ran = false;
    await withNamespaceLock(ns, async () => {
      ran = true;
    });

    expect(ran).toBe(true);
  });

  test("times out when a fresh lock never clears", async () => {
    configureFsMemoryTimingForTests({ timeoutMs: 30, retryMs: 5, staleLockAgeMs: 10_000 });

    const ns = `lock-timeout-${randomUUID().slice(0, 8)}`;
    const lockPath = join(tempDir, ".locks", `${encodeURIComponent(ns)}.lock`);
    mkdirSync(lockPath, { recursive: true });

    await expect(withNamespaceLock(ns, async () => {})).rejects.toThrow(`Timed out waiting for namespace lock: "${ns}"`);

    rmSync(lockPath, { recursive: true, force: true });
  });

  test("breaks one stale lock once and still serializes concurrent entrants", async () => {
    configureFsMemoryTimingForTests({ timeoutMs: 200, retryMs: 5, staleLockAgeMs: 20 });

    const ns = `lock-stale-${randomUUID().slice(0, 8)}`;
    const lockPath = join(tempDir, ".locks", `${encodeURIComponent(ns)}.lock`);
    mkdirSync(lockPath, { recursive: true });
    const staleTime = new Date(Date.now() - 5_000);
    utimesSync(lockPath, staleTime, staleTime);

    let active = 0;
    let maxActive = 0;

    await Promise.all([
      withNamespaceLock(ns, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(15);
        active -= 1;
      }),
      withNamespaceLock(ns, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(15);
        active -= 1;
      }),
    ]);

    expect(maxActive).toBe(1);
  });
});
