/* Shiny Lab - live renderer (v4). Any Pokemon, sprites pulled from the er-assets
 * CDN (jsDelivr, pinned sha) like the game does. Same effect math as fx.mjs
 * (PALETTE / AURA / AROUND / LABELS / PARTIAL / computeEdge / computeDist / voro /
 * mix / clamp / vnoise / ALL_* inlined above). Three combinable slots:
 *   Palette (crossplay-safe color) x Surface FX (on-sprite) x Around FX (around the mon).
 * Per-pixel JS on a padded canvas, CSS-upscaled (image-rendering:pixelated). No WebGL. */

const LAB = window.LAB;
const CDN = LAB.cdn;
const SPECIES = LAB.species;
// Sprite file stem for a dex id: numeric id, except a form-only species (e.g.
// Vivillon #666, which ships no 666.png) carries an explicit form stem in `f`.
const spriteStem = id => {
  const s = SPECIES.find(x => x.i === id);
  return (s && s.f) || id;
};
const PAD = 28;
let FW = 0;
let FH = 0;
let PW = 0;
let PH = 0;
let curSpecies = LAB.def;
let CL = null;
let denseBuf = null;
let clusterAlgo = "kmeans";
function recomputeCL() {
  if (denseBuf) {
    CL = (CLUSTERING[clusterAlgo] || CLUSTERING.kmeans).fn(denseBuf, FW, FH, 5);
  }
}

const PALS = ["base", ...ALL_PALETTE];
const SLOTKIND = {
  palette: PALS,
  surface: ALL_AURA,
  around: ALL_AROUND,
  exotic: ALL_EXOTIC,
  rig: ALL_RIG,
  moment: ALL_MOMENT,
};
// exotic effects carry their labels on the registry - fold them into the shared LABELS map
for (const [exoId, exoDef] of Object.entries(EXOTIC)) {
  LABELS[exoId] = exoDef.label;
}

// ---- exotic layer state: composited-look canvas + frame-history ring ----------
const RING_N = 24; // ~2s of rendered-look history at the 80ms capture cadence
let lookCv = null;
let lookCtx = null;
let ringCv = [];
let ringHead = -1;
let lastRingCap = 0;
function ensureExoticCanvases() {
  lookCv = document.createElement("canvas");
  lookCv.width = PW;
  lookCv.height = PH;
  lookCtx = lookCv.getContext("2d", { willReadFrequently: true });
  ringCv = [];
  ringHead = -1;
  for (let i = 0; i < RING_N; i++) {
    const cv = document.createElement("canvas");
    cv.width = PW;
    cv.height = PH;
    ringCv.push(cv);
  }
}
const ringGet = n => {
  if (ringHead < 0) {
    return lookCv;
  }
  const lag = Math.max(0, Math.min(RING_N - 1, Math.round(n)));
  return ringCv[(ringHead - lag + RING_N * 4) % RING_N];
};
function resizeHero() {
  if (PW <= 0 || PH <= 0) {
    return; // no species loaded yet
  }
  heroCv.width = PW;
  heroCv.height = PH;
  heroImg = heroCtx.createImageData(PW, PH);
}
// raw sprite silhouette (no aura bleed) - exotic effects derive contours/masks from it
let baseAlphaArr = null;
let baseAlphaFor = -1;
function getBaseAlpha() {
  if (baseAlphaFor === curSpecies && baseAlphaArr && baseAlphaArr.length === PW * PH) {
    return baseAlphaArr;
  }
  const A = new Uint8Array(PW * PH);
  for (let y = 0; y < FH; y++) {
    for (let x = 0; x < FW; x++) {
      if (denseBuf[(y * FW + x) * 4 + 3] > 0.4) {
        A[(y + PAD) * PW + (x + PAD)] = 1;
      }
    }
  }
  baseAlphaArr = A;
  baseAlphaFor = curSpecies;
  return A;
}
// evolution-line info (baked into LAB.evo by build-site) for lineage effects
const evoInfoCache = new Map();
function evoInfoFor(id) {
  if (evoInfoCache.has(id)) {
    return evoInfoCache.get(id);
  }
  const E = LAB.evo || {};
  const up = [id];
  let cur = id;
  while (E[cur] && E[cur].p != null && up.length < 4 && !up.includes(E[cur].p)) {
    cur = E[cur].p;
    up.unshift(cur);
  }
  const chain = [...up];
  cur = id;
  while (E[cur] && E[cur].n && E[cur].n.length > 0 && chain.length < 4) {
    const nx = E[cur].n[0];
    if (chain.includes(nx)) {
      break;
    }
    chain.push(nx);
    cur = nx;
  }
  const info = { prev: E[id] && E[id].p != null ? E[id].p : 0, next: (E[id] && E[id].n) || [], chain };
  evoInfoCache.set(id, info);
  return info;
}
// aux sprite loader: frame-0 canvas of ANOTHER species (async; null until loaded)
const auxCache = new Map();
function auxLook(id) {
  if (!id) {
    return null;
  }
  let e = auxCache.get(id);
  if (e === undefined) {
    e = { cv: null };
    auxCache.set(id, e);
    (async () => {
      try {
        const stem = spriteStem(id);
        const atlas = await fetch(`${CDN}/${stem}.json`).then(r => {
          if (!r.ok) {
            throw new Error("no atlas");
          }
          return r.json();
        });
        const fr = parseFrames(atlas)[0];
        const img = await loadImg(`${CDN}/${stem}.png`);
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
        e.cv = cv;
      } catch {
        /* leave null - effects fall back gracefully */
      }
    })();
  }
  return e.cv;
}

