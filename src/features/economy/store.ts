import type { StatementSync } from "node:sqlite";
import { sqlite } from "../../server/db/client.js";
import { DAILY_COOLDOWN_HOURS, HISTORY_DAYS, MAX_BALANCE, STREAK_GRACE_HOURS, type TransactionKind } from "../../shared/economy.js";

/**
 * Balances and their history. Every change runs as one synchronous SQLite transaction, with no
 * `await` inside, so two commands at the same moment can never interleave: a payment can't spend
 * the same coins twice, and a balance never goes below zero or above MAX_BALANCE.
 * (Drizzle's queries are async here, so this file talks to node:sqlite directly.)
 */

export interface Wallet {
  balance: number;
  dailyStreak: number;
  lastDailyAt: number | null;
  lastWorkAt: number | null;
}

type Row = { balance: number; daily_streak: number; last_daily_at: number | null; last_work_at: number | null };

const sql = {
  get: "SELECT balance, daily_streak, last_daily_at, last_work_at FROM economy_balances WHERE guild_id = ? AND user_id = ?",
  create: "INSERT OR IGNORE INTO economy_balances (guild_id, user_id, balance, daily_streak, updated_at) VALUES (?, ?, ?, 0, ?)",
  setBalance: "UPDATE economy_balances SET balance = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?",
  setDaily: "UPDATE economy_balances SET daily_streak = ?, last_daily_at = ? WHERE guild_id = ? AND user_id = ?",
  setWork: "UPDATE economy_balances SET last_work_at = ? WHERE guild_id = ? AND user_id = ?",
  log: "INSERT INTO economy_transactions (guild_id, user_id, amount, balance_after, kind, other_user_id, by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  rankAbove: "SELECT COUNT(*) AS n FROM economy_balances WHERE guild_id = ? AND balance > ?",
  holders: "SELECT COUNT(*) AS n, COALESCE(SUM(balance), 0) AS total FROM economy_balances WHERE guild_id = ? AND balance > 0",
  top: "SELECT user_id, balance FROM economy_balances WHERE guild_id = ? AND balance > 0 ORDER BY balance DESC, user_id LIMIT ? OFFSET ?",
  history: "SELECT id, user_id, amount, balance_after, kind, other_user_id, created_at FROM economy_transactions WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?",
  activity: "SELECT id, user_id, amount, balance_after, kind, other_user_id, created_at FROM economy_transactions WHERE guild_id = ? AND kind NOT IN ('chat', 'pay_in') ORDER BY id DESC LIMIT ?",
  prune: "DELETE FROM economy_transactions WHERE created_at < ?",
  wipeBalances: "DELETE FROM economy_balances WHERE guild_id = ?",
  wipeHistory: "DELETE FROM economy_transactions WHERE guild_id = ?",
  wipeInventory: "DELETE FROM economy_inventory WHERE guild_id = ?",
  item: "SELECT id, price, stock, max_per_member, role_id, hidden FROM economy_shop_items WHERE guild_id = ? AND id = ?",
  itemSold: "UPDATE economy_shop_items SET sold = MAX(0, sold + ?), stock = CASE WHEN stock IS NULL THEN NULL ELSE MAX(0, stock - ?) END WHERE id = ?",
  owned: "SELECT quantity FROM economy_inventory WHERE guild_id = ? AND user_id = ? AND item_id = ?",
  addOwned:
    "INSERT INTO economy_inventory (guild_id, user_id, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at",
  setOwned: "UPDATE economy_inventory SET quantity = ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND item_id = ?",
  dropOwned: "DELETE FROM economy_inventory WHERE guild_id = ? AND user_id = ? AND item_id = ? AND quantity <= 0",
  inventory:
    "SELECT i.item_id AS item_id, i.quantity AS quantity FROM economy_inventory i JOIN economy_shop_items s ON s.id = i.item_id WHERE i.guild_id = ? AND i.user_id = ? AND i.quantity > 0 ORDER BY s.position, s.id",
};

