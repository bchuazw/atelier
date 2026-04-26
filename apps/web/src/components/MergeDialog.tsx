import { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Loader2,
  Shuffle,
  Check,
  AlertTriangle,
  CircleDot,
  Type,
  Palette,
  LayoutGrid,
  PenLine,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import {
  api,
  subscribeToJob,
  type MergeChildDTO,
  type MergeEvent,
  type StyleAspect,
} from "@/lib/api";
import { useUI } from "@/lib/store";

const ASPECTS: {
  id: StyleAspect;
  label: string;
  hint: string;
  icon: typeof Type;
}[] = [
  { id: "typography", label: "Typography", hint: "Fonts, weights, letter-spacing, @imports", icon: Type },
  { id: "palette", label: "Color palette", hint: "Backgrounds, accents, CTAs, gradients", icon: Palette },
  { id: "layout", label: "Layout", hint: "Hero placement, grid, alignment, spacing", icon: LayoutGrid },
  { id: "copy", label: "Copy", hint: "Headlines, subheadlines, CTA text, nav labels", icon: PenLine },
];

const STEPS = [
  { id: "merging", label: "Opus synthesizes the merge" },
  { id: "materializing", label: "Materializing the new variant" },
] as const;
type StepId = (typeof STEPS)[number]["id"];
type StepState = "pending" | "active" | "done" | "error";

const EVENT_START: Record<string, StepId> = {
  merging: "merging",
  uploading: "materializing",
};
const EVENT_END: Record<string, StepId> = {
  merged: "merging",
  uploaded: "materializing",
};

function fmtMs(ms: number | undefined): string {
  if (!ms && ms !== 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function MergeDialog() {
  const {
    mergeDialog,
    closeMergeDialog,
    nodes,
    openViewer,
    setCompareA,
    setCompareB,
    includeArchived,
    markRecentlyMerged,
  } = useUI();
  const [selected, setSelected] = useState<Record<StyleAspect, boolean>>({
    typography: true,
    palette: true,
    layout: false,
    copy: false,
    all: false,
  });
  const [userNote, setUserNote] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepState, setStepState] = useState<Record<StepId, { state: StepState; elapsedMs?: number }>>({
    merging: { state: "pending" },
    materializing: { state: "pending" },
  });
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const source = useMemo(
    () => nodes.find((n) => n.id === mergeDialog?.source_id) || null,
    [nodes, mergeDialog]
  );
  const target = useMemo(
    () => nodes.find((n) => n.id === mergeDialog?.target_id) || null,
    [nodes, mergeDialog]
  );

  useEffect(() => {
    if (!mergeDialog) {
      setSelected({ typography: true, palette: true, layout: false, copy: false, all: false });
      setUserNote("");
      setError(null);
      setRunning(false);
      setStepState({ merging: { state: "pending" }, materializing: { state: "pending" } });
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    }
  }, [mergeDialog]);

  useEffect(
    () => () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    },
    []
  );

  if (!mergeDialog || !source || !target) return null;

  const chosenAspects = (Object.entries(selected) as [StyleAspect, boolean][])
    .filter(([, v]) => v)
    .map(([k]) => k);

  function toggle(a: StyleAspect) {
    setSelected((s) => {
      if (a === "all") {
        const next = !s.all;
        return { typography: !next && s.typography, palette: !next && s.palette, layout: !next && s.layout, copy: !next && s.copy, all: next };
      }
      return { ...s, [a]: !s[a], all: false };
    });
  }

  function handleEvent(ev: MergeEvent) {
    const startKey = EVENT_START[ev.type];
    if (startKey) {
      setStepState((p) => ({ ...p, [startKey]: { ...p[startKey], state: "active" } }));
    }
    const endKey = EVENT_END[ev.type];
    if (endKey) {
      setStepState((p) => ({
        ...p,
        [endKey]: { ...p[endKey], state: "done", elapsedMs: (ev.data as any)?.elapsed_ms },
      }));
    }
    if (ev.type === "error") {
      setError((ev.data as any)?.message || "merge failed");
      setStepState((p) => {
        const next = { ...p };
        for (const s of STEPS) {
          if (next[s.id].state === "active") {
            next[s.id] = { ...next[s.id], state: "error" };
            break;
          }
        }
        return next;
      });
    }
  }

  async function handleFinal(result: { ok: boolean; child?: MergeChildDTO; error?: string }) {
    if (!result.ok || !result.child) {
      setRunning(false);
      if (!error) setError(result.error || "merge failed");
      return;
    }
    const proj = useUI.getState().project;
    if (proj) {
      try {
        const tree = await api.getTree(proj.id, includeArchived);
        useUI.getState().setTree(tree.project, tree.nodes, tree.edges);
      } catch (e) {
        console.error("tree refresh failed", e);
      }
    }
    // Auto-open the Before/After viewer: A = target, B = merged child.
    if (target && result.child) {
      setCompareA(target.id);
      setCompareB(result.child.node_id);
      openViewer();
      markRecentlyMerged(result.child.node_id);
    }
    setRunning(false);
    closeMergeDialog();
  }

  async function submit() {
    if (!target || !source) return;
    if (chosenAspects.length === 0) {
      setError("Pick at least one aspect to pull from the source.");
      return;
    }
    setRunning(true);
    setError(null);
    setStepState({ merging: { state: "active" }, materializing: { state: "pending" } });
    try {
      const job = await api.enqueueMergeJob(target.id, {
        source_id: source.id,
        aspects: chosenAspects,
        user_note: userNote.trim() || undefined,
      });
      unsubscribeRef.current = subscribeToJob<MergeChildDTO>(
        job.stream_url,
        (ev) => handleEvent(ev as MergeEvent),
        handleFinal
      );
    } catch (e: any) {
      setError(e?.message || "Failed to enqueue merge job");
      setRunning(false);
    }
  }

  function renderStepIcon(s: StepState) {
    if (s === "done") return <Check className="w-3.5 h-3.5 text-emerald-400" />;
    if (s === "active") return <Loader2 className="w-3.5 h-3.5 animate-spin text-fuchsia-600" />;
    if (s === "error") return <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />;
    return <CircleDot className="w-3.5 h-3.5 text-zinc-400" />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-stone-50 border border-fuchsia-300 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <Shuffle className="w-5 h-5 text-fuchsia-400" />
            <div>
              <h2 className="text-base font-medium">Combine nodes</h2>
              <p className="text-[11px] text-zinc-500">
                Start from the target, lift the selected aspects from the source. Synthesis runs on Opus.
              </p>
            </div>
          </div>
          <button onClick={closeMergeDialog} className="text-zinc-500 hover:text-zinc-900" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-stretch gap-3 text-[12px]">
            <div className="flex-1 p-3 rounded-lg bg-white border border-zinc-200">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Source (gives)</div>
              <div className="text-fuchsia-600 font-medium truncate">{source.title || "Untitled"}</div>
              {source.summary && <div className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5">{source.summary}</div>}
            </div>
            <div className="self-center text-fuchsia-400">→</div>
            <div className="flex-1 p-3 rounded-lg bg-white border border-zinc-200">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Target (base)</div>
              <div className="text-zinc-900 font-medium truncate">{target.title || "Untitled"}</div>
              {target.summary && <div className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5">{target.summary}</div>}
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">
              What to import from the source
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.id)}
                  disabled={running}
                  className={clsx(
                    "flex items-start gap-2 px-3 py-2 rounded-lg border text-left transition",
                    selected[a.id]
                      ? "bg-fuchsia-50 border-fuchsia-500/60"
                      : "bg-white border-zinc-200 hover:border-zinc-400"
                  )}
                >
                  <a.icon
                    className={clsx(
                      "w-4 h-4 mt-0.5 flex-shrink-0",
                      selected[a.id] ? "text-fuchsia-600" : "text-zinc-500"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className={clsx("text-sm font-medium", selected[a.id] ? "text-fuchsia-700" : "text-zinc-800")}>
                      {a.label}
                    </div>
                    <div className="text-[11px] text-zinc-500 leading-snug">{a.hint}</div>
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => toggle("all")}
              disabled={running}
              className={clsx(
                "mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs border",
                selected.all
                  ? "bg-fuchsia-100 border-fuchsia-500 text-fuchsia-700"
                  : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-400"
              )}
            >
              <Sparkles className="w-3 h-3" /> Or: import everything that makes them different
            </button>
          </div>

          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">
              Additional note <span className="text-zinc-400">(optional)</span>
            </label>
            <textarea
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              rows={2}
              placeholder="e.g., keep the CTA button solid, not ghost"
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
              disabled={running}
            />
          </div>

          {(running || error) && (
            <div className="rounded-lg border border-fuchsia-300 bg-fuchsia-50 p-3 space-y-1.5">
              {STEPS.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-[12px]">
                  {renderStepIcon(stepState[s.id].state)}
                  <span
                    className={clsx(
                      "flex-1",
                      stepState[s.id].state === "done" && "text-zinc-800",
                      stepState[s.id].state === "active" && "text-fuchsia-700 font-medium",
                      stepState[s.id].state === "pending" && "text-zinc-500",
                      stepState[s.id].state === "error" && "text-rose-700"
                    )}
                  >
                    {s.label}
                  </span>
                  {stepState[s.id].elapsedMs != null && (
                    <span className="text-[10px] font-mono text-zinc-500">{fmtMs(stepState[s.id].elapsedMs)}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-400 bg-rose-50 border border-rose-300 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-zinc-200 bg-stone-50/60">
          <div className="text-[11px] text-zinc-500">
            Opus 4.7 synthesizes — typical latency 25–45s.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={closeMergeDialog}
              disabled={running}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900"
            >
              {running ? "Close" : "Cancel"}
            </button>
            <button
              onClick={submit}
              disabled={running || chosenAspects.length === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded font-medium bg-fuchsia-500 hover:bg-fuchsia-400 text-black disabled:opacity-50"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4" />}
              {running ? "Combining…" : "Combine"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
