import {
  AuditLogEvent,
  ChannelType,
  type DMChannel,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  type NonThreadGuildBasedChannel,
  PermissionFlagsBits,
  PermissionsBitField,
  type Role,
} from "discord.js";
import type { FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, onEvent } from "../../server/bot/types.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import { serverLogsFeature } from "../../shared/features.js";
import { type ServerLogResponse, type ServerLogSettings, serverLogSettings } from "../../shared/serverLogs.js";

/**
 * Server logs: changes to channels, roles, server settings, emojis and stickers, and invites,
 * with who made each change (from Discord's audit log).
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;
type Field = { name: string; value: string; inline?: boolean };

const log = (...args: unknown[]) => console.warn("[server-logs]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const COLORS = { create: 0x5bd6a0, delete: 0xff6b6b, update: 0x8ab4ff };

/* ------------------------------------------------------------ settings cache */

const cache = new Map<string, { at: number; settings: ServerLogSettings | null }>();
const CACHE_MS = 30_000;

async function activeSettings(guildId: string): Promise<ServerLogSettings | null> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;
  const state = await getFeatureState(guildId, serverLogsFeature);
  const s = state.settings as ServerLogSettings;
  const settings = state.enabled && s.channelId ? s : null;
  cache.set(guildId, { at: Date.now(), settings });
  return settings;
}

/* ------------------------------------------------------------ posting */

function logChannel(guild: Guild, s: ServerLogSettings): GuildTextBasedChannel | null {
  const channel = s.channelId ? guild.channels.cache.get(s.channelId) : null;
  if (!channel || !TEXT_TYPES.has(channel.type)) return null;
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return null;
  return channel as GuildTextBasedChannel;
}

/** Who made a change, from the audit log (needs View Audit Log). */
async function whoDid(guild: Guild, types: AuditLogEvent[], targetId: string | null): Promise<string | null> {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
  for (const type of types) {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
    const entry = logs?.entries.find((e) => (targetId === null || e.targetId === targetId) && Date.now() - e.createdTimestamp < 15_000);
    if (entry?.executorId) return entry.executorId;
  }
  return null;
}

/** Posts a log, unless Number One made the change itself and the server skips those. */
async function post(
  guild: Guild,
  s: ServerLogSettings,
  entry: { color: number; title: string; description?: string; fields?: Field[]; audit: AuditLogEvent[]; targetId: string | null; footer?: string },
) {
  const channel = logChannel(guild, s);
  if (!channel) return;
  const by = await whoDid(guild, entry.audit, entry.targetId);
  if (by && by === client.user?.id && s.skipOwnChanges) return;
  const embed = new EmbedBuilder().setColor(entry.color).setTitle(entry.title).setTimestamp();
  if (entry.description) embed.setDescription(entry.description);
  const fields = [...(entry.fields ?? [])].filter((f) => f.value).map((f) => ({ ...f, value: f.value.slice(0, 1024) }));
  if (by) fields.push({ name: "By", value: by === client.user?.id ? "Number One" : `<@${by}>` });
  if (fields.length) embed.addFields(fields.slice(0, 25));
  if (entry.footer) embed.setFooter({ text: entry.footer });
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((err: Error) => log(`couldn't post in ${guild.name}:`, err.message));
}

/* ------------------------------------------------------------ helpers */

const yesNo = (v: boolean) => (v ? "Yes" : "No");
const change = (name: string, before: unknown, after: unknown, show: (v: never) => string = (v) => String(v ?? "None")): Field | null =>
  before === after ? null : { name, value: `${show(before as never)} → ${show(after as never)}` };

const channelKinds: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: "Text channel",
  [ChannelType.GuildVoice]: "Voice channel",
  [ChannelType.GuildCategory]: "Category",
  [ChannelType.GuildAnnouncement]: "Announcement channel",
  [ChannelType.GuildStageVoice]: "Stage channel",
  [ChannelType.GuildForum]: "Forum",
  [ChannelType.GuildMedia]: "Media channel",
};
const kindOf = (c: GuildBasedChannel) => channelKinds[c.type] ?? "Channel";

/** Permission names that were turned on and off between two sets. */
function permissionDiff(before: Readonly<PermissionsBitField>, after: Readonly<PermissionsBitField>) {
  const all = Object.keys(PermissionsBitField.Flags) as (keyof typeof PermissionsBitField.Flags)[];
  const spaced = (n: string) => n.replace(/([a-z])([A-Z])/g, "$1 $2");
  return {
    added: all.filter((p) => !before.has(p) && after.has(p)).map(spaced),
    removed: all.filter((p) => before.has(p) && !after.has(p)).map(spaced),
  };
}

/* ------------------------------------------------------------ channels */

