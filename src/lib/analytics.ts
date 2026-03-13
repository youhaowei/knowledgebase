/**
 * Analytics — lightweight event tracking for data-driven improvements
 *
 * Stores usage events in SQLite (~/.kb/analytics.db) with operation type,
 * timing, source (mcp/cli/web), and operation-specific metadata.
 *
 * Design principles:
 * - Fire-and-forget: track() never throws — analytics must not break the app
 * - AsyncLocalStorage for source context — no function signature changes needed
 * - Lazy DB init — no cost until first event
 */

import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "async_hooks";
import { join } from "path";
import { homedir } from "os";

export type AnalyticsSource = "mcp" | "cli" | "web";
type QueryParam = string | number | null;

export const analyticsContext = new AsyncLocalStorage<{
  source: AnalyticsSource;
}>();

const TABLE_DDL = `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  operation TEXT NOT NULL,
  namespace TEXT NOT NULL DEFAULT 'default',
  source TEXT,
  duration_ms REAL,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT,
  meta TEXT
)`;
const IDX_TS = "CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)";
const IDX_OP = "CREATE INDEX IF NOT EXISTS idx_events_op ON events(operation)";

let db: Database | null = null;

function getDbPath() {
  if (process.env.__ANALYTICS_DB_PATH) return process.env.__ANALYTICS_DB_PATH;
  const base = process.env.LADYBUG_DATA_PATH ?? join(homedir(), ".kb");
  return join(base, "analytics.db");
}

function getDb(): Database | null {
  if (db) return db;
  try {
    // Use local variable — only assign to module singleton after full init succeeds.
    // Prevents a partial init (e.g., table creation fails) from poisoning all future calls.
    const instance = new Database(getDbPath(), { create: true });
    instance.run("PRAGMA journal_mode=WAL");
    instance.run(TABLE_DDL);
    instance.run(IDX_TS);
    instance.run(IDX_OP);
    db = instance;
    return db;
  } catch (err) {
    console.error("[analytics] Failed to initialize DB:", err);
    return null;
  }
}

/** Fire-and-forget event tracking. Never throws. */
export function track(
  operation: string,
  data: {
    namespace?: string;
    source?: AnalyticsSource;
    duration_ms?: number;
    success?: boolean;
    error?: string;
    meta?: Record<string, unknown>;
  } = {},
) {
  try {
    const d = getDb();
    if (!d) return;

    const source =
      data.source ?? analyticsContext.getStore()?.source ?? null;

    d.run(
      `INSERT INTO events (operation, namespace, source, duration_ms, success, error, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        operation,
        data.namespace ?? "default",
        source,
        data.duration_ms ?? null,
        data.success === false ? 0 : 1,
        data.error ?? null,
        data.meta ? JSON.stringify(data.meta) : null,
      ],
    );
  } catch {
    // Silently ignore — analytics must never break the app
  }
}

/**
 * Wrap an async operation with automatic timing + error tracking.
 * metaFn extracts operation-specific metadata from the result after success.
 */
export async function tracked<T>(
  operation: string,
  opts: { namespace?: string },
  fn: () => Promise<T>,
  metaFn?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration_ms = performance.now() - start;
    let meta: Record<string, unknown> | undefined;
    try { meta = metaFn?.(result); } catch { /* analytics metadata failure must not affect the operation */ }
    track(operation, { namespace: opts.namespace, duration_ms, meta });
    return result;
  } catch (err) {
    const duration_ms = performance.now() - start;
    track(operation, {
      namespace: opts.namespace,
      duration_ms,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Low-level query helper. Exported for tests only — app code should use named query functions. */
export function queryDb(
  sql: string,
  params: QueryParam[] = [],
): Record<string, unknown>[] {
  const d = getDb();
  if (!d) return [];
  try {
    return d.query(sql).all(...params) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

/** Operation summary: counts, latency stats, error rates grouped by operation. */
export function getOperationSummary(where = "", params: QueryParam[] = []) {
  return queryDb(
    `SELECT operation, COUNT(*) as count,
       ROUND(AVG(duration_ms), 1) as avg_ms,
       ROUND(MIN(duration_ms), 1) as min_ms,
       ROUND(MAX(duration_ms), 1) as max_ms,
       SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors,
       COUNT(DISTINCT source) as sources
     FROM events ${where} GROUP BY operation ORDER BY count DESC`,
    params,
  );
}

/** Source breakdown: event counts per source (mcp/cli/web/internal). */
export function getSourceBreakdown(where = "", params: QueryParam[] = []) {
  return queryDb(
    `SELECT COALESCE(source, 'internal') as source, COUNT(*) as count
     FROM events ${where} GROUP BY source ORDER BY count DESC`,
    params,
  );
}

/** Total event count with earliest/latest timestamps. */
export function getEventTotals(where = "", params: QueryParam[] = []) {
  const rows = queryDb(
    `SELECT COUNT(*) as total, MIN(ts) as earliest, MAX(ts) as latest FROM events ${where}`,
    params,
  );
  return rows[0] ?? { total: 0, earliest: null, latest: null };
}

/** Close the analytics DB. Called on process exit and in test cleanup. */
export function closeAnalytics() {
  if (db) {
    db.close();
    db = null;
  }
}

// Ensure WAL checkpoints on clean exit
process.on("exit", closeAnalytics);

/** Override DB path for testing. Must be called before any track(). */
export function setAnalyticsPath(path: string) {
  if (db) {
    db.close();
    db = null;
  }
  process.env.__ANALYTICS_DB_PATH = path;
}

/** Reset the path override (for test cleanup). */
export function resetAnalyticsPath() {
  delete process.env.__ANALYTICS_DB_PATH;
  if (db) {
    db.close();
    db = null;
  }
}
