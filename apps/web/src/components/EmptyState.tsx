import { Palette, MousePointerClick } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type ProjectDTO } from "@/lib/api";
import { useUI } from "@/lib/store";

export default function EmptyState({ onNewProject }: { onNewProject: () => void }) {
  const { setTree } = useUI();
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  async function open(p: ProjectDTO) {
    const tree = await api.getTree(p.id);
    setTree(tree.project as any, tree.nodes, tree.edges);
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-300">
      <div className="max-w-xl w-full space-y-8 p-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 text-amber-400">
            <Palette className="w-8 h-8" />
            <span className="text-2xl font-semibold tracking-tight">Atelier</span>
          </div>
          <p className="text-sm text-zinc-500">
            An infinite canvas for iterative frontend craft. Seed a URL, fork a variant, compare before/after.
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
          <div>
            <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Recent projects</h3>
            <div className="space-y-1">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => open(p)}
                  className="w-full text-left flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600"
                >
                  <div>
                    <div className="text-sm text-zinc-100 font-medium">{p.name}</div>
                    {p.seed_url && (
                      <div className="text-[11px] text-zinc-500 font-mono truncate">{p.seed_url}</div>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {(p.created_at ?? "").slice(0, 19).replace("T", " ")}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
