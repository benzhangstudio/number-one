import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type MessageComponentInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type ComponentHandler, type SlashCommand, onEvent } from "../../server/bot/types.js";
import { db, sqlite } from "../../server/db/client.js";
import { suggestionVotes, suggestions } from "../../server/db/schema.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import { suggestionsFeature } from "../../shared/features.js";
import {
  SUGGESTION_LIMITS,
  type SuggestionSettings,
  type SuggestionStatus,
  type SuggestionView,
  type SuggestionsResponse,
  statusInfo,
  suggestionSettings,
  suggestionStatusInput,
  suggestionStatuses,
} from "../../shared/suggestions.js";

/**
 * Suggestions: /suggest opens a short form, and the idea is posted in the suggestions channel with 👍 / 👎
 * buttons (counts on the buttons) and an optional discussion thread. Reviewers set a status with
 * /suggestion status or on the dashboard: the post is updated and the member gets a DM.
 */

type Row = typeof suggestions.$inferSelect;
type Req = FastifyRequest<{ Params: { guildId: string; id?: string } }>;

class SuggestionError extends Error {}

const log = (...args: unknown[]) => console.warn("[suggestions]", ...args);
const PREFIX = "sg";
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const settingsOf = async (guildId: string) => (await getFeatureState(guildId, suggestionsFeature)).settings as SuggestionSettings;
const messageUrl = (r: Row) => (r.messageId ? `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}` : null);
const hex = (c: string) => Number.parseInt(c.slice(1), 16);

const byNumber = (guildId: string, number: number) =>
  db
    .select()
    .from(suggestions)
    .where(and(eq(suggestions.guildId, guildId), eq(suggestions.number, number)))
    .get();
const byId = (guildId: string, id: number) =>
  db
    .select()
    .from(suggestions)
    .where(and(eq(suggestions.guildId, guildId), eq(suggestions.id, id)))
    .get();

function nextNumber(guildId: string): number {
  const row = sqlite
    .prepare("INSERT INTO suggestion_counters (guild_id, last) VALUES (?, 1) ON CONFLICT(guild_id) DO UPDATE SET last = last + 1 RETURNING last")
    .get(guildId) as { last: number };
  return row.last;
}

async function votesOf(id: number) {
  const rows = await db
    .select({ vote: suggestionVotes.vote, n: sql<number>`count(*)` })
    .from(suggestionVotes)
    .where(eq(suggestionVotes.suggestionId, id))
    .groupBy(suggestionVotes.vote)
    .all();
  return { up: Number(rows.find((r) => r.vote === 1)?.n ?? 0), down: Number(rows.find((r) => r.vote === -1)?.n ?? 0) };
}

export const isReviewer = (member: GuildMember, s: SuggestionSettings) =>
  member.permissions.has(PermissionFlagsBits.ManageGuild) ||
  member.permissions.has(PermissionFlagsBits.ManageMessages) ||
  s.reviewerRoleIds.some((id) => member.roles.cache.has(id));

/* ------------------------------------------------------------ the post */

