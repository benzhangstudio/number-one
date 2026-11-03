import {
  AttachmentBuilder,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { and, count, desc, eq, gt } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type SlashCommand, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { memberLevels } from "../../server/db/schema.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import { levelsFeature } from "../../shared/features.js";
import {
  type LeaderboardEntry,
  type LevelsResponse,
  type LevelsSettings,
  MAX_XP_CHANGE,
  levelInfo,
  levelsSettings,
} from "../../shared/levels.js";
import { renderRankCard } from "./card.js";

/**
 * Levels: members earn XP for chatting (at most once per cooldown), level up, and get reward roles.
 * XP is stored per server in member_levels and kept when members leave.
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;

const PINK = 0xff4fa3;
const PAGE_SIZE = 10;
const log = (...args: unknown[]) => console.warn("[levels]", ...args);

/** Last time each member earned XP ("guildId:userId" → ms). In memory: a restart just resets cooldowns. */
const lastXp = new Map<string, number>();

async function getActiveSettings(guildId: string): Promise<LevelsSettings | null> {
  const state = await getFeatureState(guildId, levelsFeature);
  return state.enabled ? (state.settings as LevelsSettings) : null;
}

/* ------------------------------------------------------------ store */

const getRow = (guildId: string, userId: string) =>
  db.select().from(memberLevels).where(and(eq(memberLevels.guildId, guildId), eq(memberLevels.userId, userId))).get();

/** Sets a member's XP (never below 0) and returns the old and new totals. */
async function setXp(guildId: string, userId: string, change: (old: number) => number, addMessage = false) {
  const row = await getRow(guildId, userId);
  const before = row?.xp ?? 0;
  const after = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(change(before))));
  const messages = (row?.messages ?? 0) + (addMessage ? 1 : 0);
  await db
    .insert(memberLevels)
    .values({ guildId, userId, xp: after, messages, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [memberLevels.guildId, memberLevels.userId], set: { xp: after, messages, updatedAt: new Date() } })
    .run();
  return { before, after };
}

/** 1 = top of the leaderboard. Members tied on XP share a rank. */
async function rankOf(guildId: string, xp: number) {
  const ahead = await db.select({ n: count() }).from(memberLevels).where(and(eq(memberLevels.guildId, guildId), gt(memberLevels.xp, xp))).get();
  return (ahead?.n ?? 0) + 1;
}

async function rankedCount(guildId: string) {
  const row = await db.select({ n: count() }).from(memberLevels).where(and(eq(memberLevels.guildId, guildId), gt(memberLevels.xp, 0))).get();
  return row?.n ?? 0;
}

const topRows = (guildId: string, limit: number, offset = 0) =>
  db
    .select()
    .from(memberLevels)
    .where(and(eq(memberLevels.guildId, guildId), gt(memberLevels.xp, 0)))
    .orderBy(desc(memberLevels.xp), memberLevels.userId)
    .limit(limit)
    .offset(offset)
    .all();

/* ------------------------------------------------------------ reward roles */

/** Whether Number One can give and take a role (it must sit below Number One's highest role). */
const canManage = (guild: Guild, roleId: string) => {
  const role = guild.roles.cache.get(roleId);
  return Boolean(role && !role.managed && role.id !== guild.id && role.editable);
};

/**
 * Gives the reward roles for a member's level.
 * - keepOldRewards on: every reward up to their level. Off: only the highest one(s), lower ones are taken away.
 * - `full`: also takes away rewards above their level (used after an admin lowers someone's XP).
 *   Normal level-ups don't, so a reward role staff handed out by hand isn't taken away.
 */
async function syncRewards(member: GuildMember, level: number, settings: LevelsSettings, full = false) {
  const { guild } = member;
  if (!settings.rewards.length || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;
  const earned = settings.rewards.filter((r) => r.level <= level);
  const top = Math.max(0, ...earned.map((r) => r.level));
  const wanted = new Set((settings.keepOldRewards ? earned : earned.filter((r) => r.level === top)).map((r) => r.roleId));
  const unwanted = new Set(
    settings.rewards
      .filter((r) => !wanted.has(r.roleId) && (r.level <= level ? !settings.keepOldRewards : full))
      .map((r) => r.roleId),
  );
  const add = [...wanted].filter((id) => !member.roles.cache.has(id) && canManage(guild, id));
  const remove = [...unwanted].filter((id) => member.roles.cache.has(id) && canManage(guild, id));
  if (add.length) await member.roles.add(add, `Levels: reached level ${level}`).catch((err) => log(`couldn't add roles in ${guild.id}:`, err.message));
  if (remove.length) await member.roles.remove(remove, `Levels: now level ${level}`).catch((err) => log(`couldn't remove roles in ${guild.id}:`, err.message));
}

/* ------------------------------------------------------------ earning XP */

/** Fills in {user}, {username}, {level} and {server}. */
const fill = (text: string, member: GuildMember, level: number) =>
  text
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", member.displayName)
    .replaceAll("{level}", String(level))
    .replaceAll("{server}", member.guild.name);

function canPost(channel: GuildTextBasedChannel | null | undefined): channel is GuildTextBasedChannel {
  const me = channel?.guild.members.me;
  return Boolean(channel && me && channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]));
}

