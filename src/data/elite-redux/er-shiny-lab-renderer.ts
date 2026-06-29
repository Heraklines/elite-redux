import type { ErShinyLabLoadout, ErShinyLabParams } from "#data/elite-redux/er-shiny-lab-effects";
import {
  AROUND,
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
  setFxParams,
  SURFACE_BLEND,
  tintTo,
  vnoise,
} from "#data/elite-redux/er-shiny-lab-fx";

export const ER_SHINY_LAB_RENDER_PAD = 22;

interface RenderOptions {
  pad?: number;
}

export interface ErShinyLabSourcePixels {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface ErShinyLabRenderedPixels {
  width: number;
  height: number;
  padding: number;
  data: Uint8ClampedArray;
}

interface RenderAmounts {
  pal: number;
  surf: number;
  aro: number;
}

interface RenderPrep {
  buf: Float32Array;
  ef: Float32Array;
  dist: ReturnType<typeof computeDist>;
  clusters: ReturnType<typeof computeClusters>;
}

type FxContext = {
  e: number;
  sa: (x: number, y: number) => number[];
  W: number;
  H: number;
  K: number;
  clRank: (r: number, g: number, b: number) => number;
  clColor: (i: number) => number[];
};

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

const renderPrepCache = new WeakMap<ErShinyLabSourcePixels, Map<number, RenderPrep>>();

function getRenderPrep(source: ErShinyLabSourcePixels, width: number, height: number, pad: number): RenderPrep | null {
  let byPad = renderPrepCache.get(source);
  if (!byPad) {
    byPad = new Map<number, RenderPrep>();
    renderPrepCache.set(source, byPad);
  }

  const cached = byPad.get(pad);
  if (cached) {
    return cached;
  }

  const buf = toFloatBuffer({ width, height, data: source.data });
  if (!buf) {
    return null;
  }

  const prep: RenderPrep = {
    buf,
    ef: computeEdge(buf, width, height),
    dist: computeDist(buf, width, height, pad),
    clusters: computeClusters(buf, width, height, 5),
  };
  byPad.set(pad, prep);
  return prep;
}

function makeSampler(buf: Float32Array, width: number, height: number): (x: number, y: number) => number[] {
  return (x, y) => {
    const xi = Math.max(0, Math.min(width - 1, Math.round(x * width)));
    const yi = Math.max(0, Math.min(height - 1, Math.round(y * height)));
    const i = (yi * width + xi) * 4;
    return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
  };
}

function amountsFromParams(params: ErShinyLabParams): RenderAmounts {
  return {
    pal: clamp(params.palAmt ?? 1),
    surf: clamp(params.surfAmt ?? 1),
    aro: clamp(params.aroAmt ?? 1),
  };
}

function isProtectedPalettePixel(r: number, g: number, b: number, a: number, params: ErShinyLabParams): boolean {
  if (a <= 0.02) {
    return false;
  }
  return (
    (!!params.protectBlack && Math.max(r, g, b) <= 0.06)
    || (!!params.protectWhite && Math.min(r, g, b) >= 0.94)
  );
}

function resolvePaletteTint(
  paletteId: string | null,
  ctx: FxContext,
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

export function renderErShinyLabLook(
  source: ErShinyLabSourcePixels,
  slots: ErShinyLabLoadout,
  params: ErShinyLabParams,
  time = 0,
  options?: RenderOptions,
): ErShinyLabRenderedPixels | null {
  const fw = Math.floor(source.width);
  const fh = Math.floor(source.height);
  const pad = Math.max(0, Math.floor(options?.pad ?? ER_SHINY_LAB_RENDER_PAD));
  const prep = getRenderPrep(source, fw, fh, pad);
  if (!prep) {
    return null;
  }

  const { buf, ef, dist, clusters } = prep;
  const pw = fw + 2 * pad;
  const ph = fh + 2 * pad;
  const out = new Uint8ClampedArray(pw * ph * 4);
  const rawSa = makeSampler(buf, fw, fh);
  const amounts = amountsFromParams(params);

  setFxParams(params.seed ?? 0, params.scale ?? 1);

  const ctx: FxContext = {
    e: 0,
    sa: rawSa,
    W: fw,
    H: fh,
    K: clusters?.K ?? 1,
    clRank: (r, g, b) => (clusters ? clusterRank(clusters, r, g, b) : 0),
    clColor: i => (clusters ? clusters.cent[i] : [0.5, 0.5, 0.5]),
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
  const ac = { cx: dist.cx, cy: dist.cy };

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
            const off = 0.012 * (0.6 + 0.4 * Math.sin(time * 2));
            sc = [sa(x + off, y)[0], col[1], sa(x - off, y)[2]];
          } else if (surf === "glitch") {
            const slice = Math.floor(y * 16);
            const rnd = vnoise(slice * 3.1 + 0.5, Math.floor(time * 8) * 1.3 + 0.5);
            const dx = rnd > 0.62 ? (vnoise(slice + 9, Math.floor(time * 8)) - 0.5) * 0.14 : 0;
            const s2 = sa(x + dx, y);
            if (s2[3] <= 0.02) {
              out[k + 3] = 0;
              continue;
            }
            const scan = py % 3 === 0 ? 0.6 : 1;
            sc = [sa(x + dx + 0.01, y)[0] * scan, s2[1] * scan, sa(x + dx - 0.01, y)[2] * scan];
            a = s2[3];
          } else {
            const res = AURA[surf](base2[0], base2[1], base2[2], x, y, time, ctx);
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
        out[k] = col[0] * 255;
        out[k + 1] = col[1] * 255;
        out[k + 2] = col[2] * 255;
        out[k + 3] = a * 255;
      } else if (aro) {
        const nx = (px + 0.5) / pw;
        const ny = (py + 0.5) / ph;
        const df = dist.d[py * pw + px];
        const res = AROUND[aro](nx, ny, df, time, ac);
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
