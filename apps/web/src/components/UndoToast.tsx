import { useEffect, useState } from "react";
import { Undo2, X } from "lucide-react";
import { useUI } from "@/lib/store";

/**
 * Persistent floating toast that appears when a destructive action has
 * been staged with `stagePendingUndo`. Counts down to commit so the user
 * always knows how long they have to recover.
 *
 * Action is committed automatically by the store's setTimeout; clicking
 * Undo cancels (and restores the snapshot from the store), clicking
 * Dismiss flushes immediately.
 */
export default function UndoToast() {
  const { pendingUndo, cancelPendingUndo, flushPendingUndo } = useUI();
  const [now, setNow] = useState(() => Date.now());

  // Drive the countdown.
  useEffect(() => {
    if (!pendingUndo) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [pendingUndo]);

  if (!pendingUndo) return null;

  const remaining = Math.max(0, pendingUndo.expiresAt - now);
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-lg bg-zinc-900 text-zinc-100 shadow-2xl border border-zinc-700 animate-in fade-in slide-in-from-bottom-2"
      role="status"
    >
      <span className="text-[13px]">{pendingUndo.label}</span>
      <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-mono">
        {seconds}s
      </span>
      <span className="w-px h-4 bg-zinc-700" />
      <button
        onClick={cancelPendingUndo}
        className="flex items-center gap-1 text-[12px] text-amber-300 hover:text-amber-200 font-medium"
        title="Restore — bring it back"
      >
        <Undo2 className="w-3.5 h-3.5" /> Undo
      </button>
      <button
        onClick={() => void flushPendingUndo()}
        className="text-zinc-500 hover:text-zinc-200"
        title="Dismiss — commit the action immediately"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
