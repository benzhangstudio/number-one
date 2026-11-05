import { z } from "zod";
import { type CardGroup, cardGroups, generationNames, groupById } from "./cardCatalog.js";

export { generationNames };

/**
 * The K-pop card game: shapes shared by the bot and the dashboard.
 * Members open packs, collect cards, build a team of 3 and battle Number One or each other, Pokémon-style:
 * each card has a type, HP and a move, and types beat each other in a cycle. Cards can be traded and gifted.
 *
 * Two modes, picked per server:
 * - With Economy: packs cost the server's Economy currency, duplicates sell for it, and battle wins pay it.
 * - Cards only: no money at all. Members get a free daily pack and play just for fun.
 *
 * Every card is made from the catalog (src/shared/cardCatalog.ts): six versions per member, plus a Mythic
 * for BLACKPINK. Stats come from a hash of the card's ID, so they never change between restarts. Each card
 * shows a real photo the bot's developer uploaded; cards without a photo aren't in packs yet.
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

export const versions = [
  { id: "debut", name: "Debut Day", rarity: "common" },
  { id: "practice", name: "Practice Room", rarity: "common" },
  { id: "comeback", name: "Comeback", rarity: "rare" },
  { id: "stage", name: "Live Stage", rarity: "rare" },
  { id: "award", name: "Award Night", rarity: "epic" },
  { id: "legend", name: "Legend", rarity: "legendary" },
] as const satisfies readonly { id: string; name: string; rarity: Rarity }[];

/** Extra versions only some groups have. */
const specialVersions: Record<string, { id: string; name: string; rarity: Rarity }[]> = {
  blackpink: [{ id: "crown", name: "Pink Crown", rarity: "mythic" }],
};

/* ------------------------------------------------------------ cards */

export interface Card {
  /** "group.member.version", like "blackpink.jennie.legend". Never changes. */
  id: string;
  /** 1, 2, 3… across the whole catalog. */
  number: number;
  groupId: string;
  groupName: string;
  gen: CardGroup["gen"];
  memberName: string;
  version: string;
  rarity: Rarity;
  type: CardType;
  hp: number;
  power: number;
  color: string;
}

/** A small, steady hash: the same text always gives the same number. */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const between = ([lo, hi]: [number, number], seed: number) => lo + (seed % (hi - lo + 1));

function makeCards() {
  const cards: Card[] = [];
  for (const g of cardGroups) {
    for (const m of g.members) {
      for (const v of [...versions, ...(specialVersions[g.id] ?? [])]) {
        const id = `${g.id}.${m.id}.${v.id}`;
        const h = hash(id);
        const r = rarityInfo[v.rarity];
        cards.push({
          id,
          number: cards.length + 1,
          groupId: g.id,
          groupName: g.name,
          gen: g.gen,
          memberName: m.name,
          version: v.name,
          rarity: v.rarity,
          type: cardTypes[h % cardTypes.length],
          hp: Math.round(between(r.hp, h >>> 3) / 5) * 5,
          power: between(r.power, h >>> 11),
          color: g.color,
        });
      }
    }
  }
  return cards;
}

export const cards: Card[] = makeCards();
export const cardById = new Map(cards.map((c) => [c.id, c]));
export const CARD_COUNT = cards.length;

/** "Jennie · Legend (BLACKPINK)" */
export const cardLabel = (c: Card) => `${c.memberName} · ${c.version} (${c.groupName})`;

/** How strong a card is overall, for sorting and picking teams. */
export const cardScore = (c: Card) => c.hp + c.power * 3;

/* ------------------------------------------------------------ packs */

export const packKinds = ["standard", "premium", "featured", "daily"] as const;
export type PackKind = (typeof packKinds)[number];

/** Chance of each rarity per card, in percent. */
export const packOdds: Record<PackKind, Record<Rarity, number>> = {
  standard: { common: 70, rare: 22, epic: 6.4, legendary: 1.5, mythic: 0.1 },
  premium: { common: 40, rare: 35, epic: 18, legendary: 6, mythic: 1 },
  featured: { common: 55, rare: 28, epic: 12, legendary: 4.5, mythic: 0.5 },
  daily: { common: 70, rare: 22, epic: 6.4, legendary: 1.5, mythic: 0.1 },
};

export const packInfo: Record<PackKind, { name: string; emoji: string; size: number; about: string }> = {
  standard: { name: "Standard pack", emoji: "📦", size: 5, about: "5 cards from every group." },
  premium: { name: "Premium pack", emoji: "💝", size: 5, about: "5 cards with much better odds. At least one Epic or better." },
  featured: { name: "Featured pack", emoji: "🌟", size: 5, about: "5 cards, all from the featured group." },
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
      featured: price.default(500),
    })
    .prefault({}),
  /** The group in the Featured pack. */
  featuredGroup: z.string().default("blackpink"),
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
  /** Which generations' groups are in packs. */
  generations: z
    .array(z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5)]))
    .min(1, "Keep at least one generation")
    .default([2, 3, 4, 5]),
});
export type CardSettings = z.infer<typeof cardSettings>;

/** The member a card belongs to, like "blackpink.jennie": a photo uploaded for it is used for all their cards. */
export const memberKey = (cardId: string) => cardId.split(".").slice(0, 2).join(".");

/** The cards packs can give in a server: only cards with a photo, from its generations (or the featured group). */
export function packPool(s: CardSettings, kind: PackKind, hasPhoto: (c: Card) => boolean) {
  const featured = groupById.has(s.featuredGroup) ? s.featuredGroup : "blackpink";
  if (kind === "featured") return cards.filter((c) => c.groupId === featured && hasPhoto(c));
  // BLACKPINK is always in packs, even when 3rd gen is switched off.
  return cards.filter((c) => (s.generations.includes(c.gen) || c.groupId === "blackpink") && hasPhoto(c));
}

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
  /** Cards that have a photo and can come out of packs, in this server. */
  ready: number;
  currency: { singular: string; plural: string; emoji: string };
  stats: { owned: number; collectors: number; catalog: number };
  top: CardCollectorView[];
  problems: string[];
}

/* ------------------------------------------------------------ photos (Developer page) */

export const CARD_PHOTO = {
  /** The photo area on a card, in pixels (photos are cropped to fill it). */
  width: 624,
  height: 624,
  /** Largest upload. */
  maxBytes: 8 * 1024 * 1024,
  credit: 60,
} as const;

export interface CardPhotoInfo {
  credit: string;
  updatedAt: number;
}

export interface CardPhotosResponse {
  /** Photo key ("group.member" or a card ID) → its info. */
  photos: Record<string, CardPhotoInfo>;
  /** Cards that have a photo (their own or their member's). */
  ready: number;
  total: number;
}
