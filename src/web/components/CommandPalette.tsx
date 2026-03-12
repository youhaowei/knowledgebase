/**
 * CommandPalette - Spotlight-style unified search & add interface
 *
 * Inspired by Apple Spotlight, Raycast, and Linear's command palette.
 * Accessible via Cmd+K or clicking the floating trigger.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  Plus,
  Sparkles,
  Brain,
  ArrowRight,
  X,
  Command,
  FileText,
  Tag,
} from "lucide-react";
import { searchMemories, addMemory, askLLM, listNamespaces } from "@/server/functions";
import { DetailPanel } from "./DetailPanel";

// Result types for the unified search
type ResultType = "memory" | "edge" | "entity" | "llm";

interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  subtitle?: string;
  meta?: string;
  /** Original name from the data (may be empty for unnamed memories) */
  name?: string;
  /** Structured edge data (avoids reconstructing from display strings) */
  edgeData?: {
    sourceEntity: string;
    targetEntity: string;
    relationType: string;
    fact: string;
    sentiment: number;
    confidence: number;
  };
}

function sentimentLabel(s: number) {
  if (s > 0.3) return "positive";
  if (s < -0.3) return "negative";
  return "neutral";
}

function mapSearchResults(result: { memories: Array<{ id: string; name?: string; summary?: string; createdAt?: string | Date }>; edges: Array<{ id: string; fact: string; sourceEntity: string; relationType: string; targetEntity: string; sentiment: number; confidence: number }>; entities: Array<{ name: string; type?: string; description?: string }> }): SearchResult[] {
  const allResults: SearchResult[] = [];

  for (const m of result.memories) {
    allResults.push({
      id: m.id,
      type: "memory",
      title: m.name || "Untitled Memory",
      name: m.name ?? undefined,
      subtitle: m.summary ?? undefined,
      meta: m.createdAt ? new Date(m.createdAt).toLocaleDateString() : undefined,
    });
  }

  for (const e of result.edges) {
    allResults.push({
      id: e.id,
      type: "edge",
      title: e.fact,
      subtitle: `${e.sourceEntity} → ${e.relationType} → ${e.targetEntity}`,
      meta: sentimentLabel(e.sentiment),
      edgeData: {
        sourceEntity: e.sourceEntity,
        targetEntity: e.targetEntity,
        relationType: e.relationType,
        fact: e.fact,
        sentiment: e.sentiment,
        confidence: e.confidence,
      },
    });
  }

  for (const e of result.entities) {
    allResults.push({
      id: e.name,
      type: "entity",
      title: e.name,
      subtitle: e.description ?? undefined,
      meta: e.type ?? undefined,
    });
  }

  return allResults;
}

type PaletteMode = "search" | "add";

interface CommandPaletteProps {
  onRefreshData: () => void;
}

