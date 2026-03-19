import { useState, useEffect, useCallback, useRef } from "react";

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

export function useListData<T>({ fetchFn, pageSize = 30 }: UseListDataOptions<T>): UseListDataResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  const load = useCallback(async (currentOffset: number, append: boolean) => {
    setIsLoading(true);
    try {
      const result = await fetchRef.current({ offset: currentOffset, limit: pageSize });
      setItems((prev) => append ? [...prev, ...result.items] : result.items);
      setTotal(result.total);
    } catch (err) {
      console.error("Failed to load list data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [pageSize]);

  // Initial load + reload when fetchFn identity changes (filter change)
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
