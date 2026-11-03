import { z } from "zod";
import { antiRaidSettings } from "./antiRaid.js";
import { automodSettings } from "./automod.js";
import { channelDesignSettings } from "./channelDesigns.js";
import { customCommandSettings } from "./customCommands.js";
import { joinLeaveSettings } from "./joinLeave.js";
import { memberLogSettings } from "./memberLogs.js";
import { messageLogSettings } from "./messageLogs.js";
import { moderationSettings } from "./moderation.js";
import { onboardingSettings } from "./onboarding.js";
import { ruleVerificationSettings } from "./ruleVerification.js";
import { serverLogSettings } from "./serverLogs.js";
import { guidesSettings } from "./guides.js";
import { ticketSettings } from "./tickets.js";
import { voiceLogSettings } from "./voiceLogs.js";
import { botUpdateSettings } from "./botUpdates.js";

/**
 * The single definition of every feature: its name, description, category and settings shape.
 * Shared by the bot (to read settings) and the dashboard (to show and edit them),
 * so the two can never disagree about what a setting is called or what values it allows.
 *
 * To add a feature: add an entry here, then a matching folder in src/features/.
 */

/**
 * What a server can use Number One for. /setup asks owners to pick these, and the
 * recommended features in each picked category are switched on. Features added to a
 * category later switch on automatically for servers that picked it.
 */
export const categories = [
  {
    id: "moderation",
    name: "Moderation & Safety",
    emoji: "🛡️",
    description: "Warnings, bans, timeouts, auto-moderation, anti-spam and anti-raid",
  },
  {
    id: "community",
    name: "Community Settings",
    emoji: "👥",
    description: "Welcome messages, member onboarding and verification",
  },
  {
    id: "roles",
    name: "Roles Management",
    emoji: "🎭",
    description: "Reaction roles, role menus and auto roles",
  },
  {
    id: "logging",
    name: "Logging & Auditing",
    emoji: "📋",
    description: "Track joins, leaves, message edits, deletes and moderator actions",
  },
  {
    id: "engagement",
    name: "Engagement & Fun",
    emoji: "🎉",
    description: "Levels, giveaways, polls, starboard and events",
  },
  {
    id: "utility",
    name: "Utilities & Automation",
    emoji: "🛠️",
    description: "Custom commands, tickets, reminders and social feeds",
  },
  {
    id: "cosmetics",
    name: "Cosmetics",
    emoji: "🎨",
    description: "Cute designs for your server, like decorated channel names and easy-to-read server and staff guides",
  },
  {
    id: "other",
    name: "Other",
    emoji: "🧩",
    description: "Everything else, like news and updates about Number One itself",
  },
] as const;

export type CategoryId = (typeof categories)[number]["id"];
export const categoryIds = categories.map((c) => c.id) as [CategoryId, ...CategoryId[]];

/**
 * Older category IDs that servers may have saved, and the category they now belong to.
 * ("roles" is a category of its own again: Community & Roles was split into Community Settings and
 * Roles Management, and servers that had picked it were given both by migration 0009.)
 */
export const legacyCategories: Record<string, CategoryId> = { welcome: "community" };

export interface FeatureInfo<S extends z.ZodObject = z.ZodObject> {
  id: string;
  name: string;
  description: string;
  /** Emoji shown next to the feature in the dashboard menu and cards. */
  icon?: string;
  /** Which /setup category this belongs to. Core features have none. */
  category?: CategoryId;
  /** Switched on automatically when the server picks this feature's category in /setup. */
  recommended?: boolean;
  /** Core features can't be turned off. */
  alwaysOn?: boolean;
  /**
   * Still being built. The dashboard shows a "work in progress" notice instead of settings,
   * the feature counts as off in every server, and /setup doesn't switch it on.
   * Saved settings are kept, so removing this flag brings everything back.
   */
  workInProgress?: boolean;
  /** Settings shape. Every field needs a default so a fresh server works without setup. */
  settings: S;
}

const defineFeature = <S extends z.ZodObject>(info: FeatureInfo<S>) => info;