export function CommandPalette({ onRefreshData }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<PaletteMode>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [addText, setAddText] = useState("");
  const [addName, setAddName] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [activeNamespace, setActiveNamespace] = useState<string | undefined>(undefined);

  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Open/close handlers
  const openPalette = useCallback((initialMode: PaletteMode = "search") => {
    setIsOpen(true);
    setMode(initialMode);
    setQuery("");
    setResults([]);
    setAddText("");
    setAddName("");
    setMessage(null);
    setSelectedIndex(0);
    setSelectedResult(null);
    setActiveNamespace(undefined);
  }, []);

  const closePalette = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setResults([]);
    setAddText("");
    setAddName("");
    setMessage(null);
    setSelectedResult(null);
  }, []);

  // Keyboard shortcut: Cmd+K to open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K or Ctrl+K to open search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          closePalette();
        } else {
          openPalette("search");
        }
      }
      // Escape to close (or go back from detail panel)
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        if (selectedResult) {
          setSelectedResult(null);
        } else {
          closePalette();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedResult, openPalette, closePalette]);

  // Fetch namespaces when palette opens
  useEffect(() => {
    if (isOpen) {
      listNamespaces().then(setNamespaces).catch(() => {});
    }
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (mode === "search" && inputRef.current) {
          inputRef.current.focus();
        } else if (mode === "add" && textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 50);
    }
  }, [isOpen, mode]);

  // Search - returns memories, facts, and entities; falls back to LLM if empty
  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    setResults([]);
    setSelectedIndex(0);

    try {
      const result = await searchMemories({
        data: { query: searchQuery, limit: 10, namespace: activeNamespace },
      });

      const allResults = mapSearchResults(result);

      // If no results, ask LLM
      if (allResults.length === 0) {
        try {
          const llmResult = await askLLM({
            data: { question: searchQuery },
          });
          allResults.push({
            id: "llm-answer",
            type: "llm",
            title: "AI Answer",
            subtitle: llmResult.answer,
            meta: llmResult.hasContext
              ? `Based on ${llmResult.edgesUsed} edges, ${llmResult.memoriesUsed} memories`
              : "No direct matches found",
          });
        } catch (llmError) {
          console.error("LLM fallback error:", llmError);
        }
      }

      setResults(allResults);
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [activeNamespace]);

  // Debounced search
  useEffect(() => {
    if (mode !== "search") return;

    const timer = setTimeout(() => {
      handleSearch(query);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, mode, handleSearch]);

  // Add memory handler
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addText.trim()) return;

    setIsLoading(true);
    try {
      await addMemory({ data: { text: addText, name: addName || undefined, namespace: activeNamespace ?? "default" } });
      setMessage({ type: "success", text: "Memory queued for processing" });
      setAddText("");
      setAddName("");
      // Refresh data after a delay
      setTimeout(() => {
        onRefreshData();
        closePalette();
      }, 1500);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to add memory",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mode === "search" && results.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        setSelectedResult(results[selectedIndex]!);
      }
    }
  };

  return (
    <>
      {/* Floating Trigger Bar - Always visible at bottom */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3">
        {/* Search trigger */}
        <button
          onClick={() => openPalette("search")}
          className="group flex items-center gap-3 px-5 py-3 bg-surface/80 backdrop-blur-xl border border-border rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.05)_inset] hover:border-border-glow hover:shadow-[0_8px_32px_rgba(0,245,212,0.15),0_0_40px_rgba(0,245,212,0.1)] transition-all duration-300 hover:-translate-y-0.5"
        >
          <Search className="w-4 h-4 text-text-tertiary group-hover:text-glow-cyan transition-colors" />
          <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">
            Search memories...
          </span>
          <kbd className="hidden sm:flex items-center gap-1 px-2 py-1 bg-elevated/80 rounded-md text-[10px] font-mono text-text-tertiary border border-border">
            <Command className="w-2.5 h-2.5" />K
          </kbd>
        </button>

        {/* Add button */}
        <button
          onClick={() => openPalette("add")}
          className="group w-12 h-12 bg-gradient-to-br from-glow-cyan to-[#00c4a7] rounded-2xl flex items-center justify-center shadow-[0_8px_32px_rgba(0,245,212,0.3),0_0_0_1px_rgba(255,255,255,0.1)_inset] hover:shadow-[0_12px_40px_rgba(0,245,212,0.4),0_0_60px_rgba(0,245,212,0.2)] transition-all duration-300 hover:-translate-y-1 hover:scale-105"
          title="Add memory"
        >
          <Plus className="w-5 h-5 text-void" strokeWidth={2.5} />
        </button>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-void/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={closePalette}
        />
      )}

      {/* Command Palette Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 pointer-events-none">
          <div
            className="w-[600px] min-w-[400px] max-w-[calc(100vw-2rem)] bg-gradient-to-b from-deep/98 to-abyss/99 backdrop-blur-2xl border border-border rounded-2xl shadow-[0_25px_80px_-20px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.05)_inset,0_0_80px_rgba(0,245,212,0.08)] overflow-hidden pointer-events-auto animate-in zoom-in-95 slide-in-from-top-4 duration-200"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
          >
            {/* Glow effect */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2/3 h-px bg-gradient-to-r from-transparent via-glow-cyan/50 to-transparent" />

            {/* Mode tabs */}
            <div className="flex border-b border-border">
              <button
                className={`flex-1 flex items-center justify-center gap-2 py-4 px-6 text-sm font-medium transition-all duration-200 ${
                  mode === "search"
                    ? "text-glow-cyan bg-glow-cyan-dim/30"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-elevated/30"
                }`}
                onClick={() => setMode("search")}
              >
                <Search className="w-4 h-4" />
                Search
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-2 py-4 px-6 text-sm font-medium transition-all duration-200 ${
                  mode === "add"
                    ? "text-glow-cyan bg-glow-cyan-dim/30"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-elevated/30"
                }`}
                onClick={() => setMode("add")}
              >
                <Plus className="w-4 h-4" />
                Add Memory
              </button>
              <button
                className="px-4 text-text-tertiary hover:text-text-secondary transition-colors"
                onClick={closePalette}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Namespace filter chips */}
            {mode === "search" && !selectedResult && namespaces.length > 1 && (
              <div className="flex items-center gap-2 px-5 py-2 border-b border-border overflow-x-auto">
                <button
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    activeNamespace === undefined
                      ? "bg-glow-cyan-dim text-glow-cyan"
                      : "bg-surface/50 text-text-tertiary hover:text-text-secondary"
                  }`}
                  onClick={() => setActiveNamespace(undefined)}
                >
                  All
                </button>
                {namespaces.map((ns) => (
                  <button
                    key={ns}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      activeNamespace === ns
                        ? "bg-glow-cyan-dim text-glow-cyan"
                        : "bg-surface/50 text-text-tertiary hover:text-text-secondary"
                    }`}
                    onClick={() => setActiveNamespace(ns)}
                  >
                    {ns}
                  </button>
                ))}
              </div>
            )}

            {/* Detail Panel (replaces search when a result is selected) */}
            {mode === "search" && selectedResult && (
              <DetailPanel
                result={selectedResult}
                onBack={() => setSelectedResult(null)}
              />
            )}

            {/* Search Mode */}
            {mode === "search" && !selectedResult && (
              <div>
                {/* Search input */}
                <div className="relative">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your memories..."
                    className="w-full bg-transparent border-none py-5 pl-14 pr-5 text-lg text-text-primary placeholder:text-text-tertiary outline-none font-sans"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {isLoading && (
                    <div className="absolute right-5 top-1/2 -translate-y-1/2">
                      <Sparkles className="w-5 h-5 text-glow-cyan animate-pulse" />
                    </div>
                  )}
                </div>

                {/* Results */}
                <div className="border-t border-border max-h-[50vh] overflow-y-auto">
                  {results.length === 0 && query && !isLoading && (
                    <div className="py-12 text-center">
                      <Brain className="w-12 h-12 mx-auto mb-4 text-text-tertiary opacity-30" />
                      <p className="text-text-tertiary text-sm">
                        No memories found for "{query}"
                      </p>
                    </div>
                  )}

                  {results.length === 0 && !query && (
                    <div className="py-12 text-center">
                      <p className="text-text-tertiary text-sm">
                        Start typing to search...
                      </p>
                      <p className="text-text-tertiary/50 text-xs mt-2">
                        Use arrow keys to navigate, Enter to select
                      </p>
                    </div>
                  )}

                  {results.map((result, index) => {
                    // Icon and color based on result type
                    const iconConfigs: Record<
                      ResultType,
                      {
                        Icon: typeof Brain;
                        color: string;
                        bg: string;
                      }
                    > = {
                      memory: {
                        Icon: Brain,
                        color: "text-glow-cyan",
                        bg: "bg-glow-cyan-dim",
                      },
                      edge: {
                        Icon: FileText,
                        color: "text-glow-magenta",
                        bg: "bg-glow-magenta/20",
                      },
                      entity: {
                        Icon: Tag,
                        color: "text-amber-400",
                        bg: "bg-amber-400/20",
                      },
                      llm: {
                        Icon: Sparkles,
                        color: "text-purple-400",
                        bg: "bg-purple-400/20",
                      },
                    };
                    const iconConfig = iconConfigs[result.type];

                    return (
                      <div
                        key={`${result.type}-${result.id}`}
                        className={`flex items-start gap-4 px-5 py-4 cursor-pointer transition-all duration-150 ${
                          index === selectedIndex
                            ? "bg-glow-cyan-dim/40 border-l-2 border-l-glow-cyan"
                            : "hover:bg-elevated/50 border-l-2 border-l-transparent"
                        }`}
                        onClick={() => {
                          setSelectedIndex(index);
                          setSelectedResult(result);
                        }}
                        style={{ animationDelay: `${index * 50}ms` }}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg ${iconConfig.bg} border border-border flex items-center justify-center flex-shrink-0 mt-0.5`}
                        >
                          <iconConfig.Icon
                            className={`w-4 h-4 ${iconConfig.color}`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium text-text-primary truncate">
                              {result.title}
                            </h4>
                            <span
                              className={`text-[10px] font-semibold tracking-wide uppercase px-1.5 py-0.5 rounded ${iconConfig.bg} ${iconConfig.color}`}
                            >
                              {result.type}
                            </span>
                          </div>
                          {result.subtitle && (
                            <p className="text-xs text-text-tertiary mt-1 line-clamp-2">
                              {result.subtitle}
                            </p>
                          )}
                          {result.meta && (
                            <span className="inline-block mt-2 px-2 py-0.5 bg-surface rounded text-[10px] font-medium text-text-tertiary">
                              {result.meta}
                            </span>
                          )}
                        </div>
                        <ArrowRight
                          className={`w-4 h-4 text-text-tertiary transition-all ${
                            index === selectedIndex
                              ? "opacity-100 translate-x-0"
                              : "opacity-0 -translate-x-2"
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add Mode */}
            {mode === "add" && (
              <form onSubmit={handleAdd} className="p-5">
                <div className="mb-4">
                  <label className="block text-xs font-medium tracking-wide text-text-tertiary uppercase mb-2">
                    Memory Text
                  </label>
                  <textarea
                    ref={textareaRef}
                    value={addText}
                    onChange={(e) => setAddText(e.target.value)}
                    placeholder="What would you like to remember?"
                    className="w-full bg-surface/50 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary outline-none resize-none min-h-[120px] transition-all duration-200 focus:border-glow-cyan focus:shadow-[0_0_0_3px_rgba(0,245,212,0.1)]"
                    required
                  />
                </div>
                <div className="mb-5">
                  <label className="block text-xs font-medium tracking-wide text-text-tertiary uppercase mb-2">
                    Name (optional)
                  </label>
                  <input
                    type="text"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="Give this memory a name"
                    className="w-full bg-surface/50 border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary outline-none transition-all duration-200 focus:border-glow-cyan focus:shadow-[0_0_0_3px_rgba(0,245,212,0.1)]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading || !addText.trim()}
                  className="w-full py-3.5 bg-gradient-to-r from-glow-cyan to-[#00c4a7] rounded-xl text-sm font-semibold text-void flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-[0_8px_24px_rgba(0,245,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                >
                  {isLoading ? (
                    <>
                      <Sparkles className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Add Memory
                    </>
                  )}
                </button>

                {message && (
                  <div
                    className={`mt-4 px-4 py-3 rounded-xl text-sm ${
                      message.type === "success"
                        ? "bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan"
                        : "bg-glow-magenta/10 border border-glow-magenta/30 text-glow-magenta"
                    }`}
                  >
                    {message.text}
                  </div>
                )}
              </form>
            )}

            {/* Footer hint */}
            <div className="px-5 py-3 border-t border-border bg-surface/30 flex items-center justify-between text-[10px] text-text-tertiary">
              <div className="flex items-center gap-4">
                {selectedResult ? (
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-elevated rounded text-[9px] font-mono">
                      esc
                    </kbd>
                    Back
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-elevated rounded text-[9px] font-mono">
                        ↑↓
                      </kbd>
                      Navigate
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-elevated rounded text-[9px] font-mono">
                        ↵
                      </kbd>
                      Select
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1.5 py-0.5 bg-elevated rounded text-[9px] font-mono">
                        esc
                      </kbd>
                      Close
                    </span>
                  </>
                )}
              </div>
              <span className="font-medium tracking-wide uppercase opacity-60">
                Knowledgebase
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
