/**
 * Sidebar Component - Tailwind CSS Version
 */

import { useState } from "react";
import { Menu, X, Plus, Search, Brain } from "lucide-react";

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

import type { Stats, Memory } from "./types";

interface SidebarProps {
  stats: Stats | null;
  memories: Memory[];
  onAddMemory: (text: string, name?: string) => Promise<void>;
}

export function Sidebar({ stats, memories, onAddMemory }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [activePanel, setActivePanel] = useState<"memories" | "add" | "search">(
    "memories",
  );
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    setLoading(true);
    try {
      await onAddMemory(text, name || undefined);
      setText("");
      setName("");
      setMessage({ type: "success", text: "Memory queued for processing" });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({
        type: "error",
        text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        className={`fixed top-6 z-50 w-11 h-11 rounded-xl bg-surface border border-border text-text-secondary cursor-pointer flex items-center justify-center transition-all duration-300 shadow-lg hover:bg-elevated hover:text-glow-cyan hover:border-border-glow ${
          isOpen ? "right-[436px]" : "right-6"
        }`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
      >
        {isOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <aside
        className={`w-[420px] h-screen bg-gradient-to-b from-deep/95 to-abyss/98 backdrop-blur-[40px] border-l border-border flex flex-col relative overflow-hidden transition-transform duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          !isOpen ? "translate-x-full" : ""
        }`}
      >
        {/* Glow edge */}
        <div className="absolute top-0 left-0 w-px h-full bg-gradient-to-b from-transparent via-glow-cyan to-transparent opacity-30" />

        {/* Header */}
        <div className="px-7 pt-6 pb-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-surface border border-border flex items-center justify-center">
              <KnowledgebaseIcon size={32} />
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight text-text-primary">
                Knowledgebase
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-glow-cyan shadow-[0_0_8px_var(--color-glow-cyan)]" />
                <span className="text-[11px] font-medium tracking-wide uppercase text-text-tertiary">
                  Online
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3 px-7 py-5 border-b border-border">
            {[
              { value: stats.memories, label: "Memories" },
              { value: stats.entities, label: "Entities" },
              { value: stats.edges, label: "Edges" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-surface border border-border rounded-xl p-4 text-center relative overflow-hidden transition-all duration-300 hover:border-border-glow hover:-translate-y-0.5 group"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-glow-cyan-dim to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="font-display text-[1.75rem] font-semibold text-text-primary leading-none relative z-10">
                  {stat.value}
                </div>
                <div className="text-xs font-medium tracking-wide uppercase text-text-tertiary mt-2 relative z-10">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex px-7 border-b border-border">
          {(
            [
              { id: "memories" as const, icon: Brain, label: "Memories" },
              { id: "add" as const, icon: Plus, label: "Add" },
              { id: "search" as const, icon: Search, label: "Search" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              className={`flex-1 py-4 px-3 bg-transparent border-none font-sans text-sm font-medium cursor-pointer flex items-center justify-center gap-2 relative transition-colors duration-300 ${
                activePanel === tab.id
                  ? "text-glow-cyan"
                  : "text-text-tertiary hover:text-text-secondary"
              }`}
              onClick={() => setActivePanel(tab.id)}
            >
              <tab.icon
                size={16}
                className={
                  activePanel === tab.id ? "opacity-100" : "opacity-70"
                }
              />
              {tab.label}
              {activePanel === tab.id && (
                <span className="absolute bottom-[-1px] left-[20%] right-[20%] h-0.5 bg-glow-cyan rounded-t shadow-[0_0_12px_var(--color-glow-cyan)]" />
              )}
            </button>
          ))}
        </div>

        {/* Panel Content */}
        <div className="flex-1 overflow-y-auto px-7 py-6">
          {activePanel === "memories" && <MemoriesPanel memories={memories} />}
          {activePanel === "add" && (
            <AddPanel
              text={text}
              name={name}
              loading={loading}
              message={message}
              onTextChange={setText}
              onNameChange={setName}
              onSubmit={handleAdd}
            />
          )}
          {activePanel === "search" && <SearchPanel />}
        </div>
      </aside>
    </>
  );
}

// Sub-components

function MemoriesPanel({ memories }: { memories: Memory[] }) {
  return (
    <div>
      <h3 className="text-xs font-medium tracking-wide uppercase text-text-tertiary mb-4">
        Memories ({memories.length})
      </h3>
      {memories.length === 0 ? (
        <div className="text-center py-10 text-text-tertiary">
          <Brain className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="font-display italic text-base">No memories yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {memories.map((m, index) => (
            <div
              key={m.id}
              className="bg-surface border border-border rounded-xl px-[18px] py-4 cursor-pointer relative overflow-hidden transition-all duration-300 hover:border-border-glow hover:-translate-x-1 hover:shadow-[4px_0_24px_var(--color-glow-cyan-dim)] group animate-fadeIn"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-glow-cyan/5 to-glow-violet/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <p className="text-[0.9rem] font-medium text-text-primary leading-snug relative z-10 line-clamp-2">
                {m.name || "Untitled"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface AddPanelProps {
  text: string;
  name: string;
  loading: boolean;
  message: { type: "success" | "error"; text: string } | null;
  onTextChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

function AddPanel({
  text,
  name,
  loading,
  message,
  onTextChange,
  onNameChange,
  onSubmit,
}: AddPanelProps) {
  return (
    <form onSubmit={onSubmit}>
      <div className="mb-5">
        <label className="block text-xs font-medium tracking-wide uppercase text-text-tertiary mb-2.5">
          Memory Text
        </label>
        <textarea
          className="w-full bg-surface border border-border rounded-lg px-4 py-3.5 font-sans text-[0.9rem] text-text-primary placeholder:text-text-tertiary outline-none transition-all duration-300 focus:border-glow-cyan focus:shadow-[0_0_0_3px_var(--color-glow-cyan-dim),0_0_20px_var(--color-glow-cyan-dim)] resize-none min-h-[120px] leading-relaxed"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Enter text to remember..."
          rows={4}
          required
        />
      </div>
      <div className="mb-5">
        <label className="block text-xs font-medium tracking-wide uppercase text-text-tertiary mb-2.5">
          Name (optional)
        </label>
        <input
          type="text"
          className="w-full bg-surface border border-border rounded-lg px-4 py-3.5 font-sans text-[0.9rem] text-text-primary placeholder:text-text-tertiary outline-none transition-all duration-300 focus:border-glow-cyan focus:shadow-[0_0_0_3px_var(--color-glow-cyan-dim),0_0_20px_var(--color-glow-cyan-dim)]"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Optional name for this memory"
        />
      </div>
      <button
        type="submit"
        className="w-full py-3.5 px-6 bg-gradient-to-br from-glow-cyan to-[#00c4a7] border-none rounded-lg font-sans text-sm font-semibold text-void cursor-pointer relative overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,245,212,0.3),0_0_40px_var(--color-glow-cyan-soft)] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
        disabled={loading || !text.trim()}
      >
        {loading ? "Processing..." : "Add Memory"}
      </button>
      {message && (
        <div
          className={`p-3.5 rounded-lg text-[0.85rem] mt-4 ${
            message.type === "success"
              ? "bg-glow-cyan/10 border border-glow-cyan/30 text-glow-cyan"
              : "bg-glow-magenta/10 border border-glow-magenta/30 text-glow-magenta"
          }`}
        >
          {message.text}
        </div>
      )}
    </form>
  );
}

function SearchPanel() {
  return (
    <div>
      <div className="mb-5">
        <label className="block text-xs font-medium tracking-wide uppercase text-text-tertiary mb-2.5">
          Search Query
        </label>
        <input
          type="text"
          className="w-full bg-surface border border-border rounded-lg px-4 py-3.5 font-sans text-[0.9rem] text-text-primary placeholder:text-text-tertiary outline-none transition-all duration-300 focus:border-glow-cyan focus:shadow-[0_0_0_3px_var(--color-glow-cyan-dim),0_0_20px_var(--color-glow-cyan-dim)]"
          placeholder="Search memories..."
        />
      </div>
      <button className="w-full py-3.5 px-6 bg-gradient-to-br from-glow-cyan to-[#00c4a7] border-none rounded-lg font-sans text-sm font-semibold text-void cursor-pointer flex items-center justify-center gap-2 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,245,212,0.3)]">
        <Search size={16} />
        Search
      </button>
      <div className="text-center py-15">
        <p className="text-xs font-medium tracking-wide text-text-tertiary">
          Search functionality coming soon...
        </p>
      </div>
    </div>
  );
}
