import {
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  PermissionFlagsBits,
} from "discord.js";
import { and, count, desc, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { embedMessages } from "../../server/db/schema.js";
import {
  type EmbedData,
  type EmbedMessageInput,
  type EmbedMessageView,
  MAX_EMBED_MESSAGES,
  embedData,
  embedMessageInput,
  embedMessageProblem,
} from "../../shared/embeds.js";
import { embedsFeature } from "../../shared/features.js";

/**
 * Embed messages: admins build a message on the dashboard and Number One posts it.
 * Each posted message is remembered so it can be edited or deleted from the dashboard later.
 */

type Row = typeof embedMessages.$inferSelect;
type Req = FastifyRequest<{ Params: { guildId: string; messageId?: string } }>;

/** A problem the admin can fix, shown as-is on the dashboard. */
class EmbedError extends Error {}

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/* ------------------------------------------------------------ building */

function toEmbed(e: EmbedData): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(Number.parseInt(e.color.slice(1), 16));
  if (e.authorName) embed.setAuthor({ name: e.authorName, iconURL: e.authorIcon || undefined, url: e.authorUrl || undefined });
  if (e.title) embed.setTitle(e.title);
  if (e.url && e.title) embed.setURL(e.url);
  if (e.description.trim()) embed.setDescription(e.description);
  if (e.fields.length) embed.addFields(e.fields);
  if (e.image) embed.setImage(e.image);
  if (e.thumbnail) embed.setThumbnail(e.thumbnail);
  if (e.footerText) embed.setFooter({ text: e.footerText, iconURL: e.footerIcon || undefined });
  if (e.timestamp) embed.setTimestamp(new Date());
  return embed;
}

/** Mentions in the text show up but never ping anyone. */
const payload = (m: EmbedMessageInput) => ({
  content: m.content.trim() || "",
  embeds: m.embeds.map(toEmbed),
  allowedMentions: { parse: [] },
});

/* ------------------------------------------------------------ checks */

/** The channel to post in, after checking both Number One and the admin are allowed to post there. */
async function checkChannel(guild: Guild, userId: string, channelId: string): Promise<GuildTextBasedChannel> {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new EmbedError("That channel no longer exists. Pick another one.");
  const me = guild.members.me;
  const mine = me ? channel.permissionsFor(me) : null;
  const missing = (
    [
      [PermissionFlagsBits.ViewChannel, "View Channel"],
      [PermissionFlagsBits.SendMessages, "Send Messages"],
      [PermissionFlagsBits.EmbedLinks, "Embed Links"],
    ] as const
  )
    .filter(([flag]) => !mine?.has(flag))
    .map(([, name]) => name);
  if (missing.length) throw new EmbedError(`In #${channel.name} I need: ${missing.join(", ")}.`);
  // Admins can only post where they could post themselves.
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new EmbedError("You're no longer a member of this server.");
  if (!channel.permissionsFor(member).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    throw new EmbedError(`You can't post in #${channel.name} yourself, so I can't post there for you.`);
  }
  return channel as GuildTextBasedChannel;
}

function checkMessage(m: EmbedMessageInput) {
  const problem = embedMessageProblem(m);
  if (problem) throw new EmbedError(problem);
}

/* ------------------------------------------------------------ store */

