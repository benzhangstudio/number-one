import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type GuildMember,
  type Message,
  OverwriteType,
  PermissionFlagsBits,
  type TextChannel,
  type User,
} from "discord.js";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { canReadMessages } from "../../server/bot/discord.js";
import { db, sqlite } from "../../server/db/client.js";
import { tickets } from "../../server/db/schema.js";
import type { TicketForm, TicketSettings, TicketType } from "../../shared/tickets.js";
import { TicketError, TEXT_TYPES, log, postableChannel, settingsOf } from "./panels.js";

/** Tickets themselves: opening the private channel, claiming, adding people and closing with a transcript. */

export type TicketRow = typeof tickets.$inferSelect;

/** What a member and staff can do in a ticket channel. */
const MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];
const STAFF_PERMS = [...MEMBER_PERMS, PermissionFlagsBits.ManageMessages];
const BOT_PERMS = [...MEMBER_PERMS, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages];

/** Discord allows 50 channels in a category. */
const CATEGORY_LIMIT = 50;
const DELETE_DELAY_MS = 5000;
const TRANSCRIPT_LIMIT = 1000;

export const openTicketIn = (channelId: string) =>
  db.select().from(tickets).where(and(eq(tickets.channelId, channelId), eq(tickets.status, "open"))).get();

export const openTicketsOf = (guildId: string, userId: string) =>
  db.select().from(tickets).where(and(eq(tickets.guildId, guildId), eq(tickets.openerId, userId), eq(tickets.status, "open"))).all();

export async function openCount(guildId: string) {
  const row = await db.select({ n: count() }).from(tickets).where(and(eq(tickets.guildId, guildId), eq(tickets.status, "open"))).get();
  return row?.n ?? 0;
}

export const recentTickets = (guildId: string, limit = 50) =>
  db.select().from(tickets).where(eq(tickets.guildId, guildId)).orderBy(desc(tickets.id)).limit(limit).all();

/** Next ticket number for a server. node:sqlite runs synchronously, so two tickets can never get the same number. */
function nextNumber(guildId: string): number {
  const row = sqlite
    .prepare("INSERT INTO ticket_counters (guild_id, last) VALUES (?, 1) ON CONFLICT(guild_id) DO UPDATE SET last = last + 1 RETURNING last")
    .get(guildId) as { last: number };
  return row.last;
}

/** Staff can handle any ticket: ticket staff roles, the type's own staff, and anyone with Manage Channels. */
export function isStaff(member: GuildMember, ticket: TicketRow | null, s: TicketSettings) {
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  const roles = [...s.staffRoleIds, ...(ticket?.staffRoleIds ?? [])];
  return roles.some((id) => member.roles.cache.has(id));
}

export const canClose = (member: GuildMember, ticket: TicketRow, s: TicketSettings) =>
  isStaff(member, ticket, s) || (s.membersCanClose && member.id === ticket.openerId);

/** The ticket has a starter form the opener hasn't sent yet. */
export const formPending = (t: Pick<TicketRow, "form" | "formAnswers">) => Boolean(t.form?.enabled && !t.formAnswers);

/** The buttons at the top of a ticket: Fill in the form (while it's waiting), Close and Claim. */
export function ticketControls(claimedByTag: string | null, showForm = false) {
  const claim = new ButtonBuilder().setCustomId("tk:claim").setStyle(ButtonStyle.Secondary).setEmoji("🙋");
  if (claimedByTag) claim.setLabel(`Claimed by ${claimedByTag}`.slice(0, 80)).setDisabled(true);
  else claim.setLabel("Claim");
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (showForm) row.addComponents(new ButtonBuilder().setCustomId("tk:form").setLabel("Fill in the form").setStyle(ButtonStyle.Success).setEmoji("📝"));
  row.addComponents(new ButtonBuilder().setCustomId("tk:close").setLabel("Close").setStyle(ButtonStyle.Danger).setEmoji("🔒"), claim);
  return [row];
}

