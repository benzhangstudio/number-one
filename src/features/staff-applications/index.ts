import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  type Guild,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type ComponentHandler, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { applicationPanels, staffApplications } from "../../server/db/schema.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import {
  type AppPanelInput,
  type ApplicationView,
  QUESTIONS_PER_PAGE,
  type StaffApplicationSettings,
  type StaffApplicationsResponse,
  appPanelInput,
  applicationDecisionInput,
  staffApplicationSettings,
  staffApplicationsFeature,
} from "../../shared/features.js";
import { parseEmojiInput } from "../reaction-roles/emoji.js";
import {
  type AppRow,
  appById,
  claimApplication,
  decideApplication,
  hasDraft,
  isReviewer,
  pageModal,
  pagesOf,
  pendingCount,
  recentApplications,
  saveDraft,
  submitApplication,
  takeDraft,
  whyNot,
} from "./applications.js";
import {
  AppError,
  buildPanelMessage,
  log,
  panelDetails,
  panelOf,
  panelRowOf,
  postableChannel,
  publishPanel,
  settingsOf,
  unpublishPanel,
} from "./panel.js";

/**
 * Staff applications: an apply panel with a button per position. Members answer the position's questions
 * in pop-up forms (5 per form), and the application is posted in the staff review channel to claim,
 * accept or deny, from Discord or the dashboard.
 */

type Req = FastifyRequest<{ Params: { guildId: string; id?: string } }>;
type Interaction = Parameters<ComponentHandler["handle"]>[0];

const messageLink = (guildId: string, channelId: string, messageId: string) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/* ------------------------------------------------------------ applying */

/** Opens the first form for a position, or says privately why the member can't apply. */
async function startApplication(interaction: Interaction, positionId: string) {
  if (!interaction.inCachedGuild()) return;
  const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (!(await isFeatureEnabled(interaction.guildId, staffApplicationsFeature))) return privately("Staff applications are turned off in this server right now.");
  const position = (await panelOf(interaction.guildId))?.positions.find((p) => p.id === positionId);
  if (!position) return privately("This position no longer exists. Please let a server admin know.");
  const problem = await whyNot(interaction.member, position, await settingsOf(interaction.guildId));
  if (problem) return privately(problem);
  return interaction.showModal(pageModal(position, 1));
}

/** A dropdown keeps showing the last pick; put the panel back so the next person sees it fresh. */
async function resetMenu(interaction: Interaction) {
  if (!interaction.inCachedGuild()) return;
  const panel = await panelOf(interaction.guildId);
  if (panel) await interaction.message.edit(buildPanelMessage(interaction.guild, panel)).catch(() => {});
}

