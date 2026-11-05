import { sqlite } from "../../server/db/client.js";
import * as economy from "../economy/store.js";

/**
 * The card game's saved data: what each member owns and their team, per server. Like the economy store it
 * uses plain synchronous SQL, so a purchase, sale or trade changes cards and money in one all-or-nothing step.
 */

const sql = {
  owned: "SELECT quantity FROM card_inventory WHERE guild_id = ? AND user_id = ? AND card_id = ?",
  add: `INSERT INTO card_inventory (guild_id, user_id, card_id, quantity, first_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id, card_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
  take: "UPDATE card_inventory SET quantity = quantity - ? WHERE guild_id = ? AND user_id = ? AND card_id = ? AND quantity >= ?",
  dropEmpty: "DELETE FROM card_inventory WHERE guild_id = ? AND user_id = ? AND card_id = ? AND quantity <= 0",
  all: "SELECT card_id, quantity, first_at FROM card_inventory WHERE guild_id = ? AND user_id = ?",
  player: "SELECT team, last_daily_at, wins_day, wins_today, wins, losses FROM card_players WHERE guild_id = ? AND user_id = ?",
  makePlayer: "INSERT INTO card_players (guild_id, user_id, team) VALUES (?, ?, '[]') ON CONFLICT DO NOTHING",
  setTeam: "UPDATE card_players SET team = ? WHERE guild_id = ? AND user_id = ?",
  bag: "SELECT standard_packs, premium_packs FROM card_players WHERE guild_id = ? AND user_id = ?",
  addStandard: "UPDATE card_players SET standard_packs = standard_packs + ? WHERE guild_id = ? AND user_id = ?",
  addPremium: "UPDATE card_players SET premium_packs = premium_packs + ? WHERE guild_id = ? AND user_id = ?",
  takeStandard: "UPDATE card_players SET standard_packs = standard_packs - 1 WHERE guild_id = ? AND user_id = ? AND standard_packs > 0",
  takePremium: "UPDATE card_players SET premium_packs = premium_packs - 1 WHERE guild_id = ? AND user_id = ? AND premium_packs > 0",
  setDaily: "UPDATE card_players SET last_daily_at = ? WHERE guild_id = ? AND user_id = ?",
  setWins: "UPDATE card_players SET wins_day = ?, wins_today = ?, wins = wins + ?, losses = losses + ? WHERE guild_id = ? AND user_id = ?",
  top: `SELECT user_id, COUNT(*) AS uniq, SUM(quantity) AS total FROM card_inventory WHERE guild_id = ?
        GROUP BY user_id ORDER BY uniq DESC, total DESC LIMIT ?`,
  stats: "SELECT COUNT(DISTINCT user_id) AS collectors, COALESCE(SUM(quantity), 0) AS owned FROM card_inventory WHERE guild_id = ?",
};

const prepared = new Map<keyof typeof sql, ReturnType<typeof sqlite.prepare>>();
const q = (key: keyof typeof sql) => {
  let s = prepared.get(key);
  if (!s) prepared.set(key, (s = sqlite.prepare(sql[key])));
  return s;
};

function atomic<T>(fn: () => T): T {
  try {
    sqlite.exec("BEGIN IMMEDIATE");
  } catch {
    return fn(); // already inside a transaction
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

class NotEnough extends Error {}

/* ------------------------------------------------------------ cards */

export const ownedCount = (guildId: string, userId: string, cardId: string) =>
  Number((q("owned").get(guildId, userId, cardId) as { quantity: number } | undefined)?.quantity ?? 0);

function addInside(guildId: string, userId: string, cardIds: string[]) {
  const now = Date.now();
  for (const id of cardIds) q("add").run(guildId, userId, id, 1, now);
}

function takeInside(guildId: string, userId: string, cardId: string, quantity: number) {
  if (q("take").run(quantity, guildId, userId, cardId, quantity).changes === 0) throw new NotEnough();
  q("dropEmpty").run(guildId, userId, cardId);
}

export const addCards = (guildId: string, userId: string, cardIds: string[]) => atomic(() => addInside(guildId, userId, cardIds));

/** Everything a member owns: card ID → how many. */
export function collectionOf(guildId: string, userId: string) {
  const rows = q("all").all(guildId, userId) as { card_id: string; quantity: number; first_at: number }[];
  return new Map(rows.map((r) => [r.card_id, r.quantity]));
}

export type StoredPack = "standard" | "premium";
export type Bag = Record<StoredPack, number>;

/** Packs a member bought and hasn't opened yet. */
export function bagOf(guildId: string, userId: string): Bag {
  q("makePlayer").run(guildId, userId);
  const r = q("bag").get(guildId, userId) as { standard_packs: number; premium_packs: number };
  return { standard: r.standard_packs, premium: r.premium_packs };
}

export type BuyResult = { ok: true; balance: number; bag: Bag } | { ok: false; balance: number };

/** Takes the price of `amount` packs and puts them in the member's bag, all or nothing. */
export function buyPacks(guildId: string, userId: string, kind: StoredPack, amount: number, priceEach: number, startingBalance: number): BuyResult {
  return atomic(() => {
    const total = priceEach * amount;
    const paid = total > 0 ? economy.spend(guildId, userId, total, "cards", startingBalance) : { ok: true as const, balance: economy.peek(guildId, userId, startingBalance).balance };
    if (!paid.ok) return paid;
    q("makePlayer").run(guildId, userId);
    q(kind === "standard" ? "addStandard" : "addPremium").run(amount, guildId, userId);
    return { ok: true as const, balance: paid.balance, bag: bagOf(guildId, userId) };
  });
}

/** Puts packs in a member's bag for free (the developer giving them out). Returns the new bag. */
export function givePacks(guildId: string, userId: string, kind: StoredPack, amount: number): Bag {
  return atomic(() => {
    q("makePlayer").run(guildId, userId);
    q(kind === "standard" ? "addStandard" : "addPremium").run(amount, guildId, userId);
    return bagOf(guildId, userId);
  });
}

/** Opens one pack from the bag: takes it out and adds its cards. Null when they have none of that kind. */
export function openFromBag(guildId: string, userId: string, kind: StoredPack, cardIds: string[]): Bag | null {
  return atomic(() => {
    q("makePlayer").run(guildId, userId);
    if (q(kind === "standard" ? "takeStandard" : "takePremium").run(guildId, userId).changes === 0) return null;
    addInside(guildId, userId, cardIds);
    return bagOf(guildId, userId);
  });
}

/** Sells cards for `each` apiece. Returns null when they don't have that many. */
export function sell(guildId: string, userId: string, sales: { cardId: string; quantity: number; each: number }[], startingBalance: number) {
  try {
    return atomic(() => {
      let earned = 0;
      for (const s of sales) {
        takeInside(guildId, userId, s.cardId, s.quantity);
        earned += s.quantity * s.each;
      }
      const balance = earned > 0 ? economy.credit(guildId, userId, earned, "cards", { startingBalance }).balance : economy.peek(guildId, userId, startingBalance).balance;
      return { earned, balance };
    });
  } catch (err) {
    if (err instanceof NotEnough) return null;
    throw err;
  }
}

/** Swaps one card each way (or gives one, when `back` is null). False when either side no longer has theirs. */
export function swap(guildId: string, fromId: string, give: string, toId: string, back: string | null) {
  try {
    return atomic(() => {
      takeInside(guildId, fromId, give, 1);
      if (back) takeInside(guildId, toId, back, 1);
      addInside(guildId, toId, [give]);
      if (back) addInside(guildId, fromId, [back]);
      return true;
    });
  } catch (err) {
    if (err instanceof NotEnough) return false;
    throw err;
  }
}

/* ------------------------------------------------------------ players */

export interface Player {
  team: string[];
  lastDailyAt: number | null;
  winsDay: string | null;
  winsToday: number;
  wins: number;
  losses: number;
}

export function playerOf(guildId: string, userId: string): Player {
  q("makePlayer").run(guildId, userId);
  const r = q("player").get(guildId, userId) as { team: string; last_daily_at: number | null; wins_day: string | null; wins_today: number; wins: number; losses: number };
  return { team: JSON.parse(r.team) as string[], lastDailyAt: r.last_daily_at, winsDay: r.wins_day, winsToday: r.wins_today, wins: r.wins, losses: r.losses };
}

export const setTeam = (guildId: string, userId: string, team: string[]) => {
  q("makePlayer").run(guildId, userId);
  q("setTeam").run(JSON.stringify(team), guildId, userId);
};

/** Opens the daily pack: false when it isn't ready yet. */
export function claimDaily(guildId: string, userId: string, cooldownMs: number, cardIds: string[]) {
  return atomic(() => {
    const p = playerOf(guildId, userId);
    if (p.lastDailyAt && Date.now() - p.lastDailyAt < cooldownMs) return false;
    q("setDaily").run(Date.now(), guildId, userId);
    addInside(guildId, userId, cardIds);
    return true;
  });
}

const today = () => new Date().toISOString().slice(0, 10);

/** Records a battle result. Returns how many rewarded wins they've had today (after this one). */
export function recordBattle(guildId: string, userId: string, won: boolean) {
  const p = playerOf(guildId, userId);
  const winsToday = (p.winsDay === today() ? p.winsToday : 0) + (won ? 1 : 0);
  q("setWins").run(today(), winsToday, won ? 1 : 0, won ? 0 : 1, guildId, userId);
  return winsToday;
}

/* ------------------------------------------------------------ server totals */

export const topCollectors = (guildId: string, limit = 10) =>
  (q("top").all(guildId, limit) as { user_id: string; uniq: number; total: number }[]).map((r) => ({ userId: r.user_id, unique: Number(r.uniq), total: Number(r.total) }));

export const serverStats = (guildId: string) => {
  const r = q("stats").get(guildId) as { collectors: number; owned: number };
  return { collectors: Number(r.collectors), owned: Number(r.owned) };
};
