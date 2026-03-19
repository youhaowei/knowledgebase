import { useEffect, useState } from "react";
import { Badge } from "@stdui/react";
import { listEdges, forgetEdge } from "@/server/functions";
import { SentimentBadge, ConfidenceBadge } from "./SentimentBadge";

interface EdgeDetailProps {
  edgeId: string;
  namespace: string | undefined;
  onInvalidated: () => void;
}

interface EdgeData {
  id: string;
  sourceEntityName: string;
  targetEntityName: string;
  relationType: string;
  fact: string;
  sentiment: number;
  confidence: number;
  confidenceReason?: string;
  validAt?: Date;
  invalidAt?: Date;
  createdAt?: Date;
}

export function EdgeDetail({ edgeId, namespace, onInvalidated }: EdgeDetailProps) {
  const [edge, setEdge] = useState<EdgeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalidateReason, setInvalidateReason] = useState("");
  const [showInvalidateForm, setShowInvalidateForm] = useState(false);
  const [isInvalidating, setIsInvalidating] = useState(false);

  useEffect(() => {
    setEdge(null);
    setError(null);
    // Fetch edges and filter by ID client-side (no ID-specific server function yet)
    listEdges({ data: { offset: 0, limit: 100, namespace: namespace ?? undefined, includeInvalidated: true } as any })
      .then((allEdges) => {
        const found = allEdges.items.find((e) => e.id === edgeId);
        if (found) setEdge(found as any);
        else setError("Edge not found");
      })
      .catch((err) => setError(err.message));
  }, [edgeId, namespace]);

  const handleInvalidate = async () => {
    if (!invalidateReason.trim()) return;
    setIsInvalidating(true);
    try {
      await forgetEdge({ data: { edgeId, reason: invalidateReason, namespace: namespace ?? "default" } });
      onInvalidated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invalidate");
    } finally {
      setIsInvalidating(false);
    }
  };

  if (error) {
    return <div className="p-4 text-xs text-palette-danger">Failed to load: {error}</div>;
  }

  if (!edge) {
    return <div className="p-4 text-xs text-neutral-fg-subtle animate-pulse">Loading edge...</div>;
  }

  const isInvalidated = edge.invalidAt != null;

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto">
      {/* Relationship diagram */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-neutral-fg">{edge.sourceEntityName}</span>
        <span className="px-2 py-0.5 rounded bg-palette-primary/10 text-palette-primary text-xs font-medium">
          {edge.relationType}
        </span>
        <span className="font-medium text-neutral-fg">{edge.targetEntityName}</span>
      </div>

      {isInvalidated && (
        <Badge variant="soft" color="danger" className="text-[10px] w-fit">
          Invalidated {edge.invalidAt ? new Date(edge.invalidAt).toLocaleDateString() : ""}
        </Badge>
      )}

      {/* Fact */}
      <div>
        <div className="text-[10px] font-medium text-neutral-fg-subtle uppercase tracking-wider mb-1">
          Fact
        </div>
        <div className="p-2.5 rounded-md bg-neutral-bg-subtle border border-neutral-border text-xs text-neutral-fg">
          {edge.fact}
        </div>
      </div>

      {/* Metrics */}
      <div className="flex gap-2 flex-wrap">
        <SentimentBadge sentiment={edge.sentiment} />
        <ConfidenceBadge confidence={edge.confidence} />
      </div>

      {edge.confidenceReason && (
        <div className="text-[11px] text-neutral-fg-subtle italic">
          {edge.confidenceReason}
        </div>
      )}

      {/* Metadata */}
      <div className="text-[10px] text-neutral-fg-subtle space-y-1">
        {edge.validAt && <div>Valid since: {new Date(edge.validAt).toLocaleDateString()}</div>}
        {edge.createdAt && <div>Created: {new Date(edge.createdAt).toLocaleDateString()}</div>}
      </div>

      {/* Invalidate action */}
      {!isInvalidated && (
        <div className="mt-2">
          {showInvalidateForm ? (
            <div className="space-y-2">
              <textarea
                value={invalidateReason}
                onChange={(e) => setInvalidateReason(e.target.value)}
                placeholder="Reason for invalidation..."
                className="w-full h-20 p-2 rounded-md bg-neutral-bg-subtle border border-neutral-border text-xs text-neutral-fg resize-none focus:border-palette-primary focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleInvalidate}
                  disabled={isInvalidating || !invalidateReason.trim()}
                  className="px-3 py-1.5 rounded-md bg-palette-danger text-white text-xs font-medium disabled:opacity-50"
                >
                  {isInvalidating ? "Invalidating..." : "Invalidate"}
                </button>
                <button
                  onClick={() => setShowInvalidateForm(false)}
                  className="px-3 py-1.5 rounded-md bg-neutral-bg-subtle border border-neutral-border text-xs text-neutral-fg"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowInvalidateForm(true)}
              className="text-xs text-palette-danger hover:underline"
            >
              Invalidate this fact...
            </button>
          )}
        </div>
      )}
    </div>
  );
}
