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

/* ------------------------------------------------------------ templates */

export const MAX_UPDATE_TEMPLATE_NAME = 50;
export const MAX_UPDATE_TEMPLATES = 30;

/** A saved update to start from. */
export const botUpdateTemplateInput = z.object({
  name: z.string().trim().min(1, "Name the template").max(MAX_UPDATE_TEMPLATE_NAME, `Keep the name under ${MAX_UPDATE_TEMPLATE_NAME} characters`),
  title: z.string().trim().max(MAX_UPDATE_TITLE).default(""),
  body: z.string().trim().max(MAX_UPDATE_BODY).default(""),
  url: z.string().trim().max(300).default(""),
  mention: z.boolean().default(true),
});
export type BotUpdateTemplateInput = z.infer<typeof botUpdateTemplateInput>;

export interface BotUpdateTemplate extends BotUpdateTemplateInput {
  id: number;
}

/**
 * Starter templates, always offered on the Developer page.
 * {end} is filled in with the maintenance end time from the Developer page, when one is set.
 */
export const starterTemplates: BotUpdateTemplateInput[] = [
  {
    name: "Maintenance coming up",
    title: "🛠️ Planned maintenance",
    body: "Number One will be under maintenance soon. We expect to be back {end}.\n\nCommands won't work during this time. Your settings and data are safe.",
    url: "",
    mention: true,
  },
  {
    name: "Maintenance finished",
    title: "✅ Maintenance finished",
    body: "Number One is back and everything works again. Thanks for your patience!",
    url: "",
    mention: false,
  },
  {
    name: "New feature",
    title: "✨ New: ",
    body: "**What it does:** \n\n**How to start:** Switch it on in the dashboard.",
    url: "",
    mention: true,
  },
  {
    name: "Bug fixes",
    title: "🐛 Fixes",
    body: "- \n- ",
    url: "",
    mention: false,
  },
];

/* ------------------------------------------------------------ maintenance mode */

export const MAX_MAINTENANCE_MESSAGE = 300;
export const DEFAULT_MAINTENANCE_MESSAGE = "Number One is under maintenance right now. Please try again soon!";

/** What the developer sets on the Developer page. */
export const maintenanceInput = z.object({
  on: z.boolean(),
  /** Shown to anyone who uses a command or button. */
  message: z.string().trim().max(MAX_MAINTENANCE_MESSAGE).default(""),
  /** ms since 1970: maintenance switches itself off then. Null = until switched off. */
  until: z.number().int().nullable().default(null),
});
export type MaintenanceInput = z.infer<typeof maintenanceInput>;

export interface MaintenanceState {
  on: boolean;
  message: string;
  until: number | null;
  /** When it was switched on (ms since 1970). */
  since: number | null;
}

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
  templates: BotUpdateTemplate[];
  maintenance: MaintenanceState;
  /** Servers the bot is in, and how many have a channel set (so would get the next update). */
  servers: number;
  receiving: number;
}

/** The server settings section. */
export interface BotUpdatesPanelData {
  settings: BotUpdateSettings;
  problems: string[];
}
