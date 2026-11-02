import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildTextBasedChannel,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type ComponentHandler, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { guides } from "../../server/db/schema.js";
import { isFeatureEnabled } from "../../server/settings.js";
import { guidesFeature } from "../../shared/features.js";
import { type GuideInput, type GuideView, type GuidesResponse, MAX_GUIDES, guideInput } from "../../shared/guides.js";
import { parseEmojiInput } from "../reaction-roles/emoji.js";

/**
 * Server guides: a cover message with the table of contents, and pages readers open privately.
 * Pages are ephemeral, so any number of people can read at once without fighting over one message.
 */

type Req = FastifyRequest<{ Params: { guildId: string; guideId?: string } }>;
type GuideRow = typeof guides.$inferSelect;

/** A problem the admin can fix, shown as-is on the dashboard. */
class GuideError extends Error {}

const log = (...args: unknown[]) => console.warn("[guides]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const rowOf = (guildId: string, id: number) => db.select().from(guides).where(and(eq(guides.guildId, guildId), eq(guides.id, id))).get();
const rowsOf = (guildId: string) => db.select().from(guides).where(eq(guides.guildId, guildId)).all();

function detailsOf(row: GuideRow): GuideInput | null {
  const parsed = guideInput.safeParse({ ...row.details, channelId: row.channelId });
  return parsed.success ? parsed.data : null;
}

/** The emoji as Discord takes it on buttons and menus, or nothing. */
function emojiFor(guild: Guild, text: string) {
  if (!text) return null;
  const parsed = parseEmojiInput(text, guild);
  return "error" in parsed ? null : parsed.display;
}

/** Embed titles can't show custom emojis, so only standard ones go there. */
const titled = (emoji: string, title: string) => (emoji && !emoji.startsWith("<") ? `${emoji} ${title}` : title);
const colorOf = (g: GuideInput) => Number.parseInt(g.color.slice(1), 16);

function contentsList(g: GuideInput) {
  return g.pages.map((p, i) => `**${i + 1}.** ${p.emoji ? `${p.emoji} ` : ""}${p.title}`).join("\n");
}

function jumpMenu(guild: Guild, guideId: number, g: GuideInput, current?: string) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`gd:jump:${guideId}`)
    .setPlaceholder("📑 Jump to a page…")
    .addOptions(
      g.pages.map((p, i) => {
        const option = new StringSelectMenuOptionBuilder().setLabel(`${i + 1}. ${p.title}`.slice(0, 100)).setValue(p.id).setDefault(p.id === current);
        const emoji = emojiFor(guild, p.emoji);
        if (emoji) option.setEmoji(emoji);
        return option;
      }),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** The public cover: title, intro, contents, a Start reading button and the jump menu. */
function coverMessage(guild: Guild, guideId: number, g: GuideInput) {
  const parts = [g.intro.trim(), g.showContents ? `**Contents**\n${contentsList(g)}` : ""].filter(Boolean);
  const embed = new EmbedBuilder().setColor(colorOf(g)).setDescription(parts.join("\n\n") || "Press Start reading to open the guide.");
  if (g.title) embed.setTitle(g.title);
  if (g.image) embed.setImage(g.image);
  embed.setFooter({ text: `${g.audience === "staff" ? "🔒 Staff only · " : ""}Pages open just for you` });
  const start = new ButtonBuilder().setCustomId(`gd:p:${guideId}:${g.pages[0].id}`).setLabel("Start reading").setEmoji("📖").setStyle(ButtonStyle.Primary);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(start), jumpMenu(guild, guideId, g)],
    allowedMentions: { parse: [] },
  };
}

/** One page, as the reader sees it: Back / Contents / Next, the jump menu, and links to related pages. */
function pageMessage(guild: Guild, guideId: number, g: GuideInput, index: number) {
  const page = g.pages[index];
  const embed = new EmbedBuilder()
    .setColor(colorOf(g))
    .setTitle(titled(page.emoji, page.title))
    .setDescription(page.content.trim() || "​")
    .setFooter({ text: `${g.name} · Page ${index + 1} of ${g.pages.length}` });
  if (page.image) embed.setImage(page.image);

  const prev = g.pages[index - 1];
  const next = g.pages[index + 1];
  // Custom IDs must be unique in a message, so the disabled ends get their own.
  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(prev ? `gd:p:${guideId}:${prev.id}` : "gd:end:back")
      .setLabel("Back")
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!prev),
    new ButtonBuilder().setCustomId(`gd:toc:${guideId}`).setLabel("Contents").setEmoji("📑").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(next ? `gd:p:${guideId}:${next.id}` : "gd:end:next")
      .setLabel("Next")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!next),
  );
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [nav, jumpMenu(guild, guideId, g, page.id)];

  const related = page.links.map((id) => g.pages.find((p) => p.id === id)).filter((p) => p !== undefined);
  const extra = new ActionRowBuilder<ButtonBuilder>();
  for (const p of related) {
    const button = new ButtonBuilder().setCustomId(`gd:l:${guideId}:${p.id}`).setLabel(`→ ${p.title}`.slice(0, 80)).setStyle(ButtonStyle.Secondary);
    const emoji = emojiFor(guild, p.emoji);
    if (emoji) button.setEmoji(emoji);
    extra.addComponents(button);
  }
  if (page.linkUrl && page.linkLabel) extra.addComponents(new ButtonBuilder().setURL(page.linkUrl).setLabel(page.linkLabel).setStyle(ButtonStyle.Link));
  if (extra.components.length) rows.push(extra);
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

