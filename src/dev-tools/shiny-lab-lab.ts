/**
 * DEV-ONLY exotic-FX laboratory for the Shiny Lab.
 *
 * This module re-implements the EXACT compositing pipeline of
 * {@linkcode renderErShinyLabLook} (palette -> surface -> around-overlay /
 * around, same blend modes, same amounts math, same protect-black/white
 * handling) while keeping the effect TABLES open: prototypes register into
 * the PALETTE / AURA / AROUND objects under `lab:` ids and are rendered by
 * the real production code path here, never by an approximate stand-in.
 *
 * It also hosts the generic renderer extensions the exotic work needs:
 *   - stable animation-wide anchors (fxGroup / frameCx vs stableCx) that kill
 *     the per-frame centroid wobble of the stock renderer
 *   - inside-distance (SDF), edge normals, tangents, midline field, matcap
 *     relief field, deterministic per-pixel identity
 * All extension fields are cached per (source object, pad) in the same
 * WeakMap pattern as production prep, so prototypes share them.
 *
 * PRODUCTION SAFETY: nothing here mutates PALETTE_IDS / SURFACE_IDS /
 * AROUND_IDS, and production callers never import this module. Prototypes
 * live behind `lab:` ids; only curated effects graduate to the real registry
 * (append-only) in Phase D.
 */

import type { ErShinyLabLoadout, ErShinyLabParams } from "#data/elite-redux/er-shiny-lab-effects";
import {
  AROUND,
  AROUND_OVERLAY,
  AURA,
  blendCol,
  clamp,
  clusterRank,
  computeClusters,
  computeDist,
  computeEdge,
  mix,
  NO_TINT,
  PALETTE,
  PALETTE_ALPHA,
  rgb2hsv,
  SURFACE_BLEND,
  setFxParams,
  tintTo,
  vnoise,
} from "#data/elite-redux/er-shiny-lab-fx";
import type { ErShinyLabRenderedPixels, ErShinyLabSourcePixels } from "#data/elite-redux/er-shiny-lab-renderer";

// ---------------------------------------------------------------------------
// Lab context types
// ---------------------------------------------------------------------------

/** Anchors: frame-local (wobbles across an animation) and group-stable. */
export interface LabAnchors {
  cx: number;
  cy: number;
  fy: number;
  frameCx: number;
  frameCy: number;
  frameFy: number;
  stableCx: number;
  stableCy: number;
  stableFy: number;
}

/** Per-pixel topology fields, in SOURCE pixel space (W x H). */
export interface LabTopology {
  /** Inside-distance in pixels (0 outside, grows inward). */
  sdf: Float32Array;
  /** Interior Voronoi border proximity, 1 ON a medial border -> 0 away. */
  voro: Float32Array;
  /** Outward unit normal (x), meaningful near the silhouette. */
  nx: Float32Array;
  /** Outward unit normal (y). */
  ny: Float32Array;
  /** Unit tangent along the silhouette (x). */
  tx: Float32Array;
  /** Unit tangent along the silhouette (y). */
  ty: Float32Array;
  /** Matcap-ish relief sphere z in [0,1] from the inside-distance. */
  matcapZ: Float32Array;
  /** Deterministic per-pixel identity hash in [0,1). */
  pixId: Float32Array;
}

/** Alpha + color sampler bound to one frame's raw buffer. */
export type LabSampler = (x: number, y: number) => number[];

/** Full context handed to lab effects (superset of the production ctx). */
export interface LabFxContext {
  // production FxContext shape
  e: number;
  sa: LabSampler;
  W: number;
  H: number;
  K: number;
  clRank: (r: number, g: number, b: number) => number;
  clColor: (i: number) => number[];
  // lab extensions (populated once per render)
  topo: LabTopology | null;
  anchors: LabAnchors | null;
  /** Sample another frame of the same animation group by 0-based index. */
  frameSample: (index: number, x: number, y: number) => number[];
  frameCount: number;
  frameIndex: number;
  /** Pixel-space fields for the CURRENT source pixel (set per pixel). */
  px: number;
  py: number;
}

// ---------------------------------------------------------------------------
// Extension prep cache (same WeakMap pattern as production)
// ---------------------------------------------------------------------------

interface LabPrep {
  buf: Float32Array;
  ef: Float32Array;
  dist: ReturnType<typeof computeDist>;
  clusters: ReturnType<typeof computeClusters>;
  topo: LabTopology;
}

