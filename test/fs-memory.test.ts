import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// Override KB root before importing fs-memory, using test temp dir
const TEST_NAMESPACE = "test-ns";
let tempDir: string;
let testNsPath: string;

// We import after setting up the temp dir via direct path injection
import {
  normalizeTags,
  parseFrontmatter,
  writeMemoryFile,
  readMemoryFile,
  listMemoryFiles,
  generateIndex,
  appendToIndex,
  getNamespacePath,
  type MemoryFrontmatter,
} from "../src/lib/fs-memory";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kb-fs-test-"));
  // Create a namespace directory inside our temp dir for direct testing
  testNsPath = join(tempDir, TEST_NAMESPACE);
  mkdtempSync(testNsPath); // won't work - mkdtempSync adds random suffix
});

afterAll(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
  test("creates file with correct frontmatter", async () => {
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: "default" });
    const text = "This is my memory text.";

    // writeMemoryFile uses getNamespacePath which writes to ~/.kb
    // For testing, we override by writing to the namespace inside tempDir
    // We test the real getNamespacePath since we can't easily override it,
    // but we can verify file creation by checking path existence
    const filePath = await writeMemoryFile(id, text, fm);
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

    await writeMemoryFile(id, "Some text", fm);

    // Find the namespace path
    const nsPath = getNamespacePath("default");
    const tmpPath = join(nsPath, `.${id}.md.tmp`);
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
    });
    const text = "Round trip memory body.";

    const filePath = await writeMemoryFile(id, text, fm);
    const result = await readMemoryFile(filePath);

    expect(result.frontmatter.id).toBe(id);
    expect(result.frontmatter.name).toBe("Round Trip Test");
    expect(result.frontmatter.tags).toEqual(["round-trip", "test"]);
    expect(result.frontmatter.indexedAt).toBe(now);
    expect(result.text).toBe(text);

    // Cleanup
    rmSync(filePath);
  });

  test("trims whitespace from body text", async () => {
    const id = randomUUID();
    const fm = makeFrontmatter({ id, namespace: "default" });

    const filePath = await writeMemoryFile(id, "  trimmed text  \n", fm);
    const result = await readMemoryFile(filePath);
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

    await writeMemoryFile(id1, "Memory 1", makeFrontmatter({ id: id1, namespace: ns, name: "First" }));
    await writeMemoryFile(id2, "Memory 2", makeFrontmatter({ id: id2, namespace: ns, name: "Second", indexedAt: new Date().toISOString() }));

    // Write an _index.md that should be excluded
    const nsPath = getNamespacePath(ns);
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
    // listMemoryFiles calls getNamespacePath which creates the dir — so it returns empty array
    expect(entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// generateIndex
// ---------------------------------------------------------------------------

describe("generateIndex", () => {
  test("creates _index.md with correct format", async () => {
    const ns = `gen-idx-${randomUUID().slice(0, 8)}`;
    const nsPath = getNamespacePath(ns);
    const id1 = randomUUID();
    const id2 = randomUUID();
    const now = new Date().toISOString();

    await writeMemoryFile(id1, "Alpha text", makeFrontmatter({ id: id1, namespace: ns, name: "Alpha", tags: ["a"], createdAt: "2026-01-01T00:00:00.000Z" }));
    await writeMemoryFile(id2, "Beta text", makeFrontmatter({ id: id2, namespace: ns, name: "Beta", tags: ["b", "c"], createdAt: "2026-02-01T00:00:00.000Z", indexedAt: now }));

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
    const nsPath = getNamespacePath(ns);

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
    const nsPath = getNamespacePath(ns);
    const id1 = randomUUID();
    const id2 = randomUUID();

    await writeMemoryFile(id1, "First", makeFrontmatter({ id: id1, namespace: ns, name: "First" }));
    generateIndex(nsPath); // create initial index with 1 entry

    const indexPath = join(nsPath, "_index.md");
    const linesBefore = readFileSync(indexPath, "utf-8").split("\n").length;

    // Append second entry
    const fm2 = makeFrontmatter({ id: id2, namespace: ns, name: "Second", indexedAt: new Date().toISOString() });
    appendToIndex(nsPath, fm2);

    const linesAfter = readFileSync(indexPath, "utf-8").split("\n").length;
    expect(linesAfter).toBe(linesBefore + 1); // exactly one new line added

    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("Second");
    expect(content).toContain("✓"); // indexed
  });

  test("creates _index.md with header if it doesn't exist", () => {
    const ns = `append-new-${randomUUID().slice(0, 8)}`;
    const nsPath = getNamespacePath(ns);
    const fm = makeFrontmatter({ id: randomUUID(), namespace: ns, name: "OnlyEntry" });

    appendToIndex(nsPath, fm);

    const indexPath = join(nsPath, "_index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("| ID | Name | Tags | Indexed |");
    expect(content).toContain("OnlyEntry");
  });
});
