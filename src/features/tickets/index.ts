import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  Events,
  type Guild,
  type GuildMember,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type ComponentHandler, type SlashCommand, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { ticketPanels, tickets } from "../../server/db/schema.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import { ticketsFeature } from "../../shared/features.js";
import {
  MAX_TICKET_PANELS,
  type TicketPanelInput,
  type TicketPanelView,
  type TicketSettings,
  type TicketView,
  type TicketsResponse,
  ticketPanelInput,
  ticketSettings,
} from "../../shared/tickets.js";
import { parseEmojiInput } from "../reaction-roles/emoji.js";
import {
  type PanelRow,
  TicketError,
  buildPanelMessage,
  log,
  panelDetails,
  panelsOf,
  postableChannel,
  publishPanel,
  settingsOf,
  unpublishPanel,
} from "./panels.js";
import {
  type TicketRow,
  addToTicket,
  canClose,
  claimTicket,
  closeTicket,
  isStaff,
  markGone,
  openCount,
  openTicket,
  openTicketIn,
  openTicketsOf,
  recentTickets,
  removeFromTicket,
  ticketControls,
} from "./tickets.js";

/**
 * Tickets: panels with buttons or a dropdown open a private channel between a member and the staff.
 * Staff can claim a ticket, add people with /ticket add, and close it; closing logs a transcript.
 */

type Req = FastifyRequest<{ Params: { guildId: string; panelId?: string } }>;

/** Members whose ticket is being created right now, so a double-click can't open two. */
const opening = new Set<string>();

const panelRow = (guildId: string, id: number) =>
  db.select().from(ticketPanels).where(and(eq(ticketPanels.guildId, guildId), eq(ticketPanels.id, id))).get();

const channelLink = (guildId: string, channelId: string) => `https://discord.com/channels/${guildId}/${channelId}`;

/* ------------------------------------------------------------ opening a ticket from a panel */

/** Checks shared by the button, the dropdown and the reason pop-up. Returns a message to show, or the ticket type. */
async function prepare(guild: Guild, member: GuildMember, panelId: number, typeId: string) {
  if (!(await isFeatureEnabled(guild.id, ticketsFeature))) return { blocked: "Tickets are turned off in this server right now." };
  const row = await panelRow(guild.id, panelId);
  const panel = row ? panelDetails(row) : null;
  const type = panel?.types.find((t) => t.id === typeId);
  if (!type) return { blocked: "This ticket type no longer exists. Please let a server admin know." };
  const s = await settingsOf(guild.id);
  const open = await openTicketsOf(guild.id, member.id);
  // Channels deleted while Number One was offline don't count.
  const live = open.filter((t) => guild.channels.cache.has(t.channelId));
  for (const t of open) if (!live.includes(t)) await markGone(t.channelId);
  if (live.length >= s.maxOpenPerUser) {
    const links = live.map((t) => `<#${t.channelId}>`).join(", ");
    return { blocked: `You already have ${live.length === 1 ? "an open ticket" : `${live.length} open tickets`}: ${links}. Please use ${live.length === 1 ? "it" : "those"} or close one first.` };
  }
  if (opening.has(`${guild.id}:${member.id}`)) return { blocked: "Your ticket is already being opened…" };
  return { type };
}

async function startTicket(
  interaction: Parameters<ComponentHandler["handle"]>[0],
  panelId: number,
  typeId: string,
) {
  if (!interaction.inCachedGuild()) return;
  const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  const ready = await prepare(interaction.guild, interaction.member, panelId, typeId);
  if ("blocked" in ready) return privately(ready.blocked!);
  const type = ready.type;

  if (type.askReason) {
    const modal = new ModalBuilder()
      .setCustomId(`tk:reason:${panelId}:${typeId}`)
      .setTitle(type.label.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("reason").setLabel(type.reasonLabel).setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true),
        ),
      );
    return interaction.showModal(modal);
  }
  return create(interaction, panelId, type, null);
}

/** Opens the ticket and tells the member where it is (privately). */
async function create(
  interaction: { guild: Guild; member: GuildMember; deferReply(o: { flags: MessageFlags.Ephemeral }): Promise<unknown>; editReply(c: string): Promise<unknown> },
  panelId: number,
  type: Parameters<typeof openTicket>[2],
  reason: string | null,
) {
  const key = `${interaction.guild.id}:${interaction.member.id}`;
  opening.add(key);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await openTicket(interaction.member, panelId, type, reason);
    return interaction.editReply(`🎫 Your ticket is open: ${channel}`);
  } catch (err) {
    if (err instanceof TicketError) return interaction.editReply(err.message);
    throw err;
  } finally {
    opening.delete(key);
  }
}

