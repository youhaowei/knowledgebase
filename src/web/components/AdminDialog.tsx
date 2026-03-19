import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Merge, Activity } from "lucide-react";
import { reextractAll, getReextractStatus, deduplicateEntities } from "@/server/functions";
import type { Stats } from "./types";

interface AdminDialogProps {
  open: boolean;
  onClose: () => void;
  stats: Stats | null;
  onRefresh: () => void;
}

export function AdminDialog({ open, onClose, stats, onRefresh }: AdminDialogProps) {
  const [reextractStatus, setReextractStatus] = useState<{
    running: boolean;
    current: number;
    total: number;
    currentName: string;
    phase: string;
    success: number;
    failed: number;
  } | null>(null);
  const [dedupResult, setDedupResult] = useState<string | null>(null);
  const [isDeduping, setIsDeduping] = useState(false);

  // Poll reextract status
  useEffect(() => {
    if (!open || !reextractStatus?.running) return;
    const interval = setInterval(async () => {
      const status = await getReextractStatus();
      setReextractStatus(status);
      if (!status.running) {
        onRefresh();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [open, reextractStatus?.running, onRefresh]);

  const handleReextract = useCallback(async () => {
    const result = await reextractAll();
    if (result.started) {
      setReextractStatus({ running: true, current: 0, total: result.total ?? 0, currentName: "", phase: "starting", success: 0, failed: 0 });
    }
  }, []);

  const handleDedup = useCallback(async () => {
    setIsDeduping(true);
    setDedupResult(null);
    try {
      const result = await deduplicateEntities();
      if ("error" in result) {
        setDedupResult(`Error: ${result.error}`);
      } else {
        setDedupResult(`Merged ${result.merged} groups, removed ${result.removed} duplicates (${result.remaining} remaining)`);
        onRefresh();
      }
    } catch (err) {
      setDedupResult(`Failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setIsDeduping(false);
    }
  }, [onRefresh]);

  if (!open) return null;

  const progress = reextractStatus?.total ? Math.round((reextractStatus.current / reextractStatus.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md mx-4 rounded-xl bg-deep/98 border border-border shadow-2xl animate-in">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-display font-semibold text-text-primary">Admin</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-xs">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Stats */}
          <div>
            <div className="text-[10px] font-medium text-text-secondary uppercase tracking-wider mb-2">
              Statistics
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-md bg-surface/60 border border-border text-center">
                <div className="text-lg font-display text-glow-cyan">{stats?.memories ?? 0}</div>
                <div className="text-[10px] text-text-secondary">Memories</div>
              </div>
              <div className="p-2.5 rounded-md bg-surface/60 border border-border text-center">
                <div className="text-lg font-display text-glow-violet">{stats?.entities ?? 0}</div>
                <div className="text-[10px] text-text-secondary">Entities</div>
              </div>
              <div className="p-2.5 rounded-md bg-surface/60 border border-border text-center">
                <div className="text-lg font-display text-glow-magenta">{stats?.edges ?? 0}</div>
                <div className="text-[10px] text-text-secondary">Edges</div>
              </div>
            </div>
          </div>

          {/* Re-extract */}
          <div>
            <div className="text-[10px] font-medium text-text-secondary uppercase tracking-wider mb-2">
              Actions
            </div>
            <div className="space-y-2">
              <button
                onClick={handleReextract}
                disabled={reextractStatus?.running}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-surface/60 border border-border text-xs text-text-primary hover:bg-surface hover:border-border-glow disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-glow-cyan ${reextractStatus?.running ? "animate-spin" : ""}`} />
                {reextractStatus?.running ? "Re-extracting..." : "Re-extract All"}
              </button>

              {reextractStatus?.running && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-text-secondary">
                    <span>{reextractStatus.currentName || "Starting..."}</span>
                    <span>{reextractStatus.current}/{reextractStatus.total}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface overflow-hidden">
                    <div
                      className="h-full bg-glow-cyan rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex gap-3 text-[10px] text-text-tertiary">
                    <span>Phase: {reextractStatus.phase}</span>
                    <span className="text-glow-cyan">{reextractStatus.success} ok</span>
                    {reextractStatus.failed > 0 && (
                      <span className="text-glow-magenta">{reextractStatus.failed} failed</span>
                    )}
                  </div>
                </div>
              )}

              {reextractStatus && !reextractStatus.running && reextractStatus.total > 0 && (
                <div className="text-[10px] text-text-secondary px-1">
                  Completed: {reextractStatus.success} succeeded, {reextractStatus.failed} failed
                </div>
              )}

              <button
                onClick={handleDedup}
                disabled={isDeduping}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-surface/60 border border-border text-xs text-text-primary hover:bg-surface hover:border-border-glow disabled:opacity-50 transition-colors"
              >
                <Merge className="h-3.5 w-3.5 text-glow-violet" />
                {isDeduping ? "Deduplicating..." : "Deduplicate Entities"}
              </button>

              {dedupResult && (
                <div className="text-[10px] text-text-secondary px-1">
                  {dedupResult}
                </div>
              )}
            </div>
          </div>

          {/* Health */}
          <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
            <Activity className="h-3 w-3 text-glow-cyan" />
            <span>System healthy</span>
          </div>
        </div>
      </div>
    </div>
  );
}
