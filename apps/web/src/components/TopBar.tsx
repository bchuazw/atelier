import { useEffect, useMemo, useState } from "react";
import {
  Palette,
  Plus,
  Trash2,
  RefreshCw,
  BookOpen,
  Anchor,
  ArchiveRestore,
  MessageSquareQuote,
  Gem,
  Columns,
  X,
} from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";

export default function TopBar({ onNewProject }: { onNewProject: () => void }) {
  const {
    project,
    setTree,
    openViewer,
    compare,
    setCompareA,
    setCompareB,
    nodes,
    selectedNodeId,
    openContextPanel,
    openFeedback,
    openCritics,
    includeArchived,
    setIncludeArchived,
    sessionUsage,
  } = useUI();

  const targetId = useMemo(() => {
    if (selectedNodeId) return selectedNodeId;
    if (project?.active_checkpoint_id) return project.active_checkpoint_id;
    if (project?.working_node_id) return project.working_node_id;
    return nodes[nodes.length - 1]?.id || null;
  }, [selectedNodeId, project, nodes]);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh(nextIncludeArchived = includeArchived) {
    if (!project) return;
    setRefreshing(true);
    try {
      const tree = await api.getTree(project.id, nextIncludeArchived);
      setTree(tree.project, tree.nodes, tree.edges);
    } finally {
      setRefreshing(false);
    }
  }

  async function del() {
    if (!project) return;
    if (!confirm(`Delete project "${project.name}"?`)) return;
    await api.deleteProject(project.id);
    setTree(null, [], []);
  }

  async function clearCheckpoint() {
    if (!project) return;
    await api.patchProject(project.id, { clear_checkpoint: true });
    setIncludeArchived(false);
    await refresh(false);
  }

  async function toggleArchived() {
    const next = !includeArchived;
    setIncludeArchived(next);
    await refresh(next);
  }

  const canCompare = compare.a && compare.b;
  const compareNodeA = compare.a ? nodes.find((n) => n.id === compare.a) : null;
  const compareNodeB = compare.b ? nodes.find((n) => n.id === compare.b) : null;
  const archivedCount = project?.archived_count ?? 0;
  const hasCheckpoint = !!project?.active_checkpoint_id;

  // Per-project lifetime cost chip. Always rendered when a project is loaded
  // so the user has a constant signal of what they've spent (Karim's
  // "no per-project rollup" callout). Color escalates as we approach the cap;
  // tooltip explains the math + where to set the cap.
  const projectCostCents = project?.total_cost_cents ?? 0;
  const projectCapCents = project?.cost_cap_cents ?? null;
  const projectCostUsd = projectCostCents / 100;
  // Cap-aware tone: green under 60% of cap, amber 60-90%, rose >=90%.
  // No cap -> stay neutral zinc so users don't read meaning into the color.
  const costRatio = projectCapCents && projectCapCents > 0 ? projectCostCents / projectCapCents : 0;
  const costTone =
    !projectCapCents
      ? "bg-zinc-100 text-zinc-600 border border-zinc-200"
      : costRatio >= 0.9
      ? "bg-rose-100 text-rose-700 border border-rose-300"
      : costRatio >= 0.6
      ? "bg-amber-100 text-amber-700 border border-amber-300"
      : "bg-emerald-50 text-emerald-700 border border-emerald-200";

  // Rough session-cost estimate using Sonnet-4.6 list pricing as the
  // weighted-average proxy ($3 / 1M input, $15 / 1M output, $0.30 / 1M cached
  // read, $3.75 / 1M cache-write). Genuine costs vary with model mix; this
  // is a "you've used roughly $X" indicator, not an invoice.
  const sessionCostUsd =
    (sessionUsage.input * 3 +
      sessionUsage.output * 15 +
      sessionUsage.cache_read * 0.3 +
      sessionUsage.cache_creation * 3.75) /
    1_000_000;

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 bg-stone-50 border-b border-zinc-200 h-12">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-semibold text-zinc-900">
            <Palette className="w-5 h-5 text-amber-400" />
            Atelier
          </div>
          <div className="w-px h-5 bg-zinc-100" />
          <div className="text-sm">
            {project ? (
              <ProjectNameInline name={project.name} projectId={project.id} seedUrl={project.seed_url} />
            ) : (
              <span className="text-zinc-500">No project loaded</span>
            )}
          </div>
          {project && (
            <div
              className={clsx(
                "text-[10px] font-mono font-medium px-2 py-0.5 rounded",
                costTone
              )}
              title={
                `Project lifetime cost: $${projectCostUsd.toFixed(2)}` +
                (projectCapCents
                  ? `\nCap: $${(projectCapCents / 100).toFixed(2)} (` +
                    `${Math.round(costRatio * 100)}% used)`
                  : "\nNo cap set.") +
                "\n\nTotal cost across this project (Haiku/Sonnet/Opus pricing). " +
                "Set a cap in Context Panel."
              }
            >
              ~${projectCostUsd.toFixed(2)}
              {projectCapCents ? (
                <span className="opacity-70"> / ${(projectCapCents / 100).toFixed(2)}</span>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm">
          <div className="text-[11px] text-zinc-500 mr-2">
            {nodes.length} {nodes.length === 1 ? "node" : "nodes"}
          </div>
          {sessionCostUsd > 0 && (
            <div
              className="text-[10px] text-zinc-500 font-mono px-2 py-0.5 rounded bg-zinc-100"
              title={
                `Session token usage:\n` +
                `  input: ${sessionUsage.input.toLocaleString()}\n` +
                `  output: ${sessionUsage.output.toLocaleString()}\n` +
                `  cache read: ${sessionUsage.cache_read.toLocaleString()}\n` +
                `  cache write: ${sessionUsage.cache_creation.toLocaleString()}\n\n` +
                `Estimate uses Sonnet-4.6 list pricing as a proxy. Actual cost depends on model mix.`
              }
            >
              ~${sessionCostUsd.toFixed(2)} this session
            </div>
          )}
          {canCompare && (
            <button
              onClick={openViewer}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-black font-medium text-xs"
            >
              Open Before/After
            </button>
          )}
          {project && (
            <>
              <button
                onClick={() => targetId && openFeedback(targetId)}
                disabled={!targetId}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-sky-100 hover:bg-sky-200 text-sky-700 text-xs disabled:opacity-50"
                title="Paste stakeholder feedback — AutoReason decomposes and you approve each change"
              >
                <MessageSquareQuote className="w-3.5 h-3.5" /> Feedback
              </button>
              <button
                onClick={() => targetId && openCritics(targetId)}
                disabled={!targetId}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs disabled:opacity-50"
                title="Spawn design critics — suggestions to push toward a chosen theme"
              >
                <Gem className="w-3.5 h-3.5" /> Critics
              </button>
              <button
                onClick={openContextPanel}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs"
                title="Edit project context — preferences the agent reads before every fork"
              >
                <BookOpen className="w-3.5 h-3.5" /> Context
                {project.context && project.context.length > 0 && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full bg-sky-400" />
                )}
              </button>
              <button
                onClick={() => refresh()}
                className={clsx("p-1.5 rounded hover:bg-zinc-100", refreshing && "animate-spin")}
                title="Refresh tree"
                aria-label="Refresh tree"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={del}
                className="p-1.5 rounded hover:bg-zinc-100 text-rose-400"
                title="Delete project"
                aria-label="Delete project"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={onNewProject}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-medium text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            New project
          </button>
        </div>
      </div>

      {/* Compare-mode progress pill — appears as soon as one node is
          pinned so the user knows the flow (click another Compare button).
          Disappears once both slots are filled (the "Open Before/After"
          CTA at the right of the top bar handles that state). */}
      {project && compare.a && !compare.b && (
        <div className="px-4 py-1.5 bg-cyan-50 border-b border-cyan-300 text-[12px] text-cyan-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Columns className="w-3.5 h-3.5" />
            <span>
              <span className="font-medium">Compare mode:</span> A ={" "}
              <span className="font-medium">{compareNodeA?.title || "Untitled"}</span>.
              Click <span className="font-medium">Compare</span> on another node to open split view.
            </span>
          </div>
          <button
            onClick={() => {
              setCompareA(null);
              setCompareB(null);
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-cyan-100 text-cyan-700 text-[11px] font-medium"
            title="Esc"
          >
            <X className="w-3 h-3" />
            Exit Compare
          </button>
        </div>
      )}

      {project && canCompare && (
        <div className="px-4 py-1.5 bg-cyan-100 border-b border-cyan-300 text-[12px] text-cyan-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Columns className="w-3.5 h-3.5" />
            <span>
              Comparing <span className="font-medium">{compareNodeA?.title || "A"}</span> ↔{" "}
              <span className="font-medium">{compareNodeB?.title || "B"}</span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={openViewer}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500 hover:bg-cyan-400 text-white text-[11px] font-medium"
            >
              Open split view
            </button>
            <button
              onClick={() => {
                setCompareA(null);
                setCompareB(null);
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-cyan-200 text-cyan-700 text-[11px] font-medium"
              title="Esc"
            >
              <X className="w-3 h-3" /> Exit Compare
            </button>
          </div>
        </div>
      )}

      {project && hasCheckpoint && (
        <div className="px-4 py-1.5 bg-fuchsia-100 border-b border-fuchsia-300 text-[12px] text-fuchsia-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Anchor className="w-3.5 h-3.5" />
            <span>
              <span className="font-medium">Checkpoint active.</span>{" "}
              {includeArchived
                ? `Showing all ${project.total_count ?? nodes.length} nodes (including ${archivedCount} archived).`
                : `${archivedCount} older node${archivedCount === 1 ? "" : "s"} archived for speed.`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleArchived}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-fuchsia-100 hover:bg-fuchsia-200 text-fuchsia-700 text-[11px]"
            >
              <ArchiveRestore className="w-3 h-3" />
              {includeArchived ? "Hide archived" : "Show archived"}
            </button>
            <button
              onClick={clearCheckpoint}
              className="px-2 py-0.5 rounded text-fuchsia-700 hover:bg-fuchsia-100 text-[11px]"
              title="Remove the checkpoint — restores the full tree as the active view"
            >
              Clear checkpoint
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Inline-editable project name. Click to edit, Enter / blur to save,
 *  Escape to cancel. Optimistic update via PATCH /projects/:id { name }. */
function ProjectNameInline({
  name,
  projectId,
  seedUrl,
}: {
  name: string;
  projectId: string;
  seedUrl: string | null | undefined;
}) {
  const { setTree, project, includeArchived } = useUI();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  async function commit() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    try {
      await api.patchProject(projectId, { name: next });
      // Refresh tree so the store's project.name updates everywhere.
      const tree = await api.getTree(projectId, includeArchived);
      setTree(tree.project as any, tree.nodes, tree.edges);
    } catch (e) {
      useUI.getState().showError(`Rename failed: ${(e as Error).message}`);
      setDraft(name);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-zinc-500">Project:</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          maxLength={200}
          className="px-2 py-0.5 rounded border border-amber-400 bg-white text-sm text-zinc-900 font-medium focus:outline-none focus:ring-2 focus:ring-amber-300"
        />
      </span>
    );
  }

  return (
    <>
      <span className="text-zinc-500">Project:</span>{" "}
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to rename"
        className="text-zinc-900 font-medium hover:underline decoration-dotted underline-offset-2"
      >
        {name}
      </button>
      {seedUrl && (
        <span className="text-zinc-500 text-[11px] ml-2 font-mono">{seedUrl}</span>
      )}
    </>
  );
}