/** A dropdown keeps showing the last pick; put the panel back so the next person sees it fresh. */
async function resetMenu(interaction: Parameters<ComponentHandler["handle"]>[0], panelId: number) {
  if (!interaction.inCachedGuild()) return;
  const row = await panelRow(interaction.guildId, panelId);
  const panel = row ? panelDetails(row) : null;
  if (panel) await interaction.message.edit(buildPanelMessage(interaction.guild, panelId, panel)).catch(() => {});
}

/* ------------------------------------------------------------ buttons inside a ticket */

async function inTicket(interaction: Parameters<ComponentHandler["handle"]>[0]) {
  if (!interaction.inCachedGuild()) return null;
  const ticket = await openTicketIn(interaction.channelId);
  if (!ticket) {
    await interaction.reply({ content: "This ticket is already closed.", flags: MessageFlags.Ephemeral });
    return null;
  }
  return { ticket, s: await settingsOf(interaction.guildId) };
}

const ticketButtons: ComponentHandler = {
  prefix: "tk",
  async handle(interaction) {
    if (!interaction.inCachedGuild()) return;
    const [, action, a, b] = interaction.customId.split(":");
    const privately = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (action === "open") return startTicket(interaction, Number(a), b);
    if (action === "menu" && interaction.isStringSelectMenu()) {
      await startTicket(interaction, Number(a), interaction.values[0]);
      return resetMenu(interaction, Number(a));
    }

    if (action === "close") {
      const found = await inTicket(interaction);
      if (!found) return;
      if (!canClose(interaction.member, found.ticket, found.s)) return privately("Only the staff can close this ticket.");
      return interaction.reply({
        content: "Close this ticket? The channel will be deleted and a transcript saved.",
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("tk:confirm").setLabel("Close ticket").setStyle(ButtonStyle.Danger).setEmoji("🔒"),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === "confirm") {
      const found = await inTicket(interaction);
      if (!found) return;
      if (!canClose(interaction.member, found.ticket, found.s)) return privately("Only the staff can close this ticket.");
      await interaction.update({ content: "Closing…", components: [] });
      await closeTicket(interaction.guild, found.ticket, interaction.user, null);
      return;
    }

    if (action === "claim") {
      const found = await inTicket(interaction);
      if (!found) return;
      if (!isStaff(interaction.member, found.ticket, found.s)) return privately("Only the staff can claim tickets.");
      if (found.ticket.claimedById) return privately(`${found.ticket.claimedByTag} already claimed this ticket.`);
      await claimTicket(found.ticket, interaction.user);
      await interaction.update({ components: ticketControls(interaction.user.tag) });
      await interaction.channel?.send({ content: `🙋 ${interaction.member} claimed this ticket and will help you.`, allowedMentions: { parse: [] } });
    }
  },

  async handleModal(interaction) {
    if (!interaction.inCachedGuild()) return;
    const [, action, a, b] = interaction.customId.split(":");
    if (action !== "reason") return;
    // Checked again: things may have changed while the pop-up was open.
    const ready = await prepare(interaction.guild, interaction.member, Number(a), b);
    if ("blocked" in ready) return interaction.reply({ content: ready.blocked!, flags: MessageFlags.Ephemeral });
    const reason = interaction.fields.getTextInputValue("reason").trim() || null;
    return create(interaction, Number(a), ready.type, reason);
  },
};

/* ------------------------------------------------------------ /ticket */

const ticketCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Manage the ticket you're in")
    .setDMPermission(false)
    .addSubcommand((c) =>
      c
        .setName("add")
        .setDescription("Let someone see and talk in this ticket (staff)")
        .addUserOption((o) => o.setName("member").setDescription("Who to add").setRequired(true)),
    )
    .addSubcommand((c) =>
      c
        .setName("remove")
        .setDescription("Remove someone you added from this ticket (staff)")
        .addUserOption((o) => o.setName("member").setDescription("Who to remove").setRequired(true)),
    )
    .addSubcommand((c) =>
      c
        .setName("close")
        .setDescription("Close this ticket and save a transcript")
        .addStringOption((o) => o.setName("reason").setDescription("Why it's being closed").setMaxLength(500)),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const ticket = await openTicketIn(interaction.channelId);
    if (!ticket) return interaction.reply("Use this inside an open ticket.");
    const s = await settingsOf(interaction.guildId);
    const channel = interaction.channel as TextChannel;
    const sub = interaction.options.getSubcommand();

    if (sub === "close") {
      if (!canClose(interaction.member, ticket, s)) return interaction.reply("Only the staff can close this ticket.");
      const reason = interaction.options.getString("reason");
      await interaction.reply(`🔒 Closing ticket #${ticket.number}…`);
      return closeTicket(interaction.guild, ticket, interaction.user, reason);
    }

    if (!isStaff(interaction.member, ticket, s)) return interaction.reply("Only the staff can add or remove people.");
    const user = interaction.options.getUser("member", true);
    if (sub === "add") {
      await addToTicket(channel, user);
      return interaction.reply({ content: `➕ Added ${user} to this ticket.`, allowedMentions: { users: [user.id] } });
    }
    if (user.id === ticket.openerId) return interaction.reply("You can't remove the person who opened the ticket. Close it instead.");
    if (user.id === client.user?.id) return interaction.reply("I need to stay in the ticket to run it.");
    await removeFromTicket(channel, user);
    return interaction.reply({ content: `➖ Removed ${user} from this ticket.`, allowedMentions: { parse: [] } });
  },
};

/* ------------------------------------------------------------ keeping records in step with Discord */

const channelDeleted = onEvent(Events.ChannelDelete, async (channel) => {
  if (!channel.isDMBased()) await markGone(channel.id);
});

const messageDeleted = onEvent(Events.MessageDelete, async (message) => {
  if (message.guildId) await db.update(ticketPanels).set({ messageId: null }).where(eq(ticketPanels.messageId, message.id)).run();
});

/* ------------------------------------------------------------ dashboard */

function panelView(guildId: string, row: PanelRow): TicketPanelView | null {
  const p = panelDetails(row);
  if (!p) return null;
  return { ...p, id: row.id, messageUrl: row.messageId ? `${channelLink(guildId, row.channelId)}/${row.messageId}` : null };
}

function ticketView(guildId: string, t: TicketRow): TicketView {
  return {
    id: t.id,
    number: t.number,
    type: t.type,
    status: t.status,
    openerId: t.openerId,
    openerTag: t.openerTag,
    reason: t.reason,
    claimedByTag: t.claimedByTag,
    closedByTag: t.closedByTag,
    closeReason: t.closeReason,
    channelUrl: t.status === "open" ? channelLink(guildId, t.channelId) : null,
    createdAt: t.createdAt.getTime(),
    closedAt: t.closedAt?.getTime() ?? null,
  };
}

async function respond(guild: Guild): Promise<TicketsResponse> {
  const state = await getFeatureState(guild.id, ticketsFeature);
  const s = state.settings as TicketSettings;
  const rows = await panelsOf(guild.id);
  const panels = rows.map((r) => panelView(guild.id, r)).filter((p): p is TicketPanelView => Boolean(p));

  const problems: string[] = [];
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) problems.push("I need the Manage Channels permission to open tickets.");
  if (!s.staffRoleIds.length) problems.push("No staff roles picked: only people with Manage Channels will see tickets.");
  for (const id of s.staffRoleIds) if (!guild.roles.cache.has(id)) problems.push("A ticket staff role was deleted. Pick it again in Settings.");
  if (s.categoryId) {
    const cat = guild.channels.cache.get(s.categoryId);
    if (cat?.type !== ChannelType.GuildCategory) problems.push("The ticket category was deleted. New tickets open at the top of the channel list.");
    else if (cat.children.cache.size >= 50) problems.push(`The ${cat.name} category is full (50 channels). New tickets open at the top of the channel list.`);
  }
  if (s.logChannelId) {
    try {
      postableChannel(guild, s.logChannelId, "ticket logs");
    } catch (err) {
      problems.push(`Ticket logs: ${(err as Error).message}`);
    }
  }
  if (state.enabled) {
    for (const p of panels) if (!p.messageUrl) problems.push(`The panel "${p.title || "Untitled"}" isn't posted. Save it to post it again.`);
  } else if (panels.length) {
    problems.push("Tickets is switched off, so panels aren't posted. Switch it on to post them.");
  }

  return {
    settings: s,
    panels,
    tickets: (await recentTickets(guild.id)).map((t) => ticketView(guild.id, t)),
    openCount: await openCount(guild.id),
    problems,
  };
}