/** The contents page inside the private reader. */
function contentsMessage(guild: Guild, guideId: number, g: GuideInput) {
  const embed = new EmbedBuilder()
    .setColor(colorOf(g))
    .setTitle(g.title || g.name)
    .setDescription(`**Contents**\n${contentsList(g)}`)
    .setFooter({ text: `${g.name} · ${g.pages.length} page${g.pages.length === 1 ? "" : "s"}` });
  const start = new ButtonBuilder().setCustomId(`gd:p:${guideId}:${g.pages[0].id}`).setLabel("Start reading").setEmoji("📖").setStyle(ButtonStyle.Primary);
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(start), jumpMenu(guild, guideId, g)],
    allowedMentions: { parse: [] },
  };
}

/* ------------------------------------------------------------ reading */

const reader: ComponentHandler = {
  prefix: "gd",
  async handle(interaction) {
    if (!interaction.inCachedGuild()) return;
    const [, action, id, pageId] = interaction.customId.split(":");
    if (action === "end") return interaction.deferUpdate();
    const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!(await isFeatureEnabled(interaction.guildId, guidesFeature))) return privately("Guides are turned off in this server right now.");

    const guideId = Number(id);
    const row = await rowOf(interaction.guildId, guideId);
    const g = row ? detailsOf(row) : null;
    if (!g) return privately("This guide no longer exists.");
    if (g.audience === "staff") {
      const member = interaction.member;
      const allowed = member.permissions.has(PermissionFlagsBits.ManageGuild) || g.roleIds.some((r) => member.roles.cache.has(r));
      if (!allowed) return privately("🔒 This guide is for staff only.");
    }

    let message;
    if (action === "toc") message = contentsMessage(interaction.guild, guideId, g);
    else {
      const target = action === "jump" && interaction.isStringSelectMenu() ? interaction.values[0] : pageId;
      const index = g.pages.findIndex((p) => p.id === target);
      message = index >= 0 ? pageMessage(interaction.guild, guideId, g, index) : contentsMessage(interaction.guild, guideId, g);
    }

    await db.update(guides).set({ views: sql`${guides.views} + 1` }).where(eq(guides.id, guideId)).run();

    // Inside the private reader the page is swapped in place; from the cover a private reader opens.
    if (interaction.message.flags.has(MessageFlags.Ephemeral)) return interaction.update(message);
    await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
    // A dropdown keeps showing the last pick; put the cover back so the next person sees it fresh.
    if (interaction.isStringSelectMenu()) await interaction.message.edit(coverMessage(interaction.guild, guideId, g)).catch(() => {});
  },
};

/* ------------------------------------------------------------ posting the cover */

function postableChannel(guild: Guild, channelId: string) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new GuideError("Pick a text channel for the guide.");
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
  if (missing.length) throw new GuideError(`In #${channel.name} I need: ${missing.join(", ")}.`);
  return channel as GuildTextBasedChannel;
}

/** Posts the cover, or updates it in place. Moving it to another channel removes the old one. */
async function publish(guild: Guild, guideId: number, g: GuideInput, previous: { channelId: string; messageId: string | null }) {
  const channel = postableChannel(guild, g.channelId);
  const message = coverMessage(guild, guideId, g);
  const fail = (err: Error) => {
    throw new GuideError(`Discord didn't accept the guide: ${err.message}`);
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
  await db.update(guides).set({ channelId: channel.id, messageId: sent.id }).where(eq(guides.id, guideId)).run();
}

async function unpublish(guild: Guild | undefined, row: GuideRow) {
  if (!row.messageId) return;
  const channel = guild?.channels.cache.get(row.channelId);
  if (channel?.isTextBased()) await channel.messages.delete(row.messageId).catch(() => {});
  await db.update(guides).set({ messageId: null }).where(eq(guides.id, row.id)).run();
}

const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (message.guildId) await db.update(guides).set({ messageId: null }).where(eq(guides.messageId, message.id)).run();
});

