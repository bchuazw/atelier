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

  // Global keyboard shortcuts. Only fire when no input/textarea is focused
  // and no modal is open — we don't want "F" to also typed-into the
  // PromptBar textarea or interrupt typing in any dialog.
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
      } else if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        // Show a quick tooltip-style alert with available shortcuts
        alert(
          "Atelier keyboard shortcuts\n\n" +
            "F — Fork the targeted node\n" +
            "C — Critics on the targeted node\n" +
            "B — Feedback (paste-stakeholder) on the targeted node\n" +
            "V — open the split Compare viewer (when both A and B are pinned)\n" +
            "N — New project\n" +
            "? — show this help\n\n" +
            "Inside the Compare viewer:\n" +
            "S — Side by side · D — Split · O — Overlay\n" +
            "1 — Desktop · 2 — Tablet · 3 — Mobile\n" +
            "Esc — close"
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project]);

  return (
    <div className="flex flex-col h-full w-full bg-stone-50 text-zinc-900">
      <TopBar onNewProject={() => setNewProjectOpen(true)} />

      {statusWarning && (
        <div className="px-4 py-1.5 bg-rose-100 border-b border-rose-300 text-[12px] text-rose-600">
          {statusWarning}
        </div>
      )}

      <div className="flex-1 relative">
        <ErrorBoundary>
          {project ? <Canvas /> : <EmptyState onNewProject={() => setNewProjectOpen(true)} />}
        </ErrorBoundary>
        {project && <PromptBar />}
      </div>

      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      <ForkDialog />
      <MediaDialog />
      <MergeDialog />
      <FeedbackDialog />
      <CriticsDialog />
      <ExportDialog />
      <BeforeAfterViewer />
      <ContextPanel />
    </div>
  );
}
