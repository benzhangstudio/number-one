import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type MessageComponentInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { ComponentHandler, SlashCommand } from "../../server/bot/types.js";
import { getFeatureState } from "../../server/settings.js";
import { type EconomySettings, MAX_CHANGE, formatMoney, slotSymbols } from "../../shared/economy.js";
import { economyFeature } from "../../shared/features.js";
import * as store from "./store.js";

/**
 * Betting games: /coinflip (double or nothing), /slots (three reels) and /blackjack (Hit, Stand and Double
 * buttons against Number One). The bet is taken first and winnings are paid back, both as "Games" in the history.
 * Games are fair or close to it: coinflip pays back 100% on average, slots about 96%, blackjack about 99%.
 */

const PINK = 0xff4fa3;
const GREEN = 0x3ba55d;
const RED = 0xed4245;
const GREY = 0x8c8c99;
const PREFIX = "bj";
/** A blackjack game with no answer for this long finishes as if they'd pressed Stand. */
const BLACKJACK_TIMEOUT = 2 * 60_000;

type Game = "coinflip" | "slots" | "blackjack";
const gameNames: Record<Game, string> = { coinflip: "/coinflip", slots: "/slots", blackjack: "/blackjack" };

const settingsOf = async (guildId: string) => (await getFeatureState(guildId, economyFeature)).settings as EconomySettings;
const n = (x: number) => x.toLocaleString("en-US");

/** Last game per member ("guildId:userId" → ms). A restart just resets cooldowns. */
const lastGame = new Map<string, number>();

/**
 * Checks the game is on, the bet is allowed and the cooldown is over, then takes the bet.
 * Replies and returns null when the game can't start.
 */
async function startGame(interaction: ChatInputCommandInteraction<"cached">, game: Game, bet: number) {
  const s = await settingsOf(interaction.guildId);
  const g = s.games;
  if (!g.enabled || !g[game]) return void (await interaction.reply(`${gameNames[game]} is switched off in this server.`)), null;
  const min = Math.max(1, g.minBet);
  const max = Math.max(min, g.maxBet);
  if (bet < min || bet > max) {
    return void (await interaction.reply({ content: `Bets in this server go from ${formatMoney(s.currency, min)} to ${formatMoney(s.currency, max)}.`, allowedMentions: { parse: [] } })), null;
  }
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const wait = (lastGame.get(key) ?? 0) + g.cooldownSeconds * 1000 - Date.now();
  if (wait > 0) return void (await interaction.reply(`Slow down a little! You can play again <t:${Math.ceil((Date.now() + wait) / 1000)}:R>.`)), null;
  if (game === "blackjack" && [...tables.values()].some((t) => t.key === key)) {
    return void (await interaction.reply("Finish your blackjack game first.")), null;
  }
  const r = store.placeBet(interaction.guildId, interaction.user.id, bet, s.startingBalance);
  if (!r.ok) {
    return void (await interaction.reply({ content: `You don't have enough to bet that. You have ${formatMoney(s.currency, r.balance)}.`, allowedMentions: { parse: [] } })), null;
  }
  lastGame.set(key, Date.now());
  return { s, balance: r.balance };
}

/** Pays winnings (if any) and returns the new balance. */
function payOut(guildId: string, userId: string, amount: number, s: EconomySettings, balanceAfterBet: number) {
  if (amount <= 0) return balanceAfterBet;
  return store.credit(guildId, userId, amount, "game", { startingBalance: s.startingBalance }).balance;
}

const betOption = (o: import("discord.js").SlashCommandIntegerOption) =>
  o.setName("bet").setDescription("How much to bet").setRequired(true).setMinValue(1).setMaxValue(MAX_CHANGE);

/* ------------------------------------------------------------ coinflip */

export const coinflipCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Bet on heads or tails. Guess right and you win your bet again.")
    .setContexts(0)
    .addIntegerOption(betOption)
    .addStringOption((o) =>
      o
        .setName("side")
        .setDescription("Heads or tails")
        .setRequired(true)
        .addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" }),
    ),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const bet = interaction.options.getInteger("bet", true);
    const started = await startGame(interaction, "coinflip", bet);
    if (!started) return;
    const { s } = started;
    const pick = interaction.options.getString("side", true);
    const landed = Math.random() < 0.5 ? "heads" : "tails";
    const won = pick === landed;
    const balance = payOut(interaction.guildId, interaction.user.id, won ? bet * 2 : 0, s, started.balance);
    const embed = new EmbedBuilder()
      .setColor(won ? GREEN : RED)
      .setTitle(`🪙 It's ${landed}!`)
      .setDescription(won ? `<@${interaction.user.id}> won ${formatMoney(s.currency, bet)}!` : `<@${interaction.user.id}> lost ${formatMoney(s.currency, bet)}.`)
      .setFooter({ text: `You picked ${pick} · Balance: ${n(balance)}` });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

