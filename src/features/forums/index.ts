import {
  type AnyThreadChannel,
  ChannelFlags,
  ChannelType,
  Events,
  type ForumChannel,
  ForumLayoutType,
  type Guild,
  type GuildForumTagData,
  type GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  SnowflakeUtil,
  SortOrderType,
} from "discord.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type SlashCommand, onEvent } from "../../server/bot/types.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import { forumsFeature } from "../../shared/features.js";
import {
  type ForumAutomation,
  type ForumInput,
  type ForumPostView,
  type ForumSettings,
  type ForumView,
  type ForumsResponse,
  type PostAction,
  FORUM_LIMITS,
  defaultAutomation,
  forumAutomation,
  forumInput,
  postActions,
} from "../../shared/forums.js";

/**
 * Forums: manage the server's forum channels from the dashboard, plus three helpers per forum:
 * a welcome message in new posts, /post solved (adds a Solved tag and closes the post), and closing quiet posts.
 * Tags, guidelines, layout and posts live in Discord and are edited there directly; only the helpers are saved here.
 */

type Req = FastifyRequest<{ Params: { guildId: string; id?: string; postId?: string } }>;

class ForumError extends Error {}

const log = (...args: unknown[]) => console.warn("[forums]", ...args);
const DAY = 86_400_000;
const SOLVED_TAG = { name: "Solved", emoji: "✅" };

const stateOf = (guildId: string) => getFeatureState(guildId, forumsFeature);
const settingsOf = async (guildId: string) => (await stateOf(guildId)).settings as ForumSettings;
const automationOf = (s: ForumSettings, channelId: string) => s.forums.find((f) => f.channelId === channelId) ?? defaultAutomation(channelId);

async function saveAutomation(guildId: string, automation: ForumAutomation, by: string) {
  const state = await stateOf(guildId);
  const s = state.settings as ForumSettings;
  const forums = [...s.forums.filter((f) => f.channelId !== automation.channelId && client.guilds.cache.get(guildId)?.channels.cache.has(f.channelId)), automation].slice(
    -FORUM_LIMITS.forums,
  );
  await saveFeatureState(guildId, forumsFeature, { enabled: state.enabled, settings: { forums } }, by);
}

const forumsOf = (guild: Guild) =>
  [...guild.channels.cache.values()]
    .filter((c): c is ForumChannel => c.type === ChannelType.GuildForum)
    .sort((a, b) => a.rawPosition - b.rawPosition);

function forumIn(guild: Guild, id: string) {
  const forum = guild.channels.cache.get(id);
  if (!forum || forum.type !== ChannelType.GuildForum) throw new ForumError("That forum no longer exists. Reload the page.");
  return forum;
}

/* ------------------------------------------------------------ emojis */

/** "<:gem:123>" or "🎉" → what Discord's API takes. */
function emojiData(text: string) {
  const custom = text.match(/^<a?:(\w+):(\d+)>$/);
  if (custom) return { id: custom[2], name: null };
  return text ? { id: null, name: text } : null;
}

/** What Discord's API gives → "<:gem:123>" or "🎉" (custom emojis this server no longer has become ""). */
function emojiText(guild: Guild, e: { id: string | null; name: string | null } | null) {
  if (!e) return "";
  if (e.id) {
    const found = guild.emojis.cache.get(e.id);
    return found ? `<${found.animated ? "a" : ""}:${found.name}:${found.id}>` : "";
  }
  return e.name ?? "";
}

/* ------------------------------------------------------------ reading */

const lastActive = (t: AnyThreadChannel) => (t.lastMessageId ? SnowflakeUtil.timestampFrom(t.lastMessageId) : (t.createdTimestamp ?? Date.now()));
const postUrl = (t: AnyThreadChannel) => `https://discord.com/channels/${t.guildId}/${t.id}`;

