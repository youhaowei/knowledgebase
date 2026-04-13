import { processUnindexedMemories } from "../lib/operations.js";

const RECONCILIATION_INTERVAL_MS = 60_000;

// Use globalThis to survive Vite HMR module re-execution
const KEY = Symbol.for("kb:indexer");
type IndexerState = { started: boolean; timer: ReturnType<typeof setInterval> | null; sweep: Promise<void> | null };
const defaultIndexerDependencies = {
  processUnindexedMemories,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
};
const indexerDependencies = {
  ...defaultIndexerDependencies,
};

function getState(): IndexerState {
  const g = globalThis as Record<symbol, IndexerState | undefined>;
  if (!g[KEY]) {
    g[KEY] = { started: false, timer: null, sweep: null };
  }
  return g[KEY]!;
}

async function runSweep(): Promise<void> {
  const state = getState();
  if (state.sweep) {
    return state.sweep;
  }

  state.sweep = (async () => {
    try {
      const queued = await indexerDependencies.processUnindexedMemories();
      if (queued > 0) {
        console.error(`[kb] Catch-up queued ${queued} unindexed memories`);
      }
    } catch (error) {
      console.error("[kb] Catch-up sweep failed:", error);
    } finally {
      state.sweep = null;
    }
  })();

  return state.sweep;
}

export function ensureServerIndexerStarted(): void {
  if (typeof window !== "undefined") {
    return;
  }

  const state = getState();
  if (state.started) return;

  // Clear any leftover timer from a previous HMR cycle
  if (state.timer) indexerDependencies.clearInterval(state.timer);

  state.started = true;
  // Single observable boot message — without this, "is the indexer running?"
  // is unanswerable from logs alone. The interval fires on import (which is
  // bound to first MCP/web-fn/SSR request), not at process start.
  console.error(`[kb] Indexer sweep started — first sweep now, then every ${RECONCILIATION_INTERVAL_MS / 1000}s`);
  void runSweep();
  state.timer = indexerDependencies.setInterval(() => {
    void runSweep();
  }, RECONCILIATION_INTERVAL_MS);

  if (typeof state.timer.unref === "function") {
    state.timer.unref();
  }
}

export function configureIndexerDependenciesForTests(
  overrides: Partial<typeof defaultIndexerDependencies>,
): void {
  indexerDependencies.processUnindexedMemories = overrides.processUnindexedMemories
    ?? defaultIndexerDependencies.processUnindexedMemories;
  indexerDependencies.setInterval = overrides.setInterval
    ?? defaultIndexerDependencies.setInterval;
  indexerDependencies.clearInterval = overrides.clearInterval
    ?? defaultIndexerDependencies.clearInterval;
}

export function resetIndexerStateForTests(): void {
  const state = getState();
  if (state.timer) {
    indexerDependencies.clearInterval(state.timer);
  }
  state.started = false;
  state.timer = null;
  state.sweep = null;
  configureIndexerDependenciesForTests({});
}