function toView(r: Row): EmbedMessageView {
  const parsed = embedData.array().safeParse(r.embeds);
  return {
    messageId: r.messageId,
    channelId: r.channelId,
    name: r.name,
    content: r.content,
    embeds: parsed.success ? parsed.data : [],
    url: `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}`,
    createdBy: r.createdBy,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

const list = (guildId: string) =>
  db.select().from(embedMessages).where(eq(embedMessages.guildId, guildId)).orderBy(desc(embedMessages.updatedAt)).all();

const find = (guildId: string, messageId: string) =>
  db
    .select()
    .from(embedMessages)
    .where(and(eq(embedMessages.guildId, guildId), eq(embedMessages.messageId, messageId)))
    .get();

const forget = (messageId: string) => db.delete(embedMessages).where(eq(embedMessages.messageId, messageId)).run();

/* ------------------------------------------------------------ actions */

async function create(guild: Guild, userId: string, input: EmbedMessageInput) {
  checkMessage(input);
  const total = (await db.select({ n: count() }).from(embedMessages).where(eq(embedMessages.guildId, guild.id)).get())?.n ?? 0;
  if (total >= MAX_EMBED_MESSAGES) throw new EmbedError(`You can have up to ${MAX_EMBED_MESSAGES} embed messages. Delete one first.`);
  const channel = await checkChannel(guild, userId, input.channelId);
  const posted = await channel.send(payload(input)).catch((err: Error) => {
    throw new EmbedError(`Discord didn't accept the message: ${err.message}`);
  });
  const now = new Date();
  const row: Row = {
    messageId: posted.id,
    guildId: guild.id,
    channelId: channel.id,
    name: input.name,
    content: input.content,
    embeds: input.embeds,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(embedMessages).values(row).run();
  return toView(row);
}

/**
 * Edits a posted message. Moving it to another channel posts it there and deletes the old one.
 * If the message was deleted in Discord meanwhile, it's posted again.
 */
async function update(guild: Guild, userId: string, messageId: string, input: EmbedMessageInput) {
  checkMessage(input);
  const row = await find(guild.id, messageId);
  if (!row) throw new EmbedError("That message isn't saved anymore. Reload the page.");
  const channel = await checkChannel(guild, userId, input.channelId);

  let message: Message | null = null;
  if (channel.id === row.channelId) message = await channel.messages.fetch(row.messageId).catch(() => null);
  if (message) {
    await message.edit(payload(input)).catch((err: Error) => {
      throw new EmbedError(`Discord didn't accept the changes: ${err.message}`);
    });
  } else {
    message = await channel.send(payload(input)).catch((err: Error) => {
      throw new EmbedError(`Discord didn't accept the message: ${err.message}`);
    });
    if (row.channelId !== channel.id) {
      const old = guild.channels.cache.get(row.channelId);
      if (old?.isTextBased()) await old.messages.delete(row.messageId).catch(() => {});
    }
  }

  const updated: Row = { ...row, messageId: message.id, channelId: channel.id, name: input.name, content: input.content, embeds: input.embeds, updatedAt: new Date() };
  // The message ID changes when it was posted again, so the row is replaced rather than updated.
  await forget(row.messageId);
  await db.insert(embedMessages).values(updated).run();
  return toView(updated);
}

async function remove(guild: Guild, messageId: string) {
  const row = await find(guild.id, messageId);
  if (!row) return;
  const channel = guild.channels.cache.get(row.channelId);
  if (channel?.isTextBased()) await channel.messages.delete(row.messageId).catch(() => {});
  await forget(row.messageId);
}

/* ------------------------------------------------------------ cleanup when things are deleted in Discord */

const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (message.guildId) await forget(message.id);
});

const messagesDeleted = onEvent(Events.MessageBulkDelete, async (messages) => {
  for (const id of messages.keys()) await forget(id);
});

const channelDeleted = onEvent(Events.ChannelDelete, async (channel) => {
  if (!channel.isDMBased()) await db.delete(embedMessages).where(eq(embedMessages.channelId, channel.id)).run();
});

/* ------------------------------------------------------------ feature */

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof EmbedError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

function parse(reply: FastifyReply, body: unknown): EmbedMessageInput | null {
  const parsed = embedMessageInput.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  void reply.code(400).send({ error: issue ? `${issue.path.join(" → ")}: ${issue.message}` : "Check the form and try again." });
  return null;
}

export const embeds: BotFeature = {
  info: embedsFeature,
  events: [messageDeleted, messagesDeleted, channelDeleted],

  registerApi(api) {
    api.get("/api/guilds/:guildId/embeds", async (request: Req) => (await list(request.params.guildId)).map(toView));

    api.post("/api/guilds/:guildId/embeds", async (request: Req, reply) => {
      const input = parse(reply, request.body);
      if (!input) return reply;
      const guild = client.guilds.cache.get(request.params.guildId)!;
      return guarded(reply, () => create(guild, request.session!.userId, input));
    });

    api.put("/api/guilds/:guildId/embeds/:messageId", async (request: Req, reply) => {
      const input = parse(reply, request.body);
      if (!input) return reply;
      const guild = client.guilds.cache.get(request.params.guildId)!;
      return guarded(reply, () => update(guild, request.session!.userId, request.params.messageId!, input));
    });

    api.delete("/api/guilds/:guildId/embeds/:messageId", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      await remove(guild, request.params.messageId!);
      return { ok: true };
    });
  },
};