/** The starter form as a Discord pop-up. */
export function formModal(form: TicketForm) {
  return new ModalBuilder()
    .setCustomId("tk:formsend")
    .setTitle(form.title.slice(0, 45))
    .addComponents(
      form.questions.map((q) => {
        const input = new TextInputBuilder()
          .setCustomId(q.id)
          .setLabel(q.label)
          .setStyle(q.style === "short" ? TextInputStyle.Short : TextInputStyle.Paragraph)
          .setRequired(q.required)
          .setMaxLength(1000);
        if (q.placeholder) input.setPlaceholder(q.placeholder);
        return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
      }),
    );
}

/**
 * Saves the opener's answers, posts them in the ticket and lets them type (if the form locked the ticket).
 * Returns false if the form was already sent.
 */
export async function submitForm(channel: TextChannel, ticket: TicketRow, member: GuildMember, answers: { question: string; answer: string }[]) {
  const saved = await db
    .update(tickets)
    .set({ formAnswers: answers })
    .where(and(eq(tickets.id, ticket.id), isNull(tickets.formAnswers)))
    .returning({ id: tickets.id })
    .all();
  if (!saved.length) return false;

  // The opener is named, not pinged: they just sent it.
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xff4fa3)
        .setTitle(`📝 ${ticket.form?.title ?? "Form answers"}`)
        .setDescription(`Answers from ${member}`)
        .addFields(answers.map((a) => ({ name: a.question, value: a.answer.slice(0, 1024) || "—" })))
        .setTimestamp(),
    ],
    allowedMentions: { parse: [] },
  });
  if (ticket.form?.lockUntilSubmitted) {
    await channel.permissionOverwrites
      .edit(member.id, { SendMessages: true, AttachFiles: true }, { reason: "Ticket starter form sent", type: OverwriteType.Member })
      .catch((err: Error) => log(`couldn't unlock ticket #${ticket.number} in ${channel.guild.name}:`, err.message));
  }
  return true;
}

const fill = (text: string, v: Record<string, string>) => text.replace(/\{(user|username|server|type|number)\}/g, (m, k: string) => v[k] ?? m);

function channelName(prefix: string, number: number, member: GuildMember, naming: TicketSettings["naming"]) {
  if (naming === "username") {
    const name = member.user.username.toLowerCase().replace(/[^a-z0-9-]+/g, "").slice(0, 70) || String(number);
    return `${prefix}-${name}`;
  }
  return `${prefix}-${String(number).padStart(4, "0")}`;
}

/** The log channel, if one is set and Number One can post there. */
async function logChannel(guild: Guild, s: TicketSettings) {
  if (!s.logChannelId) return null;
  try {
    return postableChannel(guild, s.logChannelId, "ticket logs");
  } catch (err) {
    log(`can't post ticket logs in ${guild.name}:`, (err as Error).message);
    return null;
  }
}

