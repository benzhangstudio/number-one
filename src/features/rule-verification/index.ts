import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildTextBasedChannel,
  type MessageComponentInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { roleProblem } from "../../server/bot/roles.js";
import { type BotFeature, type ComponentHandler, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { ruleVerificationPosts } from "../../server/db/schema.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import { ruleVerificationFeature } from "../../shared/features.js";
import {
  type RuleVerificationResponse,
  type RuleVerificationSettings,
  type VerifyButtonStyle,
  ruleVerificationSettings,
} from "../../shared/ruleVerification.js";

/**
 * Rule verification: the server's rules posted with an "I agree" button. Agreeing gives the verified role
 * and can take an "unverified" role away. Independent of Member onboarding, so it works with it switched off.
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;

/** A problem the admin can fix, shown as-is on the dashboard. */
class VerifyError extends Error {}

const log = (...args: unknown[]) => console.warn("[rule-verification]", ...args);
const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const AGREE_ID = "rv:agree";
const STYLES: Record<VerifyButtonStyle, ButtonStyle> = {
  success: ButtonStyle.Success,
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  danger: ButtonStyle.Danger,
};

const settingsOf = async (guildId: string) => (await getFeatureState(guildId, ruleVerificationFeature)).settings as RuleVerificationSettings;
const postOf = (guildId: string) => db.select().from(ruleVerificationPosts).where(eq(ruleVerificationPosts.guildId, guildId)).get();

/* ------------------------------------------------------------ the rules message */

function buildMessage(s: RuleVerificationSettings) {
  const embed = new EmbedBuilder().setColor(Number.parseInt(s.color.slice(1), 16)).setDescription(s.rules.trim() || "Please read and accept the rules.");
  if (s.title) embed.setTitle(s.title);
  if (s.image) embed.setImage(s.image);
  const button = new ButtonBuilder().setCustomId(AGREE_ID).setLabel(s.buttonLabel).setStyle(STYLES[s.buttonStyle]);
  if (s.buttonEmoji) button.setEmoji(s.buttonEmoji);
  return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)], allowedMentions: { parse: [] } };
}

/** Posts the rules message, or updates it in place. Moving it to another channel removes the old one. */
async function publish(guild: Guild, s: RuleVerificationSettings) {
  const channel = s.channelId ? guild.channels.cache.get(s.channelId) : null;
  if (!channel || !TEXT_TYPES.has(channel.type)) throw new VerifyError("Pick a channel for the rules.");
  const me = guild.members.me;
  const missing = (
    [
      [PermissionFlagsBits.ViewChannel, "View Channel"],
      [PermissionFlagsBits.SendMessages, "Send Messages"],
      [PermissionFlagsBits.EmbedLinks, "Embed Links"],
    ] as const
  )
    .filter(([flag]) => !(me && channel.permissionsFor(me).has(flag)))
    .map(([, name]) => name);
  if (missing.length) throw new VerifyError(`In #${channel.name} I need: ${missing.join(", ")}.`);

  const text = channel as GuildTextBasedChannel;
  const post = await postOf(guild.id);
  if (post && post.channelId === channel.id) {
    const existing = await text.messages.fetch(post.messageId).catch(() => null);
    if (existing) {
      await existing.edit(buildMessage(s)).catch((err: Error) => {
        throw new VerifyError(`Discord didn't accept the rules message: ${err.message}`);
      });
      return;
    }
  }
  if (post && post.channelId !== channel.id) {
    const old = guild.channels.cache.get(post.channelId);
    if (old?.isTextBased()) await old.messages.delete(post.messageId).catch(() => {});
  }
  const sent = await text.send(buildMessage(s)).catch((err: Error) => {
    throw new VerifyError(`Discord didn't accept the rules message: ${err.message}`);
  });
  const values = { guildId: guild.id, channelId: channel.id, messageId: sent.id };
  await db.insert(ruleVerificationPosts).values(values).onConflictDoUpdate({ target: ruleVerificationPosts.guildId, set: values }).run();
}

async function unpublish(guildId: string) {
  const post = await postOf(guildId);
  if (!post) return;
  const channel = client.guilds.cache.get(guildId)?.channels.cache.get(post.channelId);
  if (channel?.isTextBased()) await channel.messages.delete(post.messageId).catch(() => {});
  await db.delete(ruleVerificationPosts).where(eq(ruleVerificationPosts.guildId, guildId)).run();
}

/* ------------------------------------------------------------ agreeing */

