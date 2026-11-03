import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * One row per (server, feature): whether the feature is on and its settings.
 * Settings are stored as JSON and validated by the feature's schema in src/shared/features.
 * Features that need their own records (warnings, tickets, logs...) add their own tables below.
 */
export const featureSettings = sqliteTable(
  "feature_settings",
  {
    guildId: text("guild_id").notNull(),
    featureId: text("feature_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.featureId] })],
);

/**
 * Servers the bot was removed from. Their data is deleted 30 days later (Discord requires deleting
 * data that's no longer needed), unless the bot is added back first. See src/server/guildData.ts.
 */
export const removedGuilds = sqliteTable("removed_guilds", {
  guildId: text("guild_id").primaryKey(),
  removedAt: integer("removed_at", { mode: "timestamp_ms" }).notNull(),
});

/** Dashboard login sessions. The Discord access token is stored encrypted (see src/server/web/tokenCrypto.ts). */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  username: text("username").notNull(),
  avatar: text("avatar"),
  accessToken: text("access_token").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/** Reaction roles: one row per reaction-role message the bot posted. */
export const reactionRoleMessages = sqliteTable(
  "reaction_role_messages",
  {
    messageId: text("message_id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    /** Embed title. */
    title: text("title").notNull(),
    /** Embed description. */
    description: text("description").notNull().default(""),
    /** Old single-choice switch. Replaced by mode = "unique"; kept so old databases still migrate. */
    singleChoice: integer("single_choice", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** Internal name shown only in the dashboard. */
    name: text("name").notNull().default(""),
    /** "reactions", "buttons" or "dropdown". */
    kind: text("kind").notNull().default("reactions"),
    /** Selection mode (see src/shared/reactionRoles.ts). Replaces single_choice, which is kept only for old rows. */
    mode: text("mode").notNull().default("normal"),
    /** Plain text above the embed. */
    content: text("content").notNull().default(""),
    /** Embed look, restrictions and other per-message options (JSON, validated by reactionRoleOptions). */
    options: text("options", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    /** The message was posted by someone else: the bot only adds reactions and never edits or deletes it. */
    external: integer("external", { mode: "boolean" }).notNull().default(false),
  },
  // Lookups by server (dashboard list) and channel (cleanup when a channel is deleted).
  (t) => [index("reaction_role_messages_guild_idx").on(t.guildId), index("reaction_role_messages_channel_idx").on(t.channelId)],
);

/** Reaction roles: which emoji gives which role on a message. */
export const reactionRoleEntries = sqliteTable(
  "reaction_role_entries",
  {
    messageId: text("message_id")
      .notNull()
      .references(() => reactionRoleMessages.messageId, { onDelete: "cascade" }),
    /** Custom emoji ID, or the Unicode emoji itself (without variation selectors). */
    emojiKey: text("emoji_key").notNull(),
    /** How to show / react with the emoji: "<:name:id>" or the Unicode emoji. */
    emojiDisplay: text("emoji_display").notNull(),
    roleId: text("role_id").notNull(),
    position: integer("position").notNull(),
    /** Button text / dropdown option name ("" = use the role's name). */
    label: text("label").notNull().default(""),
    /** Dropdown option description. */
    description: text("description").notNull().default(""),
    /** Button colour: primary, secondary, success or danger. */
    style: text("style").notNull().default("secondary"),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.emojiKey] }), index("reaction_role_entries_role_idx").on(t.roleId)],
);

/** Reaction roles: how often each role on a menu was given and taken away. */
export const reactionRoleStats = sqliteTable(
  "reaction_role_stats",
  {
    messageId: text("message_id").notNull(),
    roleId: text("role_id").notNull(),
    added: integer("added").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.roleId] })],
);

/** Reaction roles: temporary roles waiting to be taken away. */
export const reactionRoleTimers = sqliteTable(
  "reaction_role_timers",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
    /** The menu that gave the role (kept even if the menu is deleted, so the role still expires). */
    messageId: text("message_id").notNull(),
    channelId: text("channel_id").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId, t.roleId] }), index("reaction_role_timers_due_idx").on(t.expiresAt)],
);

