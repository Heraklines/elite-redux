// Zoomed per-effect triage sheets: one ROW per effect, columns = time samples,
// rendered big enough to actually judge quality (unlike the tiny contact tiles).
//   node shiny-lab/gen-zoom.mjs surface neonsign,mistveil,... [species] [out.png]
//   node shiny-lab/gen-zoom.mjs around helix,atomrings,...   [species] [out.png]
//   node shiny-lab/gen-zoom.mjs palette blueprint,...        [species] [out.png]
import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as FX from "./fx.mjs";

const A = "../er-assets/images/pokemon";
const KIND = process.argv[2] || "surface";
const NAMES = (process.argv[3] || "").split(",").filter(Boolean);
const SPECIES = +(process.argv[4] || 144);
const OUT = process.argv[5] || `shiny-lab/zoom-${KIND}.png`;
const PAD = 22;
const TIMES = [0.6, 1.5, 2.4, 3.3];
const S = 3;

const at = JSON.parse(fs.readFileSync(`${A}/${SPECIES}.json`));
const img = await loadImage(`${A}/${SPECIES}.png`);
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
const W = hero.w;
const H = hero.h;
const raw = sc.getImageData(hero.x, hero.y, W, H).data;
const src = new Float32Array(W * H * 4);
for (let i = 0; i < src.length; i++) {
  src[i] = raw[i] / 255;
}
const EF = FX.computeEdge(src, W, H);
const DIST = FX.computeDist(src, W, H, PAD);
const CL = FX.computeClusters(src, W, H, 5);
const PW = DIST.PW;
const PH = DIST.PH;
const sample = (x, y) => {
  const xi = Math.max(0, Math.min(W - 1, Math.round(x * W)));
  const yi = Math.max(0, Math.min(H - 1, Math.round(y * H)));
  const i = (yi * W + xi) * 4;
  return [src[i], src[i + 1], src[i + 2], src[i + 3]];
};
const spr = (nx, ny) => {
  const sx2 = Math.round(nx * PW - 0.5) - PAD;
  const sy2 = Math.round(ny * PH - 0.5) - PAD;
  if (sx2 < 0 || sy2 < 0 || sx2 >= W || sy2 >= H) {
    return [0, 0, 0, 0];
  }
  const i2 = (sy2 * W + sx2) * 4;
  return [src[i2], src[i2 + 1], src[i2 + 2], src[i2 + 3]];
};

function renderOne(kind, name, t) {
  const out = new Uint8ClampedArray(PW * PH * 4);
  const ctx = {
    e: 0,
    sa: sample,
    K: CL.K,
    W,
    H,
    clRank: (r, g, b) => FX.clusterRank(CL, r, g, b),
    clColor: i => CL.cent[i] ?? [0.5, 0.5, 0.5],
  };
  const ac = { cx: DIST.cx, cy: DIST.cy, spr };
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const k = (py * PW + px) * 4;
      const sx = px - PAD;
      const sy = py - PAD;
      const inside = sx >= 0 && sy >= 0 && sx < W && sy < H && src[(sy * W + sx) * 4 + 3] > 0.02;
      const nx = (px + 0.5) / PW;
      const ny = (py + 0.5) / PH;
      if (inside) {
        const i = (sy * W + sx) * 4;
        const a0 = src[i + 3];
        const x = (sx + 0.5) / W;
        const y = (sy + 0.5) / H;
        ctx.e = EF[sy * W + sx];
        let col = [src[i], src[i + 1], src[i + 2]];
        let a = a0;
        if (kind === "palette") {
          col = FX.PALETTE[name](col[0], col[1], col[2], ctx);
          a = a0 * (FX.PALETTE_ALPHA[name] ?? 1);
        } else if (kind === "surface") {
          const res = FX.AURA[name](col[0], col[1], col[2], x, y, t, ctx);
          const top = [res[0], res[1], res[2]];
          a = a0 * res[3];
          col = FX.blendCol(col, top, FX.SURFACE_BLEND[name] || "normal");
        } else if (FX.AROUND_OVERLAY.has(name)) {
          const res = FX.AROUND[name](nx, ny, 0, t, ac);
          const oa = res[3];
          if (oa > 0) {
            col = [FX.mix(col[0], res[0], oa), FX.mix(col[1], res[1], oa), FX.mix(col[2], res[2], oa)];
          }
        }
        out[k] = col[0] * 255;
        out[k + 1] = col[1] * 255;
        out[k + 2] = col[2] * 255;
        out[k + 3] = a * 255;
      } else if (kind === "around") {
        const df = DIST.d[py * PW + px];
        const res = FX.AROUND[name](nx, ny, df, t, ac);
        out[k] = res[0] * 255;
        out[k + 1] = res[1] * 255;
        out[k + 2] = res[2] * 255;
        out[k + 3] = res[3] * 255;
      }
    }
  }
  return out;
}

const names = NAMES.length ? NAMES : kindDefault();
function kindDefault() {
  return kindList(KIND);
}
function kindList(k) {
  if (k === "palette") {
    return FX.ALL_PALETTE;
  }
  if (k === "surface") {
    return FX.ALL_AURA;
  }
  return FX.ALL_AROUND;
}
const tileW = PW * S;
const tileH = PH * S;
const P = 10;
const LABW = 170;
const cw = LABW + TIMES.length * (tileW + P) + P;
const ch = names.length * (tileH + P) + P + 30;
const cv = createCanvas(cw, ch);
const c = cv.getContext("2d");
c.fillStyle = "#101322";
c.fillRect(0, 0, cw, ch);
c.fillStyle = "#e8ecf6";
c.font = "bold 16px sans-serif";
c.fillText(`zoom ${KIND} #${SPECIES} (cols: t=${TIMES.join(", ")})`, P, 20);
const sm = createCanvas(PW, PH);
const ss = sm.getContext("2d");
names.forEach((n, ri) => {
  const y0 = 30 + ri * (tileH + P);
  c.fillStyle = "#dfe5f2";
  c.font = "bold 13px sans-serif";
  c.fillText(`${FX.LABELS[n] || n}`, P, y0 + tileH / 2);
  c.font = "11px sans-serif";
  c.fillStyle = "#8b93ad";
  c.fillText(n, P, y0 + tileH / 2 + 15);
  TIMES.forEach((t, ci) => {
    const buf = renderOne(KIND, n, t);
    const id = ss.createImageData(PW, PH);
    id.data.set(buf);
    ss.putImageData(id, 0, 0);
    const x0 = LABW + ci * (tileW + P);
    c.fillStyle = "#1a1f33";
    c.fillRect(x0, y0, tileW, tileH);
    c.imageSmoothingEnabled = false;
    c.drawImage(sm, x0, y0, tileW, tileH);
  });
});
fs.writeFileSync(OUT, cv.toBuffer("image/png"));
console.log(`wrote ${OUT} (${names.length} effects)`);
