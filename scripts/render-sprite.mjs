#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
/*
 * Tier-2 pixel harness: REAL-pixel sprite rasterizer (no browser, no game boot).
 *
 * Decodes a sprite's REAL atlas frame from the local er-assets / public checkout,
 * writes the cropped frame to a PNG, and analyzes the pixels - catching the
 * "visual" bug classes that need actual pixels rather than data:
 *   - missing / empty sprite (fully transparent)            -> #107 / placeholder
 *   - green-box / solid background (no transparency)         -> #134 / #284
 *   - flat single-colour fill (placeholder / wrong tint)     -> #393 black-shiny tint
 *   - wrong dimensions
 * It does NOT composite a full screen (the headless harness mocks rendering away,
 * discarding transforms; the real renderer needs the browser client). This is the
 * sprite-level pixel check - fast (sub-second, no Phaser boot) and faithful (the
 * exact bytes the game ships from er-assets).
 *
 * Usage:
 *   node scripts/render-sprite.mjs <atlas-path | slug | dexNo> [--back] [--black] [--frame N] [--out file.png]
 *
 * Examples:
 *   node scripts/render-sprite.mjs elite-redux/rattata_redux/front   # the Tier-1 spriteAtlas value
 *   node scripts/render-sprite.mjs rattata_redux                     # bare ER slug -> front
 *   node scripts/render-sprite.mjs rattata_redux --black             # black-shiny variant (#393)
 *   node scripts/render-sprite.mjs 25                                # a vanilla dex sprite
 *
 * Feed it the `spriteAtlas` value the Tier-1 UI runner prints (run-ui-scenario.mjs),
 * or a bare ER slug. Output PNG lands under dev-logs/sprite-renders/ (gitignored).
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  console.log(
    "Usage: node scripts/render-sprite.mjs <atlas-path | slug | dexNo> [--back] [--black] [--frame N] [--out file.png]",
  );
  process.exit(argv.length === 0 ? 1 : 0);
}

let input;
let back = false;
let black = false;
let frameIdx = 0;
let outPath;
const rest = [...argv];
while (rest.length > 0) {
  const a = rest.shift();
  if (a === "--back") {
    back = true;
  } else if (a === "--black") {
    black = true;
  } else if (a === "--frame") {
    frameIdx = Number(rest.shift()) || 0;
  } else if (a === "--out") {
    outPath = rest.shift();
  } else if (a.startsWith("--")) {
    console.error(`unknown arg: ${a}`);
    process.exit(1);
  } else {
    input = a;
  }
}

const ROOTS = ["../er-assets/images/pokemon", "public/images/pokemon"];
const view = back ? "back" : "front";

/** Build the candidate relative paths (without extension) for this input + flags. */
function candidates(token) {
  const rels = [];
  const withBlack = p => (black ? `black/${p}` : p);
  if (token.includes("/")) {
    // An atlas path like "elite-redux/rattata_redux/front" (the Tier-1 value).
    rels.push(withBlack(token));
  } else if (/^\d+$/.test(token)) {
    // A vanilla dex number sprite (images/pokemon/<id>).
    rels.push(withBlack(token));
    rels.push(withBlack(`variant/${token}`));
  } else {
    // A bare ER slug -> elite-redux/<slug>/<view>.
    rels.push(withBlack(`elite-redux/${token}/${view}`));
    rels.push(withBlack(token));
  }
  return rels;
}

/** Find the first existing <root>/<rel>.png; returns {png, json} or null. */
function resolveAtlas(token) {
  for (const root of ROOTS) {
    for (const rel of candidates(token)) {
      const png = join(root, `${rel}.png`);
      if (existsSync(png)) {
        const json = join(root, `${rel}.json`);
        return { png, json: existsSync(json) ? json : null };
      }
    }
  }
  return null;
}

const resolved = resolveAtlas(input);
if (!resolved) {
  console.error(`ERROR: no sprite found for "${input}". Tried:`);
  for (const root of ROOTS) {
    for (const rel of candidates(input)) {
      console.error(`  ${join(root, `${rel}.png`)}`);
    }
  }
  process.exit(2);
}