/* ------------------------------------------------------------ dashboard */

function check(guild: Guild, g: GuideInput) {
  postableChannel(guild, g.channelId);
  for (const id of g.roleIds) if (!guild.roles.cache.has(id)) throw new GuideError("A role picked for this guide no longer exists.");
  for (const p of g.pages) {
    if (!p.emoji) continue;
    const parsed = parseEmojiInput(p.emoji, guild);
    if ("error" in parsed) throw new GuideError(`${p.title}: ${parsed.error}`);
  }
}

function parse(body: unknown) {
  const parsed = guideInput.safeParse(body);
  if (!parsed.success) throw new GuideError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  return parsed.data;
}

/** What's stored in the details column: everything except the channel, which has its own column. */
const stored = ({ channelId: _channel, ...rest }: GuideInput): Record<string, unknown> => rest;

async function respond(guild: Guild): Promise<GuidesResponse> {
  const enabled = await isFeatureEnabled(guild.id, guidesFeature);
  const list: GuideView[] = [];
  const problems: string[] = [];
  for (const row of await rowsOf(guild.id)) {
    const g = detailsOf(row);
    if (!g) continue;
    list.push({ ...g, id: row.id, views: row.views, messageUrl: row.messageId ? `https://discord.com/channels/${guild.id}/${row.channelId}/${row.messageId}` : null });
    if (enabled && !row.messageId) problems.push(`"${g.name}" isn't posted. Save it to post it again.`);
    if (g.audience === "staff" && g.roleIds.some((id) => !guild.roles.cache.has(id))) problems.push(`"${g.name}": a staff role was deleted.`);
  }
  if (!enabled && list.length) problems.push("Server guides is switched off, so guides aren't posted. Switch it on to post them.");
  return { guides: list, problems };
}

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof GuideError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

export const guidesBot: BotFeature = {
  info: guidesFeature,
  components: [reader],
  events: [messageDeleted],

  async onToggle(guildId, enabled) {
    const guild = client.guilds.cache.get(guildId);
    const rows = await rowsOf(guildId);
    if (!enabled) {
      for (const row of rows) await unpublish(guild, row);
      return;
    }
    if (!guild) return;
    for (const row of rows) {
      const g = detailsOf(row);
      if (g) await publish(guild, row.id, g, row).catch((err) => log(`couldn't post a guide in ${guild.name}:`, err.message));
    }
  },

  async beforeDataDelete(guildId) {
    const guild = client.guilds.cache.get(guildId);
    for (const row of await rowsOf(guildId)) await unpublish(guild, row);
  },

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;

    api.get("/api/guilds/:guildId/guides", async (request: Req) => respond(guildOf(request)));

    api.post("/api/guilds/:guildId/guides", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const g = parse(request.body);
        if ((await rowsOf(guild.id)).length >= MAX_GUIDES) throw new GuideError(`A server can have up to ${MAX_GUIDES} guides.`);
        check(guild, g);
        const [row] = await db
          .insert(guides)
          .values({ guildId: guild.id, channelId: g.channelId, details: stored(g), createdBy: request.session!.userId, updatedAt: new Date() })
          .returning()
          .all();
        if (await isFeatureEnabled(guild.id, guidesFeature)) {
          try {
            await publish(guild, row.id, g, { channelId: g.channelId, messageId: null });
          } catch (err) {
            await db.delete(guides).where(eq(guides.id, row.id)).run(); // nothing half-made
            throw err;
          }
        }
        return respond(guild);
      }),
    );

    api.put("/api/guilds/:guildId/guides/:guideId", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const row = await rowOf(guild.id, Number(request.params.guideId));
        if (!row) return reply.code(404).send({ error: "That guide no longer exists." });
        const g = parse(request.body);
        check(guild, g);
        if (await isFeatureEnabled(guild.id, guidesFeature)) await publish(guild, row.id, g, row);
        else if (row.channelId !== g.channelId) await unpublish(guild, row);
        await db.update(guides).set({ channelId: g.channelId, details: stored(g), updatedAt: new Date() }).where(eq(guides.id, row.id)).run();
        return respond(guild);
      }),
    );

    api.delete("/api/guilds/:guildId/guides/:guideId", async (request: Req, reply) => {
      const guild = guildOf(request);
      const row = await rowOf(guild.id, Number(request.params.guideId));
      if (!row) return reply.code(404).send({ error: "That guide no longer exists." });
      await unpublish(guild, row);
      await db.delete(guides).where(eq(guides.id, row.id)).run();
      return respond(guild);
    });
  },
};
