import { Brain, Users, Link2, Settings, AlertTriangle } from "lucide-react";
import { Badge } from "@stdui/react";
import type { Stats } from "./types";

interface StatusBarProps {
  stats: Stats | null;
  onOpenAdmin: () => void;
}

// Review pass 7 finding #13: graph-derived counts (entities, edges) may be
// `null` when the indexer is offline. Rendering `?? 0` misled users into
// thinking the KB was empty; render an em-dash so the absence is explicit,
// and surface a degraded pill alongside.
function graphCount(n: number | null | undefined): string {
  return typeof n === "number" ? String(n) : "—";
}

export function StatusBar({ stats, onOpenAdmin }: StatusBarProps) {
  const isDegraded = stats?.degraded === true;
  return (
    <div className="h-8 shrink-0 flex items-center gap-3 px-3 border-t border-neutral-border bg-neutral-bg/60 backdrop-blur-xl z-20">
      <div className="flex items-center gap-2">
        <Badge variant="soft" color="primary" className="gap-1">
          <Brain className="h-3 w-3" />
          {stats?.memories ?? 0}
        </Badge>
        <Badge variant="soft" color="info" className="gap-1">
          <Users className="h-3 w-3" />
          {graphCount(stats?.entities)}
        </Badge>
        <Badge variant="soft" color="secondary" className="gap-1">
          <Link2 className="h-3 w-3" />
          {graphCount(stats?.edges)}
        </Badge>
        {isDegraded && (
          <span title="Graph index offline — entities and edges will return once the indexer is back">
            <Badge variant="soft" color="warning" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              degraded
            </Badge>
          </span>
        )}
      </div>

      <div className="flex-1" />

      <button
        onClick={onOpenAdmin}
        className="flex items-center gap-1.5 text-xs text-neutral-fg-subtle hover:text-neutral-fg transition-colors"
      >
        <Settings className="h-3.5 w-3.5" />
        Admin
      </button>
    </div>
  );
}