/** Pop-up for a reviewer's optional note when accepting or denying. */
function decisionModal(app: AppRow, decision: "accepted" | "denied") {
  return new ModalBuilder()
    .setCustomId(`sa:decide:${app.id}:${decision}`)
    .setTitle(`${decision === "accepted" ? "Accept" : "Deny"} application #${app.number}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("note")
          .setLabel("Note to the applicant (optional)")
          .setPlaceholder(decision === "accepted" ? "e.g. Check the staff channels to get started." : "e.g. Try again once you've been here a bit longer.")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000),
      ),
    );
}

const applicationButtons: ComponentHandler = {
  prefix: "sa",
  async handle(interaction) {
    if (!interaction.inCachedGuild()) return;
    const [, action, a, b] = interaction.customId.split(":");
    const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (action === "apply") return startApplication(interaction, a);
    if (action === "menu" && interaction.isStringSelectMenu()) {
      await startApplication(interaction, interaction.values[0]);
      return resetMenu(interaction);
    }

    // "Continue" between forms.
    if (action === "next") {
      const position = (await panelOf(interaction.guildId))?.positions.find((p) => p.id === a);
      if (!position) return privately("This position no longer exists. Please let a server admin know.");
      if (!hasDraft(interaction.guildId, interaction.user.id, a)) return privately("That took a while, so your answers expired. Please press the apply button again.");
      return interaction.showModal(pageModal(position, Number(b)));
    }

    // Review buttons in the staff channel.
    if (action === "claim" || action === "accept" || action === "deny") {
      const s = await settingsOf(interaction.guildId);
      if (!isReviewer(interaction.member, s)) return privately("Only reviewers can handle applications.");
      const app = await appById(interaction.guildId, Number(a));
      if (!app) return privately("This application no longer exists.");
      if (app.status !== "pending") return privately(`This application was already ${app.status}.`);
      if (action === "claim") {
        if (!(await claimApplication(interaction.guild, app, { id: interaction.user.id, tag: interaction.user.tag }))) {
          return privately(`${app.claimedByTag ?? "Someone"} already claimed this application.`);
        }
        return privately(`🙋 You claimed application #${app.number}.`);
      }
      return interaction.showModal(decisionModal(app, action === "accept" ? "accepted" : "denied"));
    }
  },

  async handleModal(interaction) {
    if (!interaction.inCachedGuild()) return;
    const [, action, a, b] = interaction.customId.split(":");
    const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (action === "page") {
      const position = (await panelOf(interaction.guildId))?.positions.find((p) => p.id === a);
      if (!position) return privately("This position no longer exists. Please let a server admin know.");
      const page = Number(b);
      const total = pagesOf(position);
      // Opened from our private "Continue" message (not the public panel): that message can be replaced.
      const fromContinue = interaction.isFromMessage() && interaction.message.flags.has(MessageFlags.Ephemeral);
      const onPage = position.questions.slice((page - 1) * QUESTIONS_PER_PAGE, page * QUESTIONS_PER_PAGE);
      const answers = Object.fromEntries(onPage.map((q) => [q.id, interaction.fields.fields.has(q.id) ? interaction.fields.getTextInputValue(q.id) : ""]));

      if (page < total) {
        saveDraft(interaction.guildId, interaction.user.id, position.id, answers);
        const reply = {
          content: `📝 Part ${page} of ${total} saved. Press **Continue** for the next questions.`,
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder().setCustomId(`sa:next:${position.id}:${page + 1}`).setLabel(`Continue (${page + 1}/${total})`).setStyle(ButtonStyle.Primary),
            ),
          ],
        };
        // Coming from the previous "Continue" message: replace it instead of stacking messages.
        return fromContinue && interaction.isFromMessage() ? interaction.update(reply) : interaction.reply({ ...reply, flags: MessageFlags.Ephemeral });
      }

      const earlier = total > 1 ? takeDraft(interaction.guildId, interaction.user.id, position.id) : {};
      if (!earlier) return privately("That took a while, so your earlier answers expired. Please press the apply button again.");
      const done = { content: "Sending your application…", components: [] };
      if (fromContinue && interaction.isFromMessage()) await interaction.update(done);
      else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const s = await settingsOf(interaction.guildId);
      // Checked again: something may have changed while they were typing (e.g. they applied in another tab).
      const problem = await whyNot(interaction.member, position, s);
      if (problem) return interaction.editReply({ content: problem, components: [] });
      try {
        await submitApplication(interaction.member, position, s, { ...earlier, ...answers });
      } catch (err) {
        if (err instanceof AppError) return interaction.editReply({ content: err.message, components: [] });
        throw err;
      }
      const dm = s.dmResults ? " You'll get a DM when it's decided, so keep your DMs open." : "";
      return interaction.editReply({ content: `✅ Your application for **${position.name}** was sent to the staff.${dm}`, components: [] });
    }

    if (action === "decide") {
      const s = await settingsOf(interaction.guildId);
      if (!isReviewer(interaction.member, s)) return privately("Only reviewers can handle applications.");
      const app = await appById(interaction.guildId, Number(a));
      if (!app) return privately("This application no longer exists.");
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const decision = b === "accepted" ? "accepted" : "denied";
      const note = interaction.fields.getTextInputValue("note").trim();
      const position = (await panelOf(interaction.guildId))?.positions.find((p) => p.id === app.positionId);
      try {
        const { warnings } = await decideApplication(interaction.guild, app, decision, { id: interaction.user.id, tag: interaction.user.tag }, note, s, position);
        const head = `${decision === "accepted" ? "✅ Accepted" : "❌ Denied"} application #${app.number} from ${app.applicantTag}.`;
        return interaction.editReply([head, ...warnings.map((w) => `⚠️ ${w}`)].join("\n"));
      } catch (err) {
        if (err instanceof AppError) return interaction.editReply(err.message);
        throw err;
      }
    }
  },
};

