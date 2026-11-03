import {
  ChannelType,
  DiscordAPIError,
  type Emoji,
  type Guild,
  GuildExplicitContentFilter,
  GuildVerificationLevel,
  OverwriteType,
  PermissionFlagsBits,
} from "discord.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import type { BotFeature } from "../../server/bot/types.js";
import { isFeatureEnabled } from "../../server/settings.js";
import {
  type CommunityToolsResponse,
  type DiscordOnboardingInput,
  ONBOARDING_MIN_CHAT_CHANNELS,
  ONBOARDING_MIN_DEFAULT_CHANNELS,
  type WelcomeScreenInput,
  convertChannelInput,
  createAnnouncementInput,
  discordOnboardingInput,
  enableCommunityInput,
  welcomeScreenInput,
} from "../../shared/communityTools.js";
import { communityToolsFeature, onboardingFeature } from "../../shared/features.js";

/**
 * Community tools: switch on Discord's Community features, make announcement channels, and edit
 * Discord's own Welcome Screen and Onboarding. Nothing is stored; every change goes straight to Discord.
 * Discord doesn't let bots edit the Server Guide's resource channels, so those aren't here.
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;

/** A problem the admin can fix, shown as-is on the dashboard. */
class FixableError extends Error {}

const REASON = "Number One community tools";
const isCommunity = (guild: Guild) => guild.features.includes("COMMUNITY");

/** Turns Discord's errors into plain words. */
function explain(err: unknown, what: string): never {
  if (err instanceof FixableError) throw err;
  if (err instanceof DiscordAPIError) {
    if (err.code === 50013 || err.code === 50001) throw new FixableError(`I'm missing a permission to ${what}. Give Number One Manage Server and Manage Channels (or Administrator).`);
    // Discord's own message is usually clear, like "Channel needs to be in a community server".
    throw new FixableError(`Discord didn't let me ${what}: ${err.message}`);
  }
  throw err;
}

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof FixableError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new FixableError(issue ? `${issue.path.join(" → ")}: ${issue.message}` : "Check the form and try again.");
}

/** Owners and Administrators only: switching Community on or off changes server-wide settings. */
async function canChangeCommunity(guild: Guild, userId: string) {
  if (guild.ownerId === userId) return true;
  const member = await guild.members.fetch(userId).catch(() => null);
  return Boolean(member?.permissions.has(PermissionFlagsBits.Administrator));
}

const emojiText = (e: Emoji | { id: string | null; name: string | null; animated?: boolean | null } | null | undefined) =>
  !e ? "" : e.id ? `<${e.animated ? "a" : ""}:${e.name ?? "emoji"}:${e.id}>` : (e.name ?? "");

/* ------------------------------------------------------------ Community on/off */

function enablePlan(guild: Guild): string[] {
  const plan: string[] = [];
  if (guild.verificationLevel < GuildVerificationLevel.Low) plan.push("Raise the verification level to Low: members need a verified email to chat.");
  if (guild.explicitContentFilter !== GuildExplicitContentFilter.AllMembers) plan.push("Turn on Discord's media filter for all members.");
  plan.push("Use a rules channel and a staff-only channel for updates from Discord (pick them, or I'll make #rules and #moderator-only).");
  plan.push("Unlock announcement channels, the Welcome Screen and Discord's own onboarding.");
  return plan;
}

async function enableCommunity(guild: Guild, input: { rulesChannelId: string | null; updatesChannelId: string | null }) {
  if (isCommunity(guild)) throw new FixableError("Community is already on.");
  const pick = (id: string | null, what: string) => {
    if (!id) return null;
    const ch = guild.channels.cache.get(id);
    if (ch?.type !== ChannelType.GuildText) throw new FixableError(`The ${what} channel must be a text channel.`);
    return ch;
  };
  if (input.rulesChannelId && input.rulesChannelId === input.updatesChannelId) throw new FixableError("Pick two different channels for rules and updates.");
  let rules = pick(input.rulesChannelId, "rules");
  let updates = pick(input.updatesChannelId, "updates");
  const made: string[] = [];
  try {
    if (!rules) {
      rules = await guild.channels.create({ name: "rules", type: ChannelType.GuildText, reason: REASON });
      made.push(rules.id);
    }
    if (!updates) {
      // Staff-only: only people who can manage the server see Discord's notices.
      updates = await guild.channels.create({
        name: "moderator-only",
        type: ChannelType.GuildText,
        reason: REASON,
        permissionOverwrites: [{ id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] }],
      });
      made.push(updates.id);
    }
    await guild.edit({
      features: [...guild.features, "COMMUNITY"],
      verificationLevel: Math.max(guild.verificationLevel, GuildVerificationLevel.Low),
      explicitContentFilter: GuildExplicitContentFilter.AllMembers,
      rulesChannel: rules,
      publicUpdatesChannel: updates,
      reason: REASON,
    });
  } catch (err) {
    // Don't leave channels behind if Discord said no.
    for (const id of made) await guild.channels.cache.get(id)?.delete(REASON).catch(() => {});
    explain(err, "switch on Community");
  }
}

