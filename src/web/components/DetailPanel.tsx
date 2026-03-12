/**
 * DetailPanel - Type-specific detail view for search results
 *
 * Shows within the CommandPalette when a result is selected.
 * Three layouts: memory, edge/fact, entity.
 */

import {
  ArrowLeft,
  Brain,
  FileText,
  Tag,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  Link2,
} from "lucide-react";
import { useState, useEffect } from "react";
import { getMemory } from "@/server/functions";

interface DetailPanelProps {
  result: {
    id: string;
    type: "memory" | "edge" | "entity" | "llm";
    title: string;
    subtitle?: string;
    meta?: string;
    name?: string;
    edgeData?: {
      sourceEntity: string;
      targetEntity: string;
      relationType: string;
      fact: string;
      sentiment: number;
      confidence: number;
    };
  };
  onBack: () => void;
}

interface MemoryDetail {
  id: string;
  name: string;
  text: string;
  summary?: string;
  category?: string;
  createdAt?: string | Date;
}

interface EdgeDetail {
  id: string;
  sourceEntity: string;
  targetEntity: string;
  relationType: string;
  fact: string;
  sentiment: number;
  confidence: number;
  confidenceReason?: string;
  validAt?: string | Date;
  invalidAt?: string | Date;
  createdAt?: string | Date;
}

interface EntityDetail {
  name: string;
  type: string;
  description?: string;
  summary?: string;
}

interface DetailData {
  memory?: MemoryDetail;
  entity?: EntityDetail;
  edges: EdgeDetail[];
}

function SentimentBadge({ sentiment }: { sentiment: number }) {
  if (sentiment > 0.3) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-medium">
        <TrendingUp className="w-3 h-3" />
        positive ({sentiment.toFixed(1)})
      </span>
    );
  }
  if (sentiment < -0.3) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-glow-magenta/20 text-glow-magenta text-xs font-medium">
        <TrendingDown className="w-3 h-3" />
        negative ({sentiment.toFixed(1)})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface text-text-tertiary text-xs font-medium">
      <Minus className="w-3 h-3" />
      neutral
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    confidence > 0.7
      ? "text-glow-cyan bg-glow-cyan-dim"
      : confidence > 0.4
        ? "text-glow-amber bg-glow-amber/20"
        : "text-text-tertiary bg-surface";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <Shield className="w-3 h-3" />
      {pct}%
    </span>
  );
}

function EdgeCard({ edge }: { edge: EdgeDetail }) {
  return (
    <div className="px-4 py-3 bg-surface/50 rounded-xl border border-border">
      <div className="flex items-center gap-2 text-sm mb-2">
        <span className="text-glow-cyan font-medium">{edge.sourceEntity}</span>
        <span className="text-text-tertiary">→</span>
        <span className="px-1.5 py-0.5 bg-glow-violet/20 text-glow-violet rounded text-xs font-mono">
          {edge.relationType}
        </span>
        <span className="text-text-tertiary">→</span>
        <span className="text-glow-cyan font-medium">{edge.targetEntity}</span>
      </div>
      <p className="text-xs text-text-secondary mb-2">{edge.fact}</p>
      <div className="flex items-center gap-2">
        <SentimentBadge sentiment={edge.sentiment} />
        <ConfidenceBadge confidence={edge.confidence} />
      </div>
    </div>
  );
}

