import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Image, createCanvas, loadImage } from "@napi-rs/canvas";
import { eq } from "drizzle-orm";
import { config } from "../../server/config.js";
import { db } from "../../server/db/client.js";
import { cardPhotos } from "../../server/db/schema.js";
import { CARD_PHOTO, type Card, type CardPhotoInfo, cardById, cards, memberKey } from "../../shared/cards.js";
import { groupById } from "../../shared/cardCatalog.js";

/**
 * Card photos: real photos the bot's developer uploads on the Developer page, the same for every server.
 * A photo can be for a member (used on all their cards) or for one card version (used instead of the member's).
 * Each upload is cropped to fill the card's photo area and saved as data/card-photos/<key>.jpg.
 */

const dir = join(config.dataDir, "card-photos");
const info = new Map<string, CardPhotoInfo>();
const images = new Map<string, Image>();
const MAX_IMAGES = 300;

const fileOf = (key: string) => join(dir, `${key}.jpg`);

/** A valid photo key: a member ("blackpink.jennie") or a card ("blackpink.jennie.legend"). */
export function isPhotoKey(key: string) {
  if (cardById.has(key)) return true;
  const [groupId, memberId, extra] = key.split(".");
  return !extra && Boolean(groupById.get(groupId)?.members.some((m) => m.id === memberId));
}

let loading: Promise<void> | null = null;

/** Reads which photos exist, once at start-up (calling it again does nothing). */
export function loadPhotoList() {
  loading ??= (async () => {
    mkdirSync(dir, { recursive: true });
    for (const row of await db.select().from(cardPhotos).all()) info.set(row.key, { credit: row.credit, updatedAt: row.updatedAt.getTime() });
  })();
  return loading;
}

/** The photo a card shows: its own, or its member's. */
export function photoOf(card: Card) {
  const key = info.has(card.id) ? card.id : info.has(memberKey(card.id)) ? memberKey(card.id) : null;
  return key ? { key, ...info.get(key)! } : null;
}

export const hasPhoto = (card: Card) => photoOf(card) !== null;
export const photoList = () => Object.fromEntries(info);
export const readyCount = () => cards.filter(hasPhoto).length;

/** The photo as an image to draw, loaded from disk the first time (a few hundred are kept in memory). */
export async function photoImage(key: string) {
  const cached = images.get(key);
  if (cached) return cached;
  try {
    const img = await loadImage(readFileSync(fileOf(key)));
    if (images.size >= MAX_IMAGES) images.delete(images.keys().next().value!);
    images.set(key, img);
    return img;
  } catch {
    return null; // file missing: the card shows "photo unavailable"
  }
}

export const photoFile = (key: string) => readFileSync(fileOf(key));

/** Crops the upload to fill the photo area (keeping the middle, a little above centre for faces) and saves it. */
export async function savePhoto(key: string, upload: Buffer, credit: string, by: string) {
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
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileOf(key), await canvas.encode("jpeg", 88));
  const values = { credit, updatedAt: new Date(), updatedBy: by };
  await db.insert(cardPhotos).values({ key, ...values }).onConflictDoUpdate({ target: cardPhotos.key, set: values }).run();
  info.set(key, { credit, updatedAt: values.updatedAt.getTime() });
  images.delete(key);
}

export async function setCredit(key: string, credit: string) {
  await db.update(cardPhotos).set({ credit }).where(eq(cardPhotos.key, key)).run();
  const current = info.get(key);
  if (current) info.set(key, { ...current, credit, updatedAt: Date.now() });
}

export async function deletePhoto(key: string) {
  await db.delete(cardPhotos).where(eq(cardPhotos.key, key)).run();
  rmSync(fileOf(key), { force: true });
  info.delete(key);
  images.delete(key);
}
