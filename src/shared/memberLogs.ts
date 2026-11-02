import { z } from "zod";

/**
 * Member logs: settings shared by the bot and the dashboard.
 * Posts joins, leaves, nickname and role changes, and username and avatar changes to a staff channel.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const memberLogSettings = z.object({
  /** Where logs are posted. Empty = nothing is logged. */
  channelId: snowflake.nullable().default(null),
  joins: z.boolean().default(true),
  leaves: z.boolean().default(true),
  nicknames: z.boolean().default(true),
  roles: z.boolean().default(true),
  /** Username, display name and avatar changes. */
  profiles: z.boolean().default(true),
  ignoreBots: z.boolean().default(false),
  /** Joins from accounts younger than this many days are marked as new. 0 = never. */
  newAccountDays: z.number().int().min(0).max(90).default(7),
});
export type MemberLogSettings = z.infer<typeof memberLogSettings>;

export interface MemberLogResponse {
  settings: MemberLogSettings;
  problems: string[];
}
