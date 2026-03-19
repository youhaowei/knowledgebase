import { X, Brain, Users, Link2, Trash2 } from "lucide-react";
import { Badge } from "@stdui/react";
import { EntityDetail } from "./detail/EntityDetail";
import { MemoryDetail } from "./detail/MemoryDetail";
import { EdgeDetail } from "./detail/EdgeDetail";
import { forgetMemory } from "@/server/functions";
import type { SelectedItem } from "@/routes/index";
import { useState } from "react";

interface RightPanelProps {
  item: SelectedItem;
  namespace: string | undefined;
  onClose: () => void;
  onRefresh: () => void;
}

const TYPE_CONFIG: Record<string, { icon: typeof Brain; color: "primary" | "info" | "secondary"; label: string }> = {
  memory: { icon: Brain, color: "primary", label: "Memory" },
  entity: { icon: Users, color: "info", label: "Entity" },
  edge: { icon: Link2, color: "secondary", label: "Fact" },
};

export function RightPanel({ item, namespace, onClose, onRefresh }: RightPanelProps) {
  const config = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.entity!;
  const Icon = config.icon;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (item.type === "edge") return; // Edges use invalidate, not delete
    setIsDeleting(true);
    try {
      await forgetMemory({ data: { name: item.name, namespace: namespace ?? "default" } });
      onRefresh();
      onClose();
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-neutral-border">
        <Icon className="h-4 w-4 text-neutral-fg-subtle shrink-0" />
        <Badge variant="soft" color={config.color} className="text-[10px] shrink-0">
          {config.label}
        </Badge>
        <span className="text-xs font-medium text-neutral-fg truncate flex-1">
          {item.name}
        </span>
        <button
          onClick={onClose}
          className="shrink-0 p-1 rounded hover:bg-neutral-bg-subtle text-neutral-fg-subtle hover:text-neutral-fg transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {item.type === "entity" && (
          <EntityDetail name={item.name} namespace={namespace} />
        )}
        {item.type === "memory" && (
          <MemoryDetail name={item.name} />
        )}
        {item.type === "edge" && item.edgeId && (
          <EdgeDetail
            edgeId={item.edgeId}
            namespace={namespace}
            onInvalidated={() => { onRefresh(); onClose(); }}
          />
        )}
      </div>

      {/* Footer — actions */}
      {item.type !== "edge" && (
        <div className="shrink-0 px-4 py-2.5 border-t border-neutral-border">
          {showDeleteConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-fg-subtle">Delete this {item.type}?</span>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-2.5 py-1 rounded-md bg-palette-danger text-white text-xs font-medium disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Confirm"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-2.5 py-1 rounded-md bg-neutral-bg-subtle border border-neutral-border text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 text-xs text-palette-danger hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete {item.type}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
