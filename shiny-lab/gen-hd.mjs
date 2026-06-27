import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as FX from "./fx.mjs";

const A = "../er-assets/images/pokemon";
const PAD = 22;
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
const FW = hero.w;
const FH = hero.h;
const raw = sc.getImageData(hero.x, hero.y, FW, FH).data;
const src = new Float32Array(FW * FH * 4);
for (let i = 0; i < FW * FH * 4; i++) {
  src[i] = raw[i] / 255;
}
const DIST = FX.computeDist(src, FW, FH, PAD);
const PW = DIST.PW;
const PH = DIST.PH;
const CL = FX.computeClusters(src, FW, FH, 5);
const { mix, clamp, h2, clusterRank, PALETTE, AROUND } = FX;

function bilinear(buf, fx, fy) {
  const x0 = Math.max(0, Math.min(FW - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(FH - 1, Math.floor(fy)));
  const x1 = Math.min(FW - 1, x0 + 1);
  const y1 = Math.min(FH - 1, y0 + 1);
  const tx = fx - Math.floor(fx);
  const ty = fy - Math.floor(fy);
  const pm = (X, Y) => {
    const i = (Y * FW + X) * 4;
    const al = buf[i + 3];
    return [buf[i] * al, buf[i + 1] * al, buf[i + 2] * al, al];
  };
  const a = pm(x0, y0);
  const b = pm(x1, y0);
  const c = pm(x0, y1);
  const d = pm(x1, y1);
  const o = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    o[k] = mix(mix(a[k], b[k], tx), mix(c[k], d[k], tx), ty);
  }
  if (o[3] > 1e-4) {
    o[0] /= o[3];
    o[1] /= o[3];
    o[2] /= o[3];
  }
  return o;
}
function renderHD(slots, t, SS) {
  const OW = SS * PW;
  const OH = SS * PH;
  const out = new Uint8ClampedArray(OW * OH * 4);
  const ac = { cx: DIST.cx, cy: DIST.cy };
  const ctx = { W: FW, H: FH, K: CL.K, clRank: (r, g, b) => clusterRank(CL, r, g, b) };
  const pal = slots.palette && slots.palette !== "base" ? slots.palette : null;
  const aro = slots.around || null;
  for (let Y = 0; Y < OH; Y++) {
    for (let X = 0; X < OW; X++) {
      const k = (Y * OW + X) * 4;
      const fpx = (X + 0.5) / SS - 0.5;
      const fpy = (Y + 0.5) / SS - 0.5;
      const sxf = fpx - PAD;
      const syf = fpy - PAD;
      if (sxf >= -0.5 && syf >= -0.5 && sxf <= FW - 0.5 && syf <= FH - 0.5) {
        const c4 = bilinear(src, Math.max(0, Math.min(FW - 1, sxf)), Math.max(0, Math.min(FH - 1, syf)));
        const a = c4[3];
        if (a <= 0.04) {
          continue;
        }
        const nz = (h2(X * 1.3 + 0.5, Y * 1.7 + 0.5) - 0.5) * 0.07;
        const r = clamp(c4[0] + nz);
        const g = clamp(c4[1] + nz);
        const b = clamp(c4[2] + nz);
        const col = pal ? PALETTE[pal](r, g, b, ctx) : [r, g, b];
        out[k] = col[0] * 255;
        out[k + 1] = col[1] * 255;
        out[k + 2] = col[2] * 255;
        out[k + 3] = a * 255;
      } else if (aro) {
        const nx = (fpx + 0.5) / PW;
        const ny = (fpy + 0.5) / PH;
        const df =
          DIST.d[Math.max(0, Math.min(PH - 1, Math.round(fpy))) * PW + Math.max(0, Math.min(PW - 1, Math.round(fpx)))];
        const res = AROUND[aro](nx, ny, df, t, ac);
        out[k] = res[0] * 255;
        out[k + 1] = res[1] * 255;
        out[k + 2] = res[2] * 255;
        out[k + 3] = res[3] * 255;
      }
    }
  }
  return { out, OW, OH };
}
const cfgs = [
  { label: "Base (native, no HD)", slots: { palette: "base" }, ss: 1 },
  { label: "Base + HD x3", slots: { palette: "base" }, ss: 3 },
  { label: "Glacier + HD x3", slots: { palette: "glacier" }, ss: 3 },
  { label: "Penta Jewel + HD + Aurora Veil", slots: { palette: "pentajewel", around: "auroraveil" }, ss: 3 },
];
const DISP = 360;
const LAB = 28;
const P = 16;
const COLS = 4;
const cw = COLS * (DISP + P) + P;
const ch = DISP + LAB + P + P + 36;
const cv = createCanvas(cw, ch);
const c = cv.getContext("2d");
c.fillStyle = "#0b0d14";
c.fillRect(0, 0, cw, ch);
c.fillStyle = "#e8ecf6";
c.font = "bold 20px sans-serif";
c.fillText("Hyperpixel HD - pixel subdivision (native vs 3x supersample)", P, 26);
cfgs.forEach((cf, idx) => {
  const { out, OW, OH } = renderHD(cf.slots, 2, cf.ss);
  const sm = createCanvas(OW, OH);
  const smc = sm.getContext("2d");
  const id = smc.createImageData(OW, OH);
  id.data.set(out);
  smc.putImageData(id, 0, 0);
  const x = P + idx * (DISP + P);
  const y = 36;
  c.fillStyle = "#15192a";
  c.fillRect(x, y, DISP, DISP);
  c.imageSmoothingEnabled = false;
  c.drawImage(sm, x, y, DISP, DISP);
  c.fillStyle = "#dfe5f2";
  c.font = "14px sans-serif";
  c.fillText(cf.label, x + 4, y + DISP + 18);
});
fs.writeFileSync("shiny-lab/contact-hd.png", cv.toBuffer("image/png"));
console.log("wrote contact-hd.png");
