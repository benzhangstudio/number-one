import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  type PartialMessage,
  PermissionFlagsBits,
  SnowflakeUtil,
} from "discord.js";
import type { FastifyRequest } from "fastify";
import { canReadMessages, client } from "../../server/bot/discord.js";
import { type BotFeature, onEvent } from "../../server/bot/types.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import { messageLogsFeature } from "../../shared/features.js";
import { type MessageLogResponse, type MessageLogSettings, messageLogSettings } from "../../shared/messageLogs.js";

/**
 * Message logs: posts edited, deleted and bulk-deleted messages to a staff channel.
 * The old text of an edit or delete comes from Number One's memory of recent messages, so messages sent
 * before the bot last restarted are logged without their text.
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;
type AnyMessage = Message | PartialMessage;

const log = (...args: unknown[]) => console.warn("[message-logs]", ...args);
const COLORS = { edit: 0xffc46b, delete: 0xff6b6b, bulk: 0xff4f6d };
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const NOT_IN_MEMORY = "*Not in my memory: it was sent before I last restarted.*";

/* ------------------------------------------------------------ settings cache */

const cache = new Map<string, { at: number; settings: MessageLogSettings | null }>();
const CACHE_MS = 30_000;

/** The server's settings when the feature is on and has a log channel, otherwise null. Read on every message, so cached briefly. */
async function activeSettings(guildId: string): Promise<MessageLogSettings | null> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;
  const state = await getFeatureState(guildId, messageLogsFeature);
  const s = state.settings as MessageLogSettings;
  const settings = state.enabled && s.channelId ? s : null;
  cache.set(guildId, { at: Date.now(), settings });
  return settings;
}

/* ------------------------------------------------------------ filters */

function logChannel(guild: Guild, s: MessageLogSettings): GuildTextBasedChannel | null {
  const channel = s.channelId ? guild.channels.cache.get(s.channelId) : null;
  if (!channel || !TEXT_TYPES.has(channel.type)) return null;
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return null;
  return channel as GuildTextBasedChannel;
}

/** Whether a message should be logged under these settings. Works for messages Number One doesn't remember too. */
function shouldLog(message: AnyMessage, s: MessageLogSettings): boolean {
  if (!message.guild || message.channelId === s.channelId) return false; // never log the log channel itself
  if (message.system) return false;
  if (s.ignoreBots && (message.author?.bot || message.webhookId)) return false;
  const channel = message.channel;
  const ids = [message.channelId, "parentId" in channel ? channel.parentId : null];
  if (channel.isThread()) ids.push(channel.parent?.parentId ?? null);
  if (ids.some((id) => id && s.ignoredChannelIds.includes(id))) return false;
  if (s.ignoredRoleIds.length && message.author) {
    const member = message.member ?? message.guild.members.cache.get(message.author.id);
    if (member && s.ignoredRoleIds.some((id) => member.roles.cache.has(id))) return false;
  }
  return true;
}

/* ------------------------------------------------------------ formatting */

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const ts = (ms: number) => `<t:${Math.floor(ms / 1000)}:f>`;

function quote(text: string | null | undefined, max = 1024): string {
  if (text === null || text === undefined) return NOT_IN_MEMORY;
  if (!text.trim()) return "*No text*";
  return cut(text, max);
}

function extras(message: AnyMessage): string[] {
  const lines: string[] = [];
  if (message.attachments?.size) lines.push(`📎 ${message.attachments.map((a) => a.name).join(", ")}`);
  if (message.stickers?.size) lines.push(`🏷️ ${message.stickers.map((st) => st.name).join(", ")}`);
  if (message.embeds?.length) lines.push(`🧩 ${message.embeds.length} embed${message.embeds.length === 1 ? "" : "s"}`);
  return lines;
}

function authorLine(message: AnyMessage) {
  return message.author ? `<@${message.author.id}> (${message.author.tag})` : "Unknown (not in my memory)";
}

async function post(guild: Guild, s: MessageLogSettings, payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }) {
  const channel = logChannel(guild, s);
  if (!channel) return;
  await channel.send({ ...payload, allowedMentions: { parse: [] } }).catch((err: Error) => log(`couldn't post in ${guild.name}:`, err.message));
}

/* ------------------------------------------------------------ events */

const messageEdited = onEvent(Events.MessageUpdate, async (before, after) => {
  const guild = after.guild;
  if (!guild) return;
  const s = await activeSettings(guild.id);
  if (!s?.edits) return;
  if (after.partial) after = await after.fetch().catch(() => after);
  // Only real text edits: embeds loading also counts as an "update".
  if (!before.partial && before.content === after.content) return;
  if (before.partial && !after.editedTimestamp) return;
  if (!shouldLog(after, s)) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.edit)
    .setAuthor(after.author ? { name: after.author.tag, iconURL: after.author.displayAvatarURL() } : null)
    .setTitle(`✏️ Message edited in #${"name" in after.channel ? after.channel.name : "channel"}`)
    .setURL(after.url)
    .addFields(
      { name: "Before", value: quote(before.partial ? null : before.content) },
      { name: "After", value: quote(after.content) },
      { name: "Author", value: authorLine(after), inline: true },
      { name: "Channel", value: `<#${after.channelId}>`, inline: true },
      { name: "Sent", value: ts(after.createdTimestamp), inline: true },
    )
    .setFooter({ text: `Message ID ${after.id}` })
    .setTimestamp();
  await post(guild, s, { embeds: [embed] });
});

