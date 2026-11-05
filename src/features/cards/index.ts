import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type Guild,
  type MessageComponentInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isDeveloper } from "../bot-updates/developer.js";
import { client } from "../../server/bot/discord.js";
import type { BotFeature, ComponentHandler, SlashCommand } from "../../server/bot/types.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import { type EconomySettings, formatMoney } from "../../shared/economy.js";
import { cardsFeature, economyFeature } from "../../shared/features.js";
import {
  CARD_COUNT,
  CARD_PHOTO,
  type Card,
  type CardMode,
  type CardPhotosResponse,
  type CardSettings,
  type CardsResponse,
  type PackKind,
  cardById,
  cardSettings,
  cards,
  packInfo,
  rarities,
  rarityInfo,
  typeInfo,
} from "../../shared/cards.js";
import { battle, openPack, rivalTeam, shortLog, teamOf } from "./game.js";
import { deletePhoto, hasPhoto, isPhotoKey, loadPhotoList, photoFile, photoList, readyCount, savePhoto, setCredit } from "./photos.js";
import { renderCard, renderRow } from "./render.js";
import * as store from "./store.js";

/**
 * BLACKPINK Poker: /cards to open packs, collect, build a team, battle, trade and gift.
 * With Economy, packs cost the server's currency and duplicates sell for it; in Cards only mode there's
 * no money, just a free daily pack (and a bonus card for beating Number One).
 * Photos are uploaded by the bot's developer on the Developer page (registerCardsDeveloperApi below).
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;

const PINK = 0xff4fa3;
const PREFIX = "kc";
const DAILY_MS = 20 * 60 * 60 * 1000;
const PAGE = 15;
const CHALLENGE_MS = 2 * 60_000;

const settingsOf = async (guildId: string) => (await getFeatureState(guildId, cardsFeature)).settings as CardSettings;
const economyOf = async (guildId: string) => (await getFeatureState(guildId, economyFeature)).settings as EconomySettings;

/** The mode actually in use: With Economy needs the Economy module switched on. */
async function modeOf(guildId: string, s: CardSettings): Promise<CardMode> {
  return s.mode === "economy" && (await isFeatureEnabled(guildId, economyFeature)) ? "economy" : "cards";
}

const stars = (c: Card) => "★".repeat(rarityInfo[c.rarity].stars);
const line = (c: Card, qty?: number) => `${stars(c)} **${c.memberName}** · ${c.version} (${c.groupName})${qty && qty > 1 ? ` ×${qty}` : ""}`;
const notReady = "The cards aren't ready yet: photos are still being added. Check back soon!";

/* ------------------------------------------------------------ suggestions while typing */

function searchCards(list: { card: Card; qty?: number }[], typed: string) {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  return list
    .filter(({ card }) => words.every((w) => `${card.memberName} ${card.groupName} ${card.version} ${card.rarity}`.toLowerCase().includes(w)))
    .sort((a, b) => rarities.indexOf(b.card.rarity) - rarities.indexOf(a.card.rarity) || a.card.number - b.card.number)
    .slice(0, 25)
    .map(({ card, qty }) => ({
      name: `${card.memberName} · ${card.version} (${card.groupName}) ${"★".repeat(rarityInfo[card.rarity].stars)}${qty && qty > 1 ? ` ×${qty}` : ""}`.slice(0, 100),
      value: card.id,
    }));
}

const ownedList = (guildId: string, userId: string) =>
  [...store.collectionOf(guildId, userId)].filter(([id]) => cardById.has(id)).map(([id, qty]) => ({ card: cardById.get(id)!, qty }));

async function autocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.inCachedGuild()) return interaction.respond([]);
  const focused = interaction.options.getFocused(true);
  const typed = String(focused.value);
  const sub = interaction.options.getSubcommand();
  if (sub === "view") return interaction.respond(searchCards(cards.filter(hasPhoto).map((card) => ({ card })), typed));
  if (sub === "trade" && focused.name === "get") {
    const other = interaction.options.get("member")?.value;
    return interaction.respond(typeof other === "string" ? searchCards(ownedList(interaction.guildId, other), typed) : []);
  }
  return interaction.respond(searchCards(ownedList(interaction.guildId, interaction.user.id), typed));
}

/* ------------------------------------------------------------ replies */

