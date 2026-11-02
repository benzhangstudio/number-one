import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  type GuildTextBasedChannel,
  type MessageComponentInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { and, asc, count, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type ComponentHandler, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { eventRsvps, events } from "../../server/db/schema.js";
import { isFeatureEnabled } from "../../server/settings.js";
import {
  EVENT_LIMITS,
  type EventInput,
  type EventView,
  type EventsResponse,
  MAX_DAYS_AHEAD,
  MAX_UPCOMING_EVENTS,
  type RsvpChoice,
  type RsvpView,
  eventInput,
  rsvpChoices,
} from "../../shared/events.js";
import { eventsFeature } from "../../shared/features.js";

/**
 * Events (like sesh.fyi): an event post with Going / Maybe / Can't go buttons and a live attendee list,
 * DM reminders before it starts, and an "ended" state afterwards. One click (or a tick when creating)
 * adds it to Discord's own Events tab, with the same name, time, place, description and cover image.
 */

type Row = typeof events.$inferSelect;
type Req = FastifyRequest<{ Params: { guildId: string; id?: string } }>;

/** A problem the admin can fix, shown as-is on the dashboard. */
class EventError extends Error {}

const log = (...args: unknown[]) => console.warn("[events]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const VOICE_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
const HOUR = 3_600_000;
const PREFIX = "ev";
const HISTORY = 20;

const t = (ms: number, style: string) => `<t:${Math.floor(ms / 1000)}:${style}>`;

/* ------------------------------------------------------------ reading rows */

function detailsOf(row: Row): EventInput {
  const parsed = eventInput.safeParse(row.details);
  if (parsed.success) return parsed.data;
  // Shouldn't happen; keep the event usable with what's certain.
  return eventInput.parse({ channelId: row.channelId, title: "Event", startAt: row.startAt.getTime() });
}

const findRow = (guildId: string, id: number) =>
  db
    .select()
    .from(events)
    .where(and(eq(events.guildId, guildId), eq(events.id, id)))
    .get();

const rsvpsOf = (eventId: number) => db.select().from(eventRsvps).where(eq(eventRsvps.eventId, eventId)).orderBy(asc(eventRsvps.answeredAt)).all();

function countsOf(rsvps: { choice: RsvpChoice }[]) {
  const counts = { going: 0, maybe: 0, no: 0 } as Record<RsvpChoice, number>;
  for (const r of rsvps) counts[r.choice]++;
  return counts;
}

const messageUrl = (r: Row) => (r.messageId ? `https://discord.com/channels/${r.guildId}/${r.channelId}/${r.messageId}` : null);
const discordEventUrl = (r: Row) => (r.discordEventId ? `https://discord.com/events/${r.guildId}/${r.discordEventId}` : null);

/** When an event counts as over: its end, or 2 hours after it starts. */
const endsAtFor = (d: EventInput) => new Date(d.endAt ?? d.startAt + 2 * HOUR);
/** When to send reminders, or null when there's none or it's already too late. */
function remindAtFor(d: EventInput) {
  if (!d.reminderMinutes) return null;
  const at = d.startAt - d.reminderMinutes * 60_000;
  return at > Date.now() ? new Date(at) : null;
}

/* ------------------------------------------------------------ the event post */

function pingText(d: EventInput) {
  if (d.ping.type === "everyone") return "@everyone";
  if (d.ping.type === "here") return "@here";
  if (d.ping.type === "roles") return d.ping.roleIds.map((id) => `<@&${id}>`).join(" ");
  return "";
}

function names(list: { userId: string }[], limit = 1000) {
  if (!list.length) return "Nobody yet";
  let text = "";
  for (let i = 0; i < list.length; i++) {
    const next = `${text ? ", " : ""}<@${list[i].userId}>`;
    const rest = list.length - i;
    if (text.length + next.length > limit - 12) return `${text} +${rest} more`;
    text += next;
  }
  return text;
}

function whereText(d: EventInput) {
  if (d.locationType === "voice" && d.voiceChannelId) return `<#${d.voiceChannelId}>`;
  return d.location || null;
}

function buildPost(row: Row, rsvps: { userId: string; choice: RsvpChoice }[], withPing: boolean) {
  const d = detailsOf(row);
  const by = (c: RsvpChoice) => rsvps.filter((r) => r.choice === c);
  const going = by("going");
  const cancelled = row.status === "cancelled";
  const ended = row.status === "ended";

  const when = d.endAt
    ? new Date(d.startAt).toDateString() === new Date(d.endAt).toDateString()
      ? `${t(d.startAt, "F")} – ${t(d.endAt, "t")}`
      : `${t(d.startAt, "F")} –\n${t(d.endAt, "F")}`
    : t(d.startAt, "F");
  const embed = new EmbedBuilder()
    .setColor(cancelled ? 0x8c8c99 : Number.parseInt(d.color.slice(1), 16))
    .setTitle(`${cancelled ? "❌ Cancelled: " : ended ? "Ended: " : "📅 "}${d.title}`.slice(0, 256))
    .addFields({ name: "🕒 When", value: ended || cancelled ? when : `${when}\n${t(d.startAt, "R")}` });
  if (d.description.trim()) embed.setDescription(d.description);
  const where = whereText(d);
  if (where) embed.addFields({ name: "📍 Where", value: where });
  embed.addFields(
    { name: `✅ Going (${going.length}${d.maxAttendees ? `/${d.maxAttendees}` : ""})`, value: names(going), inline: true },
    { name: `❔ Maybe (${by("maybe").length})`, value: names(by("maybe")), inline: true },
    { name: `❌ Can't go (${by("no").length})`, value: names(by("no")), inline: true },
  );
  if (d.image) embed.setImage(d.image);
  if (row.discordEventId && !cancelled && !ended) embed.addFields({ name: "📌 Also in Discord's Events tab", value: `[Open](${discordEventUrl(row)})` });
  embed.setFooter({
    text: cancelled ? "This event was cancelled." : ended ? "This event has ended." : "Times show in your own time zone. Press a button to answer.",
  });

  const components =
    cancelled || ended
      ? []
      : [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            rsvpChoices.map((c) =>
              new ButtonBuilder()
                .setCustomId(`${PREFIX}:${c.id}:${row.id}`)
                .setLabel(c.label)
                .setEmoji(c.emoji)
                .setStyle(c.id === "going" ? ButtonStyle.Success : c.id === "no" ? ButtonStyle.Danger : ButtonStyle.Secondary),
            ),
          ),
        ];

  const ping = withPing ? pingText(d) : "";
  return {
    content: ping,
    embeds: [embed],
    components,
    allowedMentions: !ping
      ? { parse: [] }
      : d.ping.type === "roles"
        ? { parse: [], roles: d.ping.roleIds }
        : { parse: ["everyone" as const] },
  };
}

/** Event messages are edited one at a time per event, so quick button presses don't overwrite each other. */
const locks = new Map<number, Promise<unknown>>();
function inOrder<T>(eventId: number, job: () => Promise<T>): Promise<T> {
  const run = (locks.get(eventId) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  locks.set(eventId, tail);
  void tail.finally(() => {
    if (locks.get(eventId) === tail) locks.delete(eventId);
  });
  return run;
}

/** Brings the posted message up to date. Posts it again (without the ping) if it was deleted. */
async function refreshPost(row: Row): Promise<Row> {
  const guild = client.guilds.cache.get(row.guildId);
  const channel = guild?.channels.cache.get(row.channelId);
  if (!channel?.isTextBased()) return row;
  const post = buildPost(row, await rsvpsOf(row.id), false);
  const message = row.messageId ? await channel.messages.fetch(row.messageId).catch(() => null) : null;
  if (message) {
    await message.edit(post).catch((err: Error) => log(`couldn't update event #${row.id}:`, err.message));
    return row;
  }
  if (row.status !== "upcoming") return row;
  const sent = await (channel as GuildTextBasedChannel).send(post).catch((err: Error) => (log(`couldn't repost event #${row.id}:`, err.message), null));
  if (!sent) return row;
  await db.update(events).set({ messageId: sent.id }).where(eq(events.id, row.id)).run();
  return { ...row, messageId: sent.id };
}

/* ------------------------------------------------------------ Discord's Events tab */

/** Whether someone can add events to Discord's Events tab. */
const canManageEvents = (perms: Readonly<{ has(flag: bigint): boolean }> | null | undefined) =>
  Boolean(perms?.has(PermissionFlagsBits.ManageEvents) || perms?.has(PermissionFlagsBits.CreateEvents));

/** The scheduled-event fields for an event, from what the admin filled in. */
function scheduledEventOptions(row: Row) {
  const d = detailsOf(row);
  const link = messageUrl(row);
  const footer = link ? `\n\nAnswer Going / Maybe / Can't go here: ${link}` : "";
  const description = (d.description.trim().slice(0, EVENT_LIMITS.discordDescription - footer.length) + footer).trim();
  const start = new Date(d.startAt);
  const end = new Date(d.endAt ?? d.startAt + HOUR);
  const guild = client.guilds.cache.get(row.guildId);
  const voice = d.locationType === "voice" && d.voiceChannelId ? guild?.channels.cache.get(d.voiceChannelId) : null;
  if (voice && VOICE_TYPES.has(voice.type)) {
    return {
      name: d.title,
      description,
      scheduledStartTime: start,
      scheduledEndTime: end,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: voice.type === ChannelType.GuildStageVoice ? GuildScheduledEventEntityType.StageInstance : GuildScheduledEventEntityType.Voice,
      channel: voice.id,
      image: d.image || null,
    } as const;
  }
  const channelName = guild?.channels.cache.get(row.channelId)?.name;
  return {
    name: d.title,
    description,
    scheduledStartTime: start,
    scheduledEndTime: end,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    // Discord needs a location for events outside voice channels.
    entityMetadata: { location: (d.location || (channelName ? `#${channelName}` : "Discord")).slice(0, EVENT_LIMITS.location) },
    image: d.image || null,
  } as const;
}

/** Adds the event to Discord's Events tab, or updates it there. Returns the updated row. Throws an EventError. */
async function syncDiscordEvent(row: Row): Promise<Row> {
  const guild = client.guilds.cache.get(row.guildId);
  if (!guild) return row;
  if (!canManageEvents(guild.members.me?.permissions)) {
    throw new EventError("To add events to Discord's Events tab I need the Manage Events permission.");
  }
  const options = scheduledEventOptions(row);
  const attempt = async (withImage: boolean) => {
    const opts = withImage ? options : { ...options, image: null };
    if (row.discordEventId) {
      const existing = await guild.scheduledEvents.fetch(row.discordEventId).catch(() => null);
      // Discord won't change the start time of an event that has already started.
      if (existing) return existing.status === GuildScheduledEventStatus.Active ? existing.edit({ ...opts, scheduledStartTime: undefined }) : existing.edit(opts);
    }
    return guild.scheduledEvents.create(opts);
  };
  try {
    const result = await attempt(true).catch((err: Error) => {
      // A broken cover image link shouldn't stop the whole thing.
      if (options.image && /image/i.test(err.message)) return attempt(false);
      throw err;
    });
    if (result.id !== row.discordEventId) {
      await db.update(events).set({ discordEventId: result.id }).where(eq(events.id, row.id)).run();
    }
    return { ...row, discordEventId: result.id };
  } catch (err) {
    throw new EventError(`Discord didn't accept the event for its Events tab: ${(err as Error).message}`);
  }
}

async function removeDiscordEvent(row: Row) {
  if (!row.discordEventId) return;
  const guild = client.guilds.cache.get(row.guildId);
  await guild?.scheduledEvents.delete(row.discordEventId).catch(() => {});
  await db.update(events).set({ discordEventId: null }).where(eq(events.id, row.id)).run();
}

/* ------------------------------------------------------------ checks */

async function checkInput(guild: Guild, userId: string, d: EventInput, existing?: Row) {
  const channel = guild.channels.cache.get(d.channelId);
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new EventError("The event channel no longer exists. Pick another one.");
  const me = guild.members.me;
  const mine = me ? channel.permissionsFor(me) : null;
  const needed: [bigint, string][] = [
    [PermissionFlagsBits.ViewChannel, "View Channel"],
    [PermissionFlagsBits.SendMessages, "Send Messages"],
    [PermissionFlagsBits.EmbedLinks, "Embed Links"],
  ];
  const pings = d.ping.type === "everyone" || d.ping.type === "here" || (d.ping.type === "roles" && d.ping.roleIds.some((id) => !guild.roles.cache.get(id)?.mentionable));
  if (pings && !existing) needed.push([PermissionFlagsBits.MentionEveryone, "Mention @everyone, @here and All Roles"]);
  const missing = needed.filter(([flag]) => !mine?.has(flag)).map(([, name]) => name);
  if (missing.length) throw new EventError(`In #${channel.name} I need: ${missing.join(", ")}.`);

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new EventError("You're no longer a member of this server.");
  const theirs = channel.permissionsFor(member);
  if (!theirs.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    throw new EventError(`You can't post in #${channel.name} yourself, so I can't post there for you.`);
  }
  if (!existing && pings && !theirs.has(PermissionFlagsBits.MentionEveryone)) throw new EventError("You don't have permission to use that ping.");
  if (d.ping.type === "roles") {
    if (!d.ping.roleIds.length) throw new EventError("Pick at least one role to ping, or choose another ping.");
    if (d.ping.roleIds.some((id) => !guild.roles.cache.has(id) || id === guild.id)) throw new EventError("One of the roles to ping no longer exists.");
  }
  if (d.addToDiscord && !canManageEvents(member.permissions)) {
    throw new EventError("You need the Manage Events (or Create Events) permission to add events to Discord's Events tab.");
  }

  const startChanged = !existing || existing.startAt.getTime() !== d.startAt;
  if (startChanged && d.startAt < Date.now() + 60_000) throw new EventError("The start time has already passed. Pick a time in the future.");
  if (d.startAt > Date.now() + MAX_DAYS_AHEAD * 86_400_000) throw new EventError(`Events can start up to ${MAX_DAYS_AHEAD} days ahead.`);
  if (d.endAt !== null && d.endAt <= d.startAt) throw new EventError("The event has to end after it starts.");
  if (d.endAt !== null && d.endAt - d.startAt > 30 * 86_400_000) throw new EventError("Events can last up to 30 days.");
  if (d.locationType === "voice") {
    const voice = d.voiceChannelId ? guild.channels.cache.get(d.voiceChannelId) : null;
    if (!voice || !VOICE_TYPES.has(voice.type)) throw new EventError("Pick the voice or stage channel where the event happens.");
  } else {
    d.voiceChannelId = null;
  }
}

/* ------------------------------------------------------------ actions */

async function toView(row: Row): Promise<EventView> {
  const d = detailsOf(row);
  return {
    ...d,
    id: row.id,
    status: row.status,
    url: messageUrl(row),
    discordEventUrl: discordEventUrl(row),
    counts: countsOf(await rsvpsOf(row.id)),
    createdByTag: row.createdByTag,
  };
}

async function overview(guild: Guild): Promise<EventsResponse> {
  const [upcoming, past] = await Promise.all([
    db.select().from(events).where(and(eq(events.guildId, guild.id), eq(events.status, "upcoming"))).orderBy(asc(events.startAt)).all(),
    db
      .select()
      .from(events)
      .where(and(eq(events.guildId, guild.id), inArray(events.status, ["ended", "cancelled"])))
      .orderBy(desc(events.startAt))
      .limit(HISTORY)
      .all(),
  ]);
  const problems: string[] = [];
  if (!canManageEvents(guild.members.me?.permissions)) {
    problems.push("To add events to Discord's Events tab I need the Manage Events permission.");
  }
  return { events: await Promise.all([...upcoming, ...past].map(toView)), problems };
}

/** Creates and posts an event. Returns it, plus a warning if adding it to Discord's Events tab didn't work. */
async function create(guild: Guild, userId: string, d: EventInput) {
  await checkInput(guild, userId, d);
  const upcoming = (await db.select({ n: count() }).from(events).where(and(eq(events.guildId, guild.id), eq(events.status, "upcoming"))).get())?.n ?? 0;
  if (upcoming >= MAX_UPCOMING_EVENTS) throw new EventError(`You can have up to ${MAX_UPCOMING_EVENTS} upcoming events. Delete or cancel one first.`);

  const user = await client.users.fetch(userId).catch(() => null);
  const [inserted] = await db
    .insert(events)
    .values({
      guildId: guild.id,
      channelId: d.channelId,
      details: d,
      startAt: new Date(d.startAt),
      endsAt: endsAtFor(d),
      remindAt: remindAtFor(d),
      createdBy: userId,
      createdByTag: user?.tag ?? "Unknown",
      createdAt: new Date(),
    })
    .returning()
    .all();

  const channel = guild.channels.cache.get(d.channelId) as GuildTextBasedChannel;
  const sent = await channel.send(buildPost(inserted, [], true)).catch(async (err: Error) => {
    await db.delete(events).where(eq(events.id, inserted.id)).run();
    throw new EventError(`Discord didn't accept the event post: ${err.message}`);
  });
  let row: Row = { ...inserted, messageId: sent.id };
  await db.update(events).set({ messageId: sent.id }).where(eq(events.id, row.id)).run();

  let warning: string | null = null;
  if (d.addToDiscord) {
    try {
      row = await syncDiscordEvent(row);
      row = await refreshPost(row); // adds the Events tab link to the post
    } catch (err) {
      warning = `The event was posted, but ${(err as Error).message.charAt(0).toLowerCase()}${(err as Error).message.slice(1)}`;
    }
  }
  return { event: await toView(row), warning };
}

async function update(guild: Guild, userId: string, id: number, d: EventInput) {
  const row = await findRow(guild.id, id);
  if (!row) throw new EventError("That event isn't saved anymore. Reload the page.");
  if (row.status !== "upcoming") throw new EventError("Ended and cancelled events can't be changed.");
  await checkInput(guild, userId, d, row);
  const before = detailsOf(row);

  const remindAt = before.startAt === d.startAt && before.reminderMinutes === d.reminderMinutes ? row.remindAt : remindAtFor(d);
  let next: Row = { ...row, channelId: d.channelId, details: d, startAt: new Date(d.startAt), endsAt: endsAtFor(d), remindAt };

  if (d.channelId !== row.channelId) {
    // Moved: post in the new channel (no ping again) and remove the old post.
    const old = guild.channels.cache.get(row.channelId);
    if (old?.isTextBased() && row.messageId) await old.messages.delete(row.messageId).catch(() => {});
    next = { ...next, messageId: null };
  }
  await db
    .update(events)
    .set({ channelId: next.channelId, details: d, startAt: next.startAt, endsAt: next.endsAt, remindAt, messageId: next.messageId })
    .where(eq(events.id, id))
    .run();
  next = await inOrder(id, () => refreshPost(next));

  let warning: string | null = null;
  if (next.discordEventId || d.addToDiscord) {
    try {
      const hadEvent = Boolean(next.discordEventId);
      next = await syncDiscordEvent(next);
      if (!hadEvent) next = await inOrder(id, () => refreshPost(next));
    } catch (err) {
      warning = `Saved, but ${(err as Error).message.charAt(0).toLowerCase()}${(err as Error).message.slice(1)}`;
    }
  }
  return { event: await toView(next), warning };
}

/** The "Add to Discord's Events tab" button. */
async function pushToDiscord(guild: Guild, userId: string, id: number) {
  const row = await findRow(guild.id, id);
  if (!row) throw new EventError("That event isn't saved anymore. Reload the page.");
  if (row.status !== "upcoming") throw new EventError("Only upcoming events can be added to Discord's Events tab.");
  if (row.startAt.getTime() < Date.now()) throw new EventError("This event has already started, so Discord won't add it to the Events tab.");
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!canManageEvents(member?.permissions)) {
    throw new EventError("You need the Manage Events (or Create Events) permission to add events to Discord's Events tab.");
  }
  const d = { ...detailsOf(row), addToDiscord: true };
  await db.update(events).set({ details: d }).where(eq(events.id, id)).run();
  let next = await syncDiscordEvent({ ...row, details: d });
  next = await inOrder(id, () => refreshPost(next));
  return { event: await toView(next), warning: null };
}

/** DMs everyone who's going or maybe going. */
async function dmAttendees(row: Row, title: string, text: string) {
  const guild = client.guilds.cache.get(row.guildId);
  if (!guild) return;
  const d = detailsOf(row);
  const people = (await rsvpsOf(row.id)).filter((r) => r.choice !== "no");
  const link = messageUrl(row);
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(d.color.slice(1), 16))
    .setTitle(title.slice(0, 256))
    .setDescription([text, whereText(d) ? `📍 ${whereText(d)}` : "", link ? `[See the event](${link})` : ""].filter(Boolean).join("\n"))
    .setFooter({ text: guild.name });
  for (const person of people) {
    const user = await client.users.fetch(person.userId).catch(() => null);
    // Members can block DMs; that's fine, there's nothing to do about it.
    await user?.send({ embeds: [embed] }).catch(() => {});
    await new Promise((r) => setTimeout(r, 300)); // go easy on Discord's limits
  }
}

