import { queueUnindexedMemories } from "../lib/operations.js";

const RECONCILIATION_INTERVAL_MS = 60_000;

// Use globalThis to survive Vite HMR module re-execution
const KEY = Symbol.for("kb:indexer");
type IndexerState = { started: boolean; timer: ReturnType<typeof setInterval> | null; sweep: Promise<void> | null };

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
      const queued = await queueUnindexedMemories();
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
  if (state.timer) clearInterval(state.timer);

  state.started = true;
  void runSweep();
  state.timer = setInterval(() => {
    void runSweep();
  }, RECONCILIATION_INTERVAL_MS);

  if (typeof state.timer.unref === "function") {
    state.timer.unref();
  }
}
