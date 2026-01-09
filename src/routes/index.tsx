import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { GraphClient } from "@/web/components/GraphClient";
import { CommandPalette } from "@/web/components/CommandPalette";
import { StatsOverlay } from "@/web/components/StatsOverlay";
import { ParticleBackground } from "@/web/components/ParticleBackground";
import { getGraphData, getStats } from "@/server/functions";
import type { GraphNode, GraphLink, Stats } from "@/web/components/types";

// Type for raw graph data from server (edge-as-fact model)
interface RawGraphData {
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    description?: string;
    summary?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    relationType: string;
    fact: string;
    sentiment: number;
    edgeId: string;
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
 * Computes node importance from edge count
 * Maps edge sentiment to visual strength
 * Filters out orphan nodes (nodes with no connections)
 */
function processGraphData(graphData: RawGraphData) {
  // Build set of nodes that have at least one connection
  const connectedNodeNames = new Set<string>();
  const nodeEdgeCount = new Map<string, number>();

  for (const edge of graphData.edges) {
    connectedNodeNames.add(edge.source);
    connectedNodeNames.add(edge.target);
    nodeEdgeCount.set(edge.source, (nodeEdgeCount.get(edge.source) ?? 0) + 1);
    nodeEdgeCount.set(edge.target, (nodeEdgeCount.get(edge.target) ?? 0) + 1);
  }

  // Filter out orphan nodes (nodes not in any edge)
  const connectedNodes = graphData.nodes.filter((n) =>
    connectedNodeNames.has(n.name),
  );

  // Compute importance from edge count (how many edges involve this entity)
  const edgeCounts = connectedNodes.map((n) => nodeEdgeCount.get(n.name) ?? 0);
  const minImportance = Math.min(...edgeCounts, 0);
  const maxImportance = Math.max(...edgeCounts, 1);

  const entityNodes: GraphNode[] = connectedNodes.map((n, i) => ({
    id: n.id || n.name,
    name: n.name,
    type: "Entity",
    itemType: n.type, // Entity type (person, technology, etc.)
    description: n.description,
    summary: n.summary,
    degree: edgeCounts[i],
    importance: normalize(edgeCounts[i]!, minImportance, maxImportance),
  }));

  const nodeNames = new Set(entityNodes.map((n) => n.name));

  // Filter valid edges and map to GraphLink format
  const validEdges = graphData.edges.filter(
    (e) => nodeNames.has(e.source) && nodeNames.has(e.target),
  );

  const validLinks: GraphLink[] = validEdges.map((e) => ({
    source: e.source,
    target: e.target,
    relationType: e.relationType,
    fact: e.fact,
    sentiment: e.sentiment,
    edgeId: e.edgeId,
    // Legacy support - relation as readable label
    relation: e.relationType,
    // Map sentiment to strength (0-1 range)
    strength: (e.sentiment + 1) / 2, // -1..1 → 0..1
  }));

  return { itemNodes: entityNodes, validLinks };
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
        {/* Full-screen graph as the primary visual - client-only to avoid SSR issues */}
        <GraphClient nodes={nodes} links={links} />

        {/* Stats overlay in top-left corner */}
        <StatsOverlay stats={stats} nodeCount={nodes.length} />

        {/* Spotlight-style command palette at bottom */}
        <CommandPalette onRefreshData={refreshData} />
      </div>
    </>
  );
}