/* ------------------------------------------------------------ slots */

const totalWeight = slotSymbols.reduce((a, b) => a + b.weight, 0);
function spin() {
  let roll = Math.random() * totalWeight;
  for (const sym of slotSymbols) {
    roll -= sym.weight;
    if (roll < 0) return sym;
  }
  return slotSymbols[0];
}

export const slotsCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Spin the slot machine. Three in a row wins big; two give your bet back.")
    .setContexts(0)
    .addIntegerOption(betOption),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const bet = interaction.options.getInteger("bet", true);
    const started = await startGame(interaction, "slots", bet);
    if (!started) return;
    const { s } = started;
    const reels = [spin(), spin(), spin()];
    const [a, b, c] = reels.map((r) => r.emoji);
    const three = a === b && b === c;
    const two = !three && (a === b || b === c || a === c);
    const win = three ? bet * reels[0].pays : two ? bet : 0;
    const balance = payOut(interaction.guildId, interaction.user.id, win, s, started.balance);
    const result = three
      ? `**Three ${a}!** <@${interaction.user.id}> won ${formatMoney(s.currency, win - bet)} (×${reels[0].pays}).`
      : two
        ? `Two in a row: <@${interaction.user.id}> gets their bet back.`
        : `No luck. <@${interaction.user.id}> lost ${formatMoney(s.currency, bet)}.`;
    const embed = new EmbedBuilder()
      .setColor(three ? GREEN : two ? GREY : RED)
      .setTitle("🎰 Slots")
      .setDescription(`# ${a} ${b} ${c}\n${result}`)
      .setFooter({ text: `Bet: ${n(bet)} · Balance: ${n(balance)} · Three 🍒 pays ×5, three 7️⃣ pays ×100` });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

/* ------------------------------------------------------------ blackjack */

interface Card {
  rank: string;
  suit: string;
}
interface Table {
  id: string;
  key: string;
  guildId: string;
  userId: string;
  bet: number;
  s: EconomySettings;
  balance: number;
  deck: Card[];
  player: Card[];
  dealer: Card[];
  doubled: boolean;
  timer: NodeJS.Timeout;
  /** Edits the game message (works for 15 minutes after the command). */
  edit: (payload: Parameters<ChatInputCommandInteraction["editReply"]>[0]) => Promise<unknown>;
}

const tables = new Map<string, Table>();
let nextTable = 1;

function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of ["♠", "♥", "♦", "♣"]) for (const rank of ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handValue(hand: Card[]) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.rank === "A") {
      aces++;
      total += 11;
    } else total += ["J", "Q", "K"].includes(c.rank) ? 10 : Number(c.rank);
  }
  while (total > 21 && aces--) total -= 10;
  return total;
}

const isBlackjack = (hand: Card[]) => hand.length === 2 && handValue(hand) === 21;
const show = (hand: Card[]) => hand.map((c) => `\`${c.rank}${c.suit}\``).join(" ");

type Outcome = { text: string; payout: number; color: number } | null;

