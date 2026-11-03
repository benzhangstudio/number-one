import { createRequire } from "node:module";
import { type SKRSContext2D, GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * The /rank card: a picture with the member's avatar, name, rank, level and a progress bar.
 * Fonts are bundled (from @fontsource/inter) because hosting servers often have none installed.
 */

const require = createRequire(import.meta.url);
const FONT = "Inter";
for (const weight of [400, 700, 800]) {
  try {
    GlobalFonts.registerFromPath(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff2`), FONT);
  } catch (err) {
    console.warn("[levels] couldn't load the rank card font:", (err as Error).message);
  }
}

const W = 934;
const H = 282;
const ACCENT = "#ff4fa3";
const BG = "#1e1f24";
const PANEL = "#2b2d34";
const TRACK = "#43454f";
const TEXT = "#ffffff";
const MUTED = "#a4a7b3";

export interface RankCardInput {
  name: string;
  /** e.g. "alex" under the display name; omitted when it's the same. */
  username?: string;
  avatarUrl: string;
  level: number;
  /** 0 = not ranked yet. */
  rank: number;
  xpIntoLevel: number;
  xpForNext: number;
}

/** Short numbers like MEE6's card: 950, 1.2K, 13.5K, 250K, 3.4M (rounded down, so it never shows more than they have). */
function short(x: number) {
  const [div, unit] = x >= 1_000_000 ? [1_000_000, "M"] : x >= 1000 ? [1000, "K"] : [1, ""];
  const v = x / div;
  const digits = unit && v < 100 ? 1 : 0;
  const f = 10 ** digits;
  return `${(Math.floor(v * f) / f).toFixed(digits).replace(/\.0$/, "")}${unit}`;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

/** Shortens text with "…" so it fits in `max` pixels. */
function fit(ctx: SKRSContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

async function avatar(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Draws the card and returns it as a PNG. */
export async function renderRankCard(input: RankCardInput): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background and inner panel.
  roundRect(ctx, 0, 0, W, H, 28);
  ctx.fillStyle = BG;
  ctx.fill();
  roundRect(ctx, 24, 24, W - 48, H - 48, 20);
  ctx.fillStyle = PANEL;
  ctx.fill();

  // Avatar in a circle with an accent ring.
  const ax = 56, ay = 61, size = 160;
  ctx.beginPath();
  ctx.arc(ax + size / 2, ay + size / 2, size / 2 + 6, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  const img = await avatar(input.avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, ax, ay, size, size);
  else {
    ctx.fillStyle = TRACK;
    ctx.fillRect(ax, ay, size, size);
  }
  ctx.restore();

  const left = 260;
  const right = W - 56;

  // Top right: RANK #3   LEVEL 12 (labels small, numbers big, like MEE6).
  ctx.textBaseline = "alphabetic";
  let x = right;
  const stat = (label: string, value: string, color: string) => {
    ctx.font = `800 60px ${FONT}`;
    ctx.fillStyle = color;
    const vw = ctx.measureText(value).width;
    x -= vw;
    ctx.fillText(value, x, 110);
    ctx.font = `700 24px ${FONT}`;
    ctx.fillStyle = color === ACCENT ? ACCENT : MUTED;
    const lw = ctx.measureText(label).width;
    x -= lw + 10;
    ctx.fillText(label, x, 110);
    x -= 30;
  };
  stat("LEVEL", String(input.level), ACCENT);
  stat("RANK", input.rank ? `#${input.rank}` : "—", TEXT);

  // Name (and username) above the bar, left side.
  ctx.font = `700 40px ${FONT}`;
  ctx.fillStyle = TEXT;
  const nameMax = right - left - 230;
  const name = fit(ctx, input.name, nameMax);
  ctx.fillText(name, left, 178);
  if (input.username) {
    const nw = ctx.measureText(name).width;
    ctx.font = `400 24px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(fit(ctx, `@${input.username}`, Math.max(0, nameMax - nw - 12)), left + nw + 12, 178);
  }

  // XP text, right side above the bar.
  ctx.font = `700 26px ${FONT}`;
  const total = ` / ${short(input.xpForNext)} XP`;
  const tw = ctx.measureText(total).width;
  ctx.fillStyle = MUTED;
  ctx.fillText(total, right - tw, 178);
  ctx.fillStyle = TEXT;
  const cur = short(input.xpIntoLevel);
  ctx.fillText(cur, right - tw - ctx.measureText(cur).width, 178);

  // Progress bar.
  const by = 196, bh = 36, bw = right - left;
  roundRect(ctx, left, by, bw, bh, bh / 2);
  ctx.fillStyle = TRACK;
  ctx.fill();
  const part = input.xpForNext ? Math.min(1, input.xpIntoLevel / input.xpForNext) : 0;
  if (part > 0) {
    roundRect(ctx, left, by, Math.max(bh, bw * part), bh, bh / 2);
    const grad = ctx.createLinearGradient(left, 0, left + bw, 0);
    grad.addColorStop(0, ACCENT);
    grad.addColorStop(1, "#ff8cc6");
    ctx.fillStyle = grad;
    ctx.fill();
  }

  return canvas.encode("png");
}
