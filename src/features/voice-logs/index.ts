import {
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
  type VoiceBasedChannel,
} from "discord.js";
import type { FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, onEvent } from "../../server/bot/types.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import { voiceLogsFeature } from "../../shared/features.js";
import { type VoiceLogResponse, type VoiceLogSettings, voiceLogSettings } from "../../shared/voiceLogs.js";

/**
 * Voice logs: joins, leaves (with how long they stayed), moves, and server mutes / deafens,
 * posted to a staff channel.
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;

const log = (...args: unknown[]) => console.warn("[voice-logs]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const COLORS = { join: 0x5bd6a0, leave: 0xff7a59, move: 0x8ab4ff, mod: 0xffc46b };

/* ------------------------------------------------------------ settings cache */

const cache = new Map<string, { at: number; settings: VoiceLogSettings | null }>();
const CACHE_MS = 30_000;

async function activeSettings(guildId: string): Promise<VoiceLogSettings | null> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.settings;
  const state = await getFeatureState(guildId, voiceLogsFeature);
  const s = state.settings as VoiceLogSettings;
  const settings = state.enabled && s.channelId ? s : null;
  cache.set(guildId, { at: Date.now(), settings });
  return settings;
}

/* ------------------------------------------------------------ helpers */

/** When each member joined their current voice channel (memory only), to say how long they stayed. */
const joinedAt = new Map<string, number>();

function duration(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return "less than a minute";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return [h && `${h} hour${h === 1 ? "" : "s"}`, rest && `${rest} minute${rest === 1 ? "" : "s"}`].filter(Boolean).join(" ");
}

const ignored = (s: VoiceLogSettings, channel: VoiceBasedChannel | null) =>
  Boolean(channel && (s.ignoredChannelIds.includes(channel.id) || (channel.parentId && s.ignoredChannelIds.includes(channel.parentId))));

function logChannel(guild: Guild, s: VoiceLogSettings): GuildTextBasedChannel | null {
  const channel = s.channelId ? guild.channels.cache.get(s.channelId) : null;
  if (!channel || !TEXT_TYPES.has(channel.type)) return null;
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return null;
  return channel as GuildTextBasedChannel;
}

/* ------------------------------------------------------------ events */

const voiceChanged = onEvent(Events.VoiceStateUpdate, async (before, after) => {
  const guild = after.guild;
  const member = after.member ?? before.member;
  const key = `${guild.id}:${after.id}`;
  const from = before.channel;
  const to = after.channel;
  // Keep the join time up to date even when nothing gets logged.
  if (!from && to) joinedAt.set(key, Date.now());
  const stayed = joinedAt.get(key);
  if (from && !to) joinedAt.delete(key);
  if (from && to && from.id !== to.id) joinedAt.set(key, Date.now());

  const s = await activeSettings(guild.id);
  if (!s || !member || (s.ignoreBots && member.user.bot)) return;
  const channel = logChannel(guild, s);
  if (!channel) return;

  const embeds: EmbedBuilder[] = [];
  const base = (color: number, title: string) =>
    new EmbedBuilder().setColor(color).setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() }).setTitle(title).setFooter({ text: `User ID ${member.id}` }).setTimestamp();

  if (!from && to && s.joins && !ignored(s, to)) {
    embeds.push(base(COLORS.join, "🔊 Joined voice").setDescription(`<@${member.id}> joined <#${to.id}>.`));
  } else if (from && !to && s.leaves && !ignored(s, from)) {
    embeds.push(
      base(COLORS.leave, "🔇 Left voice").setDescription(`<@${member.id}> left <#${from.id}>${stayed ? ` after ${duration(Date.now() - stayed)}` : ""}.`),
    );
  } else if (from && to && from.id !== to.id && s.moves && !(ignored(s, from) && ignored(s, to))) {
    embeds.push(base(COLORS.move, "🔀 Moved voice channel").setDescription(`<@${member.id}> moved from <#${from.id}> to <#${to.id}>.`));
  }

  if (s.serverMutes && to && !ignored(s, to)) {
    const changes: string[] = [];
    if (before.serverMute !== null && before.serverMute !== after.serverMute) changes.push(after.serverMute ? "🔇 Server muted" : "🔈 Server unmuted");
    if (before.serverDeaf !== null && before.serverDeaf !== after.serverDeaf) changes.push(after.serverDeaf ? "🙉 Server deafened" : "👂 Server undeafened");
    if (changes.length) embeds.push(base(COLORS.mod, changes.join(", ")).setDescription(`<@${member.id}> in <#${to.id}>.`));
  }

  if (embeds.length) await channel.send({ embeds, allowedMentions: { parse: [] } }).catch((err: Error) => log(`couldn't post in ${guild.name}:`, err.message));
});

/* ------------------------------------------------------------ dashboard */

function problems(guild: Guild, s: VoiceLogSettings): string[] {
  if (!s.channelId) return ["Pick a log channel, or nothing is logged."];
  const channel = guild.channels.cache.get(s.channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) return ["The log channel no longer exists. Pick another one."];
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
  return missing.length ? [`In #${channel.name} I need: ${missing.join(", ")}.`] : [];
}

const respond = (guild: Guild, s: VoiceLogSettings): VoiceLogResponse => ({ settings: s, problems: problems(guild, s) });

export const voiceLogs: BotFeature = {
  info: voiceLogsFeature,
  events: [voiceChanged],

  async onToggle(guildId) {
    cache.delete(guildId);
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/voice-logs", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      return respond(guild, (await getFeatureState(guild.id, voiceLogsFeature)).settings as VoiceLogSettings);
    });

    api.put("/api/guilds/:guildId/voice-logs", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = voiceLogSettings.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      const s = parsed.data;
      if (s.channelId && !TEXT_TYPES.has(guild.channels.cache.get(s.channelId)?.type as ChannelType)) {
        return reply.code(400).send({ error: "The log channel no longer exists. Pick another one." });
      }
      const state = await getFeatureState(guild.id, voiceLogsFeature);
      await saveFeatureState(guild.id, voiceLogsFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
      cache.delete(guild.id);
      return respond(guild, s);
    });
  },
};
