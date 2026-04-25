import { useEffect, useState } from "react";
import { X, BookOpen, Loader2, Save, Pin, Plus, Trash2 } from "lucide-react";
import { api, type StylePin } from "@/lib/api";
import { useUI } from "@/lib/store";

const PLACEHOLDER = `e.g.,

Audience: early-stage founders comparing CRMs.
Brand voice: confident but not corporate — punchy, human, no em-dashes.
Palette: warm neutrals + a single accent (coral or terracotta).
Must preserve: the pricing table, the footer logo cluster, the "Book a demo" CTA.
Avoid: stock photography, generic testimonials, gradient text.`;

// Two flavors of preset: visual (CSS-y) and voice (copy-y). A fresh-user
// round flagged that the panel was design-only and useless to a copywriter —
// voice pins now get the same treatment, with sensible defaults the user
// can tweak inline.
type PresetGroup = { heading: string; pins: { label: string; pin: StylePin }[] };
const PIN_PRESETS: PresetGroup[] = [
  {
    heading: "Visual",
    pins: [
      { label: "H1 weight", pin: { prop: "h1 font-weight", value: "800" } },
      { label: "Primary color", pin: { prop: "primary color", value: "#c87050" } },
      { label: "Accent color", pin: { prop: "accent color", value: "#1a1a1a" } },
      { label: "Type scale", pin: { prop: "type scale ratio", value: "1.25" } },
      { label: "Body font", pin: { prop: "body font-family", value: "Inter" } },
      { label: "Radius", pin: { prop: "border-radius", value: "12px" } },
    ],
  },
  {
    heading: "Voice & copy",
    pins: [
      { label: "Tone", pin: { prop: "tone of voice", value: "confident, human, no jargon" } },
      { label: "Audience", pin: { prop: "audience", value: "early-stage founders" } },
      { label: "Reading level", pin: { prop: "reading level", value: "8th grade" } },
      { label: "Banned words", pin: { prop: "banned words", value: "synergy, leverage, unlock" } },
      { label: "CTA verb", pin: { prop: "primary CTA verb", value: "Start" } },
    ],
  },
];

export default function ContextPanel() {
  const { contextPanelOpen, closeContextPanel, project, setProject } = useUI();
  const [draftContext, setDraftContext] = useState("");
  const [draftPins, setDraftPins] = useState<StylePin[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (contextPanelOpen) {
      setDraftContext(project?.context ?? "");
      setDraftPins(project?.style_pins ?? []);
      setSaved(false);
    }
  }, [contextPanelOpen, project?.context, project?.style_pins]);

  if (!contextPanelOpen) return null;

  async function save() {
    if (!project) return;
    setSaving(true);
    try {
      // Filter empty rows so the UI never sends pins like { prop: "", value: "" }.
      const pins = draftPins.filter((p) => p.prop.trim() && p.value.trim());
      const res = await api.patchProject(project.id, {
        context: draftContext,
        style_pins: pins,
      });
      setProject({ ...project, context: res.context, style_pins: res.style_pins ?? pins });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    (project?.context ?? "") !== draftContext ||
    JSON.stringify(project?.style_pins ?? []) !== JSON.stringify(draftPins);

  function addPin(seed?: StylePin) {
    setDraftPins((prev) => [...prev, seed ?? { prop: "", value: "" }]);
    setSaved(false);
  }

  function updatePin(idx: number, patch: Partial<StylePin>) {
    setDraftPins((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
    setSaved(false);
  }

  function removePin(idx: number) {
    setDraftPins((prev) => prev.filter((_, i) => i !== idx));
    setSaved(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-stone-50 border border-zinc-200 rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-sky-500" />
            <div>
              <h2 className="text-base font-medium">Project context</h2>
              <p className="text-[11px] text-zinc-500">
                Preferences and constraints the agent reads before every fork. Brand, audience,
                do's and don'ts — anything that should shape variants.
              </p>
            </div>
          </div>
          <button onClick={closeContextPanel} className="text-zinc-500 hover:text-zinc-900">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-5">
          {/* Style Pins — structured constraints. Each pin is a {prop, value}
              row that gets injected into every fork as a HARD rule. Distinct
              from the free-form context below, which is more "vibes". */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Pin className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-[12px] font-medium">Style pins</span>
                <span className="text-[11px] text-zinc-600">
                  · hard constraints every fork must honor
                </span>
              </div>
              <button
                onClick={() => addPin()}
                disabled={saving || draftPins.length >= 12}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-900"
              >
                <Plus className="w-3 h-3" /> add pin
              </button>
            </div>
            <div className="space-y-1">
              {draftPins.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    value={p.prop}
                    onChange={(e) => updatePin(i, { prop: e.target.value })}
                    placeholder="property (e.g. h1 font-weight)"
                    className="flex-1 bg-white border border-zinc-200 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    disabled={saving}
                  />
                  <span className="text-zinc-400 text-[12px]">=</span>
                  <input
                    value={p.value}
                    onChange={(e) => updatePin(i, { value: e.target.value })}
                    placeholder="value (e.g. 800 or #c87050)"
                    className="flex-1 bg-white border border-zinc-200 rounded px-2 py-1 text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                    disabled={saving}
                  />
                  <button
                    onClick={() => removePin(i)}
                    disabled={saving}
                    title="Remove pin"
                    className="text-zinc-400 hover:text-rose-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {draftPins.length === 0 && (
                <div className="text-[11px] text-zinc-500 italic px-2 py-1">
                  No pins. Add one to lock a design choice across all forks.
                </div>
              )}
            </div>
            {/* Quick-add presets — visual + voice grouped so copywriters
                see a column that matters to them, designers see one that
                matters to them. */}
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {PIN_PRESETS.map((group) => (
                <div key={group.heading}>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
                    {group.heading}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {group.pins.map((pre) => {
                      const already = draftPins.some(
                        (p) => p.prop.toLowerCase() === pre.pin.prop.toLowerCase()
                      );
                      return (
                        <button
                          key={pre.label}
                          onClick={() => addPin(pre.pin)}
                          disabled={saving || already}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 hover:border-zinc-400 disabled:opacity-30"
                        >
                          + {pre.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Free-form context — vibes, brand voice, things to preserve. */}
          <div>
            <div className="text-[12px] font-medium mb-1.5 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-sky-600" />
              <span>House style notes</span>
              <span className="text-[10px] text-zinc-500 font-normal">· vibes + must-keeps</span>
            </div>
            <textarea
              value={draftContext}
              onChange={(e) => {
                setDraftContext(e.target.value);
                setSaved(false);
              }}
              placeholder={PLACEHOLDER}
              className="w-full min-h-[220px] bg-white border border-zinc-200 rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-sky-500/40 font-mono"
              disabled={saving}
            />
            <div className="mt-1 text-[11px] text-zinc-500">
              {draftContext.length} chars — injected into the system prompt for every fork.
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-zinc-200 bg-stone-50/60">
          <div className="text-[11px] text-zinc-500">
            {saved && !dirty
              ? "Saved. Will be used on the next fork."
              : dirty
              ? "Unsaved changes."
              : "No changes."}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={closeContextPanel}
              disabled={saving}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900"
            >
              Close
            </button>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded bg-sky-500 hover:bg-sky-400 text-black font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
