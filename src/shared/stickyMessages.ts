import { z } from "zod";

/**
 * Sticky messages: shapes shared by the bot and the dashboard.
 * A sticky message stays at the bottom of its channel: after new messages, Number One deletes its old copy
 * and posts it again. One sticky message per channel. Staff set them on the dashboard or with /sticky.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const STICKY_LIMITS = {
  /** Discord's limit for a plain message. */
  text: 2000,
  /** Kept under Discord's 4096 so the embed stays readable. */
  embedText: 4000,
  title: 256,
  /** Repost after this many new messages, at most. */
  maxAfter: 50,
  /** Wait at least this many seconds between reposts, at most. */
  maxDelay: 600,
} as const;

/** Most sticky messages one server can have. */
export const MAX_STICKIES = 50;

/** Feature settings. Every sticky has its own options, so there's nothing server-wide yet. */
export const stickySettings = z.object({});
export type StickySettings = z.infer<typeof stickySettings>;

export const stickyInput = z
  .object({
    channelId: snowflake,
    /** Post it as an embed (coloured box with an optional title) instead of plain text. */
    embed: z.boolean().default(false),
    title: z.string().trim().max(STICKY_LIMITS.title).default(""),
    text: z.string().trim().min(1, "Write the message").max(STICKY_LIMITS.embedText),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default("#ff4fa3"),
    /** Repost after this many new messages. 1 = after every message. */
    afterMessages: z.number().int().min(1).max(STICKY_LIMITS.maxAfter).default(1),
    /** Wait at least this many seconds between reposts, so busy channels aren't flooded. */
    delaySeconds: z.number().int().min(5).max(STICKY_LIMITS.maxDelay).default(10),
  })
  .refine((d) => d.embed || d.text.length <= STICKY_LIMITS.text, {
    message: `Plain messages can be up to ${STICKY_LIMITS.text} characters. Shorten it or post it as an embed.`,
    path: ["text"],
  });
export type StickyInput = z.infer<typeof stickyInput>;

/** One sticky message, as the dashboard sees it. */
export interface StickyView extends StickyInput {
  id: number;
  /** Paused stickies stay saved but aren't reposted. */
  paused: boolean;
  /** Link to the copy that's posted now, if any. */
  url: string | null;
  createdByTag: string;
  updatedAt: number;
}

export interface StickiesResponse {
  stickies: StickyView[];
  /** Channels where Number One is missing something it needs, in plain words. */
  problems: string[];
}