function toInput(forum: ForumChannel): ForumInput {
  return {
    name: forum.name,
    parentId: forum.parentId,
    guidelines: forum.topic ?? "",
    tags: forum.availableTags.map((t) => ({ id: t.id, name: t.name, emoji: emojiText(forum.guild, t.emoji), moderated: t.moderated })),
    defaultReaction: emojiText(forum.guild, forum.defaultReactionEmoji ? { id: forum.defaultReactionEmoji.id, name: forum.defaultReactionEmoji.name } : null),
    sortOrder: forum.defaultSortOrder === SortOrderType.CreationDate ? "created" : "activity",
    layout: forum.defaultForumLayout === ForumLayoutType.GalleryView ? "gallery" : "list",
    requireTag: forum.flags.has(ChannelFlags.RequireTag),
    postSlowmode: forum.rateLimitPerUser ?? 0,
    autoArchiveMinutes: ([60, 1440, 4320, 10080] as const).find((m) => m === forum.defaultAutoArchiveDuration) ?? 10080,
  };
}

async function overview(guild: Guild): Promise<ForumsResponse> {
  const s = await settingsOf(guild.id);
  const active = await guild.channels.fetchActiveThreads().catch(() => null);
  const forums = forumsOf(guild);
  const closedBy = new Map<string, AnyThreadChannel[]>();
  await Promise.all(
    forums.map(async (f) => {
      const archived = await f.threads.fetchArchived({ limit: 10 }).catch(() => null);
      closedBy.set(f.id, archived ? [...archived.threads.values()] : []);
    }),
  );
  const all = [...(active?.threads.values() ?? []), ...[...closedBy.values()].flat()];
  const ownerIds = [...new Set(all.map((t) => t.ownerId).filter((id): id is string => Boolean(id)))];
  const members = ownerIds.length ? await guild.members.fetch({ user: ownerIds.slice(0, 100) }).catch(() => null) : null;
  const toPost = (t: AnyThreadChannel): ForumPostView => ({
    id: t.id,
    name: t.name,
    ownerName: (t.ownerId && members?.get(t.ownerId)?.displayName) || "Someone",
    tags: t.appliedTags,
    pinned: t.flags.has(ChannelFlags.Pinned),
    locked: Boolean(t.locked),
    closed: Boolean(t.archived),
    messages: t.messageCount ?? 0,
    lastActive: lastActive(t),
    url: postUrl(t),
  });

  const views: ForumView[] = forums.map((f) => {
    const open = [...(active?.threads.values() ?? [])].filter((t) => t.parentId === f.id);
    open.sort((a, b) => Number(b.flags.has(ChannelFlags.Pinned)) - Number(a.flags.has(ChannelFlags.Pinned)) || lastActive(b) - lastActive(a));
    return {
      ...toInput(f),
      id: f.id,
      url: `https://discord.com/channels/${guild.id}/${f.id}`,
      automation: automationOf(s, f.id),
      posts: [...open, ...(closedBy.get(f.id) ?? [])].map(toPost),
      openCount: open.length,
    };
  });

  const problems: string[] = [];
  if (!guild.features.includes("COMMUNITY")) problems.push("Forum channels need Community switched on. You can turn it on in Community tools.");
  const me = guild.members.me?.permissions;
  if (!me?.has(PermissionFlagsBits.ManageChannels)) problems.push("I need the Manage Channels permission to create and edit forums.");
  if (!me?.has(PermissionFlagsBits.ManageThreads)) problems.push("I need the Manage Threads permission to pin, lock, close and tag posts.");
  return { forums: views, problems };
}

/* ------------------------------------------------------------ editing forums */

function discordFields(guild: Guild, d: ForumInput) {
  if (d.parentId && guild.channels.cache.get(d.parentId)?.type !== ChannelType.GuildCategory) d.parentId = null;
  const tags: GuildForumTagData[] = d.tags.map((t) => ({ ...(t.id ? { id: t.id } : {}), name: t.name, moderated: t.moderated, emoji: emojiData(t.emoji) }));
  return {
    name: d.name,
    parent: d.parentId,
    topic: d.guidelines,
    availableTags: tags,
    defaultReactionEmoji: emojiData(d.defaultReaction),
    defaultSortOrder: d.sortOrder === "created" ? SortOrderType.CreationDate : SortOrderType.LatestActivity,
    defaultForumLayout: d.layout === "gallery" ? ForumLayoutType.GalleryView : ForumLayoutType.ListView,
    rateLimitPerUser: d.postSlowmode,
    defaultAutoArchiveDuration: d.autoArchiveMinutes,
  };
}

