import { create } from "zustand";
import type { NodeDTO, EdgeDTO, ProjectDTO, ModelId } from "./api";

type CompareSelection = {
  a: string | null;
  b: string | null;
};

type MergeDrag = {
  source_id: string;
  hover_target_id: string | null;
  original_x: number;
  original_y: number;
};

type MergeDialogState = {
  source_id: string;
  target_id: string;
};

type UIState = {
  project: ProjectDTO | null;
  nodes: NodeDTO[];
  edges: EdgeDTO[];
  selectedNodeId: string | null;
  compare: CompareSelection;
  viewerOpen: boolean;
  forkDialogOpen: boolean;
  forkParentId: string | null;
  mediaDialogOpen: boolean;
  mediaParentId: string | null;
  feedbackDialogOpen: boolean;
  feedbackTargetId: string | null;
  criticsDialogOpen: boolean;
  criticsTargetId: string | null;
  exportDialogOpen: boolean;
  exportNodeId: string | null;
  mergeDrag: MergeDrag | null;
  mergeDialog: MergeDialogState | null;
  recentlyMergedId: string | null;
  preferredModel: ModelId;
  contextPanelOpen: boolean;
  includeArchived: boolean;
  busy: boolean;
  // Cumulative session token usage. Updated by SSE handlers when a job
  // returns a `token_usage` payload — gives the user a running estimate of
  // how much they've spent in the current browser session.
  sessionUsage: { input: number; output: number; cache_read: number; cache_creation: number };

  // actions
  setTree: (project: ProjectDTO | null, nodes: NodeDTO[], edges: EdgeDTO[]) => void;
  setProject: (project: ProjectDTO | null) => void;
  setSelected: (id: string | null) => void;
  openFork: (parentId: string) => void;
  closeFork: () => void;
  openMedia: (parentId: string) => void;
  closeMedia: () => void;
  openFeedback: (targetId: string) => void;
  closeFeedback: () => void;
  openCritics: (targetId: string) => void;
  closeCritics: () => void;
  openExport: (nodeId: string) => void;
  closeExport: () => void;
  setPreferredModel: (m: ModelId) => void;
  beginMergeDrag: (source_id: string, original_x: number, original_y: number) => void;
  setMergeHover: (target_id: string | null) => void;
  endMergeDrag: () => void;
  openMergeDialog: (source_id: string, target_id: string) => void;
  closeMergeDialog: () => void;
  markRecentlyMerged: (id: string | null) => void;
  setCompareA: (id: string | null) => void;
  setCompareB: (id: string | null) => void;
  openViewer: () => void;
  closeViewer: () => void;
  openContextPanel: () => void;
  closeContextPanel: () => void;
  setIncludeArchived: (v: boolean) => void;
  setBusy: (b: boolean) => void;
  upsertNode: (n: NodeDTO) => void;
  addEdge: (e: EdgeDTO) => void;
  addUsage: (usage: { input?: number; output?: number; cache_read?: number; cache_creation?: number }) => void;
};

export const useUI = create<UIState>((set) => ({
  project: null,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  compare: { a: null, b: null },
  viewerOpen: false,
  forkDialogOpen: false,
  forkParentId: null,
  mediaDialogOpen: false,
  mediaParentId: null,
  feedbackDialogOpen: false,
  feedbackTargetId: null,
  criticsDialogOpen: false,
  criticsTargetId: null,
  exportDialogOpen: false,
  exportNodeId: null,
  mergeDrag: null,
  mergeDialog: null,
  recentlyMergedId: null,
  preferredModel: "sonnet" as ModelId,
  contextPanelOpen: false,
  includeArchived: false,
  busy: false,
  sessionUsage: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },

  setTree: (project, nodes, edges) => set({ project, nodes, edges }),
  setProject: (project) => set({ project }),
  setSelected: (id) => set({ selectedNodeId: id }),
  openFork: (parentId) => set({ forkDialogOpen: true, forkParentId: parentId }),
  closeFork: () => set({ forkDialogOpen: false, forkParentId: null }),
  openMedia: (parentId) => set({ mediaDialogOpen: true, mediaParentId: parentId }),
  closeMedia: () => set({ mediaDialogOpen: false, mediaParentId: null }),
  openFeedback: (targetId) => set({ feedbackDialogOpen: true, feedbackTargetId: targetId }),
  closeFeedback: () => set({ feedbackDialogOpen: false, feedbackTargetId: null }),
  openCritics: (targetId) => set({ criticsDialogOpen: true, criticsTargetId: targetId }),
  closeCritics: () => set({ criticsDialogOpen: false, criticsTargetId: null }),
  openExport: (nodeId) => set({ exportDialogOpen: true, exportNodeId: nodeId }),
  closeExport: () => set({ exportDialogOpen: false, exportNodeId: null }),
  setPreferredModel: (m) => set({ preferredModel: m }),
  beginMergeDrag: (source_id, original_x, original_y) =>
    set({ mergeDrag: { source_id, hover_target_id: null, original_x, original_y } }),
  setMergeHover: (target_id) =>
    set((s) => (s.mergeDrag ? { mergeDrag: { ...s.mergeDrag, hover_target_id: target_id } } : {})),
  endMergeDrag: () => set({ mergeDrag: null }),
  openMergeDialog: (source_id, target_id) =>
    set({ mergeDialog: { source_id, target_id } }),
  closeMergeDialog: () => set({ mergeDialog: null }),
  markRecentlyMerged: (id) => set({ recentlyMergedId: id }),
  setCompareA: (id) => set((s) => ({ compare: { ...s.compare, a: id } })),
  setCompareB: (id) => set((s) => ({ compare: { ...s.compare, b: id } })),
  openViewer: () => set({ viewerOpen: true }),
  closeViewer: () => set({ viewerOpen: false }),
  openContextPanel: () => set({ contextPanelOpen: true }),
  closeContextPanel: () => set({ contextPanelOpen: false }),
  setIncludeArchived: (v) => set({ includeArchived: v }),
  setBusy: (b) => set({ busy: b }),
  upsertNode: (n) =>
    set((s) => {
      const exists = s.nodes.some((x) => x.id === n.id);
      return {
        nodes: exists ? s.nodes.map((x) => (x.id === n.id ? n : x)) : [...s.nodes, n],
      };
    }),
  addEdge: (e) =>
    set((s) => ({
      edges: s.edges.some((x) => x.id === e.id) ? s.edges : [...s.edges, e],
    })),
  addUsage: (usage) =>
    set((s) => ({
      sessionUsage: {
        input: s.sessionUsage.input + (usage.input ?? 0),
        output: s.sessionUsage.output + (usage.output ?? 0),
        cache_read: s.sessionUsage.cache_read + (usage.cache_read ?? 0),
        cache_creation: s.sessionUsage.cache_creation + (usage.cache_creation ?? 0),
      },
    })),
}));
