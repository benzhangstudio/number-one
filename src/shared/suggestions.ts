import { z } from "zod";

/**
 * Suggestions: shapes shared by the bot and the dashboard.
 * Members send ideas with /suggest. Number One posts each one in the suggestions channel with 👍 / 👎 vote buttons
 * and, optionally, a thread to talk about it. Staff mark it as considering, approved, implemented or denied
 * (with a reason) from Discord or the dashboard, and the member gets a DM when that happens.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const SUGGESTION_LIMITS = {
  title: 100,
  details: 2000,
  reason: 500,
  reviewerRoles: 10,
} as const;

export const suggestionStatuses = ["open", "considering", "approved", "implemented", "denied"] as const;
export type SuggestionStatus = (typeof suggestionStatuses)[number];

export const statusInfo: Record<SuggestionStatus, { label: string; emoji: string; color: string; done: boolean }> = {
  open: { label: "Open for votes", emoji: "🗳️", color: "#5865f2", done: false },
  considering: { label: "Being considered", emoji: "🤔", color: "#f0b232", done: false },
  approved: { label: "Approved", emoji: "✅", color: "#3ba55d", done: false },
  implemented: { label: "Implemented", emoji: "🎉", color: "#ff4fa3", done: true },
  denied: { label: "Denied", emoji: "❌", color: "#ed4245", done: true },
};

export const suggestionSettings = z.object({
  /** Where suggestions are posted. Empty = /suggest asks staff to pick one first. */
  channelId: snowflake.nullable().default(null),
  /** Open a thread under each suggestion to talk about it. */
  threads: z.boolean().default(true),
  /** Hide who sent each suggestion on the post (staff still see it on the dashboard). */
  anonymous: z.boolean().default(false),
  /** DM the member when their suggestion's status changes. */
  dmAuthor: z.boolean().default(true),
  /** Minutes a member waits between suggestions. 0 = no wait. */
  cooldownMinutes: z.number().int().min(0).max(24 * 60).default(5),
  /** Besides people with Manage Server or Manage Messages, these roles can review suggestions. */
  reviewerRoleIds: z.array(snowflake).max(SUGGESTION_LIMITS.reviewerRoles).default([]),
});
export type SuggestionSettings = z.infer<typeof suggestionSettings>;

export const suggestionStatusInput = z.object({
  status: z.enum(suggestionStatuses),
  reason: z.string().trim().max(SUGGESTION_LIMITS.reason).default(""),
});
export type SuggestionStatusInput = z.infer<typeof suggestionStatusInput>;

export interface SuggestionView {
  id: number;
  /** The number members see, like #12. */
  number: number;
  title: string;
  details: string;
  status: SuggestionStatus;
  reason: string;
  authorId: string;
  authorName: string;
  reviewedByName: string | null;
  up: number;
  down: number;
  url: string | null;
  createdAt: number;
}

export interface SuggestionsResponse {
  settings: SuggestionSettings;
  /** The newest 100. */
  suggestions: SuggestionView[];
  problems: string[];
}
