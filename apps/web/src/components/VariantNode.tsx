import { Handle, Position, type NodeProps } from "reactflow";
import clsx from "clsx";
import type { NodeDTO } from "@/lib/api";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";
import { GitFork, Eye, Flag, CircleDot, Anchor, Wand2 } from "lucide-react";

export type VariantNodeData = {
  node: NodeDTO;
};

const typeStyles: Record<string, string> = {
  seed: "ring-blue-500/50 bg-blue-950/40",
  variant: "ring-amber-500/40 bg-zinc-900",
  feedback: "ring-rose-500/40 bg-rose-950/40",
  critic: "ring-emerald-500/40 bg-emerald-950/40",
  pipeline: "ring-purple-500/40 bg-purple-950/40",
  live: "ring-cyan-500/40 bg-cyan-950/40",
  code: "ring-slate-500/40 bg-slate-950/40",
};

const statusColor: Record<string, string> = {
  pending: "text-zinc-500",
  building: "text-amber-400 animate-pulse",
  ready: "text-emerald-400",
  error: "text-rose-400",
};

export default function VariantNode({ data, selected }: NodeProps<VariantNodeData>) {
  const { node } = data;
  const {
    project,
    openFork,
    openMedia,
    setCompareA,
    setCompareB,
    compare,
    openViewer,
    setTree,
    includeArchived,
  } = useUI();

  const isA = compare.a === node.id;
  const isB = compare.b === node.id;
  const isCheckpoint = !!node.is_checkpoint;

  async function setAsCheckpoint(e: React.MouseEvent) {
    e.stopPropagation();
    if (!project) return;
    if (
      !confirm(
        `Set "${node.title || "this node"}" as the checkpoint? Older siblings and ancestors will be archived (still in DB) to keep the canvas fast. You can undo from the top bar.`
      )
    )
      return;
    await api.patchProject(project.id, { active_checkpoint_id: node.id });
    const tree = await api.getTree(project.id, includeArchived);
    setTree(tree.project, tree.nodes, tree.edges);
  }

  return (
    <div
      className={clsx(
        "relative w-[260px] rounded-xl ring-1 shadow-lg transition text-zinc-100 overflow-hidden",
        typeStyles[node.type] || "ring-zinc-700 bg-zinc-900",
        selected && "ring-2 ring-amber-400",
        (isA || isB) && "ring-2 ring-cyan-400",
        isCheckpoint && "ring-2 ring-fuchsia-400"
      )}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />

      {/* Live thumbnail iframe (sandboxed) */}
      <div className="relative h-[140px] bg-zinc-950 border-b border-zinc-800 overflow-hidden">
        {node.sandbox_url ? (
          <iframe
            src={node.sandbox_url}
            className="absolute top-0 left-0 origin-top-left pointer-events-none"
            style={{
              width: "1280px",
              height: "800px",
              transform: "scale(0.2031)", // 260/1280
              transformOrigin: "top left",
            }}
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
            <CircleDot className={clsx("w-4 h-4 mr-1", statusColor[node.build_status])} />
            {node.build_status}
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 rounded-md bg-black/70 text-[10px] uppercase tracking-wide px-1.5 py-0.5 text-zinc-300">
          {node.type}
        </div>
        {isCheckpoint && (
          <div className="absolute top-1.5 right-1.5 rounded-md bg-fuchsia-500 text-[10px] font-bold tracking-wide px-1.5 py-0.5 text-black flex items-center gap-1">
            <Anchor className="w-3 h-3" /> CHECKPOINT
          </div>
        )}
        {(isA || isB) && !isCheckpoint && (
          <div className="absolute top-1.5 right-1.5 rounded-md bg-cyan-500 text-[10px] font-bold tracking-wide px-1.5 py-0.5 text-black">
            {isA ? "A" : "B"}
          </div>
        )}
      </div>

      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <span className="truncate">{node.title || "Untitled"}</span>
        </div>
        {node.summary && (
          <p className="text-[11px] text-zinc-400 leading-snug line-clamp-2">{node.summary}</p>
        )}
        {node.model_used && (
          <div className="text-[10px] text-zinc-500 font-mono">{node.model_used}</div>
        )}

        <div className="flex items-center gap-1 pt-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openFork(node.id);
            }}
            disabled={node.build_status !== "ready"}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-amber-600/20 hover:bg-amber-600/40 text-amber-200 disabled:opacity-40"
          >
            <GitFork className="w-3 h-3" /> Fork
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openMedia(node.id);
            }}
            disabled={node.build_status !== "ready"}
            title="Generate hero media (Claude → Genspark → Claude)"
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-fuchsia-600/20 hover:bg-fuchsia-600/40 text-fuchsia-200 disabled:opacity-40"
          >
            <Wand2 className="w-3 h-3" /> Hero
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!compare.a) setCompareA(node.id);
              else if (!compare.b && compare.a !== node.id) {
                setCompareB(node.id);
                openViewer();
              } else {
                setCompareA(node.id);
                setCompareB(null);
              }
            }}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-200"
          >
            <Flag className="w-3 h-3" /> Pin
          </button>
          <button
            onClick={setAsCheckpoint}
            title="Set as checkpoint — archive older history, make this the new working head"
            disabled={isCheckpoint}
            className={clsx(
              "flex items-center gap-1 text-[11px] px-2 py-1 rounded",
              isCheckpoint
                ? "bg-fuchsia-600/40 text-fuchsia-100 cursor-default"
                : "bg-fuchsia-600/20 hover:bg-fuchsia-600/40 text-fuchsia-200"
            )}
          >
            <Anchor className="w-3 h-3" /> {isCheckpoint ? "Head" : "Checkpoint"}
          </button>
          {node.sandbox_url && (
            <a
              href={node.sandbox_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-zinc-700/40 hover:bg-zinc-700/70 text-zinc-300 ml-auto"
            >
              <Eye className="w-3 h-3" /> Open
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
