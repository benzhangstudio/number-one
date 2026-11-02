import {
  EmbedBuilder,
  type Guild,
  GuildVerificationLevel,
  type GuildMember,
  PermissionFlagsBits,
  type User,
} from "discord.js";
import { client } from "../../server/bot/discord.js";
import { type AntiRaidSettings, MAX_RAID_MINUTES, raidActionInfo } from "../../shared/antiRaid.js";
import { formatDuration } from "../../shared/moderation.js";
import { runAction } from "../moderation/actions.js";
import { ModError } from "../moderation/checks.js";
import { type RaidRow, activeRaids, countYoung, deleteRaid, getRaid, getState, saveRaid } from "./state.js";

const log = (...args: unknown[]) => console.warn("[anti-raid]", ...args);
const RED = 0xff4f6d;
const GREEN = 0x5bd6a0;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Discord can pause invites for at most 24 hours at a time. */
const MAX_PAUSE_MS = DAY_MS;

const ts = (d: Date, style: "R" | "t" | "f" = "R") => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;

/** Admins, people who can manage the server, and bots are never treated as raiders. */
function isExempt(member: GuildMember) {
  return (
    member.user.bot ||
    member.id === member.guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

/* ------------------------------------------------------------ alerts */

async function alert(guild: Guild, settings: AntiRaidSettings, embed: EmbedBuilder, ping = false) {
  if (!settings.alertChannelId) return;
  const channel = guild.channels.cache.get(settings.alertChannelId);
  if (!channel?.isTextBased()) return;
  const role = ping && settings.alertRoleId ? settings.alertRoleId : null;
  await channel
    .send({
      content: role ? `<@&${role}>` : undefined,
      embeds: [embed.setFooter({ text: "Number One anti-raid" }).setTimestamp()],
      allowedMentions: { roles: role ? [role] : [] },
    })
    .catch((err) => log("alert failed:", err.message));
}

/* ------------------------------------------------------------ dealing with raiders */

/** Members waiting to be dealt with, one server at a time, so a big wave doesn't fire hundreds of requests at once. */
const queues = new Map<string, Promise<unknown>>();

function enqueue(guildId: string, job: () => Promise<unknown>) {
  const next = (queues.get(guildId) ?? Promise.resolve()).then(job, job).catch((err) => log("job failed:", err));
  queues.set(guildId, next);
  void next.finally(() => {
    if (queues.get(guildId) === next) queues.delete(guildId);
  });
  return next;
}

/** Applies the raid action to one member. Returns true when something was done. */
async function actOn(guild: Guild, settings: AntiRaidSettings, userId: string): Promise<boolean> {
  if (settings.action === "none") return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || isExempt(member)) return false;
  const reason = "Number One anti-raid: joined during a raid";
  try {
    switch (settings.action) {
      case "timeout":
        if (!member.moderatable) return false;
        await member.timeout(settings.timeoutMinutes * 60_000, reason);
        return true;
      case "kick":
        if (!member.kickable) return false;
        await member.kick(reason);
        return true;
      case "ban":
        if (!member.bannable) return false;
        // Also clears whatever they managed to post in the last hour.
        await guild.bans.create(userId, { reason, deleteMessageSeconds: 3600 });
        return true;
    }
  } catch (err) {
    log(`${settings.action} in ${guild.name} (${guild.id}) failed:`, (err as Error).message);
  }
  return false;
}

/** Accounts already queued during the current raid, per server (memory only, cleared when raid mode ends). */
const dealtWith = new Map<string, Set<string>>();

/** Deals with raiders in the background and keeps the raid's count up to date. */
export function handleRaiders(guild: Guild, settings: AntiRaidSettings, userIds: string[]) {
  if (settings.action === "none" || !userIds.length) return;
  // Joins in the same burst report overlapping waves: deal with each account once per raid.
  const seen = dealtWith.get(guild.id) ?? new Set<string>();
  dealtWith.set(guild.id, seen);
  for (const id of userIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    enqueue(guild.id, async () => {
      if (!(await actOn(guild, settings, id))) return;
      const raid = getRaid(guild.id);
      if (raid) await saveRaid({ ...raid, handled: raid.handled + 1 });
    });
  }
}

/* ------------------------------------------------------------ raid mode */

/** Pauses invites until `until` (capped at Discord's 24 hours). Returns false if Discord refused. */
async function pauseInvites(guild: Guild, until: Date) {
  const capped = new Date(Math.min(until.getTime(), Date.now() + MAX_PAUSE_MS));
  return guild
    .setIncidentActions({ invitesDisabledUntil: capped })
    .then(() => true)
    .catch((err) => {
      log(`couldn't pause invites in ${guild.name} (${guild.id}):`, err.message);
      return false;
    });
}

/**
 * Switches raid mode on (or makes it last longer if it already is).
 * `wave` is everyone who joined in the burst that set it off; they're dealt with straight away.
 */
export async function startRaid(
  guild: Guild,
  settings: AntiRaidSettings,
  opts: { by?: User; minutes?: number; wave?: string[] } = {},
): Promise<RaidRow> {
  // Joins arrive in bursts: while raid mode is being switched on, later joins wait for it instead of starting it twice.
  const pending = starting.get(guild.id);
  if (pending) {
    await pending.catch(() => {});
    if (getRaid(guild.id)) return startRaid(guild, settings, opts);
  }
  const run = beginRaid(guild, settings, opts);
  starting.set(guild.id, run);
  try {
    return await run;
  } finally {
    if (starting.get(guild.id) === run) starting.delete(guild.id);
  }
}

const starting = new Map<string, Promise<RaidRow>>();

/** Waits for raid mode to finish switching on, if it's in the middle of it. */
export const raidStarting = (guildId: string) => starting.get(guildId)?.catch(() => null);

async function beginRaid(guild: Guild, settings: AntiRaidSettings, opts: { by?: User; minutes?: number; wave?: string[] }): Promise<RaidRow> {
  const minutes = Math.min(opts.minutes ?? settings.durationMinutes, MAX_RAID_MINUTES);
  const endsAt = new Date(Date.now() + minutes * 60_000);

  const existing = getRaid(guild.id);
  if (existing) {
    await extendRaid(guild, settings, endsAt);
    handleRaiders(guild, settings, opts.wave ?? []);
    return getRaid(guild.id)!;
  }

  const me = guild.members.me;
  const canManage = Boolean(me?.permissions.has(PermissionFlagsBits.ManageGuild));
  const problems: string[] = [];

  let previousVerification: number | null = null;
  if (settings.raiseVerification) {
    if (!canManage) problems.push("I couldn't raise the verification level: I need the Manage Server permission.");
    else if (guild.verificationLevel < GuildVerificationLevel.High) {
      const before = guild.verificationLevel;
      const ok = await guild
        .setVerificationLevel(GuildVerificationLevel.High, "Number One anti-raid: raid mode on")
        .then(() => true)
        .catch((err) => {
          log(`couldn't raise verification in ${guild.name} (${guild.id}):`, err.message);
          return false;
        });
      if (ok) previousVerification = before;
      else problems.push("Discord didn't let me raise the verification level.");
    }
  }

  let invitesPaused = false;
  if (settings.pauseInvites) {
    if (!canManage) problems.push("I couldn't pause invites: I need the Manage Server permission.");
    else if (!(invitesPaused = await pauseInvites(guild, endsAt))) problems.push("Discord didn't let me pause invites.");
  }

  const row: RaidRow = {
    guildId: guild.id,
    startedAt: new Date(),
    endsAt,
    startedById: opts.by?.id ?? null,
    startedByTag: opts.by?.tag ?? null,
    previousVerification,
    invitesPaused,
    handled: 0,
  };
  await saveRaid(row);
  console.log(`[anti-raid] raid mode on in ${guild.name} (${guild.id})${opts.by ? ` by ${opts.by.tag}` : ""}`);

  const done = [
    invitesPaused && "⏸️ Invites are paused.",
    previousVerification !== null && "🔒 Verification level raised to High: new members wait 10 minutes before they can chat.",
    settings.action !== "none" && `🚪 Everyone who joined in the wave, and anyone who joins now, gets: **${raidActionInfo[settings.action].label.toLowerCase()}**.`,
  ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setColor(RED)
    .setTitle("🚨 Raid mode is on")
    .setDescription(
      [
        opts.by
          ? `Started by <@${opts.by.id}>.`
          : `**${opts.wave?.length ?? 0} accounts** joined within ${settings.joinSeconds} seconds.`,
        "",
        ...(done.length ? done : ["Nothing is locked down (all lockdown options are off). Keep an eye on new members."]),
        ...(problems.length ? ["", ...problems.map((p) => `⚠️ ${p}`)] : []),
        "",
        `Ends ${ts(endsAt)}. End it early with \`/raidmode off\` or on the dashboard.`,
      ].join("\n"),
    );
  await alert(guild, settings, embed, true);

  handleRaiders(guild, settings, opts.wave ?? []);
  return row;
}

/** Makes raid mode last until at least `until`, and keeps invites paused that long. */
export async function extendRaid(guild: Guild, _settings: AntiRaidSettings, until: Date) {
  const raid = getRaid(guild.id);
  // Small extensions aren't worth a request to Discord every join.
  if (!raid || until.getTime() - raid.endsAt.getTime() < 60_000) return;
  if (raid.invitesPaused) await pauseInvites(guild, until);
  await saveRaid({ ...raid, endsAt: until });
}

/** Ends raid mode and puts back what it changed. `by` is the moderator who ended it early, if any. */
export async function endRaid(guildId: string, by?: User | null, quiet = false) {
  if (!getRaid(guildId)) return;
  await queues.get(guildId); // let the last raiders be dealt with first, so the summary count is right
  const raid = getRaid(guildId);
  if (!raid) return; // ended by someone else meanwhile
  await deleteRaid(guildId);
  dealtWith.delete(guildId);
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const restored: string[] = [];
  if (raid.invitesPaused) {
    const ok = await guild
      .setIncidentActions({ invitesDisabledUntil: null })
      .then(() => true)
      .catch((err) => (log(`couldn't un-pause invites in ${guild.name}:`, err.message), false));
    restored.push(ok ? "▶️ Invites are open again." : "⚠️ I couldn't un-pause invites. Do it in Server Settings → Invites.");
  }
  if (raid.previousVerification !== null) {
    // Only put it back if nobody changed it during the raid.
    if (guild.verificationLevel === GuildVerificationLevel.High) {
      const ok = await guild
        .setVerificationLevel(raid.previousVerification as GuildVerificationLevel, "Number One anti-raid: raid mode ended")
        .then(() => true)
        .catch((err) => (log(`couldn't restore verification in ${guild.name}:`, err.message), false));
      restored.push(ok ? "🔓 Verification level is back to what it was." : "⚠️ I couldn't put the verification level back. Check Server Settings → Safety Setup.");
    } else {
      restored.push("Verification level was changed during the raid, so I left it as it is.");
    }
  }
  console.log(`[anti-raid] raid mode off in ${guild.name} (${guild.id})`);
  if (quiet) return;

  const { settings } = await getState(guildId);
  const lasted = formatDuration(Math.max(60_000, Date.now() - raid.startedAt.getTime()));
  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle("✅ Raid mode has ended")
    .setDescription(
      [
        by ? `Ended early by <@${by.id}> after ${lasted}.` : `Lasted ${lasted}.`,
        settings.action !== "none"
          ? `Dealt with **${raid.handled}** account${raid.handled === 1 ? "" : "s"} (${raidActionInfo[settings.action].label.toLowerCase()}).`
          : "",
        ...restored,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  await alert(guild, settings, embed);
}

/** Ends raids whose time is up. Runs every 15 seconds, so it also catches raids that ended while the bot was offline. */
export async function endExpired() {
  for (const raid of activeRaids()) {
    if (raid.endsAt.getTime() <= Date.now()) await endRaid(raid.guildId).catch((err) => log("ending raid mode failed:", err));
  }
}

/* ------------------------------------------------------------ young accounts */

/**
 * Turns away an account created less than the set number of days ago. Goes through Moderation,
 * so it gets a case, a mod log entry and a DM telling them why.
 */
export async function checkYoungAccount(member: GuildMember, settings: AntiRaidSettings): Promise<boolean> {
  const rule = settings.youngAccounts;
  if (!rule.enabled || isExempt(member)) return false;
  const ageMs = Date.now() - member.user.createdTimestamp;
  if (ageMs >= rule.minAgeDays * DAY_MS) return false;
  const me = member.guild.members.me;
  if (!me) return false;
  const durationMs = rule.action === "timeout" ? rule.timeoutMinutes * 60_000 : null;
  const reason = `Anti-raid: account is less than ${rule.minAgeDays} day${rule.minAgeDays === 1 ? "" : "s"} old${durationMs ? ` (${formatDuration(durationMs)})` : ""}`;
  try {
    await runAction(member.guild, {
      action: rule.action,
      user: member.user,
      member,
      moderator: { id: me.id, tag: me.user.tag, member: null },
      reason,
      durationMs,
      deleteMessageSeconds: 0,
      auto: true,
    });
    countYoung(member.guild.id);
    return true;
  } catch (err) {
    if (err instanceof ModError) log(`young account ${rule.action} skipped: ${err.message.replace(/\*\*/g, "")}`);
    else log("young account action failed:", err);
    return false;
  }
}