function render(t: Table, outcome: Outcome) {
  const dealerHand = outcome ? `${show(t.dealer)} · **${handValue(t.dealer)}**` : `${show(t.dealer.slice(0, 1))} \`??\``;
  const bet = t.doubled ? t.bet * 2 : t.bet;
  const embed = new EmbedBuilder()
    .setColor(outcome?.color ?? PINK)
    .setTitle("🃏 Blackjack")
    .addFields(
      { name: "Your hand", value: `${show(t.player)} · **${handValue(t.player)}**`, inline: true },
      { name: "Number One's hand", value: dealerHand, inline: true },
    )
    .setDescription(outcome ? outcome.text : `<@${t.userId}>, get closer to 21 than Number One without going over.`)
    .setFooter({ text: `Bet: ${n(bet)}${t.doubled ? " (doubled)" : ""} · Balance: ${n(t.balance)}${outcome ? "" : " · Blackjack pays 3 to 2"}` });
  const canDouble = t.player.length === 2 && !t.doubled && t.balance >= t.bet;
  const components = outcome
    ? []
    : [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:hit:${t.id}`).setLabel("Hit").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`${PREFIX}:stand:${t.id}`).setLabel("Stand").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`${PREFIX}:double:${t.id}`).setLabel("Double").setStyle(ButtonStyle.Success).setDisabled(!canDouble),
        ),
      ];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** Number One draws to 17, then the hands are compared and winnings paid. */
function finish(t: Table, timedOut = false): Outcome {
  clearTimeout(t.timer);
  tables.delete(t.id);
  const bet = t.doubled ? t.bet * 2 : t.bet;
  const money = (v: number) => formatMoney(t.s.currency, v);
  const player = handValue(t.player);
  let outcome: { text: string; payout: number; color: number };
  if (player > 21) {
    outcome = { text: `Bust! <@${t.userId}> lost ${money(bet)}.`, payout: 0, color: RED };
  } else if (isBlackjack(t.player) && !isBlackjack(t.dealer)) {
    const win = Math.floor(bet * 1.5);
    outcome = { text: `**Blackjack!** <@${t.userId}> won ${money(win)}.`, payout: bet + win, color: GREEN };
  } else {
    while (handValue(t.dealer) < 17) t.dealer.push(t.deck.pop()!);
    const dealer = handValue(t.dealer);
    if (isBlackjack(t.dealer) && !isBlackjack(t.player)) outcome = { text: `Number One has blackjack. <@${t.userId}> lost ${money(bet)}.`, payout: 0, color: RED };
    else if (dealer > 21) outcome = { text: `Number One went bust! <@${t.userId}> won ${money(bet)}.`, payout: bet * 2, color: GREEN };
    else if (player > dealer) outcome = { text: `<@${t.userId}> won ${money(bet)}!`, payout: bet * 2, color: GREEN };
    else if (player < dealer) outcome = { text: `Number One wins. <@${t.userId}> lost ${money(bet)}.`, payout: 0, color: RED };
    else outcome = { text: `It's a tie. <@${t.userId}> gets their bet back.`, payout: bet, color: GREY };
  }
  if (timedOut) outcome.text = `No move for 2 minutes, so it stood.\n${outcome.text}`;
  t.balance = payOut(t.guildId, t.userId, outcome.payout, t.s, t.balance);
  return outcome;
}

function armTimer(t: Table) {
  clearTimeout(t.timer);
  t.timer = setTimeout(() => {
    if (!tables.has(t.id)) return;
    const outcome = finish(t, true);
    void t.edit(render(t, outcome)).catch(() => {});
  }, BLACKJACK_TIMEOUT);
}

export const blackjackCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Play blackjack against Number One. Get closer to 21 without going over.")
    .setContexts(0)
    .addIntegerOption(betOption),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const bet = interaction.options.getInteger("bet", true);
    const started = await startGame(interaction, "blackjack", bet);
    if (!started) return;
    const deck = newDeck();
    const t: Table = {
      id: String(nextTable++),
      key: `${interaction.guildId}:${interaction.user.id}`,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      bet,
      s: started.s,
      balance: started.balance,
      deck,
      player: [deck.pop()!, deck.pop()!],
      dealer: [deck.pop()!, deck.pop()!],
      doubled: false,
      timer: setTimeout(() => {}, 0),
      edit: (payload) => interaction.editReply(payload),
    };
    tables.set(t.id, t);
    // A natural 21 (for either side) ends the game straight away.
    if (isBlackjack(t.player) || isBlackjack(t.dealer)) return interaction.reply(render(t, finish(t)));
    armTimer(t);
    return interaction.reply(render(t, null));
  },
};

export const blackjackButtons: ComponentHandler = {
  prefix: PREFIX,
  async handle(interaction: MessageComponentInteraction) {
    if (!interaction.inCachedGuild() || !interaction.isButton()) return;
    const [, move, id] = interaction.customId.split(":");
    const t = tables.get(id);
    if (!t) return interaction.reply({ content: "This game is over. Start a new one with `/blackjack`.", flags: MessageFlags.Ephemeral });
    if (t.userId !== interaction.user.id) return interaction.reply({ content: "This isn't your game. Start your own with `/blackjack`.", flags: MessageFlags.Ephemeral });

    if (move === "double") {
      if (t.player.length !== 2 || t.doubled) return interaction.deferUpdate();
      const r = store.placeBet(t.guildId, t.userId, t.bet, t.s.startingBalance);
      if (!r.ok) return interaction.reply({ content: "You don't have enough to double.", flags: MessageFlags.Ephemeral });
      t.balance = r.balance;
      t.doubled = true;
      t.player.push(t.deck.pop()!);
      return interaction.update(render(t, finish(t)));
    }
    if (move === "hit") {
      t.player.push(t.deck.pop()!);
      if (handValue(t.player) >= 21) return interaction.update(render(t, finish(t)));
      armTimer(t);
      return interaction.update(render(t, null));
    }
    if (move === "stand") return interaction.update(render(t, finish(t)));
  },
};

/** Forgets old cooldowns (called hourly). */
export function pruneGameCooldowns() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, at] of lastGame) if (at < cutoff) lastGame.delete(key);
}