export const coreFeature = defineFeature({
  id: "core",
  name: "Core",
  icon: "⭐",
  description: "/setup, /dashboard and /ping. Always on.",
  alwaysOn: true,
  settings: z.object({}),
});

export const reactionRolesFeature = defineFeature({
  id: "reaction-roles",
  name: "Reaction roles",
  icon: "🎭",
  description: "Members pick their own roles with reactions, buttons or a dropdown menu.",
  category: "roles",
  recommended: true,
  settings: z.object({}),
});

export const onboardingFeature = defineFeature({
  id: "onboarding",
  name: "Member onboarding",
  icon: "👋",
  description: "Give new members starting roles and walk them through rules and questions. No Community settings needed.",
  category: "community",
  recommended: true,
  settings: onboardingSettings,
});

export const joinLeaveFeature = defineFeature({
  id: "join-leave",
  name: "Join & leave messages",
  icon: "💬",
  description: "Welcome new members in a channel or by DM, and post a goodbye when someone leaves.",
  category: "community",
  recommended: true,
  settings: joinLeaveSettings,
});

export const moderationFeature = defineFeature({
  id: "moderation",
  name: "Moderation",
  icon: "🔨",
  description: "Warn, time out, kick and ban members, with numbered cases, a mod log, DMs and automatic steps for repeat warnings.",
  category: "moderation",
  recommended: true,
  settings: moderationSettings,
});

export const automodFeature = defineFeature({
  id: "automod",
  name: "Auto-moderation",
  icon: "🤖",
  description: "Block bad words, invite links, unwanted links, mass mentions, caps, emoji spam, zalgo and repeated messages automatically.",
  category: "moderation",
  recommended: true,
  settings: automodSettings,
});

export const antiRaidFeature = defineFeature({
  id: "anti-raid",
  name: "Anti-raid",
  icon: "🚨",
  description: "Spots waves of accounts joining at once, locks the server down for a while and removes the raiders. Can also turn away brand-new accounts.",
  category: "moderation",
  recommended: true,
  settings: antiRaidSettings,
});

export const embedsFeature = defineFeature({
  id: "embeds",
  name: "Embed messages",
  icon: "🧱",
  description: "Build messages with embeds on the dashboard. Number One posts them, and you can edit or delete them anytime.",
  category: "utility",
  recommended: true,
  settings: z.object({}),
});

export const announcementsFeature = defineFeature({
  id: "announcements",
  name: "Announcements",
  icon: "📢",
  description: "Write announcements with an embed, ping who needs to know, and send now or later. Save templates for the ones you post often.",
  category: "utility",
  recommended: true,
  settings: z.object({}),
});

export const eventsFeature = defineFeature({
  id: "events",
  name: "Events",
  icon: "📅",
  description: "Post events with Going / Maybe / Can't go buttons and reminders, and add them to Discord's Events tab in one click.",
  category: "engagement",
  recommended: true,
  settings: z.object({}),
});

export const channelDesignsFeature = defineFeature({
  id: "channel-designs",
  name: "Channel designs",
  icon: "🌸",
  description: "Add a cute design to every channel name in one click, like 💬・general. Names stay the same, and you can switch or remove it anytime.",
  category: "cosmetics",
  recommended: true,
  settings: channelDesignSettings,
});

export const messageLogsFeature = defineFeature({
  id: "message-logs",
  name: "Message logs",
  icon: "📝",
  description: "Post edited, deleted and bulk-deleted messages to a staff channel, with what they said before.",
  category: "logging",
  recommended: true,
  settings: messageLogSettings,
});

export const memberLogsFeature = defineFeature({
  id: "member-logs",
  name: "Member logs",
  icon: "👥",
  description: "Post joins, leaves, nickname and role changes, and username and avatar changes to a staff channel.",
  category: "logging",
  recommended: true,
  settings: memberLogSettings,
});

export const serverLogsFeature = defineFeature({
  id: "server-logs",
  name: "Server logs",
  icon: "🗂️",
  description: "Post changes to channels, roles, server settings, emojis and invites to a staff channel, with who made them.",
  category: "logging",
  recommended: true,
  settings: serverLogSettings,
});