async function disableCommunity(guild: Guild) {
  if (!isCommunity(guild)) throw new FixableError("Community is already off.");
  try {
    await guild.edit({ features: guild.features.filter((f) => f !== "COMMUNITY"), reason: REASON });
  } catch (err) {
    explain(err, "switch off Community");
  }
}

/* ------------------------------------------------------------ announcement channels */

async function convertChannel(guild: Guild, channelId: string, to: "announcement" | "text") {
  if (!isCommunity(guild)) throw new FixableError("Announcement channels need Community. Switch it on first.");
  const ch = guild.channels.cache.get(channelId);
  if (!ch || (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement)) throw new FixableError("That channel no longer exists, or isn't a text or announcement channel.");
  const type = to === "announcement" ? ChannelType.GuildAnnouncement : ChannelType.GuildText;
  if (ch.type === type) return;
  if (to === "announcement" && (ch.id === guild.rulesChannelId || ch.id === guild.publicUpdatesChannelId)) {
    throw new FixableError(`#${ch.name} is the server's ${ch.id === guild.rulesChannelId ? "rules" : "updates"} channel, which Discord keeps as a text channel.`);
  }
  try {
    await ch.edit({ type, reason: REASON });
  } catch (err) {
    explain(err, `change #${ch.name}`);
  }
}

async function createAnnouncement(guild: Guild, name: string, parentId: string | null) {
  if (!isCommunity(guild)) throw new FixableError("Announcement channels need Community. Switch it on first.");
  if (parentId && guild.channels.cache.get(parentId)?.type !== ChannelType.GuildCategory) throw new FixableError("That category no longer exists.");
  try {
    // Only staff can post; everyone else reads (and can follow it from their own servers).
    await guild.channels.create({
      name,
      type: ChannelType.GuildAnnouncement,
      parent: parentId ?? undefined,
      reason: REASON,
      permissionOverwrites: [{ id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.SendMessages] }],
    });
  } catch (err) {
    explain(err, "make the announcement channel");
  }
}

/* ------------------------------------------------------------ Welcome Screen */

async function readWelcomeScreen(guild: Guild): Promise<WelcomeScreenInput | null> {
  if (!isCommunity(guild)) return null;
  const ws = await guild.fetchWelcomeScreen().catch(() => null);
  return {
    enabled: ws?.enabled ?? false,
    description: ws?.description ?? "",
    channels: [...(ws?.welcomeChannels.values() ?? [])].map((c) => ({ channelId: c.channelId, description: c.description, emoji: emojiText(c.emoji) })),
  };
}

async function saveWelcomeScreen(guild: Guild, input: WelcomeScreenInput) {
  if (!isCommunity(guild)) throw new FixableError("The Welcome Screen needs Community. Switch it on first.");
  for (const c of input.channels) if (!guild.channels.cache.has(c.channelId)) throw new FixableError("One of the Welcome Screen channels no longer exists. Pick another one.");
  if (input.enabled && !input.channels.length) throw new FixableError("Add at least one channel before switching the Welcome Screen on.");
  try {
    await guild.editWelcomeScreen({
      enabled: input.enabled,
      description: input.description,
      welcomeChannels: input.channels.map((c) => ({ channel: c.channelId, description: c.description, emoji: c.emoji || undefined })),
    });
  } catch (err) {
    explain(err, "save the Welcome Screen");
  }
}

/* ------------------------------------------------------------ Discord's onboarding */

async function readOnboarding(guild: Guild): Promise<DiscordOnboardingInput | null> {
  if (!isCommunity(guild)) return null;
  const ob = await guild.fetchOnboarding().catch(() => null);
  if (!ob) return null;
  return {
    enabled: ob.enabled,
    mode: ob.mode === 1 ? 1 : 0,
    defaultChannelIds: [...ob.defaultChannels.keys()],
    prompts: [...ob.prompts.values()].map((p) => ({
      id: p.id,
      title: p.title,
      singleSelect: p.singleSelect,
      required: p.required,
      inOnboarding: p.inOnboarding,
      type: p.type === 1 ? 1 : 0,
      options: [...p.options.values()].map((o) => ({
        id: o.id,
        title: o.title,
        description: o.description ?? "",
        emoji: emojiText(o.emoji),
        roleIds: [...o.roles.keys()],
        channelIds: [...o.channels.keys()],
      })),
    })),
  };
}

/** Channels where @everyone can read and send messages (Discord needs 5 of these among the defaults). */
const everyoneCanChat = (guild: Guild, id: string) => {
  const ch = guild.channels.cache.get(id);
  return Boolean(ch && "permissionsFor" in ch && ch.permissionsFor(guild.roles.everyone)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]));
};

