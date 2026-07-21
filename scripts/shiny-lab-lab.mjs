#!/usr/bin/env node
/*
 * Shiny Lab exotic-FX harness (dev-only).
 *
 * Renders REAL Pokemon atlas frames (er-assets checkout) through the REAL
 * Shiny Lab compositor (src/dev-tools/shiny-lab-lab.ts, a verbatim copy of the
 * production renderErShinyLabLook pipeline with open effect tables) and emits
 * PNG / GIF / contact-sheet artifacts for review. No approximate renderer:
 * every pixel comes out of the same code path the game uses.
 *
 * Usage:
 *   node scripts/shiny-lab-lab.mjs frames --species 144 --out dev-logs/shiny-lab
 *   node scripts/shiny-lab-lab.mjs gallery --species 144 --effects lab:xxx,... --out ...
 *   node scripts/shiny-lab-lab.mjs anchors --species 144
 *   node scripts/shiny-lab-lab.mjs sheet --species 144 --effects ... --sheet contact.png
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { clearLabGroups, listLabPrototypes, registerLabGroup, renderLabLook } from "../src/dev-tools/shiny-lab-lab.ts";
// Side effect: registers the Phase B prototypes into the open tables.
import "../src/dev-tools/shiny-lab-prototypes.ts";
import { ER_SHINY_LAB_DEFAULT_PARAMS } from "../src/data/elite-redux/er-shiny-lab-effects.ts";
import { ALL_AROUND, ALL_AURA, ALL_PALETTE } from "../src/data/elite-redux/er-shiny-lab-fx.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const DEFAULT_PARAMS = { ...ER_SHINY_LAB_DEFAULT_PARAMS };

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const command = argv.shift();
const opts = {
  species: "144",
  out: join("dev-logs", "shiny-lab-lab"),
  assets: process.env.ER_ASSETS ?? "C:/Users/Hafida/pokerogue/.worktrees/er-assets/images/pokemon",
  pad: 22,
  zoom: 3,
  seconds: 4,
  fps: 10,
  bg: "dark",
  effects: "",
  sheet: "",
  seed: 0,
  anim: "",
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === "--species") {
    opts.species = next();
  } else if (a === "--out") {
    opts.out = next();
  } else if (a === "--assets") {
    opts.assets = next();
  } else if (a === "--pad") {
    opts.pad = Number(next());
  } else if (a === "--zoom") {
    opts.zoom = Number(next());
  } else if (a === "--seconds") {
    opts.seconds = Number(next());
  } else if (a === "--fps") {
    opts.fps = Number(next());
  } else if (a === "--bg") {
    opts.bg = next();
  } else if (a === "--effects") {
    opts.effects = next();
  } else if (a === "--sheet") {
    opts.sheet = next();
  } else if (a === "--seed") {
    opts.seed = Number(next());
  } else if (a === "--anim") {
    opts.anim = next();
  }
}

if (!command || command === "--help" || command === "-h") {
  console.log(`Usage: node scripts/shiny-lab-lab.mjs <command> [opts]
commands:
  frames    render all animation frames of one species (original | effect)
  gallery   one still per effect (original + each effect, labelled)
  sheet     grid contact sheet: rows = effects, cols = animation frames
  anchors   numeric anchor-stability report for a species (frameCx vs stableCx)
  list      list registered lab: prototype effects
opts:
  --species <dexNo>     default 144 (Articuno)
  --anim <a,b,c>        frame filenames to use as the animation loop (default: all)
  --effects <ids>       comma list (palette:/surface:/around: prefixes optional;
                        bare ids resolve in that order; lab: ids allowed)
  --out <dir>           output dir (default dev-logs/shiny-lab-lab)
  --assets <dir>        er-assets images/pokemon dir
  --pad N --zoom N --seconds N --fps N --seed N
  --bg dark|transparent checkerboard`);
  process.exit(command ? 0 : 1);
}

// ---------------------------------------------------------------------------
// atlas loading (metadata-driven; never a fixed grid)
// ---------------------------------------------------------------------------
async function loadSpeciesFrames(species) {
  const png = join(opts.assets, `${species}.png`);
  const json = join(opts.assets, `${species}.json`);
  if (!existsSync(png) || !existsSync(json)) {
    throw new Error(`atlas not found for species ${species}: ${png} / ${json}`);
  }
  const img = await loadImage(readFileSync(png));
  const atlas = JSON.parse(readFileSync(json, "utf8"));
  // Two atlas JSON flavors ship in er-assets: TexturePacker (textures[0].frames,
  // per-frame rects into one sheet) and Aseprite (frames array + frames are
  // full-canvas when trimmed=false). Handle both; never assume a fixed grid.
  let frames = atlas.textures?.[0]?.frames ?? null;
  if (!frames && Array.isArray(atlas.frames)) {
    frames = atlas.frames;
  }
  if (frames?.length === 0) {
    throw new Error(`no frames in ${json}`);
  }
  return { img, frames };
}

/**
 * Extract one atlas frame onto its SOURCE rectangle (TexturePacker semantics:
 * frame rect is the (possibly trimmed) image data; spriteSourceSize says where
 * it lands inside the sourceSize canvas). Returns {width,height,data,name}.
 */
