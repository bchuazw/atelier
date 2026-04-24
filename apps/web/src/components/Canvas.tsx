import { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeChange,
} from "reactflow";
import "reactflow/dist/style.css";

import VariantNode, { type VariantNodeData } from "./VariantNode";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";

const nodeTypes = { variant: VariantNode };

export default function Canvas() {
  const { nodes, edges, setSelected, upsertNode } = useUI();

  const rfNodes = useMemo<RFNode<VariantNodeData>[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: "variant",
        position: n.position,
        data: { node: n },
      })),
    [nodes]
  );

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        label: e.prompt_text ? e.prompt_text.slice(0, 30) + (e.prompt_text.length > 30 ? "…" : "") : undefined,
        labelStyle: { fill: "#a1a1aa", fontSize: 10 },
        labelBgStyle: { fill: "#18181b" },
        labelBgPadding: [4, 2],
      })),
    [edges]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, rfNodes);
      // Persist drag finishes.
      for (const change of changes) {
        if (change.type === "position" && change.position && change.dragging === false) {
          const existing = nodes.find((n) => n.id === change.id);
          if (existing) {
            const next = { ...existing, position: change.position };
            upsertNode(next);
            void api.patchNode(change.id, {
              position_x: change.position.x,
              position_y: change.position.y,
            });
          }
        }
      }
      // Local reflection of drag-in-progress positions.
      for (const rfn of updated) {
        const existing = nodes.find((n) => n.id === rfn.id);
        if (existing && (existing.position.x !== rfn.position.x || existing.position.y !== rfn.position.y)) {
          upsertNode({ ...existing, position: rfn.position });
        }
      }
    },
    [rfNodes, nodes, upsertNode]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelected]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, n) => setSelected(n.id)}
        onPaneClick={() => setSelected(null)}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.3, maxZoom: 1.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#27272a" />
        <Controls position="bottom-left" />
        <MiniMap pannable zoomable nodeColor={() => "#71717a"} maskColor="rgba(0,0,0,0.6)" />
      </ReactFlow>
    </div>
  );
}
