import { EmbedBuilder, Events, type Guild, type Message, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import { type BotFeature, type SlashCommand, onEvent } from "../../server/bot/types.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import {
  type EconomyActivity,
  type EconomyMember,
  type EconomyResponse,
  DAILY_COOLDOWN_HOURS,
  type EconomySettings,
  HISTORY_DAYS,
  MAX_CHANGE,
  economySettings,
  formatMoney,
  streakBonus,
  transactionKinds,
} from "../../shared/economy.js";
import { economyFeature, levelsFeature } from "../../shared/features.js";
import { blackjackButtons, blackjackCommand, coinflipCommand, pruneGameCooldowns, slotsCommand } from "./games.js";
import { buyCommand, inventoryCommand, registerShopApi, shopCommand, shopItemsView, shopProblems, takeItem, takeItemSuggestions } from "./shop.js";
import * as store from "./store.js";

/**
 * Economy: a currency each server names itself. Members earn it by chatting, with /daily, /work and
 * level-ups, send it with /pay, spend it in the shop (shop.ts) and bet it on games (games.ts). Balances live in economy_balances; every change except chatting
 * is recorded in economy_transactions for 90 days.
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;

const PINK = 0xff4fa3;
const PAGE_SIZE = 10;

async function getActiveSettings(guildId: string): Promise<EconomySettings | null> {
  const state = await getFeatureState(guildId, economyFeature);
  return state.enabled ? (state.settings as EconomySettings) : null;
}
const settingsOf = async (guildId: string) => (await getFeatureState(guildId, economyFeature)).settings as EconomySettings;

const n = (x: number) => x.toLocaleString("en-US");
const between = (a: number, b: number) => {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return lo + Math.floor(Math.random() * (hi - lo + 1));
};
/** Discord shows this as "in 3 hours", in the reader's own time zone. */
const relative = (ms: number) => `<t:${Math.ceil(ms / 1000)}:R>`;

/* ------------------------------------------------------------ earning by chatting */

/** Last time each member earned from chatting ("guildId:userId" → ms). A restart just resets cooldowns. */
const lastChat = new Map<string, number>();

function channelAllowed(message: Message<true>, ids: string[]) {
  if (!ids.length) return true;
  const ch = message.channel;
  const parent = ch.isThread() ? ch.parent : null;
  return ![ch.id, "parentId" in ch ? ch.parentId : null, parent?.parentId].some((id) => id && ids.includes(id));
}

const messageSent = onEvent(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
  const key = `${message.guildId}:${message.author.id}`;
  const last = lastChat.get(key) ?? 0;
  if (Date.now() - last < 1000) return; // cheap check first, so most messages never touch the database
  const s = await getActiveSettings(message.guildId);
  if (!s?.chat.enabled || Date.now() - last < s.chat.cooldownSeconds * 1000) return;
  if (!channelAllowed(message, s.chat.noEarnChannelIds)) return;
  lastChat.set(key, Date.now());
  const amount = between(s.chat.min, s.chat.max);
  if (amount > 0) store.credit(message.guildId, message.author.id, amount, "chat", { startingBalance: s.startingBalance });
});

/**
 * Called by Levels when a member reaches a new level. Pays the reward once per level gained.
 * Returns the reward as text (like "🪙 50 coins") for the level-up message, or "" when nothing was paid.
 */
export async function payLevelUp(guildId: string, userId: string, levelsGained: number): Promise<string> {
  const s = await getActiveSettings(guildId);
  if (!s || s.levelUpReward <= 0 || levelsGained <= 0) return "";
  const { changed } = store.credit(guildId, userId, s.levelUpReward * levelsGained, "level", { startingBalance: s.startingBalance });
  return changed > 0 ? formatMoney(s.currency, changed, false) : "";
}

/* ------------------------------------------------------------ commands */

const notOn = (what: string) => `${what} is switched off in this server.`;

const balanceCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Show how much money you have, or someone else.")
    .setContexts(0)
    .addUserOption((o) => o.setName("member").setDescription("Whose balance (you, if empty)")),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    const user = interaction.options.getUser("member") ?? interaction.user;
    if (user.bot) return interaction.reply("Bots don't have a balance.");
    const self = user.id === interaction.user.id;
    const w = store.peek(interaction.guildId, user.id, s.startingBalance);
    const member = interaction.options.getMember("member") ?? (self ? interaction.member : null);
    const lines = [`${formatMoney(s.currency, w.balance)}`];
    if (w.balance > 0) lines.push(`Rank **#${n(store.rankOf(interaction.guildId, w.balance))}** in ${interaction.guild.name}`);
    if (w.dailyStreak > 0 && s.daily.enabled) lines.push(`🔥 Daily streak: **${w.dailyStreak}** day${w.dailyStreak === 1 ? "" : "s"}`);
    if (self) {
      const now = Date.now();
      const dailyAt = (w.lastDailyAt ?? 0) + DAILY_COOLDOWN_HOURS * 3600_000;
      const workAt = (w.lastWorkAt ?? 0) + s.work.cooldownMinutes * 60_000;
      const ready: string[] = [];
      if (s.daily.enabled) ready.push(dailyAt <= now ? "`/daily` is ready" : `\`/daily\` ${relative(dailyAt)}`);
      if (s.work.enabled) ready.push(workAt <= now ? "`/work` is ready" : `\`/work\` ${relative(workAt)}`);
      if (ready.length) lines.push("", ready.join(" · "));
    }
    const embed = new EmbedBuilder()
      .setColor(PINK)
      .setAuthor({ name: `${member?.displayName ?? user.username}'s balance`, iconURL: user.displayAvatarURL({ size: 128 }) })
      .setDescription(lines.join("\n"));
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

const dailyCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("daily").setDescription("Collect your daily reward. Come back every day for a streak bonus.").setContexts(0),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    if (!s.daily.enabled) return interaction.reply(notOn("The daily reward"));
    const r = store.claimDaily(interaction.guildId, interaction.user.id, s.startingBalance, (streak) => ({
      amount: s.daily.amount,
      bonus: streakBonus(s.daily, streak),
    }));
    if (!r.ok) return interaction.reply(`You've already collected today's reward. Come back ${relative(r.nextAt)}.`);
    const embed = new EmbedBuilder()
      .setColor(PINK)
      .setTitle("🎁 Daily reward")
      .setDescription(
        [
          `You got ${formatMoney(s.currency, r.amount + r.bonus)}!`,
          r.bonus > 0 ? `-# ${formatMoney(s.currency, r.amount, false)} + ${formatMoney(s.currency, r.bonus, false)} streak bonus` : "",
          "",
          `🔥 Streak: **${r.streak}** day${r.streak === 1 ? "" : "s"} · Balance: ${formatMoney(s.currency, r.balance)}`,
          "-# Come back within 2 days to keep your streak.",
        ]
          .filter((l, i) => l || i !== 1)
          .join("\n"),
      );
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

/** What members "did" for their pay. {money} becomes the amount. */
const JOBS = [
  "You walked the server's dogs and earned {money}.",
  "You fixed a bug nobody else could find and earned {money}.",
  "You baked a tray of cookies for the mods and earned {money}.",
  "You organised the emoji folder and earned {money}.",
  "You DJ'd the voice channel all evening and earned {money}.",
  "You delivered pizza across town and earned {money}.",
  "You watered every plant in the café and earned {money}.",
  "You streamed for three hours and earned {money} in tips.",
  "You tutored a new member in Discord markdown and earned {money}.",
  "You designed a new server banner and earned {money}.",
  "You sorted the lost-and-found box and earned {money}.",
  "You hosted a trivia night and earned {money}.",
];

const workCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("work").setDescription("Do a quick job to earn some money.").setContexts(0),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    if (!s.work.enabled) return interaction.reply(notOn("/work"));
    const r = store.claimWork(interaction.guildId, interaction.user.id, s.startingBalance, s.work.cooldownMinutes, between(s.work.min, s.work.max));
    if (!r.ok) return interaction.reply(`You're still tired from your last job. You can work again ${relative(r.nextAt)}.`);
    const job = JOBS[Math.floor(Math.random() * JOBS.length)].replace("{money}", formatMoney(s.currency, r.amount));
    return interaction.reply({ content: `💼 ${job}\n-# Balance: ${formatMoney(s.currency, r.balance, false)}`, allowedMentions: { parse: [] } });
  },
};

const payCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Send some of your money to another member.")
    .setContexts(0)
    .addUserOption((o) => o.setName("member").setDescription("Who gets it").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("How much").setRequired(true).setMinValue(1).setMaxValue(MAX_CHANGE)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    if (!s.payEnabled) return interaction.reply(notOn("/pay"));
    const to = interaction.options.getUser("member", true);
    const amount = interaction.options.getInteger("amount", true);
    if (to.bot) return interaction.reply("You can't pay bots.");
    if (to.id === interaction.user.id) return interaction.reply("You can't pay yourself.");
    const r = store.pay(interaction.guildId, interaction.user.id, to.id, amount, s.startingBalance);
    if (!r.ok) {
      return interaction.reply({
        content:
          r.reason === "broke"
            ? `You don't have enough. You have ${formatMoney(s.currency, r.balance)}.`
            : `<@${to.id}> can't hold that much more.`,
        allowedMentions: { parse: [] },
      });
    }
    return interaction.reply({
      content: `💸 <@${interaction.user.id}> sent ${formatMoney(s.currency, amount)} to <@${to.id}>.\n-# Your balance: ${formatMoney(s.currency, r.fromBalance, false)}`,
      allowedMentions: { users: [to.id] },
    });
  },
};

const richestCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("richest")
    .setDescription("Show the members with the most money.")
    .setContexts(0)
    .addIntegerOption((o) => o.setName("page").setDescription("Which page (10 members each)").setMinValue(1)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    const { count } = store.holders(interaction.guildId);
    if (!count) return interaction.reply(`Nobody has any ${s.currency.plural} yet. Try \`/daily\`!`);
    const pages = Math.ceil(count / PAGE_SIZE);
    const page = Math.min(interaction.options.getInteger("page") ?? 1, pages);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = store.richest(interaction.guildId, PAGE_SIZE, (page - 1) * PAGE_SIZE).map((r, i) => {
      const place = (page - 1) * PAGE_SIZE + i + 1;
      return `${medals[place - 1] ?? `**${place}.**`} <@${r.userId}> · ${formatMoney(s.currency, r.balance, false)}`;
    });
    const mine = store.peek(interaction.guildId, interaction.user.id, s.startingBalance);
    const you = mine.balance > 0 ? `You're #${n(store.rankOf(interaction.guildId, mine.balance))} · ` : "";
    const embed = new EmbedBuilder()
      .setColor(PINK)
      .setTitle(`${s.currency.emoji} Richest in ${interaction.guild.name}`.slice(0, 256))
      .setDescription(lines.join("\n"))
      .setFooter({ text: `${you}Page ${page} of ${pages}` });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

const adminCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("economy")
    .setDescription("Change a member's balance or see their history.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0)
    .addSubcommand((c) =>
      c
        .setName("give")
        .setDescription("Give a member money")
        .addUserOption((o) => o.setName("member").setDescription("Who gets it").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("How much").setRequired(true).setMinValue(1).setMaxValue(MAX_CHANGE)),
    )
    .addSubcommand((c) =>
      c
        .setName("take")
        .setDescription("Take money away from a member")
        .addUserOption((o) => o.setName("member").setDescription("From whom").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("How much").setRequired(true).setMinValue(1).setMaxValue(MAX_CHANGE)),
    )
    .addSubcommand((c) =>
      c
        .setName("set")
        .setDescription("Set a member's balance")
        .addUserOption((o) => o.setName("member").setDescription("Whose balance").setRequired(true))
        .addIntegerOption((o) => o.setName("amount").setDescription("Their new balance").setRequired(true).setMinValue(0).setMaxValue(MAX_CHANGE)),
    )
    .addSubcommand((c) =>
      c
        .setName("history")
        .setDescription("See a member's latest balance changes")
        .addUserOption((o) => o.setName("member").setDescription("Whose history").setRequired(true)),
    )
    .addSubcommand((c) =>
      c
        .setName("take-item")
        .setDescription("Take a shop item from a member, like when they use it")
        .addUserOption((o) => o.setName("member").setDescription("From whom").setRequired(true))
        .addIntegerOption((o) => o.setName("item").setDescription("Which item").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("quantity").setDescription("How many (1 if empty)").setMinValue(1).setMaxValue(1_000_000)),
    ),
  autocomplete: (interaction) => takeItemSuggestions(interaction),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    const sub = interaction.options.getSubcommand();
    if (sub === "take-item") return takeItem(interaction);
    const user = interaction.options.getUser("member", true);
    if (user.bot) return interaction.reply("Bots don't have a balance.");
    const g = interaction.guildId;

    if (sub === "history") {
      const rows = store.historyOf(g, user.id, 15);
      if (!rows.length) return interaction.reply({ content: `<@${user.id}> has no balance changes in the last ${HISTORY_DAYS} days.`, allowedMentions: { parse: [] } });
      const lines = rows.map((t) => {
        const sign = t.amount > 0 ? "+" : "−";
        const other = t.otherUserId ? ` ${t.kind === "pay_out" ? "to" : "from"} <@${t.otherUserId}>` : "";
        return `<t:${Math.floor(t.at / 1000)}:d> **${sign}${n(Math.abs(t.amount))}** · ${transactionKinds[t.kind] ?? t.kind}${other}`;
      });
      const embed = new EmbedBuilder()
        .setColor(PINK)
        .setTitle(`History for ${user.username}`.slice(0, 256))
        .setDescription(lines.join("\n"))
        .setFooter({ text: `Balance: ${n(store.peek(g, user.id, s.startingBalance).balance)} ${s.currency.plural} · Chatting isn't listed` });
      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    const amount = interaction.options.getInteger("amount", true);
    const by = interaction.user.id;
    const balance =
      sub === "set"
        ? store.setBalance(g, user.id, amount, { startingBalance: s.startingBalance, by })
        : store.credit(g, user.id, sub === "give" ? amount : -amount, "admin", { startingBalance: s.startingBalance, by }).balance;
    return interaction.reply({ content: `<@${user.id}> now has ${formatMoney(s.currency, balance)}.`, allowedMentions: { parse: [] } });
  },
};

/* ------------------------------------------------------------ dashboard */

async function namesFor(guild: Guild, ids: string[]) {
  const unique = [...new Set(ids)];
  const fetched = unique.length ? await guild.members.fetch({ user: unique }).catch(() => null) : null;
  return (id: string) => {
    const member = fetched?.get(id) ?? guild.members.cache.get(id);
    const user = member?.user ?? client.users.cache.get(id);
    return { name: member?.displayName ?? user?.username ?? "Former member", avatar: user?.displayAvatarURL({ size: 64 }) ?? null };
  };
}

async function respond(guild: Guild, settings: EconomySettings): Promise<EconomyResponse> {
  const top = store.richest(guild.id, 25);
  const recent = store.recentActivity(guild.id, 25);
  const who = await namesFor(guild, [...top.map((t) => t.userId), ...recent.flatMap((t) => [t.userId, t.otherUserId ?? ""]).filter(Boolean)]);
  const { count, total } = store.holders(guild.id);
  const richest: EconomyMember[] = top.map((t) => ({ userId: t.userId, ...who(t.userId), balance: t.balance }));
  const activity: EconomyActivity[] = recent.map((t) => ({
    id: t.id,
    userId: t.userId,
    name: who(t.userId).name,
    amount: t.amount,
    kind: t.kind,
    otherName: t.otherUserId ? who(t.otherUserId).name : null,
    at: t.at,
  }));
  const problems: string[] = [];
  if (settings.levelUpReward > 0 && !(await isFeatureEnabled(guild.id, levelsFeature))) problems.push("Level-up rewards only pay out when Levels is switched on.");
  if (settings.shop.enabled) problems.push(...(await shopProblems(guild)));
  if (settings.games.minBet > settings.games.maxBet) problems.push("The smallest bet is bigger than the biggest bet.");
  return { settings, shopItems: await shopItemsView(guild.id), problems, holders: count, totalMoney: total, richest, activity };
}

export const economyBot: BotFeature = {
  info: economyFeature,
  commands: [
    balanceCommand,
    dailyCommand,
    workCommand,
    payCommand,
    richestCommand,
    shopCommand,
    buyCommand,
    inventoryCommand,
    coinflipCommand,
    slotsCommand,
    blackjackCommand,
    adminCommand,
  ],
  components: [blackjackButtons],
  events: [messageSent],

  setup() {
    const hourly = () => {
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const [key, at] of lastChat) if (at < cutoff) lastChat.delete(key);
      pruneGameCooldowns();
      try {
        store.pruneHistory();
      } catch (err) {
        console.warn("[economy] couldn't prune history:", (err as Error).message);
      }
    };
    setInterval(hourly, 60 * 60 * 1000).unref();
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/economy", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      return respond(guild, await settingsOf(guild.id));
    });

    api.put("/api/guilds/:guildId/economy", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = economySettings.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reply.code(400).send({ error: issue ? `${issue.path.join(" → ")}: ${issue.message}` : "Check the form and try again." });
      }
      const s = parsed.data;
      if (s.chat.min > s.chat.max) [s.chat.min, s.chat.max] = [s.chat.max, s.chat.min];
      if (s.work.min > s.work.max) [s.work.min, s.work.max] = [s.work.max, s.work.min];
      if (s.games.minBet > s.games.maxBet) [s.games.minBet, s.games.maxBet] = [s.games.maxBet, s.games.minBet];
      s.games.minBet = Math.max(1, s.games.minBet);
      s.chat.noEarnChannelIds = s.chat.noEarnChannelIds.filter((id) => guild.channels.cache.has(id));
      const state = await getFeatureState(guild.id, economyFeature);
      await saveFeatureState(guild.id, economyFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
      return respond(guild, s);
    });

    registerShopApi(api, async (guild) => respond(guild, await settingsOf(guild.id)));

    /** Wipes every balance, the history and inventories in this server. */
    api.post("/api/guilds/:guildId/economy/reset", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      store.resetGuild(guild.id);
      for (const key of lastChat.keys()) if (key.startsWith(`${guild.id}:`)) lastChat.delete(key);
      return respond(guild, await settingsOf(guild.id));
    });
  },
};
