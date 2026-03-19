import { useCallback, useState } from "react";
import { Users, ChevronDown } from "lucide-react";
import { Badge } from "@stdui/react";
import { useListData } from "@/web/hooks/useListData";
import { listEntities } from "@/server/functions";
import type { SelectedItem } from "@/routes/index";

interface EntityListProps {
  namespace: string | undefined;
  selectedItem: SelectedItem | null;
  onSelect: (item: SelectedItem) => void;
}

const TYPE_COLORS: Record<string, "primary" | "info" | "secondary" | "warning" | "danger"> = {
  person: "primary",
  organization: "info",
  project: "info",
  technology: "secondary",
  concept: "warning",
};

export function EntityList({ namespace, selectedItem, onSelect }: EntityListProps) {
  const [typeFilter, setTypeFilter] = useState<string>("");

  const fetchFn = useCallback(
    async ({ offset, limit }: { offset: number; limit: number }) => {
      const params: Record<string, unknown> = { offset, limit, sortBy: "name", sortDir: "asc" };
      if (namespace) params.namespace = namespace;
      if (typeFilter) params.type = typeFilter;
      return listEntities({ data: params as any });
    },
    [namespace, typeFilter],
  );

  const { items, isLoading, hasMore, loadMore } = useListData({ fetchFn });

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="px-3 py-2 border-b border-neutral-border">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full h-7 rounded-md bg-neutral-bg-subtle border border-neutral-border px-2 text-xs text-neutral-fg focus:border-palette-primary focus:outline-none"
        >
          <option value="">All types</option>
          <option value="person">Person</option>
          <option value="organization">Organization</option>
          <option value="project">Project</option>
          <option value="technology">Technology</option>
          <option value="concept">Concept</option>
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && items.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-neutral-fg-subtle text-xs">
            Loading entities...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-neutral-fg-subtle text-xs gap-2">
            <Users className="h-8 w-8 opacity-30" />
            No entities found
          </div>
        ) : (
          <>
            {items.map((entity) => {
              const isSelected = selectedItem?.type === "entity" && selectedItem?.name === entity.name;
              return (
                <button
                  key={entity.name}
                  onClick={() => onSelect({ type: "entity", name: entity.name })}
                  className={`w-full text-left px-3 py-2.5 border-b border-neutral-border/50 transition-colors ${
                    isSelected
                      ? "bg-palette-primary/10 border-l-2 border-l-palette-primary"
                      : "hover:bg-neutral-bg-subtle"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-neutral-fg truncate flex-1">
                      {entity.name}
                    </span>
                    <Badge variant="soft" color={TYPE_COLORS[entity.type] ?? "secondary"} className="text-[10px] shrink-0">
                      {entity.type}
                    </Badge>
                  </div>
                  {entity.description && (
                    <p className="text-[11px] text-neutral-fg-subtle mt-0.5 line-clamp-2">
                      {entity.description}
                    </p>
                  )}
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
