import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { devUpdateDeliveries, devUpdates } from "../../server/db/schema.js";
import type { BotUpdateInput, BotUpdateOutcome } from "../../shared/botUpdates.js";

export type UpdateRow = typeof devUpdates.$inferSelect;

export const createUpdate = (input: BotUpdateInput, createdBy: string) =>
  db.insert(devUpdates).values({ ...input, createdBy, createdAt: new Date(), status: "sending" }).returning().get();

export const getUpdate = (id: number) => db.select().from(devUpdates).where(eq(devUpdates.id, id)).get();

export const listUpdates = (limit = 30) => db.select().from(devUpdates).orderBy(desc(devUpdates.id)).limit(limit).all();

export const unfinishedUpdates = () => db.select().from(devUpdates).where(eq(devUpdates.status, "sending")).all();

export const markDone = (id: number) => db.update(devUpdates).set({ status: "done" }).where(eq(devUpdates.id, id)).run();

/** Servers already handled for this update, so a restart never posts twice. */
export async function handledGuildIds(id: number): Promise<Set<string>> {
  const rows = await db.select({ guildId: devUpdateDeliveries.guildId }).from(devUpdateDeliveries).where(eq(devUpdateDeliveries.updateId, id)).all();
  return new Set(rows.map((r) => r.guildId));
}

export const recordDelivery = (updateId: number, guildId: string, outcome: BotUpdateOutcome, reason = "") =>
  db
    .insert(devUpdateDeliveries)
    .values({ updateId, guildId, outcome, reason, deliveredAt: new Date() })
    .onConflictDoNothing()
    .run();

/** Sent / failed counts for several updates, keyed by update ID. */
export async function countsFor(ids: number[]) {
  const out = new Map<number, { sent: number; failed: number }>();
  for (const id of ids) out.set(id, { sent: 0, failed: 0 });
  if (!ids.length) return out;
  const rows = await db
    .select({ id: devUpdateDeliveries.updateId, outcome: devUpdateDeliveries.outcome, n: sql<number>`count(*)` })
    .from(devUpdateDeliveries)
    .where(inArray(devUpdateDeliveries.updateId, ids))
    .groupBy(devUpdateDeliveries.updateId, devUpdateDeliveries.outcome)
    .all();
  for (const r of rows) out.get(r.id)![r.outcome] = Number(r.n);
  return out;
}

export const failuresFor = (id: number) =>
  db
    .select({ guildId: devUpdateDeliveries.guildId, reason: devUpdateDeliveries.reason })
    .from(devUpdateDeliveries)
    .where(and(eq(devUpdateDeliveries.updateId, id), eq(devUpdateDeliveries.outcome, "failed")))
    .all();