/** Answers from /setup: what each server uses Number One for. */
export const guildSetup = sqliteTable("guild_setup", {
  guildId: text("guild_id").primaryKey(),
  categories: text("categories", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** Empty until someone finishes /setup (or the dashboard's setup section). */
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  completedBy: text("completed_by"),
  /** When the "thanks for adding me" message was posted, so it's only sent once. */
  welcomedAt: integer("welcomed_at", { mode: "timestamp_ms" }),
});

/** Onboarding: where each member is in the onboarding steps. */
export const onboardingProgress = sqliteTable(
  "onboarding_progress",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    /** pending (joined, hasn't started), started, or done. */
    status: text("status", { enum: ["pending", "started", "done"] }).notNull(),
    step: integer("step").notNull().default(0),
    /** Question ID → chosen answer IDs. */
    answers: text("answers", { mode: "json" }).$type<Record<string, string[]>>().notNull().default({}),
    rulesAccepted: integer("rules_accepted", { mode: "boolean" }).notNull().default(false),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })],
);

/** Onboarding: bot-managed details per server (the posted "Start" message). */
export const onboardingState = sqliteTable("onboarding_state", {
  guildId: text("guild_id").primaryKey(),
  startChannelId: text("start_channel_id"),
  startMessageId: text("start_message_id"),
  /** "Make the rest of the server private" is on: only the verified role sees ordinary channels. */
  privateMode: integer("private_mode", { mode: "boolean" }).notNull().default(false),
  /**
   * Channels whose @everyone "View Channel" the bot changed, with what it was before
   * (allow, deny or none), so turning things off puts each channel back exactly as it was.
   */
  managedChannels: text("managed_channels", { mode: "json" }).$type<Record<string, "allow" | "deny" | "none">>().notNull().default({}),
});

/**
 * Moderation: one row per case (warn, note, timeout, kick, ban…). Case numbers count up per server.
 * Temporary bans stay "active" until they run out or are lifted; the bot checks for expired ones every minute.
 */