const agreeButton: ComponentHandler = {
  prefix: "rv",
  async handle(interaction: MessageComponentInteraction) {
    if (!interaction.inCachedGuild() || interaction.customId !== AGREE_ID) return;
    // A member's own step, like a role menu click: the note is just for them.
    const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!(await isFeatureEnabled(interaction.guildId, ruleVerificationFeature))) return privately("Rule verification is turned off in this server right now.");
    const s = await settingsOf(interaction.guildId);
    const member = interaction.member;
    if (!s.verifiedRoleId || !interaction.guild.roles.cache.has(s.verifiedRoleId)) {
      return privately("This server hasn't finished setting up verification yet. Please let a server admin know.");
    }
    const removing = s.unverifiedRoleId && member.roles.cache.has(s.unverifiedRoleId) ? s.unverifiedRoleId : null;
    if (member.roles.cache.has(s.verifiedRoleId) && !removing) return privately("✅ You've already agreed to the rules.");

    // The verified role goes on first, so nobody is ever left with neither role.
    try {
      if (!member.roles.cache.has(s.verifiedRoleId)) await member.roles.add(s.verifiedRoleId, "Rule verification: agreed to the rules");
      if (removing) await member.roles.remove(removing, "Rule verification: agreed to the rules");
    } catch (err) {
      log(`couldn't verify ${member.user.tag} in ${interaction.guild.name}:`, (err as Error).message);
      return privately("I couldn't give you your role. Please let a server admin know.");
    }
    return privately(s.successMessage || "✅ Thanks for agreeing to the rules.");
  },
};

/** Optionally give the unverified role to everyone who joins. */
const memberJoined = onEvent(Events.GuildMemberAdd, async (member) => {
  if (member.user.bot) return;
  if (!(await isFeatureEnabled(member.guild.id, ruleVerificationFeature))) return;
  const s = await settingsOf(member.guild.id);
  if (!s.giveUnverifiedOnJoin || !s.unverifiedRoleId || !member.guild.roles.cache.has(s.unverifiedRoleId)) return;
  await member.roles.add(s.unverifiedRoleId, "Rule verification: hasn't agreed to the rules yet").catch((err: Error) => log(`couldn't give the unverified role in ${member.guild.name}:`, err.message));
});

/** The rules message was deleted in Discord: forget it, so saving posts it again. */
const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (message.guildId) await db.delete(ruleVerificationPosts).where(eq(ruleVerificationPosts.messageId, message.id)).run();
});

/* ------------------------------------------------------------ dashboard */

async function checkRoles(guild: Guild, userId: string, s: RuleVerificationSettings) {
  if (!s.verifiedRoleId) throw new VerifyError("Pick the role people get when they agree.");
  if (s.unverifiedRoleId && s.unverifiedRoleId === s.verifiedRoleId) throw new VerifyError("The verified and unverified roles must be different.");
  if (s.giveUnverifiedOnJoin && !s.unverifiedRoleId) throw new VerifyError("Pick an unverified role to give new members, or switch that off.");
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new VerifyError("You're no longer a member of this server.");
  const rank = { position: member.roles.highest.position, isOwner: guild.ownerId === member.id };
  for (const [id, what] of [
    [s.verifiedRoleId, "Verified role"],
    [s.unverifiedRoleId, "Unverified role"],
  ] as const) {
    if (!id) continue;
    const problem = roleProblem(guild, id, rank);
    if (problem) throw new VerifyError(`${what}: ${problem.replace(/\*\*/g, "")}`);
  }
}

async function respond(guild: Guild): Promise<RuleVerificationResponse> {
  const state = await getFeatureState(guild.id, ruleVerificationFeature);
  const s = state.settings as RuleVerificationSettings;
  const post = await postOf(guild.id);
  const problems: string[] = [];
  for (const [id, what] of [
    [s.verifiedRoleId, "Verified role"],
    [s.unverifiedRoleId, "Unverified role"],
  ] as const) {
    const problem = id ? roleProblem(guild, id) : null;
    if (problem) problems.push(`${what}: ${problem.replace(/\*\*/g, "")}`);
  }
  if (state.enabled && s.channelId && !post) problems.push("The rules message isn't posted. Save to post it.");
  const role = (id: string | null) => (id ? (guild.roles.cache.get(id)?.members.size ?? null) : null);
  return {
    settings: s,
    messageUrl: post ? `https://discord.com/channels/${guild.id}/${post.channelId}/${post.messageId}` : null,
    verifiedCount: role(s.verifiedRoleId),
    unverifiedCount: role(s.unverifiedRoleId),
    problems,
  };
}

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof VerifyError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

export const ruleVerification: BotFeature = {
  info: ruleVerificationFeature,
  components: [agreeButton],
  events: [memberJoined, messageDeleted],

  async onToggle(guildId, enabled) {
    // Switched off: take the rules message down, so nobody presses a button that no longer works.
    if (!enabled) return unpublish(guildId);
    const guild = client.guilds.cache.get(guildId);
    const s = await settingsOf(guildId);
    if (guild && s.channelId && s.verifiedRoleId) await publish(guild, s).catch((err) => log(`couldn't post rules in ${guild.name}:`, err.message));
  },

  async beforeDataDelete(guildId) {
    await unpublish(guildId);
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/rule-verification", async (request: Req) => respond(client.guilds.cache.get(request.params.guildId)!));

    api.put("/api/guilds/:guildId/rule-verification", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = client.guilds.cache.get(request.params.guildId)!;
        const parsed = ruleVerificationSettings.safeParse(request.body);
        if (!parsed.success) throw new VerifyError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
        const s = parsed.data;
        await checkRoles(guild, request.session!.userId, s);
        const state = await getFeatureState(guild.id, ruleVerificationFeature);
        await saveFeatureState(guild.id, ruleVerificationFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
        if (state.enabled) await publish(guild, s);
        return respond(guild);
      }),
    );
  },
};
