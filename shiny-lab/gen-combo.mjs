import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as FX from "./fx.mjs";

const ASSET = "../er-assets/images/pokemon";
const PAD = 22;
const atlas = JSON.parse(fs.readFileSync(`${ASSET}/144.json`));
const img = await loadImage(`${ASSET}/144.png`);
const sh = createCanvas(img.width, img.height);
const sc = sh.getContext("2d");
sc.drawImage(img, 0, 0);
let hero = null;
let best = -1;
for (const f of atlas.textures[0].frames) {
  const { x, y, w, h } = f.frame;
  const d = sc.getImageData(x, y, w, h).data;
  let op = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > 8) {
      op++;
    }
  }
  if (op > best) {
    best = op;
    hero = { x, y, w, h };
  }
}
const W = hero.w;
const H = hero.h;
const raw = sc.getImageData(hero.x, hero.y, W, H).data;
const src = new Float32Array(W * H * 4);
for (let i = 0; i < W * H * 4; i++) {
  src[i] = raw[i] / 255;
}
const EF = FX.computeEdge(src, W, H);
const DIST = FX.computeDist(src, W, H, PAD);
const PW = DIST.PW;
const PH = DIST.PH;
const sa = (x, y) => {
  const xi = Math.max(0, Math.min(W - 1, Math.round(x * W)));
  const yi = Math.max(0, Math.min(H - 1, Math.round(y * H)));
  const i = (yi * W + xi) * 4;
  return [src[i], src[i + 1], src[i + 2], src[i + 3]];
};

function renderLook(slots, t) {
  const out = new Uint8ClampedArray(PW * PH * 4);
  const ctx = { e: 0, sa };
  const ac = { cx: DIST.cx, cy: DIST.cy };
  const pal = slots.palette && slots.palette !== "base" ? slots.palette : null;
  const surf = slots.surface || null;
  const aro = slots.around || null;
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const k = (py * PW + px) * 4;
      const sx = px - PAD;
      const sy = py - PAD;
      const on = sx >= 0 && sy >= 0 && sx < W && sy < H && src[(sy * W + sx) * 4 + 3] > 0.02;
      if (on) {
        const i = (sy * W + sx) * 4;
        const a0 = src[i + 3];
        const x = (sx + 0.5) / W;
        const y = (sy + 0.5) / H;
        ctx.e = EF[sy * W + sx];
        const r = src[i];
        const g = src[i + 1];
        const b = src[i + 2];
        let a = a0;
        let col = pal ? FX.PALETTE[pal](r, g, b) : [r, g, b];
        if (pal) {
          a = a0 * (FX.PALETTE_ALPHA[pal] ?? 1);
        }
        if (surf && surf !== "prismatic" && surf !== "glitch") {
          const res = FX.AURA[surf](col[0], col[1], col[2], x, y, t, ctx);
          col = [res[0], res[1], res[2]];
          a *= res[3];
        }
        out[k] = col[0] * 255;
        out[k + 1] = col[1] * 255;
        out[k + 2] = col[2] * 255;
        out[k + 3] = a * 255;
      } else if (aro) {
        const nx = (px + 0.5) / PW;
        const ny = (py + 0.5) / PH;
        const df = DIST.d[py * PW + px];
        const res = FX.AROUND[aro](nx, ny, df, t, ac);
        out[k] = res[0] * 255;
        out[k + 1] = res[1] * 255;
        out[k + 2] = res[2] * 255;
        out[k + 3] = res[3] * 255;
      }
    }
  }
  return out;
}

const combos = [
  { label: "Glacier + Aurora Veil", slots: { palette: "glacier", around: "auroraveil" }, t: 2 },
  { label: "Obsidian + Flame Aura", slots: { palette: "obsidian", around: "flame" }, t: 1.5 },
  { label: "Aurum + Holo + Holy Light", slots: { palette: "aurum", surface: "holofoil", around: "holyrays" }, t: 1 },
  {
    label: "Sapphire + Frostbite + Frost",
    slots: { palette: "sapphire", surface: "frostbite", around: "frost" },
    t: 1,
  },
  { label: "Galaxy + Cosmic Backdrop", slots: { palette: "base", surface: "galaxy", around: "cosmos" }, t: 2 },
  { label: "Shadowflame + Shadow Fire", slots: { palette: "shadowflame", around: "shadowfire" }, t: 1.5 },
  { label: "Inferno + Ember Swarm", slots: { palette: "inferno", around: "embers" }, t: 1 },
  { label: "Amethyst + Scales + Orbit", slots: { palette: "amethyst", surface: "scales", around: "orbit" }, t: 1 },
];

const S = 3;
const COLS = 4;
const TW = PW * S;
const TH = PH * S;
const LAB = 30;
const P = 18;
const rows = Math.ceil(combos.length / COLS);
const cw = COLS * (TW + P) + P;
const ch = rows * (TH + LAB + P) + P + 52;
const cv = createCanvas(cw, ch);
const ctx = cv.getContext("2d");
ctx.fillStyle = "#0b0d14";
ctx.fillRect(0, 0, cw, ch);
ctx.fillStyle = "#e8ecf6";
ctx.font = "bold 26px sans-serif";
ctx.fillText("Shiny Lab - Combinations (Palette + Surface + Around)", P, 36);
const small = createCanvas(PW, PH);
const ss = small.getContext("2d");
combos.forEach((c, idx) => {
  const x = P + (idx % COLS) * (TW + P);
  const y = 56 + Math.floor(idx / COLS) * (TH + LAB + P);
  const grd = ctx.createRadialGradient(x + TW / 2, y + TH / 2, 10, x + TW / 2, y + TH / 2, TW * 0.7);
  grd.addColorStop(0, "#1b2030");
  grd.addColorStop(1, "#0d1019");
  ctx.fillStyle = grd;
  ctx.fillRect(x, y, TW, TH);
  ctx.strokeStyle = "#262c3d";
  ctx.strokeRect(x + 0.5, y + 0.5, TW, TH);
  const id = ss.createImageData(PW, PH);
  id.data.set(renderLook(c.slots, c.t));
  ss.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, x, y, TW, TH);
  ctx.fillStyle = "#dfe5f2";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText(c.label, x + 6, y + TH + 21);
});
fs.writeFileSync("shiny-lab/contact-combo.png", cv.toBuffer("image/png"));
console.log("wrote contact-combo.png");