async function announceLevelUp(message: Message<true>, member: GuildMember, level: number, settings: LevelsSettings) {
  const { where, channelId } = settings.levelUp;
  const text = fill(settings.levelUp.message, member, level).trim();
  if (where === "off" || !text) return;
  const payload = { content: text.slice(0, 2000), allowedMentions: { users: [member.id] } };
  if (where === "dm") return member.send({ ...payload, content: `${text} (in **${member.guild.name}**)`.slice(0, 2000) }).catch(() => {});
  const channel = where === "channel" && channelId ? member.guild.channels.cache.get(channelId) : message.channel;
  if (channel?.isTextBased() && canPost(channel as GuildTextBasedChannel)) await (channel as GuildTextBasedChannel).send(payload).catch(() => {});
}

/** Whether chatting here gives XP: not in an excluded channel, its parent channel or its category. */
function channelAllowed(message: Message<true>, settings: LevelsSettings) {
  if (!settings.noXpChannelIds.length) return true;
  const ch = message.channel;
  const parent = ch.isThread() ? ch.parent : null;
  const ids = [ch.id, "parentId" in ch ? ch.parentId : null, parent?.parentId];
  return !ids.some((id) => id && settings.noXpChannelIds.includes(id));
}

const messageSent = onEvent(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
  const key = `${message.guildId}:${message.author.id}`;
  const last = lastXp.get(key) ?? 0;
  // Cheap check first, so most messages never touch the database. The real cooldown is checked below.
  if (Date.now() - last < 1000) return;

  const settings = await getActiveSettings(message.guildId);
  if (!settings || Date.now() - last < settings.cooldownSeconds * 1000) return;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || !channelAllowed(message, settings)) return;
  if (settings.noXpRoleIds.some((id) => member.roles.cache.has(id))) return;

  lastXp.set(key, Date.now());
  const low = Math.min(settings.xpMin, settings.xpMax);
  const high = Math.max(settings.xpMin, settings.xpMax);
  const gain = low + Math.floor(Math.random() * (high - low + 1));
  const { before, after } = await setXp(message.guildId, member.id, (xp) => xp + gain, true);

  const oldLevel = levelInfo(before).level;
  const newLevel = levelInfo(after).level;
  if (newLevel <= oldLevel) return;
  await syncRewards(member, newLevel, settings);
  await announceLevelUp(message, member, newLevel, settings);
});

/** Members who come back get their reward roles again. */
const memberJoined = onEvent(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;
  const settings = await getActiveSettings(member.guild.id);
  if (!settings?.rewards.length) return;
  const row = await getRow(member.guild.id, member.id);
  if (row?.xp) await syncRewards(member, levelInfo(row.xp).level, settings);
});

/** Keep the cooldown map small: forget members whose cooldown ran out long ago. */
function pruneCooldowns() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, at] of lastXp) if (at < cutoff) lastXp.delete(key);
}

/* ------------------------------------------------------------ commands */

/** ▰▰▰▱▱▱▱▱▱▱ */
const bar = (part: number, whole: number, size = 12) => {
  const filled = Math.round((whole ? part / whole : 0) * size);
  return "▰".repeat(filled) + "▱".repeat(size - filled);
};

const n = (x: number) => x.toLocaleString("en-US");

const rankCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show your level and XP, or someone else's.")
    .setContexts(0)
    .addUserOption((o) => o.setName("member").setDescription("Whose rank to show (you, if empty)")),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("member") ?? interaction.user;
    if (user.bot) return interaction.reply("Bots don't earn XP.");
    const row = await getRow(interaction.guildId, user.id);
    const xp = row?.xp ?? 0;
    const info = levelInfo(xp);
    const [rank, total] = await Promise.all([rankOf(interaction.guildId, xp), rankedCount(interaction.guildId)]);
    const member = interaction.options.getMember("member") ?? (user.id === interaction.user.id ? interaction.member : null);
    const name = member?.displayName ?? user.globalName ?? user.username;
    const avatarUrl = (member ?? user).displayAvatarURL({ extension: "png", forceStatic: true, size: 256 });
    const notYet = `${user.id === interaction.user.id ? "You haven't" : "They haven't"} earned any XP yet. Chat to start levelling up!`;
    const summary = `Total XP: **${n(xp)}** · Messages: **${n(row?.messages ?? 0)}**${xp ? "" : `\n-# ${notYet}`}`;

    // Drawing can take a moment (it downloads the avatar), so let Discord know an answer is coming.
    await interaction.deferReply();
    try {
      const png = await renderRankCard({
        name,
        username: name.toLowerCase() === user.username.toLowerCase() ? undefined : user.username,
        avatarUrl,
        level: info.level,
        rank: xp ? rank : 0,
        xpIntoLevel: info.xpIntoLevel,
        xpForNext: info.xpForNext,
      });
      const embed = new EmbedBuilder()
        .setColor(PINK)
        .setAuthor({ name: `${name}'s rank`, iconURL: avatarUrl })
        .setDescription(summary)
        .setImage("attachment://rank.png")
        .setFooter({ text: xp ? `Rank ${n(rank)} of ${n(total)} · ${n(info.xpForNext - info.xpIntoLevel)} XP to level ${info.level + 1}` : interaction.guild.name });
      return interaction.editReply({ embeds: [embed], files: [new AttachmentBuilder(png, { name: "rank.png" })], allowedMentions: { parse: [] } });
    } catch (err) {
      log("couldn't draw a rank card, sending text instead:", (err as Error).message);
    }

    // Fallback if the card can't be drawn: the same numbers as text.
    const embed = new EmbedBuilder()
      .setColor(PINK)
      .setAuthor({ name, iconURL: avatarUrl })
      .setDescription(
        [
          `**Level ${info.level}**${xp ? ` · Rank #${n(rank)} of ${n(total)}` : ""}`,
          `${bar(info.xpIntoLevel, info.xpForNext)}  ${n(info.xpIntoLevel)} / ${n(info.xpForNext)} XP`,
          "",
          summary,
        ].join("\n"),
      );
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

const leaderboardCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the members with the most XP.")
    .setContexts(0)
    .addIntegerOption((o) => o.setName("page").setDescription("Which page (10 members each)").setMinValue(1)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const total = await rankedCount(interaction.guildId);
    if (!total) return interaction.reply("Nobody has earned XP yet. Start chatting!");
    const pages = Math.ceil(total / PAGE_SIZE);
    const page = Math.min(interaction.options.getInteger("page") ?? 1, pages);
    const rows = await topRows(interaction.guildId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((r, i) => {
      const place = (page - 1) * PAGE_SIZE + i + 1;
      const label = medals[place - 1] ?? `**${place}.**`;
      return `${label} <@${r.userId}> · Level ${levelInfo(r.xp).level} · ${n(r.xp)} XP`;
    });
    const mine = await getRow(interaction.guildId, interaction.user.id);
    const footer = mine?.xp ? `You're #${n(await rankOf(interaction.guildId, mine.xp))} · ` : "";
    const embed = new EmbedBuilder()
      .setColor(PINK)
      .setTitle(`🏆 ${interaction.guild.name} leaderboard`.slice(0, 256))
      .setDescription(lines.join("\n"))
      .setFooter({ text: `${footer}Page ${page} of ${pages}` });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

const xpCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Change a member's XP.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((s) =>
      s
        .setName("give")
        .setDescription("Give a member XP")
        .addUserOption((o) => o.setName("member").setDescription("Who gets it").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("How much XP").setRequired(true).setMinValue(1).setMaxValue(MAX_XP_CHANGE)),
    )
    .addSubcommand((s) =>
      s
        .setName("take")
        .setDescription("Take XP away from a member")
        .addUserOption((o) => o.setName("member").setDescription("From whom").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("How much XP").setRequired(true).setMinValue(1).setMaxValue(MAX_XP_CHANGE)),
    )
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Set a member's total XP")
        .addUserOption((o) => o.setName("member").setDescription("Whose XP").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("Their new total XP").setRequired(true).setMinValue(0).setMaxValue(MAX_XP_CHANGE)),
    )
    .addSubcommand((s) =>
      s
        .setName("reset")
        .setDescription("Set a member's XP back to zero")
        .addUserOption((o) => o.setName("member").setDescription("Whose XP").setRequired(true)),
    ),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser("member", true);
    if (user.bot) return interaction.reply("Bots don't earn XP.");
    const amount = interaction.options.getInteger("amount") ?? 0;
    const change = {
      give: (xp: number) => xp + amount,
      take: (xp: number) => xp - amount,
      set: () => amount,
      reset: () => 0,
    }[sub]!;
    const { before, after } = await setXp(interaction.guildId, user.id, change);
    const settings = (await getFeatureState(interaction.guildId, levelsFeature)).settings as LevelsSettings;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const level = levelInfo(after).level;
    if (member) await syncRewards(member, level, settings, true);
    const was = levelInfo(before).level;
    return interaction.reply({
      content: `<@${user.id}> now has **${n(after)} XP** (level ${level}${was !== level ? `, was ${was}` : ""}).`,
      allowedMentions: { parse: [] },
    });
  },
};