// ---- sprite loading (CDN) ----------------------------------------------------
const sheet = document.createElement("canvas");
const sctx = sheet.getContext("2d", { willReadFrequently: true });
let frameBuf = [];
const edgeCache = new Map();
const distCache = new Map();
const edgeFor = ai => {
  if (!edgeCache.has(ai)) {
    edgeCache.set(ai, computeEdge(frameBuf[ai], FW, FH));
  }
  return edgeCache.get(ai);
};
const distFor = ai => {
  if (!distCache.has(ai)) {
    distCache.set(ai, computeDist(frameBuf[ai], FW, FH, PAD));
  }
  return distCache.get(ai);
};
// Exotic-effect support (ported from the in-game Shiny Lab, 2026-07-20): a
// per-frame silhouette-topology bundle (SDF / Voronoi midline / normals /
// matcap z / pixId), computed lazily only when an exotic surface is active.
const topoCache = new Map();
const topoFor = ai => {
  if (!topoCache.has(ai)) {
    topoCache.set(ai, computeFxTopology(frameBuf[ai], FW, FH));
  }
  return topoCache.get(ai);
};
const EXOTIC_SURF = new Set(["gildedbones", "carvedrelief", "innerember", "nestedportrait"]);
// Union-silhouette centroid across ALL frames of the current animation, in
// padded-normalized coords: landmark geometry (Warp Well) anchors to this so it
// does not wobble as the pose hops frame to frame. Falls back to the frame
// centroid for a single-frame sprite.
let stableAnchor = null;
function computeStableAnchor() {
  let sx = 0;
  let sy = 0;
  let cnt = 0;
  for (let ai = 0; ai < frameBuf.length; ai++) {
    const buf = frameBuf[ai];
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        if (buf[(y * FW + x) * 4 + 3] > 0.02) {
          sx += x + PAD;
          sy += y + PAD;
          cnt++;
        }
      }
    }
  }
  stableAnchor = cnt > 0 ? { cx: sx / cnt / PW, cy: sy / cnt / PH } : null;
}
const makeSampler = buf => (x, y) => {
  const xi = Math.max(0, Math.min(FW - 1, Math.round(x * FW)));
  const yi = Math.max(0, Math.min(FH - 1, Math.round(y * FH)));
  const i = (yi * FW + xi) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
};
const isProtectedPalettePixel = (r, g, b, a) =>
  a > 0.02 && ((protectBlack && Math.max(r, g, b) <= 0.06) || (protectWhite && Math.min(r, g, b) >= 0.94));
const parseFrames = a =>
  a.textures ? a.textures[0].frames : Array.isArray(a.frames) ? a.frames : Object.values(a.frames);
const loadImg = src =>
  new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
const status = msg => {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.style.opacity = msg ? 1 : 0;
};

