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

/**
 * Inspect the element under the given screen-space cursor coordinates and
 * return the id of the React Flow node being hovered, if any (and it isn't
 * the `excludeId` caller is dragging). Used by drag-to-combine.
 */
function rfNodeIdAtPoint(clientX: number, clientY: number, excludeId?: string): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) return null;
  const nodeEl = (el as HTMLElement).closest(".react-flow__node") as HTMLElement | null;
  if (!nodeEl) return null;
  const id = nodeEl.getAttribute("data-id");
  if (!id || id === excludeId) return null;
  return id;
}

export default function Canvas() {
  const {
    nodes,
    edges,
    setSelected,
    upsertNode,
    mergeDrag,
    beginMergeDrag,
    setMergeHover,
    endMergeDrag,
    openMergeDialog,
    recentlyMergedId,
    markRecentlyMerged,
  } = useUI();

  const rfNodes = useMemo<RFNode<VariantNodeData>[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: "variant",
        position: n.position,
        data: { node: n },
        // Pass visual hints via className so VariantNode.tsx can style them.
        className:
          mergeDrag?.source_id === n.id
            ? "atelier-merge-source"
            : mergeDrag?.hover_target_id === n.id
            ? "atelier-merge-target"
            : recentlyMergedId === n.id
            ? "atelier-recently-merged"
            : undefined,
      })),
    [nodes, mergeDrag, recentlyMergedId]
  );

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      edges.map((e) => {
        const isContribution = e.type === "contribution";
        const isMerge = e.type === "merge";
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          type: "smoothstep",
          animated: isContribution,
          style: isContribution
            ? { stroke: "#e879f9", strokeWidth: 2, strokeDasharray: "6 5" }
            : isMerge
            ? { stroke: "#d946ef", strokeWidth: 2.5 }
            : undefined,
          label: e.prompt_text
            ? e.prompt_text.slice(0, 30) + (e.prompt_text.length > 30 ? "…" : "")
            : undefined,
          labelStyle: isContribution
            ? { fill: "#f5d0fe", fontSize: 10 }
            : { fill: "#a1a1aa", fontSize: 10 },
          labelBgStyle: { fill: "#18181b" },
          labelBgPadding: [4, 2],
        };
      }),
    [edges]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, rfNodes);
      for (const change of changes) {
        if (change.type === "position" && change.position && change.dragging === false) {
          // Drag ended. If this was a merge gesture with a valid target, snap the
          // source back to its original position and open the merge dialog.
          const md = useUI.getState().mergeDrag;
          if (md && md.source_id === change.id) {
            if (md.hover_target_id) {
              const existing = nodes.find((n) => n.id === change.id);
              if (existing) {
                const snap = { ...existing, position: { x: md.original_x, y: md.original_y } };
                upsertNode(snap);
                void api.patchNode(change.id, {
                  position_x: md.original_x,
                  position_y: md.original_y,
                });
              }
              openMergeDialog(md.source_id, md.hover_target_id);
              endMergeDrag();
              continue;
            }
            endMergeDrag();
          }
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
      for (const rfn of updated) {
        const existing = nodes.find((n) => n.id === rfn.id);
        if (existing && (existing.position.x !== rfn.position.x || existing.position.y !== rfn.position.y)) {
          upsertNode({ ...existing, position: rfn.position });
        }
      }
    },
    [rfNodes, nodes, upsertNode, openMergeDialog, endMergeDrag]
  );

  const handleNodeDragStart = useCallback(
    (_e: unknown, node: RFNode) => {
      beginMergeDrag(node.id, node.position.x, node.position.y);
    },
    [beginMergeDrag]
  );

  const handleNodeDrag = useCallback(
    (event: React.MouseEvent, node: RFNode) => {
      const hoverId = rfNodeIdAtPoint(event.clientX, event.clientY, node.id);
      setMergeHover(hoverId);
    },
    [setMergeHover]
  );

  // Clear the "recently merged" glow after its animation finishes.
  useEffect(() => {
    if (!recentlyMergedId) return;
    const t = window.setTimeout(() => markRecentlyMerged(null), 2500);
    return () => window.clearTimeout(t);
  }, [recentlyMergedId, markRecentlyMerged]);

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
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
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
