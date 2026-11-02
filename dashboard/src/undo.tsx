import { useEffect, useState } from "react";

/**
 * A plain timed Undo button, top right, shown after every settings save. Clicking it before it runs out
 * puts the previous settings back and reloads the page's settings, so its Save button is disabled until the
 * next change. The Undo button then stays, disabled, until its time runs out. Only the latest save can be undone.
 */

const SHOW_MS = 8000;

interface Offer {
  id: number;
  undo: () => Promise<unknown>;
}

let nextId = 1;
let current: Offer | null = null;
const listeners = new Set<(o: Offer | null) => void>();
const emit = (o: Offer | null) => {
  current = o;
  for (const l of listeners) l(o);
};

/** Shows the Undo button for a save. Replaces any earlier one. */
export function offerUndo(undo: () => Promise<unknown>) {
  emit({ id: nextId++, undo });
}

/** Tells the open page to reload its data, e.g. after an undo. */
export const refreshDashboard = () => window.dispatchEvent(new Event("dashboard:refresh"));

export function UndoToast() {
  const [offer, setOffer] = useState<Offer | null>(current);
  const [state, setState] = useState<"ready" | "undoing" | "undone" | "failed">("ready");

  useEffect(() => {
    listeners.add(setOffer);
    return () => {
      listeners.delete(setOffer);
    };
  }, []);

  // Each new save starts the countdown again; it disappears when time runs out.
  useEffect(() => {
    setState("ready");
    if (!offer) return;
    const timer = setTimeout(() => emit(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [offer]);

  if (!offer) return null;

  const undo = async () => {
    setState("undoing");
    try {
      await offer.undo();
      setState("undone");
      refreshDashboard();
    } catch {
      setState("failed");
    }
  };

  return (
    <button key={offer.id} className="undo-toast" disabled={state !== "ready"} onClick={undo}>
      {state === "undoing" ? "Undoing…" : state === "undone" ? "↩ Undone" : state === "failed" ? "Couldn't undo" : "↩ Undo"}
      <span className="undo-timer" style={{ animationDuration: `${SHOW_MS}ms` }} />
    </button>
  );
}
