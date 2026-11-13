import { z } from "zod";

/**
 * Economy: a currency each server names itself, earned by chatting, /daily, /work and level-ups,
 * and moved between members with /pay. Settings shared by the bot and the dashboard.
 * Members spend it in the shop (items and roles that admins set up).
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Highest balance anyone can hold, so numbers stay exact. */
export const MAX_BALANCE = 1_000_000_000_000;
/** Biggest single /pay or admin change. */
export const MAX_CHANGE = 1_000_000_000;
/** How long the history of balance changes is kept. */
export const HISTORY_DAYS = 90;
/** How often /daily can be claimed, and how long a streak survives without a claim. */
export const DAILY_COOLDOWN_HOURS = 20;
export const STREAK_GRACE_HOURS = 48;

const amount = (max: number) => z.number().int().min(0).max(max);

export const economySettings = z.object({
  currency: z
    .object({
      /** Used for 1: "1 coin". */
      singular: z.string().trim().min(1).max(32).default("coin"),
      /** Used for everything else: "250 coins". */
      plural: z.string().trim().min(1).max(32).default("coins"),
      /** A normal emoji or a custom one like <:gem:123…>. */
      emoji: z.string().trim().min(1).max(64).default("🪙"),
    })
    .prefault({}),
  /** What a member has the first time they show up. */
  startingBalance: amount(1_000_000).default(0),
  chat: z
    .object({
      enabled: z.boolean().default(true),
      min: amount(1000).default(1),
      max: amount(1000).default(5),
      cooldownSeconds: z.number().int().min(0).max(3600).default(60),
      /** Channels (or categories) where chatting earns nothing. Threads follow their parent. */
      noEarnChannelIds: z.array(snowflake).max(50).default([]),
    })
    .prefault({}),
  daily: z
    .object({
      enabled: z.boolean().default(true),
      amount: amount(1_000_000).default(100),
      /** Extra for each day in a row, on top of the amount. */
      streakBonus: amount(100_000).default(10),
      /** The streak bonus stops growing here. */
      maxStreakBonus: amount(1_000_000).default(100),
    })
    .prefault({}),
  work: z
    .object({
      enabled: z.boolean().default(true),
      min: amount(1_000_000).default(20),
      max: amount(1_000_000).default(80),
      cooldownMinutes: z.number().int().min(1).max(24 * 60).default(60),
    })
    .prefault({}),
  /** Paid every time someone reaches a new level (needs Levels switched on). 0 = nothing. */
  levelUpReward: amount(1_000_000).default(50),
  /** Members can send each other money with /pay. */
  payEnabled: z.boolean().default(true),
  /** Members can ask to be @mentioned when /daily or /work is ready again (opt-in, with a button). */
  reminders: z.boolean().default(true),
  /** The shop: /shop, /buy and /inventory. Items are set up on the dashboard. */
  shop: z
    .object({
      enabled: z.boolean().default(true),
    })
    .prefault({}),
});

export type EconomySettings = z.infer<typeof economySettings>;
export type CurrencySettings = EconomySettings["currency"];

/** "🪙 **1,250** coins" */
export const formatMoney = (c: CurrencySettings, value: number, bold = true) => {
  const num = value.toLocaleString("en-US");
  return `${c.emoji} ${bold ? `**${num}**` : num} ${Math.abs(value) === 1 ? c.singular : c.plural}`;
};

/** The streak bonus for a /daily claim on day `streak` (1 = first day, no bonus). */
export const streakBonus = (s: EconomySettings["daily"], streak: number) => Math.min(s.maxStreakBonus, Math.max(0, streak - 1) * s.streakBonus);

/* ------------------------------------------------------------ history */

export const transactionKinds = {
  start: "Starting balance",
  chat: "Chatting",
  daily: "Daily reward",
  work: "Work",
  level: "Level-up reward",
  pay_in: "Received",
  pay_out: "Sent",
  admin: "Changed by staff",
  shop: "Shop",
  refund: "Refund",
  /** Removed features, kept so their past history entries still show a name. */
  game: "Games",
  cards: "Card game",
} as const;
export type TransactionKind = keyof typeof transactionKinds;

/* ------------------------------------------------------------ shop */

export const SHOP_LIMITS = {
  name: 50,
  description: 200,
  /** Items per server. */
  items: 50,
  /** Most of one item a member can buy in one go. */
  quantity: 100,
} as const;

export const shopItemInput = z.object({
  name: z.string().trim().min(1, "Give the item a name").max(SHOP_LIMITS.name),
  description: z.string().trim().max(SHOP_LIMITS.description).default(""),
  /** A normal emoji or a custom one like <:gem:123…>. Empty = none. */
  emoji: z.string().trim().max(64).default(""),
  price: z.number().int().min(1, "The price has to be at least 1").max(MAX_CHANGE),
  /** Buying it gives this role. Members can only buy a role once. */
  roleId: snowflake.nullable().default(null),
  /** How many are left to sell. Null = unlimited. */
  stock: z.number().int().min(0).max(1_000_000).nullable().default(null),
  /** Most one member can own. Null = no limit. Roles are always 1. */
  maxPerMember: z.number().int().min(1).max(1_000_000).nullable().default(null),
  /** Hidden items can't be seen or bought. */
  hidden: z.boolean().default(false),
});
export type ShopItemInput = z.infer<typeof shopItemInput>;

export interface ShopItemView extends ShopItemInput {
  id: number;
  /** How many have been bought in total. */
  sold: number;
}

/* ------------------------------------------------------------ dashboard */

export interface EconomyMember {
  userId: string;
  name: string;
  avatar: string | null;
  balance: number;
}

export interface EconomyActivity {
  id: number;
  userId: string;
  name: string;
  amount: number;
  kind: TransactionKind;
  /** The other member, for payments. */
  otherName: string | null;
  at: number;
}

export interface EconomyResponse {
  settings: EconomySettings;
  shopItems: ShopItemView[];
  problems: string[];
  /** Members with a balance above zero, and what they hold together. */
  holders: number;
  totalMoney: number;
  richest: EconomyMember[];
  /** Latest balance changes, chatting left out (there are too many to be useful). */
  activity: EconomyActivity[];
}
