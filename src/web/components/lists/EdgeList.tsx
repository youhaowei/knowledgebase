import { useCallback, useState } from "react";
import { Link2, ChevronDown, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@stdui/react";
import { useListData } from "@/web/hooks/useListData";
import { listEdges } from "@/server/functions";
import type { SelectedItem } from "@/routes/index";
import type { StoredEdge } from "@/types";

interface EdgeListProps {
  namespace: string | undefined;
  selectedItem: SelectedItem | null;
  onSelect: (item: SelectedItem) => void;
}

interface ListEdgesParams {
  offset: number;
  limit: number;
  namespace?: string;
  relationType?: string;
  includeInvalidated: boolean;
  sortBy: "createdAt" | "name";
  sortDir: "asc" | "desc";
}

type EdgeListResponse = { items: StoredEdge[]; total: number; hasMore?: boolean };

function sentimentColor(s: number): "success" | "danger" | "secondary" {
  if (s > 0.3) return "success";
  if (s < -0.3) return "danger";
  return "secondary";
}

function SentimentIcon({ sentiment }: { sentiment: number }) {
  if (sentiment > 0.3) return <TrendingUp className="h-3 w-3" />;
  if (sentiment < -0.3) return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

export function EdgeList({ namespace, selectedItem, onSelect }: EdgeListProps) {
  const [showInvalidated, setShowInvalidated] = useState(false);

  const fetchFn = useCallback(
    async ({ offset, limit }: { offset: number; limit: number }) => {
      const params: ListEdgesParams = {
        offset,
        limit,
        sortBy: "createdAt",
        sortDir: "desc",
        includeInvalidated: showInvalidated,
      };
      if (namespace) params.namespace = namespace;
      return listEdges({ data: params }) as Promise<EdgeListResponse>;
    },
    [namespace, showInvalidated],
  );

  const { items, isLoading, hasMore, loadMore } = useListData({ fetchFn });
  const isEmpty = items.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="px-3 py-2 border-b border-neutral-border">
        <label className="flex items-center gap-2 text-xs text-neutral-fg-subtle cursor-pointer">
          <input
            type="checkbox"
            checked={showInvalidated}
            onChange={(e) => setShowInvalidated(e.target.checked)}
            className="rounded border-neutral-border"
          />
          Show invalidated
        </label>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && isEmpty && (
          <div className="flex items-center justify-center h-32 text-neutral-fg-subtle text-xs">
            Loading facts...
          </div>
        )}
        {!isLoading && isEmpty && (
          <div className="flex flex-col items-center justify-center h-32 text-neutral-fg-subtle text-xs gap-2">
            <Link2 className="h-8 w-8 opacity-30" />
            No facts found
          </div>
        )}
        {!isEmpty && (
          <>
            {items.map((edge) => {
              const isSelected = selectedItem?.type === "edge" && selectedItem?.edgeId === edge.id;
              const isInvalidated = edge.invalidAt != null;
              const selectionClass = isSelected
                ? "bg-palette-primary/10 border-l-2 border-l-palette-primary"
                : "hover:bg-neutral-bg-subtle";
              return (
                <button
                  key={edge.id}
                  onClick={() => onSelect({ type: "edge", name: edge.fact, edgeId: edge.id, namespace: edge.namespace })}
                  className={`w-full text-left px-3 py-2.5 border-b border-neutral-border/50 transition-colors ${selectionClass} ${isInvalidated ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-1 text-[11px] text-neutral-fg-subtle">
                    <span className="text-neutral-fg font-medium truncate">{edge.sourceEntityName}</span>
                    <span className="text-palette-primary">→</span>
                    <span className="text-palette-primary font-medium">{edge.relationType}</span>
                    <span className="text-palette-primary">→</span>
                    <span className="text-neutral-fg font-medium truncate">{edge.targetEntityName}</span>
                  </div>
                  <p className="text-[11px] text-neutral-fg-subtle mt-0.5 line-clamp-2">
                    {edge.fact}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="soft" color={sentimentColor(edge.sentiment)} className="text-[10px] gap-0.5">
                      <SentimentIcon sentiment={edge.sentiment} />
                      {edge.sentiment > 0 ? "+" : ""}{edge.sentiment.toFixed(1)}
                    </Badge>
                    {isInvalidated && (
                      <Badge variant="soft" color="danger" className="text-[10px]">
                        invalidated
                      </Badge>
                    )}
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
