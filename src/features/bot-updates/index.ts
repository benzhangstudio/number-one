import { ChannelType, Events, type Guild } from "discord.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import type { BotFeature } from "../../server/bot/types.js";
import { getMaintenance, setMaintenance } from "../../server/maintenance.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import { MAX_UPDATE_TEMPLATES, botUpdateTemplateInput, maintenanceInput } from "../../shared/botUpdates.js";
import {
  type BotUpdateFailure,
  type BotUpdateSettings,
  type BotUpdateSummary,
  type BotUpdatesPanelData,
  type DeveloperOverview,
  botUpdateInput,
  botUpdateSettings,
  botUpdatesFeature,
} from "../../shared/features.js";
import { buildMessage, chosenChannel, reasonFrom, receivingCount, runUpdate } from "./deliver.js";
import { isDeveloper } from "./developer.js";
import * as store from "./store.js";

type GuildReq = FastifyRequest<{ Params: { guildId: string } }>;

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/** Problems with the saved settings that an admin can fix, in plain language. */
function problemsFor(guild: Guild, s: BotUpdateSettings): string[] {
  const problems: string[] = [];
  if (s.channelId) {
    const target = chosenChannel(guild, s.channelId);
    if ("problem" in target) problems.push(target.problem);
  }
  if (s.roleId) {
    const role = guild.roles.cache.get(s.roleId);
    if (!role) problems.push("The role to mention was deleted. Pick another or remove it.");
    else if (!role.mentionable && !guild.members.me?.permissions.has("MentionEveryone")) {
      problems.push(`I can't mention @${role.name}. Make the role mentionable, or give me the Mention Everyone permission.`);
    }
  }
  return problems;
}

async function panelData(guild: Guild): Promise<BotUpdatesPanelData> {
  const settings = (await getFeatureState(guild.id, botUpdatesFeature)).settings as BotUpdateSettings;
  return { settings, problems: problemsFor(guild, settings) };
}

async function summaries(rows: store.UpdateRow[]): Promise<BotUpdateSummary[]> {
  const counts = await store.countsFor(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    url: r.url,
    mention: r.mention,
    createdAt: r.createdAt.getTime(),
    status: r.status,
    ...counts.get(r.id)!,
  }));
}

/**
 * Developer-only routes for the Developer page. Mounted with the logged-in routes (not per server),
 * and only the owner of the bot's Discord application gets past the check.
 */