export const voiceLogsFeature = defineFeature({
  id: "voice-logs",
  name: "Voice logs",
  icon: "🔊",
  description: "Post voice channel joins, leaves, moves and server mutes to a staff channel, with how long people stayed.",
  category: "logging",
  recommended: true,
  settings: voiceLogSettings,
});

export const customCommandsFeature = defineFeature({
  id: "custom-commands",
  name: "Custom commands",
  icon: "✨",
  description: "Make your own slash commands, like /faq or /ip, plus /rule to post any of your server's rules.",
  category: "utility",
  recommended: true,
  settings: customCommandSettings,
});

export const ruleVerificationFeature = defineFeature({
  id: "rule-verification",
  name: "Rule verification",
  icon: "✅",
  description: "Post your rules with an \"I agree\" button that gives a role, so only people who accepted the rules get in. Works with or without onboarding.",
  category: "community",
  recommended: true,
  settings: ruleVerificationSettings,
});

export const guidesFeature = defineFeature({
  id: "guides",
  name: "Guides",
  icon: "📖",
  description: "Post a Server guide for members and a Staff guide for your team in the channels you pick, with a contents list that links to every section.",
  category: "cosmetics",
  recommended: true,
  settings: guidesSettings,
});

export const ticketsFeature = defineFeature({
  id: "tickets",
  name: "Tickets",
  icon: "🎫",
  description: "Post ticket panels with buttons or a dropdown. Members open a private channel with your staff, who can claim and close it with a transcript.",
  category: "utility",
  recommended: true,
  settings: ticketSettings,
});

export const botUpdatesFeature = defineFeature({
  id: "bot-updates",
  name: "Number One updates",
  icon: "📬",
  description: "Get news about Number One (new features, fixes, downtime) in a channel you choose, with an optional role to mention.",
  category: "other",
  recommended: true,
  settings: botUpdateSettings,
});

export const featureCatalog: FeatureInfo[] = [
  coreFeature,
  moderationFeature,
  automodFeature,
  antiRaidFeature,
  joinLeaveFeature,
  ruleVerificationFeature,
  onboardingFeature,
  reactionRolesFeature,
  announcementsFeature,
  embedsFeature,
  eventsFeature,
  channelDesignsFeature,
  guidesFeature,
  messageLogsFeature,
  memberLogsFeature,
  serverLogsFeature,
  voiceLogsFeature,
  customCommandsFeature,
  ticketsFeature,
  botUpdatesFeature,
];

export function getFeatureInfo(id: string): FeatureInfo | undefined {
  return featureCatalog.find((f) => f.id === id);
}

export const featuresInCategory = (id: CategoryId) => featureCatalog.filter((f) => f.category === id);

/** Features a server can actually use today (not core, not work in progress). */
export const isUsable = (f: FeatureInfo) => Boolean(f.category && !f.workInProgress);

/** What the API returns for one feature in one server. */
export interface FeatureState {
  id: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

/** A server's /setup answers. */
export interface SetupState {
  categories: CategoryId[];
  completed: boolean;
}

/** What the API returns for the server list. */
export interface DashboardGuild {
  id: string;
  name: string;
  icon: string | null;
  /** Whether the bot is already in this server. */
  botPresent: boolean;
}

export interface DashboardUser {
  id: string;
  username: string;
  avatar: string | null;
  /** Owns the bot's Discord application: gets the Developer page. */
  isDeveloper?: boolean;
}

export * from "./reactionRoles.js";
export * from "./moderation.js";
export * from "./automod.js";
export * from "./antiRaid.js";
export * from "./joinLeave.js";
export * from "./embeds.js";
export * from "./announcements.js";
export * from "./events.js";
export * from "./channelDesigns.js";
export * from "./messageLogs.js";
export * from "./memberLogs.js";
export * from "./serverLogs.js";
export * from "./voiceLogs.js";
export * from "./botUpdates.js";
export * from "./customCommands.js";
export * from "./ruleVerification.js";
export * from "./tickets.js";
export * from "./guides.js";
