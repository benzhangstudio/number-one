import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type GuildTextBasedChannel,
  MessageFlags,
  type ModalSubmitInteraction,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { and, asc, count, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type ComponentHandler, type SlashCommand, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { stickyMessages } from "../../server/db/schema.js";
import { isFeatureEnabled } from "../../server/settings.js";
import { stickyMessagesFeature } from "../../shared/features.js";
import { MAX_STICKIES, STICKY_LIMITS, type StickiesResponse, type StickyInput, type StickyView, stickyInput } from "../../shared/stickyMessages.js";

/**
 * Sticky messages: one message per channel that stays at the bottom. After enough new messages (and once the
 * wait between reposts is over), Number One posts a fresh copy and deletes the old one.
 * Counts and timers live in memory; only the sticky itself and the ID of its posted copy are saved.
 */

type Row = typeof stickyMessages.$inferSelect;
type Req = FastifyRequest<{ Params: { guildId: string; id?: string } }>;

/** A problem the person can fix, shown as-is. */
class StickyError extends Error {}

const log = (...args: unknown[]) => console.warn("[sticky]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread]);
const PREFIX = "sticky";
/** Wait for the chat to settle this long before reposting, so a burst of messages means one repost. */
const QUIET_MS = 2500;

/* ------------------------------------------------------------ reading rows */

function detailsOf(row: Row): StickyInput {
  const parsed = stickyInput.safeParse({ ...row.details, channelId: row.channelId });
  if (parsed.success) return parsed.data;
  // Shouldn't happen; keep it posting with what's certain.
  return stickyInput.parse({ channelId: row.channelId, text: String(row.details.text ?? "📌").slice(0, STICKY_LIMITS.text) || "📌" });
}

const byChannel = (channelId: string) => db.select().from(stickyMessages).where(eq(stickyMessages.channelId, channelId)).get();
const findRow = (guildId: string, id: number) =>
  db
    .select()
    .from(stickyMessages)
    .where(and(eq(stickyMessages.guildId, guildId), eq(stickyMessages.id, id)))
    .get();
const rowsOf = (guildId: string) => db.select().from(stickyMessages).where(eq(stickyMessages.guildId, guildId)).orderBy(asc(stickyMessages.id)).all();

const messageUrl = (r: Row) => (r.messageId ? `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}` : null);

function toView(row: Row): StickyView {
  return { ...detailsOf(row), id: row.id, paused: row.paused, url: messageUrl(row), createdByTag: row.createdByTag, updatedAt: row.updatedAt.getTime() };
}

/* ------------------------------------------------------------ the post */

function buildPost(d: StickyInput) {
  if (!d.embed) return { content: d.text, allowedMentions: { parse: [] } };
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(d.color.slice(1), 16))
    .setDescription(d.text)
    .setFooter({ text: "📌 Sticky message" });
  if (d.title) embed.setTitle(d.title);
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

const channelOf = (guildId: string, channelId: string) => {
  const channel = client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
  return channel?.isTextBased() ? (channel as GuildTextBasedChannel) : null;
};

/** What Number One is missing in a channel to post the sticky there, in Discord's words. */
function missingPerms(channel: GuildBasedChannel, d: Pick<StickyInput, "embed">) {
  const me = channel.guild.members.me;
  const mine = me ? channel.permissionsFor(me) : null;
  const needed: [bigint, string][] = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages, "Send Messages"],
  ];
  if (d.embed) needed.push([PermissionFlagsBits.EmbedLinks, "Embed Links"]);
  return needed.filter(([flag]) => !mine?.has(flag)).map(([, name]) => name);
}

/* ------------------------------------------------------------ reposting */

interface ChannelState {
  /** New messages since the last repost. */
  count: number;
  lastPostAt: number;
  timer?: NodeJS.Timeout;
  /** True while a copy is being sent, so our own new copy isn't counted as chat. */
  posting: boolean;
}
const states = new Map<string, ChannelState>();
const stateOf = (channelId: string) => {
  let s = states.get(channelId);
  if (!s) states.set(channelId, (s = { count: 0, lastPostAt: 0, posting: false }));
  return s;
};
function forget(channelId: string) {
  clearTimeout(states.get(channelId)?.timer);
  states.delete(channelId);
}