const labPrepCache = new WeakMap<ErShinyLabSourcePixels, Map<number, LabPrep>>();

const INSIDE_INF = 1e6;

/** Two-pass chamfer INSIDE distance (0 outside -> grows inward). */
function computeInsideDist(buf: Float32Array, W: number, H: number): Float32Array {
  const d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      d[y * W + x] = buf[(y * W + x) * 4 + 3] > 0.02 ? INSIDE_INF : 0;
    }
  }
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
  return d;
}

/**
 * Interior Voronoi border field ("medial axis strength"): seed = nearest edge
 * pixel, propagated with the chamfer; where the two nearest seed ids differ,
 * the pixel sits on an internal midline between limbs/edges. Value is 1 on the
 * midline, decaying to 0 over ~5 px so filigree can ride it.
 */
function computeVoroField(buf: Float32Array, W: number, H: number): Float32Array {
  const N = W * H;
  const seed = new Int32Array(N);
  const dist = new Float32Array(N);
  let nextSeed = 1;
  // Seed every edge pixel (inside pixel adjacent to outside).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (buf[i * 4 + 3] <= 0.02) {
        seed[i] = 0;
        dist[i] = 0;
        continue;
      }
      const edge =
        x === 0
        || y === 0
        || x === W - 1
        || y === H - 1
        || buf[(y * W + x - 1) * 4 + 3] <= 0.02
        || buf[(y * W + x + 1) * 4 + 3] <= 0.02
        || buf[((y - 1) * W + x) * 4 + 3] <= 0.02
        || buf[((y + 1) * W + x) * 4 + 3] <= 0.02;
      if (edge) {
        seed[i] = nextSeed++;
        dist[i] = 0;
      } else {
        seed[i] = -1;
        dist[i] = INSIDE_INF;
      }
    }
  }
  const spread = (x: number, y: number, nx: number, ny: number, w: number) => {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
      return;
    }
    const i = y * W + x;
    const j = ny * W + nx;
    if (seed[j] === 0) {
      return;
    }
    const nd = dist[i] + w;
    if (seed[i] > 0 && (seed[j] < 0 || nd < dist[j] - 0.5)) {
      seed[j] = seed[i];
      dist[j] = nd;
    }
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (seed[y * W + x] <= 0) {
        continue;
      }
      spread(x, y, x - 1, y, 1);
      spread(x, y, x, y - 1, 1);
      spread(x, y, x - 1, y - 1, Math.SQRT2);
      spread(x, y, x + 1, y - 1, Math.SQRT2);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      if (seed[y * W + x] <= 0) {
        continue;
      }
      spread(x, y, x + 1, y, 1);
      spread(x, y, x, y + 1, 1);
      spread(x, y, x + 1, y + 1, Math.SQRT2);
      spread(x, y, x - 1, y + 1, Math.SQRT2);
    }
  }
  // Border = inside pixel whose 4-neighbour carries a DIFFERENT seed.
  const border = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (seed[i] <= 0) {
        continue;
      }
      const s = seed[i];
      const diff =
        (x > 0 && seed[i - 1] > 0 && seed[i - 1] !== s)
        || (x < W - 1 && seed[i + 1] > 0 && seed[i + 1] !== s)
        || (y > 0 && seed[i - W] > 0 && seed[i - W] !== s)
        || (y < H - 1 && seed[i + W] > 0 && seed[i + W] !== s);
      if (diff) {
        border[i] = 1;
      }
    }
  }
  // Dilate the midline a few px so strokes have width; cheap box relax x2.
  for (let pass = 0; pass < 2; pass++) {
    const src = border.slice();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (src[i] > 0) {
          continue;
        }
        const m = Math.max(src[i - 1], src[i + 1], src[i - W], src[i + W]);
        if (m > 0) {
          border[i] = m * 0.55;
        }
      }
    }
  }
  return border;
}

/** Outward normals from the inside-distance gradient (central differences). */
function computeNormals(sdf: Float32Array, W: number, H: number) {
  const N = W * H;
  const nx = new Float32Array(N);
  const ny = new Float32Array(N);
  const tx = new Float32Array(N);
  const ty = new Float32Array(N);
  const at = (x: number, y: number) => {
    const cx = x < 0 ? 0 : x >= W ? W - 1 : x;
    const cy = y < 0 ? 0 : y >= H ? H - 1 : y;
    return sdf[cy * W + cx];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // sdf grows INWARD, so the outward normal is the negative gradient.
      const gx = at(x + 1, y) - at(x - 1, y);
      const gy = at(x, y + 1) - at(x, y - 1);
      const len = Math.hypot(gx, gy);
      if (len > 1e-5) {
        nx[i] = -gx / len;
        ny[i] = -gy / len;
        tx[i] = gy / len;
        ty[i] = -gx / len;
      }
    }
  }
  return { nx, ny, tx, ty };
}

