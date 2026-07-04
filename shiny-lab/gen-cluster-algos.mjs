// A/B sheet for the clustering algo selector: rows = CLUSTERING algos,
// cols = cluster palettes, one block per species. Eyeball which segmentation
// recolors regions best (see EFFECTS.md "Clustering algos").
import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as FX from "./fx.mjs";

const A = "../er-assets/images/pokemon";
const SPECIES = [144, 6, 94]; // Articuno (mono-hue), Charizard (multi-hue), Gengar
const PALS = ["duoneon", "trisunset", "quadvapor", "pentajewel", "retro"];

async function heroFrame(id) {
  const at = JSON.parse(fs.readFileSync(`${A}/${id}.json`));
  const img = await loadImage(`${A}/${id}.png`);
  const sh = createCanvas(img.width, img.height);
  const sc = sh.getContext("2d");
  sc.drawImage(img, 0, 0);
  let hero = null;
  let best = -1;
  const frames = at.textures ? at.textures[0].frames : Array.isArray(at.frames) ? at.frames : Object.values(at.frames);
  for (const f of frames) {
    const { x, y, w, h } = f.frame;
    const d = sc.getImageData(x, y, w, h).data;
    let o = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 8) {
        o++;
      }
    }
    if (o > best) {
      best = o;
      hero = { x, y, w, h };
    }
  }
  const raw = sc.getImageData(hero.x, hero.y, hero.w, hero.h).data;
  const src = new Float32Array(hero.w * hero.h * 4);
  for (let i = 0; i < src.length; i++) {
    src[i] = raw[i] / 255;
  }
  return { W: hero.w, H: hero.h, src };
}

const blocks = [];
for (const id of SPECIES) {
  const { W, H, src } = await heroFrame(id);
  const rows = [];
  for (const [algo, def] of Object.entries(FX.CLUSTERING)) {
    const CL = def.fn(src, W, H, 5);
    const ctx0 = { K: CL.K, W, H, clRank: (r, g, b) => FX.clusterRank(CL, r, g, b), clColor: i => CL.cent[i] };
    const tiles = PALS.map(name => {
      const out = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const a = src[i * 4 + 3];
        if (a <= 0.02) {
          continue;
        }
        const c = FX.PALETTE[name](src[i * 4], src[i * 4 + 1], src[i * 4 + 2], ctx0);
        out[i * 4] = c[0] * 255;
        out[i * 4 + 1] = c[1] * 255;
        out[i * 4 + 2] = c[2] * 255;
        out[i * 4 + 3] = a * 255;
      }
      return out;
    });
    rows.push({ algo, label: def.label, K: CL.K, tiles });
  }
  blocks.push({ id, W, H, src, rows });
}

const S = 3;
const P = 14;
const LABW = 250;
const maxW = Math.max(...blocks.map(b => b.W));
const tileW = maxW * S;
const cw = LABW + (PALS.length + 1) * (tileW + P) + P;
let ch = 50;
for (const b of blocks) {
  ch += b.rows.length * (b.H * S + P) + 46;
}
const cv = createCanvas(cw, ch);
const c = cv.getContext("2d");
c.fillStyle = "#0b0d14";
c.fillRect(0, 0, cw, ch);
c.fillStyle = "#e8ecf6";
c.font = "bold 22px sans-serif";
c.fillText("Clustering algos x cluster palettes (rows = algo, cols = base + palettes)", P, 30);
let cy = 50;
for (const b of blocks) {
  c.fillStyle = "#9fb2d8";
  c.font = "bold 18px sans-serif";
  c.fillText(`#${b.id}`, P, cy + 20);
  c.fillStyle = "#dfe5f2";
  c.font = "13px sans-serif";
  PALS.forEach((n, i) => c.fillText(FX.LABELS[n], LABW + (i + 1) * (tileW + P) + 4, cy + 20));
  cy += 28;
  const sm = createCanvas(b.W, b.H);
  const ss = sm.getContext("2d");
  for (const row of b.rows) {
    c.fillStyle = "#dfe5f2";
    c.font = "bold 14px sans-serif";
    c.fillText(`${row.label} (K=${row.K})`, P, cy + (b.H * S) / 2);
    const drawBuf = (buf, x) => {
      const idd = ss.createImageData(b.W, b.H);
      idd.data.set(buf);
      ss.putImageData(idd, 0, 0);
      c.imageSmoothingEnabled = false;
      c.drawImage(sm, x, cy, b.W * S, b.H * S);
    };
    const base = new Uint8ClampedArray(b.W * b.H * 4);
    for (let i = 0; i < base.length; i++) {
      base[i] = b.src[i] * 255;
    }
    drawBuf(base, LABW);
    row.tiles.forEach((buf, i) => drawBuf(buf, LABW + (i + 1) * (tileW + P)));
    cy += b.H * S + P;
  }
  cy += 18;
}
fs.writeFileSync("shiny-lab/contact-cluster-algos.png", cv.toBuffer("image/png"));
console.log("wrote contact-cluster-algos.png");
