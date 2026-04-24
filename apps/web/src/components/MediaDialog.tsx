import { useEffect, useState } from "react";
import { X, Image as ImageIcon, Film, Loader2, Wand2 } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/api";
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
  const [stage, setStage] = useState<string>("");

  useEffect(() => {
    if (!mediaDialogOpen) {
      setIntent("");
      setError(null);
      setRunning(false);
      setStage("");
      setKind("image");
      setAspect("16:9");
    }
  }, [mediaDialogOpen]);

  if (!mediaDialogOpen || !mediaParentId) return null;

  const parent = nodes.find((x) => x.id === mediaParentId);

  async function submit() {
    if (!mediaParentId) return;
    setRunning(true);
    setError(null);
    setStage("Drafting image prompt with Claude…");
    try {
      // Heuristic UX: the request is synchronous server-side (~10–25s for the
      // mock path, longer with a real Genspark video). Stage messages cycle
      // so the user sees progress even without SSE (Phase 3 task 4).
      const stageTicker = setInterval(() => {
        setStage((s) => {
          if (s.startsWith("Drafting")) return "Genspark rendering hero asset…";
          if (s.startsWith("Genspark")) return "Claude rewriting HTML to use the new asset…";
          return "Materializing the variant on disk…";
        });
      }, 4500);

      const child = await api.generateMedia(mediaParentId, {
        kind,
        user_intent: intent.trim() || undefined,
        aspect,
      });
      clearInterval(stageTicker);

      const proj = useUI.getState().project;
      if (proj) {
        const tree = await api.getTree(proj.id, includeArchived);
        useUI.getState().setTree(tree.project, tree.nodes, tree.edges);
      }
      setCompareA(mediaParentId);
      setCompareB(child.node_id);
      openViewer();
      closeMedia();
    } catch (e: any) {
      setError(e?.message || "Media generation failed");
    } finally {
      setRunning(false);
      setStage("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-fuchsia-400" />
            <div>
              <h2 className="text-base font-medium">
                Generate hero media for {parent?.title || "node"}
              </h2>
              <p className="text-[11px] text-zinc-500">
                Claude writes the brief → Genspark renders → Claude rewrites the page to use it.
              </p>
            </div>
          </div>
          <button onClick={closeMedia} className="text-zinc-400 hover:text-zinc-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">Asset kind</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "image", label: "Image", hint: "Flux / DALL-E (~10–15s)", icon: ImageIcon },
                { id: "video", label: "Short clip", hint: "Kling / Veo (~60s)", icon: Film },
              ] as const).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  disabled={running}
                  className={clsx(
                    "flex items-start gap-2 px-3 py-2.5 rounded-lg border text-left transition",
                    kind === k.id
                      ? "bg-fuchsia-500/10 border-fuchsia-500/60"
                      : "bg-zinc-900 border-zinc-800 hover:border-zinc-600"
                  )}
                >
                  <k.icon className={clsx("w-4 h-4 mt-0.5", kind === k.id ? "text-fuchsia-300" : "text-zinc-500")} />
                  <div className="flex-1">
                    <div className={clsx("text-sm font-medium", kind === k.id ? "text-fuchsia-100" : "text-zinc-200")}>
                      {k.label}
                    </div>
                    <div className="text-[11px] text-zinc-400">{k.hint}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">
              What should the hero feel like? <span className="text-zinc-600">(optional — Claude will infer from page tone if blank)</span>
            </label>
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={3}
              placeholder="e.g., warm editorial photo of two people laughing at a sunny outdoor café"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
              disabled={running}
              autoFocus
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {KIND_PRESETS[kind].map((p) => (
                <button
                  key={p}
                  onClick={() => setIntent(p)}
                  disabled={running}
                  className="text-[11px] px-2 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">Aspect ratio</label>
            <div className="flex gap-1">
              {ASPECTS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAspect(a)}
                  disabled={running}
                  className={clsx(
                    "flex-1 px-2 py-1.5 rounded text-xs border",
                    aspect === a
                      ? "bg-fuchsia-500/20 border-fuchsia-500 text-fuchsia-100"
                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600"
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900 rounded px-3 py-2">
              {error}
            </div>
          )}
          {running && stage && (
            <div className="text-xs text-fuchsia-300 bg-fuchsia-950/30 border border-fuchsia-900/60 rounded px-3 py-2 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> {stage}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-zinc-800 bg-zinc-950/60">
          <div className="text-[11px] text-zinc-500">
            Without a Genspark API key, a labeled mock asset is generated so the flow still works end-to-end.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={closeMedia}
              disabled={running}
              className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100"
            >
              Cancel
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