async function loadSpecies(id) {
  status("loading #" + id + " ...");
  const base = `${CDN}/${spriteStem(id)}`;
  const atlas = await fetch(base + ".json").then(r => {
    if (!r.ok) {
      throw new Error("no atlas");
    }
    return r.json();
  });
  const fr = parseFrames(atlas);
  const f0 = fr[0];
  const nFW = (f0.sourceSize && f0.sourceSize.w) || f0.frame.w;
  const nFH = (f0.sourceSize && f0.sourceSize.h) || f0.frame.h;
  const img = await loadImg(base + ".png");
  sheet.width = img.width;
  sheet.height = img.height;
  sctx.clearRect(0, 0, img.width, img.height);
  sctx.drawImage(img, 0, 0);
  FW = nFW;
  FH = nFH;
  PW = FW + 2 * PAD;
  PH = FH + 2 * PAD;
  frameBuf = [];
  edgeCache.clear();
  distCache.clear();
  topoCache.clear();
  stableAnchor = null;
  for (const f of fr) {
    const fb = new Float32Array(FW * FH * 4);
    const sss = f.spriteSourceSize || { x: 0, y: 0 };
    const sub = sctx.getImageData(f.frame.x, f.frame.y, f.frame.w, f.frame.h).data;
    for (let yy = 0; yy < f.frame.h; yy++) {
      for (let xx = 0; xx < f.frame.w; xx++) {
        const dx = sss.x + xx;
        const dy = sss.y + yy;
        if (dx < 0 || dy < 0 || dx >= FW || dy >= FH) {
          continue;
        }
        const di = (dy * FW + dx) * 4;
        const si = (yy * f.frame.w + xx) * 4;
        fb[di] = sub[si] / 255;
        fb[di + 1] = sub[si + 1] / 255;
        fb[di + 2] = sub[si + 2] / 255;
        fb[di + 3] = sub[si + 3] / 255;
      }
    }
    frameBuf.push(fb);
  }
  let dense = frameBuf[0];
  let dn = -1;
  for (const f of frameBuf) {
    let o = 0;
    for (let i = 3; i < f.length; i += 4) {
      if (f[i] > 0.5) {
        o++;
      }
    }
    if (o > dn) {
      dn = o;
      dense = f;
    }
  }
  denseBuf = dense;
  recomputeCL();
  computeStableAnchor();
  curSpecies = id;
  resizeCanvases();
  status("");
  // give each mon a different default texture seed (so e.g. Bioluminescent spots differ)
  const s0 = (id * 13) % 257;
  layerFx.surf.seed = s0;
  layerFx.aro.seed = s0;
  for (const elId of ["surf_seed", "aro_seed"]) {
    const se = document.getElementById(elId);
    if (se) {
      se.value = s0;
    }
  }
}

