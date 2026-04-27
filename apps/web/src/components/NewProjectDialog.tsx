import { useEffect, useState } from "react";
import { X, Loader2, Globe, Code, LayoutTemplate, Pin, ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import clsx from "clsx";
import { api, type StylePin, type TemplateManifestEntry } from "@/lib/api";
import { useUI } from "@/lib/store";

// "match" = the new "Match an existing site" mode: fetch the URL, hand to
// Claude, get back style pins + a seed HTML scaffold the user can fork from.
// Distinct from "url" (which raw-fetches into a sandbox) because the result
// is design-token analysis + a generated scaffold, not the live page itself.
type SeedMode = "url" | "html" | "template" | "match";

type ExtractedDesign = {
  summary: string;
  style_pins: StylePin[];
  seed_html: string;
  model_used: string;
  cost_cents: number;
};

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

// Merge two pin lists, preferring entries later in the array (manual
// Brand Kit overrides extracted) when `prop` collides. Used by "Match a
// site" so a user typing "primary color = #123" in the Brand Kit beats
// whatever Claude picked. Order-stable: the first occurrence's position is
// preserved; the override only swaps the value/kind/strict.
function dedupePins(pins: StylePin[]): StylePin[] {
  const byProp = new Map<string, StylePin>();
  for (const p of pins) {
    byProp.set(p.prop.trim().toLowerCase(), p);
  }
  return Array.from(byProp.values());
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

  // "Match a site" extraction state. `extracting` drives a two-phase status
  // line ("Reading the site…" → "Extracting design tokens…"). On success we
  // stash the result in `extracted` so a small preview block can render the
  // detected summary + pin chips, and the seed_html is held for project
  // creation. `analyzeUrl` is the field's text — kept separate from `url`
  // (the raw-fetch mode's input) so switching tabs doesn't blow either away.
  const [analyzeUrl, setAnalyzeUrl] = useState("");
  const [extracting, setExtracting] = useState<false | "fetching" | "extracting">(false);
  const [extracted, setExtracted] = useState<ExtractedDesign | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

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
      setAnalyzeUrl("");
      setExtracting(false);
      setExtracted(null);
      setExtractError(null);
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
      } else if (mode === "match" && extracted) {
        // "Match a site" succeeded: ship the Claude-generated scaffold as
        // the seed_html and let the extracted style pins flow through
        // alongside any extra Brand Kit fields the user filled in below.
        seedHtml = extracted.seed_html;
      }
      // Build the optional Brand Kit pins from any non-empty fields. We
      // create them with strict=false so users can flip individual pins to
      // strict later from the Context Panel — matches Theo's ask: "pre-load
      // Style Pins" without forcing his palette to be non-negotiable.
      const manualPins = buildBrandKitPins({
        primaryColor,
        accentColor,
        bodyFont,
        headingWeight,
        tone,
        bannedWords,
      });
      // In "match" mode, prepend the extracted pins. Manual Brand Kit fields
      // take precedence on conflict (same `prop`) so a user can override the
      // model's pick without losing the rest. Cap remains 12 server-side.
      const pins =
        mode === "match" && extracted
          ? dedupePins([...extracted.style_pins, ...manualPins])
          : manualPins;
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
    : mode === "match" && !extracted
    ? "Click Analyze to extract the design tokens first."
    : "";
  const canSubmit = !disabledReason;

  async function analyzeSite() {
    const trimmed = analyzeUrl.trim();
    if (!trimmed) {
      setExtractError("Enter a URL.");
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setExtractError("URL must start with http:// or https://");
      return;
    }
    setExtractError(null);
    setExtracted(null);
    // Two-phase status: we can't actually observe the network <-> LLM split
    // server-side without an SSE stream, so we approximate it. ~3s into the
    // call we flip from "fetching" to "extracting" so the user sees forward
    // motion instead of one long indeterminate spinner.
    setExtracting("fetching");
    const t = setTimeout(() => setExtracting("extracting"), 3000);
    try {
      const result = await api.extractDesign(trimmed);
      setExtracted({
        summary: result.summary,
        style_pins: result.style_pins,
        seed_html: result.seed_html,
        model_used: result.model_used,
        cost_cents: result.cost_cents,
      });
    } catch (e: any) {
      setExtractError(e?.message || "Extraction failed.");
    } finally {
      clearTimeout(t);
      setExtracting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4">
      {/* max-h + flex-col so the body can scroll within the modal instead of
          extending past the viewport. A fresh-user tester missed the live
          "+N pins will be saved" hint because the Brand Kit section was
          below the fold on a laptop screen and the modal didn't scroll. */}
      <div className="w-full max-w-xl bg-stone-50 border border-zinc-200 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-medium">New project</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
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
                  { id: "match", label: "Match a site", icon: Wand2 },
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
            ) : mode === "match" ? (
              <MatchSiteSection
                url={analyzeUrl}
                onUrlChange={setAnalyzeUrl}
                onAnalyze={analyzeSite}
                phase={extracting}
                extracted={extracted}
                onClearExtracted={() => setExtracted(null)}
                error={extractError}
                disabled={running}
                onEditPins={() => setBrandOpen(true)}
              />
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
                      <ColorSwatch
                        value={primaryColor}
                        onChange={setPrimaryColor}
                        disabled={running}
                        label="Primary color"
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
                      <ColorSwatch
                        value={accentColor}
                        onChange={setAccentColor}
                        disabled={running}
                        label="Accent color"
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

        <div className="flex items-center justify-between gap-2 p-4 border-t border-zinc-200 bg-stone-50/60 flex-shrink-0">
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
            {running
              ? "Preparing seed…"
              : mode === "match" && extracted
              ? "Create with extracted design"
              : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Match a site" mode panel. Owns the URL input + Analyze trigger + the
 * extracted-preview block (summary line, pin chips, "Edit pins" link). The
 * parent holds the actual extracted state so submit() can read it; this
 * component is presentation only. The four UX states are rendered inline:
 *   idle    → just the input + Analyze button
 *   analyzing→ spinner + two-phase status text ("Reading…" → "Extracting…")
 *   extracted-preview → summary + chips + "Edit pins" link + Re-analyze
 *   error   → red strip with the message; input/button still active
 */
function MatchSiteSection({
  url,
  onUrlChange,
  onAnalyze,
  phase,
  extracted,
  onClearExtracted,
  error,
  disabled,
  onEditPins,
}: {
  url: string;
  onUrlChange: (v: string) => void;
  onAnalyze: () => void;
  phase: false | "fetching" | "extracting";
  extracted: ExtractedDesign | null;
  onClearExtracted: () => void;
  error: string | null;
  disabled: boolean;
  onEditPins: () => void;
}) {
  const analyzing = phase !== false;
  const status =
    phase === "fetching"
      ? "Reading the site… (15-30s)"
      : phase === "extracting"
      ? "Extracting design tokens…"
      : "";
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://stripe.com"
          type="url"
          disabled={disabled || analyzing}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (!analyzing) onAnalyze();
            }
          }}
          className="flex-1 bg-white border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
        <button
          type="button"
          onClick={onAnalyze}
          disabled={disabled || analyzing || !url.trim()}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded bg-amber-500 hover:bg-amber-400 text-black font-medium disabled:opacity-50 whitespace-nowrap"
        >
          {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          {extracted ? "Re-analyze" : "Analyze"}
        </button>
      </div>
      <p className="text-[11px] text-zinc-500">
        Claude reads the site and pre-populates a Brand Kit + seed scaffold so you
        skip the screenshot-and-hand-craft step. Stateless until you click Create.
      </p>

      {analyzing && (
        <div className="flex items-center gap-2 text-[12px] text-zinc-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
          <span>{status}</span>
        </div>
      )}

      {error && !analyzing && (
        <div className="text-[12px] text-rose-600 bg-rose-50 border border-rose-300 rounded px-3 py-2">
          {error}
        </div>
      )}

      {extracted && !analyzing && (
        <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-3 space-y-2">
          <div className="flex items-start gap-2">
            <Wand2 className="w-3.5 h-3.5 text-amber-700 mt-0.5 flex-shrink-0" />
            <div className="text-[12px] text-zinc-800 leading-snug">
              <span className="font-medium">Detected style:</span> {extracted.summary}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {extracted.style_pins.map((p, i) => (
              <PinChip key={`${p.prop}-${i}`} pin={p} />
            ))}
          </div>
          <div className="flex items-center justify-between text-[11px] text-zinc-600 pt-1">
            <button
              type="button"
              onClick={onEditPins}
              className="text-amber-700 hover:text-amber-900 underline underline-offset-2"
            >
              Edit pins in Brand Kit ↓
            </button>
            <span className="text-zinc-500">
              {extracted.style_pins.length} pin{extracted.style_pins.length === 1 ? "" : "s"} ·
              ~{(extracted.cost_cents / 100).toFixed(2)} USD ·{" "}
              <button
                type="button"
                onClick={onClearExtracted}
                className="hover:text-zinc-900 underline underline-offset-2"
              >
                discard
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact pin chip rendered in the extraction preview. Color pins get a
// swatch + the hex; font pins get the font name set in the actual font so
// the user can eyeball that "Playfair Display" really did load. Other kinds
// (text/dimension/enum) render as a plain prop:value pair.
function PinChip({ pin }: { pin: StylePin }) {
  if (pin.kind === "color") {
    return (
      <span className="inline-flex items-center gap-1.5 bg-white border border-zinc-200 rounded px-2 py-0.5 text-[11px]">
        <span
          className="w-3 h-3 rounded-sm border border-zinc-300"
          style={{ backgroundColor: pin.value }}
          aria-hidden
        />
        <span className="text-zinc-500">{pin.prop}:</span>
        <span className="font-mono text-zinc-800">{pin.value}</span>
        {pin.strict && <Pin className="w-2.5 h-2.5 text-amber-600" />}
      </span>
    );
  }
  if (pin.kind === "font") {
    return (
      <span className="inline-flex items-center gap-1.5 bg-white border border-zinc-200 rounded px-2 py-0.5 text-[11px]">
        <span className="text-zinc-500">{pin.prop}:</span>
        <span className="text-zinc-800" style={{ fontFamily: `${pin.value}, system-ui` }}>
          {pin.value}
        </span>
        {pin.strict && <Pin className="w-2.5 h-2.5 text-amber-600" />}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 bg-white border border-zinc-200 rounded px-2 py-0.5 text-[11px]">
      <span className="text-zinc-500">{pin.prop}:</span>
      <span className="text-zinc-800">{pin.value}</span>
      {pin.strict && <Pin className="w-2.5 h-2.5 text-amber-600" />}
    </span>
  );
}

/**
 * Color swatch with an explicit "not set" state. Earlier we used a bare
 * <input type="color"> with `value={x || "#000000"}`, which displayed as
 * a solid black square — a fresh-user tester thought she'd already filled
 * black and skipped the field. This wrapper renders a checkered placeholder
 * + dashed border + tiny "+" cue when the value is empty, and only swaps to
 * the actual color picker once a color is chosen. Clicking the placeholder
 * focuses the hidden picker so the interaction model is unchanged.
 */
function ColorSwatch({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const empty = !value;
  return (
    <div className="relative h-7 w-8 flex-shrink-0">
      <input
        type="color"
        aria-label={label}
        value={value || "#cccccc"}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title={label}
        className={
          "absolute inset-0 h-full w-full rounded cursor-pointer " +
          (empty
            ? "border border-dashed border-zinc-300 opacity-0"
            : "border border-zinc-200")
        }
      />
      {empty && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded border border-dashed border-zinc-300 flex items-center justify-center text-zinc-400 text-[11px] font-medium"
          style={{
            backgroundImage:
              "linear-gradient(45deg, #e4e4e7 25%, transparent 25%), linear-gradient(-45deg, #e4e4e7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e4e4e7 75%), linear-gradient(-45deg, transparent 75%, #e4e4e7 75%)",
            backgroundSize: "6px 6px",
            backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0",
          }}
        >
          +
        </div>
      )}
    </div>
  );
}
