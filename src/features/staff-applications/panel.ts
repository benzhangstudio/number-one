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
import { applicationPanels } from "../../server/db/schema.js";
import { getFeatureState } from "../../server/settings.js";
import {
  type AppButtonStyle,
  type AppPanelInput,
  type StaffApplicationSettings,
  appPanelInput,
  staffApplicationsFeature,
} from "../../shared/features.js";
import { parseEmojiInput } from "../reaction-roles/emoji.js";

/** Staff applications: the apply panel (one per server). */

/** A problem the admin or member can fix, shown as-is. */
export class AppError extends Error {}

export const log = (...args: unknown[]) => console.warn("[staff-applications]", ...args);
export const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
export type PanelRow = typeof applicationPanels.$inferSelect;

export const settingsOf = async (guildId: string) =>
  (await getFeatureState(guildId, staffApplicationsFeature)).settings as StaffApplicationSettings;

export const panelRowOf = (guildId: string) => db.select().from(applicationPanels).where(eq(applicationPanels.guildId, guildId)).get();

/** A saved panel's look and positions, or null if it can't be read. */
export function panelDetails(row: PanelRow): AppPanelInput | null {
  const parsed = appPanelInput.safeParse({ ...row.details, channelId: row.channelId });
  return parsed.success ? parsed.data : null;
}

export async function panelOf(guildId: string) {
  const row = await panelRowOf(guildId);
  return row ? panelDetails(row) : null;
}

const STYLES: Record<AppButtonStyle, ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** The emoji as Discord takes it, or nothing if it's empty or no longer usable. */
export function emojiFor(guild: Guild, text: string) {
  if (!text) return null;
  const parsed = parseEmojiInput(text, guild);
  return "error" in parsed ? null : parsed.display;
}

/** The panel message. Closed positions still show, greyed out, so members know they exist. */
export function buildPanelMessage(guild: Guild, p: AppPanelInput) {
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(p.color.slice(1), 16))
    .setDescription(p.description.trim() || "Pick a position below to apply.");
  if (p.title) embed.setTitle(p.title);
  if (p.image) embed.setImage(p.image);

  if (p.style === "menu") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId("sa:menu")
      .setPlaceholder(p.menuPlaceholder || "Pick a position…")
      .addOptions(
        p.positions.map((pos) => {
          const option = new StringSelectMenuOptionBuilder().setLabel(pos.open ? pos.name : `${pos.name} (closed)`).setValue(pos.id);
          const description = pos.open ? pos.description : "Not taking applications right now.";
          if (description) option.setDescription(description);
          const emoji = emojiFor(guild, pos.emoji);
          if (emoji) option.setEmoji(emoji);
          return option;
        }),
      );
    return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], allowedMentions: { parse: [] } };
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  p.positions.forEach((pos, i) => {
    if (i % 5 === 0) rows.push(new ActionRowBuilder<ButtonBuilder>());
    const button = new ButtonBuilder()
      .setCustomId(`sa:apply:${pos.id}`)
      .setLabel(pos.open ? pos.name : `${pos.name} (closed)`)
      .setStyle(pos.open ? STYLES[pos.buttonStyle] : ButtonStyle.Secondary)
      .setDisabled(!pos.open);
    const emoji = emojiFor(guild, pos.emoji);
    if (emoji) button.setEmoji(emoji);
    rows.at(-1)!.addComponents(button);
  });
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

/** A channel Number One can post embeds in. `what` names it in the error. */
export function postableChannel(guild: Guild, channelId: string, what = "the panel") {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new AppError(`Pick a text channel for ${what}.`);
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
  if (missing.length) throw new AppError(`In #${channel.name} I need: ${missing.join(", ")}.`);
  return channel as GuildTextBasedChannel;
}

/** Posts the panel, or updates it in place. Moving it to another channel removes the old message. */
export async function publishPanel(guild: Guild, p: AppPanelInput, previous: { channelId: string; messageId: string | null } | undefined) {
  const channel = postableChannel(guild, p.channelId);
  const message = buildPanelMessage(guild, p);
  const fail = (err: Error) => {
    throw new AppError(`Discord didn't accept the panel: ${err.message}`);
  };

  if (previous?.messageId && previous.channelId === channel.id) {
    const existing = await channel.messages.fetch(previous.messageId).catch(() => null);
    if (existing) {
      await existing.edit(message).catch(fail);
      return existing.id;
    }
  }
  if (previous?.messageId && previous.channelId !== channel.id) {
    const old = guild.channels.cache.get(previous.channelId);
    if (old?.isTextBased()) await old.messages.delete(previous.messageId).catch(() => {});
  }
  const sent = await channel.send(message).catch(fail);
  return sent.id;
}

/** Takes the panel's message down (the panel itself stays saved). */
export async function unpublishPanel(guild: Guild | undefined, row: PanelRow) {
  if (!row.messageId) return;
  const channel = guild?.channels.cache.get(row.channelId);
  if (channel?.isTextBased()) await channel.messages.delete(row.messageId).catch(() => {});
  await db.update(applicationPanels).set({ messageId: null }).where(eq(applicationPanels.guildId, row.guildId)).run();
}
