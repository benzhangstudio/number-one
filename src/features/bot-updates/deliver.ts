import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  EmbedBuilder,
  type Guild,
  type GuildTextBasedChannel,
  type MessageCreateOptions,
  PermissionFlagsBits,
} from "discord.js";
import { client } from "../../server/bot/discord.js";
import { getFeatureState } from "../../server/settings.js";
import { type BotUpdateOutcome, type BotUpdateSettings, botUpdatesFeature } from "../../shared/features.js";
import { BRAND_PINK } from "../reaction-roles/message.js";
import * as store from "./store.js";

const SEND_GAP_MS = 350; // be gentle with Discord when posting to many servers
const POST_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

interface Update {
  title: string;
  body: string;
  url: string;
  mention: boolean;
  createdAt: Date;
}

/** The server's settings, or null when it doesn't get updates (feature off or no channel). */
export async function receivingSettings(guild: Guild): Promise<BotUpdateSettings | null> {
  const state = await getFeatureState(guild.id, botUpdatesFeature);
  const settings = state.settings as BotUpdateSettings;
  return state.enabled && settings.channelId ? settings : null;
}

/** The channel an admin picked, if the bot can post there. Otherwise a plain-language problem. */
export function chosenChannel(guild: Guild, channelId: string): { channel: GuildTextBasedChannel } | { problem: string } {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased() || channel.isThread()) return { problem: "The updates channel was deleted. Pick another." };
  const me = guild.members.me;
  if (!me || !channel.permissionsFor(me)?.has(POST_PERMISSIONS)) {
    return { problem: `I can't post in #${channel.name}. I need View Channel, Send Messages and Embed Links there.` };
  }
  return { channel: channel as GuildTextBasedChannel };
}

export function buildMessage(guild: Guild, u: Update, settings: BotUpdateSettings): MessageCreateOptions {
  const embed = new EmbedBuilder()
    .setColor(BRAND_PINK)
    .setTitle(u.title.slice(0, 256))
    .setDescription(u.body)
    .setFooter({ text: "Number One updates" })
    .setTimestamp(u.createdAt);
  // Only the server's own chosen role, and only if it still exists.
  const role = u.mention && settings.roleId && guild.roles.cache.has(settings.roleId) ? settings.roleId : null;
  const options: MessageCreateOptions = { embeds: [embed], allowedMentions: { parse: [], roles: role ? [role] : [] } };
  if (role) options.content = `<@&${role}>`;
  if (u.url) {
    options.components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Learn more").setURL(u.url)),
    ];
  }
  return options;
}

/** A plain-language reason a post failed. */
export function reasonFrom(err: unknown): string {
  if (err instanceof DiscordAPIError) {
    if (err.code === 10003) return "The updates channel was deleted.";
    if (err.code === 50001 || err.code === 50013) return "I don't have permission to post in the updates channel.";
  }
  return (err as Error)?.message?.slice(0, 200) || "Unknown error.";
}

/** How many servers would get an update right now. */
export async function receivingCount() {
  let n = 0;
  for (const guild of client.guilds.cache.values()) if (await receivingSettings(guild)) n++;
  return n;
}

const running = new Set<number>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Posts one update to every server that set a channel, one at a time. Each server's result is saved as
 * it happens, so after a restart the rest are picked up where it left off and nobody gets it twice.
 * Servers without a channel are skipped and not recorded.
 */
export async function runUpdate(id: number) {
  if (running.has(id)) return;
  running.add(id);
  try {
    const row = await store.getUpdate(id);
    if (!row || row.status === "done") return;
    const handled = await store.handledGuildIds(id);
    for (const guild of [...client.guilds.cache.values()]) {
      if (handled.has(guild.id)) continue;
      const settings = await receivingSettings(guild);
      if (!settings) continue;
      let outcome: BotUpdateOutcome = "sent";
      let reason = "";
      const target = chosenChannel(guild, settings.channelId!);
      if ("problem" in target) {
        outcome = "failed";
        reason = target.problem;
      } else {
        try {
          await target.channel.send(buildMessage(guild, row, settings));
        } catch (err) {
          outcome = "failed";
          reason = reasonFrom(err);
        }
        await sleep(SEND_GAP_MS);
      }
      await store.recordDelivery(id, guild.id, outcome, reason);
    }
    await store.markDone(id);
    console.log(`[bot-updates] #${id} finished`);
  } catch (err) {
    console.error(`[bot-updates] #${id} stopped early (it will resume on the next start):`, err);
  } finally {
    running.delete(id);
  }
}
