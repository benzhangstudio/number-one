import {
  ApplicationCommandOptionType,
  type ApplicationCommandData,
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
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import {
  BUILT_IN_NAMES,
  type CustomCommandInput,
  type CustomCommandSettings,
  type CustomCommandView,
  type CustomCommandsResponse,
  MAX_CUSTOM_COMMANDS,
  RESERVED_NAMES,
  RULES_COMMAND,
  type RulesSettings,
  customCommandInput,
  replyProblem,
  rulesSettings,
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

async function rulesOf(guildId: string): Promise<RulesSettings> {
  return ((await getFeatureState(guildId, customCommandsFeature)).settings as CustomCommandSettings).rules;
}

/** The /rule command as Discord needs it: an optional rule number, with suggestions as people type. */
function rulesCommand(rules: RulesSettings): ApplicationCommandData {
  return {
    name: RULES_COMMAND,
    description: "Post one of the server's rules, or all of them",
    contexts: [InteractionContextType.Guild],
    options: [
      {
        type: ApplicationCommandOptionType.Integer,
        name: "number",
        description: "Which rule (leave empty for all of them)",
        required: false,
        minValue: 1,
        maxValue: Math.max(1, rules.rules.length),
        autocomplete: true,
      },
    ],
  };
}

/**
 * Makes the server's slash commands match its custom commands (and /rule): adds new ones, updates changed
 * ones and removes deleted ones. Number One's own command names are never touched (in a test server
 * they're registered there too).
 */
async function syncGuild(guild: Guild) {
  const state = await getFeatureState(guild.id, customCommandsFeature);
  const rules = (state.settings as CustomCommandSettings).rules;
  const wanted: ApplicationCommandData[] = state.enabled
    ? (await listRows(guild.id)).map(detailsOf).map((c) => ({ name: c.name, description: c.description, contexts: [InteractionContextType.Guild] }))
    : [];
  if (state.enabled && rules.enabled && rules.rules.length) wanted.push(rulesCommand(rules));
  const existing = await guild.commands.fetch();
  for (const command of existing.values()) {
    if (BUILT_IN_NAMES.includes(command.name)) continue;
    const match = wanted.find((w) => w.name === command.name);
    if (!match) await command.delete();
    else if (command.name === RULES_COMMAND || ("description" in match && command.description !== match.description)) await command.edit(match);
  }
  for (const w of wanted) {
    if (!existing.some((c) => c.name === w.name)) await guild.commands.create(w);
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

/* ------------------------------------------------------------ /rule */

const ruleColor = (r: RulesSettings) => Number.parseInt(r.color.slice(1), 16);

/** One rule, or the whole list when no number is given. Always public. */
async function answerRule(interaction: ChatInputCommandInteraction<"cached">) {
  const r = await rulesOf(interaction.guildId);
  if (!(await isFeatureEnabled(interaction.guildId, customCommandsFeature)) || !r.enabled || !r.rules.length) {
    return interaction.reply("This server hasn't set up its rules yet.");
  }
  const number = interaction.options.getInteger("number");
  if (number === null) {
    const embed = new EmbedBuilder()
      .setColor(ruleColor(r))
      .setTitle(`📜 ${r.heading}`.slice(0, 256))
      .setDescription(
        r.rules
          .map((rule, i) => `**${i + 1}. ${rule.title}**${rule.description.trim() ? `\n${rule.description.trim()}` : ""}`)
          .join("\n\n")
          .slice(0, 4096),
      );
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  }
  const rule = r.rules[number - 1];
  if (!rule) {
    return interaction.reply(`There's no rule ${number}. This server has ${r.rules.length} rule${r.rules.length === 1 ? "" : "s"}.`);
  }
  const embed = new EmbedBuilder()
    .setColor(ruleColor(r))
    .setTitle(`📜 Rule ${number}: ${rule.title}`.slice(0, 256))
    .setFooter({ text: `${r.heading} · ${number} of ${r.rules.length}` });
  if (rule.description.trim()) embed.setDescription(rule.description);
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

/** Suggestions while typing /rule: "1. Be kind", "2. No spam"… */
const ruleSuggestions = onEvent(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isAutocomplete() || !interaction.inCachedGuild() || interaction.commandName !== RULES_COMMAND) return;
  if (interaction.commandGuildId !== interaction.guildId) return;
  const r = await rulesOf(interaction.guildId);
  const typed = String(interaction.options.getFocused()).toLowerCase().trim();
  const choices = r.rules
    .map((rule, i) => ({ name: `${i + 1}. ${rule.title}`.slice(0, 100), value: i + 1 }))
    .filter((c) => !typed || c.name.toLowerCase().includes(typed))
    .slice(0, 25);
  await interaction.respond(choices).catch(() => {});
});

/** Answers custom commands and /rule. Number One's own commands are answered by the main command router instead. */
const commandUsed = onEvent(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild() || interaction.commandGuildId !== interaction.guildId) return;
  if (interaction.commandName === RULES_COMMAND) return answerRule(interaction);
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
  return { commands: (await listRows(guild.id)).map(toView), rules: (state.settings as CustomCommandSettings).rules, problems };
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
  events: [commandUsed, ruleSuggestions],

  setup(c) {
    // Bring every server's commands in line after a restart (edits made while offline, or the feature switched off).
    c.once(Events.ClientReady, async () => {
      const guildIds = new Set((await db.selectDistinct({ id: customCommands.guildId }).from(customCommands).all()).map((r) => r.id));
      // Servers with /rule but no custom commands need syncing too.
      for (const guild of c.guilds.cache.values()) if ((await rulesOf(guild.id)).enabled) guildIds.add(guild.id);
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

    api.put("/api/guilds/:guildId/custom-commands/rules", (request: Req, reply) =>
      guarded(reply, async () => {
        const guild = guildOf(request);
        const parsed = rulesSettings.safeParse(request.body);
        if (!parsed.success) throw new CommandError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
        if (parsed.data.enabled && !parsed.data.rules.length) throw new CommandError("Add at least one rule, or switch /rule off.");
        const state = await getFeatureState(guild.id, customCommandsFeature);
        const settings: CustomCommandSettings = { ...(state.settings as CustomCommandSettings), rules: parsed.data };
        await saveFeatureState(guild.id, customCommandsFeature, { enabled: state.enabled, settings }, request.session!.userId);
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
