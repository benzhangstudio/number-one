import { z } from "zod";

/**
 * Embed messages: shapes shared by the bot and the dashboard.
 * Admins build messages with up to 10 embeds on the dashboard. Number One posts them and can edit or delete them later.
 * (Its own feature: nothing here is used by Announcements or Reaction roles.)
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

/** Discord's limits. */
export const EMBED_LIMITS = {
  embeds: 10,
  fields: 25,
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  content: 2000,
  /** All text in all of a message's embeds together. */
  total: 6000,
} as const;

/** Most saved embed messages one server can have. */
export const MAX_EMBED_MESSAGES = 100;

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Links must start with https://")
  .default("");

export const embedField = z.object({
  name: z.string().trim().min(1, "Every field needs a name").max(EMBED_LIMITS.fieldName),
  value: z.string().trim().min(1, "Every field needs a value").max(EMBED_LIMITS.fieldValue),
  inline: z.boolean().default(false),
});

export const embedData = z.object({
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#ff4fa3"),
  authorName: z.string().trim().max(EMBED_LIMITS.author).default(""),
  authorIcon: link,
  authorUrl: link,
  title: z.string().trim().max(EMBED_LIMITS.title).default(""),
  url: link,
  description: z.string().max(EMBED_LIMITS.description).default(""),
  fields: z.array(embedField).max(EMBED_LIMITS.fields).default([]),
  image: link,
  thumbnail: link,
  footerText: z.string().trim().max(EMBED_LIMITS.footer).default(""),
  footerIcon: link,
  /** Show the time the message was posted (or last edited) next to the footer. */
  timestamp: z.boolean().default(false),
});
export type EmbedData = z.infer<typeof embedData>;
export type EmbedField = z.infer<typeof embedField>;

export const embedMessageInput = z.object({
  /** Only shown on the dashboard, to tell messages apart. */
  name: z.string().trim().max(100).default(""),
  channelId: snowflake,
  content: z.string().max(EMBED_LIMITS.content).default(""),
  embeds: z.array(embedData).max(EMBED_LIMITS.embeds).default([]),
});
export type EmbedMessageInput = z.infer<typeof embedMessageInput>;

export const blankEmbed = (): EmbedData => embedData.parse({});

/** Characters that count towards Discord's 6,000 limit for one embed. */
export function embedLength(e: EmbedData) {
  return (
    e.title.length +
    e.description.length +
    e.authorName.length +
    e.footerText.length +
    e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

/** An embed with nothing in it, which Discord rejects. */
export const embedIsEmpty = (e: EmbedData) =>
  !e.title && !e.description.trim() && !e.authorName && !e.footerText && !e.image && !e.thumbnail && e.fields.length === 0;

/** What's wrong with a message, in plain words, or null when Discord will accept it. */
export function embedMessageProblem(m: EmbedMessageInput): string | null {
  if (!m.content.trim() && m.embeds.length === 0) return "Add some text or an embed.";
  const empty = m.embeds.findIndex(embedIsEmpty);
  if (empty >= 0) return `Embed ${empty + 1} is empty. Add a title, description, field or image, or remove it.`;
  const total = m.embeds.reduce((n, e) => n + embedLength(e), 0);
  if (total > EMBED_LIMITS.total) return `The embeds have ${total.toLocaleString("en-US")} characters in total. Discord allows ${EMBED_LIMITS.total.toLocaleString("en-US")}.`;
  return null;
}

export interface EmbedMessageView extends EmbedMessageInput {
  messageId: string;
  url: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}
