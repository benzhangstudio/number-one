import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  Events,
  type Guild,
  type GuildMember,
  InteractionContextType,
  PermissionFlagsBits,
} from "discord.js";
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, onEvent } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { customCommands } from "../../server/db/schema.js";
import { getFeatureState, isFeatureEnabled } from "../../server/settings.js";
import {
  type CustomCommandInput,
  type CustomCommandView,
  type CustomCommandsResponse,
  MAX_CUSTOM_COMMANDS,
  RESERVED_NAMES,
  customCommandInput,
  replyProblem,
} from "../../shared/customCommands.js";
import { customCommandsFeature } from "../../shared/features.js";

/**
 * Custom commands: slash commands admins make for their own server. Each one is registered in that
 * server only (a "guild command"), and replies publicly with the admin's text and/or embed.
 */

type Row = typeof customCommands.$inferSelect;
type Req = FastifyRequest<{ Params: { guildId: string; id?: string } }>;

/** A problem the admin can fix, shown as-is on the dashboard. */
class CommandError extends Error {}

const log = (...args: unknown[]) => console.warn("[custom-commands]", ...args);

/* ------------------------------------------------------------ store */

function detailsOf(row: Row): CustomCommandInput {
  const parsed = customCommandInput.safeParse({ ...row.details, name: row.name });
  return parsed.success ? parsed.data : customCommandInput.parse({ name: row.name, description: "Custom command", content: "…" });
}

const listRows = (guildId: string) => db.select().from(customCommands).where(eq(customCommands.guildId, guildId)).orderBy(asc(customCommands.name)).all();

const toView = (r: Row): CustomCommandView => ({ ...detailsOf(r), id: r.id, uses: r.uses, updatedAt: r.updatedAt.getTime() });

/* ------------------------------------------------------------ registering with Discord */

/**
 * Makes the server's slash commands match its custom commands: adds new ones, updates changed descriptions
 * and removes deleted ones. Number One's own command names are never touched (in a test server they're
 * registered there too).
 */
async function syncGuild(guild: Guild) {
  const enabled = await isFeatureEnabled(guild.id, customCommandsFeature);
  const wanted = enabled ? (await listRows(guild.id)).map(detailsOf) : [];
  const existing = await guild.commands.fetch();
  for (const command of existing.values()) {
    if (RESERVED_NAMES.includes(command.name)) continue;
    const match = wanted.find((w) => w.name === command.name);
    if (!match) await command.delete();
    else if (command.description !== match.description) await command.edit({ description: match.description });
  }
  for (const w of wanted) {
    if (!existing.some((c) => c.name === w.name)) {
      await guild.commands.create({ name: w.name, description: w.description, contexts: [InteractionContextType.Guild] });
    }
  }
}

/** Syncs and turns Discord's errors into plain words. */
async function syncOrExplain(guild: Guild) {
  try {
    await syncGuild(guild);
  } catch (err) {
    log(`sync failed in ${guild.name} (${guild.id}):`, (err as Error).message);
    throw new CommandError(
      "Saved, but Discord didn't accept the command list. If Number One was added without the commands permission, add it again from the dashboard.",
    );
  }
}

/* ------------------------------------------------------------ using a command */

function fill(text: string, i: ChatInputCommandInteraction) {
  const member = i.member as GuildMember | null;
  return text
    .replaceAll("{user}", `<@${i.user.id}>`)
    .replaceAll("{username}", member?.displayName ?? i.user.username)
    .replaceAll("{server}", i.guild?.name ?? "")
    .replaceAll("{channel}", `<#${i.channelId}>`)
    .replaceAll("{memberCount}", (i.guild?.memberCount ?? 0).toLocaleString("en-US"));
}

function replyFor(c: CustomCommandInput, i: ChatInputCommandInteraction) {
  const embeds: EmbedBuilder[] = [];
  if (c.useEmbed) {
    const e = c.embed;
    const embed = new EmbedBuilder().setColor(Number.parseInt(e.color.slice(1), 16));
    if (e.title) embed.setTitle(fill(e.title, i).slice(0, 256));
    if (e.description.trim()) embed.setDescription(fill(e.description, i).slice(0, 4096));
    if (e.image) embed.setImage(e.image);
    if (e.footer) embed.setFooter({ text: fill(e.footer, i).slice(0, 2048) });
    embeds.push(embed);
  }
  // Only the person who used it can be pinged, never @everyone or roles.
  return { content: fill(c.content, i).slice(0, 2000) || undefined, embeds, allowedMentions: { users: [i.user.id] } };
}

