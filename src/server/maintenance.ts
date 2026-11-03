import { eq } from "drizzle-orm";
import { DEFAULT_MAINTENANCE_MESSAGE, type MaintenanceInput, type MaintenanceState } from "../shared/botUpdates.js";
import { db } from "./db/client.js";
import { botState } from "./db/schema.js";

/**
 * Maintenance mode: while it's on, every command, button and form gets a short "under maintenance" reply
 * instead of running (the bot's developer can still use everything, to test). Things that happen on their own,
 * like auto-moderation, logs and XP, keep working. It's saved in the database, so it survives restarts,
 * and switches itself off at its end time if one was set.
 */

const KEY = "maintenance";
const OFF: MaintenanceState = { on: false, message: "", until: null, since: null };

let state: MaintenanceState = OFF;
let endTimer: NodeJS.Timeout | undefined;
const listeners = new Set<(s: MaintenanceState) => void>();

export const getMaintenance = (): MaintenanceState => ({ ...state });
export const isMaintenance = () => state.on;

/** Runs `fn` whenever maintenance is switched on or off (used to update the bot's status). */
export function onMaintenanceChange(fn: (s: MaintenanceState) => void) {
  listeners.add(fn);
}

/** The reply people get while maintenance is on. */
export function maintenanceReply() {
  const back = state.until ? `\n-# Expected back <t:${Math.floor(state.until / 1000)}:R>.` : "";
  return `🛠️ ${state.message || DEFAULT_MAINTENANCE_MESSAGE}${back}`;
}

function scheduleEnd() {
  clearTimeout(endTimer);
  endTimer = undefined;
  if (!state.on || !state.until) return;
  // setTimeout can't wait longer than about 24 days, so check again later when the end is further away.
  const wait = Math.min(state.until - Date.now(), 2 ** 31 - 1);
  endTimer = setTimeout(() => {
    if (state.until && Date.now() >= state.until) void setMaintenance({ on: false, message: state.message, until: null });
    else scheduleEnd();
  }, Math.max(0, wait));
  endTimer.unref();
}

async function save(next: MaintenanceState) {
  const values = { value: next as unknown as Record<string, unknown>, updatedAt: new Date() };
  await db
    .insert(botState)
    .values({ key: KEY, ...values })
    .onConflictDoUpdate({ target: botState.key, set: values })
    .run();
}

/** Switches maintenance on, changes its message or end time, or switches it off. */
export async function setMaintenance(input: MaintenanceInput) {
  const next: MaintenanceState = input.on
    ? { on: true, message: input.message, until: input.until, since: state.on ? state.since : Date.now() }
    : { ...OFF, message: input.message };
  await save(next);
  const changed = next.on !== state.on;
  state = next;
  scheduleEnd();
  console.log(`[maintenance] ${next.on ? `on${next.until ? ` until ${new Date(next.until).toISOString()}` : ""}` : "off"}`);
  if (changed || next.on) for (const fn of listeners) fn(getMaintenance());
  return getMaintenance();
}

/** Reads the saved state once the database is ready. An end time that passed while offline switches it off. */
export async function loadMaintenance() {
  const row = await db.select().from(botState).where(eq(botState.key, KEY)).get();
  const saved = row?.value as Partial<MaintenanceState> | undefined;
  if (!saved?.on) {
    state = { ...OFF, message: typeof saved?.message === "string" ? saved.message : "" };
    return;
  }
  state = { on: true, message: String(saved.message ?? ""), until: saved.until ?? null, since: saved.since ?? Date.now() };
  if (state.until && state.until <= Date.now()) await setMaintenance({ on: false, message: state.message, until: null });
  else {
    scheduleEnd();
    console.log("[maintenance] still on from before the restart");
  }
}
