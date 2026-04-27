import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Loader2, Target, ChevronUp, ChevronDown, History } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";
import ModelPicker from "./ModelPicker";

const CURATED_CHIPS = [
  "make it warmer and more playful",
  "bolder headline, larger CTA",
  "cleaner, more minimalist spacing",
  "swap to a serif heading",
  "asymmetric layout — text left, visual right",
];

// Persist the last 5 prompts the user actually shipped (per project) so
// "what I tried last time" sits one click away on subsequent forks.
const RECENT_PROMPTS_KEY = (projectId: string) => `atelier:recentPrompts:${projectId}`;
const MAX_RECENT_PROMPTS = 5;

function loadRecentPrompts(projectId: string | null | undefined): string[] {
  if (!projectId) return [];
  try {
    const raw = localStorage.getItem(RECENT_PROMPTS_KEY(projectId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Normalize a prompt for dedupe — lower-cased + whitespace collapsed.
 *  Two prompts that differ only in casing or extra spaces shouldn't
 *  show up as separate chips. */
function dedupeKey(p: string): string {
  return p.toLowerCase().replace(/\s+/g, " ").trim();
}

function saveRecentPrompt(projectId: string, prompt: string) {
  try {
    const key = dedupeKey(prompt);
    const existing = loadRecentPrompts(projectId).filter((p) => dedupeKey(p) !== key);
    const next = [prompt.trim(), ...existing].slice(0, MAX_RECENT_PROMPTS);
    localStorage.setItem(RECENT_PROMPTS_KEY(projectId), JSON.stringify(next));
  } catch {
    // localStorage full or disabled — silently skip; recent-prompts is a
    // nice-to-have, not load-bearing.
  }
}

function clearRecentPrompts(projectId: string) {
  try {
    localStorage.removeItem(RECENT_PROMPTS_KEY(projectId));
  } catch {
    // ignore
  }
}

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
  const [recentPrompts, setRecentPrompts] = useState<string[]>([]);
  const inFlightRef = useRef(false);

  // Hydrate recent prompts when the active project changes — and clear the
  // stale prompt textarea. Six beta testers in a row reported "the prompt
  // bar auto-filled with someone else's text and I forked the wrong thing"
  // — root cause was that PromptBar stayed mounted across project switches
  // and its local `prompt` state never reset, so a half-typed brief from
  // Project A would still be sitting there when you opened Project B.
  useEffect(() => {
    setPrompt("");
    setError(null);
    setRecentPrompts(loadRecentPrompts(project?.id));
  }, [project?.id]);

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

  // Synchronous re-entry guard. `disabled={running}` on the button is the
  // intent, but React state updates batch — three rapid clicks fire the
  // submit handler three times before the disabled prop has had a chance
  // to flip. An adversarial QA pass committed three forks against one
  // intended click. The ref check rejects any second/third call inside
  // the same JS turn before any work happens.
  const submitInFlight = inFlightRef;

  async function submit() {
    if (submitInFlight.current) return;
    if (!target || !prompt.trim()) return;
    submitInFlight.current = true;
    setRunning(true);
    setError(null);
    const trimmed = prompt.trim();
    try {
      await api.fork(target.id, trimmed, preferredModel, 1, false);
      const tree = await api.getTree(project!.id, includeArchived);
      useUI.getState().setTree(tree.project, tree.nodes, tree.edges);
      saveRecentPrompt(project!.id, trimmed);
      setRecentPrompts(loadRecentPrompts(project!.id));
      setPrompt("");
    } catch (e: any) {
      const raw = String(e?.message || "Fork failed");
      // Special-case the cost-cap 402 from the sync /fork path. Without
      // this branch the user saw the raw `"402 Payment Required: {\"detail\":...}"`
      // envelope inline — ugly + leaks server detail. Route to the same
      // persistent banner the SSE path uses so the experience is consistent.
      if (raw.includes("402") && raw.toLowerCase().includes("cost cap")) {
        const proj = useUI.getState().project;
        useUI.getState().showCostCapBanner({
          total_cost_cents: proj?.total_cost_cents ?? 0,
          cost_cap_cents: proj?.cost_cap_cents ?? 0,
        });
      } else {
        // Strip the JSON envelope when present so users see the human
        // detail and not the wire format.
        const detailMatch = raw.match(/"detail"\s*:\s*"([^"]+)"/);
        setError(detailMatch?.[1] ?? raw);
      }
    } finally {
      setRunning(false);
      submitInFlight.current = false;
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

            <div className="flex flex-wrap items-center gap-1 mt-2 px-0.5">
              {/* Recent prompts (per-project, persisted in localStorage)
                  surface first so users can re-fire what they just tried
                  on a sibling. Visually marked with a History icon + amber
                  tint to distinguish from the curated chips. */}
              {recentPrompts.length > 0 && (
                <>
                  <span
                    className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium flex items-center gap-1 mr-1"
                    title="Your last 5 prompts on this project"
                  >
                    <History className="w-3 h-3" /> Recent
                  </span>
                  {recentPrompts.map((c) => (
                    <button
                      key={`recent-${c}`}
                      onClick={() => setPrompt(c)}
                      disabled={running || !target}
                      title={c}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 hover:border-amber-400 disabled:opacity-40 max-w-[260px] truncate"
                    >
                      {c}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      if (project?.id) {
                        clearRecentPrompts(project.id);
                        setRecentPrompts([]);
                      }
                    }}
                    disabled={running}
                    title="Clear recent prompts for this project"
                    className="text-[10px] text-zinc-400 hover:text-zinc-700 px-1"
                  >
                    clear
                  </button>
                  <span className="w-px h-4 bg-zinc-200 mx-1" />
                </>
              )}
              {CURATED_CHIPS.map((c) => (
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
