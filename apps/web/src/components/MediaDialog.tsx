import { useEffect, useRef, useState } from "react";
import {
  X,
  Image as ImageIcon,
  Film,
  Loader2,
  Wand2,
  Check,
  AlertTriangle,
  CircleDot,
} from "lucide-react";
import clsx from "clsx";
import { api, subscribeToMediaJob, type MediaEvent, type MediaChildDTO } from "@/lib/api";
import { useUI } from "@/lib/store";

const KIND_PRESETS: Record<"image" | "video", string[]> = {
  image: [
    "warm editorial photo of people enjoying the product outdoors",
    "minimalist studio shot, soft pastel palette, cinematic lighting",
    "playful illustration, hand-drawn texture, brand colors",
    "premium architectural shot, dramatic shadows, golden hour",
  ],
  video: [
    "subtle 3-second loop of warm sunlight moving across a hero scene",
    "soft camera push-in on a calm product still",
    "ambient particle drift over a brand-color gradient background",
  ],
};

const ASPECTS = ["16:9", "4:3", "1:1", "9:16"];

// Map backend stage events → UI step ids. Stages start/finish in pairs.
type StepId = "prompt" | "media" | "rewrite" | "upload";
type StepState = "pending" | "active" | "done" | "error";

const STEP_ORDER: StepId[] = ["prompt", "media", "rewrite", "upload"];
const STEP_LABEL: Record<StepId, string> = {
  prompt: "Claude drafts the image prompt",
  media: "MiniMax renders the asset",
  rewrite: "Claude rewrites the HTML",
  upload: "Uploads to storage",
};

const EVENT_START: Record<string, StepId> = {
  "drafting-prompt": "prompt",
  "rendering-media": "media",
  "rewriting-html": "rewrite",
  "uploading": "upload",
};
const EVENT_END: Record<string, StepId> = {
  "prompt-drafted": "prompt",
  "media-rendered": "media",
  "html-rewritten": "rewrite",
  "uploaded": "upload",
};