// ---- render a full look (palette + surface + around) onto a padded buffer -----
// fx = per-layer params: { surf: {seed, scale, speed, mode, h, s}, aro: {...}, gbc }.
// Surface and around each get their OWN noise seed / texture scale / speed / tint.
function renderLook(slots, buf, ef, dist, t, out, amt, fx) {
  fx = fx || fxLayerState();
  const rawSa = makeSampler(buf);
  // padded-normalized sprite sampler for around-FX that echo the mon (Double Team)
  const sprPad = (nx, ny) => {
    const sx2 = Math.round(nx * PW - 0.5) - PAD;
    const sy2 = Math.round(ny * PH - 0.5) - PAD;
    if (sx2 < 0 || sy2 < 0 || sx2 >= FW || sy2 >= FH) {
      return [0, 0, 0, 0];
    }
    const i2 = (sy2 * FW + sx2) * 4;
    return [buf[i2], buf[i2 + 1], buf[i2 + 2], buf[i2 + 3]];
  };
  // dominant (most colorful) cluster color - Double Team Tri builds its triad from it
  let mainCol = null;
  if (CL) {
    let best = -1;
    for (const cen of CL.cent) {
      const hsv = rgb2hsv(cen[0], cen[1], cen[2]);
      if (hsv[1] * hsv[2] > best) {
        best = hsv[1] * hsv[2];
        mainCol = cen;
      }
    }
  }
  const surf0 = slots.surface || null;
  // Exotic topology: computed lazily per frame, only when an exotic surface is on.
  const ai = frameBuf.indexOf(buf);
  const topo = surf0 && EXOTIC_SURF.has(surf0) && ai >= 0 ? topoFor(ai) : null;
  const stCx = stableAnchor ? stableAnchor.cx : dist.cx;
  const stCy = stableAnchor ? stableAnchor.cy : dist.cy;
  const ac = {
    cx: dist.cx,
    cy: dist.cy,
    fy: dist.fy,
    stableCx: stCx,
    stableCy: stCy,
    spr: sprPad,
    main: mainCol,
  };
  const ctx = {
    e: 0,
    sa: rawSa,
    W: FW,
    H: FH,
    K: CL ? CL.K : 1,
    clRank: (r, g, b) => (CL ? clusterRank(CL, r, g, b) : 0),
    clColor: i => (CL ? CL.cent[i] : [0.5, 0.5, 0.5]),
    px: 0,
    py: 0,
    topo,
    anchors: { frameCx: dist.cx, frameCy: dist.cy, frameFy: dist.fy, stableCx: stCx, stableCy: stCy, stableFy: dist.fy },
  };
  const pal = slots.palette && slots.palette !== "base" ? slots.palette : null;
  const surf = slots.surface || null;
  const aro = slots.around || null;
  // Palette-aware sampler: the distortion FX (Heat Shimmer, Ripple, Wormhole, Shatter,
  // Kaleidoscope, Pixel Pulse, Prismatic, Glitch) read the sprite through `sa` - sample
  // the RECOLORED sprite so they take the palette color instead of the original sprite.
  const sa = pal
    ? (x, y) => {
        const s = rawSa(x, y);
        if (s[3] <= 0.02) return s;
        if (isProtectedPalettePixel(s[0], s[1], s[2], s[3])) return s;
        const c = PALETTE[pal](s[0], s[1], s[2], ctx);
        return [c[0], c[1], c[2], s[3]];
      }
    : rawSa;
  ctx.sa = sa;
  // FX color, PER LAYER: default = each effect's own colors; palette = match the
  // palette's most colorful tone; custom = a hand-picked color per layer.
  const resolveTint = cfg => {
    if (cfg.mode === "default") {
      return { on: false, h: 0, s: 0 };
    }
    let h = cfg.h;
    let s = cfg.s;
    if (cfg.mode === "palette") {
      let best = -1;
      const refs = CL
        ? CL.cent
        : [
            [0.3, 0.4, 0.6],
            [0.6, 0.7, 0.95],
          ];
      for (const cen of refs) {
        const c = pal ? PALETTE[pal](cen[0], cen[1], cen[2], ctx) : cen;
        const hsv = rgb2hsv(c[0], c[1], c[2]);
        if (hsv[1] * hsv[2] > best) {
          best = hsv[1] * hsv[2];
          h = hsv[0];
          s = Math.max(0.5, hsv[1]);
        }
      }
    }
    return { on: true, h, s };
  };
  const surfTint = resolveTint(fx.surf);
  const aroTint = resolveTint(fx.aro);
  const tS = t * fx.surf.speed;
  const tA = t * fx.aro.speed;
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const k = (py * PW + px) * 4;
      const sx = px - PAD;
      const sy = py - PAD;
      const on = sx >= 0 && sy >= 0 && sx < FW && sy < FH && buf[(sy * FW + sx) * 4 + 3] > 0.02;
      if (on) {
        const i = (sy * FW + sx) * 4;
        const a0 = buf[i + 3];
        const x = (sx + 0.5) / FW;
        const y = (sy + 0.5) / FH;
        ctx.e = ef[sy * FW + sx];
        ctx.px = sx;
        ctx.py = sy;
        const r = buf[i];
        const g = buf[i + 1];
        const b = buf[i + 2];
        let a = a0;
        const protectedPal = pal && isProtectedPalettePixel(r, g, b, a0);
        let col = pal && !protectedPal ? PALETTE[pal](r, g, b, ctx) : [r, g, b];
        if (pal && !protectedPal) {
          a = a0 * (PALETTE_ALPHA[pal] ?? 1);
          if (amt.pal < 1) {
            col = [mix(r, col[0], amt.pal), mix(g, col[1], amt.pal), mix(b, col[2], amt.pal)];
            a = mix(a0, a, amt.pal);
          }
        }
        if (surf) {
          setFxParams(fx.surf.seed, fx.surf.scale);
          const base2 = col;
          const aPal = a;
          let sc;
          if (surf === "prismatic") {
            const off = 0.012 * (0.6 + 0.4 * Math.sin(tS * 2));
            sc = [sa(x + off, y)[0], col[1], sa(x - off, y)[2]];
          } else if (surf === "glitch") {
            const slice = Math.floor(y * 16);
            const rnd = vnoise(slice * 3.1 + 0.5, Math.floor(tS * 8) * 1.3 + 0.5);
            const dx = rnd > 0.62 ? (vnoise(slice + 9, Math.floor(tS * 8)) - 0.5) * 0.14 : 0;
            const s2 = sa(x + dx, y);
            if (s2[3] <= 0.02) {
              out[k + 3] = 0;
              continue;
            }
            const scan = py % 3 === 0 ? 0.6 : 1;
            sc = [sa(x + dx + 0.01, y)[0] * scan, s2[1] * scan, sa(x + dx - 0.01, y)[2] * scan];
            a = s2[3];
          } else {
            const res = AURA[surf](base2[0], base2[1], base2[2], x, y, tS, ctx);
            sc = [res[0], res[1], res[2]];
            a = aPal * res[3];
          }
          if (surfTint.on && !NO_TINT.has(surf)) {
            sc = tintTo(sc, surfTint.h, surfTint.s);
          }
          if (fx.gbc) {
            sc = gbcSnap(sc);
          }
          let blended = blendCol(base2, sc, SURFACE_BLEND[surf] || "normal");
          if (amt.surf < 1) {
            blended = [mix(base2[0], blended[0], amt.surf), mix(base2[1], blended[1], amt.surf), mix(base2[2], blended[2], amt.surf)];
            a = mix(aPal, a, amt.surf);
          }
          col = blended;
        }
        // front pass for 3D around-FX (helix / atomic orbit): the effect is also
        // drawn OVER the sprite; the effect itself culls its "behind" half at df=0.
        if (aro && AROUND_OVERLAY.has(aro)) {
          setFxParams(fx.aro.seed, fx.aro.scale);
          const nx = (px + 0.5) / PW;
          const ny = (py + 0.5) / PH;
          const res = AROUND[aro](nx, ny, 0, tA, ac);
          let rc = [res[0], res[1], res[2]];
          if (aroTint.on && !NO_TINT.has(aro)) {
            rc = tintTo(rc, aroTint.h, aroTint.s);
          }
          if (fx.gbc) {
            rc = gbcSnap(rc);
          }
          const oa = res[3] * amt.aro;
          if (oa > 0) {
            col = [mix(col[0], rc[0], oa), mix(col[1], rc[1], oa), mix(col[2], rc[2], oa)];
            a = Math.min(1, a + oa * (1 - a));
          }
        }
        out[k] = col[0] * 255;
        out[k + 1] = col[1] * 255;
        out[k + 2] = col[2] * 255;
        out[k + 3] = a * 255;
      } else if (aro) {
        setFxParams(fx.aro.seed, fx.aro.scale);
        const nx = (px + 0.5) / PW;
        const ny = (py + 0.5) / PH;
        const df = dist.d[py * PW + px];
        const res = AROUND[aro](nx, ny, df, tA, ac);
        let rc = [res[0], res[1], res[2]];
        if (aroTint.on && !NO_TINT.has(aro)) {
          rc = tintTo(rc, aroTint.h, aroTint.s);
        }
        if (fx.gbc) {
          rc = gbcSnap(rc);
        }
        // never hard-clip at the box edge: fray the aura into noise-driven wisps
        // over the last px (drifts with the around layer's time)
        const fade = edgeFalloff(px, py, PW, PH, tA);
        out[k] = rc[0] * 255;
        out[k + 1] = rc[1] * 255;
        out[k + 2] = rc[2] * 255;
        out[k + 3] = res[3] * amt.aro * fade * 255;
      } else {
        out[k + 3] = 0;
      }
    }
  }
}

