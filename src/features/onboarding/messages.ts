import { type Guild, type GuildTextBasedChannel, PermissionFlagsBits } from "discord.js";

export const PINK = 0xff4fa3;

/** A channel the bot can post in: the chosen one, or the server's system channel. */
export function postableChannel(guild: Guild, channelId: string | null): GuildTextBasedChannel | null {
  const channel = channelId ? guild.channels.cache.get(channelId) : guild.systemChannel;
  if (!channel || !channel.isTextBased() || channel.isThread()) return null;
  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return null;
  return channel as GuildTextBasedChannel;
}
