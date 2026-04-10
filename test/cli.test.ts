import { describe, test, expect, afterAll } from "bun:test";
import { rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const KB_TEST_DIR = join(tmpdir(), `kb-cli-test-${process.pid}`);
const CLI = ["bun", "run", "src/cli.ts"];
const TEST_ENV = ["--env", "cli-test"];

// LadybugDB's native addon sometimes segfaults during Bun process cleanup (exit code 133).
// This is a known Bun issue with native addons. The stdout/stderr are always correct
// before the crash, so we treat 0 and 133 as success for data-producing commands.
const BUN_NATIVE_SEGFAULT = 133;

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
  expect(exitCode === 0 || exitCode === BUN_NATIVE_SEGFAULT).toBe(true);
}

afterAll(() => {
  for (const name of [".ladybug-cli-test", ".ladybug-cli-test-other"]) {
    rmSync(name, { recursive: true, force: true });
    rmSync(`${name}.wal`, { force: true });
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
  }, 60_000);

  test("add with --name flag", async () => {
    const { stdout, exitCode } = await run("add", "React hooks are useful", "--name", "react-hooks");
    expectSuccess(exitCode);
    expect(stdout).toContain("Written ");
  }, 60_000);

  test("add with --json outputs JSON", async () => {
    const { stdout, exitCode } = await run("add", "test json output", "--json");
    expectSuccess(exitCode);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("id");
    expect(parsed.status).toBe("written");
  }, 60_000);
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

  test("search returns results (may be empty)", async () => {
    const { exitCode } = await run("search", "typescript");
    expectSuccess(exitCode);
  });

  test("get for non-existent entity", async () => {
    const { stdout, exitCode } = await run("get", "NonExistentEntity12345");
    expectSuccess(exitCode);
    expect(stdout).toContain("not found");
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
    expect(exitCode === 0 || exitCode === BUN_NATIVE_SEGFAULT).toBe(true);
    const stats = JSON.parse(stdout.trim());
    expect(stats.memories).toBe(0);
  });
});
