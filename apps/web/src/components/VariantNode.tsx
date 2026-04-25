import { Handle, Position, type NodeProps } from "reactflow";
import clsx from "clsx";
import type { NodeDTO } from "@/lib/api";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";
import {
  GitFork,
  Eye,
  CircleDot,
  Anchor,
  Wand2,
  Download,
  Columns,
} from "lucide-react";

export type VariantNodeData = {
  node: NodeDTO;
};

const typeStyles: Record<string, string> = {
  seed: "ring-blue-300 bg-blue-50",
  variant: "ring-amber-500/40 bg-white",
  feedback: "ring-rose-500/40 bg-rose-50",
  critic: "ring-emerald-300 bg-emerald-50",
  pipeline: "ring-purple-300 bg-purple-50",
  live: "ring-cyan-300 bg-cyan-50",
  code: "ring-slate-300 bg-slate-50",
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
    openExport,
    setCompareA,
    setCompareB,
    compare,
    openViewer,
    setTree,
    setSelected,
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
      onClick={() => setSelected(node.id)}
      className={clsx(
        "relative w-[260px] rounded-xl ring-1 shadow-lg transition text-zinc-900 overflow-hidden",
        typeStyles[node.type] || "ring-zinc-700 bg-white",
        selected && "ring-2 ring-amber-400",
        (isA || isB) && "ring-2 ring-cyan-400",
        isCheckpoint && "ring-2 ring-fuchsia-400"
      )}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />

      {/* Live thumbnail iframe (sandboxed) */}
      <div className="relative h-[140px] bg-stone-50 border-b border-zinc-200 overflow-hidden">
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
        <div className="absolute top-1.5 left-1.5 rounded-md bg-zinc-900/40 text-[10px] uppercase tracking-wide px-1.5 py-0.5 text-zinc-700">
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
          <p className="text-[11px] text-zinc-500 leading-snug line-clamp-2">{node.summary}</p>
        )}
        {node.model_used && (
          <div className="text-[10px] text-zinc-500 font-mono">{node.model_used}</div>
        )}

        {/* Action buttons. Six total — Fork is the prominent primary, the
            other five are icon-only with hover tooltips so they all fit a
            260px card without truncation. Compare is special-cased when
            it's already in the A/B selection so the label tells the user
            what to click next. */}
        <div className="flex items-center gap-1 pt-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              openFork(node.id);
            }}
            disabled={node.build_status !== "ready"}
            title="Fork this variant — type a prompt and Claude rewrites the HTML"
            className="flex-1 flex items-center justify-center gap-1 text-[11px] px-2 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-40"
          >
            <GitFork className="w-3 h-3" /> Fork
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isA || isB) {
                setCompareA(node.id);
                setCompareB(null);
              } else if (!compare.a) {
                setCompareA(node.id);
              } else if (!compare.b) {
                setCompareB(node.id);
                openViewer();
              } else {
                setCompareB(node.id);
                openViewer();
              }
            }}
            title={
              isA
                ? "Pinned as A — click another node to open split compare"
                : isB
                ? "Pinned as B — click another node to re-pin"
                : !compare.a
                ? "Step 1 of compare: pin as A"
                : "Step 2 of compare: pin as B and open split viewer"
            }
            className={clsx(
              "flex items-center gap-1 text-[11px] px-2 py-1 rounded font-medium",
              isA || isB
                ? "bg-cyan-500 text-white"
                : compare.a
                ? "bg-cyan-100 hover:bg-cyan-200 text-cyan-700"
                : "bg-cyan-100 hover:bg-cyan-200 text-cyan-700"
            )}
          >
            <Columns className="w-3 h-3" />
            {isA ? "A — pick B" : isB ? "B — pick A" : compare.a ? "B" : "Compare"}
          </button>
        </div>

        {/* Secondary actions — icon-only with tooltips, all five fit in a
            single 260px row. */}
        <div className="flex items-center gap-1 pt-1">
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              openMedia(node.id);
            }}
            disabled={node.build_status !== "ready"}
            title="Generate hero media (MiniMax image/video, then Claude weaves it in)"
            tone="fuchsia"
          >
            <Wand2 className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            onClick={setAsCheckpoint}
            disabled={isCheckpoint}
            title={
              isCheckpoint
                ? "This is the active checkpoint — older history is archived"
                : "Set as checkpoint — archive older history, make this the new working head"
            }
            tone="fuchsia"
            active={isCheckpoint}
          >
            <Anchor className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            onClick={(e) => {
              e.stopPropagation();
              openExport(node.id);
            }}
            disabled={node.build_status !== "ready"}
            title="Export — copy the HTML or download .zip with all media"
            tone="amber"
          >
            <Download className="w-3.5 h-3.5" />
          </IconButton>
          {node.sandbox_url && (
            <a
              href={node.sandbox_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open the rendered page in a new tab"
              className="flex items-center justify-center w-7 h-7 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-600 ml-auto"
            >
              <Eye className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
  tone,
  active,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title: string;
  tone: "fuchsia" | "amber";
  active?: boolean;
}) {
  const colors = active
    ? "bg-fuchsia-300 text-fuchsia-800 cursor-default"
    : tone === "fuchsia"
    ? "bg-fuchsia-100 hover:bg-fuchsia-200 text-fuchsia-700"
    : "bg-amber-100 hover:bg-amber-200 text-amber-700";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        "flex items-center justify-center w-7 h-7 rounded disabled:opacity-40",
        colors
      )}
    >
      {children}
    </button>
  );
}
