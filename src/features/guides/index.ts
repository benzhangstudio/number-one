import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
  PermissionFlagsBits,
} from "discord.js";
import { and, eq, like } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { guidePosts } from "../../server/db/schema.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import { guidesFeature } from "../../shared/features.js";
import {
  GUIDE_NAMES,
  type GuideKind,
  type GuideSettings,
  type GuidesResponse,
  type GuidesSettings,
  guideKinds,
  guideSettings,
} from "../../shared/guides.js";

/**
 * Guides: a Server guide and a Staff guide, each posted as plain messages in the channel the admin picks.
 * The first message is the contents, linking to every section; each section links back to the contents
 * and on to the next one. Readers just scroll or tap links; there's nothing to press.
 */

type Req = FastifyRequest<{ Params: { guildId: string; kind?: string } }>;
type PostRow = typeof guidePosts.$inferSelect;

/** A problem the admin can fix, shown as-is on the dashboard. */
class GuideError extends Error {}

const log = (...args: unknown[]) => console.warn("[guides]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const stateOf = (guildId: string) => getFeatureState(guildId, guidesFeature);
const postOf = (guildId: string, kind: GuideKind) =>
  db.select().from(guidePosts).where(and(eq(guidePosts.guildId, guildId), eq(guidePosts.kind, kind))).get();

const messageUrl = (guildId: string, channelId: string, messageId: string) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/** Embed titles can't show custom emojis, so those go at the start of the text instead. */
const isCustom = (emoji: string) => emoji.startsWith("<");

/* ------------------------------------------------------------ the messages */

/** The contents message. `links` are the section message links (left out on the very first post, then filled in). */
function contentsMessage(g: GuideSettings, links: string[] | null) {
  const list = g.sections
    .map((s, i) => {
      const label = `${i + 1}. ${s.emoji ? `${s.emoji} ` : ""}${s.title}`;
      return links?.[i] ? `[${label}](${links[i]})` : label;
    })
    .join("\n");
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(g.color.slice(1), 16))
    .setDescription([g.intro.trim(), `**Contents**\n${list}`].filter(Boolean).join("\n\n"));
  if (g.title) embed.setTitle(g.title);
  if (g.image) embed.setImage(g.image);
  return { embeds: [embed], components: [], allowedMentions: { parse: [] } };
}

/** One section. `contents` and `next` are message links for the buttons underneath. */
function sectionMessage(g: GuideSettings, index: number, contents: string | null, next: string | null) {
  const s = g.sections[index];
  const text = s.content.trim() || "​";
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(g.color.slice(1), 16))
    .setTitle(`${s.emoji && !isCustom(s.emoji) ? `${s.emoji} ` : ""}${s.title}`)
    .setDescription(s.emoji && isCustom(s.emoji) ? `${s.emoji} ${text}` : text)
    .setFooter({ text: `${index + 1} of ${g.sections.length}` });
  if (s.image) embed.setImage(s.image);

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (g.navButtons && contents) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(contents).setLabel("Contents").setEmoji("📑"),
    );
    const after = g.sections[index + 1];
    if (after && next) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(next).setLabel(`Next: ${after.title}`.slice(0, 80)).setEmoji("⬇️"));
    components.push(row);
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

/* ------------------------------------------------------------ posting */

