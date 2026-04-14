import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Inspection-level tests for web hooks.
 *
 * This repo has no `@testing-library/react` / happy-dom setup, so hook
 * behaviour can't be exercised at runtime from bun test. These assertions
 * catch the specific regression from review pass 7 finding #4 by reading
 * the source and enforcing the load-bearing contract. Full behavioural
 * verification is manual (`bun run dev`, toggle a namespace / filter, see
 * list refresh).
 *
 * Adding a runtime hook test requires landing `happy-dom` +
 * `@testing-library/react` in devDependencies — tracked as a follow-up if
 * UI regressions keep surfacing.
 */
describe("useListData — review pass 7 finding #4", () => {
  const src = readFileSync(
    join(import.meta.dir, "..", "src", "web", "hooks", "useListData.ts"),
    "utf-8",
  );

  test("does not use the ref-capture pattern that swallowed filter changes", () => {
    // The previous impl did:
    //   const fetchRef = useRef(fetchFn);
    //   fetchRef.current = fetchFn;
    //   const load = useCallback(..., [pageSize]);   // <-- fetchFn absent
    // which meant the `load` identity was stable across filter changes and
    // the reload effect never re-fired. If either pattern returns, callers
    // will silently ship stale data.
    expect(src).not.toContain("useRef");
    expect(src).not.toContain("fetchRef");
  });

  test("load depends on [fetchFn, pageSize]", () => {
    // Literal-string check avoids the ReDoS risk of a generic `useCallback(.*)`
    // regex and locks the specific deps array. A future contributor who
    // "simplifies" by dropping fetchFn from the deps reintroduces the bug;
    // this test breaks and points them at the contract comment above.
    expect(src).toContain("[fetchFn, pageSize]");
  });

  test("reload effect is gated on `load` identity (and `load` is rebuilt when fetchFn changes)", () => {
    // Combined with the previous test, this produces the intended chain:
    // fetchFn changes -> load identity changes -> effect re-fires.
    // Match `}, [load]);` specifically — this unambiguously identifies the
    // deps array of the `useEffect(() => { ... }, [load])` reload hook, not
    // the load deps or loadMore/refresh callbacks (which carry additional
    // deps).
    expect(src).toContain("}, [load]);");
  });
});

describe("useListData callers memoize fetchFn with filter inputs", () => {
  const callers = [
    { file: "src/web/components/lists/MemoryList.tsx", deps: ["namespace", "categoryFilter"] },
    { file: "src/web/components/lists/EntityList.tsx", deps: ["namespace", "typeFilter"] },
    { file: "src/web/components/lists/EdgeList.tsx", deps: ["namespace", "showInvalidated"] },
  ];

  for (const { file, deps } of callers) {
    test(`${file} passes every filter input to useCallback's deps`, () => {
      const src = readFileSync(join(import.meta.dir, "..", file), "utf-8");
      // Grab the useCallback block that wraps fetchFn — identifier is `fetchFn`
      // throughout the list components. The deps array is the last argument.
      // Avoid a generic `useCallback\(.*\)` regex (sonarjs/slow-regex flags it
      // as ReDoS-vulnerable). Instead, walk: find `const fetchFn = useCallback(`,
      // then the matching close-paren by scanning the preceding `,` on the
      // line above the `);`. The deps array is always the last `[...]` before
      // `);` in the useCallback block.
      const start = src.indexOf("const fetchFn = useCallback(");
      expect(start).toBeGreaterThan(-1);
      const tail = src.slice(start);
      const closeIdx = tail.indexOf(");");
      const block = tail.slice(0, closeIdx);
      const depsOpen = block.lastIndexOf("[");
      const depsClose = block.lastIndexOf("]");
      expect(depsOpen).toBeGreaterThan(-1);
      expect(depsClose).toBeGreaterThan(depsOpen);
      const depsStr = block.slice(depsOpen + 1, depsClose);
      for (const d of deps) {
        expect(depsStr).toContain(d);
      }
    });
  }
});
