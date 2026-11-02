import { z } from "zod";

/**
 * Events: shapes shared by the bot and the dashboard.
 * Admins create an event on the dashboard. Number One posts it with Going / Maybe / Can't go buttons,
 * keeps the attendee list up to date, reminds people by DM before it starts, and marks it ended afterwards.
 * One click adds it to Discord's own Events tab (a Discord scheduled event) with all the same details.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const EVENT_LIMITS = {
  /** Discord's limit for a scheduled event's name. */
  title: 100,
  description: 2000,
  /** Discord's limit for a scheduled event's description (longer text is cut there, not in the post). */
  discordDescription: 1000,
  location: 100,
  maxAttendees: 1000,
  pingRoles: 10,
} as const;

/** Most upcoming events one server can have. */
export const MAX_UPCOMING_EVENTS = 50;
/** Furthest ahead an event can start. */
export const MAX_DAYS_AHEAD = 365;

export const rsvpChoices = [
  { id: "going", label: "Going", emoji: "✅" },
  { id: "maybe", label: "Maybe", emoji: "❔" },
  { id: "no", label: "Can't go", emoji: "❌" },
] as const;
export type RsvpChoice = (typeof rsvpChoices)[number]["id"];

export const reminderChoices = [
  { minutes: 0, label: "No reminder" },
  { minutes: 10, label: "10 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 3 * 60, label: "3 hours before" },
  { minutes: 24 * 60, label: "1 day before" },
] as const;

export const eventPingTypes = ["none", "everyone", "here", "roles"] as const;
export type EventPingType = (typeof eventPingTypes)[number];

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Image links must start with https://")
  .default("");

export const eventInput = z.object({
  /** Where the event is posted. */
  channelId: snowflake,
  title: z.string().trim().min(1, "Give the event a name").max(EVENT_LIMITS.title),
  description: z.string().max(EVENT_LIMITS.description).default(""),
  /** ms since 1970. */
  startAt: z.number().int(),
  /** ms since 1970. Empty = no set end (Discord's Events tab then shows it as lasting 1 hour). */
  endAt: z.number().int().nullable().default(null),
  /** Somewhere in the world or online (a place or link), or a voice/stage channel in this server. */
  locationType: z.enum(["place", "voice"]).default("place"),
  location: z.string().trim().max(EVENT_LIMITS.location).default(""),
  voiceChannelId: snowflake.nullable().default(null),
  image: link,
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#5865f2"),
  /** Most people who can say they're going. 0 = no limit. */
  maxAttendees: z.number().int().min(0).max(EVENT_LIMITS.maxAttendees).default(0),
  /** DM people who are going (and maybe) this long before it starts. 0 = no reminder. */
  reminderMinutes: z.number().int().min(0).max(7 * 24 * 60).default(60),
  /** Who to ping when the event is posted. */
  ping: z
    .object({
      type: z.enum(eventPingTypes).default("none"),
      roleIds: z.array(snowflake).max(EVENT_LIMITS.pingRoles).default([]),
    })
    .prefault({}),
  /** Also add it to Discord's Events tab when it's posted. */
  addToDiscord: z.boolean().default(false),
});
export type EventInput = z.infer<typeof eventInput>;

export type EventStatus = "upcoming" | "ended" | "cancelled";

export interface EventView extends EventInput {
  id: number;
  status: EventStatus;
  url: string | null;
  /** The matching event in Discord's Events tab, if it was added. */
  discordEventUrl: string | null;
  counts: Record<RsvpChoice, number>;
  createdByTag: string;
}

export interface EventsResponse {
  /** Upcoming events (soonest first), then the last 20 ended or cancelled ones. */
  events: EventView[];
  /** Permission problems, in plain words. */
  problems: string[];
}

/** One person's answer, for the attendee list on the dashboard. */
export interface RsvpView {
  userId: string;
  name: string;
  choice: RsvpChoice;
}