/** Work on one channel's sticky happens one job at a time, so two reposts never race. */
const locks = new Map<string, Promise<unknown>>();
function inOrder<T>(channelId: string, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(channelId) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  locks.set(channelId, tail);
  void tail.finally(() => {
    if (locks.get(channelId) === tail) locks.delete(channelId);
  });
  return run;
}

/** Deletes the posted copy of a sticky, if there is one. */
async function takeDown(row: Row) {
  if (!row.messageId) return;
  await db.update(stickyMessages).set({ messageId: null }).where(eq(stickyMessages.id, row.id)).run();
  await channelOf(row.guildId, row.channelId)
    ?.messages.delete(row.messageId)
    .catch(() => {}); // already gone
}

/**
 * Posts a fresh copy at the bottom of the channel, then deletes the old one.
 * Throws a StickyError when `loud` (a person is waiting for the answer); otherwise just logs.
 */
function postNow(channelId: string, loud = false) {
  return inOrder(channelId, async () => {
    const row = await byChannel(channelId);
    if (!row) return null;
    const state = stateOf(channelId);
    clearTimeout(state.timer);
    state.timer = undefined;
    state.count = 0;
    const channel = channelOf(row.guildId, row.channelId);
    if (row.paused || !channel || !(await isFeatureEnabled(row.guildId, stickyMessagesFeature))) return row;
    const d = detailsOf(row);

    const missing = missingPerms(channel, d);
    if (missing.length) {
      if (loud) throw new StickyError(`In #${channel.name} I need: ${missing.join(", ")}.`);
      return row;
    }

    state.posting = true;
    try {
      const sent = await channel.send(buildPost(d));
      state.lastPostAt = Date.now();
      await db.update(stickyMessages).set({ messageId: sent.id }).where(eq(stickyMessages.id, row.id)).run();
      if (row.messageId) await channel.messages.delete(row.messageId).catch(() => {});
      return { ...row, messageId: sent.id };
    } catch (err) {
      if (loud) throw new StickyError(`Discord didn't accept the sticky message: ${(err as Error).message}`);
      log(`couldn't repost the sticky in ${channelId}:`, (err as Error).message);
      return row;
    } finally {
      state.posting = false;
    }
  });
}

/** Someone chatted in a channel with a sticky: repost once enough messages came in and the wait is over. */
async function noteMessage(row: Row) {
  const d = detailsOf(row);
  const state = stateOf(row.channelId);
  state.count++;
  if (state.count < d.afterMessages || state.timer) return;
  const wait = Math.max(QUIET_MS, state.lastPostAt + d.delaySeconds * 1000 - Date.now());
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void postNow(row.channelId);
  }, wait);
}

const messageCreated = onEvent(Events.MessageCreate, async (message) => {
  if (!message.inGuild()) return;
  const row = await byChannel(message.channelId);
  if (!row || row.paused) return;
  // Our own new copy of the sticky isn't chat.
  if (message.author.id === client.user?.id && (message.id === row.messageId || states.get(message.channelId)?.posting)) return;
  if (!(await isFeatureEnabled(message.guildId, stickyMessagesFeature))) return;
  await noteMessage(row);
});

/** Someone deleted the posted copy: forget it, and the next message brings it back. */
const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (message.guildId) await db.update(stickyMessages).set({ messageId: null }).where(eq(stickyMessages.messageId, message.id)).run();
});

async function channelGone(channelId: string) {
  forget(channelId);
  await db.delete(stickyMessages).where(eq(stickyMessages.channelId, channelId)).run();
}
const channelDeleted = onEvent(Events.ChannelDelete, (channel) => channelGone(channel.id));
const threadDeleted = onEvent(Events.ThreadDelete, (thread) => channelGone(thread.id));

/* ------------------------------------------------------------ actions */

