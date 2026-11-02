import {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type PartialGuildMember,
  PermissionFlagsBits,
} from "discord.js";
import type { FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, onEvent } from "../../server/bot/types.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import { memberLogsFeature } from "../../shared/features.js";
import { type MemberLogResponse, type MemberLogSettings, memberLogSettings } from "../../shared/memberLogs.js";

/**
 * Member logs: joins, leaves, nickname and role changes, and username / avatar changes, posted to a staff channel.
 * Who changed someone's roles or nickname comes from Discord's audit log, when Number One can read it.
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;

const log = (...args: unknown[]) => console.warn("[member-logs]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const COLORS = { join: 0x5bd6a0, leave: 0xff7a59, change: 0x8ab4ff, roles: 0xc792ea };
const DAY = 86_400_000;

/* ------------------------------------------------------------ settings cache */

const cache = new Map<string, { at: number; settings: MemberLogSettings | null }>();
const CACHE_MS = 30_000;

async function activeSettings(guildId: string): Promise<MemberLogSettings | null> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;
  const state = await getFeatureState(guildId, memberLogsFeature);
  const s = state.settings as MemberLogSettings;
  const settings = state.enabled && s.channelId ? s : null;
  cache.set(guildId, { at: Date.now(), settings });
  return settings;
}

/* ------------------------------------------------------------ posting */

function logChannel(guild: Guild, s: MemberLogSettings): GuildTextBasedChannel | null {
  const channel = s.channelId ? guild.channels.cache.get(s.channelId) : null;
  if (!channel || !TEXT_TYPES.has(channel.type)) return null;
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return null;
  return channel as GuildTextBasedChannel;
}

async function post(guild: Guild, s: MemberLogSettings, embed: EmbedBuilder) {
  const channel = logChannel(guild, s);
  if (!channel) return;
  await channel.send({ embeds: [embed.setTimestamp()], allowedMentions: { parse: [] } }).catch((err: Error) => log(`couldn't post in ${guild.name}:`, err.message));
}

const rel = (ms: number) => `<t:${Math.floor(ms / 1000)}:R>`;
const full = (ms: number) => `<t:${Math.floor(ms / 1000)}:f>`;

function memberEmbed(member: GuildMember | PartialGuildMember, color: number, title: string) {
  const user = member.user;
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: user?.tag ?? "Unknown member", iconURL: user?.displayAvatarURL() })
    .setTitle(title)
    .setThumbnail(member.displayAvatarURL?.() ?? user?.displayAvatarURL() ?? null)
    .setFooter({ text: `User ID ${member.id}` });
}

function roleList(ids: string[], max = 1000) {
  if (!ids.length) return "None";
  let text = "";
  for (let i = 0; i < ids.length; i++) {
    const next = `${text ? " " : ""}<@&${ids[i]}>`;
    if (text.length + next.length > max - 12) return `${text} +${ids.length - i} more`;
    text += next;
  }
  return text;
}

/** Who made a change, from the audit log (needs View Audit Log). Null when it's not there or can't be read. */
async function changedBy(guild: Guild, type: AuditLogEvent, targetId: string): Promise<string | null> {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
  const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
  const entry = logs?.entries.find((e) => e.targetId === targetId && Date.now() - e.createdTimestamp < 15_000);
  return entry?.executorId ?? null;
}

/* ------------------------------------------------------------ events */

const joined = onEvent(Events.GuildMemberAdd, async (member) => {
  const s = await activeSettings(member.guild.id);
  if (!s?.joins || (s.ignoreBots && member.user.bot)) return;
  const age = Date.now() - member.user.createdTimestamp;
  const isNew = s.newAccountDays > 0 && age < s.newAccountDays * DAY;
  const embed = memberEmbed(member, COLORS.join, `📥 ${member.user.bot ? "Bot added" : "Member joined"}`)
    .setDescription(`<@${member.id}> ${member.user.bot ? "was added" : "joined"}. The server now has ${member.guild.memberCount.toLocaleString("en-US")} members.`)
    .addFields({ name: "Account created", value: `${full(member.user.createdTimestamp)} (${rel(member.user.createdTimestamp)})${isNew ? "\n⚠️ **New account**" : ""}` });
  await post(member.guild, s, embed);
});

const left = onEvent(Events.GuildMemberRemove, async (member) => {
  const s = await activeSettings(member.guild.id);
  if (!s?.leaves || (s.ignoreBots && member.user?.bot)) return;
  const roles = member.partial ? [] : member.roles.cache.filter((r) => r.id !== member.guild.id).sort((a, b) => b.position - a.position).map((r) => r.id);
  const embed = memberEmbed(member, COLORS.leave, `📤 ${member.user?.bot ? "Bot removed" : "Member left"}`).setDescription(
    `<@${member.id}> ${member.user?.bot ? "was removed" : "left"}. The server now has ${member.guild.memberCount.toLocaleString("en-US")} members.`,
  );
  if (member.joinedTimestamp) embed.addFields({ name: "Joined", value: `${full(member.joinedTimestamp)} (${rel(member.joinedTimestamp)})` });
  if (!member.partial) embed.addFields({ name: "Roles they had", value: roleList(roles) });
  else embed.addFields({ name: "Roles they had", value: "*Not in my memory.*" });
  await post(member.guild, s, embed);
});

