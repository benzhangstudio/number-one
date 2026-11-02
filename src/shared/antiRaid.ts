import { z } from "zod";

/**
 * Anti-raid: settings and shapes shared by the bot and the dashboard.
 *
 * A raid is a wave of accounts joining at once (usually to spam). When more people join than the
 * server allows within a few seconds, Number One switches on "raid mode" for a while:
 * - it pauses invites (Discord's own "Pause invites", which ends by itself even if Number One goes offline)
 * - it raises the server's verification level, so new accounts can't chat straight away
 * - it removes (or times out) everyone in the wave and everyone who joins while raid mode is on
 * - it posts one alert, and one summary when raid mode ends
 *
 * Separately, it can turn away accounts that were created very recently, a common sign of throwaway accounts.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);

export const raidActions = ["none", "timeout", "kick", "ban"] as const;
export type RaidAction = (typeof raidActions)[number];

export const raidActionInfo: Record<RaidAction, { label: string; hint: string }> = {
  none: { label: "Lock down only", hint: "Nobody is removed. Invites and verification still lock down." },
  timeout: { label: "Time them out", hint: "They stay, but can't chat until the timeout ends." },
  kick: { label: "Kick them", hint: "They can rejoin with an invite once raid mode ends." },
  ban: { label: "Ban them", hint: "Also deletes their messages from the last hour. Lift bans in Moderation." },
};

export const youngAccountActions = ["timeout", "kick", "ban"] as const;
export type YoungAccountAction = (typeof youngAccountActions)[number];

/** Longest raid mode: Discord can pause invites for at most 24 hours. */
export const MAX_RAID_MINUTES = 24 * 60;

export const antiRaidSettings = z.object({
  /** Where raid alerts and summaries go. Empty = no alerts. */
  alertChannelId: snowflake.nullable().default(null),
  /** Role pinged when a raid starts (e.g. Moderators). Empty = no ping. */
  alertRoleId: snowflake.nullable().default(null),

  /** More than this many joins… */
  joinCount: z.number().int().min(3).max(100).default(10),
  /** …within this many seconds starts raid mode. */
  joinSeconds: z.number().int().min(5).max(300).default(10),

  /** What happens to the accounts in the wave, and anyone who joins during raid mode. */
  action: z.enum(raidActions).default("kick"),
  /** Timeout length when the action is "timeout". */
  timeoutMinutes: z.number().int().min(1).max(28 * 24 * 60).default(60),

  /** Pause all invites while raid mode is on (Discord ends the pause by itself, even if Number One is offline). */
  pauseInvites: z.boolean().default(true),
  /** Raise the verification level to High while raid mode is on (new members wait 10 minutes before chatting). */
  raiseVerification: z.boolean().default(true),
  /** How long raid mode lasts. Joins that keep coming too fast make it last longer. */
  durationMinutes: z.number().int().min(5).max(MAX_RAID_MINUTES).default(15),

  /** Turn away accounts younger than a set age, at any time (not only during raids). */
  youngAccounts: z
    .object({
      enabled: z.boolean().default(false),
      minAgeDays: z.number().int().min(1).max(90).default(3),
      action: z.enum(youngAccountActions).default("kick"),
      timeoutMinutes: z.number().int().min(1).max(28 * 24 * 60).default(60),
    })
    .prefault({}),
});

export type AntiRaidSettings = z.infer<typeof antiRaidSettings>;

export interface RaidView {
  startedAt: number;
  endsAt: number;
  /** Started by the join limit, or by a moderator (with their name). */
  startedBy: string | null;
  /** Accounts removed, timed out or banned so far. */
  handled: number;
  invitesPaused: boolean;
  verificationRaised: boolean;
}

export interface AntiRaidStatus {
  /** Raid mode right now, or null. */
  raid: RaidView | null;
  /** Joins in the last minute (kept in memory only). */
  joinsLastMinute: number;
  /** Young accounts turned away since the bot last started. */
  youngTurnedAway: number;
  /** Permissions or channel problems, in plain words. */
  problems: string[];
}

export interface AntiRaidResponse {
  settings: AntiRaidSettings;
  status: AntiRaidStatus;
}