const failed = (what: string) => (err: Error) => {
  throw new ForumError(`Discord didn't accept the ${what}: ${err.message}`);
};

function checkCanEdit(guild: Guild) {
  if (!guild.features.includes("COMMUNITY")) throw new ForumError("Forum channels need Community switched on. You can turn it on in Community tools.");
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) throw new ForumError("I need the Manage Channels permission to create and edit forums.");
}

async function createForum(guild: Guild, d: ForumInput) {
  checkCanEdit(guild);
  const { parent, defaultReactionEmoji, ...fields } = discordFields(guild, d);
  const forum = await guild.channels
    .create({
      ...fields,
      ...(defaultReactionEmoji ? { defaultReactionEmoji } : {}),
      type: ChannelType.GuildForum,
      parent: parent ?? undefined,
      reason: "Created on the Number One dashboard",
    })
    .catch(failed("new forum"));
  if (d.requireTag) await forum.edit({ flags: ChannelFlags.RequireTag }).catch(() => {});
  return forum;
}

async function editForum(guild: Guild, id: string, d: ForumInput) {
  checkCanEdit(guild);
  const forum = forumIn(guild, id);
  const flags = d.requireTag ? forum.flags.bitfield | ChannelFlags.RequireTag : forum.flags.bitfield & ~ChannelFlags.RequireTag;
  await forum.edit({ ...discordFields(guild, d), flags, reason: "Edited on the Number One dashboard" }).catch(failed("forum changes"));
}

/** Finds the forum's Solved tag, or adds one. Returns its ID. Throws a ForumError if it can't be added. */
async function solvedTag(forum: ForumChannel, automation: ForumAutomation) {
  const existing =
    forum.availableTags.find((t) => t.id === automation.solved.tagId) ?? forum.availableTags.find((t) => t.name.toLowerCase() === SOLVED_TAG.name.toLowerCase());
  if (existing) return existing.id;
  if (forum.availableTags.length >= FORUM_LIMITS.tags) throw new ForumError(`#${forum.name} already has ${FORUM_LIMITS.tags} tags, so I can't add a Solved tag. Remove one first.`);
  if (!forum.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) throw new ForumError("I need the Manage Channels permission to add a Solved tag to the forum.");
  const updated = await forum
    .setAvailableTags([...forum.availableTags, { name: SOLVED_TAG.name, emoji: { id: null, name: SOLVED_TAG.emoji }, moderated: false }], "Solved tag for /post solved")
    .catch(failed("Solved tag"));
  return updated.availableTags.find((t) => t.name === SOLVED_TAG.name)!.id;
}

/* ------------------------------------------------------------ posts */

async function threadIn(guild: Guild, forumId: string, postId: string) {
  const thread = guild.channels.cache.get(postId) ?? (await guild.channels.fetch(postId).catch(() => null));
  if (!thread?.isThread() || thread.parentId !== forumId) throw new ForumError("That post no longer exists. Reload the page.");
  return thread;
}

async function postAction(thread: AnyThreadChannel, action: PostAction, by: string) {
  const reason = `${by} on the Number One dashboard`;
  if (!thread.guild.members.me?.permissions.has(PermissionFlagsBits.ManageThreads)) throw new ForumError("I need the Manage Threads permission to manage posts.");
  if (action === "reopen") return thread.setArchived(false, reason).catch(failed("change"));
  if (action === "close") return thread.setArchived(true, reason).catch(failed("change"));
  // Closed posts have to be reopened before anything else about them changes.
  const wasClosed = thread.archived;
  if (wasClosed) await thread.setArchived(false, reason).catch(failed("change"));
  try {
    if (action === "pin") await thread.pin(reason);
    else if (action === "unpin") await thread.unpin(reason);
    else await thread.setLocked(action === "lock", reason);
  } catch (err) {
    const msg = (err as Error).message;
    throw new ForumError(action === "pin" && /pin/i.test(msg) ? "Only one post per forum can be pinned. Unpin the other one first." : `Discord didn't accept the change: ${msg}`);
  } finally {
    if (wasClosed) await thread.setArchived(true, reason).catch(() => {});
  }
}

