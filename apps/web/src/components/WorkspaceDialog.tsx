import { useEffect, useMemo, useRef, useState } from "react";
import { Users, Copy, Check, X, ArrowRight, History } from "lucide-react";
import clsx from "clsx";
import { useUI } from "@/lib/store";
import {
  api,
  displayWorkspaceCode,
  getRecentWorkspaces,
  getWorkspaceId,
  setWorkspaceId,
  type ProjectDTO,
} from "@/lib/api";

/**
 * Workspace share + switch panel.
 *
 * Atelier identities are cookie-based (localStorage `workspace_id`), not
 * auth-backed. To let two people see the same projects without dealing
 * with logins, this panel exposes the current workspace as a shareable
 * 8-char code (or full UUID for legacy workspaces). Anyone who joins
 * with that code lands in the same `workspace_id` namespace and sees
 * the same `list_projects` rows.
 *
 * Trade-off documented to the user inline: switching workspaces leaves
 * your old projects behind UNLESS you remember the old code. We surface
 * recent workspaces so the user can switch back with one click — that's
 * the substitute for proper multi-account support until real auth lands.
 */
export default function WorkspaceDialog() {
  const { workspaceDialogOpen, closeWorkspaceDialog, setTree, project, includeArchived } =
    useUI();
  const [code, setCode] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Re-read on each open. The component stays mounted across opens (no
  // unmount/remount cycle) so we don't get a fresh useState init each
  // time — keying off the open flag does the job.
  useEffect(() => {
    if (!workspaceDialogOpen) return;
    setCode(getWorkspaceId());
    setRecents(getRecentWorkspaces());
    setJoinInput("");
    setCopiedCode(false);
    setCopiedUrl(false);
    setError(null);
    // Tab focus into the join input shortly after open.
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [workspaceDialogOpen]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/?ws=${encodeURIComponent(code)}`;
  }, [code]);

  function copyCode() {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1500);
    });
  }
  function copyUrl() {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    });
  }

  // Core "join workspace" flow — shared by the form submit + the
  // recents-list rows so a single code path handles both UX entry points.
  async function joinWorkspace(target: string) {
    const next = target.trim();
    if (!next) return;
    if (next === code) {
      setError("That's already your current workspace.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setWorkspaceId(next);
      // Reload recents projects scoped to the new workspace + drop any
      // currently-loaded project state so the canvas redirects to the
      // dashboard. The empty-state component re-fetches on mount.
      setTree(null, [], []);
      // Refresh tree state if a project is open + still belongs to the
      // new workspace. Otherwise the EmptyState dashboard renders fresh.
      if (project) {
        try {
          const tree = await api.getTree(project.id, includeArchived);
          setTree(tree.project as ProjectDTO, tree.nodes, tree.edges);
        } catch {
          // Project doesn't belong to the new workspace anymore — leave
          // the dashboard view (already cleared above).
        }
      }
      closeWorkspaceDialog();
    } catch (e) {
      setError((e as Error)?.message || "Couldn't switch workspaces");
    } finally {
      setBusy(false);
    }
  }

  if (!workspaceDialogOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeWorkspaceDialog();
      }}
    >
      <div className="w-full max-w-md bg-stone-50 border border-zinc-200 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="text-base font-medium">Workspace</h2>
              <p className="text-[11px] text-zinc-500">
                Share your code and a teammate can see and edit the same projects.
              </p>
            </div>
          </div>
          <button
            onClick={closeWorkspaceDialog}
            className="text-zinc-500 hover:text-zinc-900"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Current code + copy actions */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">
              Your workspace code
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 rounded-lg bg-white border border-zinc-200 font-mono text-sm select-all break-all">
                {displayWorkspaceCode(code)}
              </div>
              <button
                onClick={copyCode}
                className={clsx(
                  "flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium",
                  copiedCode
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                )}
              >
                {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCode ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              onClick={copyUrl}
              className={clsx(
                "mt-2 w-full text-left px-3 py-2 rounded-lg text-[12px] font-mono break-all flex items-center justify-between gap-2",
                copiedUrl
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-zinc-50 border border-zinc-200 text-zinc-600 hover:border-zinc-400"
              )}
              title="Copy shareable link"
            >
              <span className="truncate">{shareUrl}</span>
              <span className="flex-shrink-0">
                {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </span>
            </button>
            <p className="text-[10px] text-zinc-500 mt-1.5">
              Send the code or the link to a teammate. Anyone with it can see + edit your projects.
              No login needed.
            </p>
          </div>

          <div className="border-t border-zinc-200 pt-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5">
              Switch workspaces
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void joinWorkspace(joinInput);
              }}
              className="flex items-center gap-2"
            >
              <input
                ref={inputRef}
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                placeholder="Paste workspace code or full link"
                className="flex-1 px-3 py-2 rounded-lg bg-white border border-zinc-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !joinInput.trim()}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium disabled:opacity-40"
              >
                Join <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
            {error && (
              <p className="text-[11px] text-rose-600 mt-1.5">{error}</p>
            )}
          </div>

          {recents.length > 0 && (
            <div className="border-t border-zinc-200 pt-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-1.5 flex items-center gap-1">
                <History className="w-3 h-3" /> Recent workspaces
              </div>
              <div className="space-y-1">
                {recents.map((r) => (
                  <button
                    key={r}
                    onClick={() => void joinWorkspace(r)}
                    disabled={busy}
                    className="w-full text-left px-3 py-1.5 rounded-lg bg-white border border-zinc-200 hover:border-amber-400 text-[12px] font-mono text-zinc-700 truncate"
                    title={`Switch back to ${r}`}
                  >
                    {displayWorkspaceCode(r)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