function computeMatcapZ(sdf: Float32Array, W: number, H: number): Float32Array {
  const z = new Float32Array(W * H);
  const R = 12;
  for (let i = 0; i < W * H; i++) {
    const dd = Math.min(sdf[i], R) / R;
    z[i] = Math.sqrt(Math.max(0, 1 - (1 - dd) * (1 - dd)));
  }
  return z;
}

/** Deterministic per-pixel identity (integer lattice hash -> [0,1)). */
function computePixId(W: number, H: number): Float32Array {
  const id = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let h = (x * 0x85ebca6b) ^ (y * 0xc2b2ae35) ^ 0x27d4eb2f;
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
      h ^= h >>> 15;
      id[y * W + x] = (h >>> 0) / 4294967296;
    }
  }
  return id;
}

function toFloatBuffer(src: ErShinyLabSourcePixels): Float32Array | null {
  const count = src.width * src.height * 4;
  if (src.width <= 0 || src.height <= 0 || src.data.length < count) {
    return null;
  }
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 4) {
    out[i] = src.data[i] / 255;
    out[i + 1] = src.data[i + 1] / 255;
    out[i + 2] = src.data[i + 2] / 255;
    out[i + 3] = src.data[i + 3] / 255;
  }
  return out;
}

function getLabPrep(source: ErShinyLabSourcePixels, width: number, height: number, pad: number): LabPrep | null {
  let byPad = labPrepCache.get(source);
  if (!byPad) {
    byPad = new Map<number, LabPrep>();
    labPrepCache.set(source, byPad);
  }
  const cached = byPad.get(pad);
  if (cached) {
    return cached;
  }
  const buf = toFloatBuffer({ width, height, data: source.data });
  if (!buf) {
    return null;
  }
  const sdf = computeInsideDist(buf, width, height);
  const normals = computeNormals(sdf, width, height);
  const prep: LabPrep = {
    buf,
    ef: computeEdge(buf, width, height),
    dist: computeDist(buf, width, height, pad),
    clusters: computeClusters(buf, width, height, 5),
    topo: {
      sdf,
      voro: computeVoroField(buf, width, height),
      ...normals,
      matcapZ: computeMatcapZ(sdf, width, height),
      pixId: computePixId(width, height),
    },
  };
  byPad.set(pad, prep);
  return prep;
}

// ---------------------------------------------------------------------------
// Stable anchors across an animation group
// ---------------------------------------------------------------------------

interface LabGroup {
  frames: ErShinyLabSourcePixels[];
  anchors: LabAnchors | null;
}

const labGroups = new Map<string, LabGroup>();

/**
 * Register an animation's frames under a key. All frames rendered with that
 * `fxGroup` share ONE anchor: the union-silhouette centroid + union feet line
 * across every frame, so landmark-driven geometry stops wobbling. Frame-local
 * anchors stay available as frameCx/frameCy/frameFy for effects that want
 * body-following behavior.
 */
export function registerLabGroup(key: string, frames: ErShinyLabSourcePixels[]): void {
  labGroups.set(key, { frames, anchors: null });
}

export function clearLabGroups(): void {
  labGroups.clear();
}

function anchorsForGroup(group: LabGroup, pad: number): LabAnchors | null {
  if (group.anchors) {
    return group.anchors;
  }
  let sx = 0;
  let sy = 0;
  let cnt = 0;
  let maxY = -1;
  let PW = 0;
  let PH = 0;
  for (const frame of group.frames) {
    const prep = getLabPrep(frame, Math.floor(frame.width), Math.floor(frame.height), pad);
    if (!prep) {
      continue;
    }
    PW = prep.dist.PW;
    PH = prep.dist.PH;
    const buf = prep.buf;
    const fw = Math.floor(frame.width);
    const fh = Math.floor(frame.height);
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        if (buf[(y * fw + x) * 4 + 3] > 0.02) {
          sx += x + pad;
          sy += y + pad;
          cnt++;
          if (y + pad > maxY) {
            maxY = y + pad;
          }
        }
      }
    }
  }
  if (!cnt || !PW || !PH) {
    return null;
  }
  group.anchors = {
    cx: sx / cnt / PW,
    cy: sy / cnt / PH,
    fy: (maxY + 1) / PH,
    frameCx: 0.5,
    frameCy: 0.45,
    frameFy: 0.82,
    stableCx: sx / cnt / PW,
    stableCy: sy / cnt / PH,
    stableFy: (maxY + 1) / PH,
  };
  return group.anchors;
}

