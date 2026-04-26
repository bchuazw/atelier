import { useEffect, useState } from "react";
import { X, Loader2, Globe, Code, LayoutTemplate, Pin, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { api, type StylePin, type TemplateManifestEntry } from "@/lib/api";
import { useUI } from "@/lib/store";

type SeedMode = "url" | "html" | "template";

// Same font list ContextPanel offers in its `kind: "font"` datalist — kept in
// sync visually so the New Project dialog and the Style Pins editor feel like
// the same vocabulary.
const FONT_SUGGESTIONS = [
  "Inter",
  "Söhne",
  "Helvetica",
  "Helvetica Neue",
  "Georgia",
  "Playfair Display",
  "IBM Plex Sans",
  "Geist",
  "system-ui",
];

const HEADING_WEIGHTS = ["", "400", "500", "600", "700", "800", "900"];

// Builds the StylePin[] payload from the Brand Kit form fields. Empty fields
// are skipped entirely so we never send blank pins. Each pin uses
// `strict: false` — users can promote individual pins to strict from the
// Context Panel after the project is created.
function buildBrandKitPins(fields: {
  primaryColor: string;
  accentColor: string;
  bodyFont: string;
  headingWeight: string;
  tone: string;
  bannedWords: string;
}): StylePin[] {
  const pins: StylePin[] = [];
  const push = (prop: string, value: string, kind: StylePin["kind"]) => {
    const v = value.trim();
    if (!v) return;
    pins.push({ prop, value: v, kind, strict: false });
  };
  push("primary color", fields.primaryColor, "color");
  push("accent color", fields.accentColor, "color");
  push("body font-family", fields.bodyFont, "font");
  push("h1 font-weight", fields.headingWeight, "enum");
  push("tone of voice", fields.tone, "text");
  push("banned words", fields.bannedWords, "text");
  return pins;
}

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

  // Brand Kit (optional) — collapsed by default so the existing fast path
  // (name + template/url/html → Create) is unchanged. When ANY brand field
  // has a value we build a StylePin[] and pass it to createProject; otherwise
  // we omit style_pins entirely so the backend behaves as before.
  const [brandOpen, setBrandOpen] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [bodyFont, setBodyFont] = useState("");
  const [headingWeight, setHeadingWeight] = useState("");
  const [tone, setTone] = useState("");
  const [bannedWords, setBannedWords] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setMode("template");
      setUrl("");
      setHtml("");
      setSelectedTemplateId(null);
      setError(null);
      setRunning(false);
      setBrandOpen(false);
      setPrimaryColor("");
      setAccentColor("");
      setBodyFont("");
      setHeadingWeight("");
      setTone("");
      setBannedWords("");
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
      // Build the optional Brand Kit pins from any non-empty fields. We
      // create them with strict=false so users can flip individual pins to
      // strict later from the Context Panel — matches Theo's ask: "pre-load
      // Style Pins" without forcing his palette to be non-negotiable.
      const pins = buildBrandKitPins({
        primaryColor,
        accentColor,
        bodyFont,
        headingWeight,
        tone,
        bannedWords,
      });
      const created = await api.createProject({
        name: name.trim(),
        seed_url: seedUrl,
        seed_html: seedHtml,
        ...(pins.length > 0 ? { style_pins: pins } : {}),
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

          {/* Brand Kit (optional). Collapsed by default — fast path stays one
              click away. Expanding reveals a tight 3-row grid of palette,
              type, and voice fields. Filled fields become Style Pins on the
              new project so the user's brand applies on the FIRST fork
              instead of the third or fourth. */}
          <div className="border border-zinc-200 rounded-lg bg-white">
            <button
              type="button"
              onClick={() => setBrandOpen((v) => !v)}
              disabled={running}
              aria-expanded={brandOpen}
              className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50 rounded-lg"
            >
              <span className="flex items-center gap-1.5">
                {brandOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                )}
                <Pin className="w-3.5 h-3.5 text-amber-600" />
                <span className="font-medium">Brand Kit</span>
                <span className="text-zinc-500">
                  · optional — palette, fonts, voice
                </span>
              </span>
              {!brandOpen && (
                <span className="text-[11px] text-zinc-500">
                  + Add a brand kit (palette, fonts, voice)
                </span>
              )}
            </button>
            {brandOpen && (
              <div className="px-3 pb-3 pt-1 space-y-3 border-t border-zinc-100">
                {/* Palette row */}
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                    Palette
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        aria-label="Primary color"
                        value={primaryColor || "#000000"}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        disabled={running}
                        title="Primary color"
                        className="h-7 w-8 border border-zinc-200 rounded bg-white cursor-pointer"
                      />
                      <input
                        value={primaryColor}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        placeholder="Primary (#3b5d3a)"
                        disabled={running}
                        className="flex-1 min-w-0 bg-white border border-zinc-200 rounded px-2 py-1 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        aria-label="Accent color"
                        value={accentColor || "#000000"}
                        onChange={(e) => setAccentColor(e.target.value)}
                        disabled={running}
                        title="Accent color"
                        className="h-7 w-8 border border-zinc-200 rounded bg-white cursor-pointer"
                      />
                      <input
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        placeholder="Accent (#c87050)"
                        disabled={running}
                        className="flex-1 min-w-0 bg-white border border-zinc-200 rounded px-2 py-1 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                      />
                    </div>
                  </div>
                </div>

                {/* Type row */}
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                    Type
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      list="brand-kit-fonts"
                      value={bodyFont}
                      onChange={(e) => setBodyFont(e.target.value)}
                      placeholder="Body font (Inter, Söhne…)"
                      disabled={running}
                      className="bg-white border border-zinc-200 rounded px-2 py-1 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    />
                    <datalist id="brand-kit-fonts">
                      {FONT_SUGGESTIONS.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                    <select
                      value={headingWeight}
                      onChange={(e) => setHeadingWeight(e.target.value)}
                      disabled={running}
                      aria-label="Heading weight"
                      className="bg-white border border-zinc-200 rounded px-2 py-1 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    >
                      {HEADING_WEIGHTS.map((w) => (
                        <option key={w || "blank"} value={w}>
                          {w ? `H1 weight ${w}` : "H1 weight (any)"}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Voice row */}
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">
                    Voice
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      placeholder="confident, human, no jargon"
                      disabled={running}
                      className="bg-white border border-zinc-200 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    />
                    <input
                      value={bannedWords}
                      onChange={(e) => setBannedWords(e.target.value)}
                      placeholder="banned words (synergy, leverage)"
                      disabled={running}
                      className="bg-white border border-zinc-200 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    />
                  </div>
                </div>

                {(() => {
                  // Recompute the pin count from the live fields so the hint
                  // matches what we'd actually send to the backend on submit.
                  const pinCount = buildBrandKitPins({
                    primaryColor,
                    accentColor,
                    bodyFont,
                    headingWeight,
                    tone,
                    bannedWords,
                  }).length;
                  return pinCount > 0 ? (
                    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 flex items-center gap-1.5">
                      <Pin className="w-3 h-3" />
                      {pinCount} Style Pin{pinCount === 1 ? "" : "s"} will be saved with the project
                      <span className="text-zinc-500">· soft by default — flip to strict in Context Panel</span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-zinc-500">
                      Fill any field to pre-load Style Pins. Skip entirely for a blank canvas.
                    </div>
                  );
                })()}
              </div>
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
