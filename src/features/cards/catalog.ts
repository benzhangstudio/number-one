import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Image, createCanvas, loadImage } from "@napi-rs/canvas";
import { eq } from "drizzle-orm";
import { config } from "../../server/config.js";
import { db, sqlite } from "../../server/db/client.js";
import { cardDefs } from "../../server/db/schema.js";
import { CARD_PHOTO, type Card, type CardEdit, type CardType, type Rarity, pileByKey, statsFor, typeFor } from "../../shared/cards.js";

/**
 * The card catalog: every card the bot's developer added on the Developer page, kept in memory and saved in
 * card_defs. Each card is one photo in a pile (a member, ship or the group), with its own name, rarity and type.
 * Photos are cropped to fill the card's photo area and saved as data/card-photos/<card id>.jpg.
 */

type Row = typeof cardDefs.$inferSelect;

const dir = join(config.dataDir, "card-photos");
const byId = new Map<string, Card>();
const images = new Map<string, Image>();
const MAX_IMAGES = 300;
const log = (...args: unknown[]) => console.warn("[cards]", ...args);

const fileOf = (id: string) => join(dir, `${id}.jpg`);

function toCard(r: Row): Card | null {
  const pile = pileByKey.get(r.pile);
  if (!pile) return null; // a pile that was removed from the catalog
  return {
    id: r.id,
    number: r.number,
    pile: r.pile,
    groupId: pile.groupId,
    groupName: pile.groupName,
    subject: pile.subject,
    kind: pile.kind,
    about: pile.about,
    name: r.name,
    rarity: r.rarity as Rarity,
    type: r.type as CardType,
    hp: r.hp,
    power: r.power,
    color: pile.color,
    credit: r.credit,
    active: r.active,
    updatedAt: r.updatedAt.getTime(),
  };
}

/* ------------------------------------------------------------ reading */

export const getCard = (id: string) => byId.get(id);
export const allCards = () => [...byId.values()].sort((a, b) => a.number - b.number);
export const activeCards = () => allCards().filter((c) => c.active);
export const cardCount = () => byId.size;
export const activeCount = () => activeCards().length;
export const pileCards = (pile: string) => allCards().filter((c) => c.pile === pile);

/** How many members (in every server) own each card. */
export function ownersByCard() {
  const rows = sqlite.prepare("SELECT card_id, COUNT(*) AS n FROM card_inventory GROUP BY card_id").all() as { card_id: string; n: number }[];
  return new Map(rows.map((r) => [r.card_id, Number(r.n)]));
}

/** The card's photo as an image to draw (a few hundred are kept in memory). */
export async function photoImage(id: string) {
  const cached = images.get(id);
  if (cached) return cached;
  try {
    const img = await loadImage(readFileSync(fileOf(id)));
    if (images.size >= MAX_IMAGES) images.delete(images.keys().next().value!);
    images.set(id, img);
    return img;
  } catch {
    return null; // file missing: the card shows "photo unavailable"
  }
}

export const photoFile = (id: string) => readFileSync(fileOf(id));

/* ------------------------------------------------------------ changing */

/** Crops a photo to fill the card's photo area (keeping the middle, a little above centre for faces). */
async function cropped(upload: Buffer) {
  const img = await loadImage(upload);
  const { width: W, height: H } = CARD_PHOTO;
  const scale = Math.max(W / img.width, H / img.height);
  const sw = W / scale;
  const sh = H / scale;
  const sx = (img.width - sw) / 2;
  // Portraits usually have faces in the top third, so crop closer to the top.
  const sy = Math.max(0, Math.min(img.height - sh, (img.height - sh) * 0.3));
  const canvas = createCanvas(W, H);
  canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  return canvas.encode("jpeg", 88);
}

const nextNumber = () => (sqlite.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS n FROM card_defs").get() as { n: number }).n;
const newId = (pile: string) => `${pile}.${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;

/** Adds a card to a pile from an uploaded photo. Its type and stats are picked for it (and can be changed). */
export async function addCard(pile: string, upload: Buffer, opts: { name: string; rarity: Rarity; credit: string; by: string }) {
  const p = pileByKey.get(pile);
  if (!p) throw new Error("No such pile");
  const jpeg = await cropped(upload);
  const id = newId(pile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileOf(id), jpeg);
  const now = new Date();
  const number = nextNumber();
  const name = opts.name.trim().slice(0, CARD_PHOTO.name) || `${p.subject} #${pileCards(pile).length + 1}`;
  const row: Row = {
    id,
    number,
    pile,
    name,
    rarity: opts.rarity,
    type: typeFor(id),
    ...statsFor(id, opts.rarity, p.kind),
    credit: opts.credit.trim().slice(0, CARD_PHOTO.credit),
    active: true,
    createdAt: now,
    updatedAt: now,
    createdBy: opts.by,
  };
  await db.insert(cardDefs).values(row).run();
  byId.set(id, toCard(row)!);
  return byId.get(id)!;
}

