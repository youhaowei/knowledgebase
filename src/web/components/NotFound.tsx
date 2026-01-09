/**
 * NotFound - Stylish 404 page with disconnected node visual
 *
 * Represents being "lost in the knowledge graph" - a node
 * that has no connections. Matches the neon cyber aesthetic.
 */

import { Link } from "@tanstack/react-router";
import { Home, Search, ArrowLeft } from "lucide-react";

export function NotFound() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center relative z-10 px-6">
      {/* Floating disconnected node visualization */}
      <div className="relative mb-8">
        {/* Outer glow ring */}
        <div className="absolute inset-0 -m-8 rounded-full bg-glow-cyan/5 blur-2xl animate-pulse" />

        {/* Disconnected edges - broken connections */}
        <svg
          className="absolute -inset-16 w-[calc(100%+8rem)] h-[calc(100%+8rem)]"
          viewBox="0 0 200 200"
          fill="none"
        >
          {/* Broken connection lines fading out */}
          <line
            x1="100" y1="100" x2="30" y2="40"
            stroke="url(#fadeGradient)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="4 4"
            className="opacity-40"
          />
          <line
            x1="100" y1="100" x2="170" y2="35"
            stroke="url(#fadeGradient)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="4 4"
            className="opacity-30"
          />
          <line
            x1="100" y1="100" x2="25" y2="140"
            stroke="url(#fadeGradient)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="4 4"
            className="opacity-35"
          />
          <line
            x1="100" y1="100" x2="175" y2="160"
            stroke="url(#fadeGradient)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="4 4"
            className="opacity-25"
          />
          <line
            x1="100" y1="100" x2="100" y2="15"
            stroke="url(#fadeGradient)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="4 4"
            className="opacity-30"
          />

          {/* Ghost nodes at end of broken connections */}
          <circle cx="30" cy="40" r="6" fill="currentColor" className="text-text-tertiary/20" />
          <circle cx="170" cy="35" r="6" fill="currentColor" className="text-text-tertiary/15" />
          <circle cx="25" cy="140" r="6" fill="currentColor" className="text-text-tertiary/20" />
          <circle cx="175" cy="160" r="6" fill="currentColor" className="text-text-tertiary/10" />
          <circle cx="100" cy="15" r="6" fill="currentColor" className="text-text-tertiary/15" />

          <defs>
            <linearGradient id="fadeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00f5d4" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#00f5d4" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* Main node - isolated */}
        <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-surface/80 to-deep/90 backdrop-blur-xl border-2 border-glow-cyan/30 flex items-center justify-center shadow-[0_0_60px_rgba(0,245,212,0.15),0_25px_50px_-12px_rgba(0,0,0,0.5)]">
          {/* Inner glow */}
          <div className="absolute inset-4 rounded-full bg-glow-cyan/5" />

          {/* 404 text */}
          <span className="relative font-display text-4xl font-bold bg-gradient-to-br from-glow-cyan to-glow-cyan/60 bg-clip-text text-transparent">
            404
          </span>
        </div>
      </div>

      {/* Error message card */}
      <div className="text-center w-full max-w-md">
        <h1 className="font-display text-2xl font-semibold text-text-primary mb-3">
          Node Not Found
        </h1>
        <p className="text-text-secondary text-sm leading-relaxed mb-8">
          This page doesn't exist in the knowledge graph.
          The connection you're looking for may have been removed,
          renamed, or never existed.
        </p>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/"
            className="group flex items-center gap-2 px-6 py-3 bg-gradient-to-br from-glow-cyan to-[#00c4a7] rounded-xl text-sm font-semibold text-void shadow-[0_8px_32px_rgba(0,245,212,0.3)] hover:shadow-[0_12px_40px_rgba(0,245,212,0.4)] transition-all duration-300 hover:-translate-y-0.5"
          >
            <Home className="w-4 h-4" />
            Return Home
          </Link>

          <button
            onClick={() => window.history.back()}
            className="group flex items-center gap-2 px-6 py-3 bg-surface/60 backdrop-blur-xl border border-border rounded-xl text-sm font-medium text-text-secondary hover:border-border-glow hover:text-text-primary transition-all duration-300 hover:-translate-y-0.5"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Go Back
          </button>
        </div>
      </div>

      {/* Subtle hint */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <div className="flex items-center gap-2 px-4 py-2 bg-surface/40 backdrop-blur-xl border border-border rounded-full">
          <Search className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs text-text-tertiary">
            Try searching for what you need
          </span>
          <kbd className="px-1.5 py-0.5 bg-elevated/80 rounded text-[9px] font-mono text-text-tertiary border border-border">
            ⌘K
          </kbd>
        </div>
      </div>
    </div>
  );
}
