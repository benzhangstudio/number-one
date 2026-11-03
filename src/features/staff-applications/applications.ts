import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type MessageCreateOptions,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { roleProblem } from "../../server/bot/roles.js";
import { db } from "../../server/db/client.js";
import { staffApplications } from "../../server/db/schema.js";
import {
  type AppPosition,
  type ApplicationStatus,
  QUESTIONS_PER_PAGE,
  type StaffApplicationSettings,
} from "../../shared/features.js";
import { AppError, log, panelOf, postableChannel } from "./panel.js";

/** Staff applications: answering, posting for review, and accepting or denying. */

export type AppRow = typeof staffApplications.$inferSelect;
type Answer = { question: string; answer: string };

const COLORS: Record<ApplicationStatus, number> = { pending: 0xffc46b, accepted: 0x5bd6a0, denied: 0xff6b6b };
const DAY_MS = 24 * 60 * 60 * 1000;

export const pagesOf = (p: AppPosition) => Math.max(1, Math.ceil(p.questions.length / QUESTIONS_PER_PAGE));

/* ------------------------------------------------------------ answers in progress */

/**
 * Answers to earlier pages while the member fills in the next one. Kept in memory for 30 minutes:
 * if the bot restarts mid-application, the member just starts again.
 */
const drafts = new Map<string, { at: number; answers: Record<string, string> }>();
const DRAFT_MS = 30 * 60_000;
const draftKey = (guildId: string, userId: string, positionId: string) => `${guildId}:${userId}:${positionId}`;

export function saveDraft(guildId: string, userId: string, positionId: string, answers: Record<string, string>) {
  const key = draftKey(guildId, userId, positionId);
  const old = drafts.get(key);
  drafts.set(key, { at: Date.now(), answers: { ...(old && Date.now() - old.at < DRAFT_MS ? old.answers : {}), ...answers } });
  for (const [k, v] of drafts) if (Date.now() - v.at > DRAFT_MS) drafts.delete(k);
}

export function takeDraft(guildId: string, userId: string, positionId: string) {
  const key = draftKey(guildId, userId, positionId);
  const d = drafts.get(key);
  drafts.delete(key);
  return d && Date.now() - d.at < DRAFT_MS ? d.answers : null;
}

export const hasDraft = (guildId: string, userId: string, positionId: string) => {
  const d = drafts.get(draftKey(guildId, userId, positionId));
  return Boolean(d && Date.now() - d.at < DRAFT_MS);
};

