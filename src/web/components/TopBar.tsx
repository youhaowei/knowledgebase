import { PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { Button } from "@stdui/react";

interface TopBarProps {
  leftPanelOpen: boolean;
  onToggleLeftPanel: () => void;
  namespaces: string[];
  selectedNamespace: string | undefined;
  onNamespaceChange: (ns: string | undefined) => void;
  onOpenSearch: () => void;
  onOpenAdd: () => void;
}

export function TopBar({
  leftPanelOpen,
  onToggleLeftPanel,
  namespaces,
  selectedNamespace,
  onNamespaceChange,
  onOpenSearch,
  onOpenAdd,
}: TopBarProps) {
  return (
    <div className="h-12 shrink-0 flex items-center gap-3 px-3 border-b border-neutral-border bg-neutral-bg/60 backdrop-blur-xl z-20">
      {/* Left: toggle + logo */}
      <Button
        label={leftPanelOpen ? "Collapse panel" : "Expand panel"}
        variant="ghost"
        size="sm"
        iconOnly
        icon={leftPanelOpen ? PanelLeftClose : PanelLeftOpen}
        onClick={onToggleLeftPanel}
      />

      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded-full bg-palette-primary/20 flex items-center justify-center">
          <div className="h-2 w-2 rounded-full bg-palette-primary animate-pulse" />
        </div>
        <span className="font-display text-sm font-semibold text-neutral-fg">
          Knowledgebase
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: namespace filter + search + add */}
      <select
        value={selectedNamespace ?? "default"}
        onChange={(e) => onNamespaceChange(e.target.value)}
        className="h-8 rounded-md bg-neutral-bg-subtle border border-neutral-border px-2 text-xs text-neutral-fg focus:border-palette-primary focus:outline-none"
      >
        {namespaces.map((ns) => (
          <option key={ns} value={ns}>{ns}</option>
        ))}
      </select>

      <Button
        label="Search"
        variant="ghost"
        size="sm"
        icon={Search}
        onClick={onOpenSearch}
      />

      <Button
        label="Add"
        variant="solid"
        size="sm"
        color="primary"
        icon={Plus}
        onClick={onOpenAdd}
      />
    </div>
  );
}
