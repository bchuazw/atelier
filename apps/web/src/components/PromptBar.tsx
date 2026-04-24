import { useMemo, useState } from "react";
import { Sparkles, Loader2, Target, ChevronUp, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";
import ModelPicker from "./ModelPicker";

const QUICK_CHIPS = [
  "make it warmer and more playful",
  "bolder headline, larger CTA",
  "cleaner, more minimalist spacing",
  "swap to a serif heading",
  "asymmetric layout — text left, visual right",
];

export default function PromptBar() {
  const {
    project,
    nodes,
    selectedNodeId,
    includeArchived,
    preferredModel,
    setPreferredModel,
    // A dialog is considered open whenever any modal state flag is true —
    // hide the PromptBar behind them so keystrokes and clicks don't leak
    // through, and the bottom UI doesn't overlap modal footers.
    forkDialogOpen,
    mediaDialogOpen,
    mergeDialog,
    feedbackDialogOpen,
    criticsDialogOpen,
    exportDialogOpen,
    viewerOpen,
    contextPanelOpen,
  } = useUI();

  const anyModalOpen =
    forkDialogOpen ||
    mediaDialogOpen ||
    !!mergeDialog ||
    feedbackDialogOpen ||
    criticsDialogOpen ||
    exportDialogOpen ||
    viewerOpen ||
    contextPanelOpen;
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Determine the target node: selected > checkpoint > working > most recent variant > seed.
  const target = useMemo(() => {
    if (selectedNodeId) return nodes.find((n) => n.id === selectedNodeId) || null;
    const checkpointId = project?.active_checkpoint_id;
    if (checkpointId) return nodes.find((n) => n.id === checkpointId) || null;
    if (project?.working_node_id) {
      return nodes.find((n) => n.id === project.working_node_id) || null;
    }
    if (nodes.length === 0) return null;
    return nodes[nodes.length - 1];
  }, [selectedNodeId, nodes, project]);

  if (!project) return null;

  async function submit() {
    if (!target || !prompt.trim()) return;
    setRunning(true);
    setError(null);
    try {
      await api.fork(target.id, prompt.trim(), preferredModel, 1, false);
      const tree = await api.getTree(project!.id, includeArchived);
      useUI.getState().setTree(tree.project, tree.nodes, tree.edges);
      setPrompt("");
    } catch (e: any) {
      setError(e?.message || "Fork failed");
    } finally {
      setRunning(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div
      className={clsx(
        "absolute left-1/2 bottom-4 -translate-x-1/2 z-30 w-[min(720px,calc(100%-32px))] transition-opacity duration-150",
        anyModalOpen && "opacity-0 pointer-events-none"
      )}
      aria-hidden={anyModalOpen}
    >
      <div className="bg-stone-50/90 backdrop-blur border border-zinc-200 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-3 pt-2 pb-1.5 text-[11px] gap-2">
          <div className="flex items-center gap-1.5 text-zinc-500 min-w-0">
            <Target className="w-3 h-3 flex-shrink-0" />
            <span>Targeting:</span>
            <span
              className={clsx(
                "font-medium truncate max-w-[200px]",
                target ? "text-amber-600" : "text-zinc-400"
              )}
            >
              {target?.title || "— pick a node or click the canvas"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ModelPicker value={preferredModel} onChange={setPreferredModel} compact />
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-zinc-500 hover:text-zinc-800"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="p-2 pt-0">
            <div className="flex items-end gap-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onKey}
                rows={2}
                placeholder={
                  target
                    ? `Ask Atelier to change "${target.title?.slice(0, 40) || "this node"}"… (Enter to send)`
                    : "Click a node on the canvas first, then type what to change"
                }
                className="flex-1 resize-none bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                disabled={running || !target}
              />
              <button
                onClick={submit}
                disabled={running || !target || !prompt.trim()}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-40"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Fork
              </button>
            </div>

            <div className="flex flex-wrap gap-1 mt-2 px-0.5">
              {QUICK_CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => setPrompt(c)}
                  disabled={running || !target}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 hover:border-zinc-400 disabled:opacity-40"
                >
                  {c}
                </button>
              ))}
            </div>

            {error && (
              <div className="mt-2 text-[11px] text-rose-400 bg-rose-50 border border-rose-300 rounded px-2 py-1">
                {error}
              </div>
            )}

            <div className="mt-2 px-0.5 text-[10px] text-zinc-400">
              Tip: drag any node onto another to combine their styles with Opus.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