async function packReply(owner: string, title: string, list: Card[], before: Map<string, number>, footer: string) {
  const png = await renderRow(list);
  const lines = list.map((c) => `${line(c)}${before.has(c.id) ? "" : " · **NEW!**"}`);
  const best = list.reduce((a, b) => (rarities.indexOf(b.rarity) > rarities.indexOf(a.rarity) ? b : a));
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(rarityInfo[best.rarity].color.slice(1), 16))
    .setTitle(title)
    .setDescription(`<@${owner}> got:\n${lines.join("\n")}`)
    .setImage("attachment://pack.png")
    .setFooter({ text: footer });
  return { embeds: [embed], files: [new AttachmentBuilder(png, { name: "pack.png" })], allowedMentions: { parse: [] as never[] } };
}

async function cardReply(card: Card, note = "") {
  const png = await renderCard(card);
  const t = typeInfo[card.type];
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(rarityInfo[card.rarity].color.slice(1), 16))
    .setTitle(`${card.memberName} · ${card.version}`)
    .setDescription(`${card.groupName} · ${rarityInfo[card.rarity].name} · ${t.emoji} ${t.name}\nHP **${card.hp}** · ${t.move} **${card.power}**${note ? `\n${note}` : ""}`)
    .setImage("attachment://card.png");
  return { embeds: [embed], files: [new AttachmentBuilder(png, { name: "card.png" })], allowedMentions: { parse: [] as never[] } };
}

/* ------------------------------------------------------------ subcommands */

async function daily(i: ChatInputCommandInteraction<"cached">, s: CardSettings) {
  if (!s.daily) return i.reply("The daily pack is switched off in this server.");
  const p = store.playerOf(i.guildId, i.user.id);
  if (p.lastDailyAt && Date.now() - p.lastDailyAt < DAILY_MS) {
    return i.reply(`You already opened today's pack. The next one is ready <t:${Math.ceil((p.lastDailyAt + DAILY_MS) / 1000)}:R>.`);
  }
  const list = openPack(s, "daily");
  if (!list) return i.reply(notReady);
  await i.deferReply();
  const before = store.collectionOf(i.guildId, i.user.id);
  if (!store.claimDaily(i.guildId, i.user.id, DAILY_MS, list.map((c) => c.id))) return i.editReply("You already opened today's pack.");
  return i.editReply(await packReply(i.user.id, "🎁 Daily pack", list, before, "Come back in 20 hours for another one."));
}

async function open(i: ChatInputCommandInteraction<"cached">, s: CardSettings, mode: CardMode) {
  if (mode !== "economy") return i.reply("Packs aren't sold in this server. Use `/cards daily` for your free pack!");
  const kind = i.options.getString("pack", true) as Exclude<PackKind, "daily">;
  const list = openPack(s, kind);
  if (!list) return i.reply(notReady);
  const eco = await economyOf(i.guildId);
  const price = s.prices[kind];
  const before = store.collectionOf(i.guildId, i.user.id);
  const r = store.buyPack(i.guildId, i.user.id, price, list.map((c) => c.id), eco.startingBalance);
  if (!r.ok) return i.reply({ content: `You need ${formatMoney(eco.currency, price)} for a ${packInfo[kind].name.toLowerCase()}. You have ${formatMoney(eco.currency, r.balance)}.`, allowedMentions: { parse: [] } });
  await i.deferReply();
  const name = `${packInfo[kind].emoji} ${packInfo[kind].name}`;
  return i.editReply(await packReply(i.user.id, name, list, before, `Paid ${price.toLocaleString("en-US")} · Balance: ${r.balance.toLocaleString("en-US")}`));
}