// ---------------------------------------------------------------------------
// Lab options + render (production-identical compositing)
// ---------------------------------------------------------------------------

export interface LabRenderOptions {
  pad?: number;
  /** Animation group key (see registerLabGroup) - enables stable anchors. */
  fxGroup?: string;
  /** Extra per-render time in seconds (added to `time`). */
  tOffset?: number;
}

function makeSampler(buf: Float32Array, width: number, height: number): LabSampler {
  return (x, y) => {
    const xi = Math.max(0, Math.min(width - 1, Math.round(x * width)));
    const yi = Math.max(0, Math.min(height - 1, Math.round(y * height)));
    const i = (yi * width + xi) * 4;
    return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
  };
}

function isProtectedPalettePixel(r: number, g: number, b: number, a: number, params: ErShinyLabParams): boolean {
  if (a <= 0.02) {
    return false;
  }
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const achromatic = mx - mn <= 0.06;
  return (!!params.protectBlack && achromatic && mx <= 0.14) || (!!params.protectWhite && achromatic && mn >= 0.86);
}

function resolvePaletteTint(
  paletteId: string | null,
  ctx: LabFxContext,
  clusters: { cent: number[][] } | null,
): [number, number] {
  let best = -1;
  let tintH = 0.58;
  let tintS = 0.85;
  const refs = clusters
    ? clusters.cent
    : [
        [0.3, 0.4, 0.6],
        [0.6, 0.7, 0.95],
      ];
  for (const cen of refs) {
    const c = paletteId ? PALETTE[paletteId](cen[0], cen[1], cen[2], ctx) : cen;
    const hsv = rgb2hsv(c[0], c[1], c[2]);
    if (hsv[1] * hsv[2] > best) {
      best = hsv[1] * hsv[2];
      tintH = hsv[0];
      tintS = Math.max(0.5, hsv[1]);
    }
  }
  return [tintH, tintS];
}

/**
 * The production compositor, verbatim, with the lab context grafted on. Any
 * effect id resolvable in the REAL PALETTE / AURA / AROUND tables renders
 * exactly as the game renders it; `lab:` ids work because prototypes register
 * into those same tables.
 */
