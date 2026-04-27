import { useEffect, useRef } from "react";
import clsx from "clsx";
import { AlertTriangle, Sparkles, Info } from "lucide-react";
import { useUI } from "@/lib/store";

/**
 * In-app confirm/info modal. Replaces native window.confirm() and
 * window.alert() across the codebase — those freeze the page, can't be
 * styled, and look unprofessional.
 *
 * Renders the head of `dialogQueue` so multiple consecutive showConfirm /
 * showInfo calls queue rather than stacking visually. Esc + backdrop click
 * = cancel (confirm) / dismiss (info). Tab focus is trapped inside the
 * dialog while open; previously-focused element is restored on close.
 */
export default function AppDialog() {
  const { dialogQueue, resolveDialog } = useUI();
  const dialog = dialogQueue[0] ?? null;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Save previously-focused element when a new dialog opens, restore it
  // when the queue empties. Capturing on `dialog?.id` change so chained
  // dialogs don't constantly steal focus from each other's restore target.
  useEffect(() => {
    if (!dialog) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Autofocus the primary button after paint.
    const t = window.setTimeout(() => {
      confirmBtnRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      // When the dialog closes, return focus to whatever had it before.
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === "function") {
        try {
          prev.focus();
        } catch {
          // ignore — element may have been removed from the DOM
        }
      }
    };
  }, [dialog?.id]);

  // Esc cancels (resolve(false) for confirm, resolve(undefined) for info).
  // Tab is trapped inside the dialog. Capture phase + stopPropagation so
  // the App.tsx global Esc handler doesn't also fire (e.g. exiting Compare
  // mode while the user is just trying to dismiss the dialog).
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        resolveDialog(dialog.id, false);
        return;
      }
      if (e.key === "Tab") {
        const root = cardRef.current;
        if (!root) return;
        const focusables = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("data-focus-skip"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !root.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !root.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // Capture so we beat App.tsx's window-level keydown listener (which
    // otherwise hijacks Esc to exit Compare mode).
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dialog, resolveDialog]);

  if (!dialog) return null;

  // Tone-based accent. Danger = rose (delete project, set checkpoint).
  // Default confirm = amber (the rest of the app's primary tone).
  // Info = neutral ivory/cream (matches modal aesthetic).
  // Pull variant-specific fields once with proper narrowing so TS doesn't
  // flag .tone / .cancelLabel access on the info variant.
  const isDanger = dialog.kind === "confirm" && dialog.tone === "danger";
  const isConfirm = dialog.kind === "confirm";
  const accentBorder = isConfirm
    ? isDanger
      ? "border-rose-200"
      : "border-amber-200"
    : "border-zinc-200";
  const iconWrap = isConfirm
    ? isDanger
      ? "bg-rose-50 text-rose-600"
      : "bg-amber-50 text-amber-600"
    : "bg-stone-100 text-zinc-600";
  const Icon = isConfirm ? (isDanger ? AlertTriangle : Sparkles) : Info;
  const confirmLabel = dialog.confirmLabel ?? (isConfirm ? "Confirm" : "Got it");
  const cancelLabel = dialog.kind === "confirm" ? (dialog.cancelLabel ?? "Cancel") : null;
  const confirmBtnClass = isConfirm
    ? isDanger
      ? "bg-rose-500 hover:bg-rose-400 text-white"
      : "bg-amber-500 hover:bg-amber-400 text-black"
    : "bg-zinc-900 hover:bg-zinc-800 text-white";

  return (
    <div
      className="fixed inset-0 z-[60] bg-zinc-900/40 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        // Backdrop click = same as Esc. Use mouseDown on the backdrop only
        // (not click) so a drag that started inside the card and ended on
        // the backdrop doesn't accidentally dismiss.
        if (e.target === e.currentTarget) {
          resolveDialog(dialog.id, false);
        }
      }}
      role="presentation"
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialog.title ? `appdialog-title-${dialog.id}` : undefined}
        aria-describedby={`appdialog-msg-${dialog.id}`}
        className={clsx(
          "w-full max-w-md bg-stone-50 border rounded-xl shadow-2xl",
          accentBorder
        )}
      >
        <div className="p-5 flex items-start gap-3">
          <div
            className={clsx(
              "flex items-center justify-center w-9 h-9 rounded-full shrink-0",
              iconWrap
            )}
            aria-hidden="true"
          >
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            {dialog.title && (
              <h2
                id={`appdialog-title-${dialog.id}`}
                className="text-base font-medium text-zinc-900 mb-1"
              >
                {dialog.title}
              </h2>
            )}
            {/* Multi-line message: keep `\n` as visible line breaks via
                whitespace-pre-wrap so existing alert/confirm strings (which
                use \n liberally) render readably without manual <br> work. */}
            <p
              id={`appdialog-msg-${dialog.id}`}
              className="text-[13px] text-zinc-700 leading-snug whitespace-pre-wrap break-words"
            >
              {dialog.message}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-200 bg-stone-50/60 rounded-b-xl">
          {cancelLabel && (
            <button
              onClick={() => resolveDialog(dialog.id, false)}
              className="px-3 py-1.5 text-sm text-zinc-600 hover:text-zinc-900"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            onClick={() => resolveDialog(dialog.id, true)}
            className={clsx(
              "px-4 py-1.5 text-sm rounded font-medium",
              confirmBtnClass
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