const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (!message.guild) return;
  const s = await activeSettings(message.guild.id);
  if (!s?.deletes || !shouldLog(message, s)) return;

  const known = !message.partial;
  const body = [quote(known ? message.content : null, 3500), ...extras(message)].join("\n");
  const embed = new EmbedBuilder()
    .setColor(COLORS.delete)
    .setAuthor(message.author ? { name: message.author.tag, iconURL: message.author.displayAvatarURL() } : null)
    .setTitle(`🗑️ Message deleted in #${"name" in message.channel ? message.channel.name : "channel"}`)
    .setDescription(body)
    .addFields(
      { name: "Author", value: authorLine(message), inline: true },
      { name: "Channel", value: `<#${message.channelId}>`, inline: true },
      { name: "Sent", value: ts(message.createdTimestamp ?? Number(SnowflakeUtil.timestampFrom(message.id))), inline: true },
    )
    .setFooter({ text: `Message ID ${message.id}` })
    .setTimestamp();
  await post(message.guild, s, { embeds: [embed] });
});

/** A purge or mass delete: one log with a text file of everything that was deleted. */
const messagesBulkDeleted = onEvent(Events.MessageBulkDelete, async (messages, channel) => {
  const guild = channel.guild;
  const s = await activeSettings(guild.id);
  if (!s?.bulkDeletes || channel.id === s.channelId) return;
  const ids = [channel.id, channel.parentId];
  if (channel.isThread()) ids.push(channel.parent?.parentId ?? null);
  if (ids.some((id) => id && s.ignoredChannelIds.includes(id))) return;

  const sorted = [...messages.values()].sort((a, b) => Number(SnowflakeUtil.timestampFrom(a.id) - SnowflakeUtil.timestampFrom(b.id)));
  const logged = sorted.filter((m) => m.partial || shouldLog(m, s));
  if (!logged.length) return;
  const lines = logged.map((m) => {
    const at = new Date(Number(SnowflakeUtil.timestampFrom(m.id))).toISOString().replace("T", " ").slice(0, 19);
    if (m.partial) return `[${at} UTC] (not in memory: sent before the bot last restarted) message ${m.id}`;
    const files = m.attachments.size ? ` [files: ${m.attachments.map((a) => a.name).join(", ")}]` : "";
    return `[${at} UTC] ${m.author?.tag ?? "unknown"} (${m.author?.id ?? "?"}): ${m.content}${files}`;
  });
  const authors = new Set(logged.map((m) => m.author?.id).filter(Boolean));
  const embed = new EmbedBuilder()
    .setColor(COLORS.bulk)
    .setTitle(`🧹 ${logged.length} messages deleted in #${channel.name}`)
    .setDescription(`From ${authors.size} member${authors.size === 1 ? "" : "s"}. Everything that was deleted is in the attached file.`)
    .addFields({ name: "Channel", value: `<#${channel.id}>`, inline: true })
    .setTimestamp();
  const me = guild.members.me;
  const canAttach = Boolean(me && guild.channels.cache.get(s.channelId!)?.permissionsFor(me)?.has(PermissionFlagsBits.AttachFiles));
  const file = new AttachmentBuilder(Buffer.from(`Deleted messages in #${channel.name} (${guild.name})\n\n${lines.join("\n")}\n`, "utf8"), {
    name: `deleted-messages-${channel.name}-${new Date().toISOString().slice(0, 10)}.txt`,
  });
  if (!canAttach) embed.setDescription(`${embed.data.description}\n\n⚠️ I need Attach Files in the log channel to add the file.`);
  await post(guild, s, { embeds: [embed], files: canAttach ? [file] : [] });
});

/* ------------------------------------------------------------ dashboard */

function problems(guild: Guild, s: MessageLogSettings): string[] {
  const list: string[] = [];
  if (!s.channelId) return ["Pick a log channel, or nothing is logged."];
  const channel = guild.channels.cache.get(s.channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) return ["The log channel no longer exists. Pick another one."];
  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  const needed: [bigint, string][] = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  ];
  if (s.bulkDeletes) needed.push([PermissionFlagsBits.AttachFiles, "Attach Files"]);
  const missing = needed.filter(([flag]) => !perms?.has(flag)).map(([, name]) => name);
  if (missing.length) list.push(`In #${channel.name} I need: ${missing.join(", ")}.`);
  if (!canReadMessages()) {
    list.push('"Message Content Intent" is off, so logs can\'t show what messages said. Turn it on in the Discord Developer Portal → Bot, then restart Number One.');
  }
  return list;
}

async function respond(guild: Guild, s: MessageLogSettings): Promise<MessageLogResponse> {
  return { settings: s, canReadMessages: canReadMessages(), problems: problems(guild, s) };
}

export const messageLogs: BotFeature = {
  info: messageLogsFeature,
  events: [messageEdited, messageDeleted, messagesBulkDeleted],

  async onToggle(guildId) {
    cache.delete(guildId);
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/message-logs", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      return respond(guild, (await getFeatureState(guild.id, messageLogsFeature)).settings as MessageLogSettings);
    });

    api.put("/api/guilds/:guildId/message-logs", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = messageLogSettings.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      const s = parsed.data;
      if (s.channelId && !TEXT_TYPES.has(guild.channels.cache.get(s.channelId)?.type as ChannelType)) {
        return reply.code(400).send({ error: "The log channel no longer exists. Pick another one." });
      }
      const state = await getFeatureState(guild.id, messageLogsFeature);
      await saveFeatureState(guild.id, messageLogsFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
      cache.delete(guild.id);
      return respond(guild, s);
    });
  },
};