const channelCreated = onEvent(Events.ChannelCreate, async (channel) => {
  const s = await activeSettings(channel.guildId);
  if (!s?.channels) return;
  await post(channel.guild, s, {
    color: COLORS.create,
    title: `➕ ${kindOf(channel)} created`,
    description: `<#${channel.id}> (${channel.name})`,
    fields: [{ name: "Category", value: channel.parent?.name ?? "", inline: true }],
    audit: [AuditLogEvent.ChannelCreate],
    targetId: channel.id,
    footer: `Channel ID ${channel.id}`,
  });
});

const channelDeleted = onEvent(Events.ChannelDelete, async (channel: DMChannel | NonThreadGuildBasedChannel) => {
  if (channel.isDMBased()) return;
  const s = await activeSettings(channel.guildId);
  if (!s?.channels || channel.id === s.channelId) return;
  await post(channel.guild, s, {
    color: COLORS.delete,
    title: `➖ ${kindOf(channel)} deleted`,
    description: `#${channel.name}`,
    fields: [{ name: "Category", value: channel.parent?.name ?? "", inline: true }],
    audit: [AuditLogEvent.ChannelDelete],
    targetId: channel.id,
    footer: `Channel ID ${channel.id}`,
  });
});

const channelUpdated = onEvent(Events.ChannelUpdate, async (before, after) => {
  if (before.isDMBased() || after.isDMBased()) return;
  const s = await activeSettings(after.guildId);
  if (!s?.channels) return;
  const fields = [
    change("Name", before.name, after.name),
    change("Category", before.parent?.name, after.parent?.name),
    "topic" in before && "topic" in after ? change("Topic", before.topic || null, after.topic || null, (v: string | null) => v ?? "None") : null,
    "nsfw" in before && "nsfw" in after ? change("Age-restricted", before.nsfw, after.nsfw, yesNo) : null,
    "rateLimitPerUser" in before && "rateLimitPerUser" in after
      ? change("Slowmode", before.rateLimitPerUser ?? 0, after.rateLimitPerUser ?? 0, (v: number) => (v ? `${v}s` : "Off"))
      : null,
    "bitrate" in before && "bitrate" in after ? change("Bitrate", before.bitrate, after.bitrate, (v: number) => `${Math.round(v / 1000)}kbps`) : null,
    "userLimit" in before && "userLimit" in after ? change("User limit", before.userLimit, after.userLimit, (v: number) => (v ? String(v) : "None")) : null,
  ].filter((f): f is Field => f !== null);

  // Permission overrides: which roles or members had theirs added, changed or removed.
  const overwrites: string[] = [];
  const target = (id: string, type: number) => (type === 0 ? (id === after.guildId ? "@everyone" : `<@&${id}>`) : `<@${id}>`);
  for (const [id, o] of after.permissionOverwrites.cache) {
    const old = before.permissionOverwrites.cache.get(id);
    if (!old) overwrites.push(`➕ ${target(id, o.type)}`);
    else if (old.allow.bitfield !== o.allow.bitfield || old.deny.bitfield !== o.deny.bitfield) overwrites.push(`✏️ ${target(id, o.type)}`);
  }
  for (const [id, o] of before.permissionOverwrites.cache) if (!after.permissionOverwrites.cache.has(id)) overwrites.push(`➖ ${target(id, o.type)}`);
  if (overwrites.length) fields.push({ name: "Permissions changed for", value: overwrites.join("\n") });
  // Moving channels around also fires updates; those alone aren't worth a log.
  if (!fields.length) return;

  await post(after.guild, s, {
    color: COLORS.update,
    title: `✏️ ${kindOf(after)} changed`,
    description: `<#${after.id}>`,
    fields,
    audit: overwrites.length && fields.length === 1
      ? [AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteDelete]
      : [AuditLogEvent.ChannelUpdate],
    targetId: after.id,
    footer: `Channel ID ${after.id}`,
  });
});

/* ------------------------------------------------------------ roles */

const roleCreated = onEvent(Events.GuildRoleCreate, async (role) => {
  const s = await activeSettings(role.guild.id);
  if (!s?.roles || role.managed) return;
  await post(role.guild, s, { color: COLORS.create, title: "➕ Role created", description: `<@&${role.id}> (${role.name})`, audit: [AuditLogEvent.RoleCreate], targetId: role.id, footer: `Role ID ${role.id}` });
});

const roleDeleted = onEvent(Events.GuildRoleDelete, async (role) => {
  const s = await activeSettings(role.guild.id);
  if (!s?.roles || role.managed) return;
  await post(role.guild, s, { color: COLORS.delete, title: "➖ Role deleted", description: `@${role.name}`, audit: [AuditLogEvent.RoleDelete], targetId: role.id, footer: `Role ID ${role.id}` });
});

