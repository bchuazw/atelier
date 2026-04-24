import { useEffect, useState } from "react";
import Canvas from "./components/Canvas";
import TopBar from "./components/TopBar";
import ForkDialog from "./components/ForkDialog";
import MediaDialog from "./components/MediaDialog";
import BeforeAfterViewer from "./components/BeforeAfterViewer";
import NewProjectDialog from "./components/NewProjectDialog";
import EmptyState from "./components/EmptyState";
import ContextPanel from "./components/ContextPanel";
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
            "No ANTHROPIC_API_KEY configured. Forking will fail until you set one in .env.local."
          );
        }
      })
      .catch(() => {
        setStatusWarning("Backend not reachable on :8000. Start `atelier-api`.");
      });
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-zinc-950 text-zinc-100">
      <TopBar onNewProject={() => setNewProjectOpen(true)} />

      {statusWarning && (
        <div className="px-4 py-1.5 bg-rose-950/60 border-b border-rose-900 text-[12px] text-rose-300">
          {statusWarning}
        </div>
      )}

      <div className="flex-1 relative">
        {project ? <Canvas /> : <EmptyState onNewProject={() => setNewProjectOpen(true)} />}
      </div>

      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      <ForkDialog />
      <MediaDialog />
      <BeforeAfterViewer />
      <ContextPanel />
    </div>
  );
}
