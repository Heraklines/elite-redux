// One-off: add a "pb_black" frame (black-topped Poke Ball) to the er-assets items
// atlas, recolored from the existing "pb" frame. Extends the atlas by one frame-
// height row so NO existing frame's pixels or coords change. Reversible via
// `git -C ../er-assets checkout images/items.png images/items.json` until pushed.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const DIR = "C:/Users/Hafida/pokerogue/.worktrees/er-assets/images";
const PNG = `${DIR}/items.png`;
const JSONF = `${DIR}/items.json`;

const json = JSON.parse(readFileSync(JSONF, "utf8"));
const tex = json.textures[0];
const frames = tex.frames;
const pb = frames.find(f => f.filename === "pb");
if (!pb) {
  throw new Error("pb frame not found");
}
if (frames.some(f => f.filename === "pb_black")) {
  console.log("pb_black already exists; aborting (re-run after a git checkout to redo)");
  process.exit(0);
}

const img = await loadImage(PNG);
const { x, y, w, h } = pb.frame;

// Extract pb, recolor red-dominant pixels to near-black (luminance-scaled so the
// ball keeps its shading); white base / black band / button are left alone.
const cell = createCanvas(w, h);
const cctx = cell.getContext("2d");
cctx.drawImage(img, x, y, w, h, 0, 0, w, h);
const id = cctx.getImageData(0, 0, w, h);
const d = id.data;
let recolored = 0;
for (let i = 0; i < d.length; i += 4) {
  const r = d[i];
  const g = d[i + 1];
  const b = d[i + 2];
  const a = d[i + 3];
  if (a > 0 && r > 90 && r >= g + 35 && r >= b + 35) {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = Math.max(0, Math.min(255, Math.round(lum * 0.22)));
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    recolored++;
  }
}
cctx.putImageData(id, 0, 0);

// Extend the atlas by h rows; place pb_black at (0, oldHeight) in fresh space.
const oldW = img.width;
const oldH = img.height;
const out = createCanvas(oldW, oldH + h);
const octx = out.getContext("2d");
octx.drawImage(img, 0, 0);
octx.drawImage(cell, 0, oldH);

const pbBlack = JSON.parse(JSON.stringify(pb));
pbBlack.filename = "pb_black";
pbBlack.frame = { x: 0, y: oldH, w, h };
frames.push(pbBlack);
tex.size = { w: oldW, h: oldH + h };

writeFileSync(PNG, out.toBuffer("image/png"));
writeFileSync(JSONF, `${JSON.stringify(json, null, "\t")}\n`);
console.log(
  `pb_black added: recolored ${recolored}px, atlas ${oldW}x${oldH} -> ${oldW}x${oldH + h}, frame (0,${oldH})`,
);

// Verify render: original pb | pb_black, 8x, side by side.
const SC = 8;
const v = createCanvas(w * SC * 2 + 16, h * SC);
const vc = v.getContext("2d");
vc.fillStyle = "#777777";
vc.fillRect(0, 0, v.width, v.height);
vc.imageSmoothingEnabled = false;
vc.drawImage(img, x, y, w, h, 0, 0, w * SC, h * SC);
vc.drawImage(cell, 0, 0, w, h, w * SC + 16, 0, w * SC, h * SC);
const outDir = "C:/Users/Hafida/pokerogue/.worktrees/elite-redux/dev-logs/sprite-renders";
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/pb_black_verify.png`, v.toBuffer("image/png"));
console.log("verify -> dev-logs/sprite-renders/pb_black_verify.png (left: pb, right: pb_black)");
