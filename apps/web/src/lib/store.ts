import { create } from "zustand";
import type { NodeDTO, EdgeDTO, ProjectDTO } from "./api";

type CompareSelection = {
  a: string | null;
  b: string | null;
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
  contextPanelOpen: boolean;
  includeArchived: boolean;
  busy: boolean;

  // actions
  setTree: (project: ProjectDTO | null, nodes: NodeDTO[], edges: EdgeDTO[]) => void;
  setProject: (project: ProjectDTO | null) => void;
  setSelected: (id: string | null) => void;
  openFork: (parentId: string) => void;
  closeFork: () => void;
  openMedia: (parentId: string) => void;
  closeMedia: () => void;
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
  contextPanelOpen: false,
  includeArchived: false,
  busy: false,

  setTree: (project, nodes, edges) => set({ project, nodes, edges }),
  setProject: (project) => set({ project }),
  setSelected: (id) => set({ selectedNodeId: id }),
  openFork: (parentId) => set({ forkDialogOpen: true, forkParentId: parentId }),
  closeFork: () => set({ forkDialogOpen: false, forkParentId: null }),
  openMedia: (parentId) => set({ mediaDialogOpen: true, mediaParentId: parentId }),
  closeMedia: () => set({ mediaDialogOpen: false, mediaParentId: null }),
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
}));