async function packs(i: ChatInputCommandInteraction<"cached">, s: CardSettings, mode: CardMode) {
  const ready = readyCount();
  const embed = new EmbedBuilder().setColor(PINK).setTitle("🖤💗 BLACKPINK Poker");
  if (mode === "economy") {
    const eco = await economyOf(i.guildId);
    embed.setDescription(
      [
        `${packInfo.standard.emoji} **Standard pack** · ${formatMoney(eco.currency, s.prices.standard)}\n${packInfo.standard.about}`,
        `${packInfo.premium.emoji} **Premium pack** · ${formatMoney(eco.currency, s.prices.premium)}\n${packInfo.premium.about}`,
        s.daily ? `${packInfo.daily.emoji} **Daily pack** · free\n${packInfo.daily.about}` : "",
        "Open one with `/cards open`. Sell duplicates with `/cards sell-duplicates`.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  } else {
    embed.setDescription(
      [`${packInfo.daily.emoji} **Daily pack** · free\n${packInfo.daily.about} Open it with \`/cards daily\`.`, "Beat Number One in `/cards battle` for a bonus card (a few times a day)."].join("\n\n"),
    );
  }
  embed.setFooter({ text: `${ready.toLocaleString("en-US")} of ${CARD_COUNT.toLocaleString("en-US")} cards are ready so far · Stars: ★ Common to ★★★★★ Mythic` });
  return i.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function collection(i: ChatInputCommandInteraction<"cached">) {
  const user = i.options.getUser("member") ?? i.user;
  const list = ownedList(i.guildId, user.id).sort((a, b) => a.card.number - b.card.number);
  const self = user.id === i.user.id;
  if (!list.length) {
    return i.reply({ content: self ? "You don't have any cards yet. Try `/cards daily`!" : `<@${user.id}> doesn't have any cards yet.`, allowedMentions: { parse: [] } });
  }
  const pages = Math.ceil(list.length / PAGE);
  const page = Math.min(i.options.getInteger("page") ?? 1, pages);
  const embed = new EmbedBuilder()
    .setColor(PINK)
    .setAuthor({ name: `${user.displayName}'s collection`, iconURL: user.displayAvatarURL({ size: 64 }) })
    .setDescription(list.slice((page - 1) * PAGE, page * PAGE).map(({ card, qty }) => line(card, qty)).join("\n"))
    .setFooter({ text: `${list.length} of ${CARD_COUNT} cards · Page ${page} of ${pages} · See one with /cards view` });
  return i.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function view(i: ChatInputCommandInteraction<"cached">) {
  const card = cardById.get(i.options.getString("card", true));
  if (!card || !hasPhoto(card)) return i.reply("I couldn't find that card. Pick one from the list.");
  await i.deferReply();
  const qty = store.ownedCount(i.guildId, i.user.id, card.id);
  return i.editReply(await cardReply(card, qty ? `You have ${qty}.` : "You don't have this one yet."));
}

async function team(i: ChatInputCommandInteraction<"cached">) {
  const picked = ["first", "second", "third"].map((n) => i.options.getString(n)).filter((x): x is string => Boolean(x));
  const owned = store.collectionOf(i.guildId, i.user.id);
  if (picked.length) {
    const bad = picked.find((id) => !owned.has(id) || !cardById.has(id));
    if (bad) return i.reply("You can only put cards you own in your team. Pick them from the list.");
    if (new Set(picked).size !== picked.length) return i.reply("Pick three different cards.");
    store.setTeam(i.guildId, i.user.id, picked);
  }
  const t = teamOf(store.playerOf(i.guildId, i.user.id).team, owned);
  if (!t.length) return i.reply("You don't have any cards yet. Try `/cards daily`!");
  await i.deferReply();
  const png = await renderRow(t);
  const embed = new EmbedBuilder()
    .setColor(PINK)
    .setTitle(`${picked.length ? "✅ Team saved" : "Your team"}`)
    .setDescription(`${t.map((c) => `${typeInfo[c.type].emoji} ${line(c)}`).join("\n")}\n\n-# Change it with \`/cards team\`. Empty spots are filled with your strongest cards.`)
    .setImage("attachment://team.png");
  return i.editReply({ embeds: [embed], files: [new AttachmentBuilder(png, { name: "team.png" })], allowedMentions: { parse: [] } });
}

function battleEmbed(names: [string, string], teams: [Card[], Card[]], result: ReturnType<typeof battle>, extra: string) {
  const side = (n: 0 | 1) => teams[n].map((c, k) => `${typeInfo[c.type].emoji} ${c.memberName} (${result.left[n][k]}/${c.hp} HP)`).join("\n");
  return new EmbedBuilder()
    .setColor(result.winner === 0 ? 0x3ba55d : 0xed4245)
    .setTitle(`⚔️ ${names[0]} vs ${names[1]}`)
    .addFields({ name: names[0], value: side(0), inline: true }, { name: names[1], value: side(1), inline: true })
    .setDescription(`${shortLog(result.log).join("\n")}\n\n🏆 **${names[result.winner]} wins!**${extra ? `\n${extra}` : ""}`.slice(0, 4096));
}

async function battleBot(i: ChatInputCommandInteraction<"cached">, s: CardSettings, mode: CardMode) {
  const mine = teamOf(store.playerOf(i.guildId, i.user.id).team, store.collectionOf(i.guildId, i.user.id));
  if (!mine.length) return i.reply("You need at least one card to battle. Try `/cards daily`!");
  const rival = rivalTeam(s, mine);
  if (!rival.length) return i.reply(notReady);
  const names: [string, string] = [i.member.displayName, "Number One"];
  const result = battle([mine, rival], names);
  const won = result.winner === 0;
  const winsToday = store.recordBattle(i.guildId, i.user.id, won);
  let extra = "";
  let bonus: Card[] | null = null;
  if (won && winsToday <= s.battles.rewardedWinsPerDay) {
    if (mode === "economy" && s.battles.winReward > 0) {
      const eco = await economyOf(i.guildId);
      const { credit } = await import("../economy/store.js");
      credit(i.guildId, i.user.id, s.battles.winReward, "cards", { startingBalance: eco.startingBalance });
      extra = `You earned ${formatMoney(eco.currency, s.battles.winReward)}!`;
    } else if (mode === "cards") {
      bonus = openPack(s, "daily")?.slice(0, 1) ?? null;
      if (bonus) {
        store.addCards(i.guildId, i.user.id, [bonus[0].id]);
        extra = `🎁 Bonus card: ${line(bonus[0])}`;
      }
    }
    extra += `\n-# Rewarded wins today: ${winsToday}/${s.battles.rewardedWinsPerDay}`;
  }
  return i.reply({ embeds: [battleEmbed(names, [mine, rival], result, extra)], allowedMentions: { parse: [] } });
}

/** Battles and trades waiting for the other member to answer. */
const pending = new Map<string, { kind: "battle" | "trade"; guildId: string; from: string; to: string; bet: number; give?: string; get?: string; expires: number }>();
let nextId = 1;

function askButtons(id: string, yes: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:yes:${id}`).setLabel(yes).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:no:${id}`).setLabel("No thanks").setStyle(ButtonStyle.Secondary),
  );
}

async function challenge(i: ChatInputCommandInteraction<"cached">, s: CardSettings, mode: CardMode) {
  const other = i.options.getMember("opponent");
  if (!other || other.user.bot) return i.reply("Pick a member to battle, or leave it empty to battle Number One.");
  if (other.id === i.user.id) return i.reply("You can't battle yourself!");
  const bet = mode === "economy" && s.battles.bets ? (i.options.getInteger("bet") ?? 0) : 0;
  if (!store.collectionOf(i.guildId, i.user.id).size) return i.reply("You need at least one card to battle. Try `/cards daily`!");
  const id = String(nextId++);
  pending.set(id, { kind: "battle", guildId: i.guildId, from: i.user.id, to: other.id, bet, expires: Date.now() + CHALLENGE_MS });
  const eco = bet ? await economyOf(i.guildId) : null;
  return i.reply({
    content: `⚔️ <@${other.id}>, <@${i.user.id}> wants to battle!${bet && eco ? ` The bet is ${formatMoney(eco.currency, bet)} each, winner takes all.` : ""}\n-# This offer ends <t:${Math.ceil((Date.now() + CHALLENGE_MS) / 1000)}:R>.`,
    components: [askButtons(id, "Battle!")],
    allowedMentions: { users: [other.id] },
  });
}

async function trade(i: ChatInputCommandInteraction<"cached">, s: CardSettings) {
  if (!s.trading) return i.reply("Trading is switched off in this server.");
  const other = i.options.getMember("member");
  if (!other || other.user.bot || other.id === i.user.id) return i.reply("Pick another member to trade with.");
  const give = cardById.get(i.options.getString("give", true));
  const get = cardById.get(i.options.getString("get", true));
  if (!give || !store.ownedCount(i.guildId, i.user.id, give.id)) return i.reply("You can only offer a card you own. Pick it from the list.");
  if (!get || !store.ownedCount(i.guildId, other.id, get.id)) return i.reply(`<@${other.id}> doesn't have that card. Pick one from the list.`);
  const id = String(nextId++);
  pending.set(id, { kind: "trade", guildId: i.guildId, from: i.user.id, to: other.id, bet: 0, give: give.id, get: get.id, expires: Date.now() + CHALLENGE_MS });
  return i.reply({
    content: `🔁 <@${other.id}>, <@${i.user.id}> wants to trade:\nThey give: ${line(give)}\nYou give: ${line(get)}\n-# This offer ends <t:${Math.ceil((Date.now() + CHALLENGE_MS) / 1000)}:R>.`,
    components: [askButtons(id, "Trade")],
    allowedMentions: { users: [other.id] },
  });
}

async function gift(i: ChatInputCommandInteraction<"cached">, s: CardSettings) {
  if (!s.trading) return i.reply("Trading and gifts are switched off in this server.");
  const other = i.options.getMember("member");
  if (!other || other.user.bot || other.id === i.user.id) return i.reply("Pick another member to give it to.");
  const card = cardById.get(i.options.getString("card", true));
  if (!card || !store.swap(i.guildId, i.user.id, card.id, other.id, null)) return i.reply("You can only give a card you own. Pick it from the list.");
  return i.reply({ content: `🎀 <@${i.user.id}> gave ${line(card)} to <@${other.id}>!`, allowedMentions: { users: [other.id] } });
}

async function sell(i: ChatInputCommandInteraction<"cached">, s: CardSettings, mode: CardMode, duplicates: boolean) {
  if (mode !== "economy") return i.reply("Cards can't be sold in this server.");
  const eco = await economyOf(i.guildId);
  const owned = store.collectionOf(i.guildId, i.user.id);
  let sales: { cardId: string; quantity: number; each: number }[];
  if (duplicates) {
    const maxRarity = i.options.getString("up_to") ?? "epic";
    sales = [...owned]
      .filter(([id, qty]) => qty > 1 && cardById.has(id) && rarities.indexOf(cardById.get(id)!.rarity) <= rarities.indexOf(maxRarity as Card["rarity"]))
      .map(([id, qty]) => ({ cardId: id, quantity: qty - 1, each: s.sell[cardById.get(id)!.rarity] }));
    if (!sales.length) return i.reply("You don't have any duplicates to sell.");
  } else {
    const card = cardById.get(i.options.getString("card", true));
    const quantity = i.options.getInteger("quantity") ?? 1;
    if (!card || (owned.get(card.id) ?? 0) < quantity) return i.reply("You don't have that many of that card.");
    sales = [{ cardId: card.id, quantity, each: s.sell[card.rarity] }];
  }
  const r = store.sell(i.guildId, i.user.id, sales, eco.startingBalance);
  if (!r) return i.reply("You don't have those cards anymore.");
  const count = sales.reduce((a, b) => a + b.quantity, 0);
  return i.reply({ content: `💸 Sold ${count} card${count === 1 ? "" : "s"} for ${formatMoney(eco.currency, r.earned)}.\n-# Balance: ${formatMoney(eco.currency, r.balance, false)}`, allowedMentions: { parse: [] } });
}

async function top(i: ChatInputCommandInteraction<"cached">) {
  const rows = store.topCollectors(i.guildId, 10);
  if (!rows.length) return i.reply("Nobody has any cards yet. Be the first with `/cards daily`!");
  const medal = ["🥇", "🥈", "🥉"];
  const embed = new EmbedBuilder()
    .setColor(PINK)
    .setTitle("🃏 Top collectors")
    .setDescription(rows.map((r, k) => `${medal[k] ?? `**${k + 1}.**`} <@${r.userId}> · ${r.unique} different cards (${r.total} in all)`).join("\n"));
  return i.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

/* ------------------------------------------------------------ /cards */

const cardOpt = (o: import("discord.js").SlashCommandStringOption, name: string, about: string, required = true) => o.setName(name).setDescription(about).setRequired(required).setAutocomplete(true);

const cardsCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("cards")
    .setDescription("Collect BLACKPINK cards, build a team and battle.")
    .setContexts(0)
    .addSubcommand((c) => c.setName("daily").setDescription("Open your free daily pack"))
    .addSubcommand((c) =>
      c
        .setName("open")
        .setDescription("Buy and open a pack")
        .addStringOption((o) =>
          o
            .setName("pack")
            .setDescription("Which pack")
            .setRequired(true)
            .addChoices({ name: "📦 Standard pack", value: "standard" }, { name: "💝 Premium pack", value: "premium" }),
        ),
    )
    .addSubcommand((c) => c.setName("packs").setDescription("See the packs and what they cost"))
    .addSubcommand((c) =>
      c
        .setName("collection")
        .setDescription("See your cards (or someone else's)")
        .addUserOption((o) => o.setName("member").setDescription("Whose collection (yours if empty)"))
        .addIntegerOption((o) => o.setName("page").setDescription("Which page").setMinValue(1)),
    )
    .addSubcommand((c) => c.setName("view").setDescription("Look at a card up close").addStringOption((o) => cardOpt(o, "card", "Which card")))
    .addSubcommand((c) =>
      c
        .setName("team")
        .setDescription("See or pick your battle team of 3")
        .addStringOption((o) => cardOpt(o, "first", "First card (goes first in battle)", false))
        .addStringOption((o) => cardOpt(o, "second", "Second card", false))
        .addStringOption((o) => cardOpt(o, "third", "Third card", false)),
    )
    .addSubcommand((c) =>
      c
        .setName("battle")
        .setDescription("Battle Number One, or challenge a member")
        .addUserOption((o) => o.setName("opponent").setDescription("Who to battle (Number One if empty)"))
        .addIntegerOption((o) => o.setName("bet").setDescription("Bet against a member (With Economy only)").setMinValue(1).setMaxValue(1_000_000)),
    )
    .addSubcommand((c) =>
      c
        .setName("trade")
        .setDescription("Offer to swap one of your cards for one of theirs")
        .addUserOption((o) => o.setName("member").setDescription("Who to trade with").setRequired(true))
        .addStringOption((o) => cardOpt(o, "give", "The card you give"))
        .addStringOption((o) => cardOpt(o, "get", "The card you want from them")),
    )
    .addSubcommand((c) =>
      c
        .setName("gift")
        .setDescription("Give one of your cards to someone")
        .addUserOption((o) => o.setName("member").setDescription("Who gets it").setRequired(true))
        .addStringOption((o) => cardOpt(o, "card", "Which card")),
    )
    .addSubcommand((c) =>
      c
        .setName("sell")
        .setDescription("Sell a card (With Economy only)")
        .addStringOption((o) => cardOpt(o, "card", "Which card"))
        .addIntegerOption((o) => o.setName("quantity").setDescription("How many (1 if empty)").setMinValue(1).setMaxValue(1000)),
    )
    .addSubcommand((c) =>
      c
        .setName("sell-duplicates")
        .setDescription("Sell every extra copy, keeping one of each (With Economy only)")
        .addStringOption((o) =>
          o
            .setName("up_to")
            .setDescription("Highest rarity to sell (Epic if empty)")
            .addChoices(...rarities.map((r) => ({ name: rarityInfo[r].name, value: r }))),
        ),
    )
    .addSubcommand((c) => c.setName("top").setDescription("See the top collectors")),
  autocomplete,
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const s = await settingsOf(interaction.guildId);
    const mode = await modeOf(interaction.guildId, s);
    const sub = interaction.options.getSubcommand();
    if (sub === "daily") return daily(interaction, s);
    if (sub === "open") return open(interaction, s, mode);
    if (sub === "packs") return packs(interaction, s, mode);
    if (sub === "collection") return collection(interaction);
    if (sub === "view") return view(interaction);
    if (sub === "team") return team(interaction);
    if (sub === "battle") {
      if (!s.battles.enabled) return interaction.reply("Battles are switched off in this server.");
      return interaction.options.getUser("opponent") ? challenge(interaction, s, mode) : battleBot(interaction, s, mode);
    }
    if (sub === "trade") return trade(interaction, s);
    if (sub === "gift") return gift(interaction, s);
    if (sub === "sell") return sell(interaction, s, mode, false);
    if (sub === "sell-duplicates") return sell(interaction, s, mode, true);
    if (sub === "top") return top(interaction);
  },
};

/* ------------------------------------------------------------ answering battles and trades */

const answers: ComponentHandler = {
  prefix: PREFIX,
  async handle(interaction: MessageComponentInteraction) {
    if (!interaction.inCachedGuild() || !interaction.isButton()) return;
    const [, answer, id] = interaction.customId.split(":");
    const p = pending.get(id);
    if (!p || p.expires < Date.now()) {
      pending.delete(id);
      return interaction.update({ content: "This offer has ended.", components: [] });
    }
    if (interaction.user.id !== p.to) {
      if (answer === "no" && interaction.user.id === p.from) {
        pending.delete(id);
        return interaction.update({ content: "Offer cancelled.", components: [] });
      }
      return interaction.reply({ content: "This offer isn't for you.", flags: MessageFlags.Ephemeral });
    }
    pending.delete(id);
    if (answer === "no") return interaction.update({ content: `<@${p.to}> said no thanks.`, components: [], allowedMentions: { parse: [] } });

    if (p.kind === "trade") {
      const ok = store.swap(p.guildId, p.from, p.give!, p.to, p.get!);
      if (!ok) return interaction.update({ content: "The trade didn't go through: one of the cards isn't there anymore.", components: [] });
      return interaction.update({
        content: `🔁 Trade done! <@${p.from}> got ${line(cardById.get(p.get!)!)} and <@${p.to}> got ${line(cardById.get(p.give!)!)}.`,
        components: [],
        allowedMentions: { parse: [] },
      });
    }

    // Battle between two members.
    const teams = [p.from, p.to].map((u) => teamOf(store.playerOf(p.guildId, u).team, store.collectionOf(p.guildId, u))) as [Card[], Card[]];
    if (!teams[1].length) return interaction.update({ content: `<@${p.to}> needs at least one card to battle. Try \`/cards daily\`!`, components: [], allowedMentions: { parse: [] } });
    let extra = "";
    let eco: EconomySettings | null = null;
    const economyStore = p.bet ? await import("../economy/store.js") : null;
    if (p.bet && economyStore) {
      eco = await economyOf(p.guildId);
      const a = economyStore.spend(p.guildId, p.from, p.bet, "cards", eco.startingBalance);
      if (!a.ok) return interaction.update({ content: `<@${p.from}> doesn't have enough for the bet anymore.`, components: [], allowedMentions: { parse: [] } });
      const b = economyStore.spend(p.guildId, p.to, p.bet, "cards", eco.startingBalance);
      if (!b.ok) {
        economyStore.credit(p.guildId, p.from, p.bet, "refund", { startingBalance: eco.startingBalance });
        return interaction.update({ content: `<@${p.to}> doesn't have enough for the bet.`, components: [], allowedMentions: { parse: [] } });
      }
    }
    const members = [p.from, p.to].map((u) => interaction.guild.members.cache.get(u)?.displayName ?? "Player") as [string, string];
    const result = battle(teams, members);
    const winnerId = result.winner === 0 ? p.from : p.to;
    store.recordBattle(p.guildId, p.from, result.winner === 0);
    store.recordBattle(p.guildId, p.to, result.winner === 1);
    if (p.bet && economyStore && eco) {
      economyStore.credit(p.guildId, winnerId, p.bet * 2, "cards", { startingBalance: eco.startingBalance });
      extra = `They win ${formatMoney(eco.currency, p.bet * 2)}!`;
    }
    return interaction.update({ content: "", embeds: [battleEmbed(members, teams, result, extra)], components: [], allowedMentions: { parse: [] } });
  },
};

/** Forgets offers nobody answered. */
function prune() {
  for (const [id, p] of pending) if (p.expires < Date.now()) pending.delete(id);
}

/* ------------------------------------------------------------ dashboard: server settings */

async function respond(guild: Guild): Promise<CardsResponse> {
  const s = await settingsOf(guild.id);
  const economyOff = !(await isFeatureEnabled(guild.id, economyFeature));
  const eco = await economyOf(guild.id);
  const rows = store.topCollectors(guild.id, 10);
  const members = rows.length ? await guild.members.fetch({ user: rows.map((r) => r.userId) }).catch(() => null) : null;
  const stats = store.serverStats(guild.id);
  const ready = readyCount();
  const problems: string[] = [];
  if (!ready) problems.push("No cards have photos yet, so packs are empty. Cards appear as soon as photos are added.");
  if (s.mode === "economy" && economyOff) problems.push("Economy is switched off, so the game runs as Cards only (free daily packs, no buying or selling) until you switch it on.");
  return {
    settings: s,
    mode: await modeOf(guild.id, s),
    economyOff,
    ready,
    currency: { singular: eco.currency.singular, plural: eco.currency.plural, emoji: eco.currency.emoji },
    stats: { ...stats, catalog: CARD_COUNT },
    top: rows.map((r) => ({ ...r, name: members?.get(r.userId)?.displayName ?? "Someone" })),
    problems,
  };
}

/* ------------------------------------------------------------ Developer page: photos */

const photosResponse = (): CardPhotosResponse => ({ photos: photoList(), ready: readyCount(), total: CARD_COUNT });

/** The Developer page's card photo routes. Only the bot's developer can use them. */
export function registerCardsDeveloperApi(api: FastifyInstance) {
  void loadPhotoList();
  api.register(async (dev) => {
    dev.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await isDeveloper(request.session!.userId))) return reply.code(403).send({ error: "Only the bot's developer can use this." });
    });
    // Photos are uploaded as the raw file, one per request.
    dev.addContentTypeParser(["image/jpeg", "image/png", "image/webp", "image/gif"], { parseAs: "buffer", bodyLimit: CARD_PHOTO.maxBytes }, (_req, body, done) =>
      done(null, body),
    );

    dev.get("/api/developer/cards", async () => photosResponse());

    dev.get<{ Params: { key: string } }>("/api/developer/cards/photos/:key", async (request, reply) => {
      if (!isPhotoKey(request.params.key)) return reply.code(404).send({ error: "No such photo." });
      try {
        return reply.type("image/jpeg").header("cache-control", "private, max-age=60").send(photoFile(request.params.key));
      } catch {
        return reply.code(404).send({ error: "No such photo." });
      }
    });

    dev.put<{ Params: { key: string }; Querystring: { credit?: string } }>("/api/developer/cards/photos/:key", async (request, reply) => {
      const key = request.params.key;
      if (!isPhotoKey(key)) return reply.code(400).send({ error: "That isn't a member or card I know." });
      if (!Buffer.isBuffer(request.body) || !request.body.length) return reply.code(400).send({ error: "Send a JPG, PNG, WebP or GIF picture." });
      try {
        await savePhoto(key, request.body, String(request.query.credit ?? "").trim().slice(0, CARD_PHOTO.credit), request.session!.userId);
      } catch {
        return reply.code(400).send({ error: "That file couldn't be read as a picture." });
      }
      return photosResponse();
    });

    dev.patch<{ Params: { key: string } }>("/api/developer/cards/photos/:key", async (request, reply) => {
      const credit = String((request.body as { credit?: string })?.credit ?? "").trim().slice(0, CARD_PHOTO.credit);
      if (!isPhotoKey(request.params.key)) return reply.code(400).send({ error: "That isn't a member or card I know." });
      await setCredit(request.params.key, credit);
      return photosResponse();
    });

    dev.delete<{ Params: { key: string } }>("/api/developer/cards/photos/:key", async (request) => {
      if (isPhotoKey(request.params.key)) await deletePhoto(request.params.key);
      return photosResponse();
    });

    /** A finished card as a picture, to preview on the Developer page. */
    dev.get<{ Params: { id: string } }>("/api/developer/cards/preview/:id", async (request, reply) => {
      const card = cardById.get(request.params.id);
      if (!card) return reply.code(404).send({ error: "No such card." });
      return reply.type("image/png").header("cache-control", "no-store").send(await renderCard(card));
    });
  });
}

/* ------------------------------------------------------------ feature */

export const cardsBot: BotFeature = {
  info: cardsFeature,
  commands: [cardsCommand],
  components: [answers],

  setup() {
    void loadPhotoList();
    setInterval(prune, 60_000).unref();
  },

  registerApi(api) {
    const guildOf = (request: Req) => client.guilds.cache.get(request.params.guildId)!;
    api.get("/api/guilds/:guildId/cards", async (request: Req) => respond(guildOf(request)));
    api.put("/api/guilds/:guildId/cards/settings", async (request: Req, reply) => {
      const guild = guildOf(request);
      const parsed = cardSettings.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
      const s = parsed.data;
      const state = await getFeatureState(guild.id, cardsFeature);
      await saveFeatureState(guild.id, cardsFeature, { enabled: state.enabled, settings: s }, request.session!.userId);
      return respond(guild);
    });
  },
};