/** Opens a ticket: a private channel for the member and the staff, with the welcome message. */
export async function openTicket(member: GuildMember, panelId: number, type: TicketType): Promise<TextChannel> {
  const guild = member.guild;
  const s = await settingsOf(guild.id);
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new TicketError("I need the Manage Channels permission to open tickets. Please let a server admin know.");
  }

  const staff = [...new Set([...s.staffRoleIds, ...type.staffRoleIds])].filter((id) => guild.roles.cache.has(id) && id !== guild.id);
  const parentId = type.categoryId ?? s.categoryId;
  const parent = parentId ? guild.channels.cache.get(parentId) : null;
  const fits = parent?.type === ChannelType.GuildCategory && parent.children.cache.size < CATEGORY_LIMIT;
  if (parent && !fits) log(`ticket category in ${guild.name} is full or missing; opening at the top instead`);

  const form = type.form.enabled ? type.form : null;
  // Locked: the opener can read, but can't type or upload until they've sent the form.
  const opener = form?.lockUntilSubmitted
    ? { id: member.id, type: OverwriteType.Member, allow: MEMBER_PERMS.filter((p) => p !== PermissionFlagsBits.SendMessages && p !== PermissionFlagsBits.AttachFiles), deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] }
    : { id: member.id, type: OverwriteType.Member, allow: MEMBER_PERMS };

  const number = nextNumber(guild.id);
  const channel = await guild.channels
    .create({
      name: channelName(type.namePrefix, number, member, s.naming),
      type: ChannelType.GuildText,
      parent: fits ? parent.id : null,
      topic: `Ticket #${number} · ${type.label} · opened by ${member.user.tag}`,
      reason: `Ticket #${number} opened by ${member.user.tag}`,
      permissionOverwrites: [
        { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me.id, type: OverwriteType.Member, allow: BOT_PERMS },
        opener,
        ...staff.map((id) => ({ id, type: OverwriteType.Role, allow: STAFF_PERMS })),
      ],
    })
    .catch((err: Error) => {
      throw new TicketError(`I couldn't create the ticket channel: ${err.message}. Please let a server admin know.`);
    });

  await db
    .insert(tickets)
    .values({
      guildId: guild.id,
      number,
      channelId: channel.id,
      panelId,
      type: type.label,
      staffRoleIds: staff,
      openerId: member.id,
      openerTag: member.user.tag,
      form,
      createdAt: new Date(),
    })
    .run();

  const vars = { user: `${member}`, username: member.displayName, server: guild.name, type: type.label, number: String(number) };
  const embed = new EmbedBuilder()
    .setColor(0xff4fa3)
    .setTitle(`🎫 ${type.label} · Ticket #${number}`)
    .setDescription(fill(type.welcomeMessage, vars).trim() || "A staff member will be with you soon.")
    .setFooter({ text: "Press Close when you're done." });
  if (form) {
    embed.addFields({
      name: "📝 Start by filling in the form",
      value: `${member}, press **Fill in the form** below.${form.lockUntilSubmitted ? " You'll be able to type here once it's sent." : ""}`,
    });
  }
  const pings = s.pingStaff ? staff.map((id) => `<@&${id}>`) : [];
  await channel
    .send({
      content: [`${member}`, ...pings].join(" "),
      embeds: [embed],
      components: ticketControls(null, Boolean(form)),
      allowedMentions: { users: [member.id], roles: s.pingStaff ? staff : [] },
    })
    .then((m) => m.pin().catch(() => {}))
    .catch((err: Error) => log(`couldn't post the ticket welcome in ${guild.name}:`, err.message));

  const logs = await logChannel(guild, s);
  await logs
    ?.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3ba55d)
          .setTitle(`🎫 Ticket #${number} opened`)
          .addFields(
            { name: "Type", value: type.label, inline: true },
            { name: "Opened by", value: `${member} (${member.user.tag})`, inline: true },
            { name: "Channel", value: `${channel}`, inline: true },
          )
          .setTimestamp(),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => {});

  return channel;
}

export async function claimTicket(ticket: TicketRow, by: User) {
  await db.update(tickets).set({ claimedById: by.id, claimedByTag: by.tag }).where(eq(tickets.id, ticket.id)).run();
}

/** Lets someone else see and talk in a ticket. */
export async function addToTicket(channel: TextChannel, user: User) {
  await channel.permissionOverwrites.edit(user, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true }, {
    reason: "Added to the ticket",
    type: OverwriteType.Member,
  });
}

export async function removeFromTicket(channel: TextChannel, user: User) {
  await channel.permissionOverwrites.delete(user, "Removed from the ticket");
}

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** The whole conversation as plain text, oldest first. */
async function buildTranscript(channel: TextChannel, ticket: TicketRow, closedBy: User, reason: string | null) {
  const messages: Message[] = [];
  let before: string | undefined;
  while (messages.length < TRANSCRIPT_LIMIT) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last()!.id;
    if (batch.size < 100) break;
  }
  messages.reverse();

  const lines = [
    `Ticket #${ticket.number} · ${ticket.type}`,
    `Server: ${channel.guild.name}`,
    `Opened by: ${ticket.openerTag} (${ticket.openerId}) on ${stamp(ticket.createdAt)}`,
    ...(ticket.reason ? [`Reason: ${ticket.reason}`] : []),
    ...(ticket.formAnswers ?? []).map((a) => `${a.question}: ${a.answer}`),
    ...(ticket.claimedByTag ? [`Claimed by: ${ticket.claimedByTag}`] : []),
    `Closed by: ${closedBy.tag} on ${stamp(new Date())}${reason ? ` (${reason})` : ""}`,
    ...(messages.length >= TRANSCRIPT_LIMIT ? [`Only the last ${TRANSCRIPT_LIMIT} messages are included.`] : []),
    ...(canReadMessages() ? [] : ["Message text is missing: turn on Message Content Intent in the Discord Developer Portal."]),
    "",
    "".padEnd(60, "-"),
    "",
  ];
  for (const m of messages) {
    const parts = [m.content];
    for (const e of m.embeds) {
      parts.push(`[embed] ${[e.title, e.description].filter(Boolean).join(" — ")}`);
      for (const f of e.fields) parts.push(`  ${f.name}: ${f.value}`);
    }
    for (const a of m.attachments.values()) parts.push(`[file] ${a.url}`);
    lines.push(`[${stamp(m.createdAt)}] ${m.author.tag}: ${parts.filter(Boolean).join("\n    ")}`);
  }
  return new AttachmentBuilder(Buffer.from(lines.join("\n"), "utf8"), { name: `ticket-${ticket.number}.txt` });
}

