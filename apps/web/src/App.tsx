import { useEffect, useState } from "react";
import Canvas from "./components/Canvas";
import TopBar from "./components/TopBar";
import ForkDialog from "./components/ForkDialog";
import MediaDialog from "./components/MediaDialog";
import BeforeAfterViewer from "./components/BeforeAfterViewer";
import NewProjectDialog from "./components/NewProjectDialog";
import EmptyState from "./components/EmptyState";
import ContextPanel from "./components/ContextPanel";
import ErrorBoundary from "./components/ErrorBoundary";
import MergeDialog from "./components/MergeDialog";
import PromptBar from "./components/PromptBar";
import FeedbackDialog from "./components/FeedbackDialog";
import CriticsDialog from "./components/CriticsDialog";
import ExportDialog from "./components/ExportDialog";
import UndoToast from "./components/UndoToast";
import ErrorToast from "./components/ErrorToast";
import { useUI } from "./lib/store";
import { api } from "./lib/api";

export default function App() {
  const { project } = useUI();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [statusWarning, setStatusWarning] = useState<string | null>(null);

  useEffect(() => {
    api
      .getStatus()
      .then((s) => {
        if (!s.has_api_key) {
          setStatusWarning(
            "No ANTHROPIC_API_KEY configured. Forking will fail until you set one in .env.local (or via POST /api/v1/settings/api-key)."
          );
        }
      })
      .catch(() => {
        setStatusWarning(
          "Backend not reachable. The API service may be waking from a cold start — try again in 20-30s."
        );
      });
  }, []);

  // Global keyboard shortcuts. Require Shift on letter keys so a stray
  // bare-letter keystroke while panning the canvas can't open dialogs
  // back-to-back (a designer ran into this, pressing C/F/B in rapid
  // succession opened multiple modals chained on top of each other).
  // Also skip when an input/textarea is focused or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const ui = useUI.getState();
      const anyDialogOpen =
        ui.forkDialogOpen ||
        ui.mediaDialogOpen ||
        !!ui.mergeDialog ||
        ui.feedbackDialogOpen ||
        ui.criticsDialogOpen ||
        ui.exportDialogOpen ||
        ui.viewerOpen ||
        ui.contextPanelOpen;
      if (anyDialogOpen) return;
      if (!project) return;

      const targetId =
        ui.selectedNodeId ||
        project.active_checkpoint_id ||
        project.working_node_id ||
        ui.nodes[ui.nodes.length - 1]?.id ||
        null;

      // Help is the one shortcut that fires bare (Shift+/) since `?` is
      // the universal "what can I do" key.
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        alert(
          "Atelier keyboard shortcuts\n\n" +
            "Shift+F — Fork the targeted node\n" +
            "Shift+C — Critics on the targeted node\n" +
            "Shift+B — Feedback (paste-stakeholder) on the targeted node\n" +
            "Shift+V — open the split Compare viewer (when both A and B are pinned)\n" +
            "Shift+N — New project\n" +
            "Shift+T — Tidy (auto-arrange the tree)\n" +
            "? — show this help\n\n" +
            "Inside the Compare viewer:\n" +
            "S — Side by side · D — Split · O — Overlay\n" +
            "1 — Desktop · 2 — Tablet · 3 — Mobile\n" +
            "Esc — close"
        );
        return;
      }

      // Bare Esc exits Compare mode if it's active and no dialog is open.
      // A fresh-user tester reported feeling "stuck" in compare with no
      // obvious exit; the exit buttons exist but Esc is the natural reach.
      if (e.key === "Escape" && (ui.compare.a || ui.compare.b)) {
        e.preventDefault();
        ui.setCompareA(null);
        ui.setCompareB(null);
        return;
      }

      // App-level shortcuts: Shift + <letter>. Anything bare just falls
      // through to React Flow's own handling (panning, zoom, etc.).
      if (!e.shiftKey) return;
      const lower = e.key.toLowerCase();
      if (lower === "f" && targetId) {
        e.preventDefault();
        ui.openFork(targetId);
      } else if (lower === "c" && targetId) {
        e.preventDefault();
        ui.openCritics(targetId);
      } else if (lower === "b" && targetId) {
        e.preventDefault();
        ui.openFeedback(targetId);
      } else if (lower === "v" && ui.compare.a && ui.compare.b) {
        e.preventDefault();
        ui.openViewer();
      } else if (lower === "n") {
        e.preventDefault();
        setNewProjectOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project]);

  return (
    <div className="flex flex-col h-full w-full bg-stone-50 text-zinc-900">
      <header role="banner">
        <TopBar onNewProject={() => setNewProjectOpen(true)} />
      </header>

      {statusWarning && (
        <div role="alert" className="px-4 py-1.5 bg-rose-100 border-b border-rose-300 text-[12px] text-rose-700">
          {statusWarning}
        </div>
      )}

      <main className="flex-1 relative" aria-label="Canvas">
        <ErrorBoundary>
          {project ? <Canvas /> : <EmptyState onNewProject={() => setNewProjectOpen(true)} />}
        </ErrorBoundary>
        {project && <PromptBar />}
      </main>

      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      <ForkDialog />
      <MediaDialog />
      <MergeDialog />
      <FeedbackDialog />
      <CriticsDialog />
      <ExportDialog />
      <BeforeAfterViewer />
      <ContextPanel />
      <UndoToast />
      <ErrorToast />
    </div>
  );
}
