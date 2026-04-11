import { afterEach, describe, expect, mock, test } from "bun:test";
import { randomUUID } from "crypto";

function createReextractResult() {
  return {
    entities: [],
    edges: [],
    abstract: "",
    summary: "",
  };
}

function createQuickDependencies() {
  return {
    getProvider: async () => ({
      findMemories: async () => [],
      store: async () => {},
    }),
    importExtract: async () => ({
      extract: async () => createReextractResult(),
    }),
    importEmbed: async () => ({
      embedDual: async () => new Map(),
    }),
  };
}

function createBlockedDependencies(): { deps: ReturnType<typeof createQuickDependencies>; release: () => void } {
  let release!: () => void;

  return {
    deps: {
      ...createQuickDependencies(),
      getProvider: async () => ({
        findMemories: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return [];
        },
        store: async () => {},
      }),
    },
    release: () => release(),
  };
}

async function loadFunctions() {
  mock.restore();
  mock.module("../src/server/indexer.js", () => ({
    ensureServerIndexerStarted: () => {},
  }));

  const moduleUrl = new URL(`../src/server/functions.js?test=${randomUUID()}`, import.meta.url).href;
  return import(moduleUrl);
}

afterEach(() => {
  mock.restore();
});

describe("startReextractAll", () => {
  test("marks the run as active before the async job yields so a second start is rejected", async () => {
    const functions = await loadFunctions();

    const blocked = createBlockedDependencies();
    const first = await functions.startReextractAll(blocked.deps);

    const second = await functions.startReextractAll(createQuickDependencies());

    expect(first.started).toBe(true);
    expect(second).toEqual({ started: false, reason: "already running" });

    blocked.release();
    await Bun.sleep(0);

    const third = await functions.startReextractAll(createQuickDependencies());

    expect(third.started).toBe(true);
  });
});
