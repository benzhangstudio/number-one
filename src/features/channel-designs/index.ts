import { Events, type Guild, type GuildBasedChannel, type NonThreadGuildBasedChannel, PermissionFlagsBits } from "discord.js";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { channelDesigns } from "../../server/db/schema.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import {
  type ChannelDesignSettings,
  type ChannelDesignsResponse,
  type CleanupSettings,
  type DesignChannel,
  type DesignJob,
  channelDesignSettings,
  cleanupSettings,
  decorate,
  designTemplates,
  includes,
  kindOf,
  plainName,
} from "../../shared/channelDesigns.js";
import { channelDesignsFeature } from "../../shared/features.js";

/**
 * Channel designs: adds a decoration around channel names ("general" → "💬・general").
 * Only the name gets the decoration; nothing else about the channel changes. The channel's own name
 * is saved, so switching to another design or removing it puts the name back exactly.
 * If someone renames a channel by hand afterwards, that new name becomes its own name.
 */

type Row = typeof channelDesigns.$inferSelect;
type Req = FastifyRequest<{ Params: { guildId: string } }>;

const log = (...args: unknown[]) => console.warn("[channel-designs]", ...args);
const REASON = "Number One: channel design";

/* ------------------------------------------------------------ saved names */

async function savedNames(guildId: string): Promise<Map<string, Row>> {
  const rows = await db.select().from(channelDesigns).where(eq(channelDesigns.guildId, guildId)).all();
  return new Map(rows.map((r) => [r.channelId, r]));
}

/** The channel's own name: what it was before the design, unless someone renamed it since. */
function baseNameOf(channel: GuildBasedChannel, saved: Map<string, Row>) {
  const row = saved.get(channel.id);
  return row && channel.name === row.appliedName ? row.baseName : channel.name;
}

const isSkipped = (s: ChannelDesignSettings, channel: GuildBasedChannel) =>
  s.skippedChannelIds.includes(channel.id) || Boolean(channel.parentId && s.skippedChannelIds.includes(channel.parentId));

/** Channels designs can apply to (text, announcement, voice and stage), in the order Discord shows them. */
function designable(guild: Guild): NonThreadGuildBasedChannel[] {
  return [...guild.channels.cache.values()]
    .filter((c): c is NonThreadGuildBasedChannel => !c.isThread() && kindOf(c.type) !== null)
    .sort((a, b) => ("rawPosition" in a ? a.rawPosition : 0) - ("rawPosition" in b ? b.rawPosition : 0));
}

/** The name a channel should have under these settings. */
function targetName(channel: GuildBasedChannel, base: string, s: ChannelDesignSettings): string | null {
  const template = designTemplates.find((t) => t.id === s.templateId);
  if (!template || !includes(s, channel.type) || isSkipped(s, channel)) return base;
  return decorate(base, template);
}

/* ------------------------------------------------------------ renaming */

/** Renames one channel to match the settings. Returns why it was skipped, or null when it's done. */
async function applyTo(channel: NonThreadGuildBasedChannel, s: ChannelDesignSettings, saved: Map<string, Row>): Promise<string | null> {
  const base = baseNameOf(channel, saved);
  const target = targetName(channel, base, s);
  if (target === null) return "The name would be too long with this design.";
  const plain = target === base;
  if (channel.name === target) {
    if (plain) await db.delete(channelDesigns).where(eq(channelDesigns.channelId, channel.id)).run();
    else if (!saved.has(channel.id) || saved.get(channel.id)!.baseName !== base) await remember(channel, base, channel.name);
    return null;
  }
  if (!channel.manageable) return "I can't edit this channel. Give me Manage Channels there.";
  try {
    const renamed = await channel.setName(target, REASON);
    // Discord tidies names (lowercase, no spaces in text channels), so keep what it actually saved.
    if (plain) await db.delete(channelDesigns).where(eq(channelDesigns.channelId, channel.id)).run();
    else await remember(channel, base, renamed.name);
    return null;
  } catch (err) {
    return `Discord didn't accept the new name: ${(err as Error).message}`;
  }
}

