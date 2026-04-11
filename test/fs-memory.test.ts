import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
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
  type MemoryFrontmatter,
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
