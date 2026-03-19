/**
 * Command Palette — Cmd+K search across all KB types
 *
 * Debounced search across memories, entities, and edges.
 * Selecting a result opens it in the right panel via onSelect.
 * Falls back to LLM answer if no direct matches found.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Brain, Users, Link2, Sparkles } from "lucide-react";
import { searchMemories, askLLM } from "@/server/functions";
import type { SelectedItem } from "@/routes/index";

interface CommandPaletteProps {
  onRefreshData: () => void;
  onSelect?: (item: SelectedItem) => void;
  onClose?: () => void;
}

interface SearchResult {
  id: string;
  type: "memory" | "entity" | "edge" | "llm";
  title: string;
  subtitle?: string;
  name?: string;
  edgeId?: string;
}

export function CommandPalette({ onSelect, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const data = await searchMemories({ data: { query, limit: 15 } });
        const mapped: SearchResult[] = [];

        for (const m of data.memories) {
          mapped.push({
            id: `mem-${m.id}`,
            type: "memory",
            title: m.name,
            subtitle: m.summary,
            name: m.name,
          });
        }

        for (const e of data.entities) {
          mapped.push({
            id: `ent-${e.name}`,
            type: "entity",
            title: e.name,
            subtitle: e.description ?? `${e.type} entity`,
            name: e.name,
          });
        }

        for (const e of data.edges) {
          mapped.push({
            id: `edge-${e.id}`,
            type: "edge",
            title: `${e.sourceEntity} → ${e.relationType} → ${e.targetEntity}`,
            subtitle: e.fact,
            name: e.fact,
            edgeId: e.id,
          });
        }

        if (mapped.length === 0) {
          try {
            const llm = await askLLM({ data: { question: query } });
            mapped.push({
              id: "llm-answer",
              type: "llm",
              title: "AI Answer",
              subtitle: llm.answer,
            });
          } catch { /* ignore LLM errors */ }
        }

        setResults(mapped);
        setSelectedIndex(0);
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback((result: SearchResult) => {
    if (result.type === "llm") return;
    if (onSelect) {
      onSelect({
        type: result.type as SelectedItem["type"],
        name: result.name ?? result.title,
        edgeId: result.edgeId,
      });
    }
    onClose?.();
  }, [onSelect, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case "memory": return <Brain className="h-3.5 w-3.5 text-glow-cyan" />;
      case "entity": return <Users className="h-3.5 w-3.5 text-glow-violet" />;
      case "edge": return <Link2 className="h-3.5 w-3.5 text-glow-magenta" />;
      case "llm": return <Sparkles className="h-3.5 w-3.5 text-glow-amber" />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Palette */}
      <div className="relative w-full max-w-xl mx-4 rounded-xl bg-deep/98 border border-border shadow-2xl animate-in overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-text-secondary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search memories, entities, facts..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          {isLoading && (
            <div className="h-4 w-4 border-2 border-glow-cyan/30 border-t-glow-cyan rounded-full animate-spin" />
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="max-h-80 overflow-y-auto py-1">
            {results.map((result, i) => (
              <button
                key={result.id}
                onClick={() => handleSelect(result)}
                className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selectedIndex
                    ? "bg-glow-cyan-soft"
                    : "hover:bg-surface/60"
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {typeIcon(result.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-text-primary truncate">
                    {result.title}
                  </div>
                  {result.subtitle && (
                    <div className="text-[11px] text-text-secondary line-clamp-2 mt-0.5">
                      {result.subtitle}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-text-tertiary shrink-0 mt-0.5">
                  {result.type}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {query && !isLoading && results.length === 0 && (
          <div className="py-8 text-center text-xs text-text-secondary">
            No results for "{query}"
          </div>
        )}

        {/* Hint */}
        {!query && (
          <div className="py-6 text-center text-xs text-text-tertiary">
            Type to search across your knowledge graph
          </div>
        )}
      </div>
    </div>
  );
}
