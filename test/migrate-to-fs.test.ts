import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

import { migrate } from "../src/lib/migrate-to-fs";

const tempDirs: string[] = [];
const originalKbPath = process.env.KB_MEMORY_PATH;

afterEach(() => {
  const dir = tempDirs.pop();
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (originalKbPath === undefined) delete process.env.KB_MEMORY_PATH;
  else process.env.KB_MEMORY_PATH = originalKbPath;
});

describe("migrate", () => {
  test("generates _index.md for migrated namespaces", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "kb-migrate-test-"));
    tempDirs.push(tempDir);
    process.env.KB_MEMORY_PATH = tempDir;

    const id = randomUUID();
    const createdAt = "2026-04-11T00:00:00.000Z";

    await migrate(false, {
      createGraphProvider: async () => ({
        init: async () => {},
        close: async () => {},
        listNamespaces: async () => ["default"],
        findMemories: async () => [
          { id, name: "Migrated Memory", text: "Migrated body", createdAt, namespace: "default" },
        ],
      }) as Awaited<ReturnType<typeof import("../src/lib/graph-provider").createGraphProvider>>,
    });

    const namespacePath = join(tempDir, "default");
    const indexPath = join(namespacePath, "_index.md");

    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("Migrated Memory");
    expect(content).toContain(id);
  });
});
