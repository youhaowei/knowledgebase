import { useEffect, useState } from "react";
import { Badge } from "@stdui/react";
import { getMemory } from "@/server/functions";
import { SentimentBadge, ConfidenceBadge } from "./SentimentBadge";

interface MemoryDetailProps {
  name: string;
}

interface MemoryData {
  memory?: {
    id: string;
    name: string;
    text: string;
    summary?: string;
    category?: string;
    createdAt?: Date;
  };
  edges: Array<{
    id: string;
    sourceEntity: string;
    targetEntity: string;
    relationType: string;
    fact: string;
    sentiment: number;
    confidence: number;
  }>;
}

const CATEGORY_COLORS: Record<string, "primary" | "info" | "warning" | "secondary"> = {
  preference: "primary",
  event: "info",
  pattern: "warning",
  general: "secondary",
};

export function MemoryDetail({ name }: MemoryDetailProps) {
  const [data, setData] = useState<MemoryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    getMemory({ data: { name } })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [name]);

  if (error) {
    return (
      <div className="p-4 text-xs text-palette-danger">
        Failed to load: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 text-xs text-neutral-fg-subtle animate-pulse">
        Loading memory...
      </div>
    );
  }

  const memory = data.memory;
  if (!memory) {
    return (
      <div className="p-4 text-xs text-neutral-fg-subtle">
        Memory not found
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2">
        {memory.category && (
          <Badge variant="soft" color={CATEGORY_COLORS[memory.category] ?? "secondary"} className="text-[10px]">
            {memory.category}
          </Badge>
        )}
        {memory.createdAt && (
          <span className="text-[10px] text-neutral-fg-subtle">
            {new Date(memory.createdAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Summary */}
      {memory.summary && (
        <div>
          <div className="text-[10px] font-medium text-neutral-fg-subtle uppercase tracking-wider mb-1">
            Summary
          </div>
          <div className="p-2.5 rounded-md bg-neutral-bg-subtle border border-neutral-border text-xs text-neutral-fg-subtle">
            {memory.summary}
          </div>
        </div>
      )}

      {/* Source text */}
      <div>
        <div className="text-[10px] font-medium text-neutral-fg-subtle uppercase tracking-wider mb-1">
          Source Text
        </div>
        <div className="p-2.5 rounded-md bg-neutral-bg-subtle border border-neutral-border text-xs text-neutral-fg whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
          {memory.text}
        </div>
      </div>

      {/* Extracted facts */}
      {data.edges.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-neutral-fg-subtle uppercase tracking-wider mb-2">
            Extracted Facts ({data.edges.length})
          </div>
          <div className="space-y-1.5">
            {data.edges.map((edge) => (
              <div key={edge.id} className="p-2 rounded-md bg-neutral-bg-subtle/50 border border-neutral-border/50 text-xs">
                <div className="flex items-center gap-1 text-[11px]">
                  <span className="text-neutral-fg font-medium">{edge.sourceEntity}</span>
                  <span className="text-palette-primary">→</span>
                  <span className="text-palette-primary text-[10px]">{edge.relationType}</span>
                  <span className="text-palette-primary">→</span>
                  <span className="text-neutral-fg font-medium">{edge.targetEntity}</span>
                </div>
                <p className="text-[11px] text-neutral-fg-subtle mt-0.5">{edge.fact}</p>
                <div className="flex gap-2 mt-1">
                  <SentimentBadge sentiment={edge.sentiment} />
                  <ConfidenceBadge confidence={edge.confidence} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