/** The pop-up form for one page of a position's questions (pages start at 1). */
export function pageModal(position: AppPosition, page: number) {
  const total = pagesOf(position);
  const questions = position.questions.slice((page - 1) * QUESTIONS_PER_PAGE, page * QUESTIONS_PER_PAGE);
  const suffix = total > 1 ? ` (${page}/${total})` : "";
  const modal = new ModalBuilder()
    .setCustomId(`sa:page:${position.id}:${page}`)
    .setTitle(`${position.name.slice(0, 45 - suffix.length)}${suffix}`);
  for (const q of questions) {
    const input = new TextInputBuilder()
      .setCustomId(q.id)
      .setLabel(q.label)
      .setStyle(q.style === "short" ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setRequired(q.required)
      .setMaxLength(q.style === "short" ? 200 : 1000);
    if (q.placeholder) input.setPlaceholder(q.placeholder);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }
  return modal;
}

/* ------------------------------------------------------------ who can apply */

const pendingFor = (guildId: string, applicantId: string, positionId: string) =>
  db
    .select()
    .from(staffApplications)
    .where(
      and(
        eq(staffApplications.guildId, guildId),
        eq(staffApplications.applicantId, applicantId),
        eq(staffApplications.positionId, positionId),
        eq(staffApplications.status, "pending"),
      ),
    )
    .get();

const lastDenied = (guildId: string, applicantId: string, positionId: string) =>
  db
    .select()
    .from(staffApplications)
    .where(
      and(
        eq(staffApplications.guildId, guildId),
        eq(staffApplications.applicantId, applicantId),
        eq(staffApplications.positionId, positionId),
        eq(staffApplications.status, "denied"),
      ),
    )
    .orderBy(desc(staffApplications.decidedAt))
    .get();

/** Why this member can't apply for this position right now, or null when they can. */
export async function whyNot(member: GuildMember, position: AppPosition, s: StaffApplicationSettings): Promise<string | null> {
  if (!position.open) return `${position.name} isn't taking applications right now.`;
  if (!s.reviewChannelId) return "Applications aren't set up yet. Please let a server admin know.";
  if (position.roleIds.length && position.roleIds.every((id) => member.roles.cache.has(id))) {
    return `You already have the ${position.name} role${position.roleIds.length === 1 ? "" : "s"}.`;
  }
  if (position.requiredRoleIds.length && !position.requiredRoleIds.some((id) => member.roles.cache.has(id))) {
    const names = position.requiredRoleIds.map((id) => member.guild.roles.cache.get(id)?.name).filter(Boolean);
    return `You need ${names.length > 1 ? "one of these roles" : "this role"} to apply: ${names.map((n) => `**${n}**`).join(", ") || "a role that no longer exists"}.`;
  }
  const accountDays = (Date.now() - member.user.createdTimestamp) / DAY_MS;
  if (accountDays < s.minAccountAgeDays) {
    return `Your Discord account needs to be at least ${s.minAccountAgeDays} day${s.minAccountAgeDays === 1 ? "" : "s"} old to apply.`;
  }
  const memberDays = member.joinedTimestamp ? (Date.now() - member.joinedTimestamp) / DAY_MS : 0;
  if (memberDays < s.minMemberDays) {
    const ready = Math.floor((member.joinedTimestamp ?? Date.now()) / 1000 + s.minMemberDays * 86400);
    return `You need to be in the server for ${s.minMemberDays} day${s.minMemberDays === 1 ? "" : "s"} before applying. You can apply <t:${ready}:R>.`;
  }
  if (await pendingFor(member.guild.id, member.id, position.id)) {
    return `You already have an application for ${position.name} waiting for review. You'll get a message when it's decided.`;
  }
  if (s.cooldownDays > 0) {
    const denied = await lastDenied(member.guild.id, member.id, position.id);
    const until = denied?.decidedAt ? denied.decidedAt.getTime() + s.cooldownDays * DAY_MS : 0;
    if (until > Date.now()) return `You can apply for ${position.name} again <t:${Math.floor(until / 1000)}:R>.`;
  }
  return null;
}

/* ------------------------------------------------------------ the review message */

const reviewerPing = (s: StaffApplicationSettings) => (s.pingReviewers ? s.reviewerRoleIds.map((id) => `<@&${id}>`).join(" ") : "");

/** Buttons under a review message. None once it's decided. */
export function reviewButtons(app: Pick<AppRow, "id" | "status" | "claimedByTag">) {
  if (app.status !== "pending") return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`sa:claim:${app.id}`)
        .setLabel(app.claimedByTag ? `Claimed by ${app.claimedByTag}`.slice(0, 80) : "Claim")
        .setEmoji("🙋")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(Boolean(app.claimedByTag)),
      new ButtonBuilder().setCustomId(`sa:accept:${app.id}`).setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`sa:deny:${app.id}`).setLabel("Deny").setEmoji("❌").setStyle(ButtonStyle.Danger),
    ),
  ];
}

const STATUS_TEXT: Record<ApplicationStatus, string> = { pending: "🟡 Waiting for review", accepted: "✅ Accepted", denied: "❌ Denied" };

/**
 * The review embed. Discord caps an embed at 6000 characters, so very long applications show shortened
 * answers here and come with a text file holding everything.
 */