export const moderationCases = sqliteTable(
  "moderation_cases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    caseNumber: integer("case_number").notNull(),
    /** warn, note, timeout, untimeout, kick, ban or unban (see src/shared/moderation.ts). */
    action: text("action").notNull(),
    userId: text("user_id").notNull(),
    /** The member's name when the case was made, so history still reads well after they leave. */
    userTag: text("user_tag").notNull(),
    moderatorId: text("moderator_id").notNull(),
    moderatorTag: text("moderator_tag").notNull(),
    reason: text("reason").notNull().default(""),
    durationMs: integer("duration_ms"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    /** A temporary ban or timeout that hasn't ended or been lifted yet. */
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    /** Taken by Number One itself (warning steps, temporary ban running out). */
    auto: integer("auto", { mode: "boolean" }).notNull().default(false),
    /** Done directly in Discord and picked up from the audit log. */
    external: integer("external", { mode: "boolean" }).notNull().default(false),
    dmSent: integer("dm_sent", { mode: "boolean" }).notNull().default(false),
    /** The case's post in the mod log channel, so edits can update it. */
    logChannelId: text("log_channel_id"),
    logMessageId: text("log_message_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("moderation_cases_number_idx").on(t.guildId, t.caseNumber),
    index("moderation_cases_user_idx").on(t.guildId, t.userId),
    index("moderation_cases_expiry_idx").on(t.active, t.expiresAt),
  ],
);

/**
 * Anti-raid: servers currently in raid mode. Kept in the database so a restart during a raid still
 * ends raid mode on time and puts the verification level back.
 */
export const raidState = sqliteTable("raid_state", {
  guildId: text("guild_id").primaryKey(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
  /** The moderator who started it by hand, or null when the join limit started it. */
  startedById: text("started_by_id"),
  startedByTag: text("started_by_tag"),
  /** The verification level before raid mode raised it, or null if it wasn't changed. */
  previousVerification: integer("previous_verification"),
  /** Whether Number One paused invites (so it only un-pauses what it paused). */
  invitesPaused: integer("invites_paused", { mode: "boolean" }).notNull().default(false),
  /** Accounts removed, timed out or banned during this raid. */
  handled: integer("handled").notNull().default(0),
});

/** Embed messages: messages Number One posted from the dashboard's embed builder, so they can be edited later. */
export const embedMessages = sqliteTable(
  "embed_messages",
  {
    messageId: text("message_id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    /** Dashboard-only label. */
    name: text("name").notNull().default(""),
    content: text("content").notNull().default(""),
    /** The embeds (JSON, validated by embedData in src/shared/embeds.ts). */
    embeds: text("embeds", { mode: "json" }).$type<unknown[]>().notNull().default([]),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("embed_messages_guild_idx").on(t.guildId), index("embed_messages_channel_idx").on(t.channelId)],
);

/** Announcements: saved templates to start announcements from. */
export const announcementTemplates = sqliteTable(
  "announcement_templates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    channelId: text("channel_id"),
    /** Text and embed (JSON, validated by announcementMessage in src/shared/announcements.ts). */
    message: text("message", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    ping: text("ping", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("announcement_templates_guild_idx").on(t.guildId)],
);

/**
 * Announcements: every announcement sent or waiting to be sent.
 * Scheduled ones are checked every 30 seconds, so they still go out after a restart.
 */
export const announcements = sqliteTable(
  "announcements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    /** The posted message, once sent. */
    messageId: text("message_id"),
    message: text("message", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    ping: text("ping", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    publish: integer("publish", { mode: "boolean" }).notNull().default(false),
    /** scheduled, sent or failed. */
    status: text("status", { enum: ["scheduled", "sent", "failed"] }).notNull(),
    scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    /** Why it couldn't be sent, in plain words. */
    error: text("error").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdByTag: text("created_by_tag").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("announcements_guild_idx").on(t.guildId, t.createdAt), index("announcements_due_idx").on(t.status, t.scheduledAt)],
);

/** Events: one row per event posted from the dashboard. */
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    /** The posted event message. */
    messageId: text("message_id"),
    /** Everything the admin filled in (JSON, validated by eventInput in src/shared/events.ts). */
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    startAt: integer("start_at", { mode: "timestamp_ms" }).notNull(),
    /** When it counts as over: the end time, or 2 hours after the start when there's none. */
    endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
    /** When to DM reminders, or null for none. Cleared once sent. */
    remindAt: integer("remind_at", { mode: "timestamp_ms" }),
    /** upcoming, ended or cancelled. */
    status: text("status", { enum: ["upcoming", "ended", "cancelled"] }).notNull().default("upcoming"),
    /** The matching Discord scheduled event (Events tab), if it was added. */
    discordEventId: text("discord_event_id"),
    createdBy: text("created_by").notNull(),
    createdByTag: text("created_by_tag").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("events_guild_idx").on(t.guildId, t.startAt),
    index("events_remind_idx").on(t.remindAt),
    index("events_status_idx").on(t.status, t.endsAt),
  ],
);

/** Events: who answered Going, Maybe or Can't go. */
export const eventRsvps = sqliteTable(
  "event_rsvps",
  {
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    /** going, maybe or no. */
    choice: text("choice", { enum: ["going", "maybe", "no"] }).notNull(),
    answeredAt: integer("answered_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index("event_rsvps_guild_idx").on(t.guildId)],
);

/**
 * Channel designs: the name each channel had before Number One added a design, and the name it set,
 * so designs can be swapped or removed without changing the channel's own name.
 */
export const channelDesigns = sqliteTable(
  "channel_designs",
  {
    channelId: text("channel_id").primaryKey(),
    guildId: text("guild_id").notNull(),
    /** The channel's own name, without the design. */
    baseName: text("base_name").notNull(),
    /** The name Number One gave it. If the channel is renamed by hand later, the new name becomes its own name. */
    appliedName: text("applied_name").notNull(),
  },
  (t) => [index("channel_designs_guild_idx").on(t.guildId)],
);

/** Custom commands: slash commands admins made for their own server. */
export const customCommands = sqliteTable(
  "custom_commands",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    /** Description and reply (JSON, validated by customCommandInput in src/shared/customCommands.ts). */
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    uses: integer("uses").notNull().default(0),
    createdBy: text("created_by").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("custom_commands_name_idx").on(t.guildId, t.name)],
);

/** Rule verification: where each server's rules message with the "I agree" button is posted. */
export const ruleVerificationPosts = sqliteTable("rule_verification_posts", {
  guildId: text("guild_id").primaryKey(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull(),
});

/** Tickets: the panels (messages with "open a ticket" buttons or a dropdown) admins posted. */
export const ticketPanels = sqliteTable(
  "ticket_panels",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    /** The posted message, or null while it isn't up (feature off, or deleted in Discord). */
    messageId: text("message_id"),
    /** Look and ticket types (JSON, validated by ticketPanelInput in src/shared/tickets.ts). */
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("ticket_panels_guild_idx").on(t.guildId), index("ticket_panels_message_idx").on(t.messageId)],
);

/** Tickets: one row per ticket opened. The channel is deleted when it closes; the row stays as history. */
export const tickets = sqliteTable(
  "tickets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    /** Numbered per server: #1, #2... */
    number: integer("number").notNull(),
    channelId: text("channel_id").notNull(),
    panelId: integer("panel_id"),
    /** The ticket type's name when it was opened. */
    type: text("type").notNull(),
    /** Staff roles that could see it (server staff + the type's own). */
    staffRoleIds: text("staff_role_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    openerId: text("opener_id").notNull(),
    openerTag: text("opener_tag").notNull(),
    reason: text("reason"),
    /** The starter form's answers, once the opener sent it. Null while it's not sent (or there's no form). */
    formAnswers: text("form_answers", { mode: "json" }).$type<{ question: string; answer: string }[]>(),
    /** A copy of the starter form when the ticket opened (so later panel edits don't change it), or null for none. */
    form: text("form", { mode: "json" }).$type<import("../../shared/tickets.js").TicketForm>(),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    claimedById: text("claimed_by_id"),
    claimedByTag: text("claimed_by_tag"),
    closedByTag: text("closed_by_tag"),
    closeReason: text("close_reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("tickets_number_idx").on(t.guildId, t.number),
    index("tickets_channel_idx").on(t.channelId),
    index("tickets_status_idx").on(t.guildId, t.status, t.openerId),
  ],
);

/** Tickets: the last ticket number used in each server. */
export const ticketCounters = sqliteTable("ticket_counters", {
  guildId: text("guild_id").primaryKey(),
  last: integer("last").notNull().default(0),
});

/**
 * Guides: where each server's Server guide and Staff guide are posted.
 * The guide's text lives in the feature settings; this keeps the posted messages (contents first, then one per section).
 */
export const guidePosts = sqliteTable(
  "guide_posts",
  {
    guildId: text("guild_id").notNull(),
    /** server or staff. */
    kind: text("kind", { enum: ["server", "staff"] }).notNull(),
    channelId: text("channel_id").notNull(),
    messageIds: text("message_ids", { mode: "json" }).$type<string[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.kind] })],
);

/** Number One updates: announcements the bot's developer sent from the Developer page. */
export const devUpdates = sqliteTable("dev_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url").notNull().default(""),
  mention: integer("mention", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status", { enum: ["sending", "done"] }).notNull().default("sending"),
});

/** Number One updates: one row per server an update was posted to (or failed for), so a restart never posts twice. */
export const devUpdateDeliveries = sqliteTable(
  "dev_update_deliveries",
  {
    updateId: integer("update_id")
      .notNull()
      .references(() => devUpdates.id, { onDelete: "cascade" }),
    guildId: text("guild_id").notNull(),
    outcome: text("outcome", { enum: ["sent", "failed"] }).notNull(),
    reason: text("reason").notNull().default(""),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.updateId, t.guildId] }), index("dev_update_deliveries_guild_idx").on(t.guildId)],
);

