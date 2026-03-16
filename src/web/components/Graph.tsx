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

// Cluster colors (muted, translucent backgrounds)
const CLUSTER_COLORS = [
  "rgba(0, 245, 212, 0.06)",  // cyan
  "rgba(247, 37, 133, 0.06)", // magenta
  "rgba(255, 195, 0, 0.06)",  // amber
  "rgba(123, 44, 191, 0.06)", // violet
  "rgba(0, 196, 167, 0.06)",  // teal
  "rgba(100, 130, 180, 0.06)", // slate
];

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

export function Graph({ nodes, links, onClusterClick }: GraphProps) {
  const graphRef = useRef<ForceGraphMethods<ForceNode, ForceLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track hovered node for focus effect
  const hoveredNodeRef = useRef<ForceNode | null>(null);
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

    // Assign cluster IDs by namespace
    const namespaceList = [...new Set(forceNodes.map((n) => {
      const ns = nodes.find((orig) => orig.name === n.id)?.namespace ?? "default";
      return ns;
    }))].sort();
    const nsToCluster = new Map(namespaceList.map((ns, i) => [ns, i]));

    for (const node of forceNodes) {
      const ns = nodes.find((orig) => orig.name === node.id)?.namespace ?? "default";
      node.clusterId = nsToCluster.get(ns) ?? 0;
    }

    return { nodes: forceNodes, links: forceLinks, namespaceList };
  }, [nodes, links]);

  // Configure forces and fit to view when graph mounts
  useEffect(() => {
    if (graphRef.current && graphData.nodes.length > 0) {
      const fg = graphRef.current;
      const n = graphData.nodes.length;

      fg.d3Force("charge")?.strength(-200 - n);
      fg.d3Force("link")?.distance(80);
      fg.d3Force("center")?.strength(0.1); // Strong centering pulls clusters together

      setTimeout(() => {
        fg.zoomToFit(400, 50);
      }, 1000);
    }
  }, [graphData.nodes.length]);

  // Custom node rendering
  const paintNode = useCallback((node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const size = 7 + node.importance * 10; // 7-17px radius based on importance
    const fontSize = 11 / globalScale;

    // Outer glow
    ctx.save();
    ctx.shadowColor = node.color;
    ctx.shadowBlur = 8 + node.importance * 12;
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
    ctx.fillStyle = node.color;
    ctx.fill();
    ctx.restore();

    // Bright inner fill (no shadow)
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, size * 0.7, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fill();

    // Draw label below node (only if zoomed in enough)
    if (globalScale > 0.3) {
      ctx.font = `600 ${fontSize}px Sans-Serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(230, 235, 245, 0.95)";
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

  // Draw namespace cluster hulls behind nodes
  const paintClusters = useCallback((ctx: CanvasRenderingContext2D, globalScale: number) => {
    const clusters = new Map<number, ForceNode[]>();
    for (const node of graphData.nodes) {
      if (node.x == null || node.y == null) continue;
      const cid = node.clusterId ?? 0;
      if (!clusters.has(cid)) clusters.set(cid, []);
      clusters.get(cid)!.push(node);
    }

    for (const [cid, clusterNodes] of clusters) {
      if (clusterNodes.length < 2) continue;

      const cx = clusterNodes.reduce((s, n) => s + n.x!, 0) / clusterNodes.length;
      const cy = clusterNodes.reduce((s, n) => s + n.y!, 0) / clusterNodes.length;
      const maxDist = Math.max(...clusterNodes.map((n) =>
        Math.sqrt((n.x! - cx) ** 2 + (n.y! - cy) ** 2)
      ));
      const radius = maxDist + 35;

      // Fill
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.fillStyle = CLUSTER_COLORS[cid % CLUSTER_COLORS.length];
      ctx.fill();

      // Dashed border
      ctx.strokeStyle = CLUSTER_COLORS[cid % CLUSTER_COLORS.length].replace("0.06", "0.12");
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Namespace label at top of cluster
      const nsName = graphData.namespaceList[cid] ?? "default";
      const fontSize = Math.max(10, 12 / globalScale);
      ctx.font = `500 ${fontSize}px Sans-Serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(136, 146, 166, 0.5)";
      ctx.fillText(nsName, cx, cy - radius + fontSize + 2);
    }
  }, [graphData.nodes, graphData.namespaceList]);

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
        // Cluster backgrounds
        onRenderFramePre={(ctx, globalScale) => paintClusters(ctx, globalScale)}
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