async function saveOnboarding(guild: Guild, input: DiscordOnboardingInput) {
  if (!isCommunity(guild)) throw new FixableError("Discord's onboarding needs Community. Switch it on first.");
  const defaults = input.defaultChannelIds.filter((id) => guild.channels.cache.has(id));
  if (input.enabled) {
    // With mode 1, channels from questions count too; Discord checks that itself, so only check mode 0 here.
    if (input.mode === 0 && defaults.length < ONBOARDING_MIN_DEFAULT_CHANNELS) {
      throw new FixableError(`Discord needs at least ${ONBOARDING_MIN_DEFAULT_CHANNELS} default channels before onboarding can be on. You've picked ${defaults.length}.`);
    }
    const chat = defaults.filter((id) => everyoneCanChat(guild, id)).length;
    if (input.mode === 0 && chat < ONBOARDING_MIN_CHAT_CHANNELS) {
      throw new FixableError(`Discord needs at least ${ONBOARDING_MIN_CHAT_CHANNELS} default channels where @everyone can send messages. ${chat} of yours allow that.`);
    }
  }
  for (const p of input.prompts) {
    for (const o of p.options) {
      o.roleIds = o.roleIds.filter((id) => guild.roles.cache.has(id));
      o.channelIds = o.channelIds.filter((id) => guild.channels.cache.has(id));
      if (!o.roleIds.length && !o.channelIds.length) throw new FixableError(`The answer "${o.title}" in "${p.title}" needs at least one role or channel.`);
    }
  }
  try {
    await guild.editOnboarding({
      enabled: input.enabled,
      mode: input.mode,
      defaultChannels: defaults,
      prompts: input.prompts.map((p) => ({
        id: p.id ?? undefined,
        title: p.title,
        singleSelect: p.singleSelect,
        required: p.required,
        inOnboarding: p.inOnboarding,
        type: p.type,
        options: p.options.map((o) => ({
          id: o.id,
          title: o.title,
          description: o.description || null,
          emoji: o.emoji || null,
          roles: o.roleIds,
          channels: o.channelIds,
        })),
      })),
      reason: REASON,
    });
  } catch (err) {
    explain(err, "save Discord's onboarding");
  }
}

/* ------------------------------------------------------------ dashboard */

async function respond(guild: Guild, userId: string): Promise<CommunityToolsResponse> {
  // Read fresh from Discord: features and channel types may have just changed.
  await guild.fetch().catch(() => {});
  const me = guild.members.me;
  const problems: string[] = [];
  if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) problems.push("I need Manage Server to change Community, the Welcome Screen and onboarding.");
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) problems.push("I need Manage Channels to make or change announcement channels.");
  const community = isCommunity(guild);
  const ourOnboardingOn = await isFeatureEnabled(guild.id, onboardingFeature);
  const [welcomeScreen, onboarding] = await Promise.all([readWelcomeScreen(guild), readOnboarding(guild)]);
  return {
    community,
    canChangeCommunity: await canChangeCommunity(guild, userId),
    enablePlan: community ? [] : enablePlan(guild),
    rulesChannelId: guild.rulesChannelId,
    updatesChannelId: guild.publicUpdatesChannelId,
    channels: [...guild.channels.cache.values()]
      .filter((c) => !c.isThread())
      .sort((a, b) => ("position" in a && "position" in b ? a.position - b.position : 0))
      .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId })),
    welcomeScreen,
    onboarding,
    ourOnboardingOn,
    problems,
  };
}

export const communityToolsBot: BotFeature = {
  info: communityToolsFeature,

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;
    const base = "/api/guilds/:guildId/community-tools";

    api.get(base, async (request: Req) => respond(guildOf(request), request.session!.userId));

    api.post(`${base}/community`, async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        if (!(await canChangeCommunity(guild, request.session!.userId))) throw new FixableError("Only the server owner or an Administrator can switch Community on or off.");
        await enableCommunity(guild, parse(enableCommunityInput, request.body));
        return respond(guild, request.session!.userId);
      }),
    );

    api.delete(`${base}/community`, async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        if (!(await canChangeCommunity(guild, request.session!.userId))) throw new FixableError("Only the server owner or an Administrator can switch Community on or off.");
        await disableCommunity(guild);
        return respond(guild, request.session!.userId);
      }),
    );

    api.post(`${base}/convert`, async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const input = parse(convertChannelInput, request.body);
        await convertChannel(guild, input.channelId, input.to);
        return respond(guild, request.session!.userId);
      }),
    );

    api.post(`${base}/announcement`, async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const input = parse(createAnnouncementInput, request.body);
        await createAnnouncement(guild, input.name, input.parentId);
        return respond(guild, request.session!.userId);
      }),
    );

    api.put(`${base}/welcome-screen`, async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        await saveWelcomeScreen(guild, parse(welcomeScreenInput, request.body));
        return respond(guild, request.session!.userId);
      }),
    );

    api.put(`${base}/onboarding`, async (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        await saveOnboarding(guild, parse(discordOnboardingInput, request.body));
        return respond(guild, request.session!.userId);
      }),
    );
  },
};