/* ------------------------------------------------------------ helpers in Discord */

/** A welcome message in every new post, when the forum has one switched on. */
const threadCreated = onEvent(Events.ThreadCreate, async (thread, newlyCreated) => {
  if (!newlyCreated || thread.parent?.type !== ChannelType.GuildForum || !thread.ownerId) return;
  if (!(await isFeatureEnabled(thread.guildId, forumsFeature))) return;
  const a = automationOf(await settingsOf(thread.guildId), thread.parentId!);
  if (!a.welcome.enabled || !a.welcome.message.trim()) return;
  await new Promise((r) => setTimeout(r, 1500)); // let the post's first message land first
  const hint = a.solved.enabled ? "\n-# When it's sorted, use `/post solved`." : "";
  await thread
    .send({ content: `${a.welcome.message.replaceAll("{user}", `<@${thread.ownerId}>`)}${hint}`.slice(0, 2000), allowedMentions: { users: [thread.ownerId] } })
    .catch((err: Error) => log(`couldn't welcome post ${thread.id} in ${thread.guild.name}:`, err.message));
});

const canManagePosts = (member: GuildMember, thread: AnyThreadChannel) => member.permissionsIn(thread).has(PermissionFlagsBits.ManageThreads);

const postCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("post")
    .setDescription("Manage the forum post you're in.")
    .setContexts(0)
    .addSubcommand((c) => c.setName("solved").setDescription("Mark this post as solved (adds the Solved tag)"))
    .addSubcommand((c) => c.setName("close").setDescription("Close this post. Anyone can reopen it by sending a message."))
    .addSubcommand((c) => c.setName("lock").setDescription("Lock this post so only staff can reply"))
    .addSubcommand((c) => c.setName("unlock").setDescription("Unlock this post"))
    .addSubcommand((c) => c.setName("pin").setDescription("Pin this post to the top of the forum"))
    .addSubcommand((c) => c.setName("unpin").setDescription("Unpin this post")),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const thread = interaction.channel;
    if (!thread?.isThread() || thread.parent?.type !== ChannelType.GuildForum) return interaction.reply("Use this inside a forum post.");
    const sub = interaction.options.getSubcommand();
    const staff = canManagePosts(interaction.member, thread);
    const owner = thread.ownerId === interaction.user.id;
    if (!staff && !(owner && (sub === "solved" || sub === "close"))) {
      return interaction.reply(sub === "solved" || sub === "close" ? "Only the person who made this post, or staff, can do that." : "Only staff with Manage Threads can do that.");
    }
    if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageThreads)) return interaction.reply("I need the Manage Threads permission to manage posts.");

    if (sub === "solved") {
      const a = automationOf(await settingsOf(interaction.guildId), thread.parentId!);
      if (!a.solved.enabled) return interaction.reply("/post solved is switched off in this forum.");
      try {
        const tagId = await solvedTag(thread.parent, a);
        if (tagId !== a.solved.tagId) await saveAutomation(interaction.guildId, { ...a, solved: { ...a.solved, tagId } }, interaction.user.id);
        if (!thread.appliedTags.includes(tagId)) {
          // Posts can have up to 5 tags: make room by dropping the last one.
          const tags = [...thread.appliedTags.slice(0, 4), tagId];
          await thread.setAppliedTags(tags, `Solved by ${interaction.user.tag}`);
        }
      } catch (err) {
        if (err instanceof ForumError) return interaction.reply(err.message);
        throw err;
      }
      await interaction.reply({ content: `✅ <@${interaction.user.id}> marked this post as solved.${a.solved.closeOnSolve ? " Closing it now." : ""}`, allowedMentions: { parse: [] } });
      if (a.solved.closeOnSolve) await thread.setArchived(true, `Solved by ${interaction.user.tag}`).catch(() => {});
      return;
    }
    if (sub === "close") {
      await interaction.reply({ content: `🔒 <@${interaction.user.id}> closed this post. Send a message to reopen it.`, allowedMentions: { parse: [] } });
      return thread.setArchived(true, `Closed by ${interaction.user.tag}`).catch(() => {});
    }
    try {
      await postAction(thread, sub as PostAction, interaction.user.tag);
    } catch (err) {
      if (err instanceof ForumError) return interaction.reply(err.message);
      throw err;
    }
    const done: Record<string, string> = { lock: "🔐 Locked. Only staff can reply now.", unlock: "🔓 Unlocked.", pin: "📌 Pinned to the top of the forum.", unpin: "Unpinned." };
    return interaction.reply(done[sub]);
  },
};

