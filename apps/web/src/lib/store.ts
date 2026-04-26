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
  // Optional prompt to prefill when ForkDialog opens — used by the
  // Re-run action on a variant card so "fork the parent with the same
  // prompt" doesn't require retyping.
  forkPrefill: string | null;
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
  // Pending destructive action with an undo grace window. The variant
  // delete flow stages the deletion locally + shows a toast; only
  // commits the API call after the user lets the timer run out.
  pendingUndo: {
    label: string;
    expiresAt: number;
    // Snapshot of removed nodes/edges so undo can restore them in the
    // store without a tree-refresh round-trip.
    snapshot: { nodes: NodeDTO[]; edges: EdgeDTO[] };
    // Function called if the timer expires (commits the action server-side).
    commit: () => Promise<void>;
  } | null;
  // Non-blocking error notification. Replaces native `alert()` which was
  // freezing the page on server failures and looked unprofessional.
  errorToast: { message: string; expiresAt: number } | null;

  // actions
  setTree: (project: ProjectDTO | null, nodes: NodeDTO[], edges: EdgeDTO[]) => void;
  setProject: (project: ProjectDTO | null) => void;
  setSelected: (id: string | null) => void;
  openFork: (parentId: string) => void;
  closeFork: () => void;
  setForkPrefill: (prompt: string | null) => void;
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
  // Stage a destructive action with an undo grace window. Returns the
  // toast id so callers can dismiss it manually if they want.
  stagePendingUndo: (params: {
    label: string;
    snapshot: { nodes: NodeDTO[]; edges: EdgeDTO[] };
    commit: () => Promise<void>;
    expiresInMs?: number;
  }) => void;
  // Cancel the staged action — restore snapshot, drop the toast.
  cancelPendingUndo: () => void;
  // Force the staged action to commit immediately (used when the
  // grace timer expires, or when the user navigates away).
  flushPendingUndo: () => Promise<void>;
  // Show an error toast for a few seconds. Auto-dismisses; users can
  // also click X. Replaces every prior `alert()` call site.
  showError: (message: string, ttlMs?: number) => void;
  dismissError: () => void;
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
  forkPrefill: null,
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
  pendingUndo: null,
  errorToast: null,

  setTree: (project, nodes, edges) => set({ project, nodes, edges }),
  setProject: (project) => set({ project }),
  setSelected: (id) => set({ selectedNodeId: id }),
  // All open* actions close any other open dialog first. A beta tester
  // chained Critics on top of an open Fork dialog and ended up with two
  // overlapping modals + the second one auto-fired a 3-variant generation
  // because both shared keyboard focus. The fix here is structural: only
  // one dialog can be open at a time. Each open* call wipes every other
  // dialog flag in the same `set` so React renders a single transition.
  openFork: (parentId) =>
    set({
      forkDialogOpen: true,
      forkParentId: parentId,
      mediaDialogOpen: false,
      feedbackDialogOpen: false,
      criticsDialogOpen: false,
      exportDialogOpen: false,
      contextPanelOpen: false,
      mergeDialog: null,
    }),
  closeFork: () => set({ forkDialogOpen: false, forkParentId: null, forkPrefill: null }),
  setForkPrefill: (prompt) => set({ forkPrefill: prompt }),
  openMedia: (parentId) =>
    set({
      mediaDialogOpen: true,
      mediaParentId: parentId,
      forkDialogOpen: false,
      feedbackDialogOpen: false,
      criticsDialogOpen: false,
      exportDialogOpen: false,
      contextPanelOpen: false,
      mergeDialog: null,
    }),
  closeMedia: () => set({ mediaDialogOpen: false, mediaParentId: null }),
  openFeedback: (targetId) =>
    set({
      feedbackDialogOpen: true,
      feedbackTargetId: targetId,
      forkDialogOpen: false,
      mediaDialogOpen: false,
      criticsDialogOpen: false,
      exportDialogOpen: false,
      contextPanelOpen: false,
      mergeDialog: null,
    }),
  closeFeedback: () => set({ feedbackDialogOpen: false, feedbackTargetId: null }),
  openCritics: (targetId) =>
    set({
      criticsDialogOpen: true,
      criticsTargetId: targetId,
      forkDialogOpen: false,
      mediaDialogOpen: false,
      feedbackDialogOpen: false,
      exportDialogOpen: false,
      contextPanelOpen: false,
      mergeDialog: null,
    }),
  closeCritics: () => set({ criticsDialogOpen: false, criticsTargetId: null }),
  openExport: (nodeId) =>
    set({
      exportDialogOpen: true,
      exportNodeId: nodeId,
      forkDialogOpen: false,
      mediaDialogOpen: false,
      feedbackDialogOpen: false,
      criticsDialogOpen: false,
      contextPanelOpen: false,
      mergeDialog: null,
    }),
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
  openContextPanel: () =>
    set({
      contextPanelOpen: true,
      forkDialogOpen: false,
      mediaDialogOpen: false,
      feedbackDialogOpen: false,
      criticsDialogOpen: false,
      exportDialogOpen: false,
      mergeDialog: null,
    }),
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
  stagePendingUndo: ({ label, snapshot, commit, expiresInMs = 8000 }) => {
    // Auto-flush after the grace window. The setTimeout is not stored
    // on the store because it'd add a non-serializable handle; cancel /
    // flush short-circuit it instead.
    const expiresAt = Date.now() + expiresInMs;
    set({ pendingUndo: { label, expiresAt, snapshot, commit } });
    setTimeout(async () => {
      const cur = useUI.getState().pendingUndo;
      // Bail if user already cancelled (cur=null) or staged a different
      // action (cur.expiresAt differs).
      if (!cur || cur.expiresAt !== expiresAt) return;
      try {
        await cur.commit();
      } finally {
        if (useUI.getState().pendingUndo?.expiresAt === expiresAt) {
          set({ pendingUndo: null });
        }
      }
    }, expiresInMs + 50);
  },
  cancelPendingUndo: () =>
    set((s) => {
      const undo = s.pendingUndo;
      if (!undo) return {};
      // Restore the snapshot — re-add the deleted nodes + edges.
      const existingIds = new Set(s.nodes.map((n) => n.id));
      const restoredNodes = [...s.nodes, ...undo.snapshot.nodes.filter((n) => !existingIds.has(n.id))];
      const existingEdgeIds = new Set(s.edges.map((e) => e.id));
      const restoredEdges = [...s.edges, ...undo.snapshot.edges.filter((e) => !existingEdgeIds.has(e.id))];
      return { pendingUndo: null, nodes: restoredNodes, edges: restoredEdges };
    }),
  flushPendingUndo: async () => {
    const cur = useUI.getState().pendingUndo;
    if (!cur) return;
    set({ pendingUndo: null });
    try {
      await cur.commit();
    } catch (e) {
      console.error("flushPendingUndo failed", e);
      useUI.getState().showError(
        `Action failed: ${(e as Error).message || "unknown error"}`
      );
    }
  },
  showError: (message, ttlMs = 6000) => {
    const expiresAt = Date.now() + ttlMs;
    set({ errorToast: { message, expiresAt } });
    setTimeout(() => {
      const cur = useUI.getState().errorToast;
      if (cur && cur.expiresAt === expiresAt) set({ errorToast: null });
    }, ttlMs + 50);
  },
  dismissError: () => set({ errorToast: null }),
}));
