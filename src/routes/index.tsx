import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { Graph } from "@/web/components/Graph";
import { CommandPalette } from "@/web/components/CommandPalette";
import { StatsOverlay } from "@/web/components/StatsOverlay";
import { ParticleBackground } from "@/web/components/ParticleBackground";
import { getGraphData, getStats } from "@/server/functions";
import type { GraphNode, GraphLink, Stats } from "@/web/components/types";

// Type for raw graph data from server (with metrics)
interface RawGraphData {
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    itemType: string | null;
    namespace: string;
    degree: number;
    referenceCount: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    relation: string;
    namespace: string;
    frequency: number;
  }>;
}

/**
 * Normalize a value to 0-1 range using min-max scaling
 * Returns 0.5 if all values are the same (no variance)
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/**
 * Helper to process raw graph data into UI-friendly format
 * Computes normalized importance (0-1) from degree + referenceCount
 * Computes normalized strength (0-1) from frequency
 * Filters out orphan nodes (nodes with no connections)
 */
function processGraphData(graphData: RawGraphData) {
  // Filter to only Item nodes
  const rawNodes = graphData.nodes.filter((n) => n.type === "Item");

  // Build set of nodes that have at least one connection
  const connectedNodeNames = new Set<string>();
  for (const edge of graphData.edges) {
    connectedNodeNames.add(edge.source);
    connectedNodeNames.add(edge.target);
  }

  // Filter out orphan nodes (nodes with degree 0 or not in any edge)
  const connectedNodes = rawNodes.filter(
    (n) => n.degree > 0 || connectedNodeNames.has(n.name),
  );

  // Compute combined importance score (degree weighted more than references)
  const importanceScores = connectedNodes.map(
    (n) => n.degree * 2 + n.referenceCount,
  );
  const minImportance = Math.min(...importanceScores, 0);
  const maxImportance = Math.max(...importanceScores, 1);

  const itemNodes: GraphNode[] = connectedNodes.map((n, i) => ({
    id: n.id || n.name,
    name: n.name,
    type: n.type,
    itemType: n.itemType ?? undefined,
    namespace: n.namespace,
    degree: n.degree,
    referenceCount: n.referenceCount,
    importance: normalize(importanceScores[i]!, minImportance, maxImportance),
  }));

  const nodeNames = new Set(itemNodes.map((n) => n.name));

  // Filter valid edges and compute strength
  const validEdges = graphData.edges.filter(
    (e) => nodeNames.has(e.source) && nodeNames.has(e.target),
  );
  const frequencies = validEdges.map((e) => e.frequency);
  const minFreq = Math.min(...frequencies, 1);
  const maxFreq = Math.max(...frequencies, 1);

  const validLinks: GraphLink[] = validEdges.map((e) => ({
    source: e.source,
    target: e.target,
    relation: e.relation,
    frequency: e.frequency,
    strength: normalize(e.frequency, minFreq, maxFreq),
  }));

  return { itemNodes, validLinks };
}

/**
 * Route with SSR loader - data is fetched on the server before render
 * No loading spinner needed on initial page load!
 */
export const Route = createFileRoute("/")({
  loader: async () => {
    const [graphData, stats] = await Promise.all([getGraphData(), getStats()]);
    return { graphData, stats };
  },
  component: Home,
});

function Home() {
  // Get SSR data from loader - available immediately, no loading state!
  const loaderData = Route.useLoaderData();

  // Process initial data from loader
  const initialProcessed = processGraphData(loaderData.graphData);

  // State for dynamic updates (polling)
  const [nodes, setNodes] = useState<GraphNode[]>(initialProcessed.itemNodes);
  const [links, setLinks] = useState<GraphLink[]>(initialProcessed.validLinks);
  const [stats, setStats] = useState<Stats>(loaderData.stats);

  // Refresh function for polling and post-mutation updates
  const refreshData = useCallback(async () => {
    try {
      const [graphData, statsData] = await Promise.all([
        getGraphData(),
        getStats(),
      ]);

      const processed = processGraphData(graphData);

      // Only update state if data actually changed (prevents unnecessary re-renders)
      setNodes((prev) => {
        const newSerialized = JSON.stringify(processed.itemNodes);
        const prevSerialized = JSON.stringify(prev);
        return newSerialized === prevSerialized ? prev : processed.itemNodes;
      });

      setLinks((prev) => {
        const newSerialized = JSON.stringify(processed.validLinks);
        const prevSerialized = JSON.stringify(prev);
        return newSerialized === prevSerialized ? prev : processed.validLinks;
      });

      setStats((prev) => {
        const newSerialized = JSON.stringify(statsData);
        const prevSerialized = JSON.stringify(prev);
        return newSerialized === prevSerialized ? prev : statsData;
      });
    } catch (error) {
      console.error("Failed to refresh data:", error);
    }
  }, []);

  // Polling for updates (keeps graph in sync)
  useEffect(() => {
    const interval = setInterval(refreshData, 5000);
    return () => clearInterval(interval);
  }, [refreshData]);

  return (
    <>
      {/* Particle background layer (z-index: 1) */}
      <ParticleBackground />

      <div className="h-screen overflow-hidden relative z-[2]">
        {/* Full-screen graph as the primary visual */}
        <Graph nodes={nodes} links={links} />

        {/* Stats overlay in top-left corner */}
        <StatsOverlay stats={stats} nodeCount={nodes.length} />

        {/* Spotlight-style command palette at bottom */}
        <CommandPalette onRefreshData={refreshData} />
      </div>
    </>
  );
}
