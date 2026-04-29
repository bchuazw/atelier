import { useEffect, useMemo, useState } from "react";
import {
  Palette,
  Plus,
  Trash2,
  RefreshCw,
  BookOpen,
  Anchor,
  ArchiveRestore,
  Archive,
  MessageSquareQuote,
  Gem,
  Columns,
  X,
  Star,
  ChevronDown,
  Loader2,
  Users,
} from "lucide-react";
import clsx from "clsx";
import { api, getWorkspaceId, type ProjectDTO } from "@/lib/api";
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
    championedIds,
    showcaseMode,
    setShowcaseMode,
    openWorkspaceDialog,
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
    const ok = await useUI.getState().showConfirm({
      title: "Delete project?",
      message: `"${project.name}" will be removed permanently along with every variant and asset under it.`,
      confirmLabel: "Delete project",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;
    await api.deleteProject(project.id);
    setTree(null, [], []);
  }

  async function archive() {
    if (!project) return;
    const ok = await useUI.getState().showConfirm({
      title: "Archive project?",
      message:
        `"${project.name}" will be hidden from your recent-projects list. ` +
        `The project itself, every variant, and every published share URL stay live — ` +
        `you can restore from the dashboard's "Show hidden" toggle anytime.`,
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    try {
      await api.archiveProject(project.id, true);
      // Drop back to the dashboard so the user sees the immediate effect.
      setTree(null, [], []);
    } catch (e) {
      useUI.getState().showError(`Couldn't archive: ${(e as Error).message}`);
    }
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

        {/* Right action cluster: horizontally-scrollable on narrow screens
            so phone users can still reach Critics / Context / Refresh /
            Delete / New Project. A merge-tester reported these were clipped
            past the viewport edge with no fallback at <640px. The scroll
            stays subtle on desktop (no overflow when there's room). */}
        <div className="flex items-center gap-2 text-sm overflow-x-auto max-w-[calc(100vw-200px)] sm:max-w-none scrollbar-thin">
          <div className="text-[11px] text-zinc-500 mr-2 flex-shrink-0">
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
          {project && championedIds.length > 0 && (
            <button
              onClick={() => setShowcaseMode(!showcaseMode)}
              className={clsx(
                "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium",
                showcaseMode
                  ? "bg-amber-500 text-black hover:bg-amber-400"
                  : "bg-amber-100 text-amber-700 hover:bg-amber-200"
              )}
              title={
                showcaseMode
                  ? `Exit Showcase — return to the full canvas`
                  : `Showcase view — hide everything except your ${championedIds.length} starred variant${championedIds.length === 1 ? "" : "s"}`
              }
            >
              <Star
                className="w-3.5 h-3.5"
                fill={showcaseMode ? "currentColor" : "none"}
              />
              {showcaseMode ? `Showcase (${championedIds.length})` : `Showcase`}
              {!showcaseMode && (
                <span className="ml-0.5 px-1 rounded bg-amber-200/60 text-amber-800 text-[10px] font-mono">
                  {championedIds.length}
                </span>
              )}
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
                onClick={archive}
                className="p-1.5 rounded hover:bg-zinc-100 text-zinc-500"
                title="Archive project (hide from dashboard, keeps data + share URLs live)"
                aria-label="Archive project"
              >
                <Archive className="w-4 h-4" />
              </button>
              <button
                onClick={del}
                className="p-1.5 rounded hover:bg-zinc-100 text-rose-400"
                title="Delete project permanently"
                aria-label="Delete project"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={openWorkspaceDialog}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs"
            title="Share workspace code with a teammate, or join their workspace — no login required"
          >
            <Users className="w-3.5 h-3.5" /> Workspace
          </button>
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

/** Inline-editable project name with a chevron-triggered switcher dropdown.
 *  Click the name → rename. Click the chevron → dropdown of recent projects
 *  + a "Browse all" link back to the EmptyState dashboard. Loading the
 *  list is deferred to first dropdown open so the topbar mount stays cheap. */
function ProjectNameInline({
  name,
  projectId,
  seedUrl,
}: {
  name: string;
  projectId: string;
  seedUrl: string | null | undefined;
}) {
  const { setTree, includeArchived } = useUI();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherList, setSwitcherList] = useState<ProjectDTO[] | null>(null);
  const [switcherLoading, setSwitcherLoading] = useState(false);
  const [switcherError, setSwitcherError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  // Click-outside / Esc close for the switcher dropdown. Mirrors the
  // existing AppDialog Esc-capture pattern (Esc bubbles up from the
  // topbar so capture-phase isn't needed here).
  useEffect(() => {
    if (!switcherOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest("[data-project-switcher]")) setSwitcherOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSwitcherOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [switcherOpen]);

  async function openSwitcher() {
    setSwitcherOpen((prev) => !prev);
    if (switcherList || switcherLoading) return;
    setSwitcherLoading(true);
    setSwitcherError(null);
    try {
      const list = await api.listProjects(false, getWorkspaceId());
      // Sort newest first, then current project last (it's already loaded
      // so it's the least-useful row). Cap at 12 — beyond that we suggest
      // Browse all to avoid a wall-of-projects dropdown.
      const sorted = [...list].sort((a, b) => {
        if (a.id === projectId) return 1;
        if (b.id === projectId) return -1;
        return (b.created_at || "").localeCompare(a.created_at || "");
      });
      setSwitcherList(sorted.slice(0, 12));
    } catch (e) {
      setSwitcherError((e as Error).message || "Failed to load projects");
    } finally {
      setSwitcherLoading(false);
    }
  }

  async function loadProject(pid: string) {
    setSwitcherOpen(false);
    if (pid === projectId) return;
    try {
      const tree = await api.getTree(pid, includeArchived);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTree(tree.project as any, tree.nodes, tree.edges);
    } catch (e) {
      useUI.getState().showError(`Couldn't load project: ${(e as Error).message}`);
    }
  }

  function browseAll() {
    setSwitcherOpen(false);
    setTree(null, [], []);
  }

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    <span className="relative inline-flex items-center gap-1" data-project-switcher>
      <span className="text-zinc-500">Project:</span>{" "}
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to rename"
        className="text-zinc-900 font-medium hover:underline decoration-dotted underline-offset-2"
      >
        {name}
      </button>
      <button
        type="button"
        onClick={openSwitcher}
        title="Switch to another project"
        aria-label="Switch project"
        aria-expanded={switcherOpen}
        className={clsx(
          "p-0.5 rounded hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900 transition-colors",
          switcherOpen && "bg-zinc-100 text-zinc-900"
        )}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {seedUrl && (
        <span className="text-zinc-500 text-[11px] ml-2 font-mono">{seedUrl}</span>
      )}
      {switcherOpen && (
        <div
          className="absolute top-full left-0 mt-1.5 z-30 w-[320px] bg-white border border-zinc-200 rounded-lg shadow-xl overflow-hidden"
          data-project-switcher
        >
          <div className="px-3 py-2 border-b border-zinc-100 text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
            Recent projects
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {switcherLoading && (
              <div className="px-3 py-4 flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading…
              </div>
            )}
            {switcherError && (
              <div className="px-3 py-3 text-xs text-rose-600">
                {switcherError}
              </div>
            )}
            {switcherList && switcherList.length === 0 && (
              <div className="px-3 py-4 text-xs text-zinc-500">
                No other projects yet.
              </div>
            )}
            {switcherList?.map((p) => {
              const isCurrent = p.id === projectId;
              const cost = (p.total_cost_cents ?? 0) / 100;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => loadProject(p.id)}
                  disabled={isCurrent}
                  className={clsx(
                    "w-full text-left px-3 py-2 border-b border-zinc-50 last:border-b-0 transition-colors",
                    isCurrent
                      ? "bg-amber-50 cursor-default"
                      : "hover:bg-stone-50 cursor-pointer"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-zinc-900 truncate">
                      {p.name}
                    </span>
                    {isCurrent && (
                      <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 flex-shrink-0">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5 font-mono">
                    {typeof p.node_count === "number" && (
                      <span>{p.node_count} nodes</span>
                    )}
                    {cost > 0 && <span>~${cost.toFixed(2)}</span>}
                    {p.created_at && (
                      <span className="truncate">
                        {new Date(p.created_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={browseAll}
            className="w-full px-3 py-2 text-[11px] font-medium text-zinc-700 bg-stone-50 hover:bg-stone-100 border-t border-zinc-100 text-left"
          >
            Browse all projects →
          </button>
        </div>
      )}
    </span>
  );
}