/* ------------------------------------------------------------ keeping records in step with Discord */

const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (!message.guildId) return;
  await db.update(applicationPanels).set({ messageId: null }).where(eq(applicationPanels.messageId, message.id)).run();
  await db.update(staffApplications).set({ channelId: null, messageId: null }).where(eq(staffApplications.messageId, message.id)).run();
});

/* ------------------------------------------------------------ dashboard */

function applicationView(guildId: string, a: AppRow): ApplicationView {
  return {
    id: a.id,
    number: a.number,
    positionId: a.positionId,
    positionName: a.positionName,
    status: a.status,
    applicantId: a.applicantId,
    applicantTag: a.applicantTag,
    answers: a.answers,
    claimedByTag: a.claimedByTag,
    decidedByTag: a.decidedByTag,
    decisionReason: a.decisionReason,
    messageUrl: a.channelId && a.messageId ? messageLink(guildId, a.channelId, a.messageId) : null,
    createdAt: a.createdAt.getTime(),
    decidedAt: a.decidedAt?.getTime() ?? null,
  };
}

async function respond(guild: Guild): Promise<StaffApplicationsResponse> {
  const state = await getFeatureState(guild.id, staffApplicationsFeature);
  const s = state.settings as StaffApplicationSettings;
  const row = await panelRowOf(guild.id);
  const panel = row ? panelDetails(row) : null;

  const problems: string[] = [];
  if (!s.reviewChannelId) problems.push("Pick a review channel in Settings. Until then, nobody can apply.");
  else {
    try {
      postableChannel(guild, s.reviewChannelId, "applications");
    } catch (err) {
      problems.push(`Review channel: ${(err as Error).message}`);
    }
  }
  for (const id of s.reviewerRoleIds) if (!guild.roles.cache.has(id)) problems.push("A reviewer role was deleted. Pick it again in Settings.");
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) && panel?.positions.some((p) => p.roleIds.length)) {
    problems.push("I need the Manage Roles permission to give roles when an application is accepted.");
  }
  if (panel) {
    for (const p of panel.positions) {
      for (const id of p.roleIds) {
        const role = guild.roles.cache.get(id);
        if (!role) problems.push(`${p.name}: a role it gives was deleted.`);
        else if (role.position >= (guild.members.me?.roles.highest.position ?? 0)) problems.push(`${p.name}: move my role above @${role.name} so I can give it.`);
      }
    }
    if (!state.enabled) problems.push("Staff applications is switched off, so the panel isn't posted. Switch it on to post it.");
    else if (!row?.messageId) problems.push("The apply panel isn't posted. Save it to post it again.");
  }

  return {
    settings: s,
    panel: panel && row ? { ...panel, messageUrl: row.messageId ? messageLink(guild.id, row.channelId, row.messageId) : null } : null,
    applications: (await recentApplications(guild.id)).map((a) => applicationView(guild.id, a)),
    pendingCount: await pendingCount(guild.id),
    problems,
  };
}

function checkPanel(guild: Guild, p: AppPanelInput) {
  postableChannel(guild, p.channelId);
  for (const pos of p.positions) {
    if (pos.emoji) {
      const parsed = parseEmojiInput(pos.emoji, guild);
      if ("error" in parsed) throw new AppError(`${pos.name}: ${parsed.error}`);
    }
    for (const id of [...pos.roleIds, ...pos.requiredRoleIds]) {
      if (!guild.roles.cache.has(id) || id === guild.id) throw new AppError(`${pos.name}: pick roles that exist (not @everyone).`);
    }
    for (const id of pos.roleIds) {
      const role = guild.roles.cache.get(id)!;
      if (role.managed) throw new AppError(`${pos.name}: @${role.name} belongs to a bot or integration and can't be given out.`);
    }
  }
}

function checkSettings(guild: Guild, s: StaffApplicationSettings) {
  for (const id of s.reviewerRoleIds) if (!guild.roles.cache.has(id) || id === guild.id) throw new AppError("Pick reviewer roles that exist (not @everyone).");
  if (s.reviewChannelId) postableChannel(guild, s.reviewChannelId, "applications");
}

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AppError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

