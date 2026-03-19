import { useCallback, useMemo, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { Badge } from "@stdui/react";
import { useListData } from "@/web/hooks/useListData";
import { listMemories } from "@/server/functions";
import type { SelectedItem } from "@/routes/index";

interface MemoryListProps {
  namespace: string | undefined;
  selectedItem: SelectedItem | null;
  onSelect: (item: SelectedItem) => void;
}

const CATEGORY_COLORS: Record<string, "primary" | "info" | "warning" | "secondary"> = {
  preference: "primary",
  event: "info",
  pattern: "warning",
  general: "secondary",
};

export function MemoryList({ namespace, selectedItem, onSelect }: MemoryListProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const fetchFn = useCallback(
    async ({ offset, limit }: { offset: number; limit: number }) => {
      const params: Record<string, unknown> = { offset, limit, sortBy: "createdAt", sortDir: "desc" };
      if (namespace) params.namespace = namespace;
      if (categoryFilter) params.category = categoryFilter;
      return listMemories({ data: params as any });
    },
    [namespace, categoryFilter],
  );

  const { items, isLoading, hasMore, loadMore } = useListData({ fetchFn });

  const timeAgo = useMemo(() => {
    return (date: Date | string) => {
      const d = typeof date === "string" ? new Date(date) : date;
      const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
      if (seconds < 60) return "just now";
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
      return `${Math.floor(seconds / 86400)}d ago`;
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="px-3 py-2 border-b border-neutral-border">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="w-full h-7 rounded-md bg-neutral-bg-subtle border border-neutral-border px-2 text-xs text-neutral-fg focus:border-palette-primary focus:outline-none"
        >
          <option value="">All categories</option>
          <option value="preference">Preference</option>
          <option value="event">Event</option>
          <option value="pattern">Pattern</option>
          <option value="general">General</option>
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && items.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-neutral-fg-subtle text-xs">
            Loading memories...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-neutral-fg-subtle text-xs gap-2">
            <Brain className="h-8 w-8 opacity-30" />
            No memories found
          </div>
        ) : (
          <>
            {items.map((memory) => {
              const isSelected = selectedItem?.type === "memory" && selectedItem?.name === memory.name;
              return (
                <button
                  key={memory.id}
                  onClick={() => onSelect({ type: "memory", name: memory.name })}
                  className={`w-full text-left px-3 py-2.5 border-b border-neutral-border/50 transition-colors ${
                    isSelected
                      ? "bg-palette-primary/10 border-l-2 border-l-palette-primary"
                      : "hover:bg-neutral-bg-subtle"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-neutral-fg truncate flex-1">
                      {memory.name}
                    </span>
                    {memory.category && (
                      <Badge variant="soft" color={CATEGORY_COLORS[memory.category] ?? "secondary"} className="text-[10px] shrink-0">
                        {memory.category}
                      </Badge>
                    )}
                  </div>
                  {memory.summary && (
                    <p className="text-[11px] text-neutral-fg-subtle mt-0.5 line-clamp-2">
                      {memory.summary}
                    </p>
                  )}
                  <div className="text-[10px] text-neutral-fg-subtle/60 mt-1">
                    {timeAgo(memory.createdAt)}
                  </div>
                </button>
              );
            })}

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={isLoading}
                className="w-full py-2 text-xs text-palette-primary hover:bg-neutral-bg-subtle flex items-center justify-center gap-1"
              >
                <ChevronDown className="h-3 w-3" />
                {isLoading ? "Loading..." : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