async function cancel(guild: Guild, id: number) {
  const row = await findRow(guild.id, id);
  if (!row) throw new EventError("That event isn't saved anymore. Reload the page.");
  if (row.status !== "upcoming") throw new EventError("This event has already ended or been cancelled.");
  await db.update(events).set({ status: "cancelled", remindAt: null }).where(eq(events.id, id)).run();
  let next: Row = { ...row, status: "cancelled", remindAt: null };
  await removeDiscordEvent(next);
  next = { ...next, discordEventId: null };
  next = await inOrder(id, () => refreshPost(next));
  const d = detailsOf(row);
  void dmAttendees(next, `❌ Cancelled: ${d.title}`, `This event on ${t(d.startAt, "F")} has been cancelled.`);
  return { event: await toView(next), warning: null };
}

async function remove(guild: Guild, id: number) {
  const row = await findRow(guild.id, id);
  if (!row) return;
  const channel = guild.channels.cache.get(row.channelId);
  if (channel?.isTextBased() && row.messageId) await channel.messages.delete(row.messageId).catch(() => {});
  if (row.status === "upcoming") await removeDiscordEvent(row);
  await db.delete(eventRsvps).where(eq(eventRsvps.eventId, id)).run();
  await db.delete(events).where(eq(events.id, id)).run();
}

