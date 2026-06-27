import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as FX from "./fx.mjs";

const ASSET = "../er-assets/images/pokemon";
const OUT = "shiny-lab";
const PAD = 22;

const atlas = JSON.parse(fs.readFileSync(`${ASSET}/144.json`));
const img = await loadImage(`${ASSET}/144.png`);
const sheet = createCanvas(img.width, img.height);
const sctx = sheet.getContext("2d");
sctx.drawImage(img, 0, 0);

let hero = null;
let best = -1;
for (const f of atlas.textures[0].frames) {
  const { x, y, w, h } = f.frame;
  const d = sctx.getImageData(x, y, w, h).data;
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
const raw = sctx.getImageData(hero.x, hero.y, W, H).data;
const src = new Float32Array(W * H * 4);
for (let i = 0; i < W * H * 4; i++) {
  src[i] = raw[i] / 255;
}

const EF = FX.computeEdge(src, W, H);
const DIST = FX.computeDist(src, W, H, PAD);
const CL = FX.computeClusters(src, W, H, 5);
const PW = DIST.PW;
const PH = DIST.PH;
console.log(`hero ${W}x${H} opaque ${best} | padded ${PW}x${PH}`);

const sample = (x, y) => {
  const xi = Math.max(0, Math.min(W - 1, Math.round(x * W)));
  const yi = Math.max(0, Math.min(H - 1, Math.round(y * H)));
  const i = (yi * W + xi) * 4;
  return [src[i], src[i + 1], src[i + 2], src[i + 3]];
};

function renderNative(kind, name, t) {
  const out = new Uint8ClampedArray(W * H * 4);
  const ctx = {
    e: 0,
    sa: sample,
    K: CL.K,
    W,
    H,
    clRank: (r, g, b) => FX.clusterRank(CL, r, g, b),
    clColor: i => CL.cent[i] ?? [0.5, 0.5, 0.5],
  };
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = (py * W + px) * 4;
      const a0 = src[i + 3];
      if (a0 <= 0.02) {
        continue;
      }
      const x = (px + 0.5) / W;
      const y = (py + 0.5) / H;
      ctx.e = EF[py * W + px];
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      let a = a0;
      let col;
      if (kind === "base") {
        col = [r, g, b];
      } else if (kind === "palette") {
        col = FX.PALETTE[name](r, g, b, ctx);
        a = a0 * (FX.PALETTE_ALPHA[name] ?? 1);
      } else if (name === "prismatic") {
        const off = 0.012 * (0.6 + 0.4 * Math.sin(t * 2));
        col = [sample(x + off, y)[0], g, sample(x - off, y)[2]];
      } else if (name === "glitch") {
        const slice = Math.floor(y * 16);
        const rnd = FX.vnoise(slice * 3.1 + 0.5, Math.floor(t * 8) * 1.3 + 0.5);
        const dx = rnd > 0.62 ? (FX.vnoise(slice + 9, Math.floor(t * 8)) - 0.5) * 0.14 : 0;
        const s2 = sample(x + dx, y);
        if (s2[3] <= 0.02) {
          continue;
        }
        const scan = py % 3 === 0 ? 0.6 : 1;
        col = [sample(x + dx + 0.01, y)[0] * scan, s2[1] * scan, sample(x + dx - 0.01, y)[2] * scan];
        a = s2[3];
      } else {
        const res = FX.AURA[name](r, g, b, x, y, t, ctx);
        col = [res[0], res[1], res[2]];
        a = a0 * res[3];
      }
      if (kind === "surface") {
        col = FX.blendCol([r, g, b], col, FX.SURFACE_BLEND[name] || "normal");
      }
      out[i] = col[0] * 255;
      out[i + 1] = col[1] * 255;
      out[i + 2] = col[2] * 255;
      out[i + 3] = a * 255;
    }
  }
  return out;
}

function renderAround(name, t) {
  const out = new Uint8ClampedArray(PW * PH * 4);
  const c = { cx: DIST.cx, cy: DIST.cy };
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const k = (py * PW + px) * 4;
      const sx = px - PAD;
      const sy = py - PAD;
      const inside = sx >= 0 && sy >= 0 && sx < W && sy < H && src[(sy * W + sx) * 4 + 3] > 0.02;
      if (inside) {
        const i = (sy * W + sx) * 4;
        out[k] = src[i] * 255;
        out[k + 1] = src[i + 1] * 255;
        out[k + 2] = src[i + 2] * 255;
        out[k + 3] = src[i + 3] * 255;
      } else {
        const nx = (px + 0.5) / PW;
        const ny = (py + 0.5) / PH;
        const df = DIST.d[py * PW + px];
        const res = FX.AROUND[name](nx, ny, df, t, c);
        out[k] = res[0] * 255;
        out[k + 1] = res[1] * 255;
        out[k + 2] = res[2] * 255;
        out[k + 3] = res[3] * 255;
      }
    }
  }
  return out;
}

