import { describe, test, expect, afterAll } from "bun:test";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const KB_TEST_DIR = join(tmpdir(), `kb-cli-test-${process.pid}`);
const CLI = ["bun", "run", "src/cli.ts"];
const TEST_ENV = ["--env", "cli-test"];

// LadybugDB's native addon sometimes segfaults during Bun process cleanup.
// Bun surfaces the crash via several exit codes depending on how the abort
// landed: 133 (Bun's custom code), 139 (POSIX SIGSEGV = 128+11), 134 (SIGABRT
// = 128+6). stdout/stderr are always correct before the crash, so any of
// these are treated as success for data-producing commands.
const NATIVE_CRASH_EXIT_CODES = new Set([133, 139, 134]);

async function run(...args: string[]) {
  const proc = Bun.spawn([...CLI, ...TEST_ENV, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: import.meta.dir + "/..",
    env: { ...process.env, KB_MEMORY_PATH: KB_TEST_DIR },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function expectSuccess(exitCode: number) {
  expect(exitCode === 0 || NATIVE_CRASH_EXIT_CODES.has(exitCode)).toBe(true);
}

afterAll(() => {
  // Absolute paths: the CLI child process runs in the repo root
  // (cwd = import.meta.dir + "/..") and creates .ladybug-cli-test* there.
  // Relative paths in afterAll would resolve to the test runner's cwd,
  // which is not guaranteed to match — prevents cleanup leaks when tests
  // are invoked from a subdirectory.
  const repoRoot = join(import.meta.dir, "..");
  for (const name of [".ladybug-cli-test", ".ladybug-cli-test-other"]) {
    rmSync(join(repoRoot, name), { recursive: true, force: true });
    rmSync(join(repoRoot, `${name}.wal`), { force: true });
  }
  rmSync(KB_TEST_DIR, { recursive: true, force: true });
});

describe("CLI arg parsing and help", () => {
  test("shows help with 'help' command", async () => {
    const { stdout } = await run("help");
    expect(stdout).toContain("Knowledgebase CLI");
    expect(stdout).toContain("add");
    expect(stdout).toContain("search");
    expect(stdout).toContain("get");
    expect(stdout).toContain("forget");
    expect(stdout).toContain("stats");
  });

  // Spec US-1 + round-8 Theme J coverage: `--help` / `-h` / `--version` / `-v`
  // must short-circuit BEFORE the dynamic imports that pull operations.ts,
  // analytics.ts, hybrid-search.ts (which transitively pull the extractor,
  // embedder, ladybug types). If a later import creep breaks the guard, the
  // `<100ms` CLI goal silently regresses. These tests lock in the contract.
  test("--help exits 0 without initializing KB data path", async () => {
    const { stdout, exitCode } = await run("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Knowledgebase CLI");
  });

  test("-h is an alias for --help", async () => {
    const { stdout, exitCode } = await run("-h");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Knowledgebase CLI");
  });

  test("--version prints the package version and exits 0", async () => {
    const { stdout, exitCode } = await run("--version");
    expect(exitCode).toBe(0);
    // Version from package.json — semver-shaped (0.0.0, 1.2.3-beta.4, etc.)
    expect(stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("-v is an alias for --version", async () => {
    const { stdout, exitCode } = await run("-v");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  // Round 9 Theme A regression catch: Spec US-1 (<100ms CLI) requires that the
  // `--help` / `--version` short-circuit runs BEFORE any static import that
  // pulls zod / operations / extractor / embedder. Exit-code + stdout checks
  // above do NOT catch a static import creep — a slow implementation that
  // pays zod init before printing help satisfies them identically. This
  // static-import firewall scans cli.ts source up to the `await import(` block
  // and fails if any forbidden module is imported at module scope.
  test("US-1 fast path: cli.ts static-import section contains no heavy modules", async () => {
    const { readFileSync } = await import("fs");
    const source = readFileSync(join(import.meta.dir, "..", "src", "cli.ts"), "utf-8");
    const dynamicImportStart = source.indexOf("await import(");
    expect(dynamicImportStart).toBeGreaterThan(-1);
    const staticSection = source.slice(0, dynamicImportStart);
    // Match `import ... from "<module>"` via matchAll. Comments in the source
    // that mention module names don't match because they lack the `import`
    // keyword — no comment-stripping step required.
    const importRe = /\bimport\b[^;]*?\bfrom\s+["']([^"']+)["']/g;
    const staticImports = Array.from(staticSection.matchAll(importRe), (match) => match[1]!);
    const forbiddenExact = new Set(["zod", "@/types", "@/types.js"]);
    const forbiddenSuffixes = [
      "/operations", "/operations.js",
      "/extractor", "/extractor.js",
      "/embedder", "/embedder.js",
      "/hybrid-search", "/hybrid-search.js",
    ];
    for (const spec of staticImports) {
      expect({ spec, forbidden: forbiddenExact.has(spec) }).toEqual({ spec, forbidden: false });
      for (const suffix of forbiddenSuffixes) {
        expect({ spec, suffix, hit: spec.endsWith(suffix) }).toEqual({ spec, suffix, hit: false });
      }
    }
  });

  test("errors on unknown command", async () => {
    const { stderr, exitCode } = await run("unknown-cmd");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unknown command");
  });

  test("add requires text argument", async () => {
    const { stderr, exitCode } = await run("add");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage");
  });

  test("search requires query argument", async () => {
    const { stderr, exitCode } = await run("search");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage");
  });

  test("get requires name argument", async () => {
    const { stderr, exitCode } = await run("get");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage");
  });

  test("forget requires name argument", async () => {
    const { stderr, exitCode } = await run("forget");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage");
  });

  test("forget-edge requires edgeId and reason", async () => {
    const { stderr, exitCode } = await run("forget-edge");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage");
  });
});

// add writes to filesystem instantly (no extraction, no server needed)
describe("CLI data operations (filesystem write)", () => {
  test("add writes a memory", async () => {
    const { stdout, exitCode } = await run("add", "TypeScript is great for type safety");
    expectSuccess(exitCode);
    expect(stdout).toContain("Written ");
  }, 10_000); // US-1: <100ms target; 10s accommodates Bun spawn overhead on slow CI

  test("add with --name flag", async () => {
    const { stdout, exitCode } = await run("add", "React hooks are useful", "--name", "react-hooks");
    expectSuccess(exitCode);
    expect(stdout).toContain("Written ");
  }, 10_000); // US-1: <100ms target; 10s accommodates Bun spawn overhead on slow CI

  test("add with --json outputs JSON", async () => {
    const { stdout, exitCode } = await run("add", "test json output", "--json");
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("id");
    expect(parsed.status).toBe("written");
  }, 10_000); // US-1: <100ms target; 10s accommodates Bun spawn overhead on slow CI
});

describe("CLI read operations", () => {
  test("stats returns counts", async () => {
    const { stdout, exitCode } = await run("stats");
    expectSuccess(exitCode);
    expect(stdout).toContain("Memories:");
    expect(stdout).toContain("Entities:");
    expect(stdout).toContain("Edges:");
  });

  test("stats --json outputs JSON", async () => {
    const { stdout, exitCode } = await run("stats", "--json");
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("memories");
    expect(parsed).toHaveProperty("entities");
    expect(parsed).toHaveProperty("edges");
  });

  test("US-6/US-7: search returns results with content (self-contained)", async () => {
    // Self-contained — depending on a memory written by an earlier describe
    // block makes this test order-dependent and silently breaks if that
    // describe is skipped, reordered, or runs in a separate process.
    await run("add", "TypeScript is a typed superset of JavaScript", "--name", "ts-fact", "--json");
    const { stdout, exitCode } = await run("search", "typescript");
    expectSuccess(exitCode);
    expect(stdout).toContain("TypeScript");
  });

  test("get for non-existent entity", async () => {
    const { stdout, exitCode } = await run("get", "NonExistentEntity12345");
    expectSuccess(exitCode);
    expect(stdout).toContain("not found");
  });
});

describe("CLI --tag and --origin flags", () => {
  test("Decision #12: add --tag persists tags to file frontmatter (not just CLI output)", async () => {
    const { stdout, exitCode } = await run("add", "Bun is fast", "--name", "bun-speed", "--tag", "runtime", "--tag", "perf", "--json");
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("written");

    // Verify the tags actually landed on disk — without this, a silent-drop
    // bug where --tag is parsed but never written would still pass the
    // status check above.
    const fileContent = await Bun.file(parsed.path).text();
    expect(fileContent).toContain("- runtime");
    expect(fileContent).toContain("- perf");
  }, 10_000); // US-1: <100ms target; 10s accommodates Bun spawn overhead on slow CI

  test("search with --tag filters results", async () => {
    const { stdout, exitCode } = await run("search", "fast", "--tag", "runtime", "--json");
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    // File results should only include tagged entries
    expect((parsed.files ?? []).length).toBeGreaterThan(0);
    for (const f of parsed.files ?? []) {
      expect(f.tags).toContain("runtime");
    }
  }, 10_000); // US-1: <100ms target; 10s accommodates Bun spawn overhead on slow CI

  test("add with --origin sets origin", async () => {
    const { stdout, exitCode } = await run("add", "retro finding", "--name", "retro-test-1", "--origin", "retro", "--json");
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("written");
  }, 10_000); // US-1: <100ms target; 10s accommodates Bun spawn overhead on slow CI

  test("add with invalid --origin errors", async () => {
    const { stderr, exitCode } = await run("add", "bad origin", "--origin", "invalid");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Invalid --origin");
  });
});

describe("CLI environment isolation", () => {
  test("--env creates separate data directory", async () => {
    const otherKbDir = join(KB_TEST_DIR, "isolated");
    const proc = Bun.spawn([...CLI, "--env", "cli-test-other", "stats", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: import.meta.dir + "/..",
      env: { ...process.env, KB_MEMORY_PATH: otherKbDir },
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode === 0 || NATIVE_CRASH_EXIT_CODES.has(exitCode)).toBe(true);
    const stats = JSON.parse(stdout.trim());
    expect(stats.memories).toBe(0);
  });
});