/**
 * Statements are prepared the first time they're used, not when this file loads:
 * on the first start after an update, the tables only exist once the migrations have run.
 */
const prepared = new Map<string, StatementSync>();
const q = new Proxy({} as Record<keyof typeof sql, StatementSync>, {
  get(_, key: keyof typeof sql) {
    let s = prepared.get(key);
    if (!s) prepared.set(key, (s = sqlite.prepare(sql[key])));
    return s;
  },
});

/** Runs `fn` as one transaction. `fn` must not await anything. */
function atomic<T>(fn: () => T): T {
  try {
    sqlite.exec("BEGIN IMMEDIATE");
  } catch {
    // Another transaction is already open (e.g. a server's data being deleted). `fn` is synchronous,
    // so running it inside that one is still all-or-nothing.
    return fn();
  }
  try {
    const result = fn();
    sqlite.exec("COMMIT");
    return result;
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }
}

const toWallet = (r: Row): Wallet => ({ balance: r.balance, dailyStreak: r.daily_streak, lastDailyAt: r.last_daily_at, lastWorkAt: r.last_work_at });

/** Reads a wallet, creating it with the starting balance the first time (inside a transaction). */
function load(guildId: string, userId: string, startingBalance: number): Wallet {
  const now = Date.now();
  const created = q.create.run(guildId, userId, startingBalance, now).changes > 0;
  if (created && startingBalance > 0) q.log.run(guildId, userId, startingBalance, startingBalance, "start", null, null, now);
  return toWallet(q.get.get(guildId, userId) as Row);
}

/** Reads a wallet without creating one. Members who never earned anything show the starting balance. */
export function peek(guildId: string, userId: string, startingBalance: number): Wallet {
  const row = q.get.get(guildId, userId) as Row | undefined;
  return row ? toWallet(row) : { balance: startingBalance, dailyStreak: 0, lastDailyAt: null, lastWorkAt: null };
}

/** Changes the balance by `amount` and records it. Assumes it's already inside a transaction. */
function apply(guildId: string, userId: string, wallet: Wallet, amount: number, kind: TransactionKind, other: string | null = null, by: string | null = null) {
  const after = Math.min(MAX_BALANCE, Math.max(0, wallet.balance + amount));
  const real = after - wallet.balance;
  q.setBalance.run(after, Date.now(), guildId, userId);
  // Chatting pays every minute, which would flood the history, so it's left out of it.
  if (real !== 0 && kind !== "chat") q.log.run(guildId, userId, real, after, kind, other, by, Date.now());
  wallet.balance = after;
  return real;
}

/** Adds (or with a negative amount, takes) money. Taking more than they have leaves them at zero. */
export function credit(guildId: string, userId: string, amount: number, kind: TransactionKind, opts: { startingBalance: number; by?: string }) {
  return atomic(() => {
    const w = load(guildId, userId, opts.startingBalance);
    const changed = apply(guildId, userId, w, amount, kind, null, opts.by ?? null);
    return { balance: w.balance, changed };
  });
}

/** Sets a balance to an exact amount (staff only). */
export function setBalance(guildId: string, userId: string, value: number, opts: { startingBalance: number; by: string }) {
  return atomic(() => {
    const w = load(guildId, userId, opts.startingBalance);
    apply(guildId, userId, w, value - w.balance, "admin", null, opts.by);
    return w.balance;
  });
}

export type PayResult = { ok: true; fromBalance: number; toBalance: number } | { ok: false; reason: "broke" | "full"; balance: number };

/** Moves money from one member to another, all or nothing. */
export function pay(guildId: string, fromId: string, toId: string, amount: number, startingBalance: number): PayResult {
  return atomic(() => {
    const from = load(guildId, fromId, startingBalance);
    const to = load(guildId, toId, startingBalance);
    if (from.balance < amount) return { ok: false, reason: "broke", balance: from.balance };
    if (to.balance + amount > MAX_BALANCE) return { ok: false, reason: "full", balance: from.balance };
    apply(guildId, fromId, from, -amount, "pay_out", toId);
    apply(guildId, toId, to, amount, "pay_in", fromId);
    return { ok: true, fromBalance: from.balance, toBalance: to.balance };
  });
}

