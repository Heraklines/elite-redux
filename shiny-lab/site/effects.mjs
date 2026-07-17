/* Shiny Lab - EFFECTS lab (category-based in-game effect previews).
 *
 * A SEPARATE view from the shiny tools: a top-level "Effects" button opens a
 * category-based lab. Categories live in a small REGISTRY (FX_CATEGORIES) so a
 * future category (ability effects, move effects) is ONE new entry, not a new
 * page. The only category today is Transformation Effects: it previews the
 * in-game per-type transform burst (a faithful canvas-2D port of
 * src/sprites/er-form-transform-fx.ts) on each partner Eeveelution's FRONT and
 * BACK sprite.
 *
 * Runs in the same concatenated <script> as fx.mjs / exotic.mjs / app.js, so it
 * reuses CDN / loadImg / parseFrames defined in app.js. All names here are fx-
 * prefixed to avoid clashing with the shiny renderer's globals. */

// ---- per-type config (ported verbatim from er-form-transform-fx.ts) ----------
const FX_TOTAL_MS = 950; // ER_TRANSFORM_FX_TOTAL_MS
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

// ---- burst build + draw (port of ErFormTransformFx) --------------------------
const FX_PAD = 72; // room around the sprite so particles never clip the canvas

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

// ---- transform category view -------------------------------------------------
const fxState = {
  partnerIdx: 3, // default Partner Flareon (a bright fire burst)
  back: false,
  sprite: null,
  playStart: -1,
  parts: [],
  cfg: null,
  color: [255, 255, 255],
  canvas: null,
  ctx: null,
  PW: 0,
  PH: 0,
};

function fxSetStatus(msg) {
  const el = document.getElementById("fxStatus");
  if (el) {
    el.textContent = msg || "";
    el.style.opacity = msg ? 1 : 0;
  }
}

function fxPlay() {
  if (fxState.sprite) {
    fxState.playStart = performance.now();
  }
}

async function fxSelectPartner(idx, opts) {
  const partner = FX_PARTNERS[idx];
  if (!partner) {
    return;
  }
  fxState.partnerIdx = idx;
  fxState.cfg = fxTypeConfig(partner.type);
  fxState.color = fxState.cfg.rgb;
  const nameEl = document.getElementById("fxMonName");
  if (nameEl) {
    nameEl.textContent = partner.name;
  }
  const typeEl = document.getElementById("fxMonType");
  if (typeEl) {
    typeEl.innerHTML = `<span class="fx-typedot" style="background:${fxRgba(partner.type === "NORMAL" ? [168, 168, 120] : fxState.color, 1)}"></span>${partner.type[0] + partner.type.slice(1).toLowerCase()}-type burst`;
  }
  document.querySelectorAll("#fxMons .fx-mon").forEach(el => el.classList.toggle("active", +el.dataset.idx === idx));
  fxSetStatus("loading " + partner.name + " ...");
  try {
    const rec = await fxLoadSprite(partner.stem, fxState.back);
    fxState.sprite = rec;
    fxState.PW = rec.w + 2 * FX_PAD;
    fxState.PH = rec.h + 2 * FX_PAD;
    if (fxState.canvas) {
      fxState.canvas.width = fxState.PW;
      fxState.canvas.height = fxState.PH;
    }
    fxSetStatus("");
    // rebuild particles for this type and auto-play (unless suppressed)
    fxState.parts = fxBuildParticles(fxState.cfg);
    if (!opts || opts.play !== false) {
      fxPlay();
    }
  } catch {
    fxSetStatus(partner.name + " sprite not found");
  }
}

function fxReplay() {
  if (fxState.cfg) {
    fxState.parts = fxBuildParticles(fxState.cfg); // fresh purely-visual randomness
    fxPlay();
  }
}

function fxRenderFrame(now) {
  const ctx = fxState.ctx;
  if (!ctx || !fxState.sprite) {
    return;
  }
  const { PW, PH } = fxState;
  ctx.clearRect(0, 0, PW, PH);
  const sx = (PW - fxState.sprite.w) / 2;
  const sy = (PH - fxState.sprite.h) / 2;
  // idle sprite
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fxState.sprite.cv, sx, sy);
  const started = fxState.playStart >= 0;
  const elapsed = started ? now - fxState.playStart : Infinity;
  if (started && elapsed <= FX_TOTAL_MS) {
    // anchor: centred on the body, nudged toward the upper torso like in-game
    const ax = sx + fxState.sprite.w / 2;
    const ay = sy + fxState.sprite.h * 0.42;
    fxDrawSpriteTint(ctx, fxState.sprite.cv, sx, sy, fxState.color, elapsed);
    fxDrawFlash(ctx, ax, ay, fxState.color, elapsed);
    for (const p of fxState.parts) {
      fxDrawParticle(ctx, p, ax, ay, fxState.color, elapsed);
    }
  } else if (started) {
    fxState.playStart = -1; // burst finished; rest on the idle sprite
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
        <div class="fx-mon-name" id="fxMonName">Partner Flareon</div>
        <div class="fx-type" id="fxMonType"></div>
        <div class="fx-row"><span class="fx-side-label">Sprite</span>
          <div class="seg" id="fxSideSeg">
            <button class="on" data-side="front">Front</button>
            <button data-side="back">Back</button>
          </div>
        </div>
        <div class="fx-row"><button id="fxReplay" class="fxplay">&#9654;&nbsp; Replay burst</button></div>
        <p class="fx-note">Each partner Eeveelution previews with its OWN type's transform burst - the same
          per-type colours, shapes and motions as the in-game effect (Flareon fire embers, Leafeon grass
          leaves, Vaporeon water droplets, and so on). Pick a partner or flip the sprite to replay.</p>
      </div>
    </div>
    <div class="fx-mons" id="fxMons"></div>`;

  fxState.canvas = document.getElementById("fxLabCanvas");
  fxState.ctx = fxState.canvas.getContext("2d", { willReadFrequently: true });

  const mons = document.getElementById("fxMons");
  FX_PARTNERS.forEach((p, i) => {
    const dot = p.type === "NORMAL" ? [168, 168, 120] : FX_TYPE_RGB[p.type];
    const el = document.createElement("button");
    el.className = "fx-mon";
    el.dataset.idx = i;
    el.innerHTML = `<span class="fx-mon-dot" style="background:${fxRgba(dot, 1)};box-shadow:0 0 8px ${fxRgba(dot, 1)}"></span>${p.name.replace("Partner ", "")}`;
    el.addEventListener("click", () => fxSelectPartner(i));
    mons.appendChild(el);
  });

  document.querySelectorAll("#fxSideSeg button").forEach(b =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#fxSideSeg button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      fxState.back = b.dataset.side === "back";
      fxSelectPartner(fxState.partnerIdx);
    }),
  );
  document.getElementById("fxReplay").addEventListener("click", fxReplay);

  fxSelectPartner(fxState.partnerIdx);
}

// ---- category registry (extensible: add ONE entry per new category) ----------
const FX_CATEGORIES = [
  {
    id: "transform",
    label: "Transformation Effects",
    blurb: "The in-game per-type transform burst on each partner Eeveelution.",
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
  fxState.sprite = null;
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

// Small hook for the review-screenshot harness (deterministic mid-burst capture).
window.__fxLab = { state: fxState, replay: fxReplay, select: fxSelectPartner, show: fxShowEffects, categories: FX_CATEGORIES };