const roleUpdated = onEvent(Events.GuildRoleUpdate, async (before: Role, after: Role) => {
  const s = await activeSettings(after.guild.id);
  if (!s?.roles) return;
  const perms = permissionDiff(before.permissions, after.permissions);
  const fields = [
    change("Name", before.name, after.name),
    change("Colour", before.hexColor, after.hexColor),
    change("Shown separately", before.hoist, after.hoist, yesNo),
    change("Anyone can mention it", before.mentionable, after.mentionable, yesNo),
    change("Icon", before.icon ?? before.unicodeEmoji, after.icon ?? after.unicodeEmoji, (v: string | null) => (v ? (v.length <= 4 ? v : "Custom image") : "None")),
    perms.added.length ? { name: "✅ Permissions given", value: perms.added.join(", ") } : null,
    perms.removed.length ? { name: "❌ Permissions taken away", value: perms.removed.join(", ") } : null,
  ].filter((f): f is Field => f !== null);
  // Reordering roles also fires updates; those alone aren't worth a log.
  if (!fields.length) return;
  await post(after.guild, s, { color: COLORS.update, title: "✏️ Role changed", description: `<@&${after.id}>`, fields, audit: [AuditLogEvent.RoleUpdate], targetId: after.id, footer: `Role ID ${after.id}` });
});

/* ------------------------------------------------------------ server settings */

const verification = ["None", "Low", "Medium", "High", "Highest"];
const contentFilter = ["Off", "Members without roles", "Everyone"];

const serverUpdated = onEvent(Events.GuildUpdate, async (before, after) => {
  const s = await activeSettings(after.id);
  if (!s?.server) return;
  const fields = [
    change("Name", before.name, after.name),
    change("Icon", before.icon, after.icon, (v: string | null) => (v ? "Set" : "None")),
    change("Banner", before.banner, after.banner, (v: string | null) => (v ? "Set" : "None")),
    change("Verification level", before.verificationLevel, after.verificationLevel, (v: number) => verification[v] ?? String(v)),
    change("Explicit image filter", before.explicitContentFilter, after.explicitContentFilter, (v: number) => contentFilter[v] ?? String(v)),
    change("Default notifications", before.defaultMessageNotifications, after.defaultMessageNotifications, (v: number) => (v === 0 ? "All messages" : "Only mentions")),
    change("Two-factor for moderators", before.mfaLevel, after.mfaLevel, (v: number) => (v ? "Required" : "Not required")),
    change("System channel", before.systemChannelId, after.systemChannelId, (v: string | null) => (v ? `<#${v}>` : "None")),
    change("Rules channel", before.rulesChannelId, after.rulesChannelId, (v: string | null) => (v ? `<#${v}>` : "None")),
    change("AFK channel", before.afkChannelId, after.afkChannelId, (v: string | null) => (v ? `<#${v}>` : "None")),
    change("Vanity invite", before.vanityURLCode, after.vanityURLCode, (v: string | null) => (v ? `discord.gg/${v}` : "None")),
    change("Owner", before.ownerId, after.ownerId, (v: string) => `<@${v}>`),
  ].filter((f): f is Field => f !== null);
  if (!fields.length) return;
  await post(after, s, { color: COLORS.update, title: "⚙️ Server settings changed", fields, audit: [AuditLogEvent.GuildUpdate], targetId: after.id });
});

/* ------------------------------------------------------------ emojis and stickers */

const emojiCreated = onEvent(Events.GuildEmojiCreate, async (emoji) => {
  const s = await activeSettings(emoji.guild.id);
  if (!s?.emojis) return;
  await post(emoji.guild, s, { color: COLORS.create, title: "➕ Emoji added", description: `${emoji} \`:${emoji.name}:\``, audit: [AuditLogEvent.EmojiCreate], targetId: emoji.id });
});

const emojiDeleted = onEvent(Events.GuildEmojiDelete, async (emoji) => {
  const s = await activeSettings(emoji.guild.id);
  if (!s?.emojis) return;
  await post(emoji.guild, s, { color: COLORS.delete, title: "➖ Emoji removed", description: `\`:${emoji.name}:\``, audit: [AuditLogEvent.EmojiDelete], targetId: emoji.id });
});

const emojiUpdated = onEvent(Events.GuildEmojiUpdate, async (before, after) => {
  const s = await activeSettings(after.guild.id);
  if (!s?.emojis || before.name === after.name) return;
  await post(after.guild, s, { color: COLORS.update, title: "✏️ Emoji renamed", description: `${after} \`:${before.name}:\` → \`:${after.name}:\``, audit: [AuditLogEvent.EmojiUpdate], targetId: after.id });
});

