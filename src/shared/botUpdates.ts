import { z } from "zod";

/**
 * "Number One updates": announcements from the bot's developer, posted in every server that set a channel.
 * Servers pick the channel and, optionally, a role to mention. Servers without a channel get nothing.
 * Shared by the bot and the dashboard.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

/** A server's settings. */
export const botUpdateSettings = z.object({
  /** Where updates are posted. Empty = the server doesn't get them. */
  channelId: snowflake.nullable().default(null),
  /** Mentioned with each update when the developer chooses to mention. Empty = no mention. */
  roleId: snowflake.nullable().default(null),
});
export type BotUpdateSettings = z.infer<typeof botUpdateSettings>;

export const MAX_UPDATE_TITLE = 100;
export const MAX_UPDATE_BODY = 3500;

/** What the developer fills in on the Developer page. */
export const botUpdateInput = z.object({
  title: z.string().trim().min(1, "Add a title").max(MAX_UPDATE_TITLE, `Keep the title under ${MAX_UPDATE_TITLE} characters`),
  body: z.string().trim().min(1, "Write the message").max(MAX_UPDATE_BODY, `Keep the message under ${MAX_UPDATE_BODY} characters`),
  /** Optional "Learn more" button. */
  url: z
    .string()
    .trim()
    .max(300)
    .default("")
    .refine((v) => v === "" || /^https:\/\/\S+$/.test(v), "The link must start with https://"),
  /** Mention each server's chosen role. */
  mention: z.boolean().default(true),
});
export type BotUpdateInput = z.infer<typeof botUpdateInput>;

/** How one server's delivery went. */
export type BotUpdateOutcome = "sent" | "failed";

export interface BotUpdateSummary {
  id: number;
  title: string;
  body: string;
  url: string;
  mention: boolean;
  createdAt: number;
  status: "sending" | "done";
  sent: number;
  failed: number;
}

export interface BotUpdateFailure {
  guildId: string;
  guildName: string;
  reason: string;
}

/** The Developer page's data. */
export interface DeveloperOverview {
  updates: BotUpdateSummary[];
  /** Servers the bot is in, and how many have a channel set (so would get the next update). */
  servers: number;
  receiving: number;
}

/** The server settings section. */
export interface BotUpdatesPanelData {
  settings: BotUpdateSettings;
  problems: string[];
}