/** Closes posts that went quiet, in forums that switched that on. Runs every hour. */
let checking = false;
async function closeQuietPosts() {
  if (checking) return;
  checking = true;
  try {
    for (const guild of client.guilds.cache.values()) {
      const state = await stateOf(guild.id);
      const s = state.settings as ForumSettings;
      const due = s.forums.filter((f) => f.autoCloseDays > 0 && guild.channels.cache.get(f.channelId)?.type === ChannelType.GuildForum);
      if (!state.enabled || !due.length || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageThreads)) continue;
      const active = await guild.channels.fetchActiveThreads().catch(() => null);
      for (const thread of active?.threads.values() ?? []) {
        const a = due.find((f) => f.channelId === thread.parentId);
        if (!a || thread.flags.has(ChannelFlags.Pinned) || Date.now() - lastActive(thread) < a.autoCloseDays * DAY) continue;
        await thread
          .send({ content: `💤 Closing this post because it's been quiet for ${a.autoCloseDays} day${a.autoCloseDays === 1 ? "" : "s"}. Send a message to reopen it.` })
          .catch(() => {});
        await thread.setArchived(true, "Quiet for too long").catch((err: Error) => log(`couldn't close post ${thread.id}:`, err.message));
      }
    }
  } catch (err) {
    log("closing quiet posts failed:", err);
  } finally {
    checking = false;
  }
}

/* ------------------------------------------------------------ dashboard */

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ForumError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new ForumError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
}

export const forumsBot: BotFeature = {
  info: forumsFeature,
  commands: [postCommand],
  events: [threadCreated],

  setup() {
    setInterval(() => void closeQuietPosts(), 60 * 60_000).unref();
  },

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;

    api.get("/api/guilds/:guildId/forums", async (request: Req) => overview(guildOf(request)));

    api.post("/api/guilds/:guildId/forums", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        await createForum(guild, parse(forumInput, request.body));
        return overview(guild);
      }),
    );

    api.put("/api/guilds/:guildId/forums/:id", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        await editForum(guild, request.params.id!, parse(forumInput, request.body));
        return overview(guild);
      }),
    );

    api.put("/api/guilds/:guildId/forums/:id/automation", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const forum = forumIn(guild, request.params.id!);
        const a = parse(forumAutomation, { ...(request.body as object), channelId: forum.id });
        if (a.solved.enabled) a.solved.tagId = await solvedTag(forum, a);
        await saveAutomation(guild.id, a, request.session!.userId);
        return overview(guild);
      }),
    );

    api.post("/api/guilds/:guildId/forums/:id/posts/:postId", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const action = (request.body as { action?: string })?.action as PostAction;
        if (!postActions.includes(action)) throw new ForumError("That isn't something I can do to a post.");
        const user = await client.users.fetch(request.session!.userId).catch(() => null);
        await postAction(await threadIn(guild, request.params.id!, request.params.postId!), action, user?.tag ?? "Staff");
        return overview(guild);
      }),
    );

    api.delete("/api/guilds/:guildId/forums/:id/posts/:postId", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const thread = await threadIn(guild, request.params.id!, request.params.postId!);
        await thread.delete("Deleted on the Number One dashboard").catch(failed("deletion"));
        return overview(guild);
      }),
    );
  },
};