export function renderLabLook(
  source: ErShinyLabSourcePixels,
  slots: ErShinyLabLoadout,
  params: ErShinyLabParams,
  time = 0,
  options?: LabRenderOptions,
): ErShinyLabRenderedPixels | null {
  const fw = Math.floor(source.width);
  const fh = Math.floor(source.height);
  const pad = Math.max(0, Math.floor(options?.pad ?? 22));
  const prep = getLabPrep(source, fw, fh, pad);
  if (!prep) {
    return null;
  }

  const { buf, ef, dist, clusters, topo } = prep;
  const pw = fw + 2 * pad;
  const ph = fh + 2 * pad;
  const out = new Uint8ClampedArray(pw * ph * 4);
  const rawSa = makeSampler(buf, fw, fh);
  const amounts = {
    pal: clamp(params.palAmt ?? 1),
    surf: clamp(params.surfAmt ?? 1),
    aro: clamp(params.aroAmt ?? 1),
  };

  setFxParams(params.seed ?? 0, params.scale ?? 1);
  const t = (time + (options?.tOffset ?? 0)) * clamp(params.speed ?? 1, 0.1, 4);
  const auraSize = clamp(params.auraSize ?? 1, 0.3, 3);

  // Anchors: group-stable if a group is registered, else frame-local (with the
  // stable slots mirroring the frame ones so effects can use either).
  const group = options?.fxGroup ? labGroups.get(options.fxGroup) : undefined;
  const groupAnchors = group ? anchorsForGroup(group, pad) : null;
  const frameCx = dist.cx;
  const frameCy = dist.cy;
  const frameFy = dist.fy;
  const anchors: LabAnchors = {
    cx: groupAnchors?.cx ?? frameCx,
    cy: groupAnchors?.cy ?? frameCy,
    fy: groupAnchors?.fy ?? frameFy,
    frameCx,
    frameCy,
    frameFy,
    stableCx: groupAnchors?.stableCx ?? frameCx,
    stableCy: groupAnchors?.stableCy ?? frameCy,
    stableFy: groupAnchors?.stableFy ?? frameFy,
  };

  const frameSamplers: LabSampler[] = [];
  if (group) {
    for (const f of group.frames) {
      const fp = getLabPrep(f, Math.floor(f.width), Math.floor(f.height), pad);
      frameSamplers.push(fp ? makeSampler(fp.buf, Math.floor(f.width), Math.floor(f.height)) : () => [0, 0, 0, 0]);
    }
  }
  const frameIndex = group ? Math.max(0, group.frames.indexOf(source)) : 0;

  const ctx: LabFxContext = {
    e: 0,
    sa: rawSa,
    W: fw,
    H: fh,
    K: clusters?.K ?? 1,
    clRank: (r, g, b) => (clusters ? clusterRank(clusters, r, g, b) : 0),
    clColor: i => (clusters ? clusters.cent[i] : [0.5, 0.5, 0.5]),
    topo,
    anchors,
    frameSample: (index, x, y) => {
      const s = frameSamplers[((index % frameSamplers.length) + frameSamplers.length) % frameSamplers.length];
      return s ? s(x, y) : [0, 0, 0, 0];
    },
    frameCount: frameSamplers.length,
    frameIndex,
    px: 0,
    py: 0,
  };
  const pal = slots.palette && slots.palette !== "base" && PALETTE[slots.palette] ? slots.palette : null;
  const surf = slots.surface && AURA[slots.surface] ? slots.surface : null;
  const aro = slots.around && AROUND[slots.around] ? slots.around : null;
  const sa = pal
    ? (x: number, y: number) => {
        const s = rawSa(x, y);
        if (s[3] <= 0.02) {
          return s;
        }
        if (isProtectedPalettePixel(s[0], s[1], s[2], s[3], params)) {
          return s;
        }
        const c = PALETTE[pal](s[0], s[1], s[2], ctx);
        return [c[0], c[1], c[2], s[3]];
      }
    : rawSa;
  ctx.sa = sa;

  const doTint = params.tintMode > 0;
  const [tintH, tintS] = params.tintMode === 1 ? resolvePaletteTint(pal, ctx, clusters) : [0.58, 0.85];

  const sprPad = (nx: number, ny: number): number[] => {
    const sx2 = Math.round(nx * pw - 0.5) - pad;
    const sy2 = Math.round(ny * ph - 0.5) - pad;
    if (sx2 < 0 || sy2 < 0 || sx2 >= fw || sy2 >= fh) {
      return [0, 0, 0, 0];
    }
    const i2 = (sy2 * fw + sx2) * 4;
    return [buf[i2], buf[i2 + 1], buf[i2 + 2], buf[i2 + 3]];
  };
  let mainCol: number[] | null = null;
  if (clusters) {
    let best = -1;
    for (const cen of clusters.cent) {
      const hsv = rgb2hsv(cen[0], cen[1], cen[2]);
      if (hsv[1] * hsv[2] > best) {
        best = hsv[1] * hsv[2];
        mainCol = cen;
      }
    }
  }
  const ac = {
    cx: anchors.cx,
    cy: anchors.cy,
    fy: anchors.fy,
    frameCx,
    frameCy,
    frameFy,
    stableCx: anchors.stableCx,
    stableCy: anchors.stableCy,
    stableFy: anchors.stableFy,
    spr: sprPad,
    main: mainCol,
    topo,
    frameSample: ctx.frameSample,
    frameCount: ctx.frameCount,
    frameIndex,
  };

  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      const k = (py * pw + px) * 4;
      const sx = px - pad;
      const sy = py - pad;
      const on = sx >= 0 && sy >= 0 && sx < fw && sy < fh && buf[(sy * fw + sx) * 4 + 3] > 0.02;
      if (on) {
        const i = (sy * fw + sx) * 4;
        const a0 = buf[i + 3];
        const x = (sx + 0.5) / fw;
        const y = (sy + 0.5) / fh;
        ctx.e = ef[sy * fw + sx];
        ctx.px = sx;
        ctx.py = sy;
        const r = buf[i];
        const g = buf[i + 1];
        const b = buf[i + 2];
        let a = a0;
        const protectPalettePixel = pal && isProtectedPalettePixel(r, g, b, a0, params);
        let col = pal && !protectPalettePixel ? PALETTE[pal](r, g, b, ctx) : [r, g, b];
        if (pal && !protectPalettePixel) {
          a = a0 * (PALETTE_ALPHA[pal] ?? 1);
          if (amounts.pal < 1) {
            col = [mix(r, col[0], amounts.pal), mix(g, col[1], amounts.pal), mix(b, col[2], amounts.pal)];
            a = mix(a0, a, amounts.pal);
          }
        }
        if (surf) {
          const base2 = col;
          const aPal = a;
          let sc: number[];
          if (surf === "prismatic") {
            const off = 0.012 * (0.6 + 0.4 * Math.sin(t * 2));
            sc = [sa(x + off, y)[0], col[1], sa(x - off, y)[2]];
          } else if (surf === "glitch") {
            const slice = Math.floor(y * 16);
            const rnd = vnoise(slice * 3.1 + 0.5, Math.floor(t * 8) * 1.3 + 0.5);
            const dx = rnd > 0.62 ? (vnoise(slice + 9, Math.floor(t * 8)) - 0.5) * 0.14 : 0;
            const s2 = sa(x + dx, y);
            if (s2[3] <= 0.02) {
              out[k + 3] = 0;
              continue;
            }
            const scan = py % 3 === 0 ? 0.6 : 1;
            sc = [sa(x + dx + 0.01, y)[0] * scan, s2[1] * scan, sa(x + dx - 0.01, y)[2] * scan];
            a = s2[3];
          } else {
            const res = AURA[surf](base2[0], base2[1], base2[2], x, y, t, ctx);
            sc = [res[0], res[1], res[2]];
            a = aPal * res[3];
          }
          if (doTint && !NO_TINT.has(surf)) {
            sc = tintTo(sc, tintH, tintS);
          }
          let blended = blendCol(base2, sc, SURFACE_BLEND[surf] || "normal");
          if (amounts.surf < 1) {
            blended = [
              mix(base2[0], blended[0], amounts.surf),
              mix(base2[1], blended[1], amounts.surf),
              mix(base2[2], blended[2], amounts.surf),
            ];
            a = mix(aPal, a, amounts.surf);
          }
          col = blended;
        }
        if (aro && AROUND_OVERLAY.has(aro)) {
          const nx = (px + 0.5) / pw;
          const ny = (py + 0.5) / ph;
          const res = AROUND[aro](nx, ny, 0, t, ac);
          let rc = [res[0], res[1], res[2]];
          if (doTint && !NO_TINT.has(aro)) {
            rc = tintTo(rc, tintH, tintS);
          }
          const oa = res[3] * amounts.aro;
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
        const nx = (px + 0.5) / pw;
        const ny = (py + 0.5) / ph;
        const df = dist.d[py * pw + px] / auraSize;
        const res = AROUND[aro](nx, ny, df, t, ac);
        let rc = [res[0], res[1], res[2]];
        if (doTint && !NO_TINT.has(aro)) {
          rc = tintTo(rc, tintH, tintS);
        }
        out[k] = rc[0] * 255;
        out[k + 1] = rc[1] * 255;
        out[k + 2] = rc[2] * 255;
        out[k + 3] = res[3] * amounts.aro * 255;
      } else {
        out[k + 3] = 0;
      }
    }
  }

  return { width: pw, height: ph, padding: pad, data: out };
}

// ---------------------------------------------------------------------------
// Prototype registration (into the REAL tables, under lab: ids)
// ---------------------------------------------------------------------------

export interface LabPrototype {
  id: string;
  category: "palette" | "surface" | "around";
  label: string;
  mechanism: string;
  fn: (...args: number[]) => number[];
  /** Around effects that must composite over the sprite front too. */
  overlay?: boolean;
}

const registered: LabPrototype[] = [];

export function registerLabPrototype(proto: LabPrototype): void {
  const id = `lab:${proto.id}`;
  if (proto.category === "palette") {
    PALETTE[id] = proto.fn;
  } else if (proto.category === "surface") {
    AURA[id] = proto.fn;
  } else {
    AROUND[id] = proto.fn;
    if (proto.overlay) {
      AROUND_OVERLAY.add(id);
    }
  }
  registered.push({ ...proto, id });
}

export function listLabPrototypes(): readonly LabPrototype[] {
  return registered;
}
