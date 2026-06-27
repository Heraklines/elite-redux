import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as FX from "./fx.mjs";

const A = "../er-assets/images/pokemon";
const at = JSON.parse(fs.readFileSync(`${A}/144.json`));
const img = await loadImage(`${A}/144.png`);
const sh = createCanvas(img.width, img.height);
const sc = sh.getContext("2d");
sc.drawImage(img, 0, 0);
let hero = null;
let best = -1;
for (const f of at.textures[0].frames) {
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
const W = hero.w;
const H = hero.h;
const raw = sc.getImageData(hero.x, hero.y, W, H).data;
const src = new Float32Array(W * H * 4);
for (let i = 0; i < W * H * 4; i++) {
  src[i] = raw[i] / 255;
}
const CL = FX.computeClusters(src, W, H, 5);
const ctx0 = { K: CL.K, W, H, clRank: (r, g, b) => FX.clusterRank(CL, r, g, b) };
console.log(
  "centroids(luma-sorted):",
  CL.cent.map(c => c.map(v => Math.round(v * 255))),
);

const render = name => {
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
};
const items = ["void", "inferno", ...FX.CLUSTER_PAL].map(n => ({
  n,
  label: FX.LABELS[n] + (FX.CLUSTER_PAL.has(n) ? "" : " (old ramp)"),
  buf: render(n),
}));

const S = 5;
const COLS = 4;
const TW = W * S;
const TH = H * S;
const LAB = 28;
const P = 16;
const rows = Math.ceil(items.length / COLS);
const cw = COLS * (TW + P) + P;
const ch = rows * (TH + LAB + P) + P + 40;
const cv = createCanvas(cw, ch);
const c = cv.getContext("2d");
c.fillStyle = "#0b0d14";
c.fillRect(0, 0, cw, ch);
c.fillStyle = "#e8ecf6";
c.font = "bold 22px sans-serif";
c.fillText("Cluster palettes (region-faithful 2-/multi-tone) vs old luma ramps", P, 28);
const sm = createCanvas(W, H);
const ss = sm.getContext("2d");
items.forEach((it, idx) => {
  const x = P + (idx % COLS) * (TW + P);
  const y = 40 + Math.floor(idx / COLS) * (TH + LAB + P);
  c.fillStyle = "#15192a";
  c.fillRect(x, y, TW, TH);
  const id = ss.createImageData(W, H);
  id.data.set(it.buf);
  ss.putImageData(id, 0, 0);
  c.imageSmoothingEnabled = false;
  c.drawImage(sm, x, y, TW, TH);
  c.fillStyle = "#dfe5f2";
  c.font = "bold 15px sans-serif";
  c.fillText(it.label, x + 4, y + TH + 19);
});
fs.writeFileSync("shiny-lab/contact-cluster.png", cv.toBuffer("image/png"));
console.log("wrote contact-cluster.png");
