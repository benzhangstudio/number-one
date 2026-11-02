import { z } from "zod";

/**
 * Join & leave messages: settings shared by the bot and the dashboard.
 * Defaults are safe: only the welcome message is on, and it posts in the server's system channel.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const DEFAULT_WELCOME = "Welcome {user} to **{server}**! You're member #{memberCount}.";
export const DEFAULT_WELCOME_DM = "Welcome to **{server}**, {username}! We're glad you're here.";
export const DEFAULT_GOODBYE = "**{username}** left {server}. We now have {memberCount} members.";

export const joinLeaveSettings = z.object({
  welcome: z
    .object({
      enabled: z.boolean().default(true),
      /** Empty = the server's system channel. */
      channelId: snowflake.nullable().default(null),
      message: z.string().max(1800).default(DEFAULT_WELCOME),
      /** Show the message in a pink card instead of plain text. */
      useEmbed: z.boolean().default(true),
      dmEnabled: z.boolean().default(false),
      dmMessage: z.string().max(1800).default(DEFAULT_WELCOME_DM),
    })
    .prefault({}),
  goodbye: z
    .object({
      enabled: z.boolean().default(false),
      /** Empty = the server's system channel. */
      channelId: snowflake.nullable().default(null),
      message: z.string().max(1800).default(DEFAULT_GOODBYE),
    })
    .prefault({}),
});

export type JoinLeaveSettings = z.infer<typeof joinLeaveSettings>;

/** Placeholders admins can use in welcome, DM and goodbye messages. */
export const PLACEHOLDERS = [
  { key: "{user}", means: "mentions the member" },
  { key: "{username}", means: "the member's name" },
  { key: "{server}", means: "the server's name" },
  { key: "{memberCount}", means: "how many members the server has" },
] as const;

export interface JoinLeaveResponse {
  settings: JoinLeaveSettings;
  /** Channel and permission problems, in plain words. */
  problems: string[];
}
