import { useEffect, useRef, useState } from "react";

/**
 * The "Saved · Undo" popup. Every settings save offers it; pressing Undo before it disappears puts the
 * previous settings back. Only the latest save can be undone. After an undo, the page reloads its data
 * (the "dashboard:refresh" event) so it shows the restored settings.
 */

const SHOW_MS = 8000;

interface Offer {
  id: number;
  message: string;
  undo: () => Promise<unknown>;
}

type Toast = { kind: "offer"; offer: Offer } | { kind: "info"; id: number; message: string; error?: boolean };

let nextId = 1;
let current: Toast | null = null;
const listeners = new Set<(t: Toast | null) => void>();
const emit = (t: Toast | null) => {
  current = t;
  for (const l of listeners) l(t);
};

/** Shows the popup for a save that can be undone. Replaces any earlier one. */
export function offerUndo(message: string, undo: () => Promise<unknown>) {
  emit({ kind: "offer", offer: { id: nextId++, message, undo } });
}

/** Tells the open page to reload its data, e.g. after an undo. */
export const refreshDashboard = () => window.dispatchEvent(new Event("dashboard:refresh"));

export function UndoToast() {
  const [toast, setToast] = useState<Toast | null>(current);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [left, setLeft] = useState(SHOW_MS);
  const started = useRef(0);

  useEffect(() => {
    listeners.add(setToast);
    return () => {
      listeners.delete(setToast);
    };
  }, []);

  // A new popup starts a fresh countdown.
  const key = toast ? (toast.kind === "offer" ? toast.offer.id : toast.id) : 0;
  useEffect(() => {
    setLeft(toast?.kind === "info" ? 3000 : SHOW_MS);
    setBusy(false);
    setPaused(false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Count down (paused while the mouse is over it, or while undoing).
  useEffect(() => {
    if (!toast || paused || busy) return;
    started.current = Date.now();
    const startLeft = left;
    const timer = setInterval(() => {
      const remaining = startLeft - (Date.now() - started.current);
      if (remaining <= 0) {
        clearInterval(timer);
        emit(null);
      } else setLeft(remaining);
    }, 100);
    return () => clearInterval(timer);
  }, [key, paused, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;
  const total = toast.kind === "info" ? 3000 : SHOW_MS;

  const undo = async () => {
    if (toast.kind !== "offer") return;
    setBusy(true);
    try {
      await toast.offer.undo();
      refreshDashboard();
      emit({ kind: "info", id: nextId++, message: "↩️ Change undone." });
    } catch (err) {
      emit({ kind: "info", id: nextId++, message: `Couldn't undo: ${(err as Error).message}`, error: true });
    }
  };

  return (
    <div
      className={`undo-toast ${toast.kind === "info" && toast.error ? "error" : ""}`}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="undo-text">{toast.kind === "offer" ? `✅ ${toast.offer.message}` : toast.message}</span>
      {toast.kind === "offer" && (
        <button className="undo-btn" disabled={busy} onClick={undo}>
          {busy ? "Undoing…" : "Undo"}
        </button>
      )}
      <button className="undo-close" aria-label="Close" onClick={() => emit(null)}>
        ×
      </button>
      <span className="undo-timer" style={{ width: `${Math.max(0, (left / total) * 100)}%` }} />
    </div>
  );
}
