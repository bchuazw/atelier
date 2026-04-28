import { useCallback, useEffect, useMemo, useRef } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeChange,
} from "reactflow";
import "reactflow/dist/style.css";

import VariantNode, { type VariantNodeData } from "./VariantNode";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";
import { computeTreeLayout, diffPositions } from "@/lib/autoLayout";
import { Wand } from "lucide-react";

const nodeTypes = { variant: VariantNode };

// PromptBar's footprint when expanded with chips is ~280px. React Flow's
// fitView only takes a single relative padding, so we go a bit generous
// (0.35 = roughly 320px on a 900px viewport) to make sure the bottom-most
// node always lands above the bar even on small screens.
const FIT_VIEW_PADDING_FOR_PROMPTBAR = 0.35;

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

function CanvasInner() {
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
    showcaseMode,
    championedIds,
  } = useUI();
  const rf = useReactFlow();
  // Re-fit the view whenever the number of nodes changes (i.e. a fork or
  // merge produced a new variant). Without this the new node lands wherever
  // the layout helper put it — typically below the visible viewport, hidden
  // behind the PromptBar overlay. Using FIT_VIEW_PADDING_FOR_PROMPTBAR keeps
  // a comfortable bottom margin so the new node always lands above the bar.
  const lastFittedCount = useRef(0);
  useEffect(() => {
    if (nodes.length === lastFittedCount.current) return;
    if (nodes.length === 0) {
      lastFittedCount.current = 0;
      return;
    }
    // Defer one frame so React Flow has actually rendered the new node.
    const handle = window.requestAnimationFrame(() => {
      try {
        rf.fitView({
          padding: FIT_VIEW_PADDING_FOR_PROMPTBAR,
          duration: 600,
          minZoom: 0.3,
          maxZoom: 1.0,
        });
      } catch {
        // ReactFlow not yet ready — skip silently.
      }
    });
    lastFittedCount.current = nodes.length;
    return () => window.cancelAnimationFrame(handle);
  }, [nodes.length, rf]);

  // Re-fit whenever the user toggles Showcase mode — the visible node count
  // and positions both change but the source `nodes` array doesn't, so the
  // count-change effect above wouldn't fire on its own. Independent effect
  // means entering AND exiting both produce a smooth recenter.
  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      try {
        rf.fitView({
          padding: FIT_VIEW_PADDING_FOR_PROMPTBAR,
          duration: 600,
          minZoom: 0.3,
          maxZoom: 1.0,
        });
      } catch {
        // ReactFlow not yet ready — skip silently.
      }
    });
    return () => window.cancelAnimationFrame(handle);
  }, [showcaseMode, rf]);

  // Showcase mode collapses the canvas to just the user's starred finalists,
  // re-laid-out as a clean horizontal row. The original tree positions are
  // left untouched in the store — exiting Showcase restores the full view.
  // 320px stride matches CHILD_X_STEP from autoLayout so the spacing reads
  // as native to the rest of the canvas.
  const visibleStoreNodes = useMemo(() => {
    if (!showcaseMode) return nodes;
    const championSet = new Set(championedIds);
    return nodes.filter((n) => championSet.has(n.id));
  }, [nodes, showcaseMode, championedIds]);

  const rfNodes = useMemo<RFNode<VariantNodeData>[]>(
    () =>
      visibleStoreNodes.map((n, i) => ({
        id: n.id,
        type: "variant",
        position: showcaseMode
          ? { x: i * 320, y: 0 }
          : n.position,
        data: { node: n },
        // Pass visual hints via className so VariantNode.tsx can style them.
        // Drag-to-combine hints are suppressed in Showcase mode — combining
        // doesn't apply to a finalists-only view.
        className: showcaseMode
          ? undefined
          : mergeDrag?.source_id === n.id
            ? "atelier-merge-source"
            : mergeDrag?.hover_target_id === n.id
            ? "atelier-merge-target"
            : recentlyMergedId === n.id
            ? "atelier-recently-merged"
            : undefined,
      })),
    [visibleStoreNodes, showcaseMode, mergeDrag, recentlyMergedId]
  );

  const rfEdges = useMemo<RFEdge[]>(() => {
    // Count edges per source so we can suppress labels when a parent has
    // many children — 4+ stacked labels become unreadable, and the prompt
    // text is also visible on the child node itself.
    const sourceCount = new Map<string, number>();
    for (const e of edges) sourceCount.set(e.from, (sourceCount.get(e.from) ?? 0) + 1);

    // In Showcase mode hide every edge — finalists are presented as a clean
    // gallery without parent/sibling lineage. The lineage info isn't useful
    // when only the survivors are visible anyway.
    const sourceEdges = showcaseMode ? [] : edges;
    return sourceEdges.map((e) => {
      const isContribution = e.type === "contribution";
      const isMerge = e.type === "merge";
      const siblingsCount = sourceCount.get(e.from) ?? 1;
      // Suppress labels when 4+ siblings — they overlap and are noise.
      // Truncate hard when 3 siblings so they fit.
      const labelLimit = siblingsCount >= 4 ? 0 : siblingsCount === 3 ? 18 : 30;
      const fullLabel = e.prompt_text || "";
      const showLabel = labelLimit > 0 && fullLabel.length > 0;
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
        label: showLabel
          ? fullLabel.slice(0, labelLimit) + (fullLabel.length > labelLimit ? "…" : "")
          : undefined,
        labelStyle: isContribution
          ? { fill: "#f5d0fe", fontSize: 10 }
          : { fill: "#a1a1aa", fontSize: 10 },
        labelBgStyle: { fill: "#18181b" },
        labelBgPadding: [4, 2],
      };
    });
  }, [edges, showcaseMode]);

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

  // Re-fit on viewport resize. A senior designer flagged that variants clip
  // when the user resizes to 1280×800 (the most common designer monitor) —
  // without this, only the initial mount fitView fires and the tree stays
  // pinned at the old viewport size.
  useEffect(() => {
    let pending: number | null = null;
    const onResize = () => {
      if (pending !== null) window.cancelAnimationFrame(pending);
      pending = window.requestAnimationFrame(() => {
        try {
          rf.fitView({
            padding: FIT_VIEW_PADDING_FOR_PROMPTBAR,
            duration: 250,
            minZoom: 0.3,
            maxZoom: 1.0,
          });
        } catch {}
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (pending !== null) window.cancelAnimationFrame(pending);
    };
  }, [rf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelected]);

  // Tidy: re-flow the tree with the canonical Reingold–Tilford layout, then
  // PATCH each moved node so the new positions persist server-side too.
  const onTidy = useCallback(async () => {
    const target = computeTreeLayout(nodes);
    const moves = diffPositions(nodes, target);
    if (moves.length === 0) return;
    // Optimistic local update so the canvas snaps immediately.
    for (const m of moves) {
      const n = nodes.find((x) => x.id === m.id);
      if (n) upsertNode({ ...n, position: { x: m.x, y: m.y } });
    }
    // Re-fit after the snap so everything's in view.
    requestAnimationFrame(() => {
      try {
        rf.fitView({
          padding: FIT_VIEW_PADDING_FOR_PROMPTBAR,
          duration: 600,
          minZoom: 0.3,
          maxZoom: 1.0,
        });
      } catch {}
    });
    // Persist — fire-and-forget so the UI stays snappy.
    await Promise.allSettled(
      moves.map((m) => api.patchNode(m.id, { position_x: m.x, position_y: m.y }))
    );
  }, [nodes, rf, upsertNode]);

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
        fitViewOptions={{ padding: FIT_VIEW_PADDING_FOR_PROMPTBAR, minZoom: 0.3, maxZoom: 1.0 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#27272a" />
        <Controls position="bottom-left" />
        {nodes.length > 1 && (
          <button
            onClick={onTidy}
            title="Tidy — re-flow the tree so siblings spread evenly + parents center over their children"
            className="absolute bottom-4 left-[88px] flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-white border border-zinc-300 text-zinc-700 hover:border-zinc-500 shadow-sm z-10"
          >
            <Wand className="w-3 h-3" />
            Tidy
          </button>
        )}
        <MiniMap pannable zoomable nodeColor={() => "#71717a"} maskColor="rgba(0,0,0,0.6)" />
      </ReactFlow>
    </div>
  );
}

export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