/** Staff applications: each server's apply panel (one per server). */
export const applicationPanels = sqliteTable("application_panels", {
  guildId: text("guild_id").primaryKey(),
  channelId: text("channel_id").notNull(),
  /** The posted message, or null while it isn't up (feature off, or deleted in Discord). */
  messageId: text("message_id"),
  /** Look and positions (JSON, validated by appPanelInput in src/shared/staffApplications.ts). */
  details: text("details", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Staff applications: one row per application sent. */
export const staffApplications = sqliteTable(
  "staff_applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    /** Counts up per server: application #1, #2... */
    number: integer("number").notNull(),
    positionId: text("position_id").notNull(),
    /** Kept as it was when they applied, in case the position is renamed or removed later. */
    positionName: text("position_name").notNull(),
    applicantId: text("applicant_id").notNull(),
    applicantTag: text("applicant_tag").notNull(),
    answers: text("answers", { mode: "json" }).$type<{ question: string; answer: string }[]>().notNull(),
    status: text("status", { enum: ["pending", "accepted", "denied"] }).notNull().default("pending"),
    /** The review message in the staff channel. */
    channelId: text("channel_id"),
    messageId: text("message_id"),
    claimedById: text("claimed_by_id"),
    claimedByTag: text("claimed_by_tag"),
    decidedById: text("decided_by_id"),
    decidedByTag: text("decided_by_tag"),
    decisionReason: text("decision_reason"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("staff_applications_number_idx").on(t.guildId, t.number),
    index("staff_applications_applicant_idx").on(t.guildId, t.applicantId, t.positionId),
    index("staff_applications_status_idx").on(t.guildId, t.status),
  ],
);

/** Levels: each member's XP in a server. Kept when they leave, so rejoining doesn't wipe their progress. */
export const memberLevels = sqliteTable(
  "member_levels",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    xp: integer("xp").notNull().default(0),
    /** Messages that earned XP. */
    messages: integer("messages").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] }), index("member_levels_rank_idx").on(t.guildId, t.xp)],
);