async function attendees(guild: Guild, id: number): Promise<RsvpView[]> {
  const row = await findRow(guild.id, id);
  if (!row) return [];
  const list = await rsvpsOf(id);
  const members = await guild.members.fetch({ user: list.map((r) => r.userId) }).catch(() => null);
  return list.map((r) => {
    const m = members?.get(r.userId);
    return { userId: r.userId, name: m?.displayName ?? m?.user.username ?? "Left the server", choice: r.choice };
  });
}

/* ------------------------------------------------------------ buttons */

const rsvpButtons: ComponentHandler = {
  prefix: PREFIX,
  async handle(interaction: MessageComponentInteraction) {
    if (!interaction.inCachedGuild() || !interaction.isButton()) return;
    const [, choice, idText] = interaction.customId.split(":");
    const id = Number(idText);
    if (!rsvpChoices.some((c) => c.id === choice) || !Number.isInteger(id)) return;
    // Answering is a member's own action, like a role menu click, so these notes are just for them.
    const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (!(await isFeatureEnabled(interaction.guildId, eventsFeature))) return privately("Events are turned off in this server right now.");
    const row = await findRow(interaction.guildId, id);
    if (!row) return privately("This event isn't available anymore.");
    if (row.status !== "upcoming") return privately(row.status === "cancelled" ? "This event was cancelled." : "This event has ended.");

    return inOrder(id, async () => {
      const userId = interaction.user.id;
      const list = await rsvpsOf(id);
      const current = list.find((r) => r.userId === userId)?.choice ?? null;
      const d = detailsOf(row);
      if (choice === "going" && current !== "going" && d.maxAttendees && list.filter((r) => r.choice === "going").length >= d.maxAttendees) {
        return privately(`This event is full (${d.maxAttendees} going). You can pick Maybe in case a spot opens up.`);
      }
      if (current === choice) {
        // Pressing your current answer again takes it back.
        await db.delete(eventRsvps).where(and(eq(eventRsvps.eventId, id), eq(eventRsvps.userId, userId))).run();
      } else {
        const values = { eventId: id, guildId: row.guildId, userId, choice: choice as RsvpChoice, answeredAt: new Date() };
        await db
          .insert(eventRsvps)
          .values(values)
          .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.userId], set: { choice: values.choice, answeredAt: values.answeredAt } })
          .run();
      }
      return interaction.update(buildPost(row, await rsvpsOf(id), false));
    });
  },
};