/** Answers custom commands. Number One's own commands are answered by the main command router instead. */
const commandUsed = onEvent(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild() || interaction.commandGuildId !== interaction.guildId) return;
  if (RESERVED_NAMES.includes(interaction.commandName)) return;
  const row = await db
    .select()
    .from(customCommands)
    .where(and(eq(customCommands.guildId, interaction.guildId), eq(customCommands.name, interaction.commandName)))
    .get();
  if (!row) return;
  if (!(await isFeatureEnabled(interaction.guildId, customCommandsFeature))) {
    return interaction.reply("Custom commands are turned off in this server right now.");
  }
  const c = detailsOf(row);
  if (c.allowedRoleIds.length && !c.allowedRoleIds.some((id) => interaction.member.roles.cache.has(id))) {
    return interaction.reply({ content: `Only ${c.allowedRoleIds.map((id) => `<@&${id}>`).join(", ")} can use /${c.name}.`, allowedMentions: { parse: [] } });
  }
  await interaction.reply(replyFor(c, interaction));
  await db.update(customCommands).set({ uses: sql`${customCommands.uses} + 1` }).where(eq(customCommands.id, row.id)).run();
});

/* ------------------------------------------------------------ dashboard */

async function checkInput(guild: Guild, c: CustomCommandInput, id?: number) {
  if (RESERVED_NAMES.includes(c.name)) throw new CommandError(`/${c.name} is already one of Number One's commands. Pick another name.`);
  const taken = await db
    .select({ id: customCommands.id })
    .from(customCommands)
    .where(and(eq(customCommands.guildId, guild.id), eq(customCommands.name, c.name)))
    .get();
  if (taken && taken.id !== id) throw new CommandError(`There's already a /${c.name} command.`);
  const problem = replyProblem(c);
  if (problem) throw new CommandError(problem);
  c.allowedRoleIds = c.allowedRoleIds.filter((r) => guild.roles.cache.has(r));
}

async function respond(guild: Guild): Promise<CustomCommandsResponse> {
  const problems: string[] = [];
  const state = await getFeatureState(guild.id, customCommandsFeature);
  if (state.enabled && !guild.members.me?.permissions.has(PermissionFlagsBits.SendMessages)) problems.push("I need Send Messages to reply to commands.");
  return { commands: (await listRows(guild.id)).map(toView), problems };
}

async function guarded(reply: FastifyReply, run: () => Promise<unknown>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof CommandError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

function parseInput(body: unknown): CustomCommandInput {
  const parsed = customCommandInput.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new CommandError(issue ? issue.message : "Check the form and try again.");
}

const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;

export const customCommandsBot: BotFeature = {
  info: customCommandsFeature,
  events: [commandUsed],

  setup(c) {
    // Bring every server's commands in line after a restart (edits made while offline, or the feature switched off).
    c.once(Events.ClientReady, async () => {
      const guildIds = new Set((await db.selectDistinct({ id: customCommands.guildId }).from(customCommands).all()).map((r) => r.id));
      for (const id of guildIds) {
        const guild = c.guilds.cache.get(id);
        if (guild) await syncGuild(guild).catch((err) => log(`startup sync failed in ${guild.name}:`, err.message));
      }
    });
  },

  async onToggle(guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) await syncGuild(guild).catch((err) => log(`sync failed in ${guild.name}:`, err.message));
  },

  async beforeDataDelete(guildId) {
    await db.delete(customCommands).where(eq(customCommands.guildId, guildId)).run();
    const guild = client.guilds.cache.get(guildId);
    if (guild) await syncGuild(guild).catch(() => {});
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/custom-commands", async (request: Req) => respond(guildOf(request)));

    api.post("/api/guilds/:guildId/custom-commands", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const c = parseInput(request.body);
        await checkInput(guild, c);
        const total = (await db.select({ n: count() }).from(customCommands).where(eq(customCommands.guildId, guild.id)).get())?.n ?? 0;
        if (total >= MAX_CUSTOM_COMMANDS) throw new CommandError(`You can have up to ${MAX_CUSTOM_COMMANDS} custom commands. Delete one first.`);
        const { name, ...details } = c;
        await db.insert(customCommands).values({ guildId: guild.id, name, details, createdBy: request.session!.userId, updatedAt: new Date() }).run();
        await syncOrExplain(guild);
        return respond(guild);
      }),
    );

    api.put("/api/guilds/:guildId/custom-commands/:id", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const id = Number(request.params.id);
        const c = parseInput(request.body);
        await checkInput(guild, c, id);
        const { name, ...details } = c;
        await db
          .update(customCommands)
          .set({ name, details, updatedAt: new Date() })
          .where(and(eq(customCommands.guildId, guild.id), eq(customCommands.id, id)))
          .run();
        await syncOrExplain(guild);
        return respond(guild);
      }),
    );

    api.delete("/api/guilds/:guildId/custom-commands/:id", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        await db.delete(customCommands).where(and(eq(customCommands.guildId, guild.id), eq(customCommands.id, Number(request.params.id)))).run();
        await syncOrExplain(guild);
        return respond(guild);
      }),
    );
  },
};
