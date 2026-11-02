import { eq } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { raidState } from "../../server/db/schema.js";
import { getFeatureState } from "../../server/settings.js";
import type { AntiRaidSettings } from "../../shared/antiRaid.js";
import { antiRaidFeature } from "../../shared/features.js";

/**
 * Anti-raid state: settings cache, servers in raid mode, and recent joins.
 * Kept free of Discord actions so other features (onboarding) can ask "is a raid on?" without import loops.
 */

export type RaidRow = typeof raidState.$inferSelect;

/* ------------------------------------------------------------ settings cache */

const cache = new Map<string, { at: number; enabled: boolean; settings: AntiRaidSettings }>();
const CACHE_MS = 30_000;

/** Read on every join, so kept for a short while instead of hitting the database each time. */
export async function getState(guildId: string): Promise<{ enabled: boolean; settings: AntiRaidSettings }> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const state = await getFeatureState(guildId, antiRaidFeature);
  const entry = { at: Date.now(), enabled: state.enabled, settings: state.settings as AntiRaidSettings };
  cache.set(guildId, entry);
  return entry;
}

export const forgetState = (guildId: string) => cache.delete(guildId);

/* ------------------------------------------------------------ raid mode */

/** Servers in raid mode right now (mirrors the raid_state table). */
const raids = new Map<string, RaidRow>();

export const getRaid = (guildId: string) => raids.get(guildId) ?? null;
/** Whether a server is in raid mode. Onboarding uses this to skip welcome and goodbye messages for raiders. */
export const isRaidActive = (guildId: string) => raids.has(guildId);
export const activeRaids = () => [...raids.values()];

export async function loadRaids() {
  raids.clear();
  for (const row of await db.select().from(raidState).all()) raids.set(row.guildId, row);
}

export async function saveRaid(row: RaidRow) {
  raids.set(row.guildId, row);
  const { guildId, ...rest } = row;
  await db.insert(raidState).values(row).onConflictDoUpdate({ target: raidState.guildId, set: rest }).run();
}

export async function deleteRaid(guildId: string) {
  raids.delete(guildId);
  await db.delete(raidState).where(eq(raidState.guildId, guildId)).run();
}

/* ------------------------------------------------------------ recent joins (memory only) */

/** Who joined each server recently. Only IDs and times, for at most 5 minutes. */
const joins = new Map<string, { userId: string; at: number }[]>();
const KEEP_MS = 5 * 60_000;

/** Records a join and returns everyone who joined within the last `seconds` (including this one). */
export function recordJoin(guildId: string, userId: string, seconds: number) {
  const now = Date.now();
  const list = (joins.get(guildId) ?? []).filter((j) => now - j.at < KEEP_MS && j.userId !== userId);
  list.push({ userId, at: now });
  joins.set(guildId, list);
  return list.filter((j) => now - j.at < seconds * 1000);
}

export const joinsSince = (guildId: string, ms: number) => (joins.get(guildId) ?? []).filter((j) => Date.now() - j.at < ms).length;

export function sweepJoins() {
  const now = Date.now();
  for (const [guildId, list] of joins) {
    const kept = list.filter((j) => now - j.at < KEEP_MS);
    if (kept.length) joins.set(guildId, kept);
    else joins.delete(guildId);
  }
}

export const forgetJoins = (guildId: string) => joins.delete(guildId);

/* ------------------------------------------------------------ counters */

const young = new Map<string, number>();
export const youngCount = (guildId: string) => young.get(guildId) ?? 0;
export const countYoung = (guildId: string) => young.set(guildId, youngCount(guildId) + 1);
