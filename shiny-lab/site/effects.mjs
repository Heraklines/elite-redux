/* Shiny Lab - EFFECTS lab (category-based in-game effect previews).
 *
 * A SEPARATE view from the shiny tools: a top-level "Effects" button opens a
 * category-based lab. Categories live in a small REGISTRY (FX_CATEGORIES) so a
 * future category (ability effects, move effects) is ONE new entry, not a new
 * page. The only category today is Transformation Effects: it previews the FULL
 * in-game transform SEQUENCE from one partner Eeveelution into another -
 *   1) FILL   - the source form floods with the TARGET type's light until the
 *               whole body is a solid glowing silhouette (schooling-flash style,
 *               but in the target type's colour).
 *   2) MORPH  - that glowing silhouette's SHAPE flows from the source form's
 *               outline into the target form's outline via a signed-distance-field
 *               interpolation (a real shape morph, NOT a crossfade). The SDF is
 *               built with the same two-pass chamfer technique fx.mjs computeDist
 *               uses for the around-FX silhouette fields.
 *   3) REVEAL - the per-type burst (a faithful canvas-2D port of
 *               src/sprites/er-form-transform-fx.ts) fires as the fill drains and
 *               the target form's real sprite is revealed underneath.
 * The burst always types from the TARGET form (Eevee -> Jolteon = electric),
 * matching the in-game rule.
 *
 * Runs in the same concatenated <script> as fx.mjs / exotic.mjs / app.js, so it
 * reuses CDN / loadImg / parseFrames defined in app.js. All names here are fx-
 * prefixed to avoid clashing with the shiny renderer's globals. */

// ---- per-type config (ported verbatim from er-form-transform-fx.ts) ----------
const FX_TOTAL_MS = 950; // ER_TRANSFORM_FX_TOTAL_MS (the snappy burst portion)
const FX_MAX_PARTICLES = 20; // ER_TRANSFORM_FX_MAX_PARTICLES

// getTypeRgb(type) from src/data/type.ts - the canonical type light tint.
const FX_TYPE_RGB = {
  NORMAL: [168, 168, 120],
  FIGHTING: [192, 48, 40],
  FLYING: [168, 144, 240],
  POISON: [160, 64, 160],
  GROUND: [224, 192, 104],
  ROCK: [184, 160, 56],
  BUG: [168, 184, 32],
  GHOST: [112, 88, 152],
  STEEL: [184, 184, 208],
  FIRE: [240, 128, 48],
  WATER: [104, 144, 240],
  GRASS: [120, 200, 80],
  ELECTRIC: [248, 208, 48],
  PSYCHIC: [248, 88, 136],
  ICE: [152, 216, 216],
  DRAGON: [112, 56, 248],
  DARK: [112, 88, 72],
  FAIRY: [232, 136, 200],
  STELLAR: [255, 255, 255],
};

// TYPE_FX_PRESETS from er-form-transform-fx.ts (shape/motion/count/spin/spread/size).
const FX_TYPE_PRESETS = {
  GRASS: { shape: "leaf", motion: "sway", count: 14, spin: 220, spread: 46, size: 6 },
  BUG: { shape: "leaf", motion: "sway", count: 14, spin: 200, spread: 44, size: 5 },
  FLYING: { shape: "leaf", motion: "rise", count: 14, spin: 160, spread: 48, size: 6 },
  FIRE: { shape: "ember", motion: "rise", count: 16, spin: 60, spread: 40, size: 5 },
  WATER: { shape: "droplet", motion: "fall", count: 16, spin: 40, spread: 44, size: 5 },
  ICE: { shape: "shard", motion: "fall", count: 14, spin: 90, spread: 42, size: 5 },
  ELECTRIC: { shape: "spark", motion: "burst", count: 18, spin: 0, spread: 52, size: 6 },
  STEEL: { shape: "shard", motion: "burst", count: 14, spin: 120, spread: 46, size: 5 },
  ROCK: { shape: "shard", motion: "burst", count: 14, spin: 140, spread: 44, size: 6 },
  GROUND: { shape: "shard", motion: "fall", count: 14, spin: 80, spread: 42, size: 6 },
  POISON: { shape: "mote", motion: "rise", count: 15, spin: 40, spread: 40, size: 5 },
  FAIRY: { shape: "mote", motion: "sway", count: 16, spin: 120, spread: 44, size: 5 },
  PSYCHIC: { shape: "mote", motion: "burst", count: 16, spin: 60, spread: 48, size: 5 },
  GHOST: { shape: "mote", motion: "rise", count: 14, spin: 60, spread: 42, size: 5 },
  DARK: { shape: "mote", motion: "burst", count: 14, spin: 40, spread: 42, size: 5 },
  DRAGON: { shape: "spark", motion: "burst", count: 16, spin: 20, spread: 50, size: 6 },
  FIGHTING: { shape: "spark", motion: "burst", count: 15, spin: 20, spread: 46, size: 5 },
  NORMAL: { shape: "mote", motion: "burst", count: 14, spin: 0, spread: 42, size: 5 },
};
// FALLBACK_PRESET for unmapped types (neutral motes).
const FX_FALLBACK_PRESET = { shape: "mote", motion: "burst", count: 14, spin: 0, spread: 42, size: 5 };

