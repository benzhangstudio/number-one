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
  StringSelectMenuBuilder,
} from "discord.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isDeveloper } from "../bot-updates/developer.js";
import { client } from "../../server/bot/discord.js";
import type { BotFeature, ComponentHandler, SlashCommand } from "../../server/bot/types.js";
import { getFeatureState, isFeatureEnabled, saveFeatureState } from "../../server/settings.js";
import { type EconomySettings, formatMoney } from "../../shared/economy.js";
import { cardsFeature, economyFeature } from "../../shared/features.js";
import {
  CARD_PHOTO,
  type Card,
  type CardAdminResponse,
  type CardMode,
  type CardSettings,
  type CardsResponse,
  type PackKind,
  type PileCardsResponse,
  type Rarity,
  cardEdit,
  cardLabel,
  cardSettings,
  type GiveMember,
  type GiveServer,
  givePacksInput,
  packInfo,
  pileByKey,
  piles,
  rarities,
  rarityInfo,
  rollPullReward,
  typeInfo,
} from "../../shared/cards.js";
import { battle, openPack, rivalTeam, shortLog, teamOf } from "./game.js";
import { activeCards, activeCount, addCard, allCards, cardCount, deleteCard, editCard, getCard, loadCatalog, ownersByCard, photoFile, pileCards, replacePhoto } from "./catalog.js";
import { renderCard, renderRow } from "./render.js";
import * as store from "./store.js";

/**
 * BLACKPINK Poker: /cards to open packs, collect, build a team, battle, trade and gift.
 * With Economy, packs cost the server's currency and duplicates sell for it; in Cards only mode there's
 * no money, just a free daily pack (and a bonus card for beating Number One).
 * Cards are added by the bot's developer on the Developer page (registerCardsDeveloperApi below).
 */

type Req = FastifyRequest<{ Params: { guildId: string } }>;

const PINK = 0xff4fa3;
const PREFIX = "kc";
const DAILY_MS = 20 * 60 * 60 * 1000;
const CHALLENGE_MS = 2 * 60_000;

const settingsOf = async (guildId: string) => (await getFeatureState(guildId, cardsFeature)).settings as CardSettings;
const economyOf = async (guildId: string) => (await getFeatureState(guildId, economyFeature)).settings as EconomySettings;

/** The mode actually in use: With Economy needs the Economy module switched on. */
async function modeOf(guildId: string, s: CardSettings): Promise<CardMode> {
  return s.mode === "economy" && (await isFeatureEnabled(guildId, economyFeature)) ? "economy" : "cards";
}

const stars = (c: Card) => "★".repeat(rarityInfo[c.rarity].stars);
const line = (c: Card, qty?: number) => `${stars(c)} **${c.subject}** · ${c.name} (${c.groupName})${qty && qty > 1 ? ` ×${qty}` : ""}`;
const notReady = "There aren't any cards to collect yet. They're being added, so check back soon!";

/* ------------------------------------------------------------ suggestions while typing */

function searchCards(list: { card: Card; qty?: number }[], typed: string) {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  return list
    .filter(({ card }) => words.every((w) => `${card.subject} ${card.groupName} ${card.name} ${card.rarity}`.toLowerCase().includes(w)))
    .sort((a, b) => rarities.indexOf(b.card.rarity) - rarities.indexOf(a.card.rarity) || a.card.number - b.card.number)
    .slice(0, 25)
    .map(({ card, qty }) => ({
      name: `${card.subject} · ${card.name} (${card.groupName}) ${"★".repeat(rarityInfo[card.rarity].stars)}${qty && qty > 1 ? ` ×${qty}` : ""}`.slice(0, 100),
      value: card.id,
    }));
}

const ownedList = (guildId: string, userId: string) =>
  [...store.collectionOf(guildId, userId)].filter(([id]) => Boolean(getCard(id))).map(([id, qty]) => ({ card: getCard(id)!, qty }));

async function autocomplete(interaction: AutocompleteInteraction) {
  if (!interaction.inCachedGuild()) return interaction.respond([]);
  const focused = interaction.options.getFocused(true);
  const typed = String(focused.value);
  const sub = interaction.options.getSubcommand();
  if (sub === "view") return interaction.respond(searchCards(activeCards().map((card) => ({ card })), typed));
  if (sub === "trade" && focused.name === "get") {
    const other = interaction.options.get("member")?.value;
    return interaction.respond(typeof other === "string" ? searchCards(ownedList(interaction.guildId, other), typed) : []);
  }
  return interaction.respond(searchCards(ownedList(interaction.guildId, interaction.user.id), typed));
}

/**
 * Pays the coins for pulled cards (With Economy mode, when pull rewards are on).
 * Returns the line to show under the pack, or "" when nothing was paid.
 */
