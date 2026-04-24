import { useEffect, useState } from "react";
import { X, Loader2, Globe } from "lucide-react";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";

export default function NewProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { setTree } = useUI();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setUrl("");
      setError(null);
      setRunning(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    if (!name.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const project = await api.createProject(name.trim(), url.trim() || undefined);
      const tree = await api.getTree(project.id);
      setTree(tree.project as any, tree.nodes, tree.edges);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to create project");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-medium">New project</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Landing page polish"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              disabled={running}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">
              Seed URL <span className="text-zinc-600">(optional — leave blank for a hello-world seed)</span>
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              type="url"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              disabled={running}
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Playwright will capture the live page and inline its assets. Heavy analytics scripts are stripped.
            </p>
          </div>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-zinc-800 bg-zinc-950/60">
          <button
            onClick={onClose}
            disabled={running}
            className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={running || !name.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-50"
          >
            {running && <Loader2 className="w-4 h-4 animate-spin" />}
            {running ? "Fetching…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