function fmtMs(ms: number | undefined): string {
  if (!ms && ms !== 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function MediaDialog() {
  const {
    mediaDialogOpen,
    mediaParentId,
    closeMedia,
    nodes,
    openViewer,
    setCompareA,
    setCompareB,
    includeArchived,
  } = useUI();
  const [kind, setKind] = useState<"image" | "video">("image");
  const [intent, setIntent] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<
    Record<StepId, { state: StepState; elapsedMs?: number; detail?: string }>
  >({
    prompt: { state: "pending" },
    media: { state: "pending" },
    rewrite: { state: "pending" },
    upload: { state: "pending" },
  });
  const [imagePrompt, setImagePrompt] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!mediaDialogOpen) {
      setIntent("");
      setError(null);
      setRunning(false);
      setKind("image");
      setAspect("16:9");
      setImagePrompt(null);
      setSteps({
        prompt: { state: "pending" },
        media: { state: "pending" },
        rewrite: { state: "pending" },
        upload: { state: "pending" },
      });
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    }
  }, [mediaDialogOpen]);

  // Clean up the SSE subscription if the component unmounts mid-run.
  useEffect(
    () => () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    },
    []
  );

  if (!mediaDialogOpen || !mediaParentId) return null;

  const parent = nodes.find((x) => x.id === mediaParentId);

  function handleEvent(ev: MediaEvent) {
    // Stage transitions
    const startKey = EVENT_START[ev.type];
    if (startKey) {
      setSteps((prev) => ({ ...prev, [startKey]: { ...prev[startKey], state: "active" } }));
    }
    const endKey = EVENT_END[ev.type];
    if (endKey) {
      const elapsed = (ev.data as any)?.elapsed_ms as number | undefined;
      setSteps((prev) => ({
        ...prev,
        [endKey]: { ...prev[endKey], state: "done", elapsedMs: elapsed },
      }));
    }
    // Pull out the image prompt so the user can see what Claude wrote.
    if (ev.type === "prompt-drafted" && (ev.data as any)?.image_prompt) {
      setImagePrompt((ev.data as any).image_prompt);
    }
    if (ev.type === "error") {
      setError((ev.data as any)?.message || "Pipeline error");
      // Mark the currently-active step as errored
      setSteps((prev) => {
        const next = { ...prev };
        for (const k of STEP_ORDER) {
          if (next[k].state === "active") {
            next[k] = { ...next[k], state: "error" };
            break;
          }
        }
        return next;
      });
    }
  }

  async function handleFinal(result: { ok: boolean; child?: MediaChildDTO; error?: string }) {
    if (!result.ok || !result.child) {
      setRunning(false);
      if (!error) setError(result.error || "Generation failed");
      return;
    }
    const proj = useUI.getState().project;
    if (proj) {
      try {
        const tree = await api.getTree(proj.id, includeArchived);
        useUI.getState().setTree(tree.project, tree.nodes, tree.edges);
      } catch (err) {
        console.error("tree refresh failed", err);
      }
    }
    if (mediaParentId) {
      setCompareA(mediaParentId);
      setCompareB(result.child.node_id);
      openViewer();
    }
    setRunning(false);
    closeMedia();
  }

  async function submit() {
    if (!mediaParentId) return;
    setRunning(true);
    setError(null);
    setImagePrompt(null);
    setSteps({
      prompt: { state: "pending" },
      media: { state: "pending" },
      rewrite: { state: "pending" },
      upload: { state: "pending" },
    });
    try {
      const job = await api.enqueueMediaJob(mediaParentId, {
        kind,
        user_intent: intent.trim() || undefined,
        aspect,
      });
      unsubscribeRef.current = subscribeToMediaJob(job.stream_url, handleEvent, handleFinal);
    } catch (e: any) {
      setError(e?.message || "Failed to enqueue media job");
      setRunning(false);
    }
  }

  function renderStepIcon(state: StepState) {
    if (state === "done") return <Check className="w-3.5 h-3.5 text-emerald-400" />;
    if (state === "active") return <Loader2 className="w-3.5 h-3.5 animate-spin text-fuchsia-600" />;
    if (state === "error") return <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />;
    return <CircleDot className="w-3.5 h-3.5 text-zinc-400" />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-stone-50 border border-zinc-200 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-fuchsia-400" />
            <div>
              <h2 className="text-base font-medium">
                Generate hero media for {parent?.title || "node"}
              </h2>
              <p className="text-[11px] text-zinc-500">
                Claude writes the brief → MiniMax renders → Claude rewrites the page to use it.
              </p>
            </div>
          </div>
          <button onClick={closeMedia} className="text-zinc-500 hover:text-zinc-900">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">Asset kind</label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "image", label: "Image", hint: "MiniMax image-01 (~20s)", icon: ImageIcon },
                  { id: "video", label: "Short clip", hint: "MiniMax T2V-01 (~60–180s)", icon: Film },
                ] as const
              ).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  disabled={running}
                  className={clsx(
                    "flex items-start gap-2 px-3 py-2.5 rounded-lg border text-left transition",
                    kind === k.id
                      ? "bg-fuchsia-50 border-fuchsia-500/60"
                      : "bg-white border-zinc-200 hover:border-zinc-400"
                  )}
                >
                  <k.icon
                    className={clsx("w-4 h-4 mt-0.5", kind === k.id ? "text-fuchsia-600" : "text-zinc-500")}
                  />
                  <div className="flex-1">
                    <div
                      className={clsx(
                        "text-sm font-medium",
                        kind === k.id ? "text-fuchsia-700" : "text-zinc-800"
                      )}
                    >
                      {k.label}
                    </div>
                    <div className="text-[11px] text-zinc-500">{k.hint}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">
              What should the hero feel like?{" "}
              <span className="text-zinc-400">
                (optional — Claude will infer from page tone if blank)
              </span>
            </label>
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={3}
              placeholder="e.g., warm editorial photo of two people laughing at a sunny outdoor café"
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
              disabled={running}
              autoFocus
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {KIND_PRESETS[kind].map((p) => (
                <button
                  key={p}
                  onClick={() => setIntent(p)}
                  disabled={running}
                  className="text-[11px] px-2 py-1 rounded-full bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 hover:border-zinc-400"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">Aspect ratio</label>
            <div className="flex gap-1">
              {ASPECTS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAspect(a)}
                  disabled={running}
                  className={clsx(
                    "flex-1 px-2 py-1.5 rounded text-xs border",
                    aspect === a
                      ? "bg-fuchsia-100 border-fuchsia-500 text-fuchsia-700"
                      : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-400"
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {(running || error) && (
            <div className="rounded-lg border border-fuchsia-300 bg-fuchsia-50 p-3 space-y-1.5">
              {STEP_ORDER.map((id) => {
                const s = steps[id];
                return (
                  <div key={id} className="flex items-center gap-2 text-[12px]">
                    {renderStepIcon(s.state)}
                    <span
                      className={clsx(
                        "flex-1",
                        s.state === "done" && "text-zinc-800",
                        s.state === "active" && "text-fuchsia-700 font-medium",
                        s.state === "pending" && "text-zinc-500",
                        s.state === "error" && "text-rose-700"
                      )}
                    >
                      {STEP_LABEL[id]}
                    </span>
                    {s.elapsedMs != null && (
                      <span className="text-[10px] font-mono text-zinc-500">{fmtMs(s.elapsedMs)}</span>
                    )}
                  </div>
                );
              })}
              {imagePrompt && (
                <div className="pt-2 mt-2 border-t border-fuchsia-300/40 text-[11px] text-zinc-500 leading-relaxed">
                  <span className="text-fuchsia-600 font-medium">Prompt:</span> {imagePrompt}
                </div>
              )}
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
            Without a MiniMax API key, a labeled mock asset is generated so the flow still works end-to-end.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={closeMedia}
              disabled={running}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900"
            >
              {running ? "Close" : "Cancel"}
            </button>
            <button
              onClick={submit}
              disabled={running}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded font-medium bg-fuchsia-500 hover:bg-fuchsia-400 text-black disabled:opacity-50"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {running ? "Generating…" : `Generate ${kind}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
