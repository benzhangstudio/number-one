import {
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
} from "discord.js";
import { and, asc, count, desc, eq, inArray, lte } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { client } from "../../server/bot/discord.js";
import type { BotFeature } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { announcementTemplates, announcements } from "../../server/db/schema.js";
import { isFeatureEnabled } from "../../server/settings.js";
import {
  type AnnouncementInput,
  type AnnouncementMessage,
  type AnnouncementPing,
  type AnnouncementView,
  type AnnouncementsResponse,
  MAX_SCHEDULED,
  MAX_SCHEDULE_DAYS,
  MAX_TEMPLATES,
  type TemplateInput,
  type TemplateView,
  announcementEdit,
  announcementInput,
  announcementMessage,
  announcementPing,
  messageProblem,
  templateInput,
} from "../../shared/announcements.js";
import { announcementsFeature } from "../../shared/features.js";

/**
 * Announcements: write on the dashboard, ping who needs to know, send now or at a set time.
 * Templates save announcements that get posted often. Scheduled announcements are checked every 30 seconds.
 */

type Row = typeof announcements.$inferSelect;
type TemplateRow = typeof announcementTemplates.$inferSelect;
type Req = FastifyRequest<{ Params: { guildId: string; id?: string } }>;

/** A problem the admin can fix, shown as-is on the dashboard. */
class AnnouncementError extends Error {}

const log = (...args: unknown[]) => console.warn("[announcements]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const HISTORY = 30;

/* ------------------------------------------------------------ building the message */

function toEmbed(m: AnnouncementMessage): EmbedBuilder {
  const e = m.embed;
  const embed = new EmbedBuilder().setColor(Number.parseInt(e.color.slice(1), 16));
  if (e.authorName) embed.setAuthor({ name: e.authorName, iconURL: e.authorIcon || undefined });
  if (e.title) embed.setTitle(e.title);
  if (e.url && e.title) embed.setURL(e.url);
  if (e.description.trim()) embed.setDescription(e.description);
  if (e.fields.length) embed.addFields(e.fields);
  if (e.image) embed.setImage(e.image);
  if (e.thumbnail) embed.setThumbnail(e.thumbnail);
  if (e.footerText) embed.setFooter({ text: e.footerText });
  if (e.timestamp) embed.setTimestamp(new Date());
  return embed;
}

function pingText(ping: AnnouncementPing) {
  if (ping.type === "everyone") return "@everyone";
  if (ping.type === "here") return "@here";
  if (ping.type === "roles") return ping.roleIds.map((id) => `<@&${id}>`).join(" ");
  return "";
}

/** Only the chosen ping goes off. Mentions typed into the text show up but never ping. */
function payload(message: AnnouncementMessage, ping: AnnouncementPing, pinging: boolean) {
  const content = [pingText(ping), message.content.trim()].filter(Boolean).join("\n");
  return {
    content,
    embeds: message.useEmbed ? [toEmbed(message)] : [],
    allowedMentions: !pinging
      ? { parse: [] }
      : ping.type === "everyone" || ping.type === "here"
        ? { parse: ["everyone" as const] }
        : { parse: [], roles: ping.type === "roles" ? ping.roleIds : [] },
  };
}

/* ------------------------------------------------------------ checks */

/** Whether this ping needs the "Mention @everyone, @here and All Roles" permission. */
function needsMentionEveryone(guild: Guild, ping: AnnouncementPing) {
  if (ping.type === "everyone" || ping.type === "here") return true;
  if (ping.type === "roles") return ping.roleIds.some((id) => !guild.roles.cache.get(id)?.mentionable);
  return false;
}

/** What Number One is missing to post this in the channel, in plain words, or null. */
function botProblem(guild: Guild, channel: GuildBasedChannel | undefined, ping: AnnouncementPing): string | null {
  if (!channel || !TEXT_TYPES.has(channel.type)) return "The channel no longer exists.";
  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  const needed: [bigint, string][] = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  ];
  if (needsMentionEveryone(guild, ping)) needed.push([PermissionFlagsBits.MentionEveryone, "Mention @everyone, @here and All Roles"]);
  const missing = needed.filter(([flag]) => !perms?.has(flag)).map(([, name]) => name);
  return missing.length ? `In #${channel.name} I need: ${missing.join(", ")}.` : null;
}

