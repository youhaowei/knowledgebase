import { useEffect, useState } from "react";
import { Badge } from "@stdui/react";
import { getEntity } from "@/server/functions";
import { SentimentBadge, ConfidenceBadge } from "./SentimentBadge";

interface EntityDetailProps {
  name: string;
  namespace: string | undefined;
}

interface EntityData {
  entity: { name: string; type: string; description?: string; summary?: string; namespace?: string };
  edges: Array<{
    id: string;
    sourceEntity: string;
    targetEntity: string;
    relationType: string;
    fact: string;
    sentiment: number;
    confidence: number;
    validAt?: Date;
    invalidAt?: Date;
    createdAt?: Date;
  }>;
}

const TYPE_COLORS: Record<string, "primary" | "info" | "secondary" | "warning"> = {
  person: "primary",
  organization: "info",
  project: "info",
  technology: "secondary",
  concept: "warning",
};

export function EntityDetail({ name, namespace }: EntityDetailProps) {
  const [data, setData] = useState<EntityData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    getEntity({ data: { name, namespace: namespace ?? "default" } })
      .then(setData)
      .catch((err) => setError(err.message));
  }, [name, namespace]);

  if (error) {
    return (
      <div className="p-4 text-xs text-palette-danger">
        Failed to load entity: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 text-xs text-neutral-fg-subtle animate-pulse">
        Loading entity...
      </div>
    );
  }

  const { entity, edges } = data;
  const incoming = edges.filter((e) => e.targetEntity === name);
  const outgoing = edges.filter((e) => e.sourceEntity === name);

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {/* Header */}
      <div>
        <Badge variant="soft" color={TYPE_COLORS[entity.type] ?? "secondary"} className="text-[10px] mb-2">
          {entity.type}
        </Badge>
        {entity.description && (
          <p className="text-xs text-neutral-fg-subtle mt-1">{entity.description}</p>
        )}
        {entity.summary && (
          <div className="mt-2 p-2.5 rounded-md bg-neutral-bg-subtle border border-neutral-border text-xs text-neutral-fg-subtle">
            {entity.summary}
          </div>
        )}
      </div>

      {/* Incoming edges */}
      {incoming.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-neutral-fg-subtle uppercase tracking-wider mb-2">
            Incoming ({incoming.length})
          </div>
          <div className="space-y-1.5">
            {incoming.map((edge) => (
              <EdgeRow key={edge.id} edge={edge} highlight="source" />
            ))}
          </div>
        </div>
      )}

      {/* Outgoing edges */}
      {outgoing.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-neutral-fg-subtle uppercase tracking-wider mb-2">
            Outgoing ({outgoing.length})
          </div>
          <div className="space-y-1.5">
            {outgoing.map((edge) => (
              <EdgeRow key={edge.id} edge={edge} highlight="target" />
            ))}
          </div>
        </div>
      )}

      {edges.length === 0 && (
        <div className="text-xs text-neutral-fg-subtle text-center py-4">
          No connected facts
        </div>
      )}
    </div>
  );
}

function EdgeRow({ edge, highlight }: {
  edge: EntityData["edges"][0];
  highlight: "source" | "target";
}) {
  return (
    <div className="p-2 rounded-md bg-neutral-bg-subtle/50 border border-neutral-border/50 text-xs">
      <div className="flex items-center gap-1 text-[11px]">
        <span className={highlight === "source" ? "text-palette-primary font-medium" : "text-neutral-fg"}>
          {edge.sourceEntity}
        </span>
        <span className="text-neutral-fg-subtle">→</span>
        <span className="text-palette-primary text-[10px]">{edge.relationType}</span>
        <span className="text-neutral-fg-subtle">→</span>
        <span className={highlight === "target" ? "text-palette-primary font-medium" : "text-neutral-fg"}>
          {edge.targetEntity}
        </span>
      </div>
      <p className="text-[11px] text-neutral-fg-subtle mt-0.5">{edge.fact}</p>
      <div className="flex gap-2 mt-1">
        <SentimentBadge sentiment={edge.sentiment} />
        <ConfidenceBadge confidence={edge.confidence} />
      </div>
    </div>
  );
}
