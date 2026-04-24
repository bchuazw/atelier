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
      const project = await api.createProject({
        name: name.trim(),
        seed_url: seedUrl,
        seed_html: seedHtml,
      });
      const tree = await api.getTree(project.id);
      setTree(tree.project as any, tree.nodes, tree.edges);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Failed to create project");
    } finally {
      setRunning(false);
    }
  }

  const canSubmit =
    !!name.trim() &&
    ((mode === "url" && (!url.trim() || /^https?:\/\//.test(url.trim()))) ||
      (mode === "html" && html.trim().length > 0) ||
      (mode === "template" && !!selectedTemplateId) ||
      (mode === "url" && !url.trim())); // allow blank URL → hello-world

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-stone-50 border border-zinc-200 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-medium">New project</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900">
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
                  <div className="grid grid-cols-2 gap-2 max-h-[340px] overflow-y-auto pr-1">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(t.id)}
                        disabled={running}
                        className={clsx(
                          "text-left px-3 py-2.5 rounded-lg border transition",
                          selectedTemplateId === t.id
                            ? "bg-amber-100 border-amber-500"
                            : "bg-white border-zinc-200 hover:border-zinc-400"
                        )}
                      >
                        <div className="text-sm font-medium text-zinc-900">{t.name}</div>
                        <div className="text-[11px] text-zinc-500 leading-snug line-clamp-3">
                          {t.tagline}
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

        <div className="flex items-center justify-end gap-2 p-4 border-t border-zinc-200 bg-stone-50/60">
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