async function payPulls(guildId: string, userId: string, s: CardSettings, mode: CardMode, list: Card[]) {
  if (mode !== "economy" || !s.pullRewards.enabled || !list.length) return { total: 0, note: "", balance: null as number | null };
  const total = list.reduce((sum, c) => sum + rollPullReward(s, c.rarity), 0);
  if (total <= 0) return { total: 0, note: "", balance: null };
  const eco = await economyOf(guildId);
  const { credit } = await import("../economy/store.js");
  const { balance } = credit(guildId, userId, total, "cards", { startingBalance: eco.startingBalance });
  return { total, note: `💰 You also earned ${formatMoney(eco.currency, total)} from these cards.`, balance };
}

/* ------------------------------------------------------------ replies */

async function packReply(owner: string, title: string, list: Card[], before: Map<string, number>, footer: string, note = "") {
  const png = await renderRow(list);
  const lines = list.map((c) => `${line(c)}${before.has(c.id) ? "" : " · **NEW!**"}`);
  const best = list.reduce((a, b) => (rarities.indexOf(b.rarity) > rarities.indexOf(a.rarity) ? b : a));
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(rarityInfo[best.rarity].color.slice(1), 16))
    .setTitle(title)
    .setDescription(`<@${owner}> got:\n${lines.join("\n")}${note ? `\n\n${note}` : ""}`)
    .setImage("attachment://pack.png")
    .setFooter({ text: footer });
  return { embeds: [embed], files: [new AttachmentBuilder(png, { name: "pack.png" })], allowedMentions: { parse: [] as never[] } };
}

async function cardReply(card: Card, note = "") {
  const png = await renderCard(card);
  const t = typeInfo[card.type];
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(rarityInfo[card.rarity].color.slice(1), 16))
    .setTitle(`${card.subject} · ${card.name}`)
    .setDescription(`${card.groupName} · ${rarityInfo[card.rarity].name} · ${t.emoji} ${t.name}\nHP **${card.hp}** · ${t.move} **${card.power}**${note ? `\n${note}` : ""}`)
    .setImage("attachment://card.png");
  return { embeds: [embed], files: [new AttachmentBuilder(png, { name: "card.png" })], allowedMentions: { parse: [] as never[] } };
}

/* ------------------------------------------------------------ subcommands */

async function daily(i: ChatInputCommandInteraction<"cached">, s: CardSettings, mode: CardMode) {
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
  const paid = await payPulls(i.guildId, i.user.id, s, mode, list);
  return i.editReply(await packReply(i.user.id, "🎁 Daily pack", list, before, "Come back in 20 hours for another one.", paid.note));
}

const bagText = (bag: store.Bag) =>
  bag.standard || bag.premium
    ? `🎒 Unopened: ${packInfo.standard.emoji} ${bag.standard} Standard · ${packInfo.premium.emoji} ${bag.premium} Premium`
    : "🎒 No unopened packs left";

/** "Open" buttons for the packs left in a member's bag (only they can press them). */
function openButtons(userId: string, bag: store.Bag) {
  const kinds = (["standard", "premium"] as const).filter((k) => bag[k] > 0);
  if (!kinds.length) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      kinds.map((k) =>
        new ButtonBuilder()
          .setCustomId(`${PREFIX}:open:${userId}:${k}`)
          .setLabel(`Open ${packInfo[k].name.toLowerCase()} (${bag[k]} left)`)
          .setEmoji(packInfo[k].emoji)
          .setStyle(k === "premium" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      ),
    ),
  ];
}

/** Buys packs and puts them in the member's bag, to open whenever they like. */
async function buy(i: ChatInputCommandInteraction<"cached">, s: CardSettings, mode: CardMode) {
  if (mode !== "economy") return i.reply("Packs aren't sold in this server. Use `/cards daily` for your free pack!");
  if (!activeCount()) return i.reply(notReady);
  const kind = i.options.getString("pack", true) as store.StoredPack;
  const amount = i.options.getInteger("amount") ?? 1;
  const eco = await economyOf(i.guildId);
  const price = s.prices[kind];
  const r = store.buyPacks(i.guildId, i.user.id, kind, amount, price, eco.startingBalance);
  const what = `${amount} ${packInfo[kind].name.toLowerCase()}${amount === 1 ? "" : "s"}`;
  if (!r.ok) {
    return i.reply({ content: `You need ${formatMoney(eco.currency, price * amount)} for ${what}. You have ${formatMoney(eco.currency, r.balance)}.`, allowedMentions: { parse: [] } });
  }
  const embed = new EmbedBuilder()
    .setColor(PINK)
    .setTitle(`${packInfo[kind].emoji} Bought ${what}!`)
    .setDescription(`Paid ${formatMoney(eco.currency, price * amount)} · Balance: ${formatMoney(eco.currency, r.balance)}\n\n${bagText(r.bag)}\nOpen them one at a time with \`/cards open\` or the button below.`);
  return i.reply({ embeds: [embed], components: openButtons(i.user.id, r.bag), allowedMentions: { parse: [] } });
}