function buildSheet(title, items, dW, dH, S, cols = 4) {
  const PADc = 18;
  const LAB = 30;
  const tileW = dW * S;
  const tileH = dH * S;
  const cellW = tileW + PADc;
  const cellH = tileH + LAB + PADc;
  const rows = Math.ceil(items.length / cols);
  const cw = cols * cellW + PADc;
  const ch = rows * cellH + PADc + 52;
  const cv = createCanvas(cw, ch);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#0b0d14";
  ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = "#e8ecf6";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(title, PADc, 36);
  const small = createCanvas(dW, dH);
  const sx = small.getContext("2d");
  items.forEach((it, idx) => {
    const cx = PADc + (idx % cols) * cellW;
    const cy = 56 + Math.floor(idx / cols) * cellH;
    const grd = ctx.createRadialGradient(
      cx + tileW / 2,
      cy + tileH / 2,
      10,
      cx + tileW / 2,
      cy + tileH / 2,
      tileW * 0.7,
    );
    grd.addColorStop(0, it.glow ?? "#1b2030");
    grd.addColorStop(1, "#0d1019");
    ctx.fillStyle = grd;
    ctx.fillRect(cx, cy, tileW, tileH);
    ctx.strokeStyle = "#262c3d";
    ctx.strokeRect(cx + 0.5, cy + 0.5, tileW, tileH);
    const id = sx.createImageData(dW, dH);
    id.data.set(it.buf);
    sx.putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, cx, cy, tileW, tileH);
    ctx.fillStyle = it.cat === "around" ? "#ffd27a" : it.cat === "surface" ? "#ff7ad9" : "#5ad1ff";
    ctx.beginPath();
    ctx.arc(cx + 10, cy + tileH + 16, 5, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#dfe5f2";
    ctx.font = "bold 17px sans-serif";
    ctx.fillText(it.label, cx + 22, cy + tileH + 21);
  });
  return cv;
}

const auraT = {
  rainbow: 1,
  aurora: 2,
  holofoil: 1.5,
  prismatic: 1,
  frostbite: 1.2,
  glitch: 1.3,
  hologram: 0.55,
  galaxy: 2,
  plasma: 1,
  molten: 1.6,
  electric: 0.61,
  dissolve: 0,
  mercury: 1,
  lavacracks: 1,
  frozenice: 2,
  crystalfacets: 0.5,
  stainedglass: 0,
  marble: 0,
  bioluminescent: 1,
  constellation: 1,
  aurorawings: 2,
  gildededges: 0.8,
  rimlight: 0.5,
  vaporwave: 0.5,
  halftone: 0,
  sparkle: 1,
  lightningveins: 1,
  dripgold: 2.2,
  spectrumsplit: 1,
  ripple: 1,
  circuit: 1,
  scales: 1,
  tvstatic: 1,
  scansweep: 2,
  poison: 1,
};
const aroundT = {
  outline: 0.5,
  halo: 0,
  flame: 1.5,
  shadowfire: 1.5,
  frost: 1,
  efield: 1,
  rings: 1,
  orbit: 1,
  auroraveil: 2,
  holyrays: 1,
  cosmos: 1,
  smoke: 1.5,
  radiant: 1,
  embers: 1,
  snow: 1,
  bubbles: 1,
};

const palItems = [{ label: "Base", cat: "palette", buf: new Uint8ClampedArray(raw), glow: "#202636" }];
for (const k of FX.ALL_PALETTE) {
  palItems.push({ label: FX.LABELS[k], cat: "palette", buf: renderNative("palette", k, 0) });
}
const surfItems = FX.ALL_AURA.map(k => ({
  label: FX.LABELS[k],
  cat: "surface",
  buf: renderNative("surface", k, auraT[k] ?? 1),
}));
const aroItems = FX.ALL_AROUND.map(k => ({
  label: FX.LABELS[k],
  cat: "around",
  buf: renderAround(k, aroundT[k] ?? 1),
}));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  `${OUT}/contact-palette.png`,
  buildSheet(`Shiny Lab - Palette (${FX.ALL_PALETTE.length})`, palItems, W, H, 4).toBuffer("image/png"),
);
fs.writeFileSync(
  `${OUT}/contact-surface.png`,
  buildSheet(`Shiny Lab - Surface FX (${FX.ALL_AURA.length})`, surfItems, W, H, 4).toBuffer("image/png"),
);
fs.writeFileSync(
  `${OUT}/contact-around.png`,
  buildSheet(`Shiny Lab - Around FX (${FX.ALL_AROUND.length})`, aroItems, PW, PH, 3).toBuffer("image/png"),
);
console.log("wrote contact-palette / contact-surface / contact-around");
