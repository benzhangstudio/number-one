import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db } from "../../server/db/client.js";
import { ticketPanels } from "../../server/db/schema.js";
import { getFeatureState } from "../../server/settings.js";
import { ticketsFeature } from "../../shared/features.js";
import { type TicketButtonStyle, type TicketPanelInput, type TicketSettings, ticketPanelInput } from "../../shared/tickets.js";
import { parseEmojiInput } from "../reaction-roles/emoji.js";

/** Ticket panels: the messages with "open a ticket" buttons or a dropdown. */

/** A problem the admin or member can fix, shown as-is. */
export class TicketError extends Error {}

export const log = (...args: unknown[]) => console.warn("[tickets]", ...args);
export const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
export type PanelRow = typeof ticketPanels.$inferSelect;

export const settingsOf = async (guildId: string) => (await getFeatureState(guildId, ticketsFeature)).settings as TicketSettings;

const STYLES: Record<TicketButtonStyle, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** A saved panel's look and ticket types, or null if it can't be read. */
export function panelDetails(row: PanelRow): TicketPanelInput | null {
  const parsed = ticketPanelInput.safeParse({ ...row.details, channelId: row.channelId });
  return parsed.success ? parsed.data : null;
}

export const panelsOf = (guildId: string) => db.select().from(ticketPanels).where(eq(ticketPanels.guildId, guildId)).all();

/** The emoji as Discord takes it, or nothing if it's empty or no longer usable. */
function emojiFor(guild: Guild, text: string) {
  if (!text) return null;
  const parsed = parseEmojiInput(text, guild);
  return "error" in parsed ? null : parsed.display;
}

export function buildPanelMessage(guild: Guild, panelId: number, p: TicketPanelInput) {
  const embed = new EmbedBuilder().setColor(Number.parseInt(p.color.slice(1), 16)).setDescription(p.description.trim() || "Open a ticket below.");
  if (p.title) embed.setTitle(p.title);
  if (p.image) embed.setImage(p.image);

  if (p.style === "menu") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`tk:menu:${panelId}`)
      .setPlaceholder(p.menuPlaceholder || "Pick a ticket type…")
      .addOptions(
        p.types.map((t) => {
          const option = new StringSelectMenuOptionBuilder().setLabel(t.label).setValue(t.id);
          if (t.description) option.setDescription(t.description);
          const emoji = emojiFor(guild, t.emoji);
          if (emoji) option.setEmoji(emoji);
          return option;
        }),
      );
    return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], allowedMentions: { parse: [] } };
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  p.types.forEach((t, i) => {
    if (i % 5 === 0) rows.push(new ActionRowBuilder<ButtonBuilder>());
    const button = new ButtonBuilder().setCustomId(`tk:open:${panelId}:${t.id}`).setLabel(t.label).setStyle(STYLES[t.buttonStyle]);
    const emoji = emojiFor(guild, t.emoji);
    if (emoji) button.setEmoji(emoji);
    rows.at(-1)!.addComponents(button);
  });
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

/** The channel a panel goes in, after checking Number One can post there. */
export function postableChannel(guild: Guild, channelId: string, what = "the panel") {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new TicketError(`Pick a text channel for ${what}.`);
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
  if (missing.length) throw new TicketError(`In #${channel.name} I need: ${missing.join(", ")}.`);
  return channel as GuildTextBasedChannel;
}

/**
 * Posts a panel, or updates it in place. `previous` is where it was posted before this save,
 * so moving it to another channel removes the old message.
 */
export async function publishPanel(guild: Guild, panelId: number, p: TicketPanelInput, previous: { channelId: string; messageId: string | null }) {
  const channel = postableChannel(guild, p.channelId);
  const message = buildPanelMessage(guild, panelId, p);
  const fail = (err: Error) => {
    throw new TicketError(`Discord didn't accept the panel: ${err.message}`);
  };

  if (previous.messageId && previous.channelId === channel.id) {
    const existing = await channel.messages.fetch(previous.messageId).catch(() => null);
    if (existing) {
      await existing.edit(message).catch(fail);
      return;
    }
  }
  if (previous.messageId && previous.channelId !== channel.id) {
    const old = guild.channels.cache.get(previous.channelId);
    if (old?.isTextBased()) await old.messages.delete(previous.messageId).catch(() => {});
  }
  const sent = await channel.send(message).catch(fail);
  await db.update(ticketPanels).set({ channelId: channel.id, messageId: sent.id }).where(eq(ticketPanels.id, panelId)).run();
}

/** Takes a panel's message down (the panel itself stays saved). */
export async function unpublishPanel(guild: Guild | undefined, row: PanelRow) {
  if (!row.messageId) return;
  const channel = guild?.channels.cache.get(row.channelId);
  if (channel?.isTextBased()) await channel.messages.delete(row.messageId).catch(() => {});
  await db.update(ticketPanels).set({ messageId: null }).where(eq(ticketPanels.id, row.id)).run();
}
