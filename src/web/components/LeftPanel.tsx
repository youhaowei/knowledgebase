import { useState } from "react";
import { Brain, Users, Link2 } from "lucide-react";
import { MemoryList } from "./lists/MemoryList";
import { EntityList } from "./lists/EntityList";
import { EdgeList } from "./lists/EdgeList";
import type { SelectedItem } from "@/routes/index";

interface LeftPanelProps {
  namespace: string | undefined;
  selectedItem: SelectedItem | null;
  onSelect: (item: SelectedItem) => void;
}

type Tab = "memories" | "entities" | "facts";

const TABS: { id: Tab; label: string; icon: typeof Brain }[] = [
  { id: "memories", label: "Memories", icon: Brain },
  { id: "entities", label: "Entities", icon: Users },
  { id: "facts", label: "Facts", icon: Link2 },
];

export function LeftPanel({ namespace, selectedItem, onSelect }: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("memories");

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-neutral-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors ${
              activeTab === id
                ? "text-palette-primary border-b-2 border-palette-primary bg-palette-primary/5"
                : "text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-bg-subtle"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "memories" && (
          <MemoryList namespace={namespace} selectedItem={selectedItem} onSelect={onSelect} />
        )}
        {activeTab === "entities" && (
          <EntityList namespace={namespace} selectedItem={selectedItem} onSelect={onSelect} />
        )}
        {activeTab === "facts" && (
          <EdgeList namespace={namespace} selectedItem={selectedItem} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}