/** Opens one pack from the bag and shows it. Used by /cards open and the "Open" buttons. */
async function openOne(guildId: string, user: { id: string }, s: CardSettings, mode: CardMode, asked: store.StoredPack | null) {
  const bag = store.bagOf(guildId, user.id);
  // No pack picked: open a Standard first, so the Premium ones are saved for last.
  const kind = asked ?? (bag.standard ? "standard" : bag.premium ? "premium" : null);
  if (!kind || !bag[kind]) {
    const none = asked ? `You don't have any unopened ${packInfo[asked].name.toLowerCase()}s.` : "You don't have any unopened packs.";
    return { content: `${none} Buy some with \`/cards buy\`${s.daily ? ", or open your free one with `/cards daily`" : ""}.` };
  }
  const list = openPack(s, kind);
  if (!list) return { content: notReady };
  const before = store.collectionOf(guildId, user.id);
  const left = store.openFromBag(guildId, user.id, kind, list.map((c) => c.id));
  if (!left) return { content: `You don't have any unopened ${packInfo[kind].name.toLowerCase()}s.` };
  const paid = await payPulls(guildId, user.id, s, mode, list);
  const reply = await packReply(user.id, `${packInfo[kind].emoji} ${packInfo[kind].name}`, list, before, bagText(left).replace("🎒 ", ""), paid.note);
  return { ...reply, components: openButtons(user.id, left) };
}

async function open(i: ChatInputCommandInteraction<"cached">, s: CardSettings, mode: CardMode) {
  await i.deferReply();
  const reply = await openOne(i.guildId, i.user, s, mode, i.options.getString("pack") as store.StoredPack | null);
  return i.editReply({ allowedMentions: { parse: [] }, ...reply });
}

const pullRange = (s: CardSettings, r: Rarity) => {
  const { min, max } = s.pullRewards[r];
  const [lo, hi] = [Math.min(min, max), Math.max(min, max)].map((x) => x.toLocaleString("en-US"));
  return lo === hi ? lo : `${lo}–${hi}`;
};

async function packs(i: ChatInputCommandInteraction<"cached">, s: CardSettings, mode: CardMode) {
  const ready = activeCount();
  const embed = new EmbedBuilder().setColor(PINK).setTitle("🖤💗 BLACKPINK Poker");
  if (mode === "economy") {
    const eco = await economyOf(i.guildId);
    embed.setDescription(
      [
        `${packInfo.standard.emoji} **Standard pack** · ${formatMoney(eco.currency, s.prices.standard)}\n${packInfo.standard.about}`,
        `${packInfo.premium.emoji} **Premium pack** · ${formatMoney(eco.currency, s.prices.premium)}\n${packInfo.premium.about}`,
        s.daily ? `${packInfo.daily.emoji} **Daily pack** · free\n${packInfo.daily.about}` : "",
        s.pullRewards.enabled
          ? `💰 **Every card you pull pays coins**\n${rarities.map((r) => `${rarityInfo[r].name}: ${pullRange(s, r)}`).join(" · ")}`
          : "",
        "Buy packs with `/cards buy` (several at once if you like) and open them one at a time with `/cards open`. Sell duplicates with `/cards sell-duplicates`.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  } else {
    embed.setDescription(
      [`${packInfo.daily.emoji} **Daily pack** · free\n${packInfo.daily.about} Open it with \`/cards daily\`.`, "Beat Number One in `/cards battle` for a bonus card (a few times a day)."].join("\n\n"),
    );
  }
  const bag = store.bagOf(i.guildId, i.user.id);
  if (bag.standard || bag.premium) embed.addFields({ name: "Your bag", value: bagText(bag) });
  embed.setFooter({ text: `${ready.toLocaleString("en-US")} cards to collect, with more added over time · ★ Common to ★★★★★ Mythic` });
  return i.reply({ embeds: [embed], components: openButtons(i.user.id, bag), allowedMentions: { parse: [] } });
}

/** A member's cards in browsing order: best rarity first, then newest card first. */
function collectionOrder(guildId: string, userId: string) {
  return ownedList(guildId, userId).sort((a, b) => rarities.indexOf(b.card.rarity) - rarities.indexOf(a.card.rarity) || b.card.number - a.card.number);
}

/**
 * One card of a collection, shown big, with ⏮ ◀ ▶ ⏭ buttons to flip through. Only the person who opened it can
 * flip (the buttons carry whose collection it is, who's browsing and which card is showing).
 */
export async function collectionPage(guildId: string, owner: { id: string; name: string; avatar: string }, viewerId: string, index: number) {
  const list = collectionOrder(guildId, owner.id);
  if (!list.length) return null;
  const i = Math.max(0, Math.min(index, list.length - 1));
  const { card, qty } = list[i];
  const t = typeInfo[card.type];
  const png = await renderCard(card);
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(rarityInfo[card.rarity].color.slice(1), 16))
    .setAuthor({ name: `${owner.name}'s collection`, iconURL: owner.avatar || undefined })
    .setTitle(cardLabel(card))
    .setDescription(
      `${stars(card)} ${rarityInfo[card.rarity].name} · ${t.emoji} ${t.name}${card.about ? ` · ${card.about}` : ""}\nHP **${card.hp}** · ${t.move} **${card.power}**${qty > 1 ? ` · You have **${qty}**` : ""}`,
    )
    .setImage("attachment://card.png")
    .setFooter({ text: `Card ${i + 1} of ${list.length} · ${list.length} of ${cardCount()} cards collected` });
  const go = (to: number) => `${PREFIX}:col:${owner.id}:${viewerId}:${to}`;
  const last = list.length - 1;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${go(0)}:first`).setEmoji("⏮️").setStyle(ButtonStyle.Secondary).setDisabled(i === 0),
    new ButtonBuilder().setCustomId(`${go(i - 1)}:back`).setEmoji("◀️").setLabel("Back").setStyle(ButtonStyle.Primary).setDisabled(i === 0),
    new ButtonBuilder().setCustomId(`${go(i)}:count`).setLabel(`${i + 1} / ${list.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${go(i + 1)}:next`).setEmoji("▶️").setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(i === last),
    new ButtonBuilder().setCustomId(`${go(last)}:last`).setEmoji("⏭️").setStyle(ButtonStyle.Secondary).setDisabled(i === last),
  );
  return {
    embeds: [embed],
    files: [new AttachmentBuilder(png, { name: "card.png" })],
    components: list.length > 1 ? [row] : [],
    allowedMentions: { parse: [] as never[] },
  };
}

/* ------------------------------------------------------------ catalog: every card, by member, pairing and group */

const kindHeading = { member: "👤 Members", ship: "💞 Pairings", group: "👯 Group" } as const;
const kindEmoji = { member: "👤", ship: "💞", group: "👯" } as const;

/** The cards shown in a pile: those in packs, plus retired ones the viewer still owns. Best rarity first. */
function catalogCards(pile: string, owned: Map<string, number>) {
  return pileCards(pile)
    .filter((c) => c.active || owned.has(c.id))
    .sort((a, b) => rarities.indexOf(b.rarity) - rarities.indexOf(a.rarity) || a.number - b.number);
}

function pileMenu(viewerId: string, current: string) {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:cat:${viewerId}`)
      .setPlaceholder("Pick a member, pairing or the group")
      .addOptions(
        { label: "All piles", value: "all", emoji: "📇", default: current === "all" },
        ...piles.slice(0, 24).map((p) => ({ label: p.subject, value: p.key, description: p.about || (p.kind === "group" ? "The whole group" : undefined), emoji: kindEmoji[p.kind], default: current === p.key })),
      ),
  );
}

