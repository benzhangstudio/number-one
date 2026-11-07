import { z } from "zod";

/**
 * Channel designs (Cosmetics): templates that add a cute decoration around every channel's name,
 * like "general" → "💬・general". The name itself is never changed, and the original is saved,
 * so a design can be swapped for another or removed completely.
 * Shared by the bot (to rename channels) and the dashboard (to show the preview).
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Discord's longest channel name. */
export const MAX_CHANNEL_NAME = 100;
export const MAX_SKIPPED = 50;

export interface DesignTemplate {
  id: string;
  name: string;
  /** {emoji} is a picture that fits the channel (💬 for general, 📜 for rules…), {name} is the channel's name. */
  pattern: string;
  /** Emoji used when nothing fits the channel's name. */
  fallback: string;
}

export const designTemplates: DesignTemplate[] = [
  { id: "dot", name: "Soft dot", pattern: "{emoji}・{name}", fallback: "🌸" },
  { id: "ribbon", name: "Ribbon", pattern: "୨{emoji}୧{name}", fallback: "🎀" },
  { id: "moon", name: "Moonlight", pattern: "☾{emoji}・{name}", fallback: "🌙" },
  { id: "fairy", name: "Fairy dust", pattern: "˚₊‧{emoji}‧₊˚{name}", fallback: "🧚" },
  { id: "bracket", name: "Corner brackets", pattern: "「{emoji}」{name}", fallback: "🍡" },
  { id: "bar", name: "Clean bar", pattern: "{emoji}｜{name}", fallback: "📌" },
  { id: "wave", name: "Soft wave", pattern: "{emoji}〜{name}", fallback: "🐚" },
  { id: "arrow", name: "Arrow", pattern: "{emoji}➜{name}", fallback: "📍" },
];

/** Designs that were replaced, and the one servers that had them now get. */
const replacedTemplates: Record<string, string> = {
  bow: "ribbon",
  butterfly: "ribbon",
  cloud: "ribbon",
  sparkle: "moon",
  line: "bar",
  heart: "wave",
};

/** Emojis picked from words in a channel's name. The first match wins, so more specific words come first. */
const EMOJI_WORDS: [RegExp, string][] = [
  [/announce|news|update/, "📢"],
  [/rule/, "📜"],
  [/welcome|greet/, "👋"],
  [/intro/, "🙋"],
  [/verif/, "✅"],
  [/role/, "🎭"],
  [/giveaway/, "🎁"],
  [/event/, "🎉"],
  [/suggest|idea|feedback/, "💡"],
  [/help|support|ticket|question/, "🆘"],
  [/staff|mod|admin/, "🛡️"],
  [/log|audit/, "📋"],
  [/bot|command|cmd/, "🤖"],
  [/meme|funny|joke/, "🤣"],
  [/art|draw|creative|design/, "🎨"],
  [/photo|pic|selfie|media|image|screenshot/, "📸"],
  [/video|clip|stream|live/, "🎬"],
  [/music|song|playlist|karaoke/, "🎵"],
  [/game|gaming|play|minecraft|valorant|fortnite/, "🎮"],
  [/anime|manga/, "🍥"],
  [/movie|film|tv|show/, "🍿"],
  [/book|read|study|homework|school/, "📚"],
  [/code|dev|program/, "💻"],
  [/pet|cat|dog|animal/, "🐾"],
  [/food|cook|bake|snack/, "🍰"],
  [/vent|feel|mental/, "🫂"],
  [/count/, "🔢"],
  [/quote/, "💭"],
  [/partner|promo|advert|self-?promo/, "🤝"],
  [/birthday|bday/, "🎂"],
  [/off-?topic|random|misc/, "🌀"],
  [/lounge|hangout|chill|afk/, "🛋️"],
  [/voice|vc|talk|call/, "🔊"],
  [/general|chat|main|lobby/, "💬"],
];

export function emojiFor(name: string, fallback: string): string {
  const n = name.toLowerCase();
  return EMOJI_WORDS.find(([words]) => words.test(n))?.[1] ?? fallback;
}

/** The decorated name for a channel, or null if it would be too long for Discord. */
export function decorate(name: string, template: DesignTemplate): string | null {
  const result = template.pattern.replace("{emoji}", emojiFor(name, template.fallback)).replace("{name}", name);
  return [...result].length <= MAX_CHANNEL_NAME ? result : null;
}

