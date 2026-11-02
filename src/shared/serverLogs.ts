import { z } from "zod";

/**
 * Server logs: settings shared by the bot and the dashboard.
 * Posts changes to channels, roles, server settings, emojis and stickers, and invites to a staff channel,
 * with who made each change.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const serverLogSettings = z.object({
  /** Where logs are posted. Empty = nothing is logged. */
  channelId: snowflake.nullable().default(null),
  channels: z.boolean().default(true),
  roles: z.boolean().default(true),
  /** Server name, icon, verification level and other server settings. */
  server: z.boolean().default(true),
  emojis: z.boolean().default(true),
  invites: z.boolean().default(true),
  /** Changes Number One makes itself (e.g. channel designs) aren't logged. */
  skipOwnChanges: z.boolean().default(true),
});
export type ServerLogSettings = z.infer<typeof serverLogSettings>;

export interface ServerLogResponse {
  settings: ServerLogSettings;
  problems: string[];
}