// getErTransformTypeFx: resolve the per-type config (tint + bounded preset).
function fxTypeConfig(type) {
  const preset = FX_TYPE_PRESETS[type] || FX_FALLBACK_PRESET;
  let rgb = FX_TYPE_RGB[type] || [0, 0, 0];
  if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) {
    rgb = [255, 255, 255]; // transformTintRgb fallback so the flash always reads
  }
  const count = Math.max(1, Math.min(FX_MAX_PARTICLES, preset.count));
  return { rgb, shape: preset.shape, motion: preset.motion, count, spin: preset.spin, spread: preset.spread, size: preset.size };
}

// ---- partner roster ----------------------------------------------------------
// Mirrors ER_PARTNER_FAMILY (src/data/elite-redux/er-newcomer-species.ts): each
// partner eeveelution ALIASES its base eeveelution's vanilla art (numeric dex
// sprite), so the site resolves the sprite exactly like every other feature
// (numeric stem, or the Eevee "partner" FORM stem for the family head). `type`
// is the family mapType = the primary type the burst is themed by.
const FX_PARTNERS = [
  { name: "Partner Eevee", stem: "133-partner", type: "NORMAL" },
  { name: "Partner Vaporeon", stem: 134, type: "WATER" },
  { name: "Partner Jolteon", stem: 135, type: "ELECTRIC" },
  { name: "Partner Flareon", stem: 136, type: "FIRE" },
  { name: "Partner Espeon", stem: 196, type: "PSYCHIC" },
  { name: "Partner Umbreon", stem: 197, type: "DARK" },
  { name: "Partner Leafeon", stem: 470, type: "GRASS" },
  { name: "Partner Glaceon", stem: 471, type: "ICE" },
  { name: "Partner Sylveon", stem: 700, type: "FAIRY" },
];

