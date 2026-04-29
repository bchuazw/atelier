import { Palette, MousePointerClick, Trash2, Archive, ArchiveRestore } from "lucide-react";
import { useEffect, useState } from "react";
import { api, getWorkspaceId, type ProjectDTO } from "@/lib/api";
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
  // When false (default), the fetch omits the include_archived param so the
  // dashboard is clean for screen-share. Toggling on triggers a refetch that
  // returns archived rows alongside active ones, then the UI splits them
  // into two sections.
  const [showArchived, setShowArchived] = useState(false);
  // Per-visitor workspace id — read from localStorage on mount and passed
  // to every list call so each browser only sees its own projects (plus
  // legacy untagged ones, which the server keeps unfiltered for back-compat).
  const [workspaceId] = useState<string>(() => getWorkspaceId());
  async function reload(
    includeArchived = showArchived,
  ) {
    setLoading(true);
    try {
      const list = await api.listProjects(
        includeArchived,
        workspaceId,
      );
      setProjects(list);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Always include archived on initial load so the "Show N archived"
    // toggle can render with a real count. The active list still renders
    // exactly the same — we just split client-side. A production beta
    // tester archived a project and had no UI path to restore it because
    // the toggle never rendered (chicken/egg: count was 0 because we
    // hadn't fetched archived yet).
    void reload(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function open(p: ProjectDTO) {
    const tree = await api.getTree(p.id);
    setTree(tree.project as any, tree.nodes, tree.edges);
  }

  async function deleteFromList(p: ProjectDTO) {
    const ok = await useUI.getState().showConfirm({
      title: "Delete project permanently?",
      message:
        `"${p.name}" — this removes all variants and assets and cannot be undone.\n\n` +
        `(Tip: "Archive" hides it from your dashboard but keeps the data.)`,
      confirmLabel: "Delete permanently",
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (!ok) return;
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

  async function setArchived(p: ProjectDTO, archived: boolean) {
    setBusyId(p.id);
    try {
      await api.archiveProject(p.id, archived);
      if (archived) {
        // Archiving from the active list: drop it (unless we're already
        // showing archived rows, in which case flip its flag in place so it
        // moves to the Archived section).
        if (showArchived) {
          setProjects((prev) =>
            prev.map((q) => (q.id === p.id ? { ...q, archived: true } : q))
          );
        } else {
          setProjects((prev) => prev.filter((q) => q.id !== p.id));
        }
      } else {
        // Restoring: flip flag in place so it moves up to the active list.
        setProjects((prev) =>
          prev.map((q) => (q.id === p.id ? { ...q, archived: false } : q))
        );
      }
    } catch (e) {
      useUI.getState().showError(`Failed to update: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleShowArchived() {
    const next = !showArchived;
    setShowArchived(next);
    await reload(next);
  }

  // Test-name filter: drop projects whose names look like ad-hoc tests
  // (a fresh-user beta tester said the public dashboard "reads as a debug
  // environment" because of names like "prod-smoke-1777257513", "sdasad",
  // "sse-test-…", "race-test-…"). Hide those by default — the user can
  // expand "Show N archived" to see everything if they need to.
  const TEST_NAME_RX = /^(prod-smoke|smoke|smoketest|sse-test|race-test|verify[-_]?strict|test|sdasad|debug)/i;
  const isTestish = (p: ProjectDTO) => TEST_NAME_RX.test(p.name || "") || (p.name || "").trim().length === 0;
  const activeProjects = projects.filter((p) => !p.archived && !isTestish(p));
  const hiddenTestish = projects.filter((p) => !p.archived && isTestish(p));
  const archivedProjects = projects.filter((p) => p.archived);
  // We only know there *might* be archived projects when we've fetched them
  // at least once. Without that, hide the toggle so first-time users don't
  // see a control that does nothing. Once toggled on, keep showing it (with
  // count) so they can collapse back.
  const showToggleRow = showArchived || archivedProjects.length > 0 || hiddenTestish.length > 0;
  // When the toggle is "on" (archive-show mode), also surface hidden test
  // projects since the user explicitly opted in to seeing the full list.
  const allArchivedish = showArchived ? [...archivedProjects, ...hiddenTestish] : archivedProjects;

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

        <div className="flex flex-col items-center gap-2">
          <button
            onClick={onNewProject}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-medium"
          >
            <MousePointerClick className="w-4 h-4" />
            Create a new project
          </button>
          <button
            onClick={() => useUI.getState().openWorkspaceDialog()}
            className="text-[11px] text-zinc-500 hover:text-zinc-900 underline-offset-2 hover:underline"
          >
            Have a workspace code? Share or switch
          </button>
        </div>

        {!loading && activeProjects.length > 0 && (
          <nav aria-label="Recent projects">
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-xs uppercase tracking-wide text-zinc-600">Recent projects</h2>
              {showToggleRow && (
                <button
                  onClick={toggleShowArchived}
                  className="text-[11px] text-zinc-600 hover:text-zinc-900 underline-offset-2 hover:underline"
                  aria-pressed={showArchived}
                >
                  {showArchived
                    ? "Hide archived & test projects"
                    : `Show ${archivedProjects.length + hiddenTestish.length} hidden`}
                </button>
              )}
            </div>
            <div className="space-y-1">
              {activeProjects.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  busy={busyId === p.id}
                  onOpen={() => open(p)}
                  onArchive={() => setArchived(p, true)}
                  onDelete={() => deleteFromList(p)}
                />
              ))}
            </div>

            {showArchived && allArchivedish.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
                  Archived &amp; test projects
                </h3>
                <div className="space-y-1 opacity-80">
                  {allArchivedish.map((p) => (
                    <ArchivedProjectRow
                      key={p.id}
                      project={p}
                      busy={busyId === p.id}
                      onOpen={() => open(p)}
                      onRestore={() => setArchived(p, false)}
                      onDelete={() => deleteFromList(p)}
                    />
                  ))}
                </div>
              </div>
            )}
          </nav>
        )}

        {/* Edge case: every project is archived → nothing in the active list,
            but we still want the user to be able to expand and restore. */}
        {!loading && activeProjects.length === 0 && showToggleRow && (
          <nav aria-label="Recent projects">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs uppercase tracking-wide text-zinc-600">Recent projects</h2>
              <button
                onClick={toggleShowArchived}
                className="text-[11px] text-zinc-600 hover:text-zinc-900 underline-offset-2 hover:underline"
                aria-pressed={showArchived}
              >
                {showArchived
                  ? "Hide archived"
                  : `Show ${archivedProjects.length} archived`}
              </button>
            </div>
            {showArchived && archivedProjects.length > 0 && (
              <div className="space-y-1 opacity-80">
                {archivedProjects.map((p) => (
                  <ArchivedProjectRow
                    key={p.id}
                    project={p}
                    busy={busyId === p.id}
                    onOpen={() => open(p)}
                    onRestore={() => setArchived(p, false)}
                    onDelete={() => deleteFromList(p)}
                  />
                ))}
              </div>
            )}
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
  onArchive,
  onDelete,
}: {
  project: ProjectDTO;
  busy: boolean;
  onOpen: () => void;
  onArchive: () => void;
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
        {/* Archive is the default action; delete is demoted to a secondary
            icon that only appears on hover next to it. Both stay hover-only
            so the resting state of the row is clean. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          className="text-zinc-500 hover:text-amber-600 opacity-0 group-hover:opacity-100 transition"
          title="Archive project (hide from dashboard, keep data)"
          aria-label="Archive project"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"
          title="Delete project permanently"
          aria-label="Delete project permanently"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function ArchivedProjectRow({
  project: p,
  busy,
  onOpen,
  onRestore,
  onDelete,
}: {
  project: ProjectDTO;
  busy: boolean;
  onOpen: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={
        "group w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-stone-100 border border-zinc-200 hover:border-zinc-400 transition" +
        (busy ? " opacity-50 pointer-events-none" : "")
      }
    >
      <button onClick={onOpen} className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-sm text-zinc-700 font-medium truncate">{p.name}</div>
          {typeof p.node_count === "number" && p.node_count > 0 && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-600 font-medium">
              {p.node_count} {p.node_count === 1 ? "node" : "nodes"}
            </span>
          )}
        </div>
        {p.seed_url && (
          <div className="text-[11px] text-zinc-600 font-mono truncate">{p.seed_url}</div>
        )}
      </button>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-[11px] text-zinc-500">
          {formatRelative(p.last_activity || p.created_at || null)}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRestore();
          }}
          className="text-zinc-500 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition"
          title="Restore project (show in dashboard)"
          aria-label="Restore project"
        >
          <ArchiveRestore className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition"
          title="Delete project permanently"
          aria-label="Delete project permanently"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