/** Checks the sticky can be posted. `member` is who's setting it. Throws a StickyError. */
function checkInput(guild: Guild, member: GuildMember, d: StickyInput) {
  const channel = guild.channels.cache.get(d.channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new StickyError("That channel no longer exists. Pick another one.");
  const missing = missingPerms(channel, d);
  if (missing.length) throw new StickyError(`In #${channel.name} I need: ${missing.join(", ")}.`);
  const theirs = channel.permissionsFor(member);
  if (!theirs.has(PermissionFlagsBits.ViewChannel) || !theirs.has(channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages)) {
    throw new StickyError(`You can't post in #${channel.name} yourself, so I can't post there for you.`);
  }
  return channel;
}

async function memberOf(guild: Guild, userId: string) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new StickyError("You're no longer a member of this server.");
  return member;
}

/**
 * Saves a sticky and posts it right away. Without `id`, a channel that already has one gets it replaced
 * when `replace` is set (the /sticky command), or an error (the dashboard's "New sticky").
 */
async function save(guild: Guild, userId: string, d: StickyInput, opts: { id?: number; replace?: boolean } = {}) {
  const member = await memberOf(guild, userId);
  checkInput(guild, member, d);
  const now = new Date();
  const inChannel = await byChannel(d.channelId);
  let row = opts.id ? await findRow(guild.id, opts.id) : inChannel;
  if (opts.id && !row) throw new StickyError("That sticky message isn't saved anymore. Reload the page.");
  if (inChannel && inChannel.id !== row?.id) throw new StickyError(`#${guild.channels.cache.get(d.channelId)?.name ?? "That channel"} already has a sticky message. Edit that one instead.`);
  if (row && !opts.id && !opts.replace) throw new StickyError("That channel already has a sticky message. Edit that one instead.");
  const { channelId, ...details } = d;

  if (row) {
    if (row.channelId !== channelId) {
      // Moving it: take the copy down from the old channel.
      await inOrder(row.channelId, () => takeDown(row!));
      forget(row.channelId);
    }
    await db.update(stickyMessages).set({ channelId, details, updatedAt: now }).where(eq(stickyMessages.id, row.id)).run();
  } else {
    const total = (await db.select({ n: count() }).from(stickyMessages).where(eq(stickyMessages.guildId, guild.id)).get())?.n ?? 0;
    if (total >= MAX_STICKIES) throw new StickyError(`This server already has ${MAX_STICKIES} sticky messages. Delete one first.`);
    [row] = await db
      .insert(stickyMessages)
      .values({ guildId: guild.id, channelId, details, createdBy: member.id, createdByTag: member.user.tag, createdAt: now, updatedAt: now })
      .returning()
      .all();
  }
  const posted = await postNow(channelId, true);
  return toView(posted ?? row!);
}

async function setPaused(guild: Guild, id: number, paused: boolean) {
  const row = await findRow(guild.id, id);
  if (!row) throw new StickyError("That sticky message isn't saved anymore. Reload the page.");
  await db.update(stickyMessages).set({ paused }).where(eq(stickyMessages.id, id)).run();
  if (paused) {
    await inOrder(row.channelId, () => takeDown(row));
    forget(row.channelId);
    return toView({ ...row, paused, messageId: null });
  }
  return toView((await postNow(row.channelId, true)) ?? { ...row, paused });
}

async function remove(row: Row) {
  await inOrder(row.channelId, () => takeDown(row));
  forget(row.channelId);
  await db.delete(stickyMessages).where(eq(stickyMessages.id, row.id)).run();
}

async function overview(guild: Guild): Promise<StickiesResponse> {
  const rows = await rowsOf(guild.id);
  const problems: string[] = [];
  for (const row of rows) {
    if (row.paused) continue;
    const channel = guild.channels.cache.get(row.channelId);
    if (!channel) continue;
    const missing = missingPerms(channel, detailsOf(row));
    if (missing.length) problems.push(`In #${channel.name} I need: ${missing.join(", ")}.`);
  }
  return { stickies: rows.map(toView), problems };
}

/** Posts (or takes down) every sticky in a server, when the feature is switched on or off. */
async function refreshAll(guildId: string, on: boolean) {
  for (const row of await rowsOf(guildId)) {
    if (on && !row.paused) await postNow(row.channelId);
    else if (!on) {
      await inOrder(row.channelId, () => takeDown(row));
      forget(row.channelId);
    }
  }
}

