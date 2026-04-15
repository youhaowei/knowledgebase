import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

import { migrate } from "../src/lib/migrate-to-fs";
import { parseFrontmatter } from "../src/lib/fs-memory";

const tempDirs: string[] = [];
const originalKbPath = process.env.KB_MEMORY_PATH;

function setupTempEnv(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "kb-migrate-test-"));
  tempDirs.push(tempDir);
  process.env.KB_MEMORY_PATH = tempDir;
  return tempDir;
}

type FakeMemory = { id: string; name: string; text: string; createdAt: string; namespace: string };

function fakeProvider(rowsByNs: Record<string, FakeMemory[]>) {
  return async () => ({
    init: async () => {},
    close: async () => {},
    listNamespaces: async () => Object.keys(rowsByNs),
    findMemories: async (filter: { namespace?: string }) =>
      filter.namespace ? rowsByNs[filter.namespace] ?? [] : Object.values(rowsByNs).flat(),
  }) as unknown as Awaited<ReturnType<typeof import("../src/lib/graph-provider").createGraphProvider>>;
}

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
    const tempDir = setupTempEnv();
    const id = randomUUID();
    const createdAt = "2026-04-11T00:00:00.000Z";

    await migrate(false, {
      createGraphProvider: fakeProvider({
        default: [{ id, name: "Migrated Memory", text: "Migrated body", createdAt, namespace: "default" }],
      }),
    });

    const indexPath = join(tempDir, "default", "_index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("Migrated Memory");
    expect(content).toContain(id);
  });

  test("preserves body text and identity frontmatter verbatim", async () => {
    const tempDir = setupTempEnv();
    const id = randomUUID();
    const createdAt = "2026-04-11T00:00:00.000Z";
    const body = "Body text\nwith newlines\nand `markdown` features.";

    await migrate(false, {
      createGraphProvider: fakeProvider({
        default: [{ id, name: "Fidelity Memory", text: body, createdAt, namespace: "default" }],
      }),
    });

    const filePath = join(tempDir, "default", `${id}.md`);
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(raw);

    expect(parsed.text).toBe(body);
    expect(parsed.frontmatter.id).toBe(id);
    expect(parsed.frontmatter.name).toBe("Fidelity Memory");
    expect(parsed.frontmatter.namespace).toBe("default");
    expect(parsed.frontmatter.createdAt).toBe(createdAt);
    // Origin defaults to "import" for non-retro namespaces.
    expect(parsed.frontmatter.origin).toBe("import");
  });

  test("Decision #8: indexedAt aligns with file mtime so migrated files are not stale on first read", async () => {
    const tempDir = setupTempEnv();
    const id = randomUUID();

    await migrate(false, {
      createGraphProvider: fakeProvider({
        default: [{ id, name: "Mtime Memory", text: "body", createdAt: "2026-04-11T00:00:00.000Z", namespace: "default" }],
      }),
    });

    const filePath = join(tempDir, "default", `${id}.md`);
    const parsed = parseFrontmatter(readFileSync(filePath, "utf-8"));
    const stat = statSync(filePath);
    const indexedAtMs = Date.parse(parsed.frontmatter.indexedAt!);
    // mtime should be ≤ indexedAt (rounded to second precision on some FS) so
    // `stale = mtime > indexedAt` does NOT fire on a freshly migrated file.
    expect(stat.mtimeMs).toBeLessThanOrEqual(indexedAtMs + 1000);
  });

  test("idempotent: re-running migration is a no-op (skips existing files)", async () => {
    const tempDir = setupTempEnv();
    const id = randomUUID();
    const provider = fakeProvider({
      default: [{ id, name: "Idempotent Memory", text: "first body", createdAt: "2026-04-11T00:00:00.000Z", namespace: "default" }],
    });

    await migrate(false, { createGraphProvider: provider });
    const filePath = join(tempDir, "default", `${id}.md`);
    const firstContent = readFileSync(filePath, "utf-8");
    const firstMtime = statSync(filePath).mtimeMs;

    // Second run with a *different* body in the provider — must not overwrite.
    await migrate(false, {
      createGraphProvider: fakeProvider({
        default: [{ id, name: "Idempotent Memory", text: "second body — should not appear", createdAt: "2026-04-11T00:00:00.000Z", namespace: "default" }],
      }),
    });

    expect(readFileSync(filePath, "utf-8")).toBe(firstContent);
    expect(statSync(filePath).mtimeMs).toBe(firstMtime);
  });

  test("Decision #3: namespace isolation — migrating ns-A leaves ns-B untouched", async () => {
    const tempDir = setupTempEnv();
    const aId = randomUUID();
    const bId = randomUUID();

    await migrate(false, {
      createGraphProvider: fakeProvider({
        "ns-a": [{ id: aId, name: "A Memory", text: "a body", createdAt: "2026-04-11T00:00:00.000Z", namespace: "ns-a" }],
        "ns-b": [{ id: bId, name: "B Memory", text: "b body", createdAt: "2026-04-11T00:00:00.000Z", namespace: "ns-b" }],
      }),
    });

    // Each namespace gets exactly its own file — no cross-namespace bleed.
    expect(existsSync(join(tempDir, "ns-a", `${aId}.md`))).toBe(true);
    expect(existsSync(join(tempDir, "ns-a", `${bId}.md`))).toBe(false);
    expect(existsSync(join(tempDir, "ns-b", `${bId}.md`))).toBe(true);
    expect(existsSync(join(tempDir, "ns-b", `${aId}.md`))).toBe(false);
  });

  test("dry-run: no files written, no _index.md generated", async () => {
    const tempDir = setupTempEnv();
    const id = randomUUID();

    await migrate(true, {
      createGraphProvider: fakeProvider({
        default: [{ id, name: "Dry Run Memory", text: "body", createdAt: "2026-04-11T00:00:00.000Z", namespace: "default" }],
      }),
    });

    expect(existsSync(join(tempDir, "default", `${id}.md`))).toBe(false);
    expect(existsSync(join(tempDir, "default", "_index.md"))).toBe(false);
  });
});
