import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { GraphClient } from "@/web/components/GraphClient";
import { CommandPalette } from "@/web/components/CommandPalette";
import { TopBar } from "@/web/components/TopBar";
import { StatusBar } from "@/web/components/StatusBar";
import { LeftPanel } from "@/web/components/LeftPanel";
import { RightPanel } from "@/web/components/RightPanel";
import { ThemeProvider } from "@/web/components/ThemeProvider";
import { AddMemoryDialog } from "@/web/components/AddMemoryDialog";
import { AdminDialog } from "@/web/components/AdminDialog";
import { ParticleBackground } from "@/web/components/ParticleBackground";
import { getGraphData, getStats, listNamespaces } from "@/server/functions";
import type { GraphNode, GraphLink, Stats } from "@/web/components/types";

// Type for raw graph data from server (edge-as-fact model)
interface RawGraphData {
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    namespace?: string;
    description?: string;
    summary?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    relationType: string;
    fact: string;
    sentiment: number;
    confidence: number;
    edgeId: string;
  }>;
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

function processGraphData(graphData: RawGraphData) {
  const connectedNodeNames = new Set<string>();
  const nodeEdgeCount = new Map<string, number>();

  for (const edge of graphData.edges) {
    connectedNodeNames.add(edge.source);
    connectedNodeNames.add(edge.target);
    nodeEdgeCount.set(edge.source, (nodeEdgeCount.get(edge.source) ?? 0) + 1);
    nodeEdgeCount.set(edge.target, (nodeEdgeCount.get(edge.target) ?? 0) + 1);
  }

  const connectedNodes = graphData.nodes.filter((n) =>
    connectedNodeNames.has(n.name),
  );

  const edgeCounts = connectedNodes.map((n) => nodeEdgeCount.get(n.name) ?? 0);
  const minImportance = Math.min(...edgeCounts, 0);
  const maxImportance = Math.max(...edgeCounts, 1);

  const entityNodes: GraphNode[] = connectedNodes.map((n, i) => ({
    id: n.id || n.name,
    name: n.name,
    type: "Entity",
    itemType: n.type,
    namespace: n.namespace,
    description: n.description,
    summary: n.summary,
    degree: edgeCounts[i],
    importance: normalize(edgeCounts[i]!, minImportance, maxImportance),
  }));

  const nodeNames = new Set(entityNodes.map((n) => n.name));

  const validEdges = graphData.edges.filter(
    (e) => nodeNames.has(e.source) && nodeNames.has(e.target),
  );

  const validLinks: GraphLink[] = validEdges.map((e) => ({
    source: e.source,
    target: e.target,
    relationType: e.relationType,
    fact: e.fact,
    sentiment: e.sentiment,
    confidence: e.confidence,
    edgeId: e.edgeId,
    relation: e.relationType,
    strength: (e.sentiment + 1) / 2,
  }));

  return { itemNodes: entityNodes, validLinks };
}

export const Route = createFileRoute("/")({
  loader: async () => {
    const [graphData, stats, namespaces] = await Promise.all([
      getGraphData({ data: {} }),
      getStats({ data: {} }),
      listNamespaces(),
    ]);
    return { graphData, stats, namespaces };
  },
  component: Home,
});

// Selection state shared across panels
export interface SelectedItem {
  type: "entity" | "memory" | "edge";
  name: string;
  edgeId?: string;
}