// ---- easing (matches the Phaser eases the in-game tweens use) -----------------
const FX_EASE = {
  quadOut: t => 1 - (1 - t) * (1 - t),
  cubicOut: t => 1 - Math.pow(1 - t, 3),
  sineOut: t => Math.sin((t * Math.PI) / 2),
  quadIn: t => t * t,
};
const fxSmooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const fxRgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// A soft additive light blob (the ADD ellipses in-game read as light; a radial
// gradient renders that "type-coloured light" cleanly on canvas-2D).
function fxGlow(ctx, x, y, rx, ry, color, alpha) {
  if (alpha <= 0) {
    return;
  }
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry, 0.01));
  // Bright, near-solid core (like the in-game ADD-blended ellipse) softening to a halo.
  g.addColorStop(0, fxRgba(color, alpha));
  g.addColorStop(0.35, fxRgba(color, alpha * 0.85));
  g.addColorStop(0.7, fxRgba(color, alpha * 0.35));
  g.addColorStop(1, fxRgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ---- sprite loading (FRONT = CDN, BACK = CDN/back) ---------------------------
const fxSpriteCache = new Map();
async function fxLoadSprite(stem, back) {
  const key = `${back ? "b" : "f"}:${stem}`;
  if (fxSpriteCache.has(key)) {
    return fxSpriteCache.get(key);
  }
  const dir = back ? `${CDN}/back` : CDN;
  const atlas = await fetch(`${dir}/${stem}.json`).then(r => {
    if (!r.ok) {
      throw new Error("no atlas");
    }
    return r.json();
  });
  const fr = parseFrames(atlas)[0];
  const img = await loadImg(`${dir}/${stem}.png`);
  const w = (fr.sourceSize && fr.sourceSize.w) || fr.frame.w;
  const h = (fr.sourceSize && fr.sourceSize.h) || fr.frame.h;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const sss = fr.spriteSourceSize || { x: 0, y: 0 };
  cv.getContext("2d", { willReadFrequently: true }).drawImage(
    img,
    fr.frame.x,
    fr.frame.y,
    fr.frame.w,
    fr.frame.h,
    sss.x,
    sss.y,
    fr.frame.w,
    fr.frame.h,
  );
  const rec = { cv, w, h };
  fxSpriteCache.set(key, rec);
  return rec;
}

// A type-colour silhouette of the sprite (for the on-sprite flash/tint pass).
const fxTintCache = new Map();
function fxTintSprite(spriteCv, color) {
  const key = `${spriteCv.width}x${spriteCv.height}:${color.join(",")}`;
  if (fxTintCache.has(key)) {
    return fxTintCache.get(key);
  }
  const cv = document.createElement("canvas");
  cv.width = spriteCv.width;
  cv.height = spriteCv.height;
  const c = cv.getContext("2d");
  c.drawImage(spriteCv, 0, 0);
  c.globalCompositeOperation = "source-in";
  c.fillStyle = fxRgba(color, 1);
  c.fillRect(0, 0, cv.width, cv.height);
  fxTintCache.set(key, cv);
  return cv;
}

// ---- signed distance field morph (reuses fx.mjs computeDist's chamfer) --------
const FX_PAD = 72; // room around the sprite so particles never clip the canvas

// Two-pass chamfer distance transform (the SAME (1, sqrt2) sweep computeDist runs
// in fx.mjs). Seeds are 0 / INF; result is the px distance to the nearest seed.
function fxChamfer(d, W, H) {
  const A = 1;
  const B = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = d[y * W + x];
      if (x > 0) {
        v = Math.min(v, d[y * W + x - 1] + A);
      }
      if (y > 0) {
        v = Math.min(v, d[(y - 1) * W + x] + A);
      }
      if (x > 0 && y > 0) {
        v = Math.min(v, d[(y - 1) * W + x - 1] + B);
      }
      if (x < W - 1 && y > 0) {
        v = Math.min(v, d[(y - 1) * W + x + 1] + B);
      }
      d[y * W + x] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      let v = d[y * W + x];
      if (x < W - 1) {
        v = Math.min(v, d[y * W + x + 1] + A);
      }
      if (y < H - 1) {
        v = Math.min(v, d[(y + 1) * W + x] + A);
      }
      if (x < W - 1 && y < H - 1) {
        v = Math.min(v, d[(y + 1) * W + x + 1] + B);
      }
      if (x > 0 && y < H - 1) {
        v = Math.min(v, d[(y + 1) * W + x - 1] + B);
      }
      d[y * W + x] = v;
    }
  }
}

// Signed distance field of a boolean mask: negative INSIDE the silhouette,
// positive OUTSIDE (0 on the edge). signed = outsideDist - insideDist, each of
// which is one chamfer pass (on the mask and on its inverse). Interpolating two
// SDFs and thresholding at 0 is a true shape morph, not a crossfade.
function fxSignedDT(mask, W, H) {
  const INF = 1e6;
  const N = W * H;
  const dOut = new Float32Array(N); // distance to nearest foreground (0 inside)
  const dIn = new Float32Array(N); // distance to nearest background (0 outside)
  for (let i = 0; i < N; i++) {
    dOut[i] = mask[i] ? 0 : INF;
    dIn[i] = mask[i] ? INF : 0;
  }
  fxChamfer(dOut, W, H);
  fxChamfer(dIn, W, H);
  const sdf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    sdf[i] = dOut[i] - dIn[i];
  }
  return sdf;
}