// ---- gallery -----------------------------------------------------------------
const tiles = [];
const io = new IntersectionObserver(
  es =>
    es.forEach(e => {
      const t = tiles.find(x => x.el === e.target);
      if (t) {
        t.vis = e.isIntersecting;
      }
    }),
  { rootMargin: "150px" },
);
const FX_KINDS = ["exotic", "rig", "moment"];
function mkTile(kind, name) {
  const el = document.createElement("div");
  el.className = `tile ${kind}`;
  const pill = PARTIAL.has(name) ? '<span class="pill">partial</span>' : "";
  const dotc =
    kind === "around"
      ? "aro"
      : kind === "surface"
        ? "aura"
        : kind === "exotic"
          ? "exo"
          : kind === "rig"
            ? "rig"
            : kind === "moment"
              ? "mom"
              : "pal";
  el.innerHTML = `<div class="frame"><canvas></canvas></div>
    <div class="name"><span class="dot ${dotc}"></span>${name === "base" ? "Base" : LABELS[name]}${pill}</div>`;
  const cv = el.querySelector("canvas");
  const ctx = cv.getContext("2d");
  const isFx = FX_KINDS.includes(kind);
  const slots =
    kind === "palette" ? { palette: name } : kind === "surface" ? { palette: "base", surface: name } : { around: name };
  el.addEventListener("click", () => setSlot(kind, name));
  const tile = { kind, name, slots, cv, ctx, img: null, el, vis: true, fx: isFx ? { [kind]: name } : null };
  tiles.push(tile);
  io.observe(el);
  return el;
}
function buildGallery() {
  PALS.forEach(n => document.getElementById("palGrid").appendChild(mkTile("palette", n)));
  ALL_AURA.forEach(n => document.getElementById("surfGrid").appendChild(mkTile("surface", n)));
  ALL_AROUND.forEach(n => document.getElementById("aroGrid").appendChild(mkTile("around", n)));
  ALL_EXOTIC.forEach(n => document.getElementById("exoGrid").appendChild(mkTile("exotic", n)));
  ALL_RIG.forEach(n => document.getElementById("rigGrid").appendChild(mkTile("rig", n)));
  ALL_MOMENT.forEach(n => document.getElementById("momGrid").appendChild(mkTile("moment", n)));
  document.getElementById("palCount").textContent = ALL_PALETTE.length + 1;
  document.getElementById("surfCount").textContent = ALL_AURA.length;
  document.getElementById("aroCount").textContent = ALL_AROUND.length;
  document.getElementById("exoCount").textContent = ALL_EXOTIC.length;
  document.getElementById("rigCount").textContent = ALL_RIG.length;
  document.getElementById("momCount").textContent = ALL_MOMENT.length;
}
function resizeCanvases() {
  resizeHero();
  ensureExoticCanvases();
  for (const t of tiles) {
    t.cv.width = PW;
    t.cv.height = PH;
    t.img = t.fx ? null : t.ctx.createImageData(PW, PH);
  }
}