/** Every card in the game: the overview of all piles, or one pile's cards one at a time. */
export async function catalogPage(guildId: string, viewerId: string, pile: string, index: number) {
  const owned = store.collectionOf(guildId, viewerId);
  if (pile === "all" || !pileByKey.has(pile)) {
    const embed = new EmbedBuilder().setColor(PINK).setTitle("📇 Card catalog").setDescription("Every BLACKPINK Poker card, by member, pairing and the group. Pick one below to flip through its cards.");
    for (const kind of ["member", "group", "ship"] as const) {
      const lines = piles
        .filter((p) => p.kind === kind)
        .map((p) => {
          const list = catalogCards(p.key, owned);
          if (!list.length) return `**${p.subject}** · no cards yet`;
          const have = list.filter((c) => owned.has(c.id)).length;
          return `**${p.subject}** · ${have}/${list.length} collected${have === list.length ? " ✅" : ""}`;
        });
      if (lines.length) embed.addFields({ name: kindHeading[kind], value: lines.join("\n"), inline: kind !== "ship" });
    }
    const total = activeCards().length;
    const have = activeCards().filter((c) => owned.has(c.id)).length;
    embed.setFooter({ text: `You've collected ${have} of ${total} cards` });
    return { embeds: [embed], files: [], components: [pileMenu(viewerId, "all")], allowedMentions: { parse: [] as never[] } };
  }

  const p = pileByKey.get(pile)!;
  const list = catalogCards(pile, owned);
  const back = new ButtonBuilder().setCustomId(`${PREFIX}:cat:${viewerId}:all:0:home`).setEmoji("📇").setLabel("All piles").setStyle(ButtonStyle.Secondary);
  if (!list.length) {
    const embed = new EmbedBuilder().setColor(PINK).setTitle(`${kindEmoji[p.kind]} ${p.subject}`).setDescription("No cards in this pile yet. More are added over time!");
    return { embeds: [embed], files: [], components: [pileMenu(viewerId, pile), new ActionRowBuilder<ButtonBuilder>().addComponents(back)], allowedMentions: { parse: [] as never[] } };
  }
  const i = Math.max(0, Math.min(index, list.length - 1));
  const card = list[i];
  const qty = owned.get(card.id) ?? 0;
  const t = typeInfo[card.type];
  const have = list.filter((c) => owned.has(c.id)).length;
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(rarityInfo[card.rarity].color.slice(1), 16))
    .setAuthor({ name: `📇 Catalog · ${p.subject}${p.about ? ` (${p.about})` : ""}` })
    .setTitle(cardLabel(card))
    .setDescription(
      `${stars(card)} ${rarityInfo[card.rarity].name} · ${t.emoji} ${t.name}\nHP **${card.hp}** · ${t.move} **${card.power}**\n${qty ? `✅ You have **${qty}**` : "🔒 Not collected yet"}${card.active ? "" : " · no longer in packs"}`,
    )
    .setImage("attachment://card.png")
    .setFooter({ text: `Card ${i + 1} of ${list.length} · You have ${have} of ${list.length} ${p.subject} cards` });
  const go = (to: number) => `${PREFIX}:cat:${viewerId}:${pile}:${to}`;
  const last = list.length - 1;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${go(i - 1)}:back`).setEmoji("◀️").setLabel("Back").setStyle(ButtonStyle.Primary).setDisabled(i === 0),
    new ButtonBuilder().setCustomId(`${go(i)}:count`).setLabel(`${i + 1} / ${list.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${go(i + 1)}:next`).setEmoji("▶️").setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(i === last),
    back,
  );
  return {
    embeds: [embed],
    files: [new AttachmentBuilder(await renderCard(card), { name: "card.png" })],
    components: [pileMenu(viewerId, pile), row],
    allowedMentions: { parse: [] as never[] },
  };
}

async function catalog(i: ChatInputCommandInteraction<"cached">) {
  if (!cardCount()) return i.reply(notReady);
  await i.deferReply();
  return i.editReply(await catalogPage(i.guildId, i.user.id, i.options.getString("pile") ?? "all", 0));
}

async function collection(i: ChatInputCommandInteraction<"cached">) {
  const user = i.options.getUser("member") ?? i.user;
  const member = i.options.getMember("member") ?? (user.id === i.user.id ? i.member : null);
  const owner = { id: user.id, name: member?.displayName ?? user.displayName, avatar: user.displayAvatarURL({ size: 64 }) };
  const start = (i.options.getInteger("card") ?? 1) - 1;
  if (!store.collectionOf(i.guildId, user.id).size) {
    const self = user.id === i.user.id;
    return i.reply({ content: self ? "You don't have any cards yet. Try `/cards daily`!" : `<@${user.id}> doesn't have any cards yet.`, allowedMentions: { parse: [] } });
  }
  await i.deferReply();
  return i.editReply((await collectionPage(i.guildId, owner, i.user.id, start))!);
}

