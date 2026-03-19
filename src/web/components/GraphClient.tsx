/**
 * Client-only Graph wrapper
 *
 * react-force-graph-2d uses the force-graph library which accesses `window` directly.
 * This wrapper ensures the Graph component only loads on the client side.
 */

import { useEffect, useState } from "react";
import type { GraphNode, GraphLink } from "./types";

interface GraphClientProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onClusterClick?: (namespace: string) => void;
  onNodeClick?: (node: { name: string; type: string }) => void;
  selectedNodeName?: string;
}

export function GraphClient({ nodes, links, onClusterClick, onNodeClick, selectedNodeName }: GraphClientProps) {
  const [Graph, setGraph] = useState<React.ComponentType<GraphClientProps> | null>(null);

  useEffect(() => {
    import("./Graph").then((mod) => {
      setGraph(() => mod.Graph);
    });
  }, []);

  if (!Graph) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-secondary">
        Loading graph...
      </div>
    );
  }

  return <Graph nodes={nodes} links={links} onClusterClick={onClusterClick} onNodeClick={onNodeClick} selectedNodeName={selectedNodeName} />;
}
