/**
 * StatsOverlay - Minimal floating stats display with namespace selector
 *
 * Shows key metrics in a subtle overlay in the top-left corner.
 * Includes a namespace dropdown to filter the graph and stats.
 */

import { useState, useCallback } from "react";
import { Brain, Link2, Users, ChevronDown, RefreshCw } from "lucide-react";
import type { Stats } from "./types";
import { reextractAll, getReextractStatus, deduplicateEntities } from "@/server/functions";

interface StatsOverlayProps {
  stats: Stats | null;
  nodeCount: number;
  namespaces: string[];
  selectedNamespace: string | undefined;
  onNamespaceChange: (ns: string | undefined) => void;
}

export function StatsOverlay({
  stats,
  nodeCount,
  namespaces,
  selectedNamespace,
  onNamespaceChange,
}: StatsOverlayProps) {
  const [reextractStatus, setReextractStatus] = useState<{
    running: boolean;
    current: number;
    total: number;
    currentName: string;
    phase: string;
    edgeCurrent: number;
    edgeTotal: number;
    success: number;
    failed: number;
    lastEntities: number;
    lastEdges: number;
    errors: string[];
  } | null>(null);

  const startReextract = useCallback(async () => {
    await reextractAll();
    // Start polling
    const poll = setInterval(async () => {
      const status = await getReextractStatus();
      setReextractStatus(status);
      if (!status.running && status.total > 0) {
        clearInterval(poll);
        // Keep result visible for 5s then clear
        setTimeout(() => setReextractStatus(null), 5000);
      }
    }, 1000);
  }, []);

  if (!stats) return null;

  const items = [
    { icon: Brain, value: stats.memories, label: "Memories" },
    { icon: Users, value: stats.entities, label: "Entities" },
    { icon: Link2, value: stats.edges, label: "Edges" },
  ];

  return (
    <div className="fixed top-6 left-6 z-30">
      {/* Logo and title */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-surface/80 backdrop-blur-xl border border-border flex items-center justify-center shadow-lg">
          <KnowledgebaseIcon size={28} />
        </div>
        <div>
          <h1 className="font-display text-base font-semibold text-text-primary tracking-tight">
            Knowledgebase
          </h1>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-glow-cyan shadow-[0_0_8px_var(--color-glow-cyan)] animate-pulse" />
            <span className="text-[11px] font-medium tracking-wide uppercase text-text-tertiary">
              {nodeCount} nodes
            </span>
          </div>
        </div>
      </div>

      {/* Namespace selector + Stats pills */}
      <div className="flex flex-col gap-2">
        {/* Namespace dropdown */}
        <div className="relative">
          <select
            value={selectedNamespace ?? ""}
            onChange={(e) => onNamespaceChange(e.target.value || undefined)}
            className="appearance-none w-full px-3 py-2 pr-8 bg-surface/60 backdrop-blur-xl border border-border rounded-xl text-xs font-medium text-text-secondary hover:border-border-glow transition-colors cursor-pointer focus:outline-none focus:border-glow-cyan"
          >
            <option value="">All namespaces</option>
            {namespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary pointer-events-none" />
        </div>

        {/* Stats pills */}
        <div className="flex gap-2">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-2 px-3 py-2 bg-surface/60 backdrop-blur-xl border border-border rounded-xl transition-all duration-300 hover:border-border-glow group"
            >
              <item.icon className="w-3.5 h-3.5 text-text-tertiary group-hover:text-glow-cyan transition-colors" />
              <span className="font-display text-sm font-semibold text-text-primary">
                {item.value}
              </span>
              <span className="text-[11px] font-medium tracking-wide uppercase text-text-tertiary hidden sm:inline">
                {item.label}
              </span>
            </div>
          ))}

          {/* Admin buttons */}
          <button
            onClick={startReextract}
            disabled={reextractStatus?.running}
            className="flex items-center gap-2 px-3 py-2 bg-surface/60 backdrop-blur-xl border border-border rounded-xl transition-all duration-300 hover:border-glow-cyan disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-text-tertiary ${reextractStatus?.running ? "animate-spin text-glow-cyan" : ""}`} />
            <span className="text-[11px] font-medium tracking-wide uppercase text-text-tertiary">
              {reextractStatus?.running ? "Extracting..." : "Re-extract"}
            </span>
          </button>
          <button
            onClick={async () => {
              const result = await deduplicateEntities();
              alert(`Dedup: merged ${result.merged} groups, removed ${result.removed} duplicates. ${result.remaining} entities remaining.`);
            }}
            className="flex items-center gap-2 px-3 py-2 bg-surface/60 backdrop-blur-xl border border-border rounded-xl transition-all duration-300 hover:border-glow-cyan"
          >
            <span className="text-[11px] font-medium tracking-wide uppercase text-text-tertiary">Dedup</span>
          </button>
        </div>

        {/* Re-extract progress */}
        {reextractStatus?.running && (
          <div className="mt-2 px-3 py-2 bg-surface/60 backdrop-blur-xl border border-border rounded-xl space-y-1.5">
            {/* Memory name + count */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-primary font-medium truncate max-w-[200px]">
                {reextractStatus.currentName}
              </span>
              <span className="text-[11px] text-text-tertiary ml-2">
                {reextractStatus.current}/{reextractStatus.total}
              </span>
            </div>

            {/* Overall progress bar */}
            <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
              <div
                className="h-full bg-glow-cyan rounded-full transition-all duration-500"
                style={{ width: `${(reextractStatus.current / reextractStatus.total) * 100}%` }}
              />
            </div>

            {/* Phase detail */}
            <div className="flex items-center justify-between text-[10px] text-text-tertiary">
              <span>
                {reextractStatus.phase === "extracting" && "Extracting entities & edges..."}
                {reextractStatus.phase === "embedding-memory" && "Embedding memory text..."}
                {reextractStatus.phase === "embedding-edges" && `Embedding edges ${reextractStatus.edgeCurrent}/${reextractStatus.edgeTotal}...`}
                {reextractStatus.phase === "storing" && "Storing to graph..."}
              </span>
              {reextractStatus.lastEntities > 0 && (
                <span>{reextractStatus.lastEntities} entities, {reextractStatus.lastEdges} edges</span>
              )}
            </div>

            {/* Stats so far */}
            <div className="flex gap-3 text-[10px]">
              <span className="text-glow-cyan">{reextractStatus.success} done</span>
              {reextractStatus.failed > 0 && <span className="text-red-400">{reextractStatus.failed} failed</span>}
            </div>
          </div>
        )}

        {/* Re-extract result */}
        {reextractStatus && !reextractStatus.running && reextractStatus.total > 0 && (
          <div className="mt-2 px-3 py-2 bg-surface/60 backdrop-blur-xl border border-glow-cyan/30 rounded-xl space-y-1">
            <span className="text-[11px] text-glow-cyan">
              Done: {reextractStatus.success}/{reextractStatus.total} extracted
              {reextractStatus.failed > 0 && `, ${reextractStatus.failed} failed`}
            </span>
            {reextractStatus.errors?.length > 0 && (
              <div className="text-[10px] text-red-400 max-h-20 overflow-y-auto">
                {reextractStatus.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Inline SVG icon for the logo
function KnowledgebaseIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="cyan" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f5d4" />
          <stop offset="100%" stopColor="#00d4aa" />
        </linearGradient>
        <linearGradient id="cyanMuted" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f5d4" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#00d4aa" stopOpacity="0.4" />
        </linearGradient>
      </defs>

      {/* Connection lines */}
      <g
        stroke="#00f5d4"
        strokeWidth="2.5"
        strokeOpacity="0.25"
        strokeLinecap="round"
      >
        <line x1="256" y1="256" x2="152" y2="152" />
        <line x1="256" y1="256" x2="360" y2="152" />
        <line x1="256" y1="256" x2="152" y2="360" />
        <line x1="256" y1="256" x2="360" y2="360" />
        <line x1="256" y1="256" x2="256" y2="108" />
        <line x1="256" y1="256" x2="256" y2="404" />
        <line x1="256" y1="256" x2="108" y2="256" />
        <line x1="256" y1="256" x2="404" y2="256" />
        <line x1="152" y1="152" x2="256" y2="108" />
        <line x1="360" y1="152" x2="256" y2="108" />
        <line x1="152" y1="152" x2="108" y2="256" />
        <line x1="360" y1="152" x2="404" y2="256" />
        <line x1="152" y1="360" x2="108" y2="256" />
        <line x1="360" y1="360" x2="404" y2="256" />
        <line x1="152" y1="360" x2="256" y2="404" />
        <line x1="360" y1="360" x2="256" y2="404" />
      </g>

      {/* Outer nodes */}
      <circle cx="256" cy="108" r="16" fill="url(#cyanMuted)" />
      <circle cx="256" cy="404" r="16" fill="url(#cyanMuted)" />
      <circle cx="108" cy="256" r="16" fill="url(#cyanMuted)" />
      <circle cx="404" cy="256" r="16" fill="url(#cyanMuted)" />

      {/* Mid nodes */}
      <circle cx="152" cy="152" r="22" fill="url(#cyanMuted)" />
      <circle cx="360" cy="152" r="22" fill="url(#cyanMuted)" />
      <circle cx="152" cy="360" r="22" fill="url(#cyanMuted)" />
      <circle cx="360" cy="360" r="22" fill="url(#cyanMuted)" />

      {/* Center node */}
      <circle cx="256" cy="256" r="48" fill="url(#cyan)" />
    </svg>
  );
}
