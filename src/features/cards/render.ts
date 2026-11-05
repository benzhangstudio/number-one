import { createRequire } from "node:module";
import { type SKRSContext2D, GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { CARD_COUNT, type Card, cardTypes, generationNames, rarityInfo, typeInfo } from "../../shared/cards.js";
import { photoImage, photoOf } from "./photos.js";

/**
 * Draws a card as a picture: the uploaded photo in a frame coloured by rarity, with the member's name, HP,
 * type, move and power, like a Pokémon card. Nothing is drawn in place of a person: a card without a photo
 * shows "Photo coming soon".
 */

const require = createRequire(import.meta.url);
const FONT = "Inter";
for (const weight of [400, 700, 800]) {
  try {
    GlobalFonts.registerFromPath(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff2`), FONT);
  } catch {
    // Already registered by the rank card, or missing: text still draws with the default font.
  }
}

export const CARD_W = 360;
export const CARD_H = 560;
const PANEL = "#15141a";
const BOX = "#23222b";
const TEXT = "#ffffff";
const MUTED = "#a4a7b3";

/** Frame colours by rarity: [light, main, dark]. */
const frames: Record<Card["rarity"], [string, string, string]> = {
  common: ["#e3e6ec", "#a7adba", "#6b7180"],
  rare: ["#a9d4ff", "#4fa3ff", "#1f5fb0"],
  epic: ["#e2c6ff", "#b06bff", "#6a2fb3"],
  legendary: ["#fff1b8", "#ffb300", "#b36b00"],
  mythic: ["#ffd1e8", "#ff4fa3", "#8a3cff"],
};

function rounded(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fit(ctx: SKRSContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function star(ctx: SKRSContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function pill(ctx: SKRSContext2D, text: string, x: number, y: number, bg: string, alignRight = false) {
  ctx.font = `700 13px ${FONT}`;
  const w = ctx.measureText(text).width + 18;
  const left = alignRight ? x - w : x;
  ctx.fillStyle = bg;
  rounded(ctx, left, y, w, 24, 12);
  ctx.fill();
  ctx.fillStyle = TEXT;
  ctx.textAlign = "left";
  ctx.fillText(text, left + 9, y + 16.5);
}

async function drawCard(ctx: SKRSContext2D, card: Card) {
  const [light, main, dark] = frames[card.rarity];
  const type = typeInfo[card.type];

  // Frame and panel.
  const frame = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  frame.addColorStop(0, light);
  frame.addColorStop(0.45, main);
  frame.addColorStop(1, dark);
  ctx.fillStyle = frame;
  rounded(ctx, 0, 0, CARD_W, CARD_H, 24);
  ctx.fill();
  ctx.fillStyle = PANEL;
  rounded(ctx, 10, 10, CARD_W - 20, CARD_H - 20, 16);
  ctx.fill();

  // Name and HP.
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 15px ${FONT}`;
  const hpText = String(card.hp);
  ctx.font = `800 26px ${FONT}`;
  const hpW = ctx.measureText(hpText).width;
  ctx.textAlign = "right";
  ctx.fillStyle = TEXT;
  ctx.fillText(hpText, CARD_W - 24, 50);
  ctx.font = `700 13px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText("HP", CARD_W - 28 - hpW, 50);
  ctx.textAlign = "left";
  ctx.fillStyle = TEXT;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText(fit(ctx, card.memberName, CARD_W - 110 - hpW), 24, 50);

  // Photo.
  const px = 24;
  const py = 62;
  const ps = 312;
  ctx.save();
  rounded(ctx, px, py, ps, ps, 12);
  ctx.clip();
  const photo = photoOf(card);
  const img = photo ? await photoImage(photo.key) : null;
  if (img) ctx.drawImage(img, px, py, ps, ps);
  else {
    const bg = ctx.createLinearGradient(px, py, px + ps, py + ps);
    bg.addColorStop(0, card.color);
    bg.addColorStop(1, "#111015");
    ctx.fillStyle = bg;
    ctx.fillRect(px, py, ps, ps);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `700 18px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("Photo coming soon", px + ps / 2, py + ps / 2 + 6);
    ctx.textAlign = "left";
  }
  // Soft shade at the top so the labels stay readable on bright photos.
  const shade = ctx.createLinearGradient(0, py, 0, py + 70);
  shade.addColorStop(0, "rgba(0,0,0,0.45)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(px, py, ps, 70);
  // A shine across Legendary and Mythic photos.
  if (card.rarity === "legendary" || card.rarity === "mythic") {
    const shine = ctx.createLinearGradient(px, py, px + ps, py + ps);
    const tint = card.rarity === "mythic" ? "255,120,200" : "255,220,120";
    shine.addColorStop(0, `rgba(${tint},0)`);
    shine.addColorStop(0.42, `rgba(${tint},0)`);
    shine.addColorStop(0.5, `rgba(${tint},0.28)`);
    shine.addColorStop(0.58, `rgba(${tint},0)`);
    shine.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = shine;
    ctx.fillRect(px, py, ps, ps);
  }
  ctx.restore();
  ctx.strokeStyle = main;
  ctx.lineWidth = 3;
  rounded(ctx, px, py, ps, ps, 12);
  ctx.stroke();
  pill(ctx, card.groupName, px + 10, py + 10, `${card.color}e6`);
  pill(ctx, type.name, px + ps - 10, py + 10, type.color, true);

  // Version and number.
  ctx.font = `400 14px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(fit(ctx, `${card.version} · ${generationNames[card.gen]}`, 230), 24, 400);
  ctx.textAlign = "right";
  ctx.fillText(`#${String(card.number).padStart(4, "0")} / ${CARD_COUNT}`, CARD_W - 24, 400);
  ctx.textAlign = "left";

  // Move.
  ctx.fillStyle = BOX;
  rounded(ctx, 24, 414, CARD_W - 48, 62, 12);
  ctx.fill();
  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.arc(46, 445, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = TEXT;
  ctx.font = `700 19px ${FONT}`;
  ctx.fillText(type.move, 64, 452);
  ctx.textAlign = "right";
  ctx.font = `800 30px ${FONT}`;
  ctx.fillStyle = type.color;
  ctx.fillText(String(card.power), CARD_W - 40, 456);
  ctx.textAlign = "left";

  // Type matchups.
  const i = cardTypes.indexOf(card.type);
  const strong = typeInfo[cardTypes[(i + 1) % cardTypes.length]].name;
  const weak = typeInfo[cardTypes[(i + cardTypes.length - 1) % cardTypes.length]].name;
  ctx.font = `400 13px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(`Strong vs ${strong} · Weak vs ${weak}`, 24, 498);

  // Rarity stars, and the photo credit.
  ctx.fillStyle = main;
  for (let s = 0; s < rarityInfo[card.rarity].stars; s++) star(ctx, 32 + s * 18, 524, 7);
  ctx.font = `700 13px ${FONT}`;
  const after = 32 + rarityInfo[card.rarity].stars * 18;
  ctx.fillText(rarityInfo[card.rarity].name, after, 529);
  if (photo?.credit) {
    ctx.font = `400 11px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.textAlign = "right";
    ctx.font = `700 13px ${FONT}`;
    const used = after + ctx.measureText(rarityInfo[card.rarity].name).width + 14;
    ctx.font = `400 11px ${FONT}`;
    ctx.fillText(fit(ctx, photo.credit, CARD_W - 24 - used), CARD_W - 24, 529);
    ctx.textAlign = "left";
  }
}

/* ------------------------------------------------------------ pictures, kept for a while */

const cache = new Map<string, Buffer>();
const MAX_CACHE = 200;

/** One card, as a PNG. */
export async function renderCard(card: Card) {
  const photo = photoOf(card);
  const key = `${card.id}@${photo?.updatedAt ?? 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = createCanvas(CARD_W, CARD_H);
  await drawCard(canvas.getContext("2d"), card);
  const png = await canvas.encode("png");
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, png);
  return png;
}

/** Several cards side by side (a pack, or a team), as a PNG. */
export async function renderRow(list: Card[]) {
  const scale = 0.7;
  const w = CARD_W * scale;
  const h = CARD_H * scale;
  const gap = 14;
  const canvas = createCanvas(Math.round(list.length * w + (list.length + 1) * gap), Math.round(h + gap * 2));
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < list.length; i++) {
    ctx.save();
    ctx.translate(gap + i * (w + gap), gap);
    ctx.scale(scale, scale);
    await drawCard(ctx, list[i]);
    ctx.restore();
  }
  return canvas.encode("png");
}