export function reviewEmbed(app: AppRow, member: GuildMember | null, description: string) {
  const user = member?.user;
  const lines = [
    `**Applicant:** <@${app.applicantId}> (${app.applicantTag})`,
    user ? `**Account created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>` : null,
    member?.joinedTimestamp ? `**Joined the server:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : null,
    description ? `\n*${description}*` : null,
  ].filter(Boolean);

  let status = STATUS_TEXT[app.status];
  if (app.status !== "pending" && app.decidedByTag) status += ` by ${app.decidedByTag}`;
  if (app.status === "pending" && app.claimedByTag) status += ` · claimed by ${app.claimedByTag}`;

  const head = lines.join("\n");
  const statusField = { name: "Status", value: status };
  const noteField = app.decisionReason ? { name: "Note to the applicant", value: app.decisionReason.slice(0, 1024) } : null;
  const fixed = 200 + head.length + status.length + (noteField?.value.length ?? 0) + app.positionName.length;
  const full = app.answers.reduce((n, a) => n + a.question.length + Math.max(1, a.answer.length), 0);
  // Share what's left of the 6000 characters between the answers.
  const perAnswer = full + fixed <= 5800 ? 1024 : Math.max(80, Math.floor((5800 - fixed) / Math.max(1, app.answers.length)) - 50);
  const cut = (v: string) => (v.length > perAnswer ? `${v.slice(0, perAnswer - 1)}…` : v);

  const embed = new EmbedBuilder()
    .setColor(COLORS[app.status])
    .setTitle(`📝 Application #${app.number} · ${app.positionName}`.slice(0, 256))
    .setDescription(head)
    .addFields(
      ...app.answers.slice(0, 22).map((a) => ({ name: a.question.slice(0, 256), value: cut(a.answer) || "—" })),
      statusField,
      ...(noteField ? [noteField] : []),
    )
    .setFooter({ text: `Application #${app.number}` })
    .setTimestamp(app.createdAt);
  if (user) embed.setThumbnail(user.displayAvatarURL());
  return { embed, shortened: perAnswer < 1024 && app.answers.some((a) => a.answer.length > perAnswer) };
}

function transcript(app: AppRow) {
  const text = [`Application #${app.number} for ${app.positionName}`, `Applicant: ${app.applicantTag} (${app.applicantId})`, ""]
    .concat(app.answers.flatMap((a) => [`${a.question}`, a.answer || "—", ""]))
    .join("\n");
  return new AttachmentBuilder(Buffer.from(text, "utf8"), { name: `application-${app.number}.txt` });
}

/* ------------------------------------------------------------ sending an application */

/** Saves a new application, giving it the server's next number. */
async function insertApplication(values: Omit<typeof staffApplications.$inferInsert, "number">): Promise<AppRow> {
  return db
    .insert(staffApplications)
    .values({
      ...values,
      number: sql`(SELECT COALESCE(MAX(${staffApplications.number}), 0) + 1 FROM ${staffApplications} WHERE ${staffApplications.guildId} = ${values.guildId})`,
    })
    .returning()
    .get();
}

/** Saves the answers and posts the application in the review channel. */
export async function submitApplication(member: GuildMember, position: AppPosition, s: StaffApplicationSettings, answersById: Record<string, string>) {
  const channel = postableChannel(member.guild, s.reviewChannelId ?? "", "applications");
  const answers: Answer[] = position.questions.map((q) => ({ question: q.label, answer: (answersById[q.id] ?? "").trim() }));
  const app = await insertApplication({
    guildId: member.guild.id,
    positionId: position.id,
    positionName: position.name,
    applicantId: member.id,
    applicantTag: member.user.tag,
    answers,
    createdAt: new Date(),
  });

  const { embed, shortened } = reviewEmbed(app, member, position.description);
  const ping = reviewerPing(s);
  const message: MessageCreateOptions = {
    content: ping || undefined,
    embeds: [embed],
    components: reviewButtons(app),
    files: shortened ? [transcript(app)] : [],
    allowedMentions: { parse: [], roles: ping ? s.reviewerRoleIds : [] },
  };
  try {
    const sent = await channel.send(message);
    await db.update(staffApplications).set({ channelId: channel.id, messageId: sent.id }).where(eq(staffApplications.id, app.id)).run();
    if (s.discussionThreads && channel.permissionsFor(member.guild.members.me!)?.has(PermissionFlagsBits.CreatePublicThreads)) {
      await sent
        .startThread({ name: `#${app.number} ${member.user.username} · ${position.name}`.slice(0, 100), autoArchiveDuration: 10080 })
        .catch((err: Error) => log(`couldn't open a thread in ${member.guild.name}:`, err.message));
    }
  } catch (err) {
    // Keep the application (it shows on the dashboard), but tell the member it didn't reach the staff channel.
    log(`couldn't post application #${app.number} in ${member.guild.name}:`, (err as Error).message);
    throw new AppError("Your answers were saved, but I couldn't post them for the staff. Please let a server admin know.");
  }
  return app;
}

/* ------------------------------------------------------------ reviewing */

export const appById = (guildId: string, id: number) =>
  db.select().from(staffApplications).where(and(eq(staffApplications.guildId, guildId), eq(staffApplications.id, id))).get();

export function isReviewer(member: GuildMember, s: StaffApplicationSettings) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild) || s.reviewerRoleIds.some((id) => member.roles.cache.has(id));
}