/* ------------------------------------------------------------ slash command */

const stickyModal = (key: string, d: Partial<StickyInput>, embed: boolean) => {
  const text = new TextInputBuilder()
    .setCustomId("text")
    .setLabel("Message")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("What should stay at the bottom of the channel?")
    .setRequired(true)
    .setMaxLength(embed ? STICKY_LIMITS.embedText : STICKY_LIMITS.text);
  if (d.text) text.setValue(d.text.slice(0, embed ? STICKY_LIMITS.embedText : STICKY_LIMITS.text));
  const modal = new ModalBuilder().setCustomId(`${PREFIX}:set:${key}`).setTitle("Sticky message");
  if (embed) {
    const title = new TextInputBuilder().setCustomId("title").setLabel("Title (optional)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(STICKY_LIMITS.title);
    if (d.title) title.setValue(d.title);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(title));
  }
  return modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(text));
};

/** What /sticky set chose, kept between the command and its form (modal IDs are short, so it's kept here). */
const pendingForms = new Map<string, { channelId: string; embed: boolean; afterMessages: number; delaySeconds: number; color: string }>();

const channelOption = (o: import("discord.js").SlashCommandChannelOption, what: string) =>
  o
    .setName("channel")
    .setDescription(`${what} (this channel if empty)`)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread);

const stickyCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("sticky")
    .setDescription("Keep a message at the bottom of a channel.")
    .setContexts(0)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((c) =>
      c
        .setName("set")
        .setDescription("Add or change a channel's sticky message (opens a form)")
        .addChannelOption((o) => channelOption(o, "Where it goes"))
        .addBooleanOption((o) => o.setName("embed").setDescription("Post it in a coloured box with a title (default: plain text)"))
        .addIntegerOption((o) =>
          o.setName("after").setDescription("Repost after this many new messages (default: 1)").setMinValue(1).setMaxValue(STICKY_LIMITS.maxAfter),
        )
        .addIntegerOption((o) =>
          o.setName("wait").setDescription("Seconds to wait at least between reposts (default: 10)").setMinValue(5).setMaxValue(STICKY_LIMITS.maxDelay),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("remove")
        .setDescription("Delete a channel's sticky message")
        .addChannelOption((o) => channelOption(o, "Which channel")),
    )
    .addSubcommand((c) =>
      c
        .setName("pause")
        .setDescription("Stop reposting a sticky message for now (it stays saved)")
        .addChannelOption((o) => channelOption(o, "Which channel")),
    )
    .addSubcommand((c) =>
      c
        .setName("resume")
        .setDescription("Start reposting a paused sticky message again")
        .addChannelOption((o) => channelOption(o, "Which channel")),
    )
    .addSubcommand((c) => c.setName("list").setDescription("See this server's sticky messages")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();

    if (sub === "list") {
      const rows = await rowsOf(guild.id);
      if (!rows.length) return interaction.reply("This server has no sticky messages yet. Add one with `/sticky set`.");
      const lines = rows.map((r) => {
        const d = detailsOf(r);
        const preview = (d.title || d.text).replace(/\s+/g, " ").slice(0, 60);
        return `• <#${r.channelId}>${r.paused ? " (paused)" : ""}: ${preview}${(d.title || d.text).length > 60 ? "…" : ""}`;
      });
      return interaction.reply({ content: `📌 **Sticky messages** (${rows.length}/${MAX_STICKIES})\n${lines.join("\n")}`.slice(0, 2000), allowedMentions: { parse: [] } });
    }

    const channel = interaction.options.getChannel("channel") ?? interaction.channel;
    if (!channel) return interaction.reply("I can't use this channel.");
    const row = await byChannel(channel.id);

    if (sub === "set") {
      const old = row ? detailsOf(row) : null;
      const embed = interaction.options.getBoolean("embed") ?? old?.embed ?? false;
      const key = interaction.id;
      pendingForms.set(key, {
        channelId: channel.id,
        embed,
        afterMessages: interaction.options.getInteger("after") ?? old?.afterMessages ?? 1,
        delaySeconds: interaction.options.getInteger("wait") ?? old?.delaySeconds ?? 10,
        color: old?.color ?? "#ff4fa3",
      });
      setTimeout(() => pendingForms.delete(key), 15 * 60_000).unref();
      return interaction.showModal(stickyModal(key, old ?? {}, embed));
    }

    if (!row) return interaction.reply(`<#${channel.id}> doesn't have a sticky message.`);
    try {
      if (sub === "remove") {
        await remove(row);
        return interaction.reply(`📌 Sticky message removed from <#${channel.id}>.`);
      }
      const paused = sub === "pause";
      if (row.paused === paused) return interaction.reply(`That sticky message is already ${paused ? "paused" : "running"}.`);
      await interaction.deferReply();
      await setPaused(guild, row.id, paused);
      return interaction.editReply(paused ? `⏸️ Sticky message in <#${channel.id}> paused. Use \`/sticky resume\` to bring it back.` : `▶️ Sticky message in <#${channel.id}> is back.`);
    } catch (err) {
      if (!(err instanceof StickyError)) throw err;
      return interaction.deferred ? interaction.editReply(err.message) : interaction.reply(err.message);
    }
  },
};

