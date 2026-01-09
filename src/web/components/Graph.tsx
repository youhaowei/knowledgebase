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
const EDGE_COLORS = {
  positive: "#00f5d4", // cyan
  neutral: "#8892a6", // gray
  negative: "#ff8c00", // amber/orange
};

// Positive/negative relation sets for sentiment detection
const POSITIVE_RELATIONS = new Set([
  "uses", "prefers", "likes", "loves", "supports", "enables", "creates",
  "builds", "improves", "enhances", "helps", "provides", "offers",
  "recommends", "trusts", "values", "enjoys", "appreciates", "benefits", "empowers",
]);

const NEGATIVE_RELATIONS = new Set([
  "dislikes", "hates", "avoids", "opposes", "blocks", "prevents", "restricts",
  "conflicts_with", "contradicts", "rejects", "criticizes", "limits", "hinders",
  "breaks", "damages", "hurts", "threatens", "undermines",
]);

function getRelationSentiment(relation: string): "positive" | "neutral" | "negative" {
  const normalized = relation.toLowerCase().replace(/[_-]/g, "_");
  if (POSITIVE_RELATIONS.has(normalized)) return "positive";
  if (NEGATIVE_RELATIONS.has(normalized)) return "negative";
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
}

// Extended link type for force graph
interface ForceLink extends LinkObject {
  source: string | ForceNode;
  target: string | ForceNode;
  relation: string;
  strength: number;
  sentiment: "positive" | "neutral" | "negative";
}

// Threshold for considering a node a "supernode" (high connectivity)
const SUPERNODE_DEGREE_THRESHOLD = 8;

export function Graph({ nodes, links }: GraphProps) {
  const graphRef = useRef<ForceGraphMethods<ForceNode, ForceLink> | undefined>();
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
        relation: l.relation || "",
        strength: l.strength ?? 0.5,
        sentiment: getRelationSentiment(l.relation || ""),
      }));

    return { nodes: forceNodes, links: forceLinks };
  }, [nodes, links]);

  // Configure forces and fit to view when graph mounts
  useEffect(() => {
    if (graphRef.current && graphData.nodes.length > 0) {
      const fg = graphRef.current;

      // Configure d3 forces for better spacing
      fg.d3Force("charge")?.strength(-150); // Repulsion between nodes
      fg.d3Force("link")?.distance(80); // Longer links
      fg.d3Force("center")?.strength(0.05); // Weaker centering

      // Small delay to let the simulation settle, then fit to view
      setTimeout(() => {
        fg.zoomToFit(400, 50);
      }, 800);
    }
  }, [graphData.nodes.length]);

  // Custom node rendering
  const paintNode = useCallback((node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const size = 5 + node.importance * 7; // 5-12px radius based on importance
    const fontSize = 11 / globalScale;

    // Draw node circle
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI);
    ctx.fillStyle = node.color;
    ctx.fill();

    // Draw glow effect
    ctx.strokeStyle = node.color;
    ctx.lineWidth = 1.5 + node.importance * 1.5;
    ctx.globalAlpha = 0.3 + node.importance * 0.3;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Draw label below node (only if zoomed in enough)
    if (globalScale > 0.6) {
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

    // Draw line
    const edgeColor = EDGE_COLORS[link.sentiment];
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
    if (globalScale > 0.5 && link.relation) {
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const fontSize = Math.max(8, 9 / globalScale);

      ctx.font = `500 ${fontSize}px Sans-Serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(136, 146, 166, 0.9)";
      ctx.fillText(link.relation, midX, midY - 6);
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

    // Trigger re-render
    graphRef.current?.refresh();
  }, [graphData.links]);

  if (nodes.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-text-secondary text-center font-display text-2xl italic">
        <p>No items in the graph yet.</p>
        <p className="font-sans not-italic opacity-50 text-sm mt-3 tracking-wide">
          Add a memory to get started!
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
