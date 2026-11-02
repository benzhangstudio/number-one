import { z } from "zod";

/**
 * Message logs: settings shared by the bot and the dashboard.
 * Posts edited, deleted and bulk-deleted messages to a staff channel.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const MAX_LOG_IGNORED_CHANNELS = 50;
export const MAX_LOG_IGNORED_ROLES = 20;

export const messageLogSettings = z.object({
  /** Where logs are posted. Empty = nothing is logged. */
  channelId: snowflake.nullable().default(null),
  edits: z.boolean().default(true),
  deletes: z.boolean().default(true),
  /** Purges and other mass deletes: one log with a transcript file. */
  bulkDeletes: z.boolean().default(true),
  /** Messages from bots and webhooks. */
  ignoreBots: z.boolean().default(true),
  /** Channels (or whole categories) that aren't logged. */
  ignoredChannelIds: z.array(snowflake).max(MAX_LOG_IGNORED_CHANNELS).default([]),
  /** Members with any of these roles aren't logged. */
  ignoredRoleIds: z.array(snowflake).max(MAX_LOG_IGNORED_ROLES).default([]),
});
export type MessageLogSettings = z.infer<typeof messageLogSettings>;

export interface MessageLogResponse {
  settings: MessageLogSettings;
  /** Whether Number One can read what messages say (Message Content Intent). */
  canReadMessages: boolean;
  problems: string[];
}
