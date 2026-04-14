import { useState, useEffect, useCallback } from "react";

interface UseListDataOptions<T> {
  fetchFn: (params: { offset: number; limit: number }) => Promise<{ items: T[]; total: number }>;
  pageSize?: number;
}

interface UseListDataResult<T> {
  items: T[];
  total: number;
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Paginated list hook used by MemoryList / EntityList / EdgeList.
 *
 * Review pass 7 finding #4: the previous implementation stashed `fetchFn` in
 * a ref and depended `load` on `[pageSize]` alone — so namespace / category /
 * type / includeInvalidated filter changes produced a new `fetchFn` identity
 * that the ref silently absorbed. The reload effect never re-fired and the UI
 * showed stale data without a loading indicator. The fix: depend `load` on
 * `[fetchFn, pageSize]` directly.
 *
 * Callers MUST stabilise `fetchFn` with `useCallback` listing the filter
 * inputs in its deps; all three list components already do. An unstable
 * `fetchFn` would loop — which is the correct symptom of "every render is a
 * new query", not a hook bug.
 */
export function useListData<T>({ fetchFn, pageSize = 30 }: UseListDataOptions<T>): UseListDataResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (currentOffset: number, append: boolean) => {
    setIsLoading(true);
    try {
      const result = await fetchFn({ offset: currentOffset, limit: pageSize });
      setItems((prev) => append ? [...prev, ...result.items] : result.items);
      setTotal(result.total);
    } catch (err) {
      console.error("Failed to load list data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchFn, pageSize]);

  // Initial load + reload when fetchFn identity changes (filter change).
  useEffect(() => {
    setOffset(0);
    setItems([]);
    load(0, false);
  }, [load]);

  const loadMore = useCallback(() => {
    const nextOffset = offset + pageSize;
    setOffset(nextOffset);
    load(nextOffset, true);
  }, [offset, pageSize, load]);

  const refresh = useCallback(() => {
    setOffset(0);
    load(0, false);
  }, [load]);

  const hasMore = items.length < total;

  return { items, total, isLoading, hasMore, loadMore, refresh };
}
