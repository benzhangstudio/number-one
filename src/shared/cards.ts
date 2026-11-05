import { z } from "zod";
import { type CardGroup, cardGroups } from "./cardCatalog.js";

/**
 * The BLACKPINK card game: shapes shared by the bot and the dashboard.
 * Members open packs, collect cards, build a team of 3 and battle Number One or each other, Pokémon-style:
 * each card has a type, HP and a move, and types beat each other in a cycle. Cards can be traded and gifted.
 *
 * Cards live in piles: one per member, ship (like Chaelisa) and the whole group (src/shared/cardCatalog.ts).
 * The bot's developer adds cards on the Developer page: every uploaded photo becomes a card in its pile, with
 * its own name, rarity and type, and a pile can have any number of them. Packs pull at random from every
 * active card, weighted by rarity, like a gacha.
 *
 * Two modes, picked per server:
 * - With Economy: packs cost the server's Economy currency, duplicates sell for it, and battle wins pay it.
 * - Cards only: no money at all. Members get a free daily pack and play just for fun.
 */

/* ------------------------------------------------------------ rarities, types and versions */

export const rarities = ["common", "rare", "epic", "legendary", "mythic"] as const;
export type Rarity = (typeof rarities)[number];

export const rarityInfo: Record<Rarity, { name: string; stars: number; color: string; hp: [number, number]; power: [number, number] }> = {
  common: { name: "Common", stars: 1, color: "#a7adba", hp: [60, 80], power: [18, 26] },
  rare: { name: "Rare", stars: 2, color: "#4fa3ff", hp: [80, 100], power: [24, 32] },
  epic: { name: "Epic", stars: 3, color: "#b06bff", hp: [100, 120], power: [30, 38] },
  legendary: { name: "Legendary", stars: 4, color: "#ffb300", hp: [120, 140], power: [36, 44] },
  mythic: { name: "Mythic", stars: 5, color: "#ff4fa3", hp: [150, 170], power: [44, 52] },
};

/** Types beat the next one in the cycle: Fierce › Fresh › Dreamy › Sweet › Elegant › Fierce. */
export const cardTypes = ["fierce", "fresh", "dreamy", "sweet", "elegant"] as const;
export type CardType = (typeof cardTypes)[number];

export const typeInfo: Record<CardType, { name: string; emoji: string; color: string; move: string }> = {
  fierce: { name: "Fierce", emoji: "🔥", color: "#ff5a3c", move: "Spotlight Blaze" },
  fresh: { name: "Fresh", emoji: "🌿", color: "#3fbf6f", move: "Summer Breeze" },
  dreamy: { name: "Dreamy", emoji: "🌙", color: "#7c6cf0", move: "Moonlight Melody" },
  sweet: { name: "Sweet", emoji: "🍬", color: "#ff7eb6", move: "Sugar Rush" },
  elegant: { name: "Elegant", emoji: "💎", color: "#3cc4e6", move: "Diamond Pose" },
};

/** How much a type's move does against another type: ×1.5 when it's strong, ×0.75 when it's weak. */
export function typeBonus(attacker: CardType, defender: CardType) {
  const a = cardTypes.indexOf(attacker);
  const d = cardTypes.indexOf(defender);
  if ((a + 1) % cardTypes.length === d) return 1.5;
  if ((d + 1) % cardTypes.length === a) return 0.75;
  return 1;
}

/* ------------------------------------------------------------ piles and cards */

/** A pile: a member, ship or the group, like "blackpink.jennie" or "blackpink.chaelisa". */
export interface Pile {
  key: string;
  groupId: string;
  groupName: string;
  subject: string;
  kind: "member" | "ship" | "group";
  /** Who's on a ship or group card, like "Rosé & Lisa". Empty for members. */
  about: string;
  color: string;
}

export const piles: Pile[] = cardGroups.flatMap((g) =>
  g.members.map((m) => ({ key: `${g.id}.${m.id}`, groupId: g.id, groupName: g.name, subject: m.name, kind: m.kind, about: m.about, color: g.color })),
);
export const pileByKey = new Map(piles.map((p) => [p.key, p]));

export interface Card {
  /** Never changes, like "blackpink.jennie.k3f9x2" (the pile, then a random part). */
  id: string;
  /** 1, 2, 3… in the order cards were added. */
  number: number;
  pile: string;
  groupId: string;
  groupName: string;
  /** Who's on it: "Jennie", "Chaelisa" or "BLACKPINK". */
  subject: string;
  kind: Pile["kind"];
  about: string;
  /** The card's own name, like "Pink Venom" or "Airport". */
  name: string;
  rarity: Rarity;
  type: CardType;
  hp: number;
  power: number;
  color: string;
  /** Photo credit, shown small on the card. */
  credit: string;
  /** Only active cards come out of packs. Members keep the ones they have either way. */
  active: boolean;
  /** ms since 1970: the photo or details last changed. */
  updatedAt: number;
}

/** A small, steady hash: the same text always gives the same number. */
export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const between = ([lo, hi]: [number, number], seed: number) => lo + (seed % (hi - lo + 1));