function postableChannel(guild: Guild, channelId: string | null) {
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new GuideError("Pick a text channel for the guide.");
  const me = guild.members.me;
  const missing = (
    [
      [PermissionFlagsBits.ViewChannel, "View Channel"],
      [PermissionFlagsBits.SendMessages, "Send Messages"],
      [PermissionFlagsBits.EmbedLinks, "Embed Links"],
      [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
    ] as const
  )
    .filter(([flag]) => !(me && channel.permissionsFor(me).has(flag)))
    .map(([, name]) => name);
  if (missing.length) throw new GuideError(`In #${channel.name} I need: ${missing.join(", ")}.`);
  return channel as GuildTextBasedChannel;
}

async function deleteMessages(guild: Guild | undefined, post: PostRow) {
  const channel = guild?.channels.cache.get(post.channelId);
  if (channel?.isTextBased()) for (const id of post.messageIds) await channel.messages.delete(id).catch(() => {});
}

/** Fills in every message's links, now that all the message IDs are known. */
async function linkUp(guild: Guild, g: GuideSettings, channelId: string, messages: Message[]) {
  const urls = messages.map((m) => messageUrl(guild.id, channelId, m.id));
  const [contents, ...sections] = messages;
  await contents.edit(contentsMessage(g, urls.slice(1)));
  for (const [i, m] of sections.entries()) await m.edit(sectionMessage(g, i, urls[0], urls[i + 2] ?? null));
}

/**
 * Posts a guide, or updates it in place when it's already up with the same number of sections.
 * Otherwise the old messages are removed and the guide is posted fresh, so it always reads top to bottom.
 */
async function publish(guild: Guild, kind: GuideKind, g: GuideSettings) {
  const channel = postableChannel(guild, g.channelId);
  const fail = (err: Error) => {
    throw new GuideError(`Discord didn't accept the ${GUIDE_NAMES[kind].toLowerCase()}: ${err.message}`);
  };
  const post = await postOf(guild.id, kind);

  if (post && post.channelId === channel.id && post.messageIds.length === g.sections.length + 1) {
    const existing = await Promise.all(post.messageIds.map((id) => channel.messages.fetch(id).catch(() => null)));
    if (existing.every((m) => m !== null)) {
      await linkUp(guild, g, channel.id, existing as Message[]).catch(fail);
      return;
    }
  }

  if (post) await deleteMessages(guild, post);
  const sent: Message[] = [];
  try {
    sent.push(await channel.send(contentsMessage(g, null)));
    for (let i = 0; i < g.sections.length; i++) sent.push(await channel.send(sectionMessage(g, i, null, null)));
    await linkUp(guild, g, channel.id, sent);
  } catch (err) {
    for (const m of sent) await m.delete().catch(() => {}); // nothing half-posted
    await db.delete(guidePosts).where(and(eq(guidePosts.guildId, guild.id), eq(guidePosts.kind, kind))).run();
    return fail(err as Error);
  }
  const values = { guildId: guild.id, kind, channelId: channel.id, messageIds: sent.map((m) => m.id) };
  await db.insert(guidePosts).values(values).onConflictDoUpdate({ target: [guidePosts.guildId, guidePosts.kind], set: values }).run();
}

async function unpublish(guildId: string, kind: GuideKind) {
  const post = await postOf(guildId, kind);
  if (!post) return;
  await deleteMessages(client.guilds.cache.get(guildId), post);
  await db.delete(guidePosts).where(and(eq(guidePosts.guildId, guildId), eq(guidePosts.kind, kind))).run();
}

/** One of a guide's messages was deleted in Discord: forget it, so the next save reposts the whole guide. */
const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (!message.guildId) return;
  const posts = await db.select().from(guidePosts).where(and(eq(guidePosts.guildId, message.guildId), like(guidePosts.messageIds, `%"${message.id}"%`))).all();
  for (const post of posts) {
    await db
      .update(guidePosts)
      .set({ messageIds: post.messageIds.filter((id) => id !== message.id) })
      .where(and(eq(guidePosts.guildId, post.guildId), eq(guidePosts.kind, post.kind)))
      .run();
  }
});

/* ------------------------------------------------------------ dashboard */

async function respond(guild: Guild): Promise<GuidesResponse> {
  const state = await stateOf(guild.id);
  const s = state.settings as GuidesSettings;
  const posted = { server: null, staff: null } as Record<GuideKind, string | null>;
  const problems: string[] = [];
  for (const kind of guideKinds) {
    const g = s[kind];
    const post = await postOf(guild.id, kind);
    if (post?.messageIds[0]) posted[kind] = messageUrl(guild.id, post.channelId, post.messageIds[0]);
    if (!state.enabled || !g.enabled) continue;
    if (!post) problems.push(`The ${GUIDE_NAMES[kind]} isn't posted. Save it to post it.`);
    else if (post.messageIds.length !== g.sections.length + 1) problems.push(`Part of the ${GUIDE_NAMES[kind]} was deleted in Discord. Save it to post it again.`);
    const channel = g.channelId ? guild.channels.cache.get(g.channelId) : null;
    if (!channel) problems.push(`The ${GUIDE_NAMES[kind]}'s channel was deleted. Pick another one.`);
    else if (kind === "staff" && channel.permissionsFor(guild.roles.everyone).has(PermissionFlagsBits.ViewChannel)) {
      problems.push(`Everyone can see #${channel.name}, where the Staff guide is posted. Pick a staff-only channel, or hide that channel from @everyone.`);
    }
  }
  if (!state.enabled && (s.server.enabled || s.staff.enabled)) problems.push("Guides is switched off, so nothing is posted. Switch it on to post your guides.");
  return { settings: s, posted, problems };
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
  events: [messageDeleted],

  async onToggle(guildId, enabled) {
    if (!enabled) {
      for (const kind of guideKinds) await unpublish(guildId, kind);
      return;
    }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const s = (await stateOf(guildId)).settings as GuidesSettings;
    for (const kind of guideKinds) {
      if (s[kind].enabled) await publish(guild, kind, s[kind]).catch((err) => log(`couldn't post the ${kind} guide in ${guild.name}:`, err.message));
    }
  },

  async beforeDataDelete(guildId) {
    for (const kind of guideKinds) await unpublish(guildId, kind);
  },

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;

    api.get("/api/guilds/:guildId/guides", async (request: Req) => respond(guildOf(request)));

    // Saves one guide. Posting it, updating it in place or taking it down follows from its on/off switch.
    api.put("/api/guilds/:guildId/guides/:kind", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const kind = request.params.kind as GuideKind;
        if (!guideKinds.includes(kind)) return reply.code(404).send({ error: "There's no guide like that." });
        const parsed = guideSettings[kind].safeParse(request.body);
        if (!parsed.success) throw new GuideError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
        const g = parsed.data;
        const state = await stateOf(guild.id);

        if (state.enabled && g.enabled) await publish(guild, kind, g);
        else await unpublish(guild.id, kind);

        const settings = { ...(state.settings as GuidesSettings), [kind]: g };
        await saveFeatureState(guild.id, guidesFeature, { enabled: state.enabled, settings }, request.session!.userId);
        return respond(guild);
      }),
    );
  },
};