/* ------------------------------------------------------------ reminders, start and end */

/** Discord events Number One has already switched to "happening now" since it started. */
const startedInDiscord = new Set<string>();
let ticking = false;

export async function checkEvents() {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();

    for (const row of await db.select().from(events).where(and(eq(events.status, "upcoming"), lte(events.remindAt, now))).all()) {
      await db.update(events).set({ remindAt: null }).where(eq(events.id, row.id)).run();
      const d = detailsOf(row);
      await dmAttendees(row, `⏰ Reminder: ${d.title}`, `Starts ${t(d.startAt, "R")} (${t(d.startAt, "F")}).`);
    }

    // Show the event as happening now in Discord's Events tab once it starts.
    const live = await db
      .select()
      .from(events)
      .where(and(eq(events.status, "upcoming"), lte(events.startAt, now), isNotNull(events.discordEventId)))
      .all();
    for (const row of live) {
      if (startedInDiscord.has(row.discordEventId!)) continue;
      startedInDiscord.add(row.discordEventId!);
      const guild = client.guilds.cache.get(row.guildId);
      const ev = await guild?.scheduledEvents.fetch(row.discordEventId!).catch(() => null);
      if (ev?.status === GuildScheduledEventStatus.Scheduled && ev.entityType === GuildScheduledEventEntityType.External) {
        await ev.setStatus(GuildScheduledEventStatus.Active).catch(() => {});
      }
    }

    for (const row of await db.select().from(events).where(and(eq(events.status, "upcoming"), lte(events.endsAt, now))).all()) {
      await db.update(events).set({ status: "ended", remindAt: null }).where(eq(events.id, row.id)).run();
      const ended: Row = { ...row, status: "ended" };
      await inOrder(row.id, () => refreshPost(ended));
      if (row.discordEventId) {
        const guild = client.guilds.cache.get(row.guildId);
        const ev = await guild?.scheduledEvents.fetch(row.discordEventId).catch(() => null);
        if (ev?.status === GuildScheduledEventStatus.Active) await ev.setStatus(GuildScheduledEventStatus.Completed).catch(() => {});
        startedInDiscord.delete(row.discordEventId);
      }
    }
  } catch (err) {
    log("checking events failed:", err);
  } finally {
    ticking = false;
  }
}