/** Changes a card's name, rarity, type, credit or whether it's in packs. A new rarity gives it new stats. */
export async function editCard(id: string, edit: CardEdit) {
  const card = byId.get(id);
  if (!card) return null;
  const stats = edit.rarity !== card.rarity ? statsFor(id, edit.rarity, card.kind) : { hp: card.hp, power: card.power };
  const set = { name: edit.name, rarity: edit.rarity, type: edit.type, credit: edit.credit, active: edit.active, ...stats, updatedAt: new Date() };
  await db.update(cardDefs).set(set).where(eq(cardDefs.id, id)).run();
  const row = await db.select().from(cardDefs).where(eq(cardDefs.id, id)).get();
  byId.set(id, toCard(row!)!);
  return byId.get(id)!;
}

/** Swaps a card's photo, keeping everything else. */
export async function replacePhoto(id: string, upload: Buffer) {
  if (!byId.has(id)) return null;
  writeFileSync(fileOf(id), await cropped(upload));
  images.delete(id);
  await db.update(cardDefs).set({ updatedAt: new Date() }).where(eq(cardDefs.id, id)).run();
  byId.set(id, { ...byId.get(id)!, updatedAt: Date.now() });
  return byId.get(id)!;
}

/** Deletes a card: its photo, and every copy members own (in every server). */
export async function deleteCard(id: string) {
  sqlite.prepare("DELETE FROM card_inventory WHERE card_id = ?").run(id);
  await db.delete(cardDefs).where(eq(cardDefs.id, id)).run();
  rmSync(fileOf(id), { force: true });
  byId.delete(id);
  images.delete(id);
}

/* ------------------------------------------------------------ start-up */

/** Old fixed card versions, for turning photos from before into cards. */
const oldVersions: Record<string, { name: string; rarity: Rarity }> = {
  debut: { name: "Debut Day", rarity: "common" },
  practice: { name: "Practice Room", rarity: "common" },
  comeback: { name: "Comeback", rarity: "rare" },
  stage: { name: "Live Stage", rarity: "rare" },
  award: { name: "Award Night", rarity: "epic" },
  legend: { name: "Legend", rarity: "legendary" },
  crown: { name: "Pink Crown", rarity: "mythic" },
};

/**
 * Before cards had their own rows, each pile had seven fixed cards and photos were saved per pile (used on all
 * seven) or per card. This turns each of those photos into one card, once:
 * - a photo for one version becomes a card with that version's name and rarity, keeping its ID, so copies
 *   members already pulled stay theirs;
 * - a photo for a whole pile becomes a Common card named after the pile, and copies of that pile's other
 *   versions (which all showed that photo) are moved onto it.
 * Copies of cards that never had a photo can't exist, so nothing else changes.
 */
function migrateOldPhotos() {
  const old = sqlite.prepare("SELECT key, credit, updated_at, updated_by FROM card_photos").all() as { key: string; credit: string; updated_at: number; updated_by: string }[];
  if (!old.length) return;
  const insert = sqlite.prepare(
    "INSERT OR IGNORE INTO card_defs (id, number, pile, name, rarity, type, hp, power, credit, active, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
  );
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    let number = nextNumber();
    // Version photos first: their IDs are kept as they are.
    for (const o of [...old].sort((a, b) => b.key.split(".").length - a.key.split(".").length)) {
      const parts = o.key.split(".");
      const pile = parts.slice(0, 2).join(".");
      const p = pileByKey.get(pile);
      if (!p) continue;
      const version = parts[2] ? oldVersions[parts[2]] : null;
      const id = version ? o.key : `${pile}.photo`;
      const name = version?.name ?? p.subject;
      const rarity: Rarity = version?.rarity ?? "common";
      const stats = statsFor(id, rarity, p.kind);
      insert.run(id, number++, pile, name, rarity, typeFor(id), stats.hp, stats.power, o.credit, o.updated_at, o.updated_at, o.updated_by);
      if (id !== o.key && existsSync(fileOf(o.key))) renameSync(fileOf(o.key), fileOf(id));
      if (!version) {
        // Copies of this pile's versions that had no photo of their own showed this one: move them onto it.
        const own = new Set(old.filter((x) => x.key.startsWith(`${pile}.`) && x.key.split(".").length === 3).map((x) => x.key));
        for (const v of Object.keys(oldVersions)) {
          const from = `${pile}.${v}`;
          if (own.has(from)) continue;
          sqlite
            .prepare(
              `INSERT INTO card_inventory (guild_id, user_id, card_id, quantity, first_at)
               SELECT guild_id, user_id, ?, quantity, first_at FROM card_inventory WHERE card_id = ?
               ON CONFLICT (guild_id, user_id, card_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
            )
            .run(id, from);
          sqlite.prepare("DELETE FROM card_inventory WHERE card_id = ?").run(from);
        }
      }
    }
    sqlite.exec("DELETE FROM card_photos");
    sqlite.exec("COMMIT");
    console.log(`[cards] turned ${old.length} older photo(s) into cards`);
  } catch (err) {
    sqlite.exec("ROLLBACK");
    log("couldn't turn older photos into cards:", err);
  }
}

let loading: Promise<void> | null = null;

/** Reads every card once at start-up (calling it again does nothing). */
export function loadCatalog() {
  loading ??= (async () => {
    mkdirSync(dir, { recursive: true });
    migrateOldPhotos();
    for (const row of await db.select().from(cardDefs).all()) {
      const card = toCard(row);
      if (card) byId.set(card.id, card);
    }
  })();
  return loading;
}

