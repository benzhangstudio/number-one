import { z } from "zod";

/**
 * Custom commands: shapes shared by the bot and the dashboard.
 * Admins make their own slash commands for their server (like /faq or /ip). Each one replies publicly
 * with text and/or an embed. They're registered in that server only.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Most custom commands one server can have (Discord allows 100 per server; some room is kept). */
export const MAX_CUSTOM_COMMANDS = 50;
export const MAX_ALLOWED_ROLES = 10;

/** Number One's own commands. Custom commands can't use these names, and syncing never touches them. */
export const BUILT_IN_NAMES = ["setup", "dashboard", "ping", "warn", "timeout", "untimeout", "kick", "ban", "unban", "purge", "case", "raidmode", "ticket", "rank", "leaderboard", "xp"];
/** The Rules command (see `rules` below). */
export const RULES_COMMAND = "rule";
/** Names a custom command can't use. */
export const RESERVED_NAMES = [...BUILT_IN_NAMES, RULES_COMMAND];

/* ------------------------------------------------------------ Rules: /rule <number> */

export const MAX_RULES = 25;

export const ruleItem = z.object({
  title: z.string().trim().min(1, "Every rule needs a title").max(100),
  description: z.string().max(1000).default(""),
});
export type RuleItem = z.infer<typeof ruleItem>;

/** The server's numbered rules. Anyone can post one with /rule 1, or all of them with /rule. */
export const rulesSettings = z.object({
  enabled: z.boolean().default(false),
  /** Shown above the full list and in each rule's footer. */
  heading: z.string().trim().max(100).default("Server rules"),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#ff4fa3"),
  rules: z.array(ruleItem).max(MAX_RULES).default([]),
});
export type RulesSettings = z.infer<typeof rulesSettings>;

export const customCommandSettings = z.object({ rules: rulesSettings.prefault({}) });
export type CustomCommandSettings = z.infer<typeof customCommandSettings>;

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Image links must start with https://")
  .default("");

export const customCommandInput = z.object({
  /** What members type after the slash: lowercase letters, numbers, - and _. */
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{1,32}$/, "Command names can only use lowercase letters, numbers, - and _ (up to 32)."),
  description: z.string().trim().min(1, "Add a short description").max(100),
  /** Plain text reply. */
  content: z.string().max(2000).default(""),
  useEmbed: z.boolean().default(false),
  embed: z
    .object({
      title: z.string().trim().max(256).default(""),
      description: z.string().max(4000).default(""),
      color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#ff4fa3"),
      image: link,
      footer: z.string().trim().max(2048).default(""),
    })
    .prefault({}),
  /** Only members with one of these roles can use it. Empty = everyone. */
  allowedRoleIds: z.array(snowflake).max(MAX_ALLOWED_ROLES).default([]),
});
export type CustomCommandInput = z.infer<typeof customCommandInput>;

/** Placeholders admins can use in replies. */
export const COMMAND_PLACEHOLDERS = [
  { key: "{user}", means: "mentions whoever used it" },
  { key: "{username}", means: "their name" },
  { key: "{server}", means: "the server's name" },
  { key: "{channel}", means: "links the channel it was used in" },
  { key: "{memberCount}", means: "how many members the server has" },
] as const;

/** What's wrong with a reply, in plain words, or null when Discord will accept it. */
export function replyProblem(c: CustomCommandInput): string | null {
  const embedEmpty = !c.embed.title && !c.embed.description.trim() && !c.embed.image && !c.embed.footer;
  if (c.useEmbed && embedEmpty) return "The embed is empty. Add a title, description or image, or switch the embed off.";
  if (!c.content.trim() && !c.useEmbed) return "Write what the command replies with.";
  return null;
}

export interface CustomCommandView extends CustomCommandInput {
  id: number;
  uses: number;
  updatedAt: number;
}

export interface CustomCommandsResponse {
  commands: CustomCommandView[];
  rules: RulesSettings;
  problems: string[];
}
