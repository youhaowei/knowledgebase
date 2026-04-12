import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tempDir = mkdtempSync(join(tmpdir(), "kb-ops-test-"));
process.env.KB_MEMORY_PATH = tempDir;
process.env.__ANALYTICS_DB_PATH = join(tempDir, "analytics.db");
process.env.LADYBUG_DATA_PATH = join(tempDir, "ladybug");

const ops = await import("../src/lib/operations.js");
const { listMemoryFiles, readMemoryFile, deleteMemoryFile, generateIndex, resolveNamespacePath } = await import("../src/lib/fs-memory");

beforeAll(() => {
  process.env.KB_MEMORY_PATH = tempDir;
});

afterEach(() => {
  ops.resetOperationStateForTests();
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.KB_MEMORY_PATH;
  delete process.env.__ANALYTICS_DB_PATH;
  delete process.env.LADYBUG_DATA_PATH;
});

describe("operations.addMemory", () => {
  test("auto-generates a retrievable name when none is provided", async () => {
    const result = await ops.addMemory("First line title\nMore detail below.", undefined, "default");
    expect(result.name).toBe("First line title");

    const { frontmatter } = readMemoryFile(result.path);
    expect(frontmatter.name).toBe("First line title");
  });

  test("deduplicates concurrent adds for the same name within one process", async () => {
    const [first, second] = await Promise.all([
      ops.addMemory("Memory text A", "Concurrent Name", "default"),
      ops.addMemory("Memory text B", "concurrent name", "default"),
    ]);

    const entries = listMemoryFiles("default").filter(
      (entry) => entry.name.toLowerCase() === "concurrent name",
    );

    expect(entries).toHaveLength(1);
    expect(new Set([first.id, second.id]).size).toBe(1);
    expect([first.status, second.status].sort()).toEqual(["existing", "written"]);
  });

  test("rejects invalid ids before queueing for indexing", async () => {
    await expect(ops.queueMemoryForIndexing("../escape", "default")).rejects.toThrow("Invalid memory id");
  });

  test("addMemory with tags normalizes them", async () => {
    const result = await ops.addMemory("Tagged memory", "tag-test", "default", "manual", ["My Tag", "UPPER"]);
    expect(result.status).toBe("written");
    const { frontmatter } = readMemoryFile(result.path);
    expect(frontmatter.tags).toEqual(["my-tag", "upper"]);
  });
});

describe("operations.getByName", () => {
  test("finds file-only memory (filesystem fallback)", async () => {
    await ops.addMemory("Body of fallback test", "Fallback Memory", "ops-get-test");
    const result = await ops.getByName("Fallback Memory", "ops-get-test");
    expect(result.memory).toBeDefined();
    expect(result.memory!.name).toBe("Fallback Memory");
    expect(result.memory!.text).toBe("Body of fallback test");
  });

  test("case-insensitive filesystem lookup", async () => {
    const result = await ops.getByName("fallback memory", "ops-get-test");
    expect(result.memory).toBeDefined();
    expect(result.memory!.name).toBe("Fallback Memory");
  });

  test("returns empty result for nonexistent name", async () => {
    const result = await ops.getByName("Does Not Exist", "ops-get-test");
    expect(result.memory).toBeUndefined();
    expect(result.entity).toBeUndefined();
  });
});

describe("deleteMemoryFile", () => {
  test("returns null for nonexistent name", () => {
    const result = deleteMemoryFile("no-such-memory", "default");
    expect(result).toBeNull();
  });

  test("deletes existing file and returns id/path", async () => {
    const addResult = await ops.addMemory("To be deleted", "delete-test", "ops-delete-test");
    expect(addResult.status).toBe("written");
    const deleted = deleteMemoryFile("delete-test", "ops-delete-test");
    expect(deleted).not.toBeNull();
    expect(deleted!.id).toBe(addResult.id);
    // Update the index after deletion to reflect the removed file
    generateIndex(resolveNamespacePath("ops-delete-test"));
    // Verify file is gone
    const remaining = listMemoryFiles("ops-delete-test");
    expect(remaining.find((f) => f.id === addResult.id)).toBeUndefined();
  });
});

describe("operations.forget", () => {
  test("removes memory file from disk", async () => {
    const ns = "ops-forget-test";
    const addResult = await ops.addMemory("Forgettable content", "forget-me", ns);
    expect(addResult.status).toBe("written");

    const result = await ops.forget("forget-me", ns);
    expect(result.deleted).toBe(true);

    // File should be gone
    const remaining = listMemoryFiles(ns);
    expect(remaining.find((f) => f.id === addResult.id)).toBeUndefined();
  });

  test("returns deleted:false for nonexistent name", async () => {
    const result = await ops.forget("does-not-exist", "ops-forget-test");
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe("Not found");
  });

  test("case-insensitive forget matches addMemory dedup", async () => {
    const ns = "ops-forget-ci";
    await ops.addMemory("Case test content", "My React Hooks", ns);
    const result = await ops.forget("my react hooks", ns);
    expect(result.deleted).toBe(true);

    const remaining = listMemoryFiles(ns);
    expect(remaining.find((f) => f.name === "My React Hooks")).toBeUndefined();
  });
});

describe("operations.stats", () => {
  test("returns filesystem-based memory count", async () => {
    const ns = "ops-stats-test";
    await ops.addMemory("Stats test 1", "stats-mem-1", ns);
    await ops.addMemory("Stats test 2", "stats-mem-2", ns);

    const result = await ops.stats(ns);
    expect(result.filesOnDisk).toBe(2);
    expect(result.memories).toBe(2);
    expect(result.indexed).toBe(0); // not indexed yet
  });
});
