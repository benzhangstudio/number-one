import { z } from "zod";

/**
 * Tickets: shapes shared by the bot and the dashboard.
 * Admins post ticket panels (a message with buttons or a dropdown). Pressing one opens a private
 * channel between that member and the staff, which can be claimed and closed with a transcript.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

const link = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Image links must start with https://")
  .default("");

export const MAX_TICKET_PANELS = 10;
/** Buttons fill two rows of five; a dropdown would allow 25 but ten types is plenty. */
export const MAX_TICKET_TYPES = 10;
export const MAX_STAFF_ROLES = 10;

/** Discord's pop-up forms hold at most 5 questions. */
export const MAX_FORM_QUESTIONS = 5;

export const formQuestion = z.object({
  /** Short random ID, set by the dashboard. */
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  /** Discord limits pop-up labels to 45 characters. */
  label: z.string().trim().min(1, "Every question needs a label").max(45),
  /** Short = one line, long = a paragraph. */
  style: z.enum(["short", "long"]).default("long"),
  placeholder: z.string().trim().max(100).default(""),
  required: z.boolean().default(true),
});
export type FormQuestion = z.infer<typeof formQuestion>;

/** The starter form: questions the opener answers inside their new ticket. */
export const ticketForm = z.object({
  enabled: z.boolean().default(false),
  /** Shown at the top of the pop-up (Discord allows 45 characters). */
  title: z.string().trim().min(1, "Give the form a title").max(45).default("Tell us about your ticket"),
  questions: z
    .array(formQuestion)
    .min(1, "Add at least one question")
    .max(MAX_FORM_QUESTIONS)
    .default([{ id: "q1", label: "What do you need help with?", style: "long", placeholder: "", required: true }]),
  /** The opener can read but not type until they've sent the form. Staff can always type. */
  lockUntilSubmitted: z.boolean().default(false),
});
export type TicketForm = z.infer<typeof ticketForm>;

export const ticketButtonStyles = ["primary", "secondary", "success", "danger"] as const;
export type TicketButtonStyle = (typeof ticketButtonStyles)[number];

/** One kind of ticket on a panel, like "Support" or "Report a member". */
const ticketTypeShape = z.object({
  /** Short random ID, set by the dashboard. Used in button IDs, so it never changes. */
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  label: z.string().trim().min(1, "Every ticket type needs a name").max(80),
  /** A standard emoji, or a custom emoji from this server. Optional. */
  emoji: z.string().trim().max(64).default(""),
  /** Shown under the name in the dropdown. */
  description: z.string().trim().max(100).default(""),
  buttonStyle: z.enum(ticketButtonStyles).default("primary"),
  /** Start of the ticket channel's name, e.g. "support" → support-0001. */
  namePrefix: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{1,20}$/, "Channel name starts can only use lowercase letters, numbers and - (up to 20).")
    .default("ticket"),
  /** Opens the ticket in this category instead of the default one. */
  categoryId: snowflake.nullable().default(null),
  /** Extra staff roles for this type only, on top of the server's ticket staff. */
  staffRoleIds: z.array(snowflake).max(MAX_STAFF_ROLES).default([]),
  /** First message in the new ticket. */
  welcomeMessage: z
    .string()
    .max(2000)
    .default("Thanks for reaching out, {user}! Tell us what you need and a staff member will be with you soon."),
  /** Optional starter form, answered inside the ticket. */
  form: ticketForm.prefault({}),
});
/** Older ticket types asked one question before opening; that becomes a one-question starter form. */
export const ticketType = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const { askReason, reasonLabel, ...rest } = raw as Record<string, unknown>;
  if (askReason && !("form" in rest)) {
    const label = typeof reasonLabel === "string" && reasonLabel.trim() ? reasonLabel.trim().slice(0, 45) : "What do you need help with?";
    return { ...rest, form: { enabled: true, questions: [{ id: "q1", label, style: "long", required: true }] } };
  }
  return rest;
}, ticketTypeShape);
export type TicketType = z.infer<typeof ticketType>;

export const ticketPanelInput = z
  .object({
    channelId: snowflake,
    title: z.string().trim().max(256).default("🎫 Need help?"),
    description: z.string().max(4000).default("Press a button below to open a private ticket with the staff team."),
    color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour").default("#ff4fa3"),
    image: link,
    /** Buttons under the message, or one dropdown menu. */
    style: z.enum(["buttons", "menu"]).default("buttons"),
    menuPlaceholder: z.string().trim().max(150).default("Pick a ticket type…"),
    types: z.array(ticketType).min(1, "Add at least one ticket type").max(MAX_TICKET_TYPES),
  })
  .superRefine((p, ctx) => {
    const ids = new Set<string>();
    for (const t of p.types) {
      if (new Set(t.form.questions.map((q) => q.id)).size !== t.form.questions.length) {
        ctx.addIssue({ code: "custom", message: `${t.label}: two form questions have the same ID. Reload the page and try again.` });
      }
      if (ids.has(t.id)) ctx.addIssue({ code: "custom", message: "Two ticket types have the same ID. Reload the page and try again." });
      ids.add(t.id);
    }
  });
export type TicketPanelInput = z.infer<typeof ticketPanelInput>;

/** Server-wide ticket settings (saved with the feature). */
export const ticketSettings = z.object({
  /** Roles that can see and handle every ticket. People with Manage Channels always can. */
  staffRoleIds: z.array(snowflake).max(MAX_STAFF_ROLES).default([]),
  /** Category new tickets go in. None = top of the channel list. */
  categoryId: snowflake.nullable().default(null),
  /** Where opened and closed tickets are logged, with the transcript. */
  logChannelId: snowflake.nullable().default(null),
  /** Open tickets one member can have at once. */
  maxOpenPerUser: z.number().int().min(1).max(5).default(1),
  /** Ticket channel names: support-0001, or support-username. */
  naming: z.enum(["number", "username"]).default("number"),
  /** Mention the staff roles in each new ticket. */
  pingStaff: z.boolean().default(true),
  /** The member who opened a ticket can close it themselves. */
  membersCanClose: z.boolean().default(true),
  /** DM the transcript to the member when their ticket closes. */
  dmTranscript: z.boolean().default(false),
});
export type TicketSettings = z.infer<typeof ticketSettings>;

/** Placeholders for a ticket's welcome message. */
export const TICKET_PLACEHOLDERS = [
  { key: "{user}", means: "mentions who opened it" },
  { key: "{username}", means: "their name" },
  { key: "{server}", means: "the server's name" },
  { key: "{type}", means: "the ticket type" },
  { key: "{number}", means: "the ticket number" },
] as const;

export interface TicketPanelView extends TicketPanelInput {
  id: number;
  /** Link to the posted panel, or null when it isn't up. */
  messageUrl: string | null;
}

export interface TicketView {
  id: number;
  number: number;
  type: string;
  status: "open" | "closed";
  openerId: string;
  openerTag: string;
  reason: string | null;
  /** The starter form's answers, once sent. */
  formAnswers: { question: string; answer: string }[] | null;
  claimedByTag: string | null;
  closedByTag: string | null;
  closeReason: string | null;
  /** Link to the ticket channel while it's open. */
  channelUrl: string | null;
  createdAt: number;
  closedAt: number | null;
}

export interface TicketsResponse {
  settings: TicketSettings;
  panels: TicketPanelView[];
  /** The 50 most recent tickets. */
  tickets: TicketView[];
  openCount: number;
  problems: string[];
}