async function buildPost(row: Row, s: SuggestionSettings) {
  const info = statusInfo[row.status];
  const { up, down } = await votesOf(row.id);
  const total = up + down;
  const embed = new EmbedBuilder()
    .setColor(hex(info.color))
    .setTitle(`💡 #${row.number} · ${row.title}`.slice(0, 256))
    .addFields({ name: "Status", value: `${info.emoji} **${info.label}**`, inline: true }, {
      name: "Votes",
      value: total ? `👍 ${up} · 👎 ${down} · ${Math.round((up / total) * 100)}% for` : "No votes yet",
      inline: true,
    })
    .setFooter({ text: info.done ? "Voting is closed." : "Vote with the buttons below. Press again to take your vote back." })
    .setTimestamp(row.createdAt);
  if (row.details.trim()) embed.setDescription(row.details);
  if (s.anonymous) embed.setAuthor({ name: "Anonymous suggestion" });
  else {
    const user = await client.users.fetch(row.authorId).catch(() => null);
    embed.setAuthor({ name: `Suggested by ${user?.displayName ?? row.authorTag}`, iconURL: user?.displayAvatarURL({ size: 64 }) });
  }
  if (row.status !== "open") {
    const by = row.reviewedBy ? ` by <@${row.reviewedBy}>` : "";
    embed.addFields({ name: "Staff response", value: `${row.reason.trim() || "No reason given."}\n-# ${info.label}${by}` });
  }
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:up:${row.id}`).setEmoji("👍").setLabel(String(up)).setStyle(ButtonStyle.Success).setDisabled(info.done),
    new ButtonBuilder().setCustomId(`${PREFIX}:down:${row.id}`).setEmoji("👎").setLabel(String(down)).setStyle(ButtonStyle.Danger).setDisabled(info.done),
  );
  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] as never[] } };
}

async function editPost(row: Row) {
  if (!row.messageId) return;
  const channel = client.guilds.cache.get(row.guildId)?.channels.cache.get(row.channelId);
  if (!channel?.isTextBased()) return;
  const s = await settingsOf(row.guildId);
  await channel.messages.edit(row.messageId, await buildPost(row, s)).catch((err: Error) => log(`couldn't update suggestion #${row.number}:`, err.message));
}

/** Busy suggestions get many votes, and Discord limits message edits, so the post updates at most every 2 seconds. */
const pending = new Map<number, NodeJS.Timeout>();
function refreshSoon(id: number) {
  if (pending.has(id)) return;
  pending.set(
    id,
    setTimeout(async () => {
      pending.delete(id);
      const row = await db.select().from(suggestions).where(eq(suggestions.id, id)).get();
      if (row) await editPost(row);
    }, 2000),
  );
}

/* ------------------------------------------------------------ sending a suggestion */

function postableChannel(guild: Guild, s: SuggestionSettings) {
  const channel = s.channelId ? guild.channels.cache.get(s.channelId) : null;
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new SuggestionError("Suggestions aren't set up yet. Ask an admin to pick a suggestions channel on the dashboard.");
  const me = guild.members.me;
  const missing = (
    [
      [PermissionFlagsBits.ViewChannel, "View Channel"],
      [PermissionFlagsBits.SendMessages, "Send Messages"],
      [PermissionFlagsBits.EmbedLinks, "Embed Links"],
    ] as const
  )
    .filter(([flag]) => !(me && channel.permissionsFor(me).has(flag)))
    .map(([, name]) => name);
  if (missing.length) throw new SuggestionError(`I can't post in the suggestions channel. I need: ${missing.join(", ")}.`);
  return channel as GuildTextBasedChannel;
}

async function createSuggestion(guild: Guild, member: GuildMember, title: string, details: string) {
  const s = await settingsOf(guild.id);
  const channel = postableChannel(guild, s);
  if (s.cooldownMinutes > 0 && !isReviewer(member, s)) {
    const since = new Date(Date.now() - s.cooldownMinutes * 60_000);
    const recent = await db
      .select({ at: suggestions.createdAt })
      .from(suggestions)
      .where(and(eq(suggestions.guildId, guild.id), eq(suggestions.authorId, member.id), gte(suggestions.createdAt, since)))
      .orderBy(desc(suggestions.createdAt))
      .get();
    if (recent) {
      const at = Math.ceil((recent.at.getTime() + s.cooldownMinutes * 60_000) / 1000);
      throw new SuggestionError(`You can send another suggestion <t:${at}:R>.`);
    }
  }

  const now = new Date();
  const [row] = await db
    .insert(suggestions)
    .values({ guildId: guild.id, number: nextNumber(guild.id), channelId: channel.id, authorId: member.id, authorTag: member.user.tag, title, details, createdAt: now, updatedAt: now })
    .returning()
    .all();
  const sent = await channel.send(await buildPost(row, s)).catch(async (err: Error) => {
    await db.delete(suggestions).where(eq(suggestions.id, row.id)).run();
    throw new SuggestionError(`Discord didn't accept the suggestion: ${err.message}`);
  });
  let threadId: string | null = null;
  if (s.threads && channel.type === ChannelType.GuildText) {
    const thread = await sent
      .startThread({ name: `#${row.number} ${title}`.slice(0, 100), autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek, reason: "Suggestion discussion" })
      .catch(() => null); // missing Create Public Threads: the suggestion still works without one
    threadId = thread?.id ?? null;
  }
  await db.update(suggestions).set({ messageId: sent.id, threadId }).where(eq(suggestions.id, row.id)).run();
  return { ...row, messageId: sent.id, threadId };
}

