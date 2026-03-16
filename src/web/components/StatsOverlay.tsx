/**
 * StatsOverlay - Minimal floating stats display with namespace selector
 *
 * Shows key metrics in a subtle overlay in the top-left corner.
 * Includes a namespace dropdown to filter the graph and stats.
 */

import { Brain, Link2, Users, ChevronDown } from "lucide-react";
import type { Stats } from "./types";

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
        </div>
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