/* ------------------------------------------------------------ dashboard */

function problemsFor(guild: Guild, s: LevelsSettings): string[] {
  const problems: string[] = [];
  const me = guild.members.me;
  if (s.rewards.length && !me?.permissions.has(PermissionFlagsBits.ManageRoles)) problems.push("I need Manage Roles to give reward roles.");
  for (const r of s.rewards) {
    const role = guild.roles.cache.get(r.roleId);
    if (!role) problems.push(`The reward role for level ${r.level} no longer exists. Pick another one.`);
    else if (!canManage(guild, r.roleId)) problems.push(`I can't give @${role.name} (level ${r.level}). Move my role above it in Server Settings → Roles.`);
  }
  if (s.levelUp.where === "channel") {
    const channel = s.levelUp.channelId ? guild.channels.cache.get(s.levelUp.channelId) : null;
    if (!channel) problems.push("Pick a channel for level-up messages.");
    else if (!channel.isTextBased() || !canPost(channel as GuildTextBasedChannel)) problems.push(`I can't post level-up messages in #${channel.name}. I need View Channel and Send Messages there.`);
  }
  return problems;
}

async function leaderboardFor(guild: Guild): Promise<LeaderboardEntry[]> {
  const rows = await topRows(guild.id, 25);
  if (!rows.length) return [];
  const members = await guild.members.fetch({ user: rows.map((r) => r.userId) }).catch(() => null);
  return rows.map((r) => {
    const member = members?.get(r.userId) ?? guild.members.cache.get(r.userId);
    const user = member?.user ?? client.users.cache.get(r.userId);
    return {
      userId: r.userId,
      name: member?.displayName ?? user?.username ?? "Former member",
      avatar: user?.displayAvatarURL({ size: 64 }) ?? null,
      xp: r.xp,
      level: levelInfo(r.xp).level,
      messages: r.messages,
    };
  });
}

async function respond(guild: Guild, settings: LevelsSettings): Promise<LevelsResponse> {
  return { settings, problems: problemsFor(guild, settings), members: await rankedCount(guild.id), leaderboard: await leaderboardFor(guild) };
}

export const levelsBot: BotFeature = {
  info: levelsFeature,
  commands: [rankCommand, leaderboardCommand, xpCommand],
  events: [messageSent, memberJoined],

  setup() {
    setInterval(pruneCooldowns, 30 * 60 * 1000).unref();
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/levels", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const state = await getFeatureState(guild.id, levelsFeature);
      return respond(guild, state.settings as LevelsSettings);
    });

    api.put("/api/guilds/:guildId/levels", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = levelsSettings.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reply.code(400).send({ error: issue ? `${issue.path.join(" → ")}: ${issue.message}` : "Check the form and try again." });
      }
      const s = parsed.data;
      if (s.xpMin > s.xpMax) [s.xpMin, s.xpMax] = [s.xpMax, s.xpMin];
      const levels = s.rewards.map((r) => r.level);
      if (new Set(levels).size !== levels.length) return reply.code(400).send({ error: "Each level can only have one reward role." });
      const roles = s.rewards.map((r) => r.roleId);
      if (new Set(roles).size !== roles.length) return reply.code(400).send({ error: "Each role can only be the reward for one level." });
      s.rewards.sort((a, b) => a.level - b.level);
      // Forget channels and roles that were deleted.
      s.noXpChannelIds = s.noXpChannelIds.filter((id) => guild.channels.cache.has(id));
      s.noXpRoleIds = s.noXpRoleIds.filter((id) => guild.roles.cache.has(id));
      const state = await getFeatureState(guild.id, levelsFeature);
      await saveFeatureState(guild.id, levelsFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
      return respond(guild, s);
    });

    /** Wipes everyone's XP in the server. Reward roles members already have are left alone. */
    api.post("/api/guilds/:guildId/levels/reset", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      await db.delete(memberLevels).where(eq(memberLevels.guildId, guild.id)).run();
      for (const key of lastXp.keys()) if (key.startsWith(`${guild.id}:`)) lastXp.delete(key);
      const state = await getFeatureState(guild.id, levelsFeature);
      return respond(guild, state.settings as LevelsSettings);
    });
  },
};
