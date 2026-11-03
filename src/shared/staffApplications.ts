import { z } from "zod";

/**
 * Staff applications: shapes shared by the bot and the dashboard.
 * Admins post an apply panel with a button (or dropdown option) per position. A member answers the
 * position's questions in pop-up forms, and the application is posted in a staff review channel, where
 * reviewers claim, accept or deny it. Accepting gives the position's roles.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Image links must start with https://")
  .default("");

export const MAX_POSITIONS = 10;
/** Discord pop-up forms hold 5 questions, so longer applications are split over up to 3 forms. */
export const QUESTIONS_PER_PAGE = 5;
export const MAX_APP_QUESTIONS = 15;
export const MAX_REVIEWER_ROLES = 10;
export const MAX_POSITION_ROLES = 5;

export const appQuestion = z.object({
  /** Short random ID, set by the dashboard. */
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  /** Discord limits pop-up labels to 45 characters. */
  label: z.string().trim().min(1, "Every question needs a label").max(45),
  style: z.enum(["short", "long"]).default("long"),
  placeholder: z.string().trim().max(100).default(""),
  required: z.boolean().default(true),
});
export type AppQuestion = z.infer<typeof appQuestion>;

export const appButtonStyles = ["primary", "secondary", "success", "danger"] as const;
export type AppButtonStyle = (typeof appButtonStyles)[number];

/** One role people can apply for, like "Moderator". */
export const appPosition = z.object({
  /** Short random ID, set by the dashboard. Used in button IDs, so it never changes. */
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  name: z.string().trim().min(1, "Every position needs a name").max(80),
  emoji: z.string().trim().max(64).default(""),
  /** Shown under the name in the dropdown, and at the top of the review message. */
  description: z.string().trim().max(100).default(""),
  buttonStyle: z.enum(appButtonStyles).default("primary"),
  /** Taking applications. A closed position stays on the panel but says it's closed. */
  open: z.boolean().default(true),
  questions: z
    .array(appQuestion)
    .min(1, "Add at least one question")
    .max(MAX_APP_QUESTIONS)
    .default([
      { id: "q1", label: "How old are you?", style: "short", placeholder: "", required: true },
      { id: "q2", label: "Why do you want this position?", style: "long", placeholder: "", required: true },
    ]),
  /** Given when an application is accepted. */
  roleIds: z.array(snowflake).max(MAX_POSITION_ROLES).default([]),
  /** Applicants need at least one of these roles (empty = anyone). */
  requiredRoleIds: z.array(snowflake).max(MAX_POSITION_ROLES).default([]),
});
export type AppPosition = z.infer<typeof appPosition>;

/** The apply panel: one per server. */
export const appPanelInput = z
  .object({
    channelId: snowflake,
    title: z.string().trim().max(256).default("📝 Join the staff team"),
    description: z.string().max(4000).default("Want to help run the server? Pick a position below and answer a few questions."),
    color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#ff4fa3"),
    image: link,
    style: z.enum(["buttons", "menu"]).default("buttons"),
    menuPlaceholder: z.string().trim().max(150).default("Pick a position…"),
    positions: z.array(appPosition).min(1, "Add at least one position").max(MAX_POSITIONS),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    for (const pos of p.positions) {
      if (new Set(pos.questions.map((q) => q.id)).size !== pos.questions.length) {
        ctx.addIssue({ code: "custom", message: `${pos.name}: two questions have the same ID. Reload the page and try again.` });
      }
      if (ids.has(pos.id)) ctx.addIssue({ code: "custom", message: "Two positions have the same ID. Reload the page and try again." });
      ids.add(pos.id);
    }
  });
export type AppPanelInput = z.infer<typeof appPanelInput>;

/** Server-wide settings (saved with the feature). */
export const staffApplicationSettings = z.object({
  /** Where new applications are posted for review. Keep it staff-only. */
  reviewChannelId: snowflake.nullable().default(null),
  /** Roles that can claim, accept and deny. People with Manage Server always can. */
  reviewerRoleIds: z.array(snowflake).max(MAX_REVIEWER_ROLES).default([]),
  /** Mention the reviewer roles on each new application. */
  pingReviewers: z.boolean().default(false),
  /** Open a thread on each application for the staff to discuss it. */
  discussionThreads: z.boolean().default(true),
  /** DM the applicant when their application is accepted or denied. */
  dmResults: z.boolean().default(true),
  acceptMessage: z.string().max(1500).default("🎉 Your application for **{position}** in **{server}** was accepted! Welcome to the team."),
  denyMessage: z.string().max(1500).default("Thanks for applying for **{position}** in **{server}**. Unfortunately, your application wasn't accepted this time."),
  /** Days before someone can apply for the same position again after a denial (0 = right away). */
  cooldownDays: z.number().int().min(0).max(365).default(7),
  /** Discord accounts younger than this can't apply (0 = no limit). */
  minAccountAgeDays: z.number().int().min(0).max(3650).default(0),
  /** Members who joined the server less than this many days ago can't apply (0 = no limit). */
  minMemberDays: z.number().int().min(0).max(3650).default(0),
});
export type StaffApplicationSettings = z.infer<typeof staffApplicationSettings>;

/** Placeholders for the accept and deny messages. */
export const APP_PLACEHOLDERS = [
  { key: "{user}", means: "mentions the applicant" },
  { key: "{username}", means: "their name" },
  { key: "{server}", means: "the server's name" },
  { key: "{position}", means: "the position" },
] as const;

export type ApplicationStatus = "pending" | "accepted" | "denied";

export interface ApplicationView {
  id: number;
  number: number;
  positionId: string;
  positionName: string;
  status: ApplicationStatus;
  applicantId: string;
  applicantTag: string;
  answers: { question: string; answer: string }[];
  claimedByTag: string | null;
  decidedByTag: string | null;
  /** The note sent to the applicant with the decision. */
  decisionReason: string | null;
  /** Link to the review message in Discord. */
  messageUrl: string | null;
  createdAt: number;
  decidedAt: number | null;
}

export interface AppPanelView extends AppPanelInput {
  /** Link to the posted panel, or null when it isn't up. */
  messageUrl: string | null;
}

export interface StaffApplicationsResponse {
  settings: StaffApplicationSettings;
  panel: AppPanelView | null;
  /** The 100 most recent applications. */
  applications: ApplicationView[];
  pendingCount: number;
  problems: string[];
}

/** What a reviewer sends from the dashboard. */
export const applicationDecisionInput = z.object({
  decision: z.enum(["accepted", "denied"]),
  /** Optional note included in the DM to the applicant. */
  reason: z.string().trim().max(1000).default(""),
});
export type ApplicationDecisionInput = z.infer<typeof applicationDecisionInput>;
