import { afterEach, describe, expect, test } from "bun:test";

import {
  configureIndexerDependenciesForTests,
  ensureServerIndexerStarted,
  resetIndexerStateForTests,
} from "../src/server/indexer.js";

afterEach(() => {
  resetIndexerStateForTests();
});

describe("ensureServerIndexerStarted", () => {
  test("starts one immediate sweep and one interval even if called twice", async () => {
    let sweeps = 0;
    let intervals = 0;
    const fakeTimer = { unref() {} } as ReturnType<typeof setInterval>;

    configureIndexerDependenciesForTests({
      processUnindexedMemories: async () => {
        sweeps += 1;
        return 0;
      },
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

  test("reuses the in-flight sweep promise instead of running overlapping reconciliations", async () => {
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
});
