import { useEffect, useState } from "react";
import { X, Loader2, Globe, Code, LayoutTemplate } from "lucide-react";
import clsx from "clsx";
import { api, type TemplateManifestEntry } from "@/lib/api";
import { useUI } from "@/lib/store";

type SeedMode = "url" | "html" | "template";

export default function NewProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { setTree } = useUI();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<SeedMode>("template");
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const [templates, setTemplates] = useState<TemplateManifestEntry[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setMode("template");
      setUrl("");
      setHtml("");
      setSelectedTemplateId(null);
      setError(null);
      setRunning(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || templates.length > 0) return;
    fetch("/templates/templates.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: TemplateManifestEntry[]) => setTemplates(d))
      .catch(() => setTemplates([]));
  }, [open, templates.length]);

  if (!open) return null;

  async function submit() {
    if (!name.trim()) return;
    setRunning(true);
    setError(null);
    try {
      let seedHtml: string | undefined;
      let seedUrl: string | undefined;
      if (mode === "template" && selectedTemplateId) {
        const tmpl = templates.find((t) => t.id === selectedTemplateId);
        if (!tmpl) throw new Error("Template not found");
        const r = await fetch(`/templates/${tmpl.file}`);
        if (!r.ok) throw new Error(`Failed to load template ${tmpl.file}`);
        seedHtml = await r.text();
      } else if (mode === "html" && html.trim()) {
        seedHtml = html;
      } else if (mode === "url" && url.trim()) {
        seedUrl = url.trim();
      }
      const created = await api.createProject({
        name: name.trim(),
        seed_url: seedUrl,
        seed_html: seedHtml,
      });
      const tree = await api.getTree(created.id);
      // Always prefer the project metadata from createProject (it's the
      // canonical record); merge tree-level fields (context, archived_count)
      // that aren't on the bare project DTO. Falling back to `created`
      // guarantees a non-null project object — a previous session report
      // saw the canvas remain on EmptyState because tree.project came back
      // missing in some race.
      const projectForStore = { ...created, ...(tree.project ?? {}) };
      setTree(projectForStore as any, tree.nodes, tree.edges);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to create project");
    } finally {
      setRunning(false);
    }
  }

  // Spell out why Create is disabled so users aren't stuck wondering. A new
  // user on first visit sees the placeholder "Landing page polish" and
  // thinks the name is already filled in — the explicit hint fixes that.
  const disabledReason = !name.trim()
    ? "Give the project a name first."
    : mode === "template" && !selectedTemplateId
    ? "Pick one of the templates above."
    : mode === "html" && !html.trim()
    ? "Paste some HTML (or switch to a Template / URL)."
    : mode === "url" && url.trim() && !/^https?:\/\//.test(url.trim())
    ? "URL must start with http:// or https://"
    : "";
  const canSubmit = !disabledReason;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-stone-50 border border-zinc-200 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-medium">New project</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-zinc-500 mb-1.5 block">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Landing page polish"
              className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              disabled={running}
              autoFocus
            />
          </div>

          <div>
            <div className="flex gap-1 mb-2">
              {(
                [
                  { id: "template", label: "Templates", icon: LayoutTemplate },
                  { id: "url", label: "Seed from URL", icon: Globe },
                  { id: "html", label: "Paste HTML", icon: Code },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  disabled={running}
                  className={clsx(
                    "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border",
                    mode === m.id
                      ? "bg-amber-100 border-amber-500 text-amber-700"
                      : "bg-white border-zinc-200 text-zinc-500 hover:border-zinc-400"
                  )}
                >
                  <m.icon className="w-3.5 h-3.5" />
                  {m.label}
                </button>
              ))}
            </div>

            {mode === "template" ? (
              <>
                {templates.length === 0 ? (
                  <div className="text-[12px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg p-4 text-center">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Loading templates…
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-[440px] overflow-y-auto pr-1">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(t.id)}
                        disabled={running}
                        className={clsx(
                          "text-left rounded-lg border transition overflow-hidden flex flex-col",
                          selectedTemplateId === t.id
                            ? "bg-amber-100 border-amber-500 shadow-md"
                            : "bg-white border-zinc-200 hover:border-zinc-400 hover:shadow-sm"
                        )}
                      >
                        {/* Live-iframe thumbnail — same pattern as VariantNode, scaled down */}
                        <div className="relative h-[128px] bg-zinc-50 border-b border-zinc-200 overflow-hidden">
                          <iframe
                            src={`/templates/${t.file}`}
                            className="absolute top-0 left-0 origin-top-left pointer-events-none"
                            style={{
                              width: "1280px",
                              height: "800px",
                              transform: "scale(0.225)",
                              transformOrigin: "top left",
                            }}
                            sandbox="allow-scripts"
                            loading="lazy"
                          />
                        </div>
                        <div className="p-2.5">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <div className="text-sm font-medium text-zinc-900">{t.name}</div>
                            {t.vibe && (
                              <span className="text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                                {t.vibe}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-zinc-500 leading-snug line-clamp-2">
                            {t.tagline}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-zinc-500 mt-2">
                  Pick a starting aesthetic. You can fork, feedback, critique, or drag-to-combine from there.
                </p>
              </>
            ) : mode === "url" ? (
              <>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com  (leave blank for a hello-world seed)"
                  type="url"
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                  disabled={running}
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  We inline CSS and images, drop common analytics scripts, and force UTF-8 decoding.
                </p>
              </>
            ) : (
              <>
                <textarea
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  placeholder="<!DOCTYPE html>&#10;<html>...</html>"
                  rows={10}
                  className="w-full bg-white border border-zinc-200 rounded-lg px-3 py-2 text-[11px] font-mono leading-snug focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                  disabled={running}
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Paste a complete, self-contained HTML document. Use this for polished demo starts that dodge real-site fetch quirks.
                </p>
              </>
            )}
          </div>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-50 border border-rose-300 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-zinc-200 bg-stone-50/60">
          <div className="text-[11px] text-zinc-500 flex-1 min-w-0 truncate">
            {disabledReason || "Ready — Claude will prep the seed in a few seconds."}
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={running || !canSubmit}
            title={disabledReason || undefined}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-50"
          >
            {running && <Loader2 className="w-4 h-4 animate-spin" />}
            {running ? "Preparing seed…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