const HOUR = 60 * 60 * 1000;

export type DailyResult = { ok: true; amount: number; bonus: number; streak: number; balance: number } | { ok: false; nextAt: number };

/**
 * Claims /daily: once every 20 hours. Claiming again within 48 hours of the last claim keeps the streak going.
 * `reward(streak)` returns the base amount and the streak bonus for that day.
 */
export function claimDaily(guildId: string, userId: string, startingBalance: number, reward: (streak: number) => { amount: number; bonus: number }): DailyResult {
  return atomic(() => {
    const w = load(guildId, userId, startingBalance);
    const now = Date.now();
    if (w.lastDailyAt && now - w.lastDailyAt < DAILY_COOLDOWN_HOURS * HOUR) return { ok: false, nextAt: w.lastDailyAt + DAILY_COOLDOWN_HOURS * HOUR };
    const streak = w.lastDailyAt && now - w.lastDailyAt <= STREAK_GRACE_HOURS * HOUR ? w.dailyStreak + 1 : 1;
    const r = reward(streak);
    q.setDaily.run(streak, now, guildId, userId);
    apply(guildId, userId, w, r.amount + r.bonus, "daily");
    return { ok: true, amount: r.amount, bonus: r.bonus, streak, balance: w.balance };
  });
}

export type WorkResult = { ok: true; amount: number; balance: number } | { ok: false; nextAt: number };

/** Claims /work, once per cooldown. */
export function claimWork(guildId: string, userId: string, startingBalance: number, cooldownMinutes: number, amount: number): WorkResult {
  return atomic(() => {
    const w = load(guildId, userId, startingBalance);
    const now = Date.now();
    const next = (w.lastWorkAt ?? 0) + cooldownMinutes * 60_000;
    if (w.lastWorkAt && now < next) return { ok: false, nextAt: next };
    q.setWork.run(now, guildId, userId);
    apply(guildId, userId, w, amount, "work");
    return { ok: true, amount, balance: w.balance };
  });
}

/* ------------------------------------------------------------ shop */

export type BuyResult =
  | { ok: true; cost: number; balance: number; owned: number }
  | { ok: false; reason: "gone" | "broke" | "stock" | "limit"; balance: number; left?: number };

type ItemRow = { id: number; price: number; stock: number | null; max_per_member: number | null; role_id: string | null; hidden: number };

/**
 * Buys `quantity` of a shop item, all or nothing: takes the money, lowers the stock and adds it to their
 * inventory. Price, stock and limits are read again here, so two people can't buy the last one.
 */
export function buy(guildId: string, userId: string, itemId: number, quantity: number, startingBalance: number): BuyResult {
  return atomic(() => {
    const w = load(guildId, userId, startingBalance);
    const item = q.item.get(guildId, itemId) as ItemRow | undefined;
    if (!item || item.hidden) return { ok: false, reason: "gone", balance: w.balance };
    const owned = Number((q.owned.get(guildId, userId, itemId) as { quantity: number } | undefined)?.quantity ?? 0);
    const limit = item.role_id ? 1 : item.max_per_member;
    if (limit !== null && owned + quantity > limit) return { ok: false, reason: "limit", balance: w.balance, left: Math.max(0, limit - owned) };
    if (item.stock !== null && item.stock < quantity) return { ok: false, reason: "stock", balance: w.balance, left: item.stock };
    const cost = item.price * quantity;
    if (w.balance < cost) return { ok: false, reason: "broke", balance: w.balance };
    apply(guildId, userId, w, -cost, "shop");
    q.itemSold.run(quantity, quantity, itemId);
    q.addOwned.run(guildId, userId, itemId, quantity, Date.now());
    return { ok: true, cost, balance: w.balance, owned: owned + quantity };
  });
}

