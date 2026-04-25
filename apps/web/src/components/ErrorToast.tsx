import { AlertCircle, X } from "lucide-react";
import { useUI } from "@/lib/store";

/**
 * Non-blocking error notification. Replaces every prior `alert()` call —
 * a native alert freezes the page (which broke Playwright + felt
 * unprofessional). Sits at top-right so it doesn't fight the bottom UndoToast.
 */
export default function ErrorToast() {
  const { errorToast, dismissError } = useUI();
  if (!errorToast) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex items-start gap-2 max-w-sm px-3 py-2.5 rounded-lg bg-rose-50 border border-rose-300 shadow-xl animate-in fade-in slide-in-from-top-2"
      role="alert"
    >
      <AlertCircle className="w-4 h-4 mt-0.5 text-rose-600 shrink-0" />
      <div className="flex-1 text-[12.5px] leading-snug text-rose-900">{errorToast.message}</div>
      <button
        onClick={dismissError}
        className="text-rose-500 hover:text-rose-900 shrink-0"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