function checkPanel(guild: Guild, p: TicketPanelInput) {
  postableChannel(guild, p.channelId);
  for (const t of p.types) {
    if (t.emoji) {
      const parsed = parseEmojiInput(t.emoji, guild);
      if ("error" in parsed) throw new TicketError(`${t.label}: ${parsed.error}`);
    }
    if (t.categoryId && guild.channels.cache.get(t.categoryId)?.type !== ChannelType.GuildCategory) {
      throw new TicketError(`${t.label}: that category no longer exists.`);
    }
    for (const id of t.staffRoleIds) if (!guild.roles.cache.has(id)) throw new TicketError(`${t.label}: a staff role no longer exists.`);
  }
}

function checkSettings(guild: Guild, s: TicketSettings) {
  for (const id of s.staffRoleIds) if (!guild.roles.cache.has(id) || id === guild.id) throw new TicketError("Pick staff roles that exist (not @everyone).");
  if (s.categoryId && guild.channels.cache.get(s.categoryId)?.type !== ChannelType.GuildCategory) throw new TicketError("That category no longer exists.");
  if (s.logChannelId) postableChannel(guild, s.logChannelId, "ticket logs");
}

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof TicketError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

function parsePanel(body: unknown) {
  const parsed = ticketPanelInput.safeParse(body);
  if (!parsed.success) throw new TicketError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  return parsed.data;
}