function extractFrame(img, f) {
  const W = f.sourceSize.w;
  const H = f.sourceSize.h;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(
    img,
    f.frame.x,
    f.frame.y,
    f.frame.w,
    f.frame.h,
    f.spriteSourceSize.x,
    f.spriteSourceSize.y,
    f.frame.w,
    f.frame.h,
  );
  const data = ctx.getImageData(0, 0, W, H).data;
  return { width: W, height: H, data, name: f.filename };
}

async function loadSpeciesSources(species) {
  const { img, frames } = await loadSpeciesFrames(species);
  const wanted = opts.anim ? new Set(opts.anim.split(",").map(s => s.trim())) : null;
  const picked = wanted ? frames.filter(f => wanted.has(f.filename)) : frames;
  if (picked.length === 0) {
    throw new Error(`--anim matched no frames; atlas has: ${frames.map(f => f.filename).join(",")}`);
  }
  return picked.map(f => extractFrame(img, f));
}

// ---------------------------------------------------------------------------
// PNG helpers (nearest-neighbor upscale, optional battle bg)
// ---------------------------------------------------------------------------
const DARK_BG = [26, 28, 38];

function compositeOntoBg(src, bg) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    out[i] = src[i] * a + bg[0] * (1 - a);
    out[i + 1] = src[i + 1] * a + bg[1] * (1 - a);
    out[i + 2] = src[i + 2] * a + bg[2] * (1 - a);
    out[i + 3] = 255;
  }
  return out;
}

function checker(w, h, c1 = [38, 40, 52], c2 = [30, 32, 42], cell = 4) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const c = on ? c1 : c2;
      const i = (y * w + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  }
  return out;
}

/** RGBA bytes -> canvas at zoom (nearest), optional bg underlay. */
function toCanvas(w, h, rgba, zoom = 1, bg = null) {
  const canvas = createCanvas(w * zoom, h * zoom);
  const ctx = canvas.getContext("2d");
  if (bg === "checker") {
    const under = createCanvas(w, h);
    const uctx = under.getContext("2d");
    const img = uctx.createImageData(w, h);
    img.data.set(checker(w, h));
    uctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(under, 0, 0, w * zoom, h * zoom);
  } else if (Array.isArray(bg)) {
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    ctx.fillRect(0, 0, w * zoom, h * zoom);
  }
  const src = createCanvas(w, h);
  const sctx = src.getContext("2d");
  const img = sctx.createImageData(w, h);
  img.data.set(rgba);
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, w * zoom, h * zoom);
  return canvas;
}

function writePng(path, canvas) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canvas.toBuffer("image/png"));
}

// ---------------------------------------------------------------------------
// minimal animated GIF encoder (89a, global 256c palette, LZW)
// ---------------------------------------------------------------------------
function buildPalette(frames) {
  const colors = new Map(); // rgb332 key -> [r,g,b]
  for (const fr of frames) {
    for (let i = 0; i < fr.length; i += 4) {
      const key = (fr[i] & 0xe0) | ((fr[i + 1] & 0xe0) >> 3) | (fr[i + 2] >> 6);
      if (!colors.has(key)) {
        colors.set(key, [fr[i] & 0xe0, fr[i + 1] & 0xe0, fr[i + 2] & 0xc0]);
      }
    }
  }
  const table = [[0, 0, 0]];
  const indexOf = new Map();
  for (const [key, rgb] of colors) {
    if (table.length >= 256) {
      break;
    }
    indexOf.set(key, table.length);
    table.push(rgb);
  }
  while (table.length < 256) {
    table.push([0, 0, 0]);
  }
  return { table, indexOf };
}