// Build a boolean silhouette mask of a sprite canvas on a common W x H grid,
// centred by its centroid so both forms overlap (the morph masses line up).
// Returns the mask plus the offset the real sprite must be drawn at to match.
function fxBuildMask(cv, W, H) {
  const w = cv.width;
  const h = cv.height;
  const data = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let sx = 0;
  let sy = 0;
  let c = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 40) {
        sx += x;
        sy += y;
        c++;
      }
    }
  }
  const cxs = c ? sx / c : w / 2;
  const cys = c ? sy / c : h / 2;
  const offX = Math.round(W / 2 - cxs);
  const offY = Math.round(H / 2 - cys);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 40) {
        const X = x + offX;
        const Y = y + offY;
        if (X >= 0 && Y >= 0 && X < W && Y < H) {
          mask[Y * W + X] = 1;
        }
      }
    }
  }
  return { mask, offX, offY };
}

// ---- burst build + draw (port of ErFormTransformFx) --------------------------
// Build the declarative particle list once at spawn (no per-frame alloc), the
// way ErFormTransformFx.buildParticles / animateParticle compute it.
function fxBuildParticles(cfg) {
  const parts = [];
  const twoPi = Math.PI * 2;
  for (let i = 0; i < cfg.count; i++) {
    const angle = (i / cfg.count) * twoPi + (Math.random() - 0.5) * 0.9;
    const dist = cfg.spread * (0.55 + Math.random() * 0.7);
    let dx = Math.cos(angle) * dist;
    let dy = Math.sin(angle) * dist;
    let ease = "cubicOut";
    let duration = 620;
    switch (cfg.motion) {
      case "rise":
        dx *= 0.6;
        dy = -Math.abs(dy) * 0.7 - dist * 0.5;
        ease = "sineOut";
        duration = 720;
        break;
      case "fall":
        dx *= 0.6;
        dy = Math.abs(dy) * 0.6 + dist * 0.7;
        ease = "quadIn";
        duration = 700;
        break;
      case "sway":
        dx *= 1.15;
        dy = -Math.abs(dy) * 0.5 - dist * 0.35;
        ease = "sineOut";
        duration = 760;
        break;
      case "burst":
        ease = "cubicOut";
        duration = 560;
        break;
    }
    let startDeg = 0;
    if (cfg.shape === "shard") {
      startDeg = 45; // rotated square reads as a crystalline diamond
    } else if (cfg.shape === "spark" || cfg.shape === "droplet") {
      startDeg = (angle * 180) / Math.PI + 90; // streaks orient along travel
    }
    parts.push({ dx, dy, ease, duration, delay: (i % 4) * 28, startDeg, spin: cfg.spin, size: cfg.size, shape: cfg.shape });
  }
  return parts;
}

