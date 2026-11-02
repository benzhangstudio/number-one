import {
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
import { joinLeaveFeature } from "../../shared/features.js";
import { type JoinLeaveResponse, type JoinLeaveSettings, joinLeaveSettings } from "../../shared/joinLeave.js";
import { isRaidActive } from "../anti-raid/state.js";

type Req = FastifyRequest<{ Params: { guildId: string } }>;

const PINK = 0xff4fa3;
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

async function getActiveSettings(guildId: string): Promise<JoinLeaveSettings | null> {
  const state = await getFeatureState(guildId, joinLeaveFeature);
  return state.enabled ? (state.settings as JoinLeaveSettings) : null;
}

/** Fills in {user}, {username}, {server} and {memberCount}. */
function fill(text: string, member: GuildMember | PartialGuildMember) {
  const name = member.displayName ?? member.user?.username ?? "someone";
  return text
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", name)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{memberCount}", member.guild.memberCount.toLocaleString("en-US"));
}

/** The chosen channel, or the server's system channel when none is chosen. */
const targetChannel = (guild: Guild, channelId: string | null) => (channelId ? guild.channels.cache.get(channelId) : guild.systemChannel);

/** What's stopping the bot from posting in a channel, in plain words, or null if it can. */
function channelProblem(guild: Guild, channelId: string | null, what: string): string | null {
  const channel = targetChannel(guild, channelId);
  if (!channel) return channelId ? `The ${what} channel no longer exists. Pick another one.` : `There's no system channel for ${what} messages. Pick a channel.`;
  if (!channel.isTextBased() || channel.isThread()) return `Pick a text channel for ${what} messages.`;
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
  return missing.length ? `In #${channel.name} (${what} messages) I need: ${missing.join(", ")}.` : null;
}

function postable(guild: Guild, channelId: string | null): GuildTextBasedChannel | null {
  if (channelProblem(guild, channelId, "")) return null;
  return targetChannel(guild, channelId) as GuildTextBasedChannel;
}

function payload(text: string, member: GuildMember | PartialGuildMember, useEmbed: boolean) {
  // Mention the member only (never @everyone or roles), even if the message text contains them.
  const allowedMentions = { users: [member.id] };
  if (!useEmbed) return { content: text, allowedMentions };
  const avatar = member.user?.displayAvatarURL?.({ size: 128 });
  const embed = new EmbedBuilder().setColor(PINK).setDescription(text);
  if (avatar) embed.setThumbnail(avatar);
  return { embeds: [embed], allowedMentions };
}

const memberJoined = onEvent(Events.GuildMemberAdd, async (member) => {
  // Raids would flood the welcome channel, so nobody is welcomed while raid mode is on.
  if (member.user.bot || isRaidActive(member.guild.id)) return;
  const settings = await getActiveSettings(member.guild.id);
  if (!settings) return;
  const { welcome } = settings;

  if (welcome.enabled) {
    const channel = postable(member.guild, welcome.channelId);
    const text = fill(welcome.message, member);
    if (channel && text.trim()) await channel.send(payload(text, member, welcome.useEmbed)).catch(() => {});
  }
  if (welcome.dmEnabled) {
    const text = fill(welcome.dmMessage, member);
    // Members can block DMs; that's fine, there's nothing to do about it.
    if (text.trim()) await member.send({ embeds: [new EmbedBuilder().setColor(PINK).setDescription(text)] }).catch(() => {});
  }
});

const memberLeft = onEvent(Events.GuildMemberRemove, async (member) => {
  if (member.user?.bot || isRaidActive(member.guild.id)) return;
  const settings = await getActiveSettings(member.guild.id);
  if (!settings?.goodbye.enabled) return;
  const channel = postable(member.guild, settings.goodbye.channelId);
  const text = fill(settings.goodbye.message, member);
  if (channel && text.trim()) await channel.send(payload(text, member, true)).catch(() => {});
});

function respond(guild: Guild, settings: JoinLeaveSettings): JoinLeaveResponse {
  const problems = [
    settings.welcome.enabled && channelProblem(guild, settings.welcome.channelId, "welcome"),
    settings.goodbye.enabled && channelProblem(guild, settings.goodbye.channelId, "goodbye"),
  ].filter((p): p is string => Boolean(p));
  return { settings, problems };
}

export const joinLeave: BotFeature = {
  info: joinLeaveFeature,
  events: [memberJoined, memberLeft],

  registerApi(api) {
    api.get("/api/guilds/:guildId/join-leave", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const state = await getFeatureState(guild.id, joinLeaveFeature);
      return respond(guild, state.settings as JoinLeaveSettings);
    });

    api.put("/api/guilds/:guildId/join-leave", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = joinLeaveSettings.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reply.code(400).send({ error: issue ? `${issue.path.join(" → ")}: ${issue.message}` : "Check the form and try again." });
      }
      const s = parsed.data;
      for (const [id, what] of [
        [s.welcome.channelId, "welcome"],
        [s.goodbye.channelId, "goodbye"],
      ] as const) {
        if (id && !TEXT_TYPES.has(guild.channels.cache.get(id)?.type as ChannelType)) {
          return reply.code(400).send({ error: `The ${what} channel no longer exists. Pick another one.` });
        }
      }
      const state = await getFeatureState(guild.id, joinLeaveFeature);
      await saveFeatureState(guild.id, joinLeaveFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
      return respond(guild, s);
    });
  },
};