/** Undoes a purchase that couldn't be delivered (like a role Number One couldn't give): money, stock and inventory go back. */
export function refundPurchase(guildId: string, userId: string, itemId: number, quantity: number, cost: number, startingBalance: number) {
  return atomic(() => {
    const w = load(guildId, userId, startingBalance);
    apply(guildId, userId, w, cost, "refund");
    q.itemSold.run(-quantity, -quantity, itemId);
    takeOwnedInside(guildId, userId, itemId, quantity);
    return w.balance;
  });
}

function takeOwnedInside(guildId: string, userId: string, itemId: number, quantity: number) {
  const owned = Number((q.owned.get(guildId, userId, itemId) as { quantity: number } | undefined)?.quantity ?? 0);
  const left = Math.max(0, owned - quantity);
  q.setOwned.run(left, Date.now(), guildId, userId, itemId);
  q.dropOwned.run(guildId, userId, itemId);
  return { had: owned, left };
}

/** Takes items out of a member's inventory (staff marking something as used, for example). */
export const takeOwned = (guildId: string, userId: string, itemId: number, quantity: number) => atomic(() => takeOwnedInside(guildId, userId, itemId, quantity));

export const ownedCount = (guildId: string, userId: string, itemId: number) =>
  Number((q.owned.get(guildId, userId, itemId) as { quantity: number } | undefined)?.quantity ?? 0);

export const inventoryOf = (guildId: string, userId: string) =>
  (q.inventory.all(guildId, userId) as { item_id: number; quantity: number }[]).map((r) => ({ itemId: r.item_id, quantity: r.quantity }));

/* ------------------------------------------------------------ games */

export type BetResult = { ok: true; balance: number } | { ok: false; balance: number };

/** Takes a bet, only if they have enough. Winnings are paid back with credit(…, "game"). */
export function placeBet(guildId: string, userId: string, amount: number, startingBalance: number): BetResult {
  return atomic(() => {
    const w = load(guildId, userId, startingBalance);
    if (w.balance < amount) return { ok: false, balance: w.balance };
    apply(guildId, userId, w, -amount, "game");
    return { ok: true, balance: w.balance };
  });
}

/* ------------------------------------------------------------ rankings */

/** 1 = richest. Members tied on balance share a rank. */
export const rankOf = (guildId: string, balance: number) => Number((q.rankAbove.get(guildId, balance) as { n: number }).n) + 1;

export function holders(guildId: string) {
  const r = q.holders.get(guildId) as { n: number; total: number };
  return { count: Number(r.n), total: Number(r.total) };
}

export const richest = (guildId: string, limit: number, offset = 0) =>
  (q.top.all(guildId, limit, offset) as { user_id: string; balance: number }[]).map((r) => ({ userId: r.user_id, balance: r.balance }));

export interface Tx {
  id: number;
  userId: string;
  amount: number;
  balanceAfter: number;
  kind: TransactionKind;
  otherUserId: string | null;
  at: number;
}
type TxRow = { id: number; user_id: string; amount: number; balance_after: number; kind: string; other_user_id: string | null; created_at: number };
const toTx = (r: TxRow): Tx => ({ id: r.id, userId: r.user_id, amount: r.amount, balanceAfter: r.balance_after, kind: r.kind as TransactionKind, otherUserId: r.other_user_id, at: r.created_at });

export const historyOf = (guildId: string, userId: string, limit: number) => (q.history.all(guildId, userId, limit) as TxRow[]).map(toTx);
export const recentActivity = (guildId: string, limit: number) => (q.activity.all(guildId, limit) as TxRow[]).map(toTx);

/** Deletes history older than HISTORY_DAYS, in every server. */
export const pruneHistory = () => q.prune.run(Date.now() - HISTORY_DAYS * 24 * HOUR).changes;

/** Wipes every balance, the history and what members bought in one server. Shop items stay. */
export const resetGuild = (guildId: string) =>
  atomic(() => {
    q.wipeBalances.run(guildId);
    q.wipeHistory.run(guildId);
    q.wipeInventory.run(guildId);
  });
