import { AlertTriangle, X, BookOpen } from "lucide-react";
import { useUI } from "@/lib/store";

/**
 * Persistent banner shown when an SSE fork job emits `cost-capped`. The
 * project's lifetime spend has hit its user-set cap, so we explain what
 * happened and give the user a one-click jump to the cap input in the
 * Project Context panel. Sits below the top bar (not a transient toast)
 * so the message stays put while the user decides whether to raise the cap.
 *
 * Dismissed only by the user clicking X or by `dismissCostCapBanner()`
 * (e.g. after a successful fork once the cap is raised).
 */
export default function CostCapBanner() {
  const { costCapBanner, dismissCostCapBanner, openContextPanel } = useUI();
  if (!costCapBanner) return null;
  const total = (costCapBanner.total_cost_cents / 100).toFixed(2);
  const cap = (costCapBanner.cost_cap_cents / 100).toFixed(2);

  function openAndHighlight() {
    openContextPanel();
    // Defer the highlight ping until after the panel has mounted + its
    // own useEffect has rehydrated the draft cap field. ContextPanel
    // listens for this event and scrolls + highlights the cap row.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("atelier:focus-cap-input"));
    }, 60);
  }

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-40 w-[min(640px,calc(100%-32px))] flex items-start gap-3 px-4 py-3 rounded-lg bg-rose-50 border border-rose-300 shadow-lg"
      role="alert"
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 text-rose-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-rose-900">Cost cap reached</div>
        <div className="text-[12px] text-rose-800 leading-snug mt-0.5">
          This project has spent ${total} of its ${cap} cap. Raise the cap in
          Project Context to keep iterating.
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={openAndHighlight}
            className="flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white"
          >
            <BookOpen className="w-3 h-3" />
            Open Project Context
          </button>
          <button
            onClick={dismissCostCapBanner}
            className="text-[11.5px] px-2.5 py-1 rounded border border-rose-300 text-rose-800 hover:bg-rose-100"
          >
            Dismiss
          </button>
        </div>
      </div>
      <button
        onClick={dismissCostCapBanner}
        className="text-rose-500 hover:text-rose-900 shrink-0"
        title="Dismiss"
        aria-label="Dismiss cost-cap banner"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