/** The event post was deleted in Discord: forget it, so saving the event posts it again. */
const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (message.guildId) await db.update(events).set({ messageId: null }).where(eq(events.messageId, message.id)).run();
});

/* ------------------------------------------------------------ feature */

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof EventError) return reply.code(400).send({ error: err.message.replace(/\*\*/g, "") });
    throw err;
  }
}

function parseInput(body: unknown): EventInput {
  const parsed = eventInput.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new EventError(issue ? `${issue.path.join(" → ")}: ${issue.message}` : "Check the form and try again.");
}

const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;
const idOf = (request: Req) => Number(request.params.id);

export const eventsBot: BotFeature = {
  info: eventsFeature,
  components: [rsvpButtons],
  events: [messageDeleted],

  setup() {
    setInterval(() => void checkEvents(), 30_000).unref();
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/events", async (request: Req) => overview(guildOf(request)));
    api.get("/api/guilds/:guildId/events/:id/rsvps", async (request: Req) => attendees(guildOf(request), idOf(request)));
    api.post("/api/guilds/:guildId/events", (request: Req, reply) =>
      guarded(reply, () => create(guildOf(request), request.session!.userId, parseInput(request.body))),
    );
    api.put("/api/guilds/:guildId/events/:id", (request: Req, reply) =>
      guarded(reply, () => update(guildOf(request), request.session!.userId, idOf(request), parseInput(request.body))),
    );
    api.post("/api/guilds/:guildId/events/:id/discord", (request: Req, reply) =>
      guarded(reply, () => pushToDiscord(guildOf(request), request.session!.userId, idOf(request))),
    );
    api.post("/api/guilds/:guildId/events/:id/cancel", (request: Req, reply) => guarded(reply, () => cancel(guildOf(request), idOf(request))));
    api.delete("/api/guilds/:guildId/events/:id", async (request: Req) => {
      await remove(guildOf(request), idOf(request));
      return { ok: true };
    });
  },
};