/**
 * A channel's name with every emoji and decoration taken out, for "Make names text-only":
 * "💬・general" → "general", "꒰🎮꒱gaming-chat" → "gaming-chat", "˚₊‧🎵‧₊˚music" → "music".
 * Letters and numbers in any language are kept, and so are plain keyboard symbols like - _ ' & ( ).
 * Returns "" when nothing would be left (a name that's only emojis).
 */
export function plainName(name: string): string {
  return (
    name
      // Keycaps like 1️⃣, then emoji, flags and the invisible characters that join or style them.
      .replace(/[#*0-9]\uFE0F?\u20E3/gu, "")
      .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u200B-\u200D\u2060\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu, "")
      // Decorative letters that are really pictures (୨୧ ribbon, ʚɞ wings and friends).
      .replace(/[ʚɞʕʔᐟᐠᐡᐢᵔᴗ˖ᵕ୨୧]/gu, " ")
      // Decorations: symbols, and any punctuation that isn't on a normal keyboard (・ 「 」 ┊ ︰ ‧ ˚ ₊ ꒰ ꒱ …).
      .replace(/[\p{S}\p{P}]/gu, (ch) => (/^[\x20-\x7E]$/.test(ch) && ch !== "|" && ch !== "~" && ch !== "^" && ch !== "`" ? ch : " "))
      // Tidy up what's left: no separators at the ends, no doubled ones in the middle.
      .replace(/\s+/g, " ")
      .replace(/-{2,}/g, "-")
      .replace(/_{2,}/g, "_")
      .replace(/^[\s\-_.,:;·]+|[\s\-_.,:;·]+$/g, "")
      .trim()
  );
}

export const designKinds = ["text", "announcement", "voice"] as const;
export type DesignKind = (typeof designKinds)[number];

/** Discord channel types for each kind (voice includes stage channels). */
export const kindTypes: Record<DesignKind, number[]> = {
  text: [0],
  announcement: [5],
  voice: [2, 13],
};

/** Which channels "Make names text-only" cleans up. */
export const cleanupSettings = z.object({
  /** Text channels are always included. */
  includeAnnouncements: z.boolean().default(true),
  includeVoice: z.boolean().default(true),
  /** Channels (or whole categories) left exactly as they are. */
  skippedChannelIds: z.array(snowflake).max(MAX_SKIPPED).default([]),
});
export type CleanupSettings = z.infer<typeof cleanupSettings>;

export const channelDesignSettings = z.object({
  /** The design currently on the server's channels. Null = none. */
  templateId: z.preprocess((v) => (typeof v === "string" ? (replacedTemplates[v] ?? v) : v), z.string().nullable().default(null)),
  /** Text channels are always included. */
  includeAnnouncements: z.boolean().default(false),
  includeVoice: z.boolean().default(false),
  /** Channels (or whole categories) left exactly as they are. */
  skippedChannelIds: z.array(snowflake).max(MAX_SKIPPED).default([]),
  /** Also decorate channels created later. */
  decorateNew: z.boolean().default(false),
  /** The options last used for "Make names text-only". */
  cleanup: cleanupSettings.prefault({}),
});
export type ChannelDesignSettings = z.infer<typeof channelDesignSettings>;

/** Which kind a channel type is, or null for categories, forums and other channels designs don't touch. */
export function kindOf(type: number): DesignKind | null {
  return (designKinds as readonly DesignKind[]).find((k) => kindTypes[k].includes(type)) ?? null;
}

export function includes(s: Pick<ChannelDesignSettings, "includeAnnouncements" | "includeVoice">, type: number) {
  const kind = kindOf(type);
  return kind === "text" || (kind === "announcement" && s.includeAnnouncements) || (kind === "voice" && s.includeVoice);
}

/** A channel as the dashboard sees it: its own name (without any design) and what it's called now. */
export interface DesignChannel {
  id: string;
  type: number;
  parentId: string | null;
  /** The name without Number One's design. */
  baseName: string;
  /** What it's called in Discord right now. */
  currentName: string;
}

export interface DesignJob {
  phase: "running" | "done" | "failed";
  /** "apply", "remove" or "clean" (make names text-only). */
  action: "apply" | "remove" | "clean";
  done: number;
  total: number;
  /** Channels that couldn't be changed, with why. */
  skipped: { name: string; reason: string }[];
  error?: string;
}

export interface ChannelDesignsResponse {
  settings: ChannelDesignSettings;
  channels: DesignChannel[];
  job: DesignJob | null;
  problems: string[];
}
