import { z } from "zod";

/**
 * Announcements: shapes shared by the bot and the dashboard.
 * Admins write an announcement (text and/or one embed), choose who to ping, and send it now or at a set time.
 * Templates save a ready-made announcement to start from.
 * (Its own feature: nothing here is used by Embed messages or Reaction roles.)
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const ANNOUNCEMENT_LIMITS = {
  content: 1900, // leaves room for the ping in front
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  total: 6000,
  pingRoles: 10,
} as const;

export const MAX_TEMPLATES = 25;
/** Announcements waiting to be sent, per server. */
export const MAX_SCHEDULED = 25;
/** Furthest ahead an announcement can be scheduled. */
export const MAX_SCHEDULE_DAYS = 90;

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Links must start with https://")
  .default("");

export const announcementField = z.object({
  name: z.string().trim().min(1, "Every field needs a name").max(ANNOUNCEMENT_LIMITS.fieldName),
  value: z.string().trim().min(1, "Every field needs a value").max(ANNOUNCEMENT_LIMITS.fieldValue),
  inline: z.boolean().default(false),
});

export const announcementEmbed = z.object({
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#ff4fa3"),
  authorName: z.string().trim().max(ANNOUNCEMENT_LIMITS.author).default(""),
  authorIcon: link,
  title: z.string().trim().max(ANNOUNCEMENT_LIMITS.title).default(""),
  url: link,
  description: z.string().max(ANNOUNCEMENT_LIMITS.description).default(""),
  fields: z.array(announcementField).max(ANNOUNCEMENT_LIMITS.fields).default([]),
  image: link,
  thumbnail: link,
  footerText: z.string().trim().max(ANNOUNCEMENT_LIMITS.footer).default(""),
  timestamp: z.boolean().default(true),
});
export type AnnouncementEmbed = z.infer<typeof announcementEmbed>;

/** What the announcement says. */
export const announcementMessage = z.object({
  content: z.string().max(ANNOUNCEMENT_LIMITS.content).default(""),
  useEmbed: z.boolean().default(true),
  embed: announcementEmbed.prefault({}),
});
export type AnnouncementMessage = z.infer<typeof announcementMessage>;

export const pingTypes = ["none", "everyone", "here", "roles"] as const;
export type PingType = (typeof pingTypes)[number];

export const announcementPing = z.object({
  type: z.enum(pingTypes).default("none"),
  roleIds: z.array(snowflake).max(ANNOUNCEMENT_LIMITS.pingRoles).default([]),
});
export type AnnouncementPing = z.infer<typeof announcementPing>;

export const templateInput = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(60),
  /** Channel picked automatically when using the template. Empty = choose each time. */
  channelId: snowflake.nullable().default(null),
  message: announcementMessage.prefault({}),
  ping: announcementPing.prefault({}),
});
export type TemplateInput = z.infer<typeof templateInput>;

export const announcementInput = z.object({
  channelId: snowflake,
  message: announcementMessage.prefault({}),
  ping: announcementPing.prefault({}),
  /** In announcement channels: publish to servers that follow the channel. */
  publish: z.boolean().default(false),
  /** When to send (ms since 1970). Empty = right away. */
  scheduledAt: z.number().int().nullable().default(null),
});
export type AnnouncementInput = z.infer<typeof announcementInput>;

/** Edits to an announcement that was already sent (the ping can't be sent again). */
export const announcementEdit = z.object({ message: announcementMessage.prefault({}) });

const embedIsEmpty = (e: AnnouncementEmbed) =>
  !e.title && !e.description.trim() && !e.authorName && !e.footerText && !e.image && !e.thumbnail && e.fields.length === 0;

/** What's wrong with an announcement's text, in plain words, or null when Discord will accept it. */
export function messageProblem(m: AnnouncementMessage): string | null {
  const hasEmbed = m.useEmbed && !embedIsEmpty(m.embed);
  if (m.useEmbed && embedIsEmpty(m.embed)) return "The embed is empty. Add a title, description, field or image, or switch the embed off.";
  if (!m.content.trim() && !hasEmbed) return "Write something to announce.";
  const e = m.embed;
  const total = e.title.length + e.description.length + e.authorName.length + e.footerText.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  if (m.useEmbed && total > ANNOUNCEMENT_LIMITS.total) return `The embed has ${total.toLocaleString("en-US")} characters. Discord allows ${ANNOUNCEMENT_LIMITS.total.toLocaleString("en-US")}.`;
  return null;
}

export type AnnouncementStatus = "scheduled" | "sent" | "failed";

export interface TemplateView extends TemplateInput {
  id: number;
  updatedAt: number;
}

export interface AnnouncementView {
  id: number;
  channelId: string;
  message: AnnouncementMessage;
  ping: AnnouncementPing;
  publish: boolean;
  status: AnnouncementStatus;
  scheduledAt: number | null;
  sentAt: number | null;
  /** Why it couldn't be sent, in plain words. */
  error: string;
  createdByTag: string;
  createdAt: number;
  url: string | null;
}

export interface AnnouncementsResponse {
  templates: TemplateView[];
  /** Waiting to be sent, soonest first, then the last 30 sent or failed, newest first. */
  announcements: AnnouncementView[];
}
