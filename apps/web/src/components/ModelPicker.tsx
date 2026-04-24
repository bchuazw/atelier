import clsx from "clsx";
import type { ModelId } from "@/lib/api";

const MODELS: { id: ModelId; label: string; hint: string }[] = [
  { id: "haiku", label: "Haiku", hint: "fastest" },
  { id: "sonnet", label: "Sonnet", hint: "balanced" },
  { id: "opus", label: "Opus", hint: "highest quality" },
];

/**
 * Tiny pill-group picker for the Claude model. Shared across PromptBar,
 * FeedbackDialog, CriticsDialog.
 */
export default function ModelPicker({
  value,
  onChange,
  disabled,
  compact = false,
}: {
  value: ModelId;
  onChange: (m: ModelId) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={clsx("inline-flex items-center gap-0.5 rounded border border-zinc-200 bg-white p-0.5", compact && "text-[10px]")}>
      {MODELS.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          disabled={disabled}
          title={m.hint}
          className={clsx(
            "px-1.5 py-0.5 rounded text-[10px] font-medium transition",
            value === m.id
              ? "bg-amber-200 text-amber-800"
              : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100",
            disabled && "opacity-50"
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