function Home() {
  const loaderData = Route.useLoaderData();
  const initialProcessed = processGraphData(loaderData.graphData);

  // Data state
  const [nodes, setNodes] = useState<GraphNode[]>(initialProcessed.itemNodes);
  const [links, setLinks] = useState<GraphLink[]>(initialProcessed.validLinks);
  const [stats, setStats] = useState<Stats>(loaderData.stats);
  const [namespaces, setNamespaces] = useState<string[]>(loaderData.namespaces);
  const [selectedNamespace, setSelectedNamespace] = useState<string | undefined>(undefined);

  // Panel state
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [_selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [_addDialogOpen, setAddDialogOpen] = useState(false);
  const [_adminOpen, setAdminOpen] = useState(false);

  const refreshData = useCallback(async (ns?: string) => {
    try {
      const filter = ns ? { data: { namespace: ns } } : { data: {} };
      const [graphData, statsData, nsList] = await Promise.all([
        getGraphData(filter),
        getStats(filter),
        listNamespaces(),
      ]);

      const processed = processGraphData(graphData);

      setNodes((prev) => {
        const newSerialized = JSON.stringify(processed.itemNodes);
        return newSerialized === JSON.stringify(prev) ? prev : processed.itemNodes;
      });

      setLinks((prev) => {
        const newSerialized = JSON.stringify(processed.validLinks);
        return newSerialized === JSON.stringify(prev) ? prev : processed.validLinks;
      });

      setStats((prev) => {
        const newSerialized = JSON.stringify(statsData);
        return newSerialized === JSON.stringify(prev) ? prev : statsData;
      });

      setNamespaces(nsList);
    } catch (error) {
      console.error("Failed to refresh data:", error);
    }
  }, []);

  const handleNamespaceChange = useCallback((ns: string | undefined) => {
    setSelectedNamespace(ns);
    refreshData(ns);
  }, [refreshData]);

  // Polling
  useEffect(() => {
    const interval = setInterval(() => refreshData(selectedNamespace), 5000);
    return () => clearInterval(interval);
  }, [refreshData, selectedNamespace]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if (e.key === "Escape" && _selectedItem) {
        setSelectedItem(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [_selectedItem]);

  // Right panel is open when an item is selected
  const rightPanelOpen = _selectedItem !== null;

  return (
    <ThemeProvider>
      {/* Background layers */}
      <ParticleBackground />

      {/* Main 3-panel layout */}
      <div className="flex flex-col h-screen relative z-[2]">
        {/* Top bar */}
        <TopBar
          leftPanelOpen={leftPanelOpen}
          onToggleLeftPanel={() => setLeftPanelOpen((p) => !p)}
          namespaces={namespaces}
          selectedNamespace={selectedNamespace}
          onNamespaceChange={handleNamespaceChange}
          onOpenSearch={() => setCommandPaletteOpen(true)}
          onOpenAdd={() => setAddDialogOpen(true)}
        />

        {/* Content: left panel + graph + right panel */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel */}
          <div
            className="shrink-0 transition-all duration-200 ease-in-out overflow-hidden border-r border-neutral-border bg-neutral-bg/40 backdrop-blur-xl"
            style={{ width: leftPanelOpen ? 320 : 0 }}
          >
            <div className="w-80 h-full">
              <LeftPanel
                namespace={selectedNamespace}
                selectedItem={_selectedItem}
                onSelect={setSelectedItem}
              />
            </div>
          </div>

          {/* Center: Graph (always visible, flex-1) */}
          <div className="flex-1 min-w-0 relative">
            <GraphClient
              nodes={nodes}
              links={links}
              onClusterClick={handleNamespaceChange}
              onNodeClick={(node) => setSelectedItem({ type: "entity", name: node.name })}
              selectedNodeName={_selectedItem?.type === "entity" ? _selectedItem.name : undefined}
            />
          </div>

          {/* Right panel */}
          <div
            className="shrink-0 transition-all duration-200 ease-in-out overflow-hidden border-l border-neutral-border bg-neutral-bg/40 backdrop-blur-xl"
            style={{ width: rightPanelOpen ? 400 : 0 }}
          >
            <div className="w-[400px] h-full">
              {_selectedItem && (
                <RightPanel
                  item={_selectedItem}
                  namespace={selectedNamespace}
                  onClose={() => setSelectedItem(null)}
                  onRefresh={() => refreshData(selectedNamespace)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Status bar */}
        <StatusBar
          stats={stats}
          onOpenAdmin={() => setAdminOpen(true)}
        />
      </div>

      {/* Command palette overlay */}
      {commandPaletteOpen && (
        <CommandPalette
          onRefreshData={() => refreshData(selectedNamespace)}
          onSelect={(item) => {
            setSelectedItem(item);
            setCommandPaletteOpen(false);
          }}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {/* Add memory dialog */}
      <AddMemoryDialog
        open={_addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onAdded={() => refreshData(selectedNamespace)}
        namespace={selectedNamespace}
        namespaces={namespaces}
      />

      <AdminDialog
        open={_adminOpen}
        onClose={() => setAdminOpen(false)}
        stats={stats}
        onRefresh={() => refreshData(selectedNamespace)}
      />
    </ThemeProvider>
  );
}
