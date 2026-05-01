import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  generateIndex,
  resolveNamespacePath,
  writeMemoryFile,
  type MemoryFrontmatter,
} from "../src/lib/fs-memory.js";
import { namespaceSchema, optionalNamespaceSchema } from "../src/types.js";

// Isolate this file's KB root / ladybug path / analytics DB from sibling test
// files that share the bun process and set env at module scope (same pattern
// as operations.test.ts).
const tempDir = mkdtempSync(join(tmpdir(), "kb-server-fn-test-"));
process.env.KB_MEMORY_PATH = tempDir;
process.env.__ANALYTICS_DB_PATH = join(tempDir, "analytics.db");
process.env.LADYBUG_DATA_PATH = join(tempDir, "ladybug");
// Prevent the server-functions module from booting the 60s indexer sweep in
// tests — it races tempdir cleanup and emits noise.
process.env.KB_DISABLE_SERVER_INDEXER = "true";

const ops = await import("../src/lib/operations.js");
const { listMemoriesDegradedFallback } = await import("../src/server/functions.js");

function makeFrontmatter(overrides: Partial<MemoryFrontmatter> = {}): MemoryFrontmatter {
  return {
    id: randomUUID(),
    name: "Test Memory",
    origin: "manual",
    namespace: "default",
    tags: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Force `getProvider()` to fail by injecting a dependency that always rejects.
 * Mirrors a real outage (Ladybug WAL corruption, Ollama down for 2560-dim
 * embedder init, etc.) without needing to actually break the disk.
 */
function forceProviderFailure(): void {
  ops.configureOperationDependenciesForTests({
    createGraphProvider: async () => {
      throw new Error("simulated graph outage");
    },
  });
  ops.clearProviderFailureCooldownForTests();
}

function useHealthyProvider(namespaces: string[] = ["default"]): void {
  ops.configureOperationDependenciesForTests({
    createGraphProvider: async () => ({
      listNamespaces: async () => namespaces,
    }) as Awaited<ReturnType<typeof ops.getProvider>>,
  });
  ops.clearProviderFailureCooldownForTests();
}

beforeAll(() => {
  process.env.KB_MEMORY_PATH = tempDir;
  process.env.__ANALYTICS_DB_PATH = join(tempDir, "analytics.db");
  process.env.LADYBUG_DATA_PATH = join(tempDir, "ladybug");
});

beforeEach(() => {
  ops.resetOperationStateForTests();
});

afterEach(() => {
  ops.resetOperationStateForTests();
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.KB_MEMORY_PATH;
  delete process.env.__ANALYTICS_DB_PATH;
  delete process.env.LADYBUG_DATA_PATH;
  delete process.env.KB_DISABLE_SERVER_INDEXER;
});

/**
 * Scope note (review finding #3):
 *
 * The fix added `withGraphFallback` + `withGraphRequired` helpers in
 * `operations.ts` and wired them through 8 server-functions call sites
 * (`listMemories`, `listEntities`, `listEdges`, `getGraphData`,
 * `findDuplicateCandidates`, `getEntity`, `mergeDuplicateGroup`,
 * `deduplicateEntities`).
 *
 * Ideally we'd invoke each server function end-to-end under a simulated
 * graph outage. TanStack Start's `createServerFn` returns via an internal
 * middleware chain that (in bun test, absent a real server runtime) discards
 * handler return values — so direct invocation of the server fns returns
 * undefined even when the handler body correctly runs. Rather than stand up
 * a TanStack server harness for the test (heavyweight, fragile) we:
 *
 *   1. Test the helpers behaviourally against a real failing provider. If
 *      `withGraphFallback` and `withGraphRequired` are correct, every call
 *      site that uses them inherits correctness.
 *   2. Assert by code inspection that each of the 8 sites routes through one
 *      of the two helpers. This catches regressions that skip the helper.
 *
 * End-to-end verification of the HTTP boundary is left to manual browser
 * testing against a running `bun run dev`.
 */
describe("withGraphFallback / withGraphRequired (review finding #3)", () => {
  describe("withGraphFallback", () => {
    test("returns fn result when provider is healthy", async () => {
      useHealthyProvider(["default", "work"]);
      const result = await ops.withGraphFallback(
        "probe",
        async (gp) => ({ ok: true, nsList: await gp.listNamespaces() }),
        { ok: false, nsList: [] as string[] },
      );
      expect(result.ok).toBe(true);
      expect(result.nsList).toEqual(["default", "work"]);
    });

    test("returns static fallback when provider init throws", async () => {
      forceProviderFailure();
      type Probe = { marker: string };
      const result = await ops.withGraphFallback<Probe>(
        "probe",
        async () => ({ marker: "from-fn" }),
        { marker: "from-fallback" },
      );
      expect(result).toEqual({ marker: "from-fallback" });
    });

    test("returns thunk fallback when provider init throws", async () => {
      forceProviderFailure();
      let called = 0;
      type Probe = { marker: string };
      const result = await ops.withGraphFallback<Probe>(
        "probe-thunk",
        async () => ({ marker: "from-fn" }),
        async () => {
          called += 1;
          return { marker: "from-thunk" };
        },
      );
      expect(result).toEqual({ marker: "from-thunk" });
      expect(called).toBe(1);
    });

    test("fallback thunk is NOT invoked on healthy provider (no wasted work)", async () => {
      useHealthyProvider();
      let called = 0;
      const result = await ops.withGraphFallback(
        "probe-no-thunk",
        async () => ({ ok: true }),
        () => {
          called += 1;
          return { ok: false };
        },
      );
      expect(result).toEqual({ ok: true });
      expect(called).toBe(0);
    });

    test("fn exceptions fall back via broad catch (chosen safety-net contract)", async () => {
      useHealthyProvider();
      // Chosen behaviour: broad catch. `withGraphFallback` catches BOTH
      // provider-init errors AND `fn(gp)` exceptions, treating any throw as
      // "degrade to the fallback." The alternative (narrow catch, only
      // provider-init failures degrade) was considered and rejected — the
      // safety-net framing is more important than surfacing handler bugs
      // through the UI.
      //
      // This test locks in that contract. Round 8 review flagged this as a
      // bug; the flag was wrong — see the principal review's disagreement
      // with Spec Principle #3 ("Degraded, not broken — every operation has
      // a defined behavior when the graph is unavailable"). If a future
      // round wants to narrow the catch, it must explicitly override the
      // decision documented here.
      const result = await ops.withGraphFallback(
        "probe-fn-throw",
        async () => { throw new Error("bug in handler body"); },
        { fellBack: true },
      );
      expect(result).toEqual({ fellBack: true });
    });
  });

  describe("withGraphRequired", () => {
    test("runs fn when provider is healthy", async () => {
      useHealthyProvider(["default", "work"]);
      const namespaces = await ops.withGraphRequired("probe", (gp) => gp.listNamespaces());
      expect(namespaces).toEqual(["default", "work"]);
    });

    test("throws ProviderUnavailableError on provider failure", async () => {
      forceProviderFailure();
      await expect(
        ops.withGraphRequired("some-op", async () => "never"),
      ).rejects.toBeInstanceOf(ops.ProviderUnavailableError);
    });

    test("error carries operation name and original cause", async () => {
      forceProviderFailure();
      try {
        await ops.withGraphRequired("mergeDuplicateGroup", async () => {
          throw new Error("unreachable");
        });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ops.ProviderUnavailableError);
        const pue = err as InstanceType<typeof ops.ProviderUnavailableError>;
        expect(pue.operation).toBe("mergeDuplicateGroup");
        expect(String(pue.cause)).toContain("simulated graph outage");
      }
    });

    test("fn business-logic errors propagate unchanged (not wrapped)", async () => {
      // Provider is healthy; the fn throws. `withGraphRequired` must NOT
      // wrap this in ProviderUnavailableError — that error type is reserved
      // for provider-init failures. A callee-thrown Error should surface
      // as-is so the UI can distinguish "entity not found" from "graph down".
      await expect(
        ops.withGraphRequired("probe", async () => {
          throw new Error("entity not found");
        }),
      ).rejects.toThrow("entity not found");
    });
  });

  describe("server-functions.ts wiring (inspection-level)", () => {
    // These assertions catch regressions where a contributor reverts a call
    // site to `const gp = await ops.getProvider()` without the helper.
    // They're inspection-level rather than behavioural because TanStack's
    // bun-test return path is unreliable (see scope note at top of file).
    const functionsSrc = readFileSync(
      join(import.meta.dir, "..", "src", "server", "functions.ts"),
      "utf-8",
    );

    test.each([
      "getGraphData",
      "listMemories",
      "listEntities",
      "listEdges",
      "findDuplicateCandidates",
    ])("%s routes through withGraphFallback", (name) => {
      // Grab the block from `export const <name> = createServerFn` up to the
      // next top-level `export const` — avoids false positives from siblings.
      const start = functionsSrc.indexOf(`export const ${name} = createServerFn`);
      expect(start).toBeGreaterThan(-1);
      const tail = functionsSrc.slice(start);
      const end = tail.indexOf("\nexport const ", 1);
      const block = end === -1 ? tail : tail.slice(0, end);
      expect(block).toContain("withGraphFallback");
      // Guard against a contributor leaving both the helper and the old
      // direct getProvider() call in the same block.
      expect(block.includes("ops.getProvider()")).toBe(false);
    });

    test.each([
      "getEntity",
      "mergeDuplicateGroup",
      "deduplicateEntities",
    ])("%s routes through withGraphRequired", (name) => {
      const start = functionsSrc.indexOf(`export const ${name} = createServerFn`);
      expect(start).toBeGreaterThan(-1);
      const tail = functionsSrc.slice(start);
      const end = tail.indexOf("\nexport const ", 1);
      const block = end === -1 ? tail : tail.slice(0, end);
      expect(block).toContain("withGraphRequired");
    });
  });
});

describe("listMemories degraded fallback", () => {
  test("Goal #3: unscoped fallback reads memories from every namespace on disk", () => {
    const defaultId = randomUUID();
    const workId = randomUUID();
    writeMemoryFile(defaultId, "Default body", makeFrontmatter({
      id: defaultId,
      name: "Alpha",
      namespace: "default",
      createdAt: "2026-04-10T00:00:00.000Z",
    }));
    writeMemoryFile(workId, "Work body", makeFrontmatter({
      id: workId,
      name: "Beta",
      namespace: "work",
      createdAt: "2026-04-11T00:00:00.000Z",
    }));

    const result = listMemoriesDegradedFallback({
      offset: 0,
      limit: 10,
      sortBy: "createdAt",
      sortDir: "desc",
    });

    expect(result.degraded).toBe(true);
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.namespace)).toEqual(["work", "default"]);
    expect(result.items.map((item) => item.id)).toEqual([workId, defaultId]);
  });

  test("uses id as a deterministic tiebreak for degraded createdAt sorting", () => {
    const lowId = "00000000-0000-4000-8000-000000000001";
    const highId = "00000000-0000-4000-8000-000000000002";
    const createdAt = "2026-04-10T00:00:00.000Z";
    writeMemoryFile(lowId, "Low id body", makeFrontmatter({
      id: lowId,
      name: "Low",
      namespace: "ties",
      createdAt,
    }));
    writeMemoryFile(highId, "High id body", makeFrontmatter({
      id: highId,
      name: "High",
      namespace: "ties",
      createdAt,
    }));

    const result = listMemoriesDegradedFallback({
      namespace: "ties",
      offset: 0,
      limit: 10,
      sortBy: "createdAt",
      sortDir: "desc",
    });

    expect(result.items.map((item) => item.id)).toEqual([highId, lowId]);
  });

  test("name-sorted degraded totals exclude files that fail frontmatter parsing", () => {
    const validId = randomUUID();
    const invalidId = randomUUID();
    writeMemoryFile(validId, "Valid body", makeFrontmatter({
      id: validId,
      name: "Valid",
      namespace: "corrupt-index",
      createdAt: "2026-04-10T00:00:00.000Z",
    }));
    const invalidPath = writeMemoryFile(invalidId, "Invalid body", makeFrontmatter({
      id: invalidId,
      name: "Invalid",
      namespace: "corrupt-index",
      createdAt: "2026-04-11T00:00:00.000Z",
    }));
    const nsPath = resolveNamespacePath("corrupt-index");
    generateIndex(nsPath);
    writeFileSync(invalidPath, [
      "---",
      `id: ${invalidId}`,
      "name: Invalid",
      "origin: manual",
      "namespace: corrupt-index",
      "tags: []",
      "createdAt: not-a-date",
      "---",
      "Invalid body",
      "",
    ].join("\n"));
    const beforeIndex = new Date("2026-01-01T00:00:00.000Z");
    utimesSync(invalidPath, beforeIndex, beforeIndex);

    const result = listMemoriesDegradedFallback({
      namespace: "corrupt-index",
      offset: 0,
      limit: 10,
      sortBy: "name",
      sortDir: "asc",
    });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual([validId]);
  });

  test("behaviour contract: category filtering happens before pagination and total counts filtered rows", () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    writeMemoryFile(ids[0], "Alpha", makeFrontmatter({
      id: ids[0],
      name: "Newest non-match",
      namespace: "filtered",
      category: "event",
      createdAt: "2026-04-12T00:00:00.000Z",
    }));
    writeMemoryFile(ids[1], "Beta", makeFrontmatter({
      id: ids[1],
      name: "First match",
      namespace: "filtered",
      category: "general",
      createdAt: "2026-04-11T00:00:00.000Z",
    }));
    writeMemoryFile(ids[2], "Gamma", makeFrontmatter({
      id: ids[2],
      name: "Second match",
      namespace: "filtered",
      category: "general",
      createdAt: "2026-04-10T00:00:00.000Z",
    }));

    const page = listMemoriesDegradedFallback({
      namespace: "filtered",
      category: "general",
      offset: 0,
      limit: 1,
      sortBy: "createdAt",
      sortDir: "desc",
    });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(ids[1]);
    expect(page.items.every((item) => item.category === "general")).toBe(true);
  });
});

describe("centralized namespace parsing", () => {
  test("maps blank scoped namespace inputs to default", () => {
    expect(namespaceSchema.parse("")).toBe("default");
    expect(namespaceSchema.parse("  default  ")).toBe("default");
  });

  test("maps blank optional namespace inputs to undefined for all-namespace routes", () => {
    expect(optionalNamespaceSchema.parse("")).toBeUndefined();
    expect(optionalNamespaceSchema.parse("  ")).toBeUndefined();
    expect(optionalNamespaceSchema.parse(" work ")).toBe("work");
  });

  test("server functions import the centralized namespace schemas", () => {
    const functionsSrc = readFileSync(
      join(import.meta.dir, "..", "src", "server", "functions.ts"),
      "utf-8",
    );
    expect(functionsSrc).toContain("import { namespaceSchema, optionalNamespaceSchema } from \"../types.js\";");
    expect(functionsSrc).toContain("namespace: namespaceSchema");
    expect(functionsSrc).toContain("namespace: optionalNamespaceSchema");
  });
});