/** What's stored in the details column: everything except the channel, which has its own column. */
const detailsOf = ({ channelId: _channel, ...rest }: TicketPanelInput): Record<string, unknown> => rest;

export const ticketsBot: BotFeature = {
  info: ticketsFeature,
  commands: [ticketCommand],
  components: [ticketButtons],
  events: [channelDeleted, messageDeleted],

  setup(c) {
    // Tickets whose channel was deleted while Number One was offline.
    c.once(Events.ClientReady, async () => {
      const open = await db.select().from(tickets).where(eq(tickets.status, "open")).all();
      for (const t of open) {
        const guild = c.guilds.cache.get(t.guildId);
        if (guild && !guild.channels.cache.has(t.channelId)) await markGone(t.channelId);
      }
    });
  },

  async onToggle(guildId, enabled) {
    const guild = client.guilds.cache.get(guildId);
    const rows = await panelsOf(guildId);
    // Switched off: take panels down so nobody presses a button that no longer works. Open tickets stay.
    if (!enabled) {
      for (const row of rows) await unpublishPanel(guild, row);
      return;
    }
    if (!guild) return;
    for (const row of rows) {
      const p = panelDetails(row);
      if (p) await publishPanel(guild, row.id, p, row).catch((err) => log(`couldn't post a panel in ${guild.name}:`, err.message));
    }
  },

  async beforeDataDelete(guildId) {
    const guild = client.guilds.cache.get(guildId);
    for (const row of await panelsOf(guildId)) await unpublishPanel(guild, row);
  },

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;

    api.get("/api/guilds/:guildId/tickets", async (request: Req) => respond(guildOf(request)));

    api.put("/api/guilds/:guildId/tickets/settings", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const parsed = ticketSettings.safeParse(request.body);
        if (!parsed.success) throw new TicketError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
        checkSettings(guild, parsed.data);
        const state = await getFeatureState(guild.id, ticketsFeature);
        await saveFeatureState(guild.id, ticketsFeature, { enabled: state.enabled, settings: parsed.data }, request.session!.userId);
        return respond(guild);
      }),
    );

    api.post("/api/guilds/:guildId/tickets/panels", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const p = parsePanel(request.body);
        if ((await panelsOf(guild.id)).length >= MAX_TICKET_PANELS) throw new TicketError(`A server can have up to ${MAX_TICKET_PANELS} panels.`);
        checkPanel(guild, p);
        const [row] = await db
          .insert(ticketPanels)
          .values({ guildId: guild.id, channelId: p.channelId, details: detailsOf(p), createdBy: request.session!.userId, updatedAt: new Date() })
          .returning()
          .all();
        if (await isFeatureEnabled(guild.id, ticketsFeature)) {
          try {
            await publishPanel(guild, row.id, p, { channelId: p.channelId, messageId: null });
          } catch (err) {
            await db.delete(ticketPanels).where(eq(ticketPanels.id, row.id)).run(); // nothing half-made
            throw err;
          }
        }
        return respond(guild);
      }),
    );

    api.put("/api/guilds/:guildId/tickets/panels/:panelId", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const row = await panelRow(guild.id, Number(request.params.panelId));
        if (!row) return reply.code(404).send({ error: "That panel no longer exists." });
        const p = parsePanel(request.body);
        checkPanel(guild, p);
        if (await isFeatureEnabled(guild.id, ticketsFeature)) await publishPanel(guild, row.id, p, row);
        else if (row.channelId !== p.channelId) await unpublishPanel(guild, row);
        await db
          .update(ticketPanels)
          .set({ channelId: p.channelId, details: detailsOf(p), updatedAt: new Date() })
          .where(eq(ticketPanels.id, row.id))
          .run();
        return respond(guild);
      }),
    );

    api.delete("/api/guilds/:guildId/tickets/panels/:panelId", async (request: Req, reply) => {
      const guild = guildOf(request);
      const row = await panelRow(guild.id, Number(request.params.panelId));
      if (!row) return reply.code(404).send({ error: "That panel no longer exists." });
      await unpublishPanel(guild, row);
      await db.delete(ticketPanels).where(eq(ticketPanels.id, row.id)).run();
      return respond(guild);
    });
  },
};
