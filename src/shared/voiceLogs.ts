import { z } from "zod";

/**
 * Voice logs: settings shared by the bot and the dashboard.
 * Posts voice channel joins, leaves, moves and server mutes / deafens to a staff channel.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const MAX_VOICE_IGNORED = 50;

export const voiceLogSettings = z.object({
  /** Where logs are posted. Empty = nothing is logged. */
  channelId: snowflake.nullable().default(null),
  joins: z.boolean().default(true),
  /** Leaves, with how long they were there. */
  leaves: z.boolean().default(true),
  moves: z.boolean().default(true),
  /** Server mutes and deafens (done by staff, not someone muting themselves). */
  serverMutes: z.boolean().default(true),
  ignoreBots: z.boolean().default(true),
  /** Voice channels (or whole categories) that aren't logged. */
  ignoredChannelIds: z.array(snowflake).max(MAX_VOICE_IGNORED).default([]),
});
export type VoiceLogSettings = z.infer<typeof voiceLogSettings>;

export interface VoiceLogResponse {
  settings: VoiceLogSettings;
  problems: string[];
}