// ---- state / hero ------------------------------------------------------------
const heroCv = document.getElementById("heroCanvas");
const heroCtx = heroCv.getContext("2d");
// full-stage overlay: exotic/rig/moment scenes render here at the SAME on-screen
// pixel scale as the hero canvas, so the mon never shrinks - copies get the whole
// stage to roam instead of a bigger (CSS-downscaled) canvas
const fxCv = document.getElementById("fxCanvas");
const fxCtx = fxCv.getContext("2d");
const stageEl = document.getElementById("stage");
let fxOx = 0;
let fxOy = 0;
let fxShown = false;
// live cursor over the stage (Cursor Bait & friends) - converted to overlay logical px
const cursorCss = { x: 0, y: 0, active: false };
stageEl.addEventListener("mousemove", e => {
  const r = stageEl.getBoundingClientRect();
  cursorCss.x = e.clientX - r.left;
  cursorCss.y = e.clientY - r.top;
  cursorCss.active = true;
});
stageEl.addEventListener("mouseleave", () => {
  cursorCss.active = false;
});
function syncFxOverlay() {
  const scale = heroCv.offsetWidth / PW;
  if (!(scale > 0)) {
    return false;
  }
  const w = Math.max(1, Math.round(stageEl.clientWidth / scale));
  const h = Math.max(1, Math.round(stageEl.clientHeight / scale));
  if (fxCv.width !== w || fxCv.height !== h) {
    fxCv.width = w;
    fxCv.height = h;
  }
  fxOx = Math.round(heroCv.offsetLeft / scale);
  fxOy = Math.round(heroCv.offsetTop / scale);
  return true;
}
let heroImg = null;
const slots = { palette: "glacier", surface: "", around: "auroraveil", exotic: "", rig: "", moment: "" };
let speed = 1; // master speed (multiplies both layers)
let palIntensity = 1;
let surfIntensity = 1;
let aroIntensity = 1;
let protectBlack = false;
let protectWhite = false;
let gbcMode = false;
// per-layer FX params: surface and around each get their own seed / texture
// noise / speed / color (mode: default | palette | custom).
const layerFx = {
  surf: { seed: 0, scale: 1, speed: 1, mode: "default", h: 0.92, s: 0.7 },
  aro: { seed: 0, scale: 1, speed: 1, mode: "default", h: 0.92, s: 0.7 },
};
function fxLayerState() {
  return { surf: layerFx.surf, aro: layerFx.aro, gbc: gbcMode };
}

const nameOf = kind => {
  const v = slots[kind];
  return !v || v === "base" ? "" : LABELS[v];
};
function refreshHero() {
  const parts = [
    nameOf("palette"),
    nameOf("surface"),
    nameOf("around"),
    nameOf("exotic"),
    nameOf("rig"),
    nameOf("moment"),
  ].filter(Boolean);
  document.getElementById("heroName").textContent = parts.length > 0 ? parts.join("  +  ") : "Base";
  const glowCol = slots.moment
    ? "#ffb45a"
    : slots.rig
      ? "#6ee7c8"
      : slots.exotic
        ? "#b78aff"
        : slots.around
          ? "#ffd27a"
          : slots.surface
            ? "#ff7ad9"
            : "#5ad1ff";
  document.querySelector(".stage .glow").style.background = `radial-gradient(circle, ${glowCol}33, transparent 70%)`;
  for (const k of ["palette", "surface", "around", "exotic", "rig", "moment"]) {
    document.getElementById("sel_" + k).value = slots[k];
  }
  tiles.forEach(t => t.el.classList.toggle("active", slots[t.kind] === t.name));
}
function setSlot(kind, name) {
  slots[kind] = name === slots[kind] && kind !== "palette" ? "" : name;
  refreshHero();
}

