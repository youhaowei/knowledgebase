import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Merge, Activity, Check, X } from "lucide-react";
import { reextractAll, getReextractStatus, findDuplicateCandidates, mergeDuplicateGroup } from "@/server/functions";
import type { Stats } from "./types";

interface DuplicateCandidate {
  keep: { uuid: string; name: string };
  duplicates: Array<{ uuid: string; name: string }>;
  normalizedName: string;
  totalEdges: number;
}

/** All members of a group with a selectable merge target */
interface MergeGroup {
  members: Array<{ uuid: string; name: string }>;
  keepUuid: string; // which member is currently selected as merge target
  normalizedName: string;
  totalEdges: number;
}

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
  const [mergeGroups, setMergeGroups] = useState<MergeGroup[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<string | null>(null);

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

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setMergeGroups(null);
      setMergeProgress(null);
    }
  }, [open]);

  const handleReextract = useCallback(async () => {
    const result = await reextractAll();
    if (result.started) {
      setReextractStatus({ running: true, current: 0, total: result.total ?? 0, currentName: "", phase: "starting", success: 0, failed: 0 });
    }
  }, []);

  const handleScanDuplicates = useCallback(async () => {
    setIsScanning(true);
    setMergeProgress(null);
    try {
      const result = await findDuplicateCandidates();
      if ("error" in result && result.error) {
        setMergeProgress(`Error: ${result.error}`);
      } else {
        // Convert candidates to merge groups with all members
        const groups: MergeGroup[] = result.candidates.map((c) => ({
          members: [c.keep, ...c.duplicates],
          keepUuid: c.keep.uuid,
          normalizedName: c.normalizedName,
          totalEdges: c.totalEdges,
        }));
        setMergeGroups(groups);
        if (groups.length === 0) {
          setMergeProgress("No duplicates found");
        }
      }
    } catch (err) {
      setMergeProgress(`Failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const handleSelectKeep = useCallback((groupIdx: number, uuid: string) => {
    setMergeGroups((prev) => {
      if (!prev) return null;
      return prev.map((g, i) => i === groupIdx ? { ...g, keepUuid: uuid } : g);
    });
  }, []);

  const handleMergeGroup = useCallback(async (group: MergeGroup) => {
    try {
      await mergeDuplicateGroup({
        data: {
          keepUuid: group.keepUuid,
          duplicateUuids: group.members.filter((m) => m.uuid !== group.keepUuid).map((m) => m.uuid),
        },
      });
      setMergeGroups((prev) => prev?.filter((g) => g.keepUuid !== group.keepUuid || g.members !== group.members) ?? null);
      onRefresh();
    } catch (err) {
      setMergeProgress(`Merge failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }, [onRefresh]);

  const handleDismissGroup = useCallback((group: MergeGroup) => {
    setMergeGroups((prev) => prev?.filter((g) => g !== group) ?? null);
  }, []);

  const handleMergeAll = useCallback(async () => {
    if (!mergeGroups) return;
    setMergeProgress("Merging...");
    let merged = 0;
    for (const group of mergeGroups) {
      try {
        await mergeDuplicateGroup({
          data: {
            keepUuid: group.keepUuid,
            duplicateUuids: group.members.filter((m) => m.uuid !== group.keepUuid).map((m) => m.uuid),
          },
        });
        merged++;
      } catch { /* continue with next */ }
    }
    setMergeGroups(null);
    setMergeProgress(`Merged ${merged} groups`);
    onRefresh();
  }, [mergeGroups, onRefresh]);

  if (!open) return null;

  const progress = reextractStatus?.total ? Math.round((reextractStatus.current / reextractStatus.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md mx-4 rounded-xl bg-deep/98 border border-border shadow-2xl animate-in max-h-[70vh] flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 className="text-sm font-display font-semibold text-text-primary">Admin</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-xs">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
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

          {/* Actions */}
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
                onClick={handleScanDuplicates}
                disabled={isScanning}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-surface/60 border border-border text-xs text-text-primary hover:bg-surface hover:border-border-glow disabled:opacity-50 transition-colors"
              >
                <Merge className={`h-3.5 w-3.5 text-glow-violet ${isScanning ? "animate-spin" : ""}`} />
                {isScanning ? "Scanning..." : "Deduplicate Entities"}
              </button>

              {mergeProgress && !mergeGroups?.length && (
                <div className="text-[10px] text-text-secondary px-1">
                  {mergeProgress}
                </div>
              )}
            </div>
          </div>

          {/* Merge Groups */}
          {mergeGroups && mergeGroups.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-medium text-text-secondary uppercase tracking-wider">
                  Merge Candidates ({mergeGroups.length})
                </div>
                <button
                  onClick={handleMergeAll}
                  className="text-[10px] text-glow-violet hover:text-glow-cyan transition-colors"
                >
                  Merge All
                </button>
              </div>
              <div className="space-y-2">
                {mergeGroups.map((group, groupIdx) => (
                  <div
                    key={group.members.map((m) => m.uuid).join("-")}
                    className="p-2.5 rounded-md bg-surface/60 border border-border"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {group.members.map((member) => (
                          <button
                            key={member.uuid}
                            onClick={() => handleSelectKeep(groupIdx, member.uuid)}
                            className={`block w-full text-left truncate transition-colors ${
                              member.uuid === group.keepUuid
                                ? "text-[11px] text-glow-cyan font-medium"
                                : "text-[10px] text-text-tertiary hover:text-text-secondary"
                            }`}
                            title={member.uuid === group.keepUuid ? "Keep this name" : `Click to keep "${member.name}" instead`}
                          >
                            {member.uuid === group.keepUuid ? "" : "= "}{member.name}
                          </button>
                        ))}
                        <div className="text-[9px] text-text-tertiary mt-1">
                          {group.totalEdges} edge{group.totalEdges !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => handleMergeGroup(group)}
                          className="p-1 rounded hover:bg-surface text-glow-cyan transition-colors"
                          title="Merge"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDismissGroup(group)}
                          className="p-1 rounded hover:bg-surface text-text-tertiary hover:text-text-secondary transition-colors"
                          title="Skip"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