/** What's stored in the details column: everything except the channel, which has its own column. */
const detailsOf = ({ channelId: _channel, ...rest }: AppPanelInput): Record<string, unknown> => rest;

async function postSavedPanel(guild: Guild) {
  const row = await panelRowOf(guild.id);
  const p = row ? panelDetails(row) : null;
  if (!row || !p) return;
  const messageId = await publishPanel(guild, p, row);
  await db.update(applicationPanels).set({ messageId }).where(eq(applicationPanels.guildId, guild.id)).run();
}

export const staffApplicationsBot: BotFeature = {
  info: staffApplicationsFeature,
  components: [applicationButtons],
  events: [messageDeleted],

  async onToggle(guildId, enabled) {
    const guild = client.guilds.cache.get(guildId);
    const row = await panelRowOf(guildId);
    if (!row) return;
    // Switched off: take the panel down so nobody presses a button that no longer works. Applications stay.
    if (!enabled) return unpublishPanel(guild, row);
    if (guild) await postSavedPanel(guild).catch((err) => log(`couldn't post the panel in ${guild.name}:`, err.message));
  },

  async beforeDataDelete(guildId) {
    const row = await panelRowOf(guildId);
    if (row) await unpublishPanel(client.guilds.cache.get(guildId), row);
  },

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;

    api.get("/api/guilds/:guildId/staff-applications", async (request: Req) => respond(guildOf(request)));

    api.put("/api/guilds/:guildId/staff-applications/settings", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const parsed = staffApplicationSettings.safeParse(request.body);
        if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
        checkSettings(guild, parsed.data);
        const state = await getFeatureState(guild.id, staffApplicationsFeature);
        await saveFeatureState(guild.id, staffApplicationsFeature, { enabled: state.enabled, settings: parsed.data }, request.session!.userId);
        return respond(guild);
      }),
    );

    api.put("/api/guilds/:guildId/staff-applications/panel", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const parsed = appPanelInput.safeParse(request.body);
        if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
        const p = parsed.data;
        checkPanel(guild, p);
        const old = await panelRowOf(guild.id);
        let messageId: string | null = old?.messageId ?? null;
        if (await isFeatureEnabled(guild.id, staffApplicationsFeature)) messageId = await publishPanel(guild, p, old);
        else if (old && old.channelId !== p.channelId) {
          await unpublishPanel(guild, old);
          messageId = null;
        }
        const values = { channelId: p.channelId, messageId, details: detailsOf(p), updatedBy: request.session!.userId, updatedAt: new Date() };
        await db
          .insert(applicationPanels)
          .values({ guildId: guild.id, ...values })
          .onConflictDoUpdate({ target: applicationPanels.guildId, set: values })
          .run();
        return respond(guild);
      }),
    );

    api.delete("/api/guilds/:guildId/staff-applications/panel", async (request: Req) => {
      const guild = guildOf(request);
      const row = await panelRowOf(guild.id);
      if (row) {
        await unpublishPanel(guild, row);
        await db.delete(applicationPanels).where(eq(applicationPanels.guildId, guild.id)).run();
      }
      return respond(guild);
    });

    // Accept or deny from the dashboard, with the same result as the buttons in Discord.
    api.post("/api/guilds/:guildId/staff-applications/:id/decision", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const parsed = applicationDecisionInput.safeParse(request.body);
        if (!parsed.success) throw new AppError("Check the form and try again.");
        const app = await appById(guild.id, Number(request.params.id));
        if (!app) return reply.code(404).send({ error: "That application no longer exists." });
        const s = await settingsOf(guild.id);
        const position = (await panelOf(guild.id))?.positions.find((p) => p.id === app.positionId);
        const user = await client.users.fetch(request.session!.userId).catch(() => null);
        const by = { id: request.session!.userId, tag: user?.tag ?? request.session!.username };
        const { warnings } = await decideApplication(guild, app, parsed.data.decision, by, parsed.data.reason, s, position);
        return { ...(await respond(guild)), warnings };
      }),
    );
  },
};