function wireControls() {
  for (const k of ["palette", "surface", "around", "exotic", "rig", "moment"]) {
    const sel = document.getElementById("sel_" + k);
    if (k !== "palette") {
      sel.appendChild(new Option("None", ""));
    }
    SLOTKIND[k].forEach(n => sel.appendChild(new Option(n === "base" ? "Base (no palette)" : LABELS[n], n)));
    sel.addEventListener("change", e => {
      slots[k] = e.target.value;
      refreshHero();
    });
  }
  const cs = document.getElementById("sel_cluster");
  if (cs) {
    for (const [key, alg] of Object.entries(CLUSTERING)) {
      cs.appendChild(new Option(alg.label, key));
    }
    cs.addEventListener("change", e => {
      clusterAlgo = e.target.value;
      recomputeCL();
    });
  }
  document.getElementById("speed").addEventListener("input", e => (speed = +e.target.value));
  document.getElementById("int_palette").addEventListener("input", e => (palIntensity = +e.target.value));
  document.getElementById("int_surface").addEventListener("input", e => (surfIntensity = +e.target.value));
  document.getElementById("int_around").addEventListener("input", e => (aroIntensity = +e.target.value));
  document.getElementById("protectBlack").addEventListener("change", e => (protectBlack = e.target.checked));
  document.getElementById("protectWhite").addEventListener("change", e => (protectWhite = e.target.checked));
  document.getElementById("gbcSnap").addEventListener("change", e => (gbcMode = e.target.checked));
  // per-layer params: same wiring for the surface and the around layer
  for (const lay of ["surf", "aro"]) {
    const P = layerFx[lay];
    document.getElementById(lay + "_speed").addEventListener("input", e => (P.speed = +e.target.value));
    document.getElementById(lay + "_seed").addEventListener("input", e => (P.seed = +e.target.value));
    document.getElementById(lay + "_tex").addEventListener("input", e => (P.scale = +e.target.value));
    document.getElementById(lay + "_seedRand").addEventListener("click", () => {
      P.seed = Math.floor(Math.random() * 257);
      document.getElementById(lay + "_seed").value = P.seed;
    });
    const seg = document.getElementById("tintSeg_" + lay);
    const colorIn = document.getElementById("fxcolor_" + lay);
    seg.querySelectorAll("button").forEach(btn =>
      btn.addEventListener("click", () => {
        seg.querySelectorAll("button").forEach(x => x.classList.remove("on"));
        btn.classList.add("on");
        P.mode = btn.dataset.tint;
        colorIn.style.display = P.mode === "custom" ? "" : "none";
      }),
    );
    colorIn.addEventListener("input", e => {
      const h = e.target.value;
      const hsv = rgb2hsv(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
      P.h = hsv[0];
      P.s = Math.max(0.5, hsv[1]);
      P.mode = "custom";
      seg.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.tint === "custom"));
    });
  }
  document.querySelectorAll("#bgSeg button").forEach(b =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#bgSeg button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      document.getElementById("stage").className = "stage " + b.dataset.bg;
    }),
  );
  document.getElementById("clear").addEventListener("click", () => {
    slots.palette = "base";
    slots.surface = "";
    slots.around = "";
    slots.exotic = "";
    slots.rig = "";
    slots.moment = "";
    refreshHero();
  });
  document.getElementById("surprise").addEventListener("click", () => {
    const pick = a => a[Math.floor(Math.random() * a.length)];
    slots.palette = pick(ALL_PALETTE);
    slots.surface = Math.random() < 0.5 ? "" : pick(ALL_AURA);
    slots.around = Math.random() < 0.4 ? "" : pick(ALL_AROUND);
    slots.exotic = Math.random() < 0.3 ? pick(ALL_EXOTIC) : "";
    slots.rig = Math.random() < 0.22 ? pick(ALL_RIG) : "";
    slots.moment = Math.random() < 0.18 ? pick(ALL_MOMENT) : "";
    refreshHero();
  });
}