function fxDrawParticle(ctx, p, ax, ay, color, elapsed) {
  const local = elapsed - p.delay;
  if (local < 0) {
    return;
  }
  const t = Math.min(1, local / p.duration);
  const e = FX_EASE[p.ease](t);
  const alpha = 1 - e;
  if (alpha <= 0.001) {
    return;
  }
  const x = ax + p.dx * e;
  const y = ay + p.dy * e;
  const scale = 1 - 0.65 * e; // scale 1 -> 0.35
  const ang = ((p.startDeg + p.spin * e) * Math.PI) / 180;
  const s = p.size;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fxRgba(color, 1);
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(scale, scale);
  switch (p.shape) {
    case "leaf":
      ctx.beginPath();
      ctx.ellipse(0, 0, (s * 1.7) / 2, (s * 0.75) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "droplet":
      ctx.beginPath();
      ctx.ellipse(0, 0, (s * 0.8) / 2, (s * 1.4) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "ember":
    case "mote":
      ctx.beginPath();
      ctx.ellipse(0, 0, s / 2, s / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "spark":
      ctx.fillRect((-s * 0.5) / 2, (-s * 1.7) / 2, s * 0.5, s * 1.7);
      break;
    case "shard":
      ctx.fillRect(-s / 2, -s / 2, s, s);
      break;
  }
  ctx.restore();
}

// The tinted light flash: bright core + soft halo + expanding ring (buildFlash).
function fxDrawFlash(ctx, ax, ay, color, elapsed) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // core: 46x46, alpha .95, scale .45 -> 1.25, 480ms Quad.easeOut
  {
    const dur = 480;
    const t = Math.min(1, elapsed / dur);
    if (t < 1) {
      const e = FX_EASE.quadOut(t);
      const sc = 0.45 + (1.25 - 0.45) * e;
      fxGlow(ctx, ax, ay, (46 / 2) * sc, (46 / 2) * sc, color, 0.95 * (1 - e));
    }
  }
  // halo: 74x74, alpha .5, scale .7 -> 2.0, 680ms Quad.easeOut
  {
    const dur = 680;
    const t = Math.min(1, elapsed / dur);
    if (t < 1) {
      const e = FX_EASE.quadOut(t);
      const sc = 0.7 + (2.0 - 0.7) * e;
      fxGlow(ctx, ax, ay, (74 / 2) * sc, (74 / 2) * sc, color, 0.5 * (1 - e));
    }
  }
  // ring: 30x30 stroked, scale .35 -> 2.3, alpha .9 -> 0, 560ms Cubic.easeOut
  {
    const dur = 560;
    const t = Math.min(1, elapsed / dur);
    if (t < 1) {
      const e = FX_EASE.cubicOut(t);
      const sc = 0.35 + (2.3 - 0.35) * e;
      ctx.globalAlpha = 0.9 * (1 - e);
      ctx.strokeStyle = fxRgba(color, 1);
      ctx.lineWidth = 3 * sc;
      ctx.beginPath();
      ctx.ellipse(ax, ay, (30 / 2) * sc, (30 / 2) * sc, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// The on-sprite flash/tint the transform applies to the body (fast type-coloured wash).
function fxDrawSpriteTint(ctx, spriteCv, sx, sy, color, elapsed) {
  const dur = 320;
  if (elapsed >= dur) {
    return;
  }
  const e = FX_EASE.quadOut(elapsed / dur);
  const a = 0.85 * (1 - e);
  if (a <= 0.001) {
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = a;
  ctx.drawImage(fxTintSprite(spriteCv, color), sx, sy);
  ctx.restore();
}

// ---- transform SEQUENCE state + timeline -------------------------------------
// FILL -> MORPH -> REVEAL+BURST. The burst portion keeps its snappy in-game
// length (FX_TOTAL_MS); the fill + morph make the whole thing breathe (~2.2s).
const FX_FILL_MS = 480;
const FX_MORPH_MS = 760;
const FX_DRAIN_MS = 360; // how long the solid fill drains to reveal the target
const FX_REVEAL_T = FX_FILL_MS + FX_MORPH_MS; // burst fires here (1240ms)
const FX_SEQ_TOTAL = FX_REVEAL_T + FX_TOTAL_MS; // ~2190ms

const fxState = {
  fromIdx: 0, // default From = Partner Eevee base
  toIdx: 2, // default To = Partner Jolteon (electric, the maintainer's example)
  back: false,
  ready: false,
  playStart: -1,
  fromCv: null,
  toCv: null,
  offFrom: { x: 0, y: 0 },
  offTo: { x: 0, y: 0 },
  MW: 0,
  MH: 0,
  sdfSrc: null,
  sdfTgt: null,
  morphCv: null,
  morphCtx: null,
  morphImg: null,
  cfg: null,
  color: [255, 255, 255],
  parts: [],
  anchor: { x: 0, y: 0 },
  canvas: null,
  ctx: null,
};

function fxSetStatus(msg) {
  const el = document.getElementById("fxStatus");
  if (el) {
    el.textContent = msg || "";
    el.style.opacity = msg ? 1 : 0;
  }
}

// Rasterise the morphed silhouette at interpolation p into fxState.morphImg:
// solid target-type colour inside, a brighter rim near the edge, a soft coloured
// glow just outside. (Threshold of the interpolated SDF at 0 = the morphed shape.)
function fxRenderMorphImg(p) {
  const { sdfSrc, sdfTgt, MW, MH, color, morphImg } = fxState;
  const d = morphImg.data;
  const r = color[0];
  const g = color[1];
  const b = color[2];
  const rim = 2.6;
  const glowW = rim * 2.2;
  const N = MW * MH;
  for (let i = 0; i < N; i++) {
    const s = sdfSrc[i] + (sdfTgt[i] - sdfSrc[i]) * p;
    const k = i * 4;
    if (s <= 0) {
      const rimGlow = Math.max(0, 1 - -s / rim); // 1 at the edge, 0 deeper in
      const boost = 0.45 * rimGlow;
      d[k] = r + (255 - r) * boost;
      d[k + 1] = g + (255 - g) * boost;
      d[k + 2] = b + (255 - b) * boost;
      d[k + 3] = 255;
    } else if (s < glowW) {
      const a = 1 - s / glowW;
      d[k] = r;
      d[k + 1] = g;
      d[k + 2] = b;
      d[k + 3] = (a * a * 200) | 0;
    } else {
      d[k + 3] = 0;
    }
  }
}

// Draw the morphed silhouette at interpolation p with an overall opacity (used to
// fade the fill in during FILL and drain it out during REVEAL). A blurred additive
// pass gives the "glowing" look, then the crisp silhouette on top.
function fxDrawMorphSilhouette(p, overallAlpha) {
  if (overallAlpha <= 0 || !fxState.sdfSrc) {
    return;
  }
  fxRenderMorphImg(p);
  fxState.morphCtx.putImageData(fxState.morphImg, 0, 0);
  const ctx = fxState.ctx;
  const cv = fxState.morphCv;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = overallAlpha * 0.7;
  ctx.filter = "blur(4px)";
  ctx.drawImage(cv, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = overallAlpha;
  ctx.drawImage(cv, 0, 0);
  ctx.restore();
}

function fxPlaySeq() {
  if (fxState.ready) {
    fxState.playStart = performance.now();
  }
}
function fxReplaySeq() {
  if (fxState.ready) {
    fxState.parts = fxBuildParticles(fxState.cfg); // fresh purely-visual randomness
    fxPlaySeq();
  }
}

async function fxSelectFromTo(opts) {
  const from = FX_PARTNERS[fxState.fromIdx];
  const to = FX_PARTNERS[fxState.toIdx];
  if (!from || !to) {
    return;
  }
  fxState.ready = false;
  fxState.cfg = fxTypeConfig(to.type);
  fxState.color = fxState.cfg.rgb;
  const nameEl = document.getElementById("fxMonName");
  if (nameEl) {
    nameEl.textContent = `${from.name}  →  ${to.name}`;
  }
  const typeEl = document.getElementById("fxMonType");
  if (typeEl) {
    const dot = to.type === "NORMAL" ? [168, 168, 120] : fxState.color;
    typeEl.innerHTML = `<span class="fx-typedot" style="background:${fxRgba(dot, 1)}"></span>${to.type[0] + to.type.slice(1).toLowerCase()}-type burst (from the target form)`;
  }
  fxSetStatus("loading sprites ...");
  try {
    const [fromRec, toRec] = await Promise.all([fxLoadSprite(from.stem, fxState.back), fxLoadSprite(to.stem, fxState.back)]);
    fxState.fromCv = fromRec.cv;
    fxState.toCv = toRec.cv;
    const MW = Math.max(fromRec.w, toRec.w) + 2 * FX_PAD;
    const MH = Math.max(fromRec.h, toRec.h) + 2 * FX_PAD;
    fxState.MW = MW;
    fxState.MH = MH;
    const fm = fxBuildMask(fromRec.cv, MW, MH);
    const tm = fxBuildMask(toRec.cv, MW, MH);
    fxState.offFrom = { x: fm.offX, y: fm.offY };
    fxState.offTo = { x: tm.offX, y: tm.offY };
    fxState.sdfSrc = fxSignedDT(fm.mask, MW, MH);
    fxState.sdfTgt = fxSignedDT(tm.mask, MW, MH);
    if (fxState.canvas) {
      fxState.canvas.width = MW;
      fxState.canvas.height = MH;
    }
    fxState.morphCv = document.createElement("canvas");
    fxState.morphCv.width = MW;
    fxState.morphCv.height = MH;
    fxState.morphCtx = fxState.morphCv.getContext("2d", { willReadFrequently: true });
    fxState.morphImg = fxState.morphCtx.createImageData(MW, MH);
    fxState.anchor = { x: MW / 2, y: MH / 2 - toRec.h * 0.12 };
    fxState.parts = fxBuildParticles(fxState.cfg);
    fxState.ready = true;
    fxSetStatus("");
    if (!opts || opts.play !== false) {
      fxPlaySeq();
    }
  } catch {
    fxSetStatus("sprites not found");
  }
}

function fxRenderFrame(now) {
  const ctx = fxState.ctx;
  if (!ctx || !fxState.ready) {
    return;
  }
  const { MW, MH } = fxState;
  ctx.clearRect(0, 0, MW, MH);
  ctx.imageSmoothingEnabled = false;
  const started = fxState.playStart >= 0;
  const el = started ? now - fxState.playStart : -1;

  if (!started) {
    ctx.drawImage(fxState.fromCv, fxState.offFrom.x, fxState.offFrom.y); // idle on source
    return;
  }
  if (el >= FX_SEQ_TOTAL) {
    ctx.drawImage(fxState.toCv, fxState.offTo.x, fxState.offTo.y); // rest on target
    fxState.playStart = -1;
    return;
  }

  if (el < FX_FILL_MS) {
    // FILL: the source sprite dims as the target-colour silhouette floods in.
    const f = FX_EASE.quadOut(el / FX_FILL_MS);
    ctx.save();
    ctx.globalAlpha = 1 - f;
    ctx.drawImage(fxState.fromCv, fxState.offFrom.x, fxState.offFrom.y);
    ctx.restore();
    fxDrawMorphSilhouette(0, f);
  } else if (el < FX_REVEAL_T) {
    // MORPH: the solid glowing silhouette flows source shape -> target shape.
    const p = fxSmooth((el - FX_FILL_MS) / FX_MORPH_MS);
    fxDrawMorphSilhouette(p, 1);
  } else {
    // REVEAL + BURST: burst fires, fill drains, target sprite revealed underneath.
    const be = el - FX_REVEAL_T;
    ctx.drawImage(fxState.toCv, fxState.offTo.x, fxState.offTo.y);
    const drain = Math.max(0, 1 - be / FX_DRAIN_MS);
    if (drain > 0) {
      fxDrawMorphSilhouette(1, drain);
    }
    fxDrawSpriteTint(ctx, fxState.toCv, fxState.offTo.x, fxState.offTo.y, fxState.color, be);
    const ax = fxState.anchor.x;
    const ay = fxState.anchor.y;
    fxDrawFlash(ctx, ax, ay, fxState.color, be);
    for (const pt of fxState.parts) {
      fxDrawParticle(ctx, pt, ax, ay, fxState.color, be);
    }
  }
}

// The transform category mounts its whole UI into the shared #fxBody (so adding
// a category never touches the HTML skeleton).
function fxMountTransform(body) {
  body.innerHTML = `
    <div class="fx-stage-wrap">
      <div class="fx-stage" id="fxStage">
        <canvas id="fxLabCanvas"></canvas>
        <div id="fxStatus" class="fx-status"></div>
      </div>
      <div class="fx-side">
        <div class="fx-mon-name" id="fxMonName"></div>
        <div class="fx-type" id="fxMonType"></div>
        <div class="fx-row"><label class="fx-side-label">From</label><select id="fxFrom" class="sel"></select></div>
        <div class="fx-row"><label class="fx-side-label">To</label><select id="fxTo" class="sel"></select></div>
        <div class="fx-row"><span class="fx-side-label">Sprite</span>
          <div class="seg" id="fxSideSeg">
            <button class="on" data-side="front">Front</button>
            <button data-side="back">Back</button>
          </div>
        </div>
        <div class="fx-row"><button id="fxReplay" class="fxplay">&#9654;&nbsp; Replay sequence</button></div>
        <p class="fx-note">The source form floods with the target type's light, its silhouette morphs shape into the
          target form (a signed-distance-field morph, not a crossfade), then the per-type burst fires as the real
          target sprite is revealed. The burst always types from the TARGET form (Eevee to Jolteon = electric).
          Front / back applies to both sprites. Change From, To or the sprite side to auto-play; Replay re-runs it.</p>
      </div>
    </div>`;

  fxState.canvas = document.getElementById("fxLabCanvas");
  fxState.ctx = fxState.canvas.getContext("2d", { willReadFrequently: true });

  const fromSel = document.getElementById("fxFrom");
  const toSel = document.getElementById("fxTo");
  FX_PARTNERS.forEach((p, i) => {
    fromSel.appendChild(new Option(p.name, i));
    toSel.appendChild(new Option(p.name, i));
  });
  fromSel.value = fxState.fromIdx;
  toSel.value = fxState.toIdx;
  fromSel.addEventListener("change", e => {
    fxState.fromIdx = +e.target.value;
    fxSelectFromTo();
  });
  toSel.addEventListener("change", e => {
    fxState.toIdx = +e.target.value;
    fxSelectFromTo();
  });

  document.querySelectorAll("#fxSideSeg button").forEach(b =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#fxSideSeg button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      fxState.back = b.dataset.side === "back";
      fxSelectFromTo();
    }),
  );
  document.getElementById("fxReplay").addEventListener("click", fxReplaySeq);

  fxSelectFromTo();
}

// ---- category registry (extensible: add ONE entry per new category) ----------
const FX_CATEGORIES = [
  {
    id: "transform",
    label: "Transformation Effects",
    blurb: "The full in-game transform sequence (fill, shape morph, per-type burst) between partner Eeveelutions.",
    mount: fxMountTransform,
  },
  // Future: { id: "ability", label: "Ability Effects", ... }, { id: "move", ... }
];

let fxActiveCat = null;
function fxSelectCategory(id) {
  const cat = FX_CATEGORIES.find(c => c.id === id) || FX_CATEGORIES[0];
  fxActiveCat = cat.id;
  document.querySelectorAll("#fxCats button").forEach(b => b.classList.toggle("on", b.dataset.cat === cat.id));
  const body = document.getElementById("fxBody");
  fxState.canvas = null;
  fxState.ctx = null;
  fxState.ready = false;
  fxState.playStart = -1;
  cat.mount(body);
}

// ---- view toggle + boot ------------------------------------------------------
let fxViewActive = false;
function fxBuildCategoryTabs() {
  const cats = document.getElementById("fxCats");
  FX_CATEGORIES.forEach((c, i) => {
    const b = document.createElement("button");
    b.dataset.cat = c.id;
    b.textContent = c.label;
    if (i === 0) {
      b.classList.add("on");
    }
    b.addEventListener("click", () => fxSelectCategory(c.id));
    cats.appendChild(b);
  });
}

function fxShowEffects(show) {
  fxViewActive = show;
  document.getElementById("shinyView").style.display = show ? "none" : "";
  document.getElementById("effectsLab").style.display = show ? "" : "none";
  if (show && !fxActiveCat) {
    fxSelectCategory(FX_CATEGORIES[0].id);
  }
  window.scrollTo(0, 0);
}

function fxLoop(now) {
  requestAnimationFrame(fxLoop);
  if (fxViewActive) {
    fxRenderFrame(now);
  }
}

fxBuildCategoryTabs();
document.getElementById("openEffects").addEventListener("click", () => fxShowEffects(true));
document.getElementById("fxBack").addEventListener("click", () => fxShowEffects(false));
requestAnimationFrame(fxLoop);

// Small hook for the review-screenshot harness (deterministic frozen-frame capture).
window.__fxLab = {
  state: fxState,
  replay: fxReplaySeq,
  selectFromTo: fxSelectFromTo,
  show: fxShowEffects,
  categories: FX_CATEGORIES,
  timings: { FILL: FX_FILL_MS, MORPH: FX_MORPH_MS, REVEAL_T: FX_REVEAL_T, DRAIN: FX_DRAIN_MS, TOTAL: FX_SEQ_TOTAL },
};
