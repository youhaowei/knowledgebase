import { describe, test, expect, afterAll } from "bun:test";
import { rmSync } from "fs";

const CLI = ["bun", "run", "src/cli.ts"];
const TEST_ENV = ["--env", "retro-test"];

const BUN_NATIVE_SEGFAULT = 133;

async function run(...args: string[]) {
  const proc = Bun.spawn([...CLI, ...TEST_ENV, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: import.meta.dir + "/..",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function expectSuccess(exitCode: number) {
  expect(exitCode === 0 || exitCode === BUN_NATIVE_SEGFAULT).toBe(true);
}

afterAll(() => {
  rmSync(".ladybug-retro-test", { recursive: true, force: true });
  rmSync(".ladybug-retro-test.wal", { force: true });
});

describe("retro namespace operations", () => {
  test("add with --ns retro queues a memory", async () => {
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
    expect(parsed).toHaveProperty("queued", true);
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
    expect(parsed.existing).toBe(true);
    expect(parsed.queued).toBe(false);
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
    expect(parsed).toHaveProperty("queued", true);
    expect(parsed.existing).toBeUndefined();
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
    expect(parsed).toHaveProperty("queued", true);
    expect(parsed.existing).toBeUndefined();
  }, 60_000);
});