/** Checks the channel, the ping and that the admin could post this themselves. */
async function checkSend(guild: Guild, userId: string, channelId: string, ping: AnnouncementPing) {
  const channel = guild.channels.cache.get(channelId);
  const problem = botProblem(guild, channel, ping);
  if (problem) throw new AnnouncementError(problem === "The channel no longer exists." ? "That channel no longer exists. Pick another one." : problem);
  checkPing(guild, ping);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new AnnouncementError("You're no longer a member of this server.");
  const theirs = channel!.permissionsFor(member);
  if (!theirs.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    throw new AnnouncementError(`You can't post in #${channel!.name} yourself, so I can't post there for you.`);
  }
  if (needsMentionEveryone(guild, ping) && !theirs.has(PermissionFlagsBits.MentionEveryone)) {
    throw new AnnouncementError(
      ping.type === "roles"
        ? "You don't have permission to ping one of those roles. Pick roles that can be mentioned, or ask an admin."
        : `You don't have permission to ping ${pingText(ping)} in #${channel!.name}.`,
    );
  }
}

function checkPing(guild: Guild, ping: AnnouncementPing) {
  if (ping.type !== "roles") return;
  if (!ping.roleIds.length) throw new AnnouncementError("Pick at least one role to ping, or choose another ping.");
  for (const id of ping.roleIds) {
    if (!guild.roles.cache.has(id) || id === guild.id) throw new AnnouncementError("One of the roles to ping no longer exists. Remove it and try again.");
  }
}

function checkMessage(m: AnnouncementMessage) {
  const problem = messageProblem(m);
  if (problem) throw new AnnouncementError(problem);
}

/* ------------------------------------------------------------ views */

const parseOr = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
};

const urlOf = (r: Row) => (r.messageId ? `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}` : null);

function toView(r: Row): AnnouncementView {
  return {
    id: r.id,
    channelId: r.channelId,
    message: parseOr(announcementMessage, r.message, announcementMessage.parse({})),
    ping: parseOr(announcementPing, r.ping, announcementPing.parse({})),
    publish: r.publish,
    status: r.status,
    scheduledAt: r.scheduledAt?.getTime() ?? null,
    sentAt: r.sentAt?.getTime() ?? null,
    error: r.error,
    createdByTag: r.createdByTag,
    createdAt: r.createdAt.getTime(),
    url: urlOf(r),
  };
}

function toTemplateView(t: TemplateRow): TemplateView {
  return {
    id: t.id,
    name: t.name,
    channelId: t.channelId,
    message: parseOr(announcementMessage, t.message, announcementMessage.parse({})),
    ping: parseOr(announcementPing, t.ping, announcementPing.parse({})),
    updatedAt: t.updatedAt.getTime(),
  };
}

async function overview(guildId: string): Promise<AnnouncementsResponse> {
  const [templates, scheduled, history] = await Promise.all([
    db.select().from(announcementTemplates).where(eq(announcementTemplates.guildId, guildId)).orderBy(asc(announcementTemplates.name)).all(),
    db
      .select()
      .from(announcements)
      .where(and(eq(announcements.guildId, guildId), eq(announcements.status, "scheduled")))
      .orderBy(asc(announcements.scheduledAt))
      .all(),
    db
      .select()
      .from(announcements)
      .where(and(eq(announcements.guildId, guildId), inArray(announcements.status, ["sent", "failed"])))
      .orderBy(desc(announcements.createdAt))
      .limit(HISTORY)
      .all(),
  ]);
  return { templates: templates.map(toTemplateView), announcements: [...scheduled, ...history].map(toView) };
}

const findRow = (guildId: string, id: number) =>
  db
    .select()
    .from(announcements)
    .where(and(eq(announcements.guildId, guildId), eq(announcements.id, id)))
    .get();

/* ------------------------------------------------------------ sending */

/** Sends a saved announcement and records the outcome. Never throws. */
async function deliver(row: Row): Promise<Row> {
  const guild = client.guilds.cache.get(row.guildId);
  const fail = async (error: string) => {
    log(`couldn't send #${row.id} in ${guild?.name ?? row.guildId}: ${error}`);
    const failed = { ...row, status: "failed" as const, error };
    await db.update(announcements).set({ status: "failed", error }).where(eq(announcements.id, row.id)).run();
    return failed;
  };
  if (!guild) return fail("Number One isn't in the server anymore.");
  if (!(await isFeatureEnabled(guild.id, announcementsFeature))) return fail("Announcements was turned off when this was due.");

  const message = parseOr(announcementMessage, row.message, null as unknown as AnnouncementMessage);
  const ping = parseOr(announcementPing, row.ping, announcementPing.parse({}));
  if (!message) return fail("The announcement couldn't be read. Write it again.");
  const channel = guild.channels.cache.get(row.channelId);
  const problem = botProblem(guild, channel, ping);
  if (problem) return fail(problem);

  try {
    const posted = await (channel as GuildTextBasedChannel).send(payload(message, ping, true));
    if (row.publish && channel!.type === ChannelType.GuildAnnouncement) {
      await posted.crosspost().catch((err: Error) => log(`couldn't publish #${row.id}:`, err.message));
    }
    const sent = { ...row, status: "sent" as const, messageId: posted.id, sentAt: new Date(), error: "" };
    await db.update(announcements).set({ status: "sent", messageId: posted.id, sentAt: sent.sentAt, error: "" }).where(eq(announcements.id, row.id)).run();
    return sent;
  } catch (err) {
    return fail(`Discord didn't accept it: ${(err as Error).message}`);
  }
}