export function registerDeveloperApi(api: FastifyInstance) {
  api.register(async (dev) => {
    dev.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await isDeveloper(request.session!.userId))) return reply.code(403).send({ error: "Only the bot's developer can use this." });
    });

    const overview = async (): Promise<DeveloperOverview> => ({
      updates: await summaries(await store.listUpdates(30)),
      templates: await store.listTemplates(),
      maintenance: getMaintenance(),
      servers: client.guilds.cache.size,
      receiving: await receivingCount(),
    });
    const firstIssue = (issues: { message: string }[]) => issues[0]?.message ?? "Check the form and try again.";

    dev.get("/api/developer", overview);

    // Templates: saved updates to start from.
    dev.post("/api/developer/templates", async (request, reply) => {
      const input = botUpdateTemplateInput.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: firstIssue(input.error.issues) });
      if ((await store.templateCount()) >= MAX_UPDATE_TEMPLATES) return reply.code(400).send({ error: `You can save up to ${MAX_UPDATE_TEMPLATES} templates. Delete one first.` });
      await store.createTemplate(input.data);
      return overview();
    });
    dev.put<{ Params: { id: string } }>("/api/developer/templates/:id", async (request, reply) => {
      const input = botUpdateTemplateInput.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: firstIssue(input.error.issues) });
      await store.updateTemplate(Number(request.params.id), input.data);
      return overview();
    });
    dev.delete<{ Params: { id: string } }>("/api/developer/templates/:id", async (request) => {
      await store.deleteTemplate(Number(request.params.id));
      return overview();
    });

    // Maintenance mode for the whole bot.
    dev.put("/api/developer/maintenance", async (request, reply) => {
      const input = maintenanceInput.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: firstIssue(input.error.issues) });
      if (input.data.on && input.data.until !== null && input.data.until <= Date.now() + 60_000) {
        return reply.code(400).send({ error: "The end time has already passed. Pick a later time, or leave it empty." });
      }
      await setMaintenance(input.data);
      return overview();
    });

    dev.post("/api/developer/updates", async (request, reply) => {
      const input = botUpdateInput.safeParse(request.body);
      if (!input.success) return reply.code(400).send({ error: input.error.issues[0]?.message ?? "Check the form and try again." });
      if (!client.isReady()) return reply.code(400).send({ error: "The bot isn't connected to Discord yet. Try again in a minute." });
      if ((await store.unfinishedUpdates()).length) return reply.code(400).send({ error: "The last update is still being sent. Wait for it to finish." });
      const row = await store.createUpdate(input.data, request.session!.userId);
      void runUpdate(row.id); // keeps going in the background; the page shows progress
      return (await summaries([row]))[0];
    });

    dev.get<{ Params: { id: string } }>("/api/developer/updates/:id/failures", async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || !(await store.getUpdate(id))) return reply.code(404).send({ error: "Not found" });
      const failures: BotUpdateFailure[] = (await store.failuresFor(id)).map((f) => ({
        guildId: f.guildId,
        guildName: client.guilds.cache.get(f.guildId)?.name ?? "A server the bot has since left",
        reason: f.reason || "Unknown error.",
      }));
      return { failures };
    });
  });
}

export const botUpdates: BotFeature = {
  info: botUpdatesFeature,

  // Updates still being sent when the bot restarted pick up where they left off.
  setup(c) {
    c.once(Events.ClientReady, async () => {
      for (const row of await store.unfinishedUpdates().catch(() => [])) void runUpdate(row.id);
    });
  },

  registerApi(api) {
    const guildOf = (request: GuildReq) => client.guilds.cache.get(request.params.guildId)!;

    api.get("/api/guilds/:guildId/bot-updates", async (request: GuildReq) => panelData(guildOf(request)));

    api.put("/api/guilds/:guildId/bot-updates", async (request: GuildReq, reply) => {
      const guild = guildOf(request);
      const parsed = botUpdateSettings.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Check the form and try again." });
      const settings = parsed.data;
      if (settings.channelId) {
        const channel = guild.channels.cache.get(settings.channelId);
        if (!channel || !TEXT_TYPES.has(channel.type)) return reply.code(400).send({ error: "That channel no longer exists. Pick another." });
      }
      if (settings.roleId && !guild.roles.cache.has(settings.roleId)) return reply.code(400).send({ error: "That role no longer exists. Pick another." });
      const state = await getFeatureState(guild.id, botUpdatesFeature);
      await saveFeatureState(guild.id, botUpdatesFeature, { enabled: state.enabled, settings }, request.session!.userId);
      return panelData(guild);
    });

    // Posts a sample (without the mention) so admins can check the bot can post there.
    api.post("/api/guilds/:guildId/bot-updates/test", async (request: GuildReq, reply) => {
      const guild = guildOf(request);
      const settings = (await getFeatureState(guild.id, botUpdatesFeature)).settings as BotUpdateSettings;
      if (!settings.channelId) return reply.code(400).send({ error: "Choose a channel and save first." });
      const target = chosenChannel(guild, settings.channelId);
      if ("problem" in target) return reply.code(400).send({ error: target.problem });
      const sample = {
        title: "Test update",
        body: "This is what news about Number One will look like in this channel.",
        url: "",
        mention: false,
        createdAt: new Date(),
      };
      try {
        await target.channel.send(buildMessage(guild, sample, settings));
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: reasonFrom(err) });
      }
    });
  },
};
