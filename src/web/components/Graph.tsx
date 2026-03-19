/**
 * Force-directed Graph Visualization using react-force-graph-2d
 *
 * Features:
 * - Native zoom/pan with mouse wheel and drag
 * - Node dragging that works correctly at any zoom level
 * - Custom node rendering with type-based colors
 * - Directional arrows on edges
 * - Edge labels
 */

import { useCallback, useMemo, useRef, useEffect } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
  type LinkObject,
} from "react-force-graph-2d";
import type { GraphNode, GraphLink } from "./types";

interface GraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onClusterClick?: (namespace: string) => void;
  onNodeClick?: (node: { name: string; type: string }) => void;
  selectedNodeName?: string;
}

// Type-based color palette (matching the cyber aesthetic)
const TYPE_COLORS: Record<string, string> = {
  person: "#00f5d4", // cyan
  organization: "#7b2cbf", // violet
  project: "#7b2cbf", // violet
  technology: "#f72585", // magenta
  concept: "#ffc300", // amber
  preference: "#00c4a7", // teal
  decision: "#00c4a7", // teal
  entity: "#8892a6", // gray fallback
};

// Sentiment-based edge colors
// Uses a gradient from negative (amber/orange) through neutral (gray) to positive (cyan)
function getEdgeColor(sentiment: number): string {
  if (sentiment > 0.3) return "#00f5d4"; // cyan - positive
  if (sentiment < -0.3) return "#ff8c00"; // amber/orange - negative
  return "#8892a6"; // gray - neutral
}

// Get sentiment category from numeric value (-1 to 1)
function getSentimentCategory(sentiment: number): "positive" | "neutral" | "negative" {
  if (sentiment > 0.3) return "positive";
  if (sentiment < -0.3) return "negative";
  return "neutral";
}

// Extended node type for force graph
interface ForceNode extends NodeObject {
  id: string;
  name: string;
  type: string;
  importance: number;
  degree: number;
  color: string;
  clusterId?: number;
}

// Extended link type for force graph
interface ForceLink extends LinkObject {
  source: string | ForceNode;
  target: string | ForceNode;
  relationType: string;
  fact: string;
  sentiment: number; // -1 to 1
  sentimentCategory: "positive" | "neutral" | "negative";
  strength: number;
  edgeId: string;
}

