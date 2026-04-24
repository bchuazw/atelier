import { useEffect, useState } from "react";
import { X, BookOpen, Loader2, Save } from "lucide-react";
import { api } from "@/lib/api";
import { useUI } from "@/lib/store";

const PLACEHOLDER = `e.g.,

Audience: early-stage founders comparing CRMs.
Brand voice: confident but not corporate — punchy, human, no em-dashes.
Palette: warm neutrals + a single accent (coral or terracotta).
Must preserve: the pricing table, the footer logo cluster, the "Book a demo" CTA.
Avoid: stock photography, generic testimonials, gradient text.`;

export default function ContextPanel() {
  const { contextPanelOpen, closeContextPanel, project, setProject } = useUI();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (contextPanelOpen) {
      setDraft(project?.context ?? "");
      setSaved(false);
    }
  }, [contextPanelOpen, project?.context]);

  if (!contextPanelOpen) return null;

  async function save() {
    if (!project) return;
    setSaving(true);
    try {
      const res = await api.patchProject(project.id, { context: draft });
      setProject({ ...project, context: res.context });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const dirty = (project?.context ?? "") !== draft;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="text-base font-medium">Project context</h2>
              <p className="text-[11px] text-zinc-500">
                Preferences and constraints the agent reads before every fork. Brand, audience,
                do's and don'ts — anything that should shape variants.
              </p>
            </div>
          </div>
          <button onClick={closeContextPanel} className="text-zinc-400 hover:text-zinc-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaved(false);
            }}
            placeholder={PLACEHOLDER}
            className="w-full min-h-[320px] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-sky-500/40 font-mono"
            disabled={saving}
          />
          <div className="mt-2 text-[11px] text-zinc-500">
            {draft.length} chars — injected into the system prompt for every fork.
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-zinc-800 bg-zinc-950/60">
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
              className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100"
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