// ---- species picker ----------------------------------------------------------
function pickSpecies(id) {
  loadSpecies(id)
    .then(() => {
      const s = SPECIES.find(x => x.i === id);
      document.getElementById("mon").value = s ? `${s.n} #${id}` : "#" + id;
    })
    .catch(() => status("#" + id + " not found"));
}
function stepSpecies(d) {
  const idx = SPECIES.findIndex(s => s.i === curSpecies);
  const n = (idx + d + SPECIES.length) % SPECIES.length;
  pickSpecies(SPECIES[n].i);
}
function buildPicker() {
  const dl = document.getElementById("monlist");
  SPECIES.forEach(s => dl.appendChild(new Option(`${s.n} #${s.i}`)));
  const inp = document.getElementById("mon");
  inp.addEventListener("change", () => {
    const m = inp.value.match(/#(\d+)/) || inp.value.match(/^\s*(\d+)\s*$/);
    const id = m ? +m[1] : (SPECIES.find(s => s.n.toLowerCase() === inp.value.trim().toLowerCase()) || {}).i;
    if (id) {
      pickSpecies(id);
    }
  });
  document.getElementById("monPrev").onclick = () => stepSpecies(-1);
  document.getElementById("monNext").onclick = () => stepSpecies(1);
  document.getElementById("monRand").onclick = () => pickSpecies(SPECIES[Math.floor(Math.random() * SPECIES.length)].i);
}

// ---- loop --------------------------------------------------------------------
let lastThumb = 0;
let rr = 0;
let fxRr = 0;
function lookSig() {
  return `${curSpecies}|${slots.palette}|${slots.surface}|${slots.around}|${clusterAlgo}`;
}
function exoEnv(t, EW, EH, ox, oy, dist, compact) {
  let ld = null;
  return {
    t,
    look: lookCv,
    ring: ringGet,
    lookData: () => ld || (ld = lookCtx.getImageData(0, 0, PW, PH)),
    baseAlpha: getBaseAlpha,
    PW,
    PH,
    EW,
    EH,
    ox,
    oy,
    cx: dist.cx * PW,
    cy: dist.cy * PH,
    fy: dist.fy * PH,
    seed: layerFx.aro.seed + curSpecies,
    compact,
    species: curSpecies,
    sig: lookSig(),
    evo: evoInfoFor(curSpecies),
    aux: auxLook,
    types: (LAB.types && LAB.types[curSpecies]) || [],
    name: (SPECIES.find(s => s.i === curSpecies) || {}).n || "POKEMON",
    bg: compact ? "void" : (stageEl.className.match(/stage (\w+)/) || [])[1] || "void",
    cursor:
      !compact && cursorCss.active && heroCv.offsetWidth > 0
        ? {
            x: cursorCss.x / (heroCv.offsetWidth / PW),
            y: cursorCss.y / (heroCv.offsetWidth / PW),
            active: true,
          }
        : null,
  };
}
// exotic + rig + moment sandwich around the composited look
function drawFxScene(ctx2, sl, env) {
  const ex = EXOTIC[sl.exotic];
  const rg = EXOTIC[sl.rig];
  const mo = EXOTIC[sl.moment];
  ctx2.clearRect(0, 0, env.EW, env.EH);
  ctx2.imageSmoothingEnabled = false;
  if (ex && ex.behind) {
    ex.behind(ctx2, env);
  }
  if (mo && mo.behind) {
    mo.behind(ctx2, env);
  }
  if (!(mo && mo.hidesBase && mo.hidesBase(env))) {
    if (rg) {
      rg.draw(ctx2, env);
    } else {
      ctx2.drawImage(lookCv, env.ox, env.oy);
    }
  }
  if (ex && ex.front) {
    ex.front(ctx2, env);
  }
  if (mo && mo.front) {
    mo.front(ctx2, env);
  }
}
function loop(now) {
  requestAnimationFrame(loop);
  if (frameBuf.length === 0 || !heroImg || !lookCv || tiles.length === 0) {
    return;
  }
  const t = now / 1000;
  const ai = Math.floor(t * 12) % frameBuf.length;
  const cur = frameBuf[ai];
  const ef = edgeFor(ai);
  const dist = distFor(ai);
  const fxp = fxLayerState();
  // 1) composite the classic 3-slot look into the look canvas (per-pixel pass)
  renderLook(slots, cur, ef, dist, t * speed, heroImg.data, { pal: palIntensity, surf: surfIntensity, aro: aroIntensity }, fxp);
  lookCtx.putImageData(heroImg, 0, 0);
  // 2) frame-history ring capture (~80ms cadence) for the exotic layer
  if (now - lastRingCap > 80) {
    lastRingCap = now;
    ringHead = (ringHead + 1) % RING_N;
    const rc = ringCv[ringHead].getContext("2d");
    rc.clearRect(0, 0, PW, PH);
    rc.drawImage(lookCv, 0, 0);
  }
  // 3) hero: plain look on the hero canvas, OR the full fx scene on the stage
  // overlay (same on-screen pixel scale - the mon NEVER changes size)
  const anyFx = slots.exotic || slots.rig || slots.moment;
  if (anyFx && syncFxOverlay()) {
    if (!fxShown) {
      fxShown = true;
      heroCv.style.visibility = "hidden";
      fxCv.style.display = "block";
    }
    drawFxScene(fxCtx, slots, exoEnv(t * speed, fxCv.width, fxCv.height, fxOx, fxOy, dist, false));
  } else {
    if (fxShown) {
      fxShown = false;
      heroCv.style.visibility = "";
      fxCv.style.display = "none";
    }
    heroCtx.putImageData(heroImg, 0, 0);
  }
  if (now - lastThumb > 60) {
    lastThumb = now;
    const vis = tiles.filter(tl => tl.vis && !tl.fx);
    const N = Math.min(vis.length, 16);
    for (let j = 0; j < N; j++) {
      const tl = vis[(rr + j) % vis.length];
      renderLook(tl.slots, cur, ef, dist, t, tl.img.data, { pal: 1, surf: 1, aro: 1 }, fxp);
      tl.ctx.putImageData(tl.img, 0, 0);
    }
    rr = vis.length > 0 ? (rr + N) % vis.length : 0;
    // fx tiles preview their effect applied to the CURRENT hero look (cheap 2D ops);
    // round-robin a bounded batch per tick (the registry is large now); moments run
    // slightly time-compressed so the tile shows action sooner
    const fxVis = tiles.filter(tl => tl.fx && tl.vis);
    const FN = Math.min(fxVis.length, 12);
    for (let j = 0; j < FN; j++) {
      const tl = fxVis[(fxRr + j) % fxVis.length];
      const tt = tl.fx.moment ? t * 1.7 : t;
      drawFxScene(tl.ctx, { exotic: "", rig: "", moment: "", ...tl.fx }, exoEnv(tt, PW, PH, 0, 0, dist, true));
    }
    fxRr = fxVis.length > 0 ? (fxRr + FN) % fxVis.length : 0;
  }
}

// ---- boot --------------------------------------------------------------------
buildGallery();
wireControls();
buildPicker();
refreshHero();
pickSpecies(LAB.def);
requestAnimationFrame(loop);