const updated = onEvent(Events.GuildMemberUpdate, async (before, after) => {
  const s = await activeSettings(after.guild.id);
  if (!s || (s.ignoreBots && after.user.bot)) return;
  // Without the old version there's nothing to compare against.
  if (before.partial) return;

  if (s.nicknames && before.nickname !== after.nickname) {
    const by = await changedBy(after.guild, AuditLogEvent.MemberUpdate, after.id);
    const embed = memberEmbed(after, COLORS.change, "🏷️ Nickname changed").addFields(
      { name: "Before", value: before.nickname ?? "*No nickname*", inline: true },
      { name: "After", value: after.nickname ?? "*No nickname*", inline: true },
      { name: "Member", value: `<@${after.id}>`, inline: true },
    );
    if (by && by !== after.id) embed.addFields({ name: "Changed by", value: `<@${by}>` });
    await post(after.guild, s, embed);
  }

  if (s.roles) {
    const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id)).map((r) => r.id);
    const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id)).map((r) => r.id);
    if (added.length || removed.length) {
      const by = await changedBy(after.guild, AuditLogEvent.MemberRoleUpdate, after.id);
      const embed = memberEmbed(after, COLORS.roles, "🎭 Roles changed").setDescription(`<@${after.id}>`);
      if (added.length) embed.addFields({ name: "➕ Added", value: roleList(added), inline: true });
      if (removed.length) embed.addFields({ name: "➖ Removed", value: roleList(removed), inline: true });
      if (by) embed.addFields({ name: "Changed by", value: by === client.user?.id ? "Number One" : `<@${by}>` });
      await post(after.guild, s, embed);
    }
  }

  if (s.profiles && before.avatar !== after.avatar) {
    const embed = memberEmbed(after, COLORS.change, "🖼️ Server avatar changed").setDescription(
      after.avatar ? `<@${after.id}> set a new avatar for this server.` : `<@${after.id}> removed their server avatar.`,
    );
    await post(after.guild, s, embed);
  }
});

/** Username, display name and avatar changes are account-wide: logged in every server that has them on. */
const userUpdated = onEvent(Events.UserUpdate, async (before, after) => {
  if (before.partial) return;
  const changes: { name: string; value: string; inline?: boolean }[] = [];
  if (before.username !== after.username) changes.push({ name: "Username", value: `${before.username} → ${after.username}` });
  if (before.globalName !== after.globalName) changes.push({ name: "Display name", value: `${before.globalName ?? "*none*"} → ${after.globalName ?? "*none*"}` });
  const avatarChanged = before.avatar !== after.avatar;
  if (!changes.length && !avatarChanged) return;

  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(after.id);
    if (!member) continue;
    const s = await activeSettings(guild.id);
    if (!s?.profiles || (s.ignoreBots && after.bot)) continue;
    const embed = memberEmbed(member, COLORS.change, avatarChanged && !changes.length ? "🖼️ Avatar changed" : "👤 Profile changed")
      .setDescription(`<@${after.id}>`)
      .addFields(changes);
    if (avatarChanged) embed.addFields({ name: "Avatar", value: after.avatar ? "Changed (new one on the right)" : "Removed" });
    await post(guild, s, embed);
  }
});

/* ------------------------------------------------------------ dashboard */

function problems(guild: Guild, s: MemberLogSettings): string[] {
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
  if ((s.roles || s.nicknames) && !me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    list.push("Give me View Audit Log to show who changed someone's roles or nickname.");
  }
  return list;
}

const respond = (guild: Guild, s: MemberLogSettings): MemberLogResponse => ({ settings: s, problems: problems(guild, s) });

export const memberLogs: BotFeature = {
  info: memberLogsFeature,
  events: [joined, left, updated, userUpdated],

  async onToggle(guildId) {
    cache.delete(guildId);
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/member-logs", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      return respond(guild, (await getFeatureState(guild.id, memberLogsFeature)).settings as MemberLogSettings);
    });

    api.put("/api/guilds/:guildId/member-logs", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = memberLogSettings.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      const s = parsed.data;
      if (s.channelId && !TEXT_TYPES.has(guild.channels.cache.get(s.channelId)?.type as ChannelType)) {
        return reply.code(400).send({ error: "The log channel no longer exists. Pick another one." });
      }
      const state = await getFeatureState(guild.id, memberLogsFeature);
      await saveFeatureState(guild.id, memberLogsFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
      cache.delete(guild.id);
      return respond(guild, s);
    });
  },
};