const stickerCreated = onEvent(Events.GuildStickerCreate, async (sticker) => {
  if (!sticker.guild) return;
  const s = await activeSettings(sticker.guild.id);
  if (!s?.emojis) return;
  await post(sticker.guild, s, { color: COLORS.create, title: "➕ Sticker added", description: sticker.name, audit: [AuditLogEvent.StickerCreate], targetId: sticker.id });
});

const stickerDeleted = onEvent(Events.GuildStickerDelete, async (sticker) => {
  if (!sticker.guild) return;
  const s = await activeSettings(sticker.guild.id);
  if (!s?.emojis) return;
  await post(sticker.guild, s, { color: COLORS.delete, title: "➖ Sticker removed", description: sticker.name, audit: [AuditLogEvent.StickerDelete], targetId: sticker.id });
});

/* ------------------------------------------------------------ invites */

const inviteCreated = onEvent(Events.InviteCreate, async (invite) => {
  const guild = invite.guild && client.guilds.cache.get(invite.guild.id);
  if (!guild) return;
  const s = await activeSettings(guild.id);
  if (!s?.invites) return;
  const channel = logChannel(guild, s);
  if (!channel) return;
  // The invite itself says who made it, so no audit log lookup is needed.
  if (invite.inviterId === client.user?.id && s.skipOwnChanges) return;
  const embed = new EmbedBuilder()
    .setColor(COLORS.create)
    .setTitle("🔗 Invite created")
    .setDescription(`discord.gg/${invite.code}`)
    .addFields(
      { name: "Channel", value: invite.channelId ? `<#${invite.channelId}>` : "Unknown", inline: true },
      { name: "Expires", value: invite.expiresTimestamp ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : "Never", inline: true },
      { name: "Max uses", value: invite.maxUses ? String(invite.maxUses) : "No limit", inline: true },
      { name: "By", value: invite.inviterId ? `<@${invite.inviterId}>` : "Unknown" },
    )
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch((err: Error) => log(`couldn't post in ${guild.name}:`, err.message));
});

const inviteDeleted = onEvent(Events.InviteDelete, async (invite) => {
  const guild = invite.guild && client.guilds.cache.get(invite.guild.id);
  if (!guild) return;
  const s = await activeSettings(guild.id);
  if (!s?.invites) return;
  await post(guild, s, {
    color: COLORS.delete,
    title: "🔗 Invite deleted",
    description: `discord.gg/${invite.code}`,
    fields: [{ name: "Channel", value: invite.channelId ? `<#${invite.channelId}>` : "", inline: true }],
    audit: [AuditLogEvent.InviteDelete],
    targetId: null,
  });
});

/* ------------------------------------------------------------ dashboard */

function problems(guild: Guild, s: ServerLogSettings): string[] {
  if (!s.channelId) return ["Pick a log channel, or nothing is logged."];
  const channel = guild.channels.cache.get(s.channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) return ["The log channel no longer exists. Pick another one."];
  const list: string[] = [];
  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  const missing = (
    [
      [PermissionFlagsBits.ViewChannel, "View Channel"],
      [PermissionFlagsBits.SendMessages, "Send Messages"],
      [PermissionFlagsBits.EmbedLinks, "Embed Links"],
    ] as const
  )
    .filter(([flag]) => !perms?.has(flag))
    .map(([, name]) => name);
  if (missing.length) list.push(`In #${channel.name} I need: ${missing.join(", ")}.`);
  if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) list.push("Give me View Audit Log to show who made each change.");
  if (s.invites && !me?.permissions.has(PermissionFlagsBits.ManageGuild)) list.push("I need Manage Server to see invites being created and deleted.");
  return list;
}

const respond = (guild: Guild, s: ServerLogSettings): ServerLogResponse => ({ settings: s, problems: problems(guild, s) });

export const serverLogs: BotFeature = {
  info: serverLogsFeature,
  events: [
    channelCreated,
    channelDeleted,
    channelUpdated,
    roleCreated,
    roleDeleted,
    roleUpdated,
    serverUpdated,
    emojiCreated,
    emojiDeleted,
    emojiUpdated,
    stickerCreated,
    stickerDeleted,
    inviteCreated,
    inviteDeleted,
  ],

  async onToggle(guildId) {
    cache.delete(guildId);
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/server-logs", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      return respond(guild, (await getFeatureState(guild.id, serverLogsFeature)).settings as ServerLogSettings);
    });

    api.put("/api/guilds/:guildId/server-logs", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = serverLogSettings.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      const s = parsed.data;
      if (s.channelId && !TEXT_TYPES.has(guild.channels.cache.get(s.channelId)?.type as ChannelType)) {
        return reply.code(400).send({ error: "The log channel no longer exists. Pick another one." });
      }
      const state = await getFeatureState(guild.id, serverLogsFeature);
      await saveFeatureState(guild.id, serverLogsFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
      cache.delete(guild.id);
      return respond(guild, s);
    });
  },
};