async function remember(channel: GuildBasedChannel, baseName: string, appliedName: string) {
  const values = { channelId: channel.id, guildId: channel.guildId, baseName, appliedName };
  await db.insert(channelDesigns).values(values).onConflictDoUpdate({ target: channelDesigns.channelId, set: { baseName, appliedName } }).run();
}

/** Progress of the latest apply/remove per server (memory only). */
const jobs = new Map<string, DesignJob>();

/** Brings every channel in line with the settings, one at a time, in the background. */
function runJob(guild: Guild, s: ChannelDesignSettings, action: DesignJob["action"]) {
  const job: DesignJob = { phase: "running", action, done: 0, total: 0, skipped: [] };
  jobs.set(guild.id, job);
  const run = async () => {
    const saved = await savedNames(guild.id);
    // Every channel the design is on now or should be on, so un-ticked kinds and skipped channels go back too.
    const channels = designable(guild).filter((c) => saved.has(c.id) || (s.templateId && includes(s, c.type) && !isSkipped(s, c)));
    job.total = channels.length;
    for (const channel of channels) {
      const problem = await applyTo(channel, s, saved);
      if (problem) job.skipped.push({ name: channel.name, reason: problem });
      job.done++;
    }
    job.phase = "done";
    console.log(`[channel-designs] ${action} finished in ${guild.name} (${guild.id}): ${job.done - job.skipped.length}/${job.total} channels`);
  };
  return run().catch((err) => {
    log(`${action} failed in ${guild.name} (${guild.id}):`, err);
    job.phase = "failed";
    job.error = "Something went wrong part way through. Try again; channels already done are kept.";
  });
}

/**
 * "Make names text-only": takes every emoji and decoration out of channel names, whoever added them
 * (Number One, another bot or someone by hand), so a new design starts from clean names.
 * The cleaned name becomes each channel's own name, and no design is on afterwards.
 */
function runCleanJob(guild: Guild, c: CleanupSettings) {
  const job: DesignJob = { phase: "running", action: "clean", done: 0, total: 0, skipped: [] };
  jobs.set(guild.id, job);
  const skipped = (ch: GuildBasedChannel) => c.skippedChannelIds.includes(ch.id) || Boolean(ch.parentId && c.skippedChannelIds.includes(ch.parentId));
  const run = async () => {
    const channels = designable(guild).filter((ch) => includes(c, ch.type) && !skipped(ch));
    job.total = channels.length;
    for (const channel of channels) {
      const plain = plainName(channel.name);
      let problem: string | null = null;
      if (!plain) problem = "The name is only emojis, so there'd be nothing left. Rename it by hand.";
      else if (plain !== channel.name) {
        if (!channel.manageable) problem = "I can't edit this channel. Give me Manage Channels there.";
        else await channel.setName(plain, `${REASON} (text-only names)`).catch((err: Error) => (problem = `Discord didn't accept the new name: ${err.message}`));
      }
      // Its name is plain now, so there's no design to remember for it.
      if (!problem) await db.delete(channelDesigns).where(eq(channelDesigns.channelId, channel.id)).run();
      if (problem) job.skipped.push({ name: channel.name, reason: problem });
      job.done++;
    }
    job.phase = "done";
    console.log(`[channel-designs] clean finished in ${guild.name} (${guild.id}): ${job.done - job.skipped.length}/${job.total} channels`);
  };
  return run().catch((err) => {
    log(`clean failed in ${guild.name} (${guild.id}):`, err);
    job.phase = "failed";
    job.error = "Something went wrong part way through. Try again; channels already done are kept.";
  });
}

/* ------------------------------------------------------------ events */

