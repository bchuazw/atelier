import { Palette, MousePointerClick, Trash2, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type ProjectDTO } from "@/lib/api";
import { useUI } from "@/lib/store";

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 19).replace("T", " ");
  const seconds = Math.max(0, (Date.now() - t) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

export default function EmptyState({ onNewProject }: { onNewProject: () => void }) {
  const { setTree } = useUI();
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const list = await api.listProjects();
      setProjects(list);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function open(p: ProjectDTO) {
    const tree = await api.getTree(p.id);
    setTree(tree.project as any, tree.nodes, tree.edges);
  }

  async function deleteFromList(p: ProjectDTO) {
    if (!confirm(`Delete project "${p.name}"? This removes all variants and assets.`)) return;
    setBusyId(p.id);
    try {
      await api.deleteProject(p.id);
      setProjects((prev) => prev.filter((q) => q.id !== p.id));
    } catch (e) {
      useUI.getState().showError(`Failed to delete: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-stone-50 text-zinc-700">
      <div className="max-w-xl w-full space-y-8 p-8">
        <div className="text-center space-y-2">
          <h1 className="inline-flex items-center gap-2 text-amber-500 m-0">
            <Palette className="w-8 h-8" aria-hidden="true" />
            <span className="text-2xl font-semibold tracking-tight">Atelier</span>
          </h1>
          <p className="text-sm text-zinc-700 font-medium">
            Iterate on landing pages with AI — side by side, on a canvas.
          </p>
          <p className="text-[12px] text-zinc-600 max-w-md mx-auto">
            Drop in a page, ask for changes in plain English, and compare versions
            in a few clicks. Every change cites real references.
          </p>
        </div>

        <div className="flex justify-center">
          <button
            onClick={onNewProject}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-medium"
          >
            <MousePointerClick className="w-4 h-4" />
            Create a new project
          </button>
        </div>

        {!loading && projects.length > 0 && (
          <nav aria-label="Recent projects">
            <h2 className="text-xs uppercase tracking-wide text-zinc-600 mb-2">Recent projects</h2>
            <div className="space-y-1">
              {projects.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  busy={busyId === p.id}
                  onOpen={() => open(p)}
                  onDelete={() => deleteFromList(p)}
                />
              ))}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}

function ProjectRow({
  project: p,
  busy,
  onOpen,
  onDelete,
}: {
  project: ProjectDTO;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={
        "group w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white border border-zinc-200 hover:border-zinc-400 transition" +
        (busy ? " opacity-50 pointer-events-none" : "")
      }
    >
      <button onClick={onOpen} className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-sm text-zinc-900 font-medium truncate">{p.name}</div>
          {typeof p.node_count === "number" && p.node_count > 0 && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 font-medium">
              {p.node_count} {p.node_count === 1 ? "node" : "nodes"}
            </span>
          )}
        </div>
        {p.seed_url && (
          <div className="text-[11px] text-zinc-600 font-mono truncate">{p.seed_url}</div>
        )}
      </button>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-[11px] text-zinc-600">
          {formatRelative(p.last_activity || p.created_at || null)}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-zinc-500 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"
          title="Delete project"
          aria-label="Delete project"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