async function view(i: ChatInputCommandInteraction<"cached">) {
  const card = getCard(i.options.getString("card", true));
  if (!card) return i.reply("I couldn't find that card. Pick one from the list.");
  await i.deferReply();
  const qty = store.ownedCount(i.guildId, i.user.id, card.id);
  return i.editReply(await cardReply(card, qty ? `You have ${qty}.` : "You don't have this one yet."));
}

async function team(i: ChatInputCommandInteraction<"cached">) {
  const picked = ["first", "second", "third"].map((n) => i.options.getString(n)).filter((x): x is string => Boolean(x));
  const owned = store.collectionOf(i.guildId, i.user.id);
  if (picked.length) {
    const bad = picked.find((id) => !owned.has(id) || !Boolean(getCard(id)));
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
  const side = (n: 0 | 1) => teams[n].map((c, k) => `${typeInfo[c.type].emoji} ${c.subject} (${result.left[n][k]}/${c.hp} HP)`).join("\n");
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

/** A live countdown: Discord counts it down on everyone's screen ("in 2 minutes" … "in 5 seconds"). */
const countdown = (id: string) => {
  const end = Math.ceil(pending.get(id)!.expires / 1000);
  return `⏳ **Answer <t:${end}:R>** (by <t:${end}:T>)`;
};

/** When nobody answers in time, the offer edits itself to say so and its buttons go away. */
function endWhenUnanswered(i: ChatInputCommandInteraction<"cached">, id: string, ended: string) {
  const offer = pending.get(id);
  if (!offer) return;
  setTimeout(() => {
    if (pending.get(id) !== offer) return; // answered or cancelled already
    pending.delete(id);
    i.editReply({ content: ended, components: [], allowedMentions: { parse: [] } }).catch(() => {});
  }, offer.expires - Date.now() + 500).unref?.();
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
  const ask = `⚔️ <@${other.id}>, <@${i.user.id}> wants to battle!${bet && eco ? ` The bet is ${formatMoney(eco.currency, bet)} each, winner takes all.` : ""}`;
  await i.reply({ content: `${ask}\n${countdown(id)}`, components: [askButtons(id, "Battle!")], allowedMentions: { users: [other.id] } });
  endWhenUnanswered(i, id, `${ask}\n⌛ **Offer ended:** <@${other.id}> didn't answer in time.`);
}

async function trade(i: ChatInputCommandInteraction<"cached">, s: CardSettings) {
  if (!s.trading) return i.reply("Trading is switched off in this server.");
  const other = i.options.getMember("member");
  if (!other || other.user.bot || other.id === i.user.id) return i.reply("Pick another member to trade with.");
  const give = getCard(i.options.getString("give", true));
  const get = getCard(i.options.getString("get", true));
  if (!give || !store.ownedCount(i.guildId, i.user.id, give.id)) return i.reply("You can only offer a card you own. Pick it from the list.");
  if (!get || !store.ownedCount(i.guildId, other.id, get.id)) return i.reply(`<@${other.id}> doesn't have that card. Pick one from the list.`);
  const id = String(nextId++);
  pending.set(id, { kind: "trade", guildId: i.guildId, from: i.user.id, to: other.id, bet: 0, give: give.id, get: get.id, expires: Date.now() + CHALLENGE_MS });
  const ask = `🔁 <@${other.id}>, <@${i.user.id}> wants to trade:\nThey give: ${line(give)}\nYou give: ${line(get)}`;
  await i.reply({ content: `${ask}\n${countdown(id)}`, components: [askButtons(id, "Trade")], allowedMentions: { users: [other.id] } });
  endWhenUnanswered(i, id, `${ask}\n⌛ **Offer ended:** <@${other.id}> didn't answer in time.`);
}

async function gift(i: ChatInputCommandInteraction<"cached">, s: CardSettings) {
  if (!s.trading) return i.reply("Trading and gifts are switched off in this server.");
  const other = i.options.getMember("member");
  if (!other || other.user.bot || other.id === i.user.id) return i.reply("Pick another member to give it to.");
  const card = getCard(i.options.getString("card", true));
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
      .filter(([id, qty]) => qty > 1 && Boolean(getCard(id)) && rarities.indexOf(getCard(id)!.rarity) <= rarities.indexOf(maxRarity as Card["rarity"]))
      .map(([id, qty]) => ({ cardId: id, quantity: qty - 1, each: s.sell[getCard(id)!.rarity] }));
    if (!sales.length) return i.reply("You don't have any duplicates to sell.");
  } else {
    const card = getCard(i.options.getString("card", true));
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
        .setName("buy")
        .setDescription("Buy card packs to open whenever you like")
        .addStringOption((o) =>
          o
            .setName("pack")
            .setDescription("Which pack")
            .setRequired(true)
            .addChoices({ name: "📦 Standard pack", value: "standard" }, { name: "💝 Premium pack", value: "premium" }),
        )
        .addIntegerOption((o) => o.setName("amount").setDescription("How many (1 if empty)").setMinValue(1).setMaxValue(25)),
    )
    .addSubcommand((c) =>
      c
        .setName("open")
        .setDescription("Open one of the packs you bought")
        .addStringOption((o) =>
          o
            .setName("pack")
            .setDescription("Which pack (Standard first if empty)")
            .addChoices({ name: "📦 Standard pack", value: "standard" }, { name: "💝 Premium pack", value: "premium" }),
        ),
    )
    .addSubcommand((c) => c.setName("packs").setDescription("See the packs and what they cost"))
    .addSubcommand((c) =>
      c
        .setName("catalog")
        .setDescription("See every card, by member, pairing and the group")
        .addStringOption((o) =>
          o
            .setName("pile")
            .setDescription("Jump straight to a member, pairing or the group")
            .addChoices(...piles.slice(0, 25).map((p) => ({ name: `${kindEmoji[p.kind]} ${p.subject}`, value: p.key }))),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("collection")
        .setDescription("See your cards (or someone else's)")
        .addUserOption((o) => o.setName("member").setDescription("Whose collection (yours if empty)"))
        .addIntegerOption((o) => o.setName("card").setDescription("Start at this card number (1 if empty)").setMinValue(1)),
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
    if (sub === "daily") return daily(interaction, s, mode);
    if (sub === "buy") return buy(interaction, s, mode);
    if (sub === "open") return open(interaction, s, mode);
    if (sub === "packs") return packs(interaction, s, mode);
    if (sub === "catalog") return catalog(interaction);
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
    if (!interaction.inCachedGuild()) return;
    if (interaction.customId.startsWith(`${PREFIX}:cat:`)) {
      // The catalog: the pile menu, or its buttons.
      const [, , viewerId, btnPile, btnIndex] = interaction.customId.split(":");
      if (interaction.user.id !== viewerId) {
        return interaction.reply({ content: "Use `/cards catalog` to browse the cards yourself.", flags: MessageFlags.Ephemeral });
      }
      const pile = interaction.isStringSelectMenu() ? interaction.values[0] : btnPile;
      const index = interaction.isStringSelectMenu() ? 0 : Number(btnIndex) || 0;
      await interaction.deferUpdate();
      return interaction.editReply({ ...(await catalogPage(interaction.guildId, viewerId, pile, index)), attachments: [] });
    }
    if (!interaction.isButton()) return;
    if (interaction.customId.startsWith(`${PREFIX}:open:`)) {
      // "Open another pack" buttons.
      const [, , ownerId, kind] = interaction.customId.split(":");
      if (interaction.user.id !== ownerId) {
        return interaction.reply({ content: "These are someone else's packs. Buy your own with `/cards buy`!", flags: MessageFlags.Ephemeral });
      }
      const s = await settingsOf(interaction.guildId);
      const mode = await modeOf(interaction.guildId, s);
      await interaction.update({ components: [] }); // the next pack comes as a new message, so earlier pulls stay visible
      const reply = await openOne(interaction.guildId, interaction.user, s, mode, kind as store.StoredPack);
      return interaction.followUp({ allowedMentions: { parse: [] }, ...reply });
    }
    if (interaction.customId.startsWith(`${PREFIX}:col:`)) {
      // Flipping through a collection.
      const [, , ownerId, viewerId, index] = interaction.customId.split(":");
      if (interaction.user.id !== viewerId) {
        return interaction.reply({ content: "Use `/cards collection` to browse cards yourself.", flags: MessageFlags.Ephemeral });
      }
      const user = await client.users.fetch(ownerId).catch(() => null);
      const member = interaction.guild.members.cache.get(ownerId);
      const owner = { id: ownerId, name: member?.displayName ?? user?.displayName ?? "Someone", avatar: (member ?? user)?.displayAvatarURL({ size: 64 }) ?? "" };
      const page = await collectionPage(interaction.guildId, owner, viewerId, Number(index) || 0);
      if (!page) return interaction.update({ content: "This collection is empty now.", embeds: [], files: [], attachments: [], components: [] });
      return interaction.update({ ...page, attachments: [] });
    }
    const [, answer, id] = interaction.customId.split(":");
    const p = pending.get(id);
    if (!p || p.expires < Date.now()) {
      pending.delete(id);
      const was = interaction.message.content.replace(/\n⏳.*$/s, "");
      return interaction.update({ content: `${was}\n⌛ **Offer ended:** nobody answered in time.`.slice(0, 2000), components: [], allowedMentions: { parse: [] } });
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
        content: `🔁 Trade done! <@${p.from}> got ${line(getCard(p.get!)!)} and <@${p.to}> got ${line(getCard(p.give!)!)}.`,
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
  const ready = activeCount();
  const problems: string[] = [];
  if (!ready) problems.push("No cards have been added yet, so packs are empty. They appear as soon as cards are added.");
  if (s.mode === "economy" && economyOff) problems.push("Economy is switched off, so the game runs as Cards only (free daily packs, no buying or selling) until you switch it on.");
  return {
    settings: s,
    mode: await modeOf(guild.id, s),
    economyOff,
    ready,
    currency: { singular: eco.currency.singular, plural: eco.currency.plural, emoji: eco.currency.emoji },
    stats: { ...stats, catalog: cardCount() },
    top: rows.map((r) => ({ ...r, name: members?.get(r.userId)?.displayName ?? "Someone" })),
    problems,
  };
}

/* ------------------------------------------------------------ Developer page: managing cards */

function adminResponse(): CardAdminResponse {
  const cardsNow = allCards();
  return {
    piles: piles.map((p) => {
      const mine = cardsNow.filter((c) => c.pile === p.key);
      const newest = mine.reduce<Card | null>((a, c) => (!a || c.number > a.number ? c : a), null);
      return { ...p, count: mine.length, active: mine.filter((c) => c.active).length, cover: newest ? { id: newest.id, updatedAt: newest.updatedAt } : null };
    }),
    total: cardsNow.length,
    active: cardsNow.filter((c) => c.active).length,
  };
}

function pileResponse(pile: string): PileCardsResponse {
  const owners = ownersByCard();
  return { cards: pileCards(pile).reverse().map((c) => ({ ...c, owned: owners.get(c.id) ?? 0 })) };
}

type DevReq = FastifyRequest<{ Params: { pile?: string; id?: string }; Querystring: { name?: string; rarity?: string; credit?: string } }>;

/** The Developer page's card routes: piles, adding cards from photos, editing and deleting. Developer only. */
export function registerCardsDeveloperApi(api: FastifyInstance) {
  void loadCatalog();
  api.register(async (dev) => {
    dev.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await isDeveloper(request.session!.userId))) return reply.code(403).send({ error: "Only the bot's developer can use this." });
    });
    // Photos are uploaded as the raw file, one per request.
    dev.addContentTypeParser(["image/jpeg", "image/png", "image/webp", "image/gif"], { parseAs: "buffer", bodyLimit: CARD_PHOTO.maxBytes }, (_req, body, done) =>
      done(null, body),
    );
    const isImage = (body: unknown): body is Buffer => Buffer.isBuffer(body) && body.length > 0;

    /* Giving packs to a member by hand. */
    dev.get("/api/developer/cards/servers", async (): Promise<GiveServer[]> =>
      [...client.guilds.cache.values()]
        .map((g) => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 64 }), members: g.memberCount }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );

    dev.get("/api/developer/cards/servers/:guildId/members", async (request: FastifyRequest<{ Params: { guildId: string }; Querystring: { q?: string } }>, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId);
      if (!guild) return reply.code(404).send({ error: "Number One isn't in that server anymore." });
      const q = (request.query.q ?? "").trim().replace(/^<@!?(\d+)>$/, "$1");
      if (!q) return [];
      const found = /^\d{15,20}$/.test(q)
        ? [await guild.members.fetch(q).catch(() => null)].filter((m) => m !== null)
        : [...(await guild.members.search({ query: q.slice(0, 32), limit: 10 }).catch(() => new Map())).values()];
      return found
        .filter((m) => !m.user.bot)
        .map((m): GiveMember => ({ id: m.id, name: m.displayName, username: m.user.username, avatar: m.displayAvatarURL({ size: 64 }) }));
    });

    dev.post("/api/developer/cards/give", async (request, reply) => {
      const parsed = givePacksInput.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Pick a server, a member, a pack and how many (1–100)." });
      const { guildId, userId, kind, amount, dm } = parsed.data;
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return reply.code(404).send({ error: "Number One isn't in that server anymore." });
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || member.user.bot) return reply.code(404).send({ error: "That member isn't in the server." });
      const bag = store.givePacks(guildId, userId, kind, amount);
      let dmSent = false;
      if (dm) {
        const what = `${amount} ${packInfo[kind].name.toLowerCase()}${amount === 1 ? "" : "s"}`;
        dmSent = await member
          .send(`🎁 You got **${what}** ${packInfo[kind].emoji} for BLACKPINK Poker in **${guild.name}**! Open them one at a time with \`/cards open\` there.`)
          .then(() => true)
          .catch(() => false);
      }
      return { bag, dmSent };
    });

    dev.get("/api/developer/cards", async () => {
      await loadCatalog();
      return adminResponse();
    });

    dev.get("/api/developer/cards/pile/:pile", async (request: DevReq, reply) => {
      if (!pileByKey.has(request.params.pile!)) return reply.code(404).send({ error: "No such pile." });
      return pileResponse(request.params.pile!);
    });

    /** Adds a card to a pile. The photo is the body; name, rarity and credit are in the address. */
    dev.post("/api/developer/cards/pile/:pile", async (request: DevReq, reply) => {
      const pile = request.params.pile!;
      if (!pileByKey.has(pile)) return reply.code(400).send({ error: "That isn't a pile I know." });
      if (!isImage(request.body)) return reply.code(400).send({ error: "Send a JPG, PNG, WebP or GIF picture." });
      const rarity = (rarities as readonly string[]).includes(request.query.rarity ?? "") ? (request.query.rarity as Rarity) : "common";
      try {
        await addCard(pile, request.body, { name: request.query.name ?? "", rarity, credit: request.query.credit ?? "", by: request.session!.userId });
      } catch {
        return reply.code(400).send({ error: "That file couldn't be read as a picture." });
      }
      return { ...adminResponse(), ...pileResponse(pile) };
    });

    dev.patch("/api/developer/cards/card/:id", async (request: DevReq, reply) => {
      const parsed = cardEdit.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the card and try again." });
      const card = await editCard(request.params.id!, parsed.data);
      if (!card) return reply.code(404).send({ error: "That card isn't there anymore. Reload the page." });
      return { ...adminResponse(), ...pileResponse(card.pile) };
    });

    /** Swaps a card's photo (the body), keeping its name, rarity and owners. */
    dev.put("/api/developer/cards/card/:id/photo", async (request: DevReq, reply) => {
      if (!isImage(request.body)) return reply.code(400).send({ error: "Send a JPG, PNG, WebP or GIF picture." });
      try {
        const card = await replacePhoto(request.params.id!, request.body);
        if (!card) return reply.code(404).send({ error: "That card isn't there anymore. Reload the page." });
        return { ...adminResponse(), ...pileResponse(card.pile) };
      } catch {
        return reply.code(400).send({ error: "That file couldn't be read as a picture." });
      }
    });

    dev.delete("/api/developer/cards/card/:id", async (request: DevReq) => {
      const card = getCard(request.params.id!);
      if (card) await deleteCard(card.id);
      return { ...adminResponse(), ...(card ? pileResponse(card.pile) : { cards: [] }) };
    });

    dev.get("/api/developer/cards/card/:id/photo", async (request: DevReq, reply) => {
      if (!getCard(request.params.id!)) return reply.code(404).send({ error: "No such card." });
      try {
        return reply.type("image/jpeg").header("cache-control", "private, max-age=300").send(photoFile(request.params.id!));
      } catch {
        return reply.code(404).send({ error: "No photo." });
      }
    });

    /** The finished card as a picture, to preview. */
    dev.get("/api/developer/cards/card/:id/preview", async (request: DevReq, reply) => {
      const card = getCard(request.params.id!);
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
    void loadCatalog();
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

