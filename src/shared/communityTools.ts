import { z } from "zod";

/**
 * Community tools: switch on Discord's Community features, make announcement channels,
 * and edit Discord's own Welcome Screen and Onboarding from the dashboard.
 * Nothing is stored by Number One: every change goes straight to Discord, which stays the source of truth.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Discord's limits. */
export const WELCOME_DESCRIPTION_MAX = 140;
export const WELCOME_CHANNEL_DESCRIPTION_MAX = 42;
export const WELCOME_CHANNELS_MAX = 5;
export const ONBOARDING_MIN_DEFAULT_CHANNELS = 7;
export const ONBOARDING_MIN_CHAT_CHANNELS = 5;
export const PROMPTS_MAX = 15;
export const PROMPT_OPTIONS_MAX = 50;

/** Switch Community on. Empty channel = Number One makes one. */
export const enableCommunityInput = z.object({
  rulesChannelId: snowflake.nullable().default(null),
  updatesChannelId: snowflake.nullable().default(null),
});
export type EnableCommunityInput = z.infer<typeof enableCommunityInput>;

export const convertChannelInput = z.object({
  channelId: snowflake,
  to: z.enum(["announcement", "text"]),
});

export const createAnnouncementInput = z.object({
  name: z.string().trim().min(1).max(100),
  parentId: snowflake.nullable().default(null),
});

/** A normal emoji, or a server emoji's code like <:gem:123…>. Empty = none. */
const emoji = z.string().trim().max(64).default("");

export const welcomeScreenInput = z.object({
  enabled: z.boolean(),
  description: z.string().max(WELCOME_DESCRIPTION_MAX).default(""),
  channels: z
    .array(
      z.object({
        channelId: snowflake,
        description: z.string().trim().min(1).max(WELCOME_CHANNEL_DESCRIPTION_MAX),
        emoji,
      }),
    )
    .max(WELCOME_CHANNELS_MAX)
    .default([]),
});
export type WelcomeScreenInput = z.infer<typeof welcomeScreenInput>;

export const promptOptionInput = z.object({
  /** Discord's ID for an existing answer, so members who picked it keep it. Empty for new ones. */
  id: snowflake.nullable().default(null),
  title: z.string().trim().min(1).max(50),
  description: z.string().max(100).default(""),
  emoji,
  roleIds: z.array(snowflake).max(25).default([]),
  channelIds: z.array(snowflake).max(50).default([]),
});
export type PromptOptionInput = z.infer<typeof promptOptionInput>;

export const promptInput = z.object({
  id: snowflake.nullable().default(null),
  title: z.string().trim().min(1).max(100),
  /** Members can pick only one answer. */
  singleSelect: z.boolean().default(false),
  required: z.boolean().default(false),
  /** Asked while joining. Off = only in Channels & Roles afterwards. */
  inOnboarding: z.boolean().default(true),
  /** 0 = answer buttons, 1 = a dropdown. */
  type: z.union([z.literal(0), z.literal(1)]).default(0),
  options: z.array(promptOptionInput).min(1).max(PROMPT_OPTIONS_MAX),
});
export type PromptInput = z.infer<typeof promptInput>;

export const discordOnboardingInput = z.object({
  enabled: z.boolean(),
  /** 0 = only default channels count towards Discord's minimum, 1 = channels from questions count too. */
  mode: z.union([z.literal(0), z.literal(1)]).default(0),
  defaultChannelIds: z.array(snowflake).max(500).default([]),
  prompts: z.array(promptInput).max(PROMPTS_MAX).default([]),
});
export type DiscordOnboardingInput = z.infer<typeof discordOnboardingInput>;

export interface CommunityChannel {
  id: string;
  name: string;
  /** Discord's channel type number (0 text, 5 announcement, 2 voice, 4 category, 15 forum…). */
  type: number;
  parentId: string | null;
}

export interface CommunityToolsResponse {
  community: boolean;
  /** Only the owner and Administrators can switch Community on or off. */
  canChangeCommunity: boolean;
  /** What switching Community on will change, in plain words. */
  enablePlan: string[];
  rulesChannelId: string | null;
  updatesChannelId: string | null;
  /** Fresh from Discord, since converting changes channel types. */
  channels: CommunityChannel[];
  /** Null when Community is off (Discord only has them for Community servers). */
  welcomeScreen: WelcomeScreenInput | null;
  onboarding: DiscordOnboardingInput | null;
  /** Number One's own Member onboarding is on too, so members would see both. */
  ourOnboardingOn: boolean;
  problems: string[];
}