/* ------------------------------------------------------------ reviewing */

async function setStatus(guild: Guild, row: Row, status: SuggestionStatus, reason: string, reviewer: { id: string; tag: string }) {
  const next: Row = { ...row, status, reason: status === "open" ? "" : reason, reviewedBy: status === "open" ? null : reviewer.id, reviewedByTag: status === "open" ? null : reviewer.tag, updatedAt: new Date() };
  await db
    .update(suggestions)
    .set({ status: next.status, reason: next.reason, reviewedBy: next.reviewedBy, reviewedByTag: next.reviewedByTag, updatedAt: next.updatedAt })
    .where(eq(suggestions.id, row.id))
    .run();
  clearTimeout(pending.get(row.id));
  pending.delete(row.id);
  await editPost(next);

  const s = await settingsOf(guild.id);
  // Close the discussion once it's decided.
  if (next.threadId && statusInfo[status].done) {
    const thread = guild.channels.cache.get(next.threadId) ?? (await guild.channels.fetch(next.threadId).catch(() => null));
    if (thread?.isThread()) await thread.setArchived(true, `Suggestion ${statusInfo[status].label.toLowerCase()}`).catch(() => {});
  }
  if (s.dmAuthor && status !== row.status && status !== "open") {
    const info = statusInfo[status];
    const user = await client.users.fetch(row.authorId).catch(() => null);
    const embed = new EmbedBuilder()
      .setColor(hex(info.color))
      .setTitle(`${info.emoji} Your suggestion was ${status === "considering" ? "picked up for a closer look" : info.label.toLowerCase()}`)
      .setDescription([`**#${row.number} · ${row.title}**`, next.reason ? `> ${next.reason.replace(/\n/g, "\n> ")}` : "", messageUrl(next) ? `[See it](${messageUrl(next)})` : ""].filter(Boolean).join("\n\n"))
      .setFooter({ text: guild.name });
    await user?.send({ embeds: [embed] }).catch(() => {}); // DMs closed: nothing to do
  }
  return next;
}

/* ------------------------------------------------------------ Discord */

const suggestModal = () =>
  new ModalBuilder()
    .setCustomId(`${PREFIX}:new`)
    .setTitle("Make a suggestion")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("title").setLabel("Your idea, in a few words").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(SUGGESTION_LIMITS.title),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("details")
          .setLabel("Details (optional)")
          .setPlaceholder("Why would it help? How could it work?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(SUGGESTION_LIMITS.details),
      ),
    );

const suggestCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("suggest").setDescription("Suggest an idea for the server. Others can vote on it.").setContexts(0),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    try {
      postableChannel(interaction.guild, s);
    } catch (err) {
      if (err instanceof SuggestionError) return interaction.reply({ content: err.message, flags: MessageFlags.Ephemeral });
      throw err;
    }
    return interaction.showModal(suggestModal());
  },
};

const statusChoices = suggestionStatuses.map((st) => ({ name: `${statusInfo[st].emoji} ${statusInfo[st].label}`, value: st }));

const reviewCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("suggestion")
    .setDescription("Review a suggestion.")
    .setContexts(0)
    .addSubcommand((c) =>
      c
        .setName("status")
        .setDescription("Approve, deny or update a suggestion")
        .addIntegerOption((o) => o.setName("number").setDescription("The suggestion's number, like 12").setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName("status").setDescription("Its new status").setRequired(true).addChoices(...statusChoices))
        .addStringOption((o) => o.setName("reason").setDescription("Why (shown on the post and in the DM)").setMaxLength(SUGGESTION_LIMITS.reason)),
    ),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    if (!isReviewer(interaction.member, s)) return interaction.reply("Only staff can review suggestions.");
    const number = interaction.options.getInteger("number", true);
    const row = await byNumber(interaction.guildId, number);
    if (!row) return interaction.reply(`There's no suggestion #${number}.`);
    const status = interaction.options.getString("status", true) as SuggestionStatus;
    await interaction.deferReply();
    const next = await setStatus(interaction.guild, row, status, interaction.options.getString("reason") ?? "", { id: interaction.user.id, tag: interaction.user.tag });
    const link = messageUrl(next);
    return interaction.editReply({
      content: `${statusInfo[status].emoji} Suggestion #${number} is now **${statusInfo[status].label.toLowerCase()}**.${link ? ` ${link}` : ""}`,
      allowedMentions: { parse: [] },
    });
  },
};

const buttons: ComponentHandler = {
  prefix: PREFIX,
  async handle(interaction: MessageComponentInteraction) {
    if (!interaction.inCachedGuild() || !interaction.isButton()) return;
    const [, kind, idText] = interaction.customId.split(":");
    const vote = kind === "up" ? 1 : kind === "down" ? -1 : 0;
    const id = Number(idText);
    if (!vote || !Number.isInteger(id)) return;
    const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!(await isFeatureEnabled(interaction.guildId, suggestionsFeature))) return privately("Suggestions are turned off in this server right now.");
    const row = await byId(interaction.guildId, id);
    if (!row) return privately("This suggestion isn't available anymore.");
    if (statusInfo[row.status].done) return privately("Voting on this suggestion is closed.");

    const userId = interaction.user.id;
    const where = and(eq(suggestionVotes.suggestionId, id), eq(suggestionVotes.userId, userId));
    const current = (await db.select().from(suggestionVotes).where(where).get())?.vote ?? 0;
    if (current === vote) await db.delete(suggestionVotes).where(where).run();
    else {
      await db
        .insert(suggestionVotes)
        .values({ suggestionId: id, guildId: row.guildId, userId, vote })
        .onConflictDoUpdate({ target: [suggestionVotes.suggestionId, suggestionVotes.userId], set: { vote } })
        .run();
    }
    refreshSoon(id);
    if (current === vote) return privately("You took your vote back.");
    return privately(vote === 1 ? "👍 You voted for this suggestion." : "👎 You voted against this suggestion.");
  },

  async handleModal(interaction: ModalSubmitInteraction) {
    if (!interaction.inCachedGuild() || interaction.customId !== `${PREFIX}:new`) return;
    const title = interaction.fields.getTextInputValue("title").trim();
    const details = interaction.fields.getTextInputValue("details").trim();
    if (!title) return interaction.reply({ content: "Write your idea first.", flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const row = await createSuggestion(interaction.guild, interaction.member, title, details);
      return interaction.editReply(`💡 Thanks! Your suggestion is posted as **#${row.number}**: ${messageUrl(row)}`);
    } catch (err) {
      if (err instanceof SuggestionError) return interaction.editReply(err.message);
      throw err;
    }
  },
};

/** The suggestion post was deleted in Discord: forget it (votes and status stay on the dashboard). */
const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (message.guildId) await db.update(suggestions).set({ messageId: null }).where(eq(suggestions.messageId, message.id)).run();
});

/* ------------------------------------------------------------ dashboard */