export function Graph({ nodes, links, onClusterClick, onNodeClick, selectedNodeName }: GraphProps) {
  const graphRef = useRef<ForceGraphMethods<ForceNode, ForceLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track hovered node for focus effect
  const hoveredNodeRef = useRef<ForceNode | null>(null);
  const selectedNodeRef = useRef<string | undefined>(selectedNodeName);
  selectedNodeRef.current = selectedNodeName;
  const highlightedNodesRef = useRef<Set<string>>(new Set());
  const highlightedLinksRef = useRef<Set<ForceLink>>(new Set());

  // Transform data for force graph
  const graphData = useMemo(() => {
    const forceNodes: ForceNode[] = nodes.map((n) => ({
      id: n.name, // Use name as ID for linking
      name: n.name,
      type: n.itemType || "entity",
      importance: n.importance ?? 0.5,
      degree: n.degree ?? 0,
      color: TYPE_COLORS[n.itemType || "entity"] || TYPE_COLORS.entity,
    }));

    const nodeSet = new Set(forceNodes.map((n) => n.id));

    const forceLinks: ForceLink[] = links
      .filter((l) => {
        const sourceId = typeof l.source === "string" ? l.source : l.source.name;
        const targetId = typeof l.target === "string" ? l.target : l.target.name;
        return nodeSet.has(sourceId) && nodeSet.has(targetId);
      })
      .map((l) => ({
        source: typeof l.source === "string" ? l.source : l.source.name,
        target: typeof l.target === "string" ? l.target : l.target.name,
        relationType: l.relationType || l.relation || "",
        fact: l.fact || "",
        sentiment: l.sentiment ?? 0,
        sentimentCategory: getSentimentCategory(l.sentiment ?? 0),
        strength: l.strength ?? (0.5 + Math.abs(l.sentiment ?? 0) * 0.5), // Stronger for more opinionated
        edgeId: l.edgeId || "",
      }));

    // Build adjacency for connected components
    const adj = new Map<string, Set<string>>();
    for (const n of forceNodes) adj.set(n.id, new Set());
    for (const l of forceLinks) {
      const s = typeof l.source === "string" ? l.source : (l.source as ForceNode).id;
      const t = typeof l.target === "string" ? l.target : (l.target as ForceNode).id;
      adj.get(s)?.add(t);
      adj.get(t)?.add(s);
    }

    // Detect connected components (sub-clusters)
    const visited = new Set<string>();
    let nextClusterId = 0;
    const clusterLabels: string[] = [];
    for (const node of forceNodes) {
      if (visited.has(node.id)) continue;
      const component: ForceNode[] = [];
      const queue = [node.id];
      while (queue.length) {
        const id = queue.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const n = forceNodes.find((f) => f.id === id);
        if (n) { n.clusterId = nextClusterId; component.push(n); }
        for (const neighbor of adj.get(id) ?? []) {
          if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      const sorted = [...component].sort((a, b) => b.degree - a.degree);
      clusterLabels.push(sorted[0]?.name ?? `cluster-${nextClusterId}`);
      nextClusterId++;
    }

    // Build namespace list for outer hulls
    const namespaceList = [...new Set(
      forceNodes.map((n) => nodes.find((orig) => orig.name === n.id)?.namespace ?? "default")
    )].sort();

    return { nodes: forceNodes, links: forceLinks, clusterLabels, namespaceList };
  }, [nodes, links]);

  // Configure forces and fit to view when graph mounts
  useEffect(() => {
    if (graphRef.current && graphData.nodes.length > 0) {
      const fg = graphRef.current;
      const n = graphData.nodes.length;

      fg.d3Force("charge")?.strength(-150);
      fg.d3Force("link")?.distance(60);
      fg.d3Force("center")?.strength(0.05);

      setTimeout(() => fg.zoomToFit(400, 40), 1500);
    }
  }, [graphData.nodes.length]);

  // Custom node rendering — adapts to zoom level
  const paintNode = useCallback((node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const baseSize = 5 + node.importance * 6;
    const zoomCompensation = Math.max(0.7, Math.min(2.5, 1.2 / globalScale));
    const size = baseSize * zoomCompensation;

    ctx.save();
    ctx.shadowColor = node.color;
    ctx.shadowBlur = (3 + node.importance * 5) * zoomCompensation;
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
    ctx.fillStyle = node.color;
    ctx.fill();
    ctx.restore();

    // Inner highlight
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, size * 0.6, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();

    // Selection ring
    if (selectedNodeRef.current === node.name) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, size + 3 * zoomCompensation, 0, 2 * Math.PI);
      ctx.strokeStyle = "#00f5d4";
      ctx.lineWidth = 2 * zoomCompensation;
      ctx.shadowColor = "#00f5d4";
      ctx.shadowBlur = 8 * zoomCompensation;
      ctx.stroke();
      ctx.restore();
    }

    // Tiered labels: always show high-importance, progressively reveal others on zoom
    const tier = node.importance > 0.7 ? 1 : node.importance > 0.3 ? 2 : 3;
    const showLabel = tier === 1 || (tier === 2 && globalScale > 0.3) || (tier === 3 && globalScale > 0.8);
    if (showLabel) {
      // Font scales with zoom compensation — readable at all levels
      const baseFontSize = tier === 1 ? 14 : tier === 2 ? 12 : 10;
      const fontSize = baseFontSize * Math.max(0.8, Math.min(1.8, 1 / globalScale));
      const alpha = tier === 1 ? 0.95 : tier === 2 ? 0.8 : 0.65;
      ctx.font = `${tier === 1 ? 700 : 600} ${fontSize}px Sans-Serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = `rgba(230, 235, 245, ${alpha})`;
      ctx.fillText(node.name, node.x!, node.y! + size + 3);
    }

    // Store size for pointer area
    (node as ForceNode & { __size: number }).__size = size;
  }, []);

  // Node pointer area (for click/hover detection)
  const nodePointerAreaPaint = useCallback((node: ForceNode, color: string, ctx: CanvasRenderingContext2D) => {
    const size = (node as ForceNode & { __size?: number }).__size || 8;
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, size + 4, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }, []);

  // Custom link rendering with labels
  const paintLink = useCallback((link: ForceLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const source = link.source as ForceNode;
    const target = link.target as ForceNode;

    if (!source.x || !source.y || !target.x || !target.y) return;

    // Calculate direction
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;

    const unitX = dx / dist;
    const unitY = dy / dist;

    // Get node sizes
    const sourceSize = (source as ForceNode & { __size?: number }).__size || 8;
    const targetSize = (target as ForceNode & { __size?: number }).__size || 8;

    // Start and end points (at node edges)
    const startX = source.x + unitX * sourceSize;
    const startY = source.y + unitY * sourceSize;
    const endX = target.x - unitX * (targetSize + 8); // Leave room for arrow
    const endY = target.y - unitY * (targetSize + 8);

    // Draw line - use sentiment value directly for color
    const edgeColor = getEdgeColor(link.sentiment);
    const lineWidth = 1 + link.strength * 2;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = 0.5 + link.strength * 0.3;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Draw arrow
    const arrowSize = 4 + link.strength * 3;
    const arrowX = target.x - unitX * (targetSize + 2);
    const arrowY = target.y - unitY * (targetSize + 2);
    const angle = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(
      arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
      arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
      arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = edgeColor;
    ctx.fill();

    // Draw label at midpoint (only if zoomed in enough)
    if (globalScale > 0.5 && link.relationType) {
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const fontSize = Math.max(8, 9 / globalScale);

      ctx.font = `500 ${fontSize}px Sans-Serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(136, 146, 166, 0.9)";
      ctx.fillText(link.relationType, midX, midY - 6);
    }
  }, []);

  // Handle node hover - compute highlighted nodes and links
  const handleNodeHover = useCallback((node: ForceNode | null) => {
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? "pointer" : "grab";
    }

    hoveredNodeRef.current = node;
    highlightedNodesRef.current.clear();
    highlightedLinksRef.current.clear();

    if (node) {
      // Add hovered node to highlights
      highlightedNodesRef.current.add(node.id);

      // Find all connected nodes and links
      graphData.links.forEach((link) => {
        const sourceId = typeof link.source === "string" ? link.source : (link.source as ForceNode).id;
        const targetId = typeof link.target === "string" ? link.target : (link.target as ForceNode).id;

        if (sourceId === node.id || targetId === node.id) {
          highlightedLinksRef.current.add(link);
          highlightedNodesRef.current.add(sourceId);
          highlightedNodesRef.current.add(targetId);
        }
      });
    }

    // Note: The highlight sets update refs, React handles re-renders through state changes
  }, [graphData.links]);


  if (nodes.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-text-secondary text-center font-display text-2xl italic">
        <p>No entities in the graph yet.</p>
        <p className="font-sans not-italic opacity-50 text-sm mt-3 tracking-wide">
          Add a memory to extract facts and entities!
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        // Node configuration
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={nodePointerAreaPaint}
        nodeLabel={(node) => `${(node as ForceNode).name} (${(node as ForceNode).degree} connections)`}
        // Link configuration - use custom rendering
        linkCanvasObject={paintLink}
        linkDirectionalArrowLength={0} // We draw our own arrows
        // Interaction
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        onNodeHover={handleNodeHover}
        onNodeClick={(node) => {
          const n = node as ForceNode;
          if (onNodeClick && n.name) {
            onNodeClick({ name: n.name, type: n.itemType || "entity" });
          }
        }}
        // Cluster backgrounds
        // Physics
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        cooldownTicks={200}
        // Styling
        backgroundColor="transparent"
      />
    </div>
  );
}
