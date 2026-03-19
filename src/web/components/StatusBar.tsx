import { Brain, Users, Link2, Settings } from "lucide-react";
import { Badge } from "@stdui/react";
import type { Stats } from "./types";

interface StatusBarProps {
  stats: Stats | null;
  onOpenAdmin: () => void;
}

export function StatusBar({ stats, onOpenAdmin }: StatusBarProps) {
  return (
    <div className="h-8 shrink-0 flex items-center gap-3 px-3 border-t border-neutral-border bg-neutral-bg/60 backdrop-blur-xl z-20">
      <div className="flex items-center gap-2">
        <Badge variant="soft" color="primary" className="gap-1">
          <Brain className="h-3 w-3" />
          {stats?.memories ?? 0}
        </Badge>
        <Badge variant="soft" color="info" className="gap-1">
          <Users className="h-3 w-3" />
          {stats?.entities ?? 0}
        </Badge>
        <Badge variant="soft" color="secondary" className="gap-1">
          <Link2 className="h-3 w-3" />
          {stats?.edges ?? 0}
        </Badge>
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
