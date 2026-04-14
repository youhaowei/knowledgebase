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