const stickyForms: ComponentHandler = {
  prefix: PREFIX,
  async handle() {},
  async handleModal(interaction: ModalSubmitInteraction) {
    if (!interaction.inCachedGuild()) return;
    const [, kind, key] = interaction.customId.split(":");
    if (kind !== "set") return;
    const form = pendingForms.get(key);
    if (!form) return interaction.reply({ content: "This form expired. Run `/sticky set` again.", flags: MessageFlags.Ephemeral });
    pendingForms.delete(key);
    const parsed = stickyInput.safeParse({
      ...form,
      title: form.embed ? interaction.fields.getTextInputValue("title") : "",
      text: interaction.fields.getTextInputValue("text"),
    });
    if (!parsed.success) return interaction.reply({ content: parsed.error.issues[0]?.message ?? "Check the message and try again.", flags: MessageFlags.Ephemeral });
    await interaction.deferReply();
    try {
      await save(interaction.guild, interaction.user.id, parsed.data, { replace: true });
      return interaction.editReply({ content: `📌 Sticky message set in <#${form.channelId}>.`, allowedMentions: { parse: [] } });
    } catch (err) {
      if (err instanceof StickyError) return interaction.editReply({ content: err.message, allowedMentions: { parse: [] } });
      throw err;
    }
  },
};

/* ------------------------------------------------------------ dashboard */

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof StickyError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

function parseInput(body: unknown): StickyInput {
  const parsed = stickyInput.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new StickyError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
}

const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;
const idOf = (request: Req) => Number(request.params.id);

export const stickyMessagesBot: BotFeature = {
  info: stickyMessagesFeature,
  commands: [stickyCommand],
  components: [stickyForms],
  events: [messageCreated, messageDeleted, channelDeleted, threadDeleted],

  onToggle: (guildId, enabled) => refreshAll(guildId, enabled),
  beforeDataDelete: (guildId) => refreshAll(guildId, false),

  registerApi(api) {
    const base = "/api/guilds/:guildId/sticky-messages";
    api.get(base, async (request: Req) => overview(guildOf(request)));

    api.post(base, (request: Req, reply) => guarded(reply, () => save(guildOf(request), request.session!.userId, parseInput(request.body))));

    api.put(`${base}/:id`, (request: Req, reply) =>
      guarded(reply, () => save(guildOf(request), request.session!.userId, parseInput(request.body), { id: idOf(request) })),
    );

    api.post(`${base}/:id/pause`, (request: Req, reply) =>
      guarded(reply, () => setPaused(guildOf(request), idOf(request), Boolean((request.body as { paused?: unknown } | null)?.paused))),
    );

    api.delete(`${base}/:id`, async (request: Req) => {
      const row = await findRow(request.params.guildId, idOf(request));
      if (row) await remove(row);
      return { ok: true };
    });
  },
};