let checking = false;

/** Sends scheduled announcements that are due. */
async function sendDue() {
  if (checking) return;
  checking = true;
  try {
    const due = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.status, "scheduled"), lte(announcements.scheduledAt, new Date())))
      .orderBy(asc(announcements.scheduledAt))
      .all();
    for (const row of due) await deliver(row);
  } catch (err) {
    log("checking scheduled announcements failed:", err);
  } finally {
    checking = false;
  }
}

/** When to send: null = now. Checks it's in range. */
function sendTime(scheduledAt: number | null): Date | null {
  if (!scheduledAt || scheduledAt <= Date.now() + 30_000) return null;
  if (scheduledAt > Date.now() + MAX_SCHEDULE_DAYS * 86_400_000) {
    throw new AnnouncementError(`Announcements can be scheduled up to ${MAX_SCHEDULE_DAYS} days ahead.`);
  }
  return new Date(scheduledAt);
}

async function create(guild: Guild, userId: string, input: AnnouncementInput): Promise<AnnouncementView> {
  checkMessage(input.message);
  await checkSend(guild, userId, input.channelId, input.ping);
  const at = sendTime(input.scheduledAt);
  if (at) {
    const waiting = (await db.select({ n: count() }).from(announcements).where(and(eq(announcements.guildId, guild.id), eq(announcements.status, "scheduled"))).get())?.n ?? 0;
    if (waiting >= MAX_SCHEDULED) throw new AnnouncementError(`You can have up to ${MAX_SCHEDULED} scheduled announcements. Send or delete one first.`);
  }
  const user = await client.users.fetch(userId).catch(() => null);
  const [row] = await db
    .insert(announcements)
    .values({
      guildId: guild.id,
      channelId: input.channelId,
      message: input.message,
      ping: input.ping,
      publish: input.publish,
      status: "scheduled",
      scheduledAt: at ?? new Date(),
      createdBy: userId,
      createdByTag: user?.tag ?? "Unknown",
      createdAt: new Date(),
    })
    .returning()
    .all();
  if (at) return toView(row);
  const sent = await deliver(row);
  if (sent.status === "failed") throw new AnnouncementError(sent.error);
  return toView(sent);
}

/**
 * Scheduled: everything can change (sending "now" sends it straight away).
 * Sent: only the text and embed can change. The ping isn't sent again.
 */
async function update(guild: Guild, userId: string, id: number, body: unknown): Promise<AnnouncementView> {
  const row = await findRow(guild.id, id);
  if (!row) throw new AnnouncementError("That announcement isn't saved anymore. Reload the page.");

  if (row.status === "sent") {
    const parsed = announcementEdit.safeParse(body);
    if (!parsed.success) throw new AnnouncementError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const { message } = parsed.data;
    checkMessage(message);
    const channel = guild.channels.cache.get(row.channelId);
    const posted = channel?.isTextBased() && row.messageId ? await channel.messages.fetch(row.messageId).catch(() => null) : null;
    if (!posted) throw new AnnouncementError("The announcement was deleted in Discord, so it can't be edited. Send a new one.");
    const ping = parseOr(announcementPing, row.ping, announcementPing.parse({}));
    await posted.edit(payload(message, ping, false)).catch((err: Error) => {
      throw new AnnouncementError(`Discord didn't accept the changes: ${err.message}`);
    });
    await db.update(announcements).set({ message }).where(eq(announcements.id, id)).run();
    return toView({ ...row, message });
  }

  const parsed = announcementInput.safeParse(body);
  if (!parsed.success) throw new AnnouncementError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const input = parsed.data;
  checkMessage(input.message);
  await checkSend(guild, userId, input.channelId, input.ping);
  const at = sendTime(input.scheduledAt);
  const changes = {
    channelId: input.channelId,
    message: input.message,
    ping: input.ping,
    publish: input.publish,
    status: "scheduled" as const,
    scheduledAt: at ?? new Date(),
    error: "",
  };
  await db.update(announcements).set(changes).where(eq(announcements.id, id)).run();
  const next = { ...row, ...changes };
  if (at) return toView(next);
  const sent = await deliver(next);
  if (sent.status === "failed") throw new AnnouncementError(sent.error);
  return toView(sent);
}