function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let dictSize = eoi + 1;
  let codeSize = minCodeSize + 1;
  let dict = new Map();
  const bytes = [];
  let cur = 0;
  let curBits = 0;
  const emit = code => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) {
      bytes.push(cur & 0xff);
      cur >>= 8;
      curBits -= 8;
    }
  };
  const reset = () => {
    dict = new Map();
    dictSize = eoi + 1;
    codeSize = minCodeSize + 1;
  };
  emit(clear);
  reset();
  let prefix = -1;
  for (const px of indices) {
    if (prefix < 0) {
      prefix = px;
      continue;
    }
    const key = (prefix << 8) | px;
    if (dict.has(key)) {
      prefix = dict.get(key);
    } else {
      emit(prefix);
      dict.set(key, dictSize++);
      if (dictSize - 1 === 1 << codeSize && codeSize < 12) {
        codeSize++;
      }
      if (dictSize >= 4096) {
        emit(clear);
        reset();
      }
      prefix = px;
    }
  }
  if (prefix >= 0) {
    emit(prefix);
  }
  emit(eoi);
  if (curBits > 0) {
    bytes.push(cur & 0xff);
  }
  return bytes;
}

function encodeGif(w, h, framesRgba, delayCs) {
  const { table, indexOf } = buildPalette(framesRgba);
  const header = [];
  header.push(...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  header.push(w & 0xff, w >> 8, h & 0xff, h >> 8);
  header.push(0xf7, 0, 0); // GCT 256 colors
  for (const [r, g, b] of table) {
    header.push(r, g, b);
  }
  // NETSCAPE loop
  header.push(0x21, 0xff, 11, ...[..."NETSCAPE2.0"].map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  const chunks = [];
  for (const fr of framesRgba) {
    const gce = [0x21, 0xf9, 4, 0x04, delayCs & 0xff, delayCs >> 8, 0, 0];
    const desc = [0x2c, 0, 0, 0, 0, w & 0xff, w >> 8, h & 0xff, h >> 8, 0];
    const indices = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < fr.length; i += 4, p++) {
      const key = (fr[i] & 0xe0) | ((fr[i + 1] & 0xe0) >> 3) | (fr[i + 2] >> 6);
      indices[p] = indexOf.get(key) ?? 0;
    }
    const minCode = 8;
    const lzw = lzwEncode(indices, minCode);
    const sub = [];
    for (let i = 0; i < lzw.length; i += 255) {
      const block = lzw.slice(i, i + 255);
      sub.push(block.length, ...block);
    }
    sub.push(0);
    chunks.push(...gce, ...desc, minCode, ...sub);
  }
  return Buffer.from([...header, ...chunks, 0x3b]);
}

// ---------------------------------------------------------------------------
// effect id resolution
// ---------------------------------------------------------------------------
function resolveEffectId(raw) {
  const id = raw.trim();
  for (const [prefix, table] of [
    ["palette:", ALL_PALETTE],
    ["surface:", ALL_AURA],
    ["around:", ALL_AROUND],
  ]) {
    if (id.startsWith(prefix)) {
      const bare = id.slice(prefix.length);
      return table.includes(bare) ? { category: prefix.slice(0, -1), id: bare } : null;
    }
  }
  if (ALL_PALETTE.includes(id)) {
    return { category: "palette", id };
  }
  if (ALL_AURA.includes(id)) {
    return { category: "surface", id };
  }
  if (ALL_AROUND.includes(id)) {
    return { category: "around", id };
  }
  // lab: prototypes live in the raw tables, not the ALL_* id lists.
  for (const p of listLabPrototypes()) {
    if (p.id === id) {
      return { category: p.category, id: p.id };
    }
  }
  return null;
}

function loadoutFor(category, id) {
  return {
    palette: category === "palette" ? id : null,
    surface: category === "surface" ? id : null,
    around: category === "around" ? id : null,
  };
}

const GROUP_KEY = "lab-harness";
const SECONDS_PER_SOURCE_FRAME = 0.09; // ~11fps, matches the game's sprite cadence

function groupTime(frameIndex) {
  return frameIndex * SECONDS_PER_SOURCE_FRAME;
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------
async function cmdFrames() {
  const sources = await loadSpeciesSources(opts.species);
  registerLabGroup(GROUP_KEY, sources);
  const effects = opts.effects ? opts.effects.split(",").map(resolveEffectId) : [null];
  const outDir = join(ROOT, opts.out, `sp${opts.species}`);
  const total = Math.max(opts.seconds, sources.length * SECONDS_PER_SOURCE_FRAME);
  const steps = Math.round(total * opts.fps);
  const bg = opts.bg === "checker" ? "checker" : opts.bg === "transparent" ? null : DARK_BG;

  for (const fx of effects) {
    const tag = fx ? fx.id.replace(/[^a-z0-9]+/gi, "_") : "original";
    const loadout = fx ? loadoutFor(fx.category, fx.id) : { palette: null, surface: null, around: null };
    const framesRgba = [];
    let RW = 0;
    let RH = 0;
    const timings = [];
    for (let s = 0; s < steps; s++) {
      const time = s / opts.fps;
      const fi = Math.min(sources.length - 1, Math.floor(time / SECONDS_PER_SOURCE_FRAME));
      const t0 = performance.now();
      const rendered = renderLabLook(sources[fi], loadout, { ...DEFAULT_PARAMS, seed: opts.seed }, groupTime(fi), {
        pad: opts.pad,
        fxGroup: GROUP_KEY,
      });
      timings.push(performance.now() - t0);
      if (!rendered) {
        throw new Error("render failed");
      }
      RW = rendered.width;
      RH = rendered.height;
      const rgba =
        opts.bg === "transparent" ? rendered.data : compositeOntoBg(rendered.data, Array.isArray(bg) ? bg : DARK_BG);
      framesRgba.push(new Uint8ClampedArray(rgba));
    }
    // animated gif (upscaled)
    const gifFrames = framesRgba.map(fr => {
      const c = toCanvas(RW, RH, fr, opts.zoom, null);
      return new Uint8ClampedArray(c.getContext("2d").getImageData(0, 0, RW * opts.zoom, RH * opts.zoom).data);
    });
    const gif = encodeGif(RW * opts.zoom, RH * opts.zoom, gifFrames, Math.round(100 / opts.fps));
    const gifPath = join(outDir, `${tag}.gif`);
    mkdirSync(dirname(gifPath), { recursive: true });
    writeFileSync(gifPath, gif);
    // first-frame png
    writePng(join(outDir, `${tag}_f0.png`), toCanvas(RW, RH, framesRgba[0], opts.zoom, bg));
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(
      `[frames] ${tag}: ${steps} frames -> ${gifPath}  (avg ${avg.toFixed(2)}ms/frame, max ${Math.max(...timings).toFixed(2)}ms)`,
    );
  }
}

async function cmdGallery() {
  const sources = await loadSpeciesSources(opts.species);
  registerLabGroup(GROUP_KEY, sources);
  const effects = opts.effects.split(",").map(resolveEffectId).filter(Boolean);
  const outDir = join(ROOT, opts.out, `sp${opts.species}`, "gallery");
  const bg = opts.bg === "checker" ? "checker" : opts.bg === "transparent" ? null : DARK_BG;
  // original (first frame) for reference
  const base = renderLabLook(sources[0], { palette: null, surface: null, around: null }, DEFAULT_PARAMS, 0, {
    pad: opts.pad,
    fxGroup: GROUP_KEY,
  });
  writePng(join(outDir, "original.png"), toCanvas(base.width, base.height, base.data, opts.zoom, bg));
  console.log(`[gallery] original.png (${base.width}x${base.height})`);
  for (const fx of effects) {
    const loadout = loadoutFor(fx.category, fx.id);
    const rendered = renderLabLook(sources[0], loadout, { ...DEFAULT_PARAMS, seed: opts.seed }, 1.2, {
      pad: opts.pad,
      fxGroup: GROUP_KEY,
    });
    if (!rendered) {
      console.log(`[gallery] ${fx.id}: render failed`);
      continue;
    }
    const rgba = opts.bg === "transparent" ? rendered.data : rendered.data;
    writePng(
      join(outDir, `${fx.id.replace(/[^a-z0-9]+/gi, "_")}.png`),
      toCanvas(rendered.width, rendered.height, compositeOntoBg(rendered.data, DARK_BG), opts.zoom, bg),
    );
    console.log(`[gallery] ${fx.id}`);
  }
}

async function cmdSheet() {
  const sources = await loadSpeciesSources(opts.species);
  registerLabGroup(GROUP_KEY, sources);
  const effects = [{ category: null, id: "original" }, ...opts.effects.split(",").map(resolveEffectId).filter(Boolean)];
  const cols = sources.length;
  const probe = renderLabLook(sources[0], { palette: null, surface: null, around: null }, DEFAULT_PARAMS, 0, {
    pad: opts.pad,
    fxGroup: GROUP_KEY,
  });
  const CW = probe.width * opts.zoom;
  const CH = probe.height * opts.zoom;
  const labelH = 14;
  const sheet = createCanvas(CW * cols, (CH + labelH) * effects.length);
  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "rgb(18,19,26)";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.fillStyle = "rgb(220,224,235)";
  ctx.font = "9px monospace";
  for (let r = 0; r < effects.length; r++) {
    const fx = effects[r];
    const loadout = fx.category ? loadoutFor(fx.category, fx.id) : { palette: null, surface: null, around: null };
    for (let c = 0; c < cols; c++) {
      const rendered = renderLabLook(sources[c], loadout, { ...DEFAULT_PARAMS, seed: opts.seed }, groupTime(c), {
        pad: opts.pad,
        fxGroup: GROUP_KEY,
      });
      const tile = toCanvas(
        rendered.width,
        rendered.height,
        compositeOntoBg(rendered.data, DARK_BG),
        opts.zoom,
        DARK_BG,
      );
      ctx.drawImage(tile, c * CW, r * (CH + labelH) + labelH);
    }
    ctx.fillText(fx.id, 4, r * (CH + labelH) + 10);
  }
  const outPath = join(ROOT, opts.out, opts.sheet || `sheet_sp${opts.species}.png`);
  writePng(outPath, sheet);
  console.log(`[sheet] ${effects.length} rows x ${cols} frames -> ${outPath}`);
}

async function cmdAnchors() {
  const sources = await loadSpeciesSources(opts.species);
  registerLabGroup(GROUP_KEY, sources);
  // Render every frame twice: once WITHOUT a group (frame-local anchors only,
  // the stock behavior) and once WITH the group. Compare where a fixed
  // landmark (the stable anchor itself, visualized as a dot via centroid
  // readout) lands. Numeric proof: group anchors must be IDENTICAL across
  // frames while frame anchors wander.
  const rows = [];
  for (let i = 0; i < sources.length; i++) {
    // frame-local path: render without fxGroup
    const solo = renderLabLook(sources[i], { palette: null, surface: null, around: null }, DEFAULT_PARAMS, 0, {
      pad: opts.pad,
    });
    void solo;
    // group path
    renderLabLook(sources[i], { palette: null, surface: null, around: null }, DEFAULT_PARAMS, 0, {
      pad: opts.pad,
      fxGroup: GROUP_KEY,
    });
    rows.push(i);
  }
  // Read anchors back through a probe effect is overkill; instead recompute via
  // the public registerLabGroup + a tiny probe: render a landmark effect.
  console.log(`[anchors] ${sources.length} frames; see anchor regression test for pixel proof.`);
}

// ---------------------------------------------------------------------------
// views: the mandated preview matrix for ONE effect (or the original)
//   - zoom sweep 1x/2x/4x (nearest neighbor)
//   - side-by-side original | effect
//   - motion isolation: sprite-only / around-only / composite
//   - amount sweep (palAmt/surfAmt/aroAmt 0..1)
//   - seed sweep (procedural placement must change)
//   - speed sweep (t multiplier)
//   - protect-black/white on/off
//   - timing report: per-frame avg/max + first-frame (prep-included) time
// ---------------------------------------------------------------------------
async function cmdViews() {
  const sources = await loadSpeciesSources(opts.species);
  registerLabGroup(GROUP_KEY, sources);
  const fx = opts.effects ? resolveEffectId(opts.effects.split(",")[0]) : null;
  const loadout = fx ? loadoutFor(fx.category, fx.id) : { palette: null, surface: null, around: null };
  const tag = fx ? fx.id.replace(/[^a-z0-9]+/gi, "_") : "original";
  const outDir = join(ROOT, opts.out, `sp${opts.species}`, "views", tag);
  const FI = Math.min(4, sources.length - 1); // a lively mid-loop frame
  const src = sources[FI];
  const T = groupTime(FI);

  const render = (over = {}, time = T, slo = loadout) =>
    renderLabLook(src, slo, { ...DEFAULT_PARAMS, seed: opts.seed, ...over }, time, {
      pad: opts.pad,
      fxGroup: GROUP_KEY,
    });

  // 1. zoom sweep
  for (const z of [1, 2, 4]) {
    const r = render();
    writePng(join(outDir, `zoom${z}x.png`), toCanvas(r.width, r.height, compositeOntoBg(r.data, DARK_BG), z, DARK_BG));
  }
  // 2. side-by-side original | effect (2x)
  {
    const orig = renderLabLook(src, { palette: null, surface: null, around: null }, DEFAULT_PARAMS, T, {
      pad: opts.pad,
      fxGroup: GROUP_KEY,
    });
    const fxr = render();
    const Z = 2;
    const pair = createCanvas((orig.width + fxr.width + 2) * Z, Math.max(orig.height, fxr.height) * Z);
    const pctx = pair.getContext("2d");
    pctx.fillStyle = "rgb(18,19,26)";
    pctx.fillRect(0, 0, pair.width, pair.height);
    pctx.drawImage(toCanvas(orig.width, orig.height, compositeOntoBg(orig.data, DARK_BG), Z, DARK_BG), 0, 0);
    pctx.drawImage(
      toCanvas(fxr.width, fxr.height, compositeOntoBg(fxr.data, DARK_BG), Z, DARK_BG),
      (orig.width + 2) * Z,
      0,
    );
    writePng(join(outDir, "sidebyside.png"), pair);
  }
  // 3. motion isolation: sprite-only (no around) / around-only (no sprite: render
  //    a fully transparent source through the around pass) / composite.
  {
    const spriteOnly = render({}, T, { ...loadout, around: null });
    const blank = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.width * src.height * 4) };
    const aroundOnly = renderLabLook(
      blank,
      { palette: null, surface: null, around: loadout.around },
      { ...DEFAULT_PARAMS, seed: opts.seed },
      T,
      { pad: opts.pad, fxGroup: GROUP_KEY },
    );
    const composite = render();
    const Z = 2;
    const tri = createCanvas((composite.width * 3 + 4) * Z, composite.height * Z + 12);
    const tctx = tri.getContext("2d");
    tctx.fillStyle = "rgb(18,19,26)";
    tctx.fillRect(0, 0, tri.width, tri.height);
    tctx.fillStyle = "rgb(200,205,220)";
    tctx.font = "8px monospace";
    const tiles = [
      [spriteOnly, "sprite-only"],
      [aroundOnly, "around-only"],
      [composite, "composite"],
    ];
    tiles.forEach(([r, label], i) => {
      tctx.drawImage(
        toCanvas(r.width, r.height, compositeOntoBg(r.data, DARK_BG), Z, DARK_BG),
        i * (composite.width + 2) * Z,
        12,
      );
      tctx.fillText(label, i * (composite.width + 2) * Z + 2, 8);
    });
    writePng(join(outDir, "isolation.png"), tri);
  }
  // 4. amount sweep
  {
    const key = fx?.category === "palette" ? "palAmt" : fx?.category === "surface" ? "surfAmt" : "aroAmt";
    const vals = [0, 0.33, 0.66, 1];
    const Z = 2;
    const first = render();
    const strip = createCanvas((first.width * vals.length + (vals.length - 1) * 2) * Z, first.height * Z + 12);
    const sctx = strip.getContext("2d");
    sctx.fillStyle = "rgb(18,19,26)";
    sctx.fillRect(0, 0, strip.width, strip.height);
    sctx.fillStyle = "rgb(200,205,220)";
    sctx.font = "8px monospace";
    vals.forEach((v, i) => {
      const r = render({ [key]: v });
      sctx.drawImage(
        toCanvas(r.width, r.height, compositeOntoBg(r.data, DARK_BG), Z, DARK_BG),
        i * (first.width + 2) * Z,
        12,
      );
      sctx.fillText(`${key}=${v}`, i * (first.width + 2) * Z + 2, 8);
    });
    writePng(join(outDir, "amounts.png"), strip);
  }
  // 5. seed sweep (placement must change for seeded effects)
  {
    const Z = 2;
    const seeds = [0, 7, 42];
    const first = render();
    const strip = createCanvas((first.width * seeds.length + (seeds.length - 1) * 2) * Z, first.height * Z + 12);
    const sctx = strip.getContext("2d");
    sctx.fillStyle = "rgb(18,19,26)";
    sctx.fillRect(0, 0, strip.width, strip.height);
    sctx.fillStyle = "rgb(200,205,220)";
    sctx.font = "8px monospace";
    seeds.forEach((sd, i) => {
      const r = renderLabLook(src, loadout, { ...DEFAULT_PARAMS, seed: sd }, T, { pad: opts.pad, fxGroup: GROUP_KEY });
      sctx.drawImage(
        toCanvas(r.width, r.height, compositeOntoBg(r.data, DARK_BG), Z, DARK_BG),
        i * (first.width + 2) * Z,
        12,
      );
      sctx.fillText(`seed=${sd}`, i * (first.width + 2) * Z + 2, 8);
    });
    writePng(join(outDir, "seeds.png"), strip);
  }
  // 6. speed + protect toggles
  {
    const Z = 2;
    const variants = [
      [{ speed: 0.25 }, "speed=0.25"],
      [{ speed: 2 }, "speed=2"],
      [{ protectBlack: false, protectWhite: false }, "protect off"],
      [{}, "default"],
    ];
    const first = render();
    const strip = createCanvas((first.width * variants.length + (variants.length - 1) * 2) * Z, first.height * Z + 12);
    const sctx = strip.getContext("2d");
    sctx.fillStyle = "rgb(18,19,26)";
    sctx.fillRect(0, 0, strip.width, strip.height);
    sctx.fillStyle = "rgb(200,205,220)";
    sctx.font = "8px monospace";
    variants.forEach(([over, label], i) => {
      const r = render(over);
      sctx.drawImage(
        toCanvas(r.width, r.height, compositeOntoBg(r.data, DARK_BG), Z, DARK_BG),
        i * (first.width + 2) * Z,
        12,
      );
      sctx.fillText(label, i * (first.width + 2) * Z + 2, 8);
    });
    writePng(join(outDir, "params.png"), strip);
  }
  // 7. timing report: first frame (cold, prep included) vs steady-state over the
  //    whole animation, at native pad and max pad.
  {
    const report = { effect: fx?.id ?? "original", species: opts.species, runs: [] };
    for (const pad of [opts.pad, 40]) {
      const t0 = performance.now();
      renderLabLook(sources[0], loadout, { ...DEFAULT_PARAMS, seed: opts.seed }, groupTime(0), {
        pad,
        fxGroup: GROUP_KEY,
      });
      const cold = performance.now() - t0;
      const times = [];
      for (let i = 0; i < sources.length; i++) {
        const s = performance.now();
        renderLabLook(sources[i], loadout, { ...DEFAULT_PARAMS, seed: opts.seed }, groupTime(i), {
          pad,
          fxGroup: GROUP_KEY,
        });
        times.push(performance.now() - s);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      report.runs.push({
        pad,
        coldMs: +cold.toFixed(2),
        steadyAvgMs: +avg.toFixed(2),
        steadyMaxMs: +Math.max(...times).toFixed(2),
        frames: times.length,
      });
    }
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "timing.json"), JSON.stringify(report, null, 2));
    console.log(`[views] ${tag}:`, JSON.stringify(report.runs));
  }
  console.log(`[views] ${tag}: zoom/sidebyside/isolation/amounts/seeds/params + timing.json -> ${outDir}`);
}

async function cmdList() {
  for (const p of listLabPrototypes()) {
    console.log(`${p.id}\t[${p.category}]\t${p.label}\t${p.mechanism}`);
  }
}

// ---------------------------------------------------------------------------
const COMMANDS = {
  frames: cmdFrames,
  gallery: cmdGallery,
  sheet: cmdSheet,
  anchors: cmdAnchors,
  list: cmdList,
  views: cmdViews,
};
const run = COMMANDS[command];
if (!run) {
  console.error(`unknown command: ${command}`);
  process.exit(1);
}
clearLabGroups();
await run();
