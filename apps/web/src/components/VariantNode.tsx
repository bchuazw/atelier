import { useEffect, useState } from "react";
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
  Trash2,
  RotateCw,
  Pencil,
  Share2,
  Check,
  Link2,
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

  // Inline rename state — same pattern as project name in TopBar.
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(node.title || "");
  useEffect(() => {
    setDraftTitle(node.title || "");
  }, [node.title]);

  // One-click share. The Export dialog already exposes a Publish + Copy URL
  // flow, but it takes 3 clicks to share with a stakeholder. This button
  // collapses publish-if-needed → copy URL → toast into one tap right on
  // the card. Fetches the existing published state on mount so a previously
  // shared variant shows the filled icon immediately.
  type SharedState = { slug: string; public_url: string; published_at: string };
  const [shared, setShared] = useState<SharedState | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    if (node.type === "seed" || node.build_status !== "ready") return;
    api
      .getPublishedState(node.id)
      .then((s) => {
        if (alive) setShared(s);
      })
      .catch(() => {
        // best-effort — never block the card on a publish-state lookup
      });
    return () => {
      alive = false;
    };
  }, [node.id, node.type, node.build_status]);

  async function shareVariant(e: React.MouseEvent) {
    e.stopPropagation();
    if (sharing) return;
    setSharing(true);
    try {
      const state = shared || (await api.publishNode(node.id));
      if (!shared) setShared(state);
      await navigator.clipboard.writeText(state.public_url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch (err) {
      useUI
        .getState()
        .showError(`Couldn't share variant: ${(err as Error).message}`);
    } finally {
      setSharing(false);
    }
  }

  async function setAsCheckpoint(e: React.MouseEvent) {
    e.stopPropagation();
    if (!project) return;
    const ok = await useUI.getState().showConfirm({
      title: "Set as checkpoint?",
      message:
        `"${node.title || "this node"}" will become the new working head. ` +
        `Older siblings and ancestors are archived (still in the DB) to keep the canvas fast. ` +
        `You can undo this from the top bar.`,
      confirmLabel: "Set checkpoint",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    await api.patchProject(project.id, { active_checkpoint_id: node.id });
    const tree = await api.getTree(project.id, includeArchived);
    setTree(tree.project, tree.nodes, tree.edges);
  }

  async function commitRename() {
    const next = draftTitle.trim();
    setRenaming(false);
    if (!next || next === (node.title || "")) {
      setDraftTitle(node.title || "");
      return;
    }
    try {
      await api.patchNode(node.id, { title: next });
      // Optimistic update: rewrite the node in the store so the rename
      // shows up instantly without a tree refresh.
      useUI.getState().upsertNode({ ...node, title: next });
    } catch (e) {
      useUI.getState().showError(`Rename failed: ${(e as Error).message}`);
      setDraftTitle(node.title || "");
    }
  }

  function deleteVariant(e: React.MouseEvent) {
    e.stopPropagation();
    if (!project) return;
    const ui = useUI.getState();

    // Walk the descendant subtree locally so we know what would be
    // removed — both for the snapshot (Undo restores all of it) and the
    // optimistic local prune (the canvas updates instantly).
    const allNodes = ui.nodes;
    const allEdges = ui.edges;
    const toRemoveIds = new Set<string>([node.id]);
    let frontier: string[] = [node.id];
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const child of allNodes) {
          if (child.parent_id === id && !toRemoveIds.has(child.id)) {
            toRemoveIds.add(child.id);
            next.push(child.id);
          }
        }
      }
      frontier = next;
    }
    const removedNodes = allNodes.filter((n) => toRemoveIds.has(n.id));
    const removedEdges = allEdges.filter(
      (e) => toRemoveIds.has(e.from) || toRemoveIds.has(e.to)
    );

    // Optimistic prune: drop nodes/edges from the store now. Store the
    // snapshot inside the pendingUndo entry so cancelPendingUndo can
    // restore them.
    useUI.setState({
      nodes: allNodes.filter((n) => !toRemoveIds.has(n.id)),
      edges: allEdges.filter(
        (e) => !toRemoveIds.has(e.from) && !toRemoveIds.has(e.to)
      ),
    });

    const count = removedNodes.length;
    const label =
      count === 1
        ? `Deleted "${node.title || "variant"}"`
        : `Deleted "${node.title || "variant"}" + ${count - 1} descendant${count === 2 ? "" : "s"}`;

    ui.stagePendingUndo({
      label,
      snapshot: { nodes: removedNodes, edges: removedEdges },
      commit: async () => {
        try {
          await api.deleteNode(node.id);
        } catch (err) {
          // Server-side delete failed — restore optimistically so the
          // UI doesn't lie about state.
          useUI.getState().showError(
            `Couldn't delete on server: ${(err as Error).message}. The variant has been restored.`
          );
          if (project) {
            const tree = await api.getTree(project.id, includeArchived);
            setTree(tree.project, tree.nodes, tree.edges);
          }
        }
      },
    });
  }

  function reRun(e: React.MouseEvent) {
    // "Re-run" opens the Fork dialog rooted at this node's PARENT, with
    // the prompt prefilled from this node's reasoning. Model can be
    // swapped in the dialog. Useful for "I liked this prompt — try it
    // on Opus" without retyping.
    e.stopPropagation();
    const parentId = node.parent_id;
    const prompt = node.reasoning?.prompt || "";
    if (!parentId) return; // seed has no parent — Re-run not applicable
    // Stash the prefilled prompt on the store so ForkDialog can pick it up.
    useUI.getState().setForkPrefill(prompt);
    openFork(parentId);
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
            sandbox="allow-scripts"
            loading="lazy"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
            <CircleDot className={clsx("w-4 h-4 mr-1", statusColor[node.build_status])} />
            {node.build_status}
          </div>
        )}
        {/* Suppress the type chip when the card is also showing a CHECKPOINT
            or A/B Compare badge — a senior designer flagged that two
            simultaneous coloured tags read as duelling selection states. */}
        {!isCheckpoint && !isA && !isB && (
          <div className="absolute top-1.5 left-1.5 rounded-md bg-zinc-900/40 text-[10px] uppercase tracking-wide px-1.5 py-0.5 text-zinc-700">
            {node.type}
          </div>
        )}
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
        {renaming ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraftTitle(node.title || "");
                setRenaming(false);
              }
            }}
            maxLength={120}
            className="w-full text-[13px] font-medium leading-tight px-1.5 py-0.5 rounded border border-amber-400 bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
        ) : (
          <div
            className="text-[13px] font-medium leading-tight group/title"
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (node.type !== "seed") setRenaming(true);
            }}
            title={node.type === "seed" ? node.title || "Untitled" : "Double-click to rename"}
          >
            <span className="line-clamp-2 break-words">
              {node.title || "Untitled"}
            </span>
          </div>
        )}

        {/* Genspark provenance: when this variant was applied from a
            grounded critic run, show small citation chips so designers
            can audit "where did this idea come from". Only visible when
            references are present — keeps non-grounded variants clean. */}
        {node.reasoning?.references && node.reasoning.references.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {node.reasoning.references.slice(0, 3).map((r) => {
              let host = r.url;
              try {
                host = new URL(r.url).hostname.replace(/^www\./, "");
              } catch {}
              return (
                <a
                  key={r.url}
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={r.title || r.url}
                  className="inline-flex items-center text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-50 border border-cyan-200 text-cyan-700 hover:border-cyan-400 max-w-[100px] truncate"
                >
                  {host}
                </a>
              );
            })}
          </div>
        )}
        {node.summary && (
          <p className="text-[11px] text-zinc-500 leading-snug line-clamp-2">{node.summary}</p>
        )}
        {node.model_used && (
          <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500 font-mono">
            <span className="truncate">{node.model_used}</span>
            <VariantCostPill usage={node.token_usage} model={node.model_used} />
          </div>
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
            className="flex-1 flex items-center justify-center gap-1 text-[12px] px-2 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-40"
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
              "flex items-center gap-1 text-[12px] px-2 py-1.5 rounded font-medium",
              isA || isB
                ? "bg-cyan-500 text-white"
                : compare.a
                ? "bg-cyan-100 hover:bg-cyan-200 text-cyan-700"
                : "bg-cyan-100 hover:bg-cyan-200 text-cyan-700"
            )}
          >
            <Columns className="w-3 h-3" />
            {isA
              ? "A — pick B"
              : isB
              ? "B — pick A"
              : compare.a
              ? "Pick as B"
              : "Compare"}
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
          {/* Seeds aren't standalone HTML pages worth sharing publicly — only
              variants get the share button. Skipping it on seeds also avoids
              creating an orphan published-tree directory if a user clicks it
              before forking anything. */}
          {node.type !== "seed" && (
            <button
              onClick={shareVariant}
              disabled={node.build_status !== "ready" || sharing}
              title={
                shareCopied
                  ? "Public URL copied!"
                  : shared
                  ? `Shared at ${shared.public_url} — click to copy`
                  : "Publish a public URL and copy it (one-click share)"
              }
              aria-label={shared ? "Copy shared URL" : "Publish and share"}
              className={clsx(
                "flex items-center justify-center w-7 h-7 rounded disabled:opacity-40 transition-colors",
                shareCopied
                  ? "bg-emerald-100 text-emerald-700"
                  : shared
                  ? "bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
                  : "bg-zinc-50 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              )}
            >
              {shareCopied ? (
                <Check className="w-3.5 h-3.5" />
              ) : shared ? (
                <Link2 className="w-3.5 h-3.5" />
              ) : (
                <Share2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          {node.sandbox_url && (
            <a
              href={node.sandbox_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open the rendered page in a new tab"
              aria-label="Open the rendered page in a new tab"
              className="flex items-center justify-center w-7 h-7 rounded bg-zinc-50 hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900 ml-auto"
            >
              <Eye className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Tertiary CRUD row — variant-only. Hidden on the seed since
            "rename / delete / re-run" don't apply: seed renames via the
            project-level rename, deletes via project delete, and has no
            parent prompt to re-run. */}
        {node.type !== "seed" && (
          <div className="flex items-center gap-1 pt-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRenaming(true);
              }}
              title="Rename this variant"
              aria-label="Rename this variant"
              className="flex items-center justify-center w-7 h-7 rounded bg-zinc-50 hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900"
            >
              <Pencil className="w-3 h-3" />
            </button>
            {node.reasoning?.prompt && node.parent_id && (
              <button
                onClick={reRun}
                title={`Re-run with same prompt (${(node.reasoning.prompt || "").slice(0, 80)}…) — model can be swapped`}
                aria-label="Re-run with the same prompt"
                className="flex items-center justify-center w-7 h-7 rounded bg-zinc-50 hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900"
              >
                <RotateCw className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={deleteVariant}
              title="Delete this variant + every child branch under it"
              aria-label="Delete this variant"
              className="flex items-center justify-center w-7 h-7 rounded bg-zinc-50 hover:bg-rose-100 hover:text-rose-600 text-zinc-600 ml-auto"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Secondary card actions are visually unified — neutral ghost buttons with
// a single accent reserved for the *active* state (checkpoint pinned).
// Earlier the row had a purple wand, purple anchor, and orange download
// side-by-side which a senior designer flagged as "color soup with no
// system." The icon itself conveys what the button does; color reserved
// for state, not category.
function IconButton({
  children,
  onClick,
  disabled,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  title: string;
  // Kept on the type so existing callers compile without churn; visual
  // treatment no longer differs by tone.
  tone?: "fuchsia" | "amber";
  active?: boolean;
}) {
  const colors = active
    ? "bg-fuchsia-200 text-fuchsia-800 cursor-default"
    : "bg-zinc-50 hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={clsx(
        "flex items-center justify-center w-7 h-7 rounded disabled:opacity-40",
        colors
      )}
    >
      {children}
    </button>
  );
}

/**
 * Per-variant cost pill. Estimates USD using the model the variant was
 * actually generated with so users see "Opus = expensive" intuitively
 * (Haiku at $0.25/$1.25 vs Sonnet at $3/$15 vs Opus at $15/$75 per 1M).
 */
function VariantCostPill({
  usage,
  model,
}: {
  usage: NodeDTO["token_usage"];
  model: string | null;
}) {
  if (!usage) return null;
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheRead = usage.cache_read ?? 0;
  const cacheCreate = usage.cache_creation ?? 0;
  if (input + output + cacheRead + cacheCreate === 0) return null;
  // Per-1M pricing (USD) — read from the model id so cost reflects what
  // the user actually picked. Defaults to Sonnet rates when unknown.
  const m = (model || "").toLowerCase();
  const tier =
    m.includes("haiku")
      ? { i: 0.25, o: 1.25, cr: 0.025, cw: 0.3 }
      : m.includes("opus")
      ? { i: 15, o: 75, cr: 1.5, cw: 18.75 }
      : { i: 3, o: 15, cr: 0.3, cw: 3.75 };
  const cost =
    (input * tier.i + output * tier.o + cacheRead * tier.cr + cacheCreate * tier.cw) / 1_000_000;
  if (cost < 0.0001) return null;
  return (
    <span
      className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-mono font-medium flex-shrink-0"
      title={`Token usage:\n  input: ${input.toLocaleString()}\n  output: ${output.toLocaleString()}\n  cache read: ${cacheRead.toLocaleString()}\n  cache write: ${cacheCreate.toLocaleString()}\n\nCost estimate uses the actual model's list pricing (Haiku/Sonnet/Opus).`}
    >
      ~${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}
    </span>
  );
}
