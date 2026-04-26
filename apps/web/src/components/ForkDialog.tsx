import { useEffect, useState } from "react";
import { X, Sparkles, Loader2, Swords } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";

const MODELS = [
  { id: "haiku", label: "Haiku 4.5", hint: "fastest, cheapest" },
  { id: "sonnet", label: "Sonnet 4.6", hint: "balanced" },
  { id: "opus", label: "Opus 4.7", hint: "best quality" },
];

// Two columns: visual changes on the left, copy/voice changes on the
// right. A first-time user round flagged that all chips were design-flavored
// — copywriters had nowhere to start.
const VISUAL_PRESETS = [
  "Make it warmer and more playful",
  "Cleaner, more minimalist spacing",
  "Higher contrast, more accessible",
  "Modernize the typography",
];
const COPY_PRESETS = [
  "Rewrite the hero headline for [audience]",
  "Punchier CTA copy — urgent, no jargon",
  "Sharpen the value prop in one sentence",
  "Make the tone more confident and human",
];

export default function ForkDialog() {
  const { forkDialogOpen, forkParentId, forkPrefill, closeFork, nodes, openViewer, setCompareA, setCompareB, includeArchived, project } = useUI();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("sonnet");
  const [n, setN] = useState(1);
  const [shootout, setShootout] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every time the dialog opens. Earlier we only reset on close,
  // which left a stale prompt visible if the dialog was reopened without
  // a prefill (a fresh-user tester hit this and thought the app had
  // somehow remembered someone else's prompt).
  useEffect(() => {
    if (forkDialogOpen) {
      setPrompt(forkPrefill ?? "");
      setError(null);
      setRunning(false);
      setShootout(false);
    }
  }, [forkDialogOpen, forkPrefill]);

  if (!forkDialogOpen || !forkParentId) return null;

  const parent = nodes.find((x) => x.id === forkParentId);

  async function submit() {
    if (!prompt.trim() || !forkParentId) return;
    // Cost-fan guard. A FAANG-eng beta tester reported "fired a 3-variant
    // generation against my will. Three Sonnet calls I didn't ask for."
    // For any fan > 1 (n>1 or shootout=true) we surface a one-shot confirm
    // so the cost intent is explicit. Single-variant forks keep the old
    // zero-friction path.
    const fanCount = shootout ? 3 : n;
    if (fanCount > 1) {
      // Rough per-call estimate using Sonnet rates; shootout averages the
      // three tiers. Keeps the user honest about what they're spending.
      const perCallUsd = shootout ? 0.06 : model === "opus" ? 0.18 : model === "haiku" ? 0.01 : 0.06;
      const totalUsd = (perCallUsd * fanCount).toFixed(2);
      const ok = window.confirm(
        `This will fire ${fanCount} parallel LLM call${fanCount === 1 ? "" : "s"} ` +
          `(~$${totalUsd}). Continue?`
      );
      if (!ok) return;
    }
    setRunning(true);
    setError(null);
    try {
      const children = await api.fork(forkParentId, prompt.trim(), model, n, shootout);
      // Pull the fresh tree to get positions/metadata right.
      const proj = useUI.getState().project;
      if (proj) {
        const tree = await api.getTree(proj.id, includeArchived);
        useUI.getState().setTree(tree.project, tree.nodes, tree.edges);
      }
      if (children[0]) {
        setCompareA(forkParentId);
        setCompareB(children[0].node_id);
        openViewer();
      }
      closeFork();
    } catch (e: any) {
      setError(e?.message || "Fork failed");
    } finally {
      setRunning(false);
    }
  }

  const effectiveCount = shootout ? 3 : n;
  const ctaLabel = shootout ? "Run shootout (3 models)" : `Fork ${n}×`;

  // Soft-cap aware cost estimate — only rendered when the project has a cap
  // set, so users with no cap don't see extra noise. Uses the same
  // per-call rates as the existing fan-out confirm so the numbers agree.
  const capCents = project?.cost_cap_cents ?? null;
  const totalCostCents = project?.total_cost_cents ?? 0;
  const perCallUsd = shootout ? 0.06 : model === "opus" ? 0.18 : model === "haiku" ? 0.01 : 0.06;
  const estUsd = perCallUsd * effectiveCount;
  const showCapLine = capCents != null && capCents > 0;
  const wouldExceed = showCapLine && (totalCostCents + Math.round(estUsd * 100)) > (capCents as number);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-stone-50 border border-zinc-200 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-medium">Make a version from {parent?.title || "this page"}</h2>
              <p className="text-[11px] text-zinc-500">
                Describe a change in plain English. The AI will create a new version next to this one.
              </p>
            </div>
          </div>
          <button onClick={closeFork} className="text-zinc-500 hover:text-zinc-900" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {showCapLine && (
            <div
              className={clsx(
                "text-[11px] px-2.5 py-1.5 rounded border",
                wouldExceed
                  ? "bg-rose-50 border-rose-300 text-rose-700"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              )}
              title="Estimate uses Sonnet $0.06/call (Haiku $0.01, Opus $0.18, shootout $0.06×3) as a proxy."
            >
              Estimated to cost ~${estUsd.toFixed(2)} (cap is ${(capCents! / 100).toFixed(2)}; spent so far ${(totalCostCents / 100).toFixed(2)}).
              {wouldExceed && " This fork may be refused."}
            </div>
          )}
          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="e.g., make the hero warmer and more playful, enlarge the CTA button…"
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              disabled={running}
              autoFocus
            />
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Visual</div>
                <div className="flex flex-wrap gap-1">
                  {VISUAL_PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPrompt(p)}
                      disabled={running}
                      className="text-[11px] px-2 py-1 rounded-full bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 hover:border-zinc-400"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Copy / voice</div>
                <div className="flex flex-wrap gap-1">
                  {COPY_PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPrompt(p)}
                      disabled={running}
                      className="text-[11px] px-2 py-1 rounded-full bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 hover:border-zinc-400"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Model shootout toggle: same prompt, three models, three sibling variants. */}
          <button
            type="button"
            onClick={() => setShootout((v) => !v)}
            disabled={running}
            className={clsx(
              "w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition",
              shootout
                ? "bg-fuchsia-50 border-fuchsia-500/60"
                : "bg-white border-zinc-200 hover:border-zinc-400"
            )}
          >
            <Swords className={clsx("w-4 h-4 mt-0.5", shootout ? "text-fuchsia-600" : "text-zinc-500")} />
            <div className="flex-1">
              <div className={clsx("text-sm font-medium", shootout ? "text-fuchsia-700" : "text-zinc-800")}>
                Model shootout
              </div>
              <div className="text-[11px] text-zinc-500">
                Runs the same prompt on Haiku + Sonnet + Opus in parallel. Three sibling variants on the canvas.
              </div>
            </div>
            <div
              className={clsx(
                "text-[10px] px-1.5 py-0.5 rounded border",
                shootout
                  ? "bg-fuchsia-500 text-black border-fuchsia-400"
                  : "text-zinc-500 border-zinc-300"
              )}
            >
              {shootout ? "ON" : "OFF"}
            </div>
          </button>

          <div className={clsx("grid grid-cols-2 gap-4 transition", shootout && "opacity-40 pointer-events-none")}>
            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Model</label>
              <div className="flex gap-1">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setModel(m.id)}
                    disabled={running || shootout}
                    className={clsx(
                      "flex-1 px-2 py-1.5 rounded text-xs border",
                      model === m.id
                        ? "bg-amber-100 border-amber-500 text-amber-700"
                        : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-400"
                    )}
                    title={m.hint}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-500 mb-1.5 block">Variants</label>
              <div className="flex gap-1">
                {[1, 2, 3].map((k) => (
                  <button
                    key={k}
                    onClick={() => setN(k)}
                    disabled={running || shootout}
                    className={clsx(
                      "flex-1 px-2 py-1.5 rounded text-xs border",
                      n === k
                        ? "bg-amber-100 border-amber-500 text-amber-700"
                        : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-400"
                    )}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-50 border border-rose-300 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-zinc-200 bg-stone-50/60">
          <div className="text-[11px] text-zinc-500">
            Generating {effectiveCount} variant{effectiveCount === 1 ? "" : "s"} in parallel
            {shootout && " — one per model"}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={closeFork}
              disabled={running}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={running || !prompt.trim()}
              className={clsx(
                "flex items-center gap-1.5 px-4 py-1.5 text-sm rounded font-medium disabled:opacity-50",
                shootout
                  ? "bg-fuchsia-500 hover:bg-fuchsia-400 text-black"
                  : "bg-amber-500 hover:bg-amber-400 text-black"
              )}
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : shootout ? <Swords className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
              {running ? "Generating…" : ctaLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
