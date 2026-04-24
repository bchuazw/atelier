import { useEffect, useMemo, useState } from "react";
import {
  X,
  Loader2,
  MessageSquareQuote,
  Sparkles,
  ArrowRight,
  Check,
  AlertTriangle,
} from "lucide-react";
import clsx from "clsx";
import {
  api,
  type FeedbackItemDTO,
  type ModelId,
} from "@/lib/api";
import { useUI } from "@/lib/store";
import ModelPicker from "./ModelPicker";

const AREA_COLORS: Record<string, string> = {
  typography: "bg-amber-100 text-amber-700",
  palette: "bg-rose-100 text-rose-700",
  layout: "bg-sky-100 text-sky-700",
  copy: "bg-emerald-100 text-emerald-700",
  imagery: "bg-fuchsia-100 text-fuchsia-700",
  cta: "bg-orange-100 text-orange-700",
  spacing: "bg-cyan-100 text-cyan-700",
  contrast: "bg-slate-100 text-slate-700",
  motion: "bg-violet-100 text-violet-700",
  structure: "bg-teal-100 text-teal-700",
  other: "bg-zinc-100 text-zinc-700",
};

type Stage = "compose" | "analyzing" | "review" | "applying";

export default function FeedbackDialog() {
  const {
    feedbackDialogOpen,
    feedbackTargetId,
    closeFeedback,
    nodes,
    preferredModel,
    openViewer,
    setCompareA,
    setCompareB,
    includeArchived,
    project,
  } = useUI();

  const [message, setMessage] = useState("");
  const [model, setModel] = useState<ModelId>(preferredModel);
  const [stage, setStage] = useState<Stage>("compose");
  const [items, setItems] = useState<FeedbackItemDTO[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const target = useMemo(
    () => nodes.find((n) => n.id === feedbackTargetId) || null,
    [nodes, feedbackTargetId]
  );

  useEffect(() => {
    if (!feedbackDialogOpen) {
      setMessage("");
      setModel(preferredModel);
      setStage("compose");
      setItems([]);
      setSelected({});
      setError(null);
    }
  }, [feedbackDialogOpen, preferredModel]);

  if (!feedbackDialogOpen || !target) return null;

  async function analyze() {
    if (!target || !message.trim()) return;
    setStage("analyzing");
    setError(null);
    try {
      const resp = await api.feedbackAnalyze(target.id, {
        message: message.trim(),
        model,
      });
      setItems(resp.items);
      const pre: Record<string, boolean> = {};
      resp.items.forEach((it) => (pre[it.id] = true));
      setSelected(pre);
      setStage("review");
    } catch (e: any) {
      setError(e?.message || "Analyze failed");
      setStage("compose");
    }
  }

  async function apply() {
    if (!target) return;
    const chosen = items.filter((it) => selected[it.id]);
    if (chosen.length === 0) {
      setError("Pick at least one item to apply.");
      return;
    }
    setStage("applying");
    setError(null);
    try {
      const bullets = chosen
        .map((it, i) => `${i + 1}. [${it.area}] ${it.change} — ${it.rationale}`)
        .join("\n");
      const prompt =
        `Apply the following stakeholder-feedback changes to this variant as a single coherent rewrite. ` +
        `Honor each item; don't skip. If two items conflict, prefer the one listed earlier.\n\n${bullets}`;
      const children = await api.fork(target.id, prompt, model, 1, false);
      const child = children[0];
      if (!child) throw new Error("Fork returned no child");
      if (project) {
        const tree = await api.getTree(project.id, includeArchived);
        useUI.getState().setTree(tree.project, tree.nodes, tree.edges);
      }
      setCompareA(target.id);
      setCompareB(child.node_id);
      openViewer();
      closeFeedback();
    } catch (e: any) {
      setError(e?.message || "Apply failed");
      setStage("review");
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4 atelier-dialog-backdrop">
      <div className="atelier-dialog-panel w-full max-w-2xl bg-stone-50 border border-zinc-200 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <MessageSquareQuote className="w-5 h-5 text-sky-500" />
            <div>
              <h2 className="text-base font-medium">Stakeholder feedback</h2>
              <p className="text-[11px] text-zinc-500">
                Paste the whole message. Atelier decomposes it into atomic changes you approve before applying.
              </p>
            </div>
          </div>
          <button onClick={closeFeedback} className="text-zinc-500 hover:text-zinc-900">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-[11px] flex items-center gap-2 text-zinc-500">
            <span>Targeting:</span>
            <span className="text-sky-700 font-medium">{target.title || "Untitled"}</span>
            <span className="text-zinc-400">·</span>
            <ModelPicker value={model} onChange={setModel} disabled={stage !== "compose"} />
          </div>

          {stage === "compose" || stage === "analyzing" ? (
            <>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={7}
                placeholder='Paste the stakeholder feedback. E.g., "Boss says: the hero feels corporate — make it warmer. Also bolder headline, and the CTA should be above the fold. Copy should sound more like we, less like the startup voice. Oh and add a testimonial section somewhere."'
                className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40 leading-relaxed"
                disabled={stage === "analyzing"}
                autoFocus
              />
              {stage === "analyzing" && (
                <div className="flex items-center gap-2 text-[12px] text-sky-700">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{{ haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" }[model]} is decomposing the feedback…</span>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              <div className="text-[11px] text-zinc-500">
                {items.length} atomic change{items.length === 1 ? "" : "s"} detected. Toggle which to apply.
              </div>
              {items.map((it) => (
                <label
                  key={it.id}
                  className={clsx(
                    "flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition",
                    selected[it.id]
                      ? "bg-sky-50 border-sky-300"
                      : "bg-white border-zinc-200 hover:border-zinc-400"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={!!selected[it.id]}
                    onChange={() =>
                      setSelected((s) => ({ ...s, [it.id]: !s[it.id] }))
                    }
                    className="mt-0.5 accent-sky-500"
                    disabled={stage === "applying"}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={clsx(
                          "text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded",
                          AREA_COLORS[it.area] || AREA_COLORS.other
                        )}
                      >
                        {it.area}
                      </span>
                      <span className="text-sm text-zinc-900">{it.change}</span>
                    </div>
                    {it.rationale && (
                      <div className="text-[11px] text-zinc-500 leading-snug">{it.rationale}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-500 bg-rose-50 border border-rose-300 rounded px-3 py-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-zinc-200 bg-white/60">
          <div className="text-[11px] text-zinc-500">
            {stage === "review"
              ? `${selectedCount} of ${items.length} items will be applied in one rewrite.`
              : "AutoReason-style decomposition — review before applying."}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={closeFeedback}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900"
              disabled={stage === "applying"}
            >
              Cancel
            </button>
            {stage === "review" || stage === "applying" ? (
              <button
                onClick={apply}
                disabled={selectedCount === 0 || stage === "applying"}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-sky-500 hover:bg-sky-400 text-white font-medium disabled:opacity-50"
              >
                {stage === "applying" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Apply {selectedCount} {selectedCount === 1 ? "item" : "items"}
              </button>
            ) : (
              <button
                onClick={analyze}
                disabled={!message.trim() || stage === "analyzing"}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-sky-500 hover:bg-sky-400 text-white font-medium disabled:opacity-50"
              >
                {stage === "analyzing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Analyze <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