async function remove(guild: Guild, id: number) {
  const row = await findRow(guild.id, id);
  if (!row) return;
  if (row.messageId) {
    const channel = guild.channels.cache.get(row.channelId);
    if (channel?.isTextBased()) await channel.messages.delete(row.messageId).catch(() => {});
  }
  await db.delete(announcements).where(eq(announcements.id, id)).run();
}

/* ------------------------------------------------------------ templates */

function checkTemplate(guild: Guild, t: TemplateInput) {
  checkMessage(t.message);
  if (t.channelId && !TEXT_TYPES.has(guild.channels.cache.get(t.channelId)?.type as ChannelType)) {
    throw new AnnouncementError("The template's channel no longer exists. Pick another one.");
  }
  checkPing(guild, t.ping);
}

async function saveTemplate(guild: Guild, userId: string, t: TemplateInput, id?: number): Promise<TemplateView> {
  checkTemplate(guild, t);
  const now = new Date();
  if (id === undefined) {
    const total = (await db.select({ n: count() }).from(announcementTemplates).where(eq(announcementTemplates.guildId, guild.id)).get())?.n ?? 0;
    if (total >= MAX_TEMPLATES) throw new AnnouncementError(`You can have up to ${MAX_TEMPLATES} templates. Delete one first.`);
    const [row] = await db
      .insert(announcementTemplates)
      .values({ guildId: guild.id, name: t.name, channelId: t.channelId, message: t.message, ping: t.ping, createdBy: userId, createdAt: now, updatedAt: now })
      .returning()
      .all();
    return toTemplateView(row);
  }
  const [row] = await db
    .update(announcementTemplates)
    .set({ name: t.name, channelId: t.channelId, message: t.message, ping: t.ping, updatedAt: now })
    .where(and(eq(announcementTemplates.guildId, guild.id), eq(announcementTemplates.id, id)))
    .returning()
    .all();
  if (!row) throw new AnnouncementError("That template isn't saved anymore. Reload the page.");
  return toTemplateView(row);
}

/* ------------------------------------------------------------ feature */

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AnnouncementError) return reply.code(400).send({ error: err.message.replace(/\*\*/g, "") });
    throw err;
  }
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new AnnouncementError(issue ? `${issue.path.join(" → ")}: ${issue.message}` : "Check the form and try again.");
}

const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;
const idOf = (request: Req) => Number(request.params.id);

export const announcementsBot: BotFeature = {
  info: announcementsFeature,

  setup() {
    setInterval(() => void sendDue(), 30_000).unref();
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/announcements", async (request: Req) => overview(request.params.guildId));

    api.post("/api/guilds/:guildId/announcements", (request: Req, reply) =>
      guarded(reply, () => create(guildOf(request), request.session!.userId, parseBody(announcementInput, request.body))),
    );

    api.put("/api/guilds/:guildId/announcements/:id", (request: Req, reply) =>
      guarded(reply, () => update(guildOf(request), request.session!.userId, idOf(request), request.body)),
    );

    api.delete("/api/guilds/:guildId/announcements/:id", async (request: Req) => {
      await remove(guildOf(request), idOf(request));
      return { ok: true };
    });

    api.post("/api/guilds/:guildId/announcements/templates", (request: Req, reply) =>
      guarded(reply, () => saveTemplate(guildOf(request), request.session!.userId, parseBody(templateInput, request.body))),
    );

    api.put("/api/guilds/:guildId/announcements/templates/:id", (request: Req, reply) =>
      guarded(reply, () => saveTemplate(guildOf(request), request.session!.userId, parseBody(templateInput, request.body), idOf(request))),
    );

    api.delete("/api/guilds/:guildId/announcements/templates/:id", async (request: Req) => {
      await db
        .delete(announcementTemplates)
        .where(and(eq(announcementTemplates.guildId, request.params.guildId), eq(announcementTemplates.id, idOf(request))))
        .run();
      return { ok: true };
    });
  },
};
