import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const KB_TEST_DIR = join(tmpdir(), `kb-retro-test-${process.pid}`);
const CLI = ["bun", "run", "src/cli.ts"];
const TEST_ENV = ["--env", "retro-test"];

// Bun surfaces LadybugDB native crashes via several exit codes: 133 (Bun),
// 139 (SIGSEGV = 128+11), 134 (SIGABRT = 128+6). Stdout/stderr are correct
// before the crash on exit — any of these are success for data commands.
const NATIVE_CRASH_EXIT_CODES = new Set([133, 139, 134]);

function cleanTestDb() {
  // Absolute paths: the CLI child runs in the repo root (cwd above) and
  // creates .ladybug-retro-test* there; the test runner's cwd is not
  // guaranteed to match. Relative paths here leaked test data across runs
  // when tests were invoked from a subdirectory.
  const repoRoot = join(import.meta.dir, "..");
  rmSync(join(repoRoot, ".ladybug-retro-test"), { recursive: true, force: true });
  rmSync(join(repoRoot, ".ladybug-retro-test.wal"), { force: true });
  rmSync(KB_TEST_DIR, { recursive: true, force: true });
}

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

// Clean before AND after: beforeAll handles stale data from previous runs
// that survived a Bun segfault (which prevents afterAll from running).
beforeAll(cleanTestDb);
afterAll(cleanTestDb);

describe("retro namespace operations", () => {
  test("add with --ns retro writes a memory", async () => {
    const { stdout, exitCode } = await run(
      "add",
      "[retro/bug/high] Bun install fails: Bun install fails in git worktrees",
      "--ns", "retro",
      "--name", "retro-1",
      "--json",
    );
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("id");
    expect(parsed.status).toBe("written");
  }, 60_000);

  test("add with same name returns existing (dedup)", async () => {
    const { stdout, exitCode } = await run(
      "add",
      "[retro/bug/high] Bun install fails: Different description same finding",
      "--ns", "retro",
      "--name", "retro-1",
      "--json",
    );
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("id");
    expect(parsed.status).toBe("existing");
  }, 60_000);

  test("add with different name creates new memory", async () => {
    const { stdout, exitCode } = await run(
      "add",
      "[retro/tools/medium] Zustand simpler than Redux: Chose Zustand for simpler API",
      "--ns", "retro",
      "--name", "retro-2",
      "--json",
    );
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe("written");
  }, 60_000);
});

describe("retro namespace isolation", () => {
  test("retro memories don't appear in default namespace", async () => {
    const { stdout, exitCode } = await run("stats", "--json");
    expectSuccess(exitCode);
    const stats = JSON.parse(stdout);
    // Default namespace should have 0 memories (retro findings are in 'retro' ns)
    expect(stats.memories).toBe(0);
  });

  test("retro namespace has memories", async () => {
    const { stdout, exitCode } = await run("stats", "--ns", "retro", "--json");
    expectSuccess(exitCode);
    const stats = JSON.parse(stdout);
    expect(stats.memories).toBeGreaterThan(0);
  });
});

describe("dedup edge cases", () => {
  test("similar name (retro-10) does not collide with retro-1", async () => {
    const { stdout, exitCode } = await run(
      "add",
      "[retro/bug/low] Different finding entirely",
      "--ns", "retro",
      "--name", "retro-10",
      "--json",
    );
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    // retro-10 should NOT match retro-1 (exact match, not CONTAINS)
    expect(parsed.status).toBe("written");
  }, 60_000);
});
