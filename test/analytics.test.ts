import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { unlinkSync } from "fs";
import {
  track,
  tracked,
  queryDb,
  closeAnalytics,
  setAnalyticsPath,
  resetAnalyticsPath,
  analyticsContext,
} from "../src/lib/analytics";

// Use a unique temp DB for each test run
const testDbPath = join(tmpdir(), `kb-analytics-test-${randomUUID()}.db`);

beforeEach(() => {
  setAnalyticsPath(testDbPath);
});

afterEach(() => {
  closeAnalytics();
  resetAnalyticsPath();
  // Clean up temp DB + WAL/SHM siblings
  for (const suffix of ["", "-wal", "-shm"]) {
    try { unlinkSync(testDbPath + suffix); } catch {}
  }
});

describe("track", () => {
  test("inserts an event with defaults", () => {
    track("search");
    const rows = queryDb("SELECT * FROM events");
    expect(rows.length).toBe(1);
    expect(rows[0]!.operation).toBe("search");
    expect(rows[0]!.namespace).toBe("default");
    expect(rows[0]!.success).toBe(1);
    expect(rows[0]!.source).toBeNull();
  });

  test("records all fields", () => {
    track("add", {
      namespace: "retro",
      source: "mcp",
      duration_ms: 123.45,
      success: true,
      meta: { textLength: 42, name: "test-memory" },
    });
    const rows = queryDb("SELECT * FROM events");
    expect(rows.length).toBe(1);
    expect(rows[0]!.operation).toBe("add");
    expect(rows[0]!.namespace).toBe("retro");
    expect(rows[0]!.source).toBe("mcp");
    expect(rows[0]!.duration_ms).toBeCloseTo(123.45, 1);
    expect(rows[0]!.success).toBe(1);

    const meta = JSON.parse(rows[0]!.meta as string);
    expect(meta.textLength).toBe(42);
    expect(meta.name).toBe("test-memory");
  });

  test("records errors with success=0", () => {
    track("search", {
      success: false,
      error: "Connection timeout",
    });
    const rows = queryDb("SELECT * FROM events");
    expect(rows[0]!.success).toBe(0);
    expect(rows[0]!.error).toBe("Connection timeout");
  });

  test("never throws on error", () => {
    // Force DB into a bad state by closing it
    closeAnalytics();
    // Set path to an invalid location
    setAnalyticsPath("/nonexistent/path/analytics.db");
    // Should not throw
    expect(() => track("search")).not.toThrow();
    // Reset for afterEach
    setAnalyticsPath(testDbPath);
  });
});

describe("tracked", () => {
  test("measures duration and records success", async () => {
    const result = await tracked(
      "search",
      { namespace: "test" },
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { count: 5 };
      },
      (r) => ({ resultCount: r.count }),
    );

    expect(result.count).toBe(5);

    const rows = queryDb("SELECT * FROM events");
    expect(rows.length).toBe(1);
    expect(rows[0]!.operation).toBe("search");
    expect(rows[0]!.namespace).toBe("test");
    expect(rows[0]!.success).toBe(1);
    expect(rows[0]!.duration_ms).toBeGreaterThan(0);

    const meta = JSON.parse(rows[0]!.meta as string);
    expect(meta.resultCount).toBe(5);
  });

  test("records error and re-throws", async () => {
    const err = new Error("test failure");
    await expect(
      tracked("add", { namespace: "default" }, async () => {
        throw err;
      }),
    ).rejects.toThrow("test failure");

    const rows = queryDb("SELECT * FROM events");
    expect(rows.length).toBe(1);
    expect(rows[0]!.success).toBe(0);
    expect(rows[0]!.error).toBe("test failure");
    expect(rows[0]!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("works without metaFn", async () => {
    await tracked("stats", {}, async () => ({ memories: 10 }));
    const rows = queryDb("SELECT * FROM events");
    expect(rows[0]!.meta).toBeNull();
  });
});

describe("analyticsContext", () => {
  test("propagates source from AsyncLocalStorage", async () => {
    await analyticsContext.run({ source: "mcp" }, async () => {
      track("search");
    });

    const rows = queryDb("SELECT * FROM events");
    expect(rows[0]!.source).toBe("mcp");
  });

  test("explicit source overrides context", async () => {
    await analyticsContext.run({ source: "mcp" }, async () => {
      track("search", { source: "cli" });
    });

    const rows = queryDb("SELECT * FROM events");
    expect(rows[0]!.source).toBe("cli");
  });

  test("source is null outside context", () => {
    track("search");
    const rows = queryDb("SELECT * FROM events");
    expect(rows[0]!.source).toBeNull();
  });
});

describe("queryDb", () => {
  test("returns empty array on empty DB", () => {
    const rows = queryDb("SELECT * FROM events");
    expect(rows).toEqual([]);
  });

  test("supports parameterized queries", () => {
    track("search", { namespace: "retro" });
    track("add", { namespace: "default" });
    track("search", { namespace: "default" });

    const rows = queryDb(
      "SELECT * FROM events WHERE operation = ? AND namespace = ?",
      ["search", "default"],
    );
    expect(rows.length).toBe(1);
  });

  test("aggregation queries work", () => {
    track("search", { duration_ms: 100 });
    track("search", { duration_ms: 200 });
    track("add", { duration_ms: 50 });

    const rows = queryDb(
      "SELECT operation, COUNT(*) as cnt, AVG(duration_ms) as avg_ms FROM events GROUP BY operation ORDER BY cnt DESC",
    );
    expect(rows.length).toBe(2);
    expect(rows[0]!.operation).toBe("search");
    expect(rows[0]!.cnt).toBe(2);
    expect(rows[0]!.avg_ms).toBeCloseTo(150, 0);
  });
});
