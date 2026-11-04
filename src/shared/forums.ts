import { z } from "zod";

/**
 * Forums: shapes shared by the bot and the dashboard.
 * Admins and mods manage the server's Discord forum channels from the dashboard: create forums, edit their
 * guidelines, tags and layout, and pin, lock, close, reopen or delete posts. Number One adds three helpers
 * per forum: a welcome message in every new post, a Solved workflow (/post solved adds a Solved tag and
 * closes the post), and closing posts that have gone quiet.
 *
 * What Discord stores itself (tags, guidelines, sort order…) is edited in Discord directly; only the helpers
 * are saved in Number One's settings.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const FORUM_LIMITS = {
  name: 100,
  /** Discord's limit for a forum's guidelines. */
  guidelines: 4096,
  /** Discord's limit for tags on a forum. */
  tags: 20,
  tagName: 20,
  welcome: 1500,
  forums: 25,
  autoCloseDays: 90,
} as const;

export const DEFAULT_FORUM_WELCOME = "Thanks for posting, {user}! Someone will be along to help soon. 💬";

/** Number One's helpers for one forum. */
export const forumAutomation = z.object({
  channelId: snowflake,
  welcome: z
    .object({
      enabled: z.boolean().default(false),
      /** {user} mentions whoever made the post. */
      message: z.string().trim().max(FORUM_LIMITS.welcome).default(DEFAULT_FORUM_WELCOME),
    })
    .prefault({}),
  solved: z
    .object({
      /** /post solved works in this forum. */
      enabled: z.boolean().default(true),
      /** The forum's Solved tag. Made automatically when it's missing. */
      tagId: snowflake.nullable().default(null),
      /** Close the post once it's solved. */
      closeOnSolve: z.boolean().default(true),
    })
    .prefault({}),
  /** Close posts with no new messages for this many days. 0 = never. Pinned posts are left open. */
  autoCloseDays: z.number().int().min(0).max(FORUM_LIMITS.autoCloseDays).default(0),
});
export type ForumAutomation = z.infer<typeof forumAutomation>;

export const forumSettings = z.object({
  forums: z.array(forumAutomation).max(FORUM_LIMITS.forums).default([]),
});
export type ForumSettings = z.infer<typeof forumSettings>;

/** The helpers a forum gets before anything is saved for it. */
export const defaultAutomation = (channelId: string): ForumAutomation => forumAutomation.parse({ channelId });

export const forumTag = z.object({
  /** Empty for a new tag. */
  id: snowflake.nullable().default(null),
  name: z.string().trim().min(1, "Every tag needs a name").max(FORUM_LIMITS.tagName, `Tag names can be up to ${FORUM_LIMITS.tagName} characters`),
  /** A normal emoji or a custom one like <:gem:123…>. Empty = none. */
  emoji: z.string().trim().max(64).default(""),
  /** Only people who can manage posts can add it. */
  moderated: z.boolean().default(false),
});
export type ForumTag = z.infer<typeof forumTag>;

export const sortOrders = ["activity", "created"] as const;
export const layouts = ["list", "gallery"] as const;
/** How long a post stays open with no activity before Discord closes it (minutes, as Discord takes them). */
export const autoArchiveChoices = [
  { minutes: 60, label: "1 hour" },
  { minutes: 1440, label: "1 day" },
  { minutes: 4320, label: "3 days" },
  { minutes: 10080, label: "1 week" },
] as const;
export const slowmodeChoices = [
  { seconds: 0, label: "Off" },
  { seconds: 60, label: "1 minute" },
  { seconds: 300, label: "5 minutes" },
  { seconds: 900, label: "15 minutes" },
  { seconds: 3600, label: "1 hour" },
  { seconds: 21600, label: "6 hours" },
] as const;

/** Everything about a forum that Discord stores, as the dashboard edits it. */
export const forumInput = z.object({
  name: z.string().trim().min(1, "Give the forum a name").max(FORUM_LIMITS.name),
  /** The category it's in. Null = no category. */
  parentId: snowflake.nullable().default(null),
  guidelines: z.string().max(FORUM_LIMITS.guidelines).default(""),
  tags: z
    .array(forumTag)
    .max(FORUM_LIMITS.tags, `Forums can have up to ${FORUM_LIMITS.tags} tags`)
    .default([])
    .refine((t) => new Set(t.map((x) => x.name.toLowerCase())).size === t.length, "Two tags have the same name"),
  /** Shown under every post for a quick reaction. Empty = none. */
  defaultReaction: z.string().trim().max(64).default(""),
  sortOrder: z.enum(sortOrders).default("activity"),
  layout: z.enum(layouts).default("list"),
  /** Members must pick at least one tag when posting. */
  requireTag: z.boolean().default(false),
  /** Wait between new posts, per member (seconds). */
  postSlowmode: z.number().int().min(0).max(21600).default(0),
  /** Posts close by themselves after this long with no activity (minutes). */
  autoArchiveMinutes: z.union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)]).default(10080),
});
export type ForumInput = z.infer<typeof forumInput>;

export const postActions = ["pin", "unpin", "lock", "unlock", "close", "reopen"] as const;
export type PostAction = (typeof postActions)[number];

export interface ForumPostView {
  id: string;
  name: string;
  ownerName: string;
  /** Tag IDs. */
  tags: string[];
  pinned: boolean;
  locked: boolean;
  closed: boolean;
  messages: number;
  /** ms since 1970: the last message, or when it was made. */
  lastActive: number;
  url: string;
}

export interface ForumView extends ForumInput {
  id: string;
  url: string;
  automation: ForumAutomation;
  /** Open posts first (newest activity first), then up to 10 recently closed ones. */
  posts: ForumPostView[];
  /** Open posts in the forum. */
  openCount: number;
}

export interface ForumsResponse {
  forums: ForumView[];
  problems: string[];
}