/** Updates the review message in Discord to match the application. */
async function refreshReviewMessage(guild: Guild, app: AppRow) {
  if (!app.channelId || !app.messageId) return;
  const channel = guild.channels.cache.get(app.channelId);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(app.messageId).catch(() => null);
  if (!message) return;
  const member = await guild.members.fetch(app.applicantId).catch(() => null);
  const description = (await panelOf(guild.id))?.positions.find((p) => p.id === app.positionId)?.description ?? "";
  const { embed } = reviewEmbed(app, member, description);
  await message.edit({ embeds: [embed], components: reviewButtons(app) }).catch((err: Error) => log("couldn't update a review message:", err.message));
  return message;
}

export async function claimApplication(guild: Guild, app: AppRow, by: { id: string; tag: string }) {
  const updated = await db
    .update(staffApplications)
    .set({ claimedById: by.id, claimedByTag: by.tag })
    .where(and(eq(staffApplications.id, app.id), eq(staffApplications.status, "pending"), sql`${staffApplications.claimedById} IS NULL`))
    .returning()
    .get();
  if (!updated) return false;
  await refreshReviewMessage(guild, updated);
  return true;
}

const fill = (text: string, guild: Guild, app: AppRow) =>
  text
    .replaceAll("{user}", `<@${app.applicantId}>`)
    .replaceAll("{username}", app.applicantTag)
    .replaceAll("{server}", guild.name)
    .replaceAll("{position}", app.positionName);

/**
 * Accepts or denies an application: gives the roles (on accept), DMs the applicant, and updates the review
 * message. Returns things that didn't work, in plain language. Throws if it was already decided.
 */
export async function decideApplication(
  guild: Guild,
  app: AppRow,
  decision: "accepted" | "denied",
  by: { id: string; tag: string },
  reason: string,
  s: StaffApplicationSettings,
  position: AppPosition | undefined,
) {
  const updated = await db
    .update(staffApplications)
    .set({ status: decision, decidedById: by.id, decidedByTag: by.tag, decisionReason: reason || null, decidedAt: new Date() })
    .where(and(eq(staffApplications.id, app.id), eq(staffApplications.status, "pending")))
    .returning()
    .get();
  if (!updated) throw new AppError(`Application #${app.number} was already ${app.status === "accepted" ? "accepted" : "decided"}.`);

  const warnings: string[] = [];
  const member = await guild.members.fetch(app.applicantId).catch(() => null);

  if (decision === "accepted") {
    const roles = position?.roleIds ?? [];
    if (!position) warnings.push(`The ${app.positionName} position no longer exists, so no roles were given.`);
    else if (!member) warnings.push(`${app.applicantTag} isn't in the server anymore, so no roles were given.`);
    else {
      for (const id of roles) {
        const problem = roleProblem(guild, id);
        if (problem) {
          warnings.push(`Couldn't give a role: ${problem.replace(/\*\*/g, "")}`);
          continue;
        }
        await member.roles
          .add(id, `Staff application #${app.number} accepted by ${by.tag}`)
          .catch((err: Error) => warnings.push(`Couldn't give @${guild.roles.cache.get(id)?.name ?? "a role"}: ${err.message}`));
      }
    }
  }

  if (s.dmResults) {
    const text = fill(decision === "accepted" ? s.acceptMessage : s.denyMessage, guild, updated);
    const note = reason ? `\n\n**Note from the staff:** ${reason}` : "";
    const user = member?.user ?? (await guild.client.users.fetch(app.applicantId).catch(() => null));
    const sent = user ? await user.send({ content: `${text}${note}`.slice(0, 2000), allowedMentions: { parse: [] } }).catch(() => null) : null;
    if (!sent) warnings.push(`Couldn't DM ${app.applicantTag} (their DMs are closed), so tell them yourself.`);
  }

  const message = await refreshReviewMessage(guild, updated);
  const thread = message?.thread;
  if (thread) {
    await thread
      .send({ content: `${decision === "accepted" ? "✅ Accepted" : "❌ Denied"} by ${by.tag}.${reason ? ` Note: ${reason}` : ""}`.slice(0, 2000), allowedMentions: { parse: [] } })
      .catch(() => {});
    await thread.setArchived(true).catch(() => {});
  }
  return { app: updated, warnings };
}

/* ------------------------------------------------------------ lists */

export const recentApplications = (guildId: string, limit = 100) =>
  db.select().from(staffApplications).where(eq(staffApplications.guildId, guildId)).orderBy(desc(staffApplications.id)).limit(limit).all();

export async function pendingCount(guildId: string) {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(staffApplications)
    .where(and(eq(staffApplications.guildId, guildId), eq(staffApplications.status, "pending")))
    .get();
  return Number(row?.n ?? 0);
}
