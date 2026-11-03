import { z } from "zod";

/**
 * Polls: shapes shared by the bot and the dashboard.
 * A poll is posted with one button per answer and a live results bar for each.
 * Staff make polls on the dashboard or with /poll create. Polls can end at a set time or when staff end them,
 * and Number One replies to the poll with the winner when it ends.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const POLL_LIMITS = {
  question: 300,
  description: 1000,
  /** Discord's limit for a button label. */
  answer: 80,
  minAnswers: 2,
  /** Two rows of five buttons. */
  maxAnswers: 10,
  roles: 10,
  pingRoles: 10,
} as const;

/** Most open polls one server can have. */
export const MAX_OPEN_POLLS = 50;
/** Longest a poll can stay open. */
export const MAX_POLL_HOURS = 30 * 24;

/** The number emojis shown next to each answer. */
export const answerEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"] as const;

export const pollDurationChoices = [
  { hours: 0, label: "Until I end it" },
  { hours: 1, label: "1 hour" },
  { hours: 4, label: "4 hours" },
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "1 day" },
  { hours: 3 * 24, label: "3 days" },
  { hours: 7 * 24, label: "1 week" },
  { hours: 14 * 24, label: "2 weeks" },
] as const;

export const pollCreators = ["staff", "everyone", "roles"] as const;
export type PollCreators = (typeof pollCreators)[number];

export const pollPingTypes = ["none", "everyone", "here", "roles"] as const;
export type PollPingType = (typeof pollPingTypes)[number];

/** Feature settings: who can use /poll create, and the defaults for new polls. */
export const pollSettings = z.object({
  /** "staff" = people with Manage Messages, "everyone" = any member, "roles" = staff plus the roles below. */
  creators: z.enum(pollCreators).default("staff"),
  creatorRoleIds: z.array(snowflake).max(POLL_LIMITS.roles).default([]),
  /** How long a /poll create poll stays open when no time is given. 0 = until it's ended by hand. */
  defaultHours: z.number().int().min(0).max(MAX_POLL_HOURS).default(24),
  /** Reply to the poll with the winner when it ends. */
  announceResults: z.boolean().default(true),
});
export type PollSettings = z.infer<typeof pollSettings>;

export const pollInput = z.object({
  /** Where the poll is posted. */
  channelId: snowflake,
  question: z.string().trim().min(1, "Write the question").max(POLL_LIMITS.question),
  description: z.string().max(POLL_LIMITS.description).default(""),
  answers: z
    .array(z.string().trim().min(1, "Answers can't be empty").max(POLL_LIMITS.answer))
    .min(POLL_LIMITS.minAnswers, `Add at least ${POLL_LIMITS.minAnswers} answers`)
    .max(POLL_LIMITS.maxAnswers, `Polls can have up to ${POLL_LIMITS.maxAnswers} answers`)
    .refine((list) => new Set(list.map((a) => a.toLowerCase())).size === list.length, "Two answers are the same"),
  /** Members can pick more than one answer. */
  multiple: z.boolean().default(false),
  /** Hide who voted for what (on the post and on the dashboard). */
  anonymous: z.boolean().default(true),
  /** Hide the results until the poll ends. */
  hideResults: z.boolean().default(false),
  /** How long it stays open. 0 = until it's ended by hand. */
  hours: z.number().int().min(0).max(MAX_POLL_HOURS).default(24),
  /** Only members with one of these roles can vote. Empty = everyone. */
  voterRoleIds: z.array(snowflake).max(POLL_LIMITS.roles).default([]),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#ff4fa3"),
  /** Who to ping when the poll is posted. */
  ping: z
    .object({
      type: z.enum(pollPingTypes).default("none"),
      roleIds: z.array(snowflake).max(POLL_LIMITS.pingRoles).default([]),
    })
    .prefault({}),
});
export type PollInput = z.infer<typeof pollInput>;

export type PollStatus = "open" | "ended";

export interface PollView extends PollInput {
  id: number;
  status: PollStatus;
  url: string | null;
  /** ms since 1970, or null when it stays open until ended by hand. */
  endsAt: number | null;
  /** Votes per answer, in the same order as `answers`. */
  counts: number[];
  /** How many different members voted. */
  voters: number;
  createdByTag: string;
  createdAt: number;
}

export interface PollsResponse {
  settings: PollSettings;
  /** Open polls (newest first), then the last 20 ended ones. */
  polls: PollView[];
  /** Permission problems, in plain words. */
  problems: string[];
}

/** Who picked an answer, for polls that aren't anonymous. */
export interface PollVoterView {
  userId: string;
  name: string;
  /** Answer numbers, starting at 0. */
  answers: number[];
}