async function respond(guild: Guild): Promise<SuggestionsResponse> {
  const s = await settingsOf(guild.id);
  const rows = await db.select().from(suggestions).where(eq(suggestions.guildId, guild.id)).orderBy(desc(suggestions.id)).limit(100).all();
  const ids = [...new Set(rows.map((r) => r.authorId))];
  const members = ids.length ? await guild.members.fetch({ user: ids }).catch(() => null) : null;
  const list: SuggestionView[] = [];
  for (const r of rows) {
    const m = members?.get(r.authorId);
    list.push({
      id: r.id,
      number: r.number,
      title: r.title,
      details: r.details,
      status: r.status,
      reason: r.reason,
      authorId: r.authorId,
      authorName: m?.displayName ?? r.authorTag,
      reviewedByName: r.reviewedByTag,
      ...(await votesOf(r.id)),
      url: messageUrl(r),
      createdAt: r.createdAt.getTime(),
    });
  }
  const problems: string[] = [];
  if (!s.channelId) problems.push("Pick a suggestions channel so members can use /suggest.");
  else {
    try {
      const channel = postableChannel(guild, s);
      const me = guild.members.me;
      if (s.threads && me && !channel.permissionsFor(me).has(PermissionFlagsBits.CreatePublicThreads)) {
        problems.push(`I need Create Public Threads in #${channel.name} to open a discussion thread under each suggestion.`);
      }
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  return { settings: s, suggestions: list, problems };
}

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof SuggestionError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

export const suggestionsBot: BotFeature = {
  info: suggestionsFeature,
  commands: [suggestCommand, reviewCommand],
  components: [buttons],
  events: [messageDeleted],

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;

    api.get("/api/guilds/:guildId/suggestions", async (request: Req) => respond(guildOf(request)));

    api.put("/api/guilds/:guildId/suggestions/settings", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const parsed = suggestionSettings.safeParse(request.body);
        if (!parsed.success) throw new SuggestionError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
        const s = parsed.data;
        const picked = s.channelId ? guild.channels.cache.get(s.channelId) : null;
        if (s.channelId && (!picked || !TEXT_TYPES.has(picked.type))) throw new SuggestionError("That channel no longer exists. Pick another one.");
        s.reviewerRoleIds = s.reviewerRoleIds.filter((id) => guild.roles.cache.has(id));
        const state = await getFeatureState(guild.id, suggestionsFeature);
        await saveFeatureState(guild.id, suggestionsFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
        return respond(guild);
      }),
    );

    api.post("/api/guilds/:guildId/suggestions/:id/status", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const row = await byId(guild.id, Number(request.params.id));
        if (!row) throw new SuggestionError("That suggestion isn't saved anymore. Reload the page.");
        const parsed = suggestionStatusInput.safeParse(request.body);
        if (!parsed.success) throw new SuggestionError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
        const user = await client.users.fetch(request.session!.userId).catch(() => null);
        await setStatus(guild, row, parsed.data.status, parsed.data.reason, { id: request.session!.userId, tag: user?.tag ?? "Staff" });
        return respond(guild);
      }),
    );

    /** Deletes a suggestion, its post and its votes. */
    api.delete("/api/guilds/:guildId/suggestions/:id", async (request: Req) => {
      const guild = guildOf(request);
      const row = await byId(guild.id, Number(request.params.id));
      if (row) {
        const channel = guild.channels.cache.get(row.channelId);
        if (row.threadId) await (await guild.channels.fetch(row.threadId).catch(() => null))?.delete().catch(() => {});
        if (channel?.isTextBased() && row.messageId) await channel.messages.delete(row.messageId).catch(() => {});
        await db.delete(suggestionVotes).where(eq(suggestionVotes.suggestionId, row.id)).run();
        await db.delete(suggestions).where(eq(suggestions.id, row.id)).run();
      }
      return respond(guild);
    });
  },
};