function MemoryView({ memory, edges }: { memory: MemoryDetail; edges: EdgeDetail[] }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{memory.name || "Untitled Memory"}</h3>
        <div className="flex items-center gap-3 mt-2">
          {memory.category && (
            <span className="px-2 py-0.5 bg-glow-violet/20 text-glow-violet rounded text-xs font-medium">
              {memory.category}
            </span>
          )}
          {memory.createdAt && (
            <span className="flex items-center gap-1 text-xs text-text-tertiary">
              <Clock className="w-3 h-3" />
              {new Date(memory.createdAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      {memory.summary && (
        <div className="px-4 py-3 bg-glow-cyan-dim/30 rounded-xl border border-glow-cyan/20">
          <p className="text-sm text-text-secondary">{memory.summary}</p>
        </div>
      )}

      {/* Full text */}
      <div>
        <h4 className="text-xs font-medium tracking-wide text-text-tertiary uppercase mb-2">Source Text</h4>
        <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{memory.text}</p>
      </div>

      {/* Extracted edges */}
      {edges.length > 0 && (
        <div>
          <h4 className="text-xs font-medium tracking-wide text-text-tertiary uppercase mb-2">
            Extracted Facts ({edges.length})
          </h4>
          <div className="space-y-2">
            {edges.map((edge) => (
              <EdgeCard key={edge.id} edge={edge} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EdgeView({ edge }: { edge: EdgeDetail }) {
  return (
    <div className="space-y-4">
      {/* Relationship */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-lg font-semibold text-glow-cyan">{edge.sourceEntity}</span>
        <span className="px-2 py-1 bg-glow-violet/20 text-glow-violet rounded-lg text-sm font-mono">
          {edge.relationType}
        </span>
        <span className="text-lg font-semibold text-glow-cyan">{edge.targetEntity}</span>
      </div>

      {/* Fact */}
      <div className="px-4 py-3 bg-surface/50 rounded-xl border border-border">
        <p className="text-sm text-text-primary">{edge.fact}</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="px-4 py-3 bg-surface/30 rounded-xl border border-border">
          <h4 className="text-xs font-medium tracking-wide text-text-tertiary uppercase mb-1">Sentiment</h4>
          <SentimentBadge sentiment={edge.sentiment} />
        </div>
        <div className="px-4 py-3 bg-surface/30 rounded-xl border border-border">
          <h4 className="text-xs font-medium tracking-wide text-text-tertiary uppercase mb-1">Confidence</h4>
          <ConfidenceBadge confidence={edge.confidence} />
        </div>
      </div>

      {/* Metadata */}
      {(edge.validAt || edge.createdAt) && (
        <div className="flex items-center gap-4 text-xs text-text-tertiary">
          {edge.validAt && <span>Valid: {new Date(edge.validAt).toLocaleDateString()}</span>}
          {edge.invalidAt && <span className="text-glow-magenta">Invalidated: {new Date(edge.invalidAt).toLocaleDateString()}</span>}
          {edge.createdAt && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {new Date(edge.createdAt).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function EntityView({ entity, edges }: { entity: EntityDetail; edges: EdgeDetail[] }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{entity.name}</h3>
        <span className="inline-block mt-1 px-2 py-0.5 bg-amber-400/20 text-amber-400 rounded text-xs font-medium">
          {entity.type}
        </span>
      </div>

      {/* Description */}
      {entity.description && (
        <p className="text-sm text-text-secondary">{entity.description}</p>
      )}

      {/* Summary */}
      {entity.summary && (
        <div className="px-4 py-3 bg-glow-cyan-dim/30 rounded-xl border border-glow-cyan/20">
          <p className="text-sm text-text-secondary">{entity.summary}</p>
        </div>
      )}

      {/* Connected edges */}
      {edges.length > 0 && (
        <div>
          <h4 className="text-xs font-medium tracking-wide text-text-tertiary uppercase mb-2 flex items-center gap-1">
            <Link2 className="w-3 h-3" />
            Connected Facts ({edges.length})
          </h4>
          <div className="space-y-2">
            {edges.map((edge) => (
              <EdgeCard key={edge.id} edge={edge} />
            ))}
          </div>
        </div>
      )}

      {edges.length === 0 && (
        <p className="text-sm text-text-tertiary">No connected facts found.</p>
      )}
    </div>
  );
}

export function DetailPanel({ result, onBack }: DetailPanelProps) {
  const [data, setData] = useState<DetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDetail() {
      // For LLM results, just show the answer inline — no server fetch needed
      if (result.type === "llm") {
        setData(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // For edges, the result.id is the edge ID — we don't have a getEdge endpoint,
        // so show the inline data we already have from search results
        if (result.type === "edge") {
          setData(null);
          setIsLoading(false);
          return;
        }

        // For memories, use the original name (not the display title which may be "Untitled Memory")
        // For entities, the id IS the name
        const name = result.type === "entity" ? result.id : (result.name || result.title);
        if (!name || name === "Untitled Memory") {
          setError("This memory has no name — detail lookup requires a named memory.");
          setIsLoading(false);
          return;
        }
        const detail = await getMemory({ data: { name } });

        if (!cancelled) {
          setData(detail);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load details");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchDetail();
    return () => { cancelled = true; };
  }, [result]);

  const typeIcons = {
    memory: { Icon: Brain, color: "text-glow-cyan" },
    edge: { Icon: FileText, color: "text-glow-magenta" },
    entity: { Icon: Tag, color: "text-amber-400" },
    llm: { Icon: Brain, color: "text-purple-400" },
  };
  const { Icon, color } = typeIcons[result.type];

  return (
    <div>
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-5 py-3 text-sm text-text-tertiary hover:text-text-primary transition-colors w-full border-b border-border"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to results
      </button>

      {/* Content */}
      <div className="px-5 py-4 max-h-[50vh] overflow-y-auto">
        {isLoading && (
          <div className="py-12 text-center">
            <div className="w-8 h-8 mx-auto mb-3 border-2 border-glow-cyan border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-text-tertiary">Loading details...</p>
          </div>
        )}

        {error && (
          <div className="py-8 text-center">
            <p className="text-sm text-glow-magenta">{error}</p>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Type badge */}
            <div className="flex items-center gap-2 mb-4">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className={`text-xs font-semibold tracking-wide uppercase ${color}`}>
                {result.type}
              </span>
            </div>

            {/* Memory detail */}
            {result.type === "memory" && data?.memory && (
              <MemoryView memory={data.memory} edges={data.edges} />
            )}

            {/* Edge detail — use structured data from search result */}
            {result.type === "edge" && result.edgeData && (
              <EdgeView
                edge={{
                  id: result.id,
                  ...result.edgeData,
                }}
              />
            )}

            {/* Entity detail */}
            {result.type === "entity" && data?.entity && (
              <EntityView entity={data.entity} edges={data.edges} />
            )}

            {/* LLM answer */}
            {result.type === "llm" && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-text-primary">AI Answer</h3>
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {result.subtitle}
                </p>
                {result.meta && (
                  <span className="inline-block px-2 py-0.5 bg-surface rounded text-[10px] font-medium text-text-tertiary">
                    {result.meta}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