/**
 * A card's HP and power, from its rarity (and a hash of its ID, so they don't change). Ship cards get 10 more HP
 * and the group card 20 more: more people, more HP.
 */
export function statsFor(id: string, rarity: Rarity, kind: Pile["kind"]) {
  const h = hash(id);
  const r = rarityInfo[rarity];
  return {
    hp: Math.round(between(r.hp, h >>> 3) / 5) * 5 + (kind === "ship" ? 10 : kind === "group" ? 20 : 0),
    power: between(r.power, h >>> 11),
  };
}

/** A type for a new card, picked from a hash of its ID. */
export const typeFor = (id: string): CardType => cardTypes[hash(id) % cardTypes.length];

/** "Jennie · Pink Venom" */
export const cardLabel = (c: Card) => `${c.subject} · ${c.name}`;

/** How strong a card is overall, for sorting and picking teams. */
export const cardScore = (c: Card) => c.hp + c.power * 3;

/* ------------------------------------------------------------ packs */

export const packKinds = ["standard", "premium", "daily"] as const;
export type PackKind = (typeof packKinds)[number];

/** Chance of each rarity per card, in percent. */
export const packOdds: Record<PackKind, Record<Rarity, number>> = {
  standard: { common: 70, rare: 22, epic: 6.4, legendary: 1.5, mythic: 0.1 },
  premium: { common: 40, rare: 35, epic: 18, legendary: 6, mythic: 1 },
  daily: { common: 70, rare: 22, epic: 6.4, legendary: 1.5, mythic: 0.1 },
};

export const packInfo: Record<PackKind, { name: string; emoji: string; size: number; about: string }> = {
  standard: { name: "Standard pack", emoji: "📦", size: 5, about: "5 cards." },
  premium: { name: "Premium pack", emoji: "💝", size: 5, about: "5 cards with much better odds. At least one Epic or better." },
  daily: { name: "Daily pack", emoji: "🎁", size: 3, about: "3 free cards every day." },
};

/* ------------------------------------------------------------ settings */

const price = z.number().int().min(0).max(1_000_000);

export const cardModes = ["economy", "cards"] as const;
export type CardMode = (typeof cardModes)[number];

export const cardSettings = z.object({
  /** "economy" = packs cost money and duplicates sell for it. "cards" = no money at all. */
  mode: z.enum(cardModes).default("economy"),
  /** Pack prices in the server's Economy currency (With Economy mode). 0 = free. */
  prices: z
    .object({
      standard: price.default(200),
      premium: price.default(750),
    })
    .prefault({}),
  /** What one card sells for, by rarity (With Economy mode). */
  sell: z
    .object({
      common: price.default(5),
      rare: price.default(20),
      epic: price.default(75),
      legendary: price.default(300),
      mythic: price.default(1500),
    })
    .prefault({}),
  /** A free pack of 3 cards every 20 hours. */
  daily: z.boolean().default(true),
  battles: z
    .object({
      enabled: z.boolean().default(true),
      /** Paid for beating Number One, for the first few wins each day (With Economy mode). */
      winReward: price.default(40),
      rewardedWinsPerDay: z.number().int().min(0).max(50).default(5),
      /** Members can bet on battles against each other (With Economy mode). */
      bets: z.boolean().default(true),
    })
    .prefault({}),
  trading: z.boolean().default(true),
});
export type CardSettings = z.infer<typeof cardSettings>;

/* ------------------------------------------------------------ dashboard */

export interface CardCollectorView {
  userId: string;
  name: string;
  unique: number;
  total: number;
}

export interface CardsResponse {
  settings: CardSettings;
  /** The mode actually in use: With Economy falls back to Cards only while Economy is switched off. */
  mode: CardMode;
  economyOff: boolean;
  /** Active cards that can come out of packs. */
  ready: number;
  currency: { singular: string; plural: string; emoji: string };
  stats: { owned: number; collectors: number; catalog: number };
  top: CardCollectorView[];
  problems: string[];
}

/* ------------------------------------------------------------ managing cards (Developer page) */

export const CARD_PHOTO = {
  /** The photo area on a card, in pixels (photos are cropped to fill it). */
  width: 624,
  height: 624,
  /** Largest upload. */
  maxBytes: 8 * 1024 * 1024,
  name: 40,
  credit: 60,
} as const;

/** What the developer can change about a card. */
export const cardEdit = z.object({
  name: z.string().trim().min(1, "Give the card a name").max(CARD_PHOTO.name),
  rarity: z.enum(rarities),
  type: z.enum(cardTypes),
  credit: z.string().trim().max(CARD_PHOTO.credit).default(""),
  active: z.boolean(),
});
export type CardEdit = z.infer<typeof cardEdit>;

export interface PileView extends Pile {
  /** Cards in the pile, and how many of them are active. */
  count: number;
  active: number;
  /** The newest card, to show on the pile's tile. */
  cover: { id: string; updatedAt: number } | null;
}

export interface CardAdminResponse {
  piles: PileView[];
  total: number;
  active: number;
}

/** A pile's cards, newest first, and how many members own each. */
export interface PileCardsResponse {
  cards: (Card & { owned: number })[];
}
