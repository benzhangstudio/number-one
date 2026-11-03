import { z } from "zod";

/**
 * Levels: members earn XP by chatting and level up. Settings shared by the bot and the dashboard.
 * Defaults work without setup: 15–25 XP per message, at most once a minute, and a level-up
 * message in the channel where the member was chatting.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const DEFAULT_LEVEL_UP = "🎉 GG {user}, you reached **level {level}**!";
export const MAX_REWARDS = 25;
export const MAX_LEVEL = 500;
/** Biggest single XP change /xp and the dashboard allow. */
export const MAX_XP_CHANGE = 10_000_000;

export const levelUpPlaces = ["same", "channel", "dm", "off"] as const;
export type LevelUpPlace = (typeof levelUpPlaces)[number];

export const levelReward = z.object({
  level: z.number().int().min(1).max(MAX_LEVEL),
  roleId: snowflake,
});
export type LevelReward = z.infer<typeof levelReward>;

export const levelsSettings = z.object({
  /** XP for one message is picked at random between these two. */
  xpMin: z.number().int().min(1).max(100).default(15),
  xpMax: z.number().int().min(1).max(100).default(25),
  /** Messages within this many seconds of the last XP-giving one give nothing (stops spam farming). */
  cooldownSeconds: z.number().int().min(0).max(3600).default(60),
  /** Channels (or categories) where chatting gives no XP. Threads follow their parent channel. */
  noXpChannelIds: z.array(snowflake).max(50).default([]),
  /** Members with any of these roles get no XP. */
  noXpRoleIds: z.array(snowflake).max(25).default([]),
  levelUp: z
    .object({
      /** "same" = the channel they were chatting in, "channel" = a chosen channel, "dm" = privately, "off" = no message. */
      where: z.enum(levelUpPlaces).default("same"),
      channelId: snowflake.nullable().default(null),
      message: z.string().max(1000).default(DEFAULT_LEVEL_UP),
    })
    .prefault({}),
  /** Roles given when members reach a level. */
  rewards: z.array(levelReward).max(MAX_REWARDS).default([]),
  /** On: members keep every reward role they've earned. Off: only the highest one, older ones are taken away. */
  keepOldRewards: z.boolean().default(true),
});

export type LevelsSettings = z.infer<typeof levelsSettings>;

/** Placeholders admins can use in the level-up message. */
export const LEVEL_PLACEHOLDERS = [
  { key: "{user}", means: "mentions the member" },
  { key: "{username}", means: "the member's name" },
  { key: "{level}", means: "the level they reached" },
  { key: "{server}", means: "the server's name" },
] as const;

/* ------------------------------------------------------------ level math */

/** XP needed to go from `level` to `level + 1`. Grows gently: 100, 155, 220, 295… */
export const xpToNext = (level: number) => 5 * level * level + 50 * level + 100;

/** Total XP needed to reach `level` from zero. */
export function totalXpFor(level: number) {
  let total = 0;
  for (let l = 0; l < level; l++) total += xpToNext(l);
  return total;
}

/** A member's level and progress towards the next one, from their total XP. */
export function levelInfo(xp: number) {
  let level = 0;
  let rest = Math.max(0, xp);
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, xpIntoLevel: rest, xpForNext: xpToNext(level) };
}

/* ------------------------------------------------------------ dashboard */

export interface LeaderboardEntry {
  userId: string;
  name: string;
  avatar: string | null;
  xp: number;
  level: number;
  messages: number;
}

export interface LevelsResponse {
  settings: LevelsSettings;
  /** Role and channel problems, in plain words. */
  problems: string[];
  /** Members with any XP. */
  members: number;
  leaderboard: LeaderboardEntry[];
}