const img = await loadImage(resolved.png);

// Frame rect: from the atlas JSON (Phaser multiatlas) if present, else the whole image.
let frame = { x: 0, y: 0, w: img.width, h: img.height };
let frameCount = 1;
if (resolved.json) {
  try {
    const atlas = JSON.parse(readFileSync(resolved.json, "utf8"));
    const frames = atlas.textures?.[0]?.frames ?? atlas.frames ?? [];
    frameCount = Array.isArray(frames) ? frames.length : Object.keys(frames).length;
    const f = Array.isArray(frames) ? frames[frameIdx] : Object.values(frames)[frameIdx];
    if (f?.frame) {
      frame = f.frame;
    }
  } catch (e) {
    console.error(`(warning) could not parse atlas json: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Crop the frame onto its own canvas.
const out = createCanvas(frame.w, frame.h);
const octx = out.getContext("2d");
octx.drawImage(img, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);

// --- Pixel analysis ---------------------------------------------------------
const { data } = octx.getImageData(0, 0, frame.w, frame.h);
const total = frame.w * frame.h;
let transparent = 0;
const colorCounts = new Map();
for (let i = 0; i < data.length; i += 4) {
  const a = data[i + 3];
  if (a === 0) {
    transparent++;
    continue;
  }
  const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
  colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
}
const nonTransparent = total - transparent;
let domColor = "";
let domCount = 0;
for (const [k, n] of colorCounts) {
  if (n > domCount) {
    domCount = n;
    domColor = k;
  }
}
const toHex = csv =>
  "#"
  + csv
    .split(",")
    .map(n => Number(n).toString(16).padStart(2, "0"))
    .join("");
const pct = n => Math.round((n / total) * 1000) / 10;

// Corner test: a sprite should have transparent corners; 4 matching OPAQUE corners
// => a solid background box (the green-box / dark-box class).
const cornerAt = (x, y) => {
  const o = (y * frame.w + x) * 4;
  return `${data[o]},${data[o + 1]},${data[o + 2]},${data[o + 3]}`;
};
const corners = [
  cornerAt(0, 0),
  cornerAt(frame.w - 1, 0),
  cornerAt(0, frame.h - 1),
  cornerAt(frame.w - 1, frame.h - 1),
];
const cornersOpaqueUniform = corners.every(c => c === corners[0] && c.endsWith(",255"));

const transparentPct = pct(transparent);
const domPctOfNonTransparent = nonTransparent > 0 ? Math.round((domCount / nonTransparent) * 1000) / 10 : 0;

let verdict = "ok";
if (transparentPct >= 99) {
  verdict = "EMPTY / missing sprite (fully transparent)";
} else if (transparent === 0) {
  verdict = "NO TRANSPARENCY - solid background (green/dark-box class)";
} else if (cornersOpaqueUniform) {
  verdict = `BOXED - 4 opaque matching corners ${toHex(corners[0].split(",").slice(0, 3).join(","))} (green/dark-box class)`;
} else if (domPctOfNonTransparent >= 92) {
  verdict = `FLAT FILL - one colour ${toHex(domColor)} is ${domPctOfNonTransparent}% of the sprite (placeholder / wrong tint)`;
}

outPath ??= join(
  "dev-logs",
  "sprite-renders",
  `${input.replace(/[^a-z0-9]+/gi, "_")}${black ? "_black" : ""}_${view}.png`,
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out.toBuffer("image/png"));

console.log("SOURCE", resolved.png);
console.log(
  "ANALYSIS",
  JSON.stringify({
    input,
    view,
    black,
    frame: `${frameIdx}/${frameCount}`,
    dims: `${frame.w}x${frame.h}`,
    transparentPct,
    dominantColor: toHex(domColor),
    dominantPctOfSprite: domPctOfNonTransparent,
    cornersOpaqueUniform,
    verdict,
  }),
);
console.log("WROTE", outPath);
if (verdict !== "ok") {
  console.log(`\n! ${verdict}`);
}