/**
 * Closes a ticket: logs it with a transcript, optionally DMs the transcript, then deletes the channel.
 * Returns false if it was already closed (e.g. two people pressed Close at once).
 */
export async function closeTicket(guild: Guild, ticket: TicketRow, by: User, reason: string | null): Promise<boolean> {
  const closed = await db
    .update(tickets)
    .set({ status: "closed", closedAt: new Date(), closedByTag: by.tag, closeReason: reason })
    .where(and(eq(tickets.id, ticket.id), eq(tickets.status, "open")))
    .returning({ id: tickets.id })
    .all();
  if (!closed.length) return false;

  const s = await settingsOf(guild.id);
  const found = guild.channels.cache.get(ticket.channelId);
  const channel = found && TEXT_TYPES.has(found.type) ? (found as TextChannel) : null;
  const transcript = channel ? await buildTranscript(channel, ticket, by, reason).catch(() => null) : null;

  await channel
    ?.send({
      content: `🔒 Ticket closed by ${by}${reason ? `: ${reason}` : "."} This channel will be deleted in ${DELETE_DELAY_MS / 1000} seconds.`,
      allowedMentions: { parse: [] },
    })
    .catch(() => {});

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`🔒 Ticket #${ticket.number} closed`)
    .addFields(
      { name: "Type", value: ticket.type, inline: true },
      { name: "Opened by", value: `<@${ticket.openerId}> (${ticket.openerTag})`, inline: true },
      { name: "Closed by", value: `${by} (${by.tag})`, inline: true },
      ...(ticket.claimedByTag ? [{ name: "Claimed by", value: ticket.claimedByTag, inline: true }] : []),
      { name: "Opened", value: `<t:${Math.floor(ticket.createdAt.getTime() / 1000)}:R>`, inline: true },
      ...(reason ? [{ name: "Reason", value: reason.slice(0, 1024) }] : []),
    )
    .setTimestamp();
  const logs = await logChannel(guild, s);
  await logs?.send({ embeds: [embed], files: transcript ? [transcript] : [], allowedMentions: { parse: [] } }).catch(() => {});

  if (s.dmTranscript) {
    const opener = await guild.client.users.fetch(ticket.openerId).catch(() => null);
    await opener
      ?.send({
        content: `Your ticket **#${ticket.number}** (${ticket.type}) in **${guild.name}** was closed. Here's a copy of the conversation.`,
        files: transcript ? [transcript] : [],
      })
      .catch(() => {}); // DMs closed
  }

  if (channel) {
    setTimeout(() => {
      channel.delete(`Ticket #${ticket.number} closed by ${by.tag}`).catch((err: Error) => log(`couldn't delete ticket channel in ${guild.name}:`, err.message));
    }, DELETE_DELAY_MS).unref();
  }
  return true;
}

/** The ticket channel is gone (deleted by hand, or while Number One was offline): mark the ticket closed. */
export async function markGone(channelId: string) {
  await db
    .update(tickets)
    .set({ status: "closed", closedAt: new Date(), closedByTag: "Channel deleted" })
    .where(and(eq(tickets.channelId, channelId), eq(tickets.status, "open")))
    .run();
}
