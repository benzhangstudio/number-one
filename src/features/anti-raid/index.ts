import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  Events,
  type Guild,
  InteractionContextType,
  PermissionFlagsBits,
  type PermissionResolvable,
  SlashCommandBuilder,
} from "discord.js";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type SlashCommand, onEvent } from "../../server/bot/types.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import {
  type AntiRaidResponse,
  type AntiRaidSettings,
  MAX_RAID_MINUTES,
  type RaidView,
  antiRaidSettings,
  raidActionInfo,
} from "../../shared/antiRaid.js";
import { antiRaidFeature } from "../../shared/features.js";
import { checkYoungAccount, endExpired, endRaid, extendRaid, handleRaiders, raidStarting, startRaid } from "./raid.js";
import { type RaidRow, forgetJoins, forgetState, getRaid, getState, joinsSince, loadRaids, recordJoin, sweepJoins, youngCount } from "./state.js";

type Req = FastifyRequest<{ Params: { guildId: string } }>;

class SettingsError extends Error {}

const ts = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;

/* ------------------------------------------------------------ joins */

const memberJoined = onEvent(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return; // bots can only be added by people with Manage Server
  const { guild } = member;
  const { enabled, settings } = await getState(guild.id);
  if (!enabled) return;

  const recent = recordJoin(guild.id, member.id, settings.joinSeconds);
  const tooFast = recent.length > settings.joinCount;
  await raidStarting(guild.id);

  if (getRaid(guild.id)) {
    // Still coming in too fast: keep raid mode on for longer.
    if (tooFast) await extendRaid(guild, settings, new Date(Date.now() + settings.durationMinutes * 60_000));
    if (settings.action !== "none") return handleRaiders(guild, settings, [member.id]);
  } else if (tooFast) {
    await startRaid(guild, settings, { wave: recent.map((j) => j.userId) });
    if (settings.action !== "none") return;
  }
  await checkYoungAccount(member, settings);
});

/* ------------------------------------------------------------ status and checks */

const toView = (r: RaidRow): RaidView => ({
  startedAt: r.startedAt.getTime(),
  endsAt: r.endsAt.getTime(),
  startedBy: r.startedByTag,
  handled: r.handled,
  invitesPaused: r.invitesPaused,
  verificationRaised: r.previousVerification !== null,
});

/** Missing permissions and setup problems, in plain words, for the dashboard. */
function setupProblems(guild: Guild, s: AntiRaidSettings, enabled: boolean): string[] {
  const me = guild.members.me;
  if (!me || !enabled) return [];
  const problems: string[] = [];
  const uses = (a: string) => s.action === a || (s.youngAccounts.enabled && s.youngAccounts.action === a);
  const needs: [boolean, PermissionResolvable, string, string][] = [
    [s.pauseInvites || s.raiseVerification, PermissionFlagsBits.ManageGuild, "Manage Server", "pause invites and raise the verification level"],
    [uses("timeout"), PermissionFlagsBits.ModerateMembers, "Timeout Members", "time members out"],
    [uses("kick"), PermissionFlagsBits.KickMembers, "Kick Members", "kick members"],
    [uses("ban"), PermissionFlagsBits.BanMembers, "Ban Members", "ban members"],
  ];
  for (const [needed, flag, name, what] of needs) {
    if (needed && !me.permissions.has(flag)) problems.push(`I need the ${name} permission to ${what}.`);
  }
  if (s.alertChannelId) {
    const channel = guild.channels.cache.get(s.alertChannelId);
    if (!channel?.isTextBased()) problems.push("The alert channel no longer exists. Pick another one.");
    else {
      const perms = channel.permissionsFor(me);
      const missing = (
        [
          [PermissionFlagsBits.ViewChannel, "View Channel"],
          [PermissionFlagsBits.SendMessages, "Send Messages"],
          [PermissionFlagsBits.EmbedLinks, "Embed Links"],
        ] as const
      )
        .filter(([flag]) => !perms?.has(flag))
        .map(([, name]) => name);
      if (missing.length) problems.push(`In #${channel.name} (alerts) I need: ${missing.join(", ")}.`);
    }
  } else {
    problems.push("No alert channel is set, so nobody will be told when a raid starts.");
  }
  if (s.alertRoleId) {
    const role = guild.roles.cache.get(s.alertRoleId);
    if (!role) problems.push("The role to ping no longer exists. Pick another one.");
    else if (!role.mentionable && !me.permissions.has(PermissionFlagsBits.MentionEveryone)) {
      problems.push(`I can't ping @${role.name}: make it mentionable, or give me "Mention @everyone, @here and All Roles".`);
    }
  }
  return problems;
}

function validate(guild: Guild, s: AntiRaidSettings) {
  if (s.alertChannelId) {
    const channel = guild.channels.cache.get(s.alertChannelId);
    if (!channel?.isTextBased() || channel.isThread()) throw new SettingsError("The alert channel no longer exists. Pick another one.");
  }
  if (s.alertRoleId && !guild.roles.cache.has(s.alertRoleId)) throw new SettingsError("The role to ping no longer exists. Pick another one.");
  if (s.alertRoleId === guild.id) throw new SettingsError("Pick a role to ping, not @everyone.");
}

