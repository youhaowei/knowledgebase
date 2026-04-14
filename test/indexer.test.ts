import { afterEach, describe, expect, test } from "bun:test";

import {
  configureIndexerDependenciesForTests,
  ensureServerIndexerStarted,
  resetIndexerStateForTests,
} from "../src/server/indexer.js";

afterEach(() => {
  resetIndexerStateForTests();
});

// These tests verify the singleton + dedup mechanics of ensureServerIndexerStarted.
// They are intentionally implementation-shaped because the contract we're
// defending — "called twice still only produces one sweep per cycle" — is
// a race-condition guarantee, not a visible-behavior contract. Spec anchor:
// Decision #6 (server watcher + 60s reconciliation sweep) and US-19 (server
// indexing is a single background process, not one-per-import).
describe("Decision #6: ensureServerIndexerStarted — single reconciliation loop", () => {
  test("Decision #6: idempotent boot — two calls produce one sweep + one interval", async () => {
    let sweeps = 0;
    let intervals = 0;
    const fakeTimer = { unref() {} } as ReturnType<typeof setInterval>;

    configureIndexerDependenciesForTests({
      processUnindexedMemories: async () => {
        sweeps += 1;
        return 0;
      },
      // Review pass 7 finding #10 added a tombstone drain to the sweep; tests
      // mock it to a no-op so they don't depend on a real graph provider.
      drainTombstones: async () => ({ memoriesForgotten: 0, edgesForgotten: 0 }),
      setInterval: (() => {
        intervals += 1;
        return fakeTimer;
      }) as typeof setInterval,
    });

    ensureServerIndexerStarted();
    ensureServerIndexerStarted();
    await Bun.sleep(0);

    expect(sweeps).toBe(1);
    expect(intervals).toBe(1);
  });

  test("Decision #6: in-flight sweep is reused — no overlapping reconciliations", async () => {
    let sweeps = 0;
    let release!: () => void;
    let intervalCallback: (() => void) | undefined;
    const fakeTimer = { unref() {} } as ReturnType<typeof setInterval>;

    configureIndexerDependenciesForTests({
      processUnindexedMemories: async () => {
        sweeps += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return 0;
      },
      drainTombstones: async () => ({ memoriesForgotten: 0, edgesForgotten: 0 }),
      setInterval: ((callback: TimerHandler) => {
        intervalCallback = callback as () => void;
        return fakeTimer;
      }) as typeof setInterval,
    });

    ensureServerIndexerStarted();
    await Bun.sleep(0);
    intervalCallback?.();
    await Bun.sleep(0);

    expect(sweeps).toBe(1);

    release();
    await Bun.sleep(0);

    intervalCallback?.();
    await Bun.sleep(0);

    expect(sweeps).toBe(2);
  });

  test("Review pass 7 #10: sweep drains tombstones after unindexed processing", async () => {
    let drains = 0;

    configureIndexerDependenciesForTests({
      processUnindexedMemories: async () => 0,
      drainTombstones: async () => {
        drains += 1;
        // Returning non-zero exercises the "drained N" log path in runSweep.
        return { memoriesForgotten: 2, edgesForgotten: 1 };
      },
      setInterval: (() => ({ unref() {} } as ReturnType<typeof setInterval>)) as typeof setInterval,
    });

    ensureServerIndexerStarted();
    // Let the boot-time sweep resolve (process + drain).
    await Bun.sleep(0);
    await Bun.sleep(0);

    expect(drains).toBe(1);
  });
});