/** New channels get the design too, when the server turned that on. */
const channelCreated = onEvent(Events.ChannelCreate, async (channel) => {
  if (channel.isThread() || kindOf(channel.type) === null) return;
  const state = await getFeatureState(channel.guildId, channelDesignsFeature);
  const s = state.settings as ChannelDesignSettings;
  if (!state.enabled || !s.decorateNew || !s.templateId || jobs.get(channel.guildId)?.phase === "running") return;
  const problem = await applyTo(channel, s, new Map());
  if (problem) log(`couldn't design new channel #${channel.name} in ${channel.guild.name}: ${problem}`);
});

const channelDeleted = onEvent(Events.ChannelDelete, async (channel) => {
  if (!channel.isDMBased()) await db.delete(channelDesigns).where(eq(channelDesigns.channelId, channel.id)).run();
});

/* ------------------------------------------------------------ dashboard */

async function respond(guild: Guild): Promise<ChannelDesignsResponse> {
  const state = await getFeatureState(guild.id, channelDesignsFeature);
  const saved = await savedNames(guild.id);
  const channels: DesignChannel[] = designable(guild).map((c) => ({
    id: c.id,
    type: c.type,
    parentId: c.parentId,
    baseName: baseNameOf(c, saved),
    currentName: c.name,
  }));
  const problems: string[] = [];
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    problems.push("I need the Manage Channels permission to change channel names.");
  }
  return { settings: state.settings as ChannelDesignSettings, channels, job: jobs.get(guild.id) ?? null, problems };
}

export const channelDesignsBot: BotFeature = {
  info: channelDesignsFeature,
  events: [channelCreated, channelDeleted],

  async beforeDataDelete(guildId) {
    // The saved names are about to be deleted, so put every channel's own name back first.
    const guild = client.guilds.cache.get(guildId);
    if (guild) await runJob(guild, channelDesignSettings.parse({}), "remove");
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/channel-designs", async (request: Req) => respond(client.guilds.cache.get(request.params.guildId)!));

    /** Makes the chosen channels' names text-only and switches the design off (see runCleanJob). */
    api.post("/api/guilds/:guildId/channel-designs/clean", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = cleanupSettings.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      const c = parsed.data;
      if (jobs.get(guild.id)?.phase === "running") return reply.code(409).send({ error: "I'm still changing channel names. Wait for that to finish." });
      if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return reply.code(400).send({ error: "I need the Manage Channels permission to change channel names." });
      }
      const member = await guild.members.fetch(request.session!.userId).catch(() => null);
      if (!member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return reply.code(403).send({ error: "You need the Manage Channels permission to change channel names." });
      }
      c.skippedChannelIds = c.skippedChannelIds.filter((id) => guild.channels.cache.has(id));
      const state = await getFeatureState(guild.id, channelDesignsFeature);
      const settings = { ...(state.settings as ChannelDesignSettings), templateId: null, cleanup: c };
      await saveFeatureState(guild.id, channelDesignsFeature, { enabled: state.enabled, settings }, request.session!.userId);
      void runCleanJob(guild, c);
      return respond(guild);
    });

    /** Saves the design and options, then renames channels to match. A null design removes it. */
    api.post("/api/guilds/:guildId/channel-designs/apply", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = channelDesignSettings.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      const s = parsed.data;
      if (s.templateId && !designTemplates.some((t) => t.id === s.templateId)) return reply.code(400).send({ error: "That design doesn't exist. Reload the page." });
      if (jobs.get(guild.id)?.phase === "running") return reply.code(409).send({ error: "I'm still changing channel names. Wait for that to finish." });
      if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return reply.code(400).send({ error: "I need the Manage Channels permission to change channel names." });
      }
      const member = await guild.members.fetch(request.session!.userId).catch(() => null);
      if (!member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return reply.code(403).send({ error: "You need the Manage Channels permission to change channel names." });
      }
      s.skippedChannelIds = s.skippedChannelIds.filter((id) => guild.channels.cache.has(id));
      const state = await getFeatureState(guild.id, channelDesignsFeature);
      const previous = state.settings as ChannelDesignSettings;
      await saveFeatureState(guild.id, channelDesignsFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
      void runJob(guild, s, s.templateId || !previous.templateId ? "apply" : "remove");
      return respond(guild);
    });
  },
};