function respond(guild: Guild, settings: AntiRaidSettings, enabled: boolean): AntiRaidResponse {
  const raid = getRaid(guild.id);
  return {
    settings,
    status: {
      raid: raid ? toView(raid) : null,
      joinsLastMinute: joinsSince(guild.id, 60_000),
      youngTurnedAway: youngCount(guild.id),
      problems: setupProblems(guild, settings, enabled),
    },
  };
}

/* ------------------------------------------------------------ /raidmode */

const raidmode: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("raidmode")
    .setDescription("Lock the server down during a raid, or end raid mode.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sc) =>
      sc
        .setName("on")
        .setDescription("Start raid mode now: pause invites, raise verification and deal with new joiners.")
        .addIntegerOption((o) =>
          o.setName("minutes").setDescription("How long (default: the dashboard setting)").setMinValue(5).setMaxValue(MAX_RAID_MINUTES),
        ),
    )
    .addSubcommand((sc) => sc.setName("off").setDescription("End raid mode and put everything back."))
    .addSubcommand((sc) => sc.setName("status").setDescription("Whether raid mode is on, and until when.")),

  async execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) return;
    const sub = interaction.options.getSubcommand();
    const { settings } = await getState(guild.id);
    const raid = getRaid(guild.id);

    if (sub === "status") {
      const text = raid
        ? `🚨 Raid mode is **on** and ends ${ts(raid.endsAt)}. ${raid.handled} account${raid.handled === 1 ? "" : "s"} dealt with so far.`
        : `Raid mode is **off**. It starts by itself when more than ${settings.joinCount} people join within ${settings.joinSeconds} seconds.`;
      return interaction.reply({ content: text, allowedMentions: { parse: [] } });
    }

    if (sub === "off") {
      if (!raid) return interaction.reply("Raid mode isn't on.");
      await interaction.deferReply();
      await endRaid(guild.id, interaction.user);
      return interaction.editReply("✅ Raid mode has ended. Invites and verification are back to how they were.");
    }

    await interaction.deferReply();
    const minutes = interaction.options.getInteger("minutes") ?? settings.durationMinutes;
    const wasOn = Boolean(raid);
    const row = await startRaid(guild, settings, { by: interaction.user, minutes });
    const embed = new EmbedBuilder()
      .setColor(0xff4f6d)
      .setTitle(wasOn ? "🚨 Raid mode extended" : "🚨 Raid mode is on")
      .setDescription(
        [
          row.invitesPaused && "⏸️ Invites are paused.",
          row.previousVerification !== null && "🔒 Verification level raised to High.",
          settings.action !== "none" && `🚪 New joiners: ${raidActionInfo[settings.action].label.toLowerCase()}.`,
          `Ends ${ts(row.endsAt)}. Use \`/raidmode off\` to end it early.`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    return interaction.editReply({ embeds: [embed] });
  },
};

/* ------------------------------------------------------------ feature */

export const antiRaid: BotFeature = {
  info: antiRaidFeature,
  commands: [raidmode],
  events: [memberJoined],

  setup(c) {
    c.once(Events.ClientReady, async () => {
      await loadRaids();
      await endExpired(); // raids that ran out while the bot was offline
    });
    setInterval(() => void endExpired(), 15_000).unref();
    setInterval(sweepJoins, 60_000).unref();
  },

  async onToggle(guildId, enabled) {
    forgetState(guildId);
    if (!enabled) {
      forgetJoins(guildId);
      await endRaid(guildId);
    }
  },

  async beforeDataDelete(guildId) {
    await endRaid(guildId, null, true);
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/anti-raid", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const state = await getFeatureState(guild.id, antiRaidFeature);
      return respond(guild, state.settings as AntiRaidSettings, state.enabled);
    });

    api.put("/api/guilds/:guildId/anti-raid", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = antiRaidSettings.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reply.code(400).send({ error: issue ? `${issue.path.join(" → ")}: ${issue.message}` : "Check the form and try again." });
      }
      try {
        validate(guild, parsed.data);
      } catch (err) {
        if (err instanceof SettingsError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      const state = await getFeatureState(guild.id, antiRaidFeature);
      await saveFeatureState(guild.id, antiRaidFeature, { enabled: state.enabled, settings: parsed.data }, request.session!.userId);
      forgetState(guild.id);
      return respond(guild, parsed.data, state.enabled);
    });

    api.post("/api/guilds/:guildId/anti-raid/start", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const body = z.object({ minutes: z.number().int().min(5).max(MAX_RAID_MINUTES).optional() }).safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: `Raid mode can last 5 to ${MAX_RAID_MINUTES} minutes.` });
      const state = await getFeatureState(guild.id, antiRaidFeature);
      if (!state.enabled) return reply.code(400).send({ error: "Turn Anti-raid on first." });
      const user = await client.users.fetch(request.session!.userId);
      await startRaid(guild, state.settings as AntiRaidSettings, { by: user, minutes: body.data.minutes });
      return respond(guild, state.settings as AntiRaidSettings, state.enabled);
    });

    api.post("/api/guilds/:guildId/anti-raid/end", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const user = await client.users.fetch(request.session!.userId).catch(() => null);
      await endRaid(guild.id, user);
      const state = await getFeatureState(guild.id, antiRaidFeature);
      return respond(guild, state.settings as AntiRaidSettings, state.enabled);
    });
  },
};
