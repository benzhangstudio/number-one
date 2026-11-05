import { type Card, type CardSettings, type PackKind, type Rarity, cardScore, packInfo, packOdds, rarities, typeBonus, typeInfo } from "../../shared/cards.js";
import { activeCards, getCard } from "./catalog.js";

/** Pack opening and battles. No Discord here, so it's easy to follow and test. */

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function rollRarity(odds: Record<Rarity, number>): Rarity {
  let roll = Math.random() * 100;
  for (const r of [...rarities].reverse()) {
    roll -= odds[r];
    if (roll < 0) return r;
  }
  return "common";
}

/**
 * Opens a pack, gacha-style: each card's rarity is rolled with the pack's odds, then a random active card of that
 * rarity is picked (from any pile). Returns null when no cards have been added yet.
 */
export function openPack(_s: CardSettings, kind: PackKind): Card[] | null {
  const pool = activeCards();
  if (!pool.length) return null;
  const byRarity = new Map<Rarity, Card[]>(rarities.map((r) => [r, pool.filter((c) => c.rarity === r)]));
  const draw = (r: Rarity) => {
    // Not every rarity has cards yet: fall back to the next rarity down, then up.
    const order = [...rarities.slice(0, rarities.indexOf(r) + 1).reverse(), ...rarities.slice(rarities.indexOf(r) + 1)];
    for (const x of order) if (byRarity.get(x)!.length) return pick(byRarity.get(x)!);
    return pick(pool);
  };
  const result = Array.from({ length: packInfo[kind].size }, () => draw(rollRarity(packOdds[kind])));
  // Premium packs always have at least one Epic or better.
  if (kind === "premium" && !result.some((c) => rarities.indexOf(c.rarity) >= 2)) result[result.length - 1] = draw(rollRarity({ common: 0, rare: 0, epic: 80, legendary: 17, mythic: 3 }));
  // Best cards last, so the reveal ends on a high note.
  return result.sort((a, b) => rarities.indexOf(a.rarity) - rarities.indexOf(b.rarity));
}

/* ------------------------------------------------------------ battles */

/** A member's team: the 3 cards they picked (that they still own), topped up with their strongest. */
export function teamOf(saved: string[], owned: Map<string, number>) {
  const chosen = saved.filter((id) => owned.has(id) && getCard(id)).slice(0, 3);
  const rest = [...owned.keys()]
    .filter((id) => !chosen.includes(id) && getCard(id))
    .map((id) => getCard(id)!)
    .sort((a, b) => cardScore(b) - cardScore(a));
  return [...chosen.map((id) => getCard(id)!), ...rest].slice(0, 3);
}

/** Number One's team: random ready cards about as strong as the player's. */
export function rivalTeam(_s: CardSettings, player: Card[]) {
  const pool = activeCards();
  const target = player.reduce((a, c) => a + cardScore(c), 0) / Math.max(1, player.length);
  const near = pool.filter((c) => Math.abs(cardScore(c) - target) <= 25);
  const from = near.length >= 3 ? near : pool;
  const team: Card[] = [];
  while (team.length < Math.min(3, player.length) && from.length) {
    const c = pick(from);
    if (!team.includes(c) || from.length < 3) team.push(c);
  }
  return team;
}

export interface BattleResult {
  /** 0 = the first side won, 1 = the second. */
  winner: 0 | 1;
  /** Short lines describing the battle, for the message. */
  log: string[];
  /** HP left on each side's cards at the end. */
  left: [number[], number[]];
}

/**
 * Runs a battle between two teams. Each turn, the active card uses its move: power × type bonus × a little luck.
 * When a card's HP hits 0 the next one steps in. The side with cards left wins.
 */
export function battle(teams: [Card[], Card[]], names: [string, string]): BattleResult {
  const hp = teams.map((t) => t.map((c) => c.hp)) as [number[], number[]];
  const active = [0, 0];
  const log: string[] = [];
  // Whoever's first card hits harder goes first; a tie is a coin flip.
  let turn: 0 | 1 = teams[0][0].power === teams[1][0].power ? (Math.random() < 0.5 ? 0 : 1) : teams[0][0].power > teams[1][0].power ? 0 : 1;

  for (let round = 0; round < 80 && active[0] < teams[0].length && active[1] < teams[1].length; round++) {
    const other = (1 - turn) as 0 | 1;
    const a = teams[turn][active[turn]];
    const d = teams[other][active[other]];
    const bonus = typeBonus(a.type, d.type);
    const damage = Math.max(1, Math.round(a.power * bonus * (0.85 + Math.random() * 0.3)));
    hp[other][active[other]] = Math.max(0, hp[other][active[other]] - damage);
    const note = bonus > 1 ? " It's super effective!" : bonus < 1 ? " It's not very effective…" : "";
    log.push(`${typeInfo[a.type].emoji} **${a.subject}** used ${typeInfo[a.type].move} for **${damage}**.${note}`);
    if (hp[other][active[other]] === 0) {
      log.push(`💫 ${names[other]}'s **${d.subject}** is out!`);
      active[other]++;
      if (active[other] < teams[other].length) log.push(`➡️ ${names[other]} sends out **${teams[other][active[other]].subject}**.`);
    }
    turn = other;
  }
  const winner: 0 | 1 = active[1] >= teams[1].length ? 0 : active[0] >= teams[0].length ? 1 : hp[0].reduce((a, b) => a + b, 0) >= hp[1].reduce((a, b) => a + b, 0) ? 0 : 1;
  return { winner, log, left: hp };
}

/** Keeps the battle message short: the start, the knock-outs and the end. */
export function shortLog(log: string[], max = 14) {
  if (log.length <= max) return log;
  const important = log.map((l, i) => ({ l, i })).filter(({ l, i }) => i < 2 || i >= log.length - 3 || l.startsWith("💫") || l.startsWith("➡️"));
  const lines: string[] = [];
  let last = -1;
  for (const { l, i } of important) {
    if (i > last + 1) lines.push("⋯");
    lines.push(l);
    last = i;
  }
  return lines.slice(-max - 4);
}
