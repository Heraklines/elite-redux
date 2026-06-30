/* Fusion Lab - APPROACH 2: VERTICAL-BAND AUTOGEN (the original Pokemon Infinite
 * Fusion method). Take A's HEAD band (rows above A's neck pinch) + B's BODY band
 * (rows below B's neck pinch), width-match the head to the body at the neck,
 * stack them neck-on-neck, dither-blend the seam, harmonize the head toward B's
 * palette, and re-ink one 1px outline from the final alpha. The proven baseline.
 *
 * Plugin contract (see strategies/_example.mjs): single-line ESM import of the
 * shared STRATEGIES registry + the exported primitives; DOM-free rgba in/out;
 * NEVER throws (try/catch -> returns B unchanged with meta.rung='fallback').
 *
 * NOTE on naming: build-site.mjs strips the import line and inlines this file
 * into ONE script scope shared with fusion.mjs (export-stripped) and every other
 * strategy. So all module-level helpers here are `bsw`-prefixed to avoid clashing
 * with fusion.mjs internals (maskBBox/erode4/clamp/...) or sibling strategies. */

import { STRATEGIES, maskOf, srgbToOklab, oklabToSrgb, quantizeOklab } from "../fusion.mjs";

// 4x4 ordered (Bayer) dither matrix for the seam blend.
const BSW_BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const bswClamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function bswBlank(w, h) {
  return new Uint8ClampedArray(w * h * 4);
}

// foreground bbox of a 0/1 mask, or null when empty.
function bswBBox(mask, w, h) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < x0) {
          x0 = x;
        }
        if (x > x1) {
          x1 = x;
        }
        if (y < y0) {
          y0 = y;
        }
        if (y > y1) {
          y1 = y;
        }
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/* bswNeck - the neck line of a sprite: the row of locally-minimal foreground
 * width inside the upper [lo,hi] band of the fg bbox (the head/body pinch).
 * Returns { y, width, cx, bbox }. Falls back to a fixed 0.42*bboxH fraction when
 * the window has no width variation (no clear minimum) or is empty. */
function bswNeck(mask, w, h, lo, hi) {
  const bb = bswBBox(mask, w, h);
  if (!bb) {
    return null;
  }
  const bh = bb.y1 - bb.y0;
  const rowAt = y => {
    let n = 0;
    let sx = 0;
    for (let x = bb.x0; x <= bb.x1; x++) {
      if (mask[y * w + x]) {
        n++;
        sx += x;
      }
    }
    return { n, cx: n ? sx / n : (bb.x0 + bb.x1) / 2 };
  };

  let yLo = Math.round(bb.y0 + lo * bh);
  let yHi = Math.round(bb.y0 + hi * bh);
  if (yHi < yLo) {
    const t = yLo;
    yLo = yHi;
    yHi = t;
  }
  yLo = bswClamp(yLo, bb.y0, bb.y1);
  yHi = bswClamp(yHi, bb.y0, bb.y1);

  // global-min width row within the search window = the pinch
  let bestY = -1;
  let bestW = Infinity;
  let mn = Infinity;
  let mx = -Infinity;
  for (let y = yLo; y <= yHi; y++) {
    const n = rowAt(y).n;
    if (n <= 0) {
      continue;
    }
    if (n < bestW) {
      bestW = n;
      bestY = y;
    }
    if (n < mn) {
      mn = n;
    }
    if (n > mx) {
      mx = n;
    }
  }

  // fallback: empty window or flat (no minimum) -> fixed fraction of bbox height
  if (bestY < 0 || !(mx > mn)) {
    bestY = bswClamp(Math.round(bb.y0 + 0.42 * bh), bb.y0, bb.y1);
  }

  let at = rowAt(bestY);
  // guarantee a non-empty neck row (scan downward if the fallback row is empty)
  if (at.n <= 0) {
    for (let y = bestY; y <= bb.y1; y++) {
      const a = rowAt(y);
      if (a.n > 0) {
        bestY = y;
        at = a;
        break;
      }
    }
  }
  return { y: bestY, width: Math.max(1, at.n), cx: at.cx, bbox: bb };
}

// 4-neighbour erosion (image-border pixels erode) - for the outline re-synth.
function bswErode4(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (mask[p] && mask[p - 1] && mask[p + 1] && mask[p - w] && mask[p + w]) {
        out[p] = 1;
      }
    }
  }
  return out;
}

// b-palette entries (lab + role + hue/chroma/L) for head harmonization. Roles
// mirror fusion.mjs rolesOf: ink (outline), shadow/highlight (ramp ends), mid.
function bswBEntries(bQuant) {
  const n = bQuant.palette.length;
  const roles = new Array(n).fill("mid");
  for (const k of bQuant.inkIndices) {
    roles[k] = "ink";
  }
  for (const fam of bQuant.rampRoles.values()) {
    if (fam.shadow != null) {
      roles[fam.shadow] = "shadow";
    }
    if (fam.highlight != null) {
      roles[fam.highlight] = "highlight";
    }
  }
  return bQuant.palette.map((lab, k) => ({
    lab,
    role: roles[k],
    hue: Math.atan2(lab[2], lab[1]),
    chroma: Math.hypot(lab[1], lab[2]),
    L: lab[0],
  }));
}

function bswHueDist(a, b) {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) {
    d = 2 * Math.PI - d;
  }
  return d;
}

/* bswHarmonize - steer a head OKLab toward B's palette family by `amt`, keeping
 * the head pixel's own L (preserves shading + light direction): pick B's nearest
 * entry by hue (chromatic) else by L (neutral/ink), lerp (a,b) chroma toward it.
 * So A's head reads as one creature with B's body, not a clip-art clash. */
function bswHarmonize(lab, bEntries, amt) {
  if (!bEntries.length || amt <= 0) {
    return lab;
  }
  const chroma = Math.hypot(lab[1], lab[2]);
  const hue = Math.atan2(lab[2], lab[1]);
  const chromatic = chroma > 0.02;
  let best = null;
  let bestD = Infinity;
  for (const e of bEntries) {
    const eChromatic = e.chroma > 0.02;
    const d =
      chromatic && eChromatic
        ? bswHueDist(hue, e.hue)
        : Math.abs(e.L - lab[0]) + (chromatic === eChromatic ? 0 : 0.5);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) {
    return lab;
  }
  return [lab[0], lab[1] + amt * (best.lab[1] - lab[1]), lab[2] + amt * (best.lab[2] - lab[2])];
}

// dimmed copy of an rgba buffer so overlay markers pop (debug layers).
function bswDim(rgba) {
  const o = new Uint8ClampedArray(rgba);
  for (let i = 0; i < o.length; i += 4) {
    o[i] = (o[i] * 0.4) | 0;
    o[i + 1] = (o[i + 1] * 0.4) | 0;
    o[i + 2] = (o[i + 2] * 0.4) | 0;
  }
  return o;
}

// dimmed sprite + a yellow horizontal neck line across the bbox (debug layer).
function bswNeckOverlay(rgba, w, h, neckY, bb) {
  const out = bswDim(rgba);
  const x0 = bb ? Math.max(0, bb.x0 - 1) : 0;
  const x1 = bb ? Math.min(w - 1, bb.x1 + 1) : w - 1;
  if (neckY >= 0 && neckY < h) {
    for (let x = x0; x <= x1; x++) {
      const i = (neckY * w + x) * 4;
      out[i] = 255;
      out[i + 1] = 210;
      out[i + 2] = 80;
      out[i + 3] = 255;
    }
  }
  return out;
}

// merged buffer with the seam band tinted, so the dither transition is visible.
function bswSeamOverlay(merged, w, h, bandTop, bandBot) {
  const out = new Uint8ClampedArray(merged);
  const y0 = Math.max(0, bandTop);
  const y1 = Math.min(h, bandBot);
  for (let oy = y0; oy < y1; oy++) {
    for (let ox = 0; ox < w; ox++) {
      const i = (oy * w + ox) * 4;
      if (out[i + 3] <= 24) {
        out[i] = 80;
        out[i + 1] = 40;
        out[i + 2] = 90;
        out[i + 3] = 90;
      } else {
        out[i] = Math.min(255, out[i] + 40);
      }
    }
  }
  return out;
}

export const bandswapStrategy = {
  id: "bandswap",
  label: "Band-swap (IF autogen)",
  params: [
    { key: "neckSearchLo", label: "Neck search lo", min: 0, max: 0.5, step: 0.01, default: 0.2 },
    { key: "neckSearchHi", label: "Neck search hi", min: 0.3, max: 0.8, step: 0.01, default: 0.55 },
    { key: "harmonize", label: "Harmonize", min: 0, max: 1, step: 0.02, default: 0.4 },
    { key: "seamPx", label: "Seam px", min: 0, max: 4, step: 1, default: 2 },
  ],
  fuse(a, b, params) {
    const fallback = reason => ({
      width: b.width,
      height: b.height,
      rgba: new Uint8ClampedArray(b.rgba),
      layers: [
        { label: "final", width: b.width, height: b.height, rgba: new Uint8ClampedArray(b.rgba) },
      ],
      meta: { rung: "fallback", reason },
    });

    try {
      const lo = bswClamp(params?.neckSearchLo ?? 0.2, 0, 0.9);
      const hi = bswClamp(params?.neckSearchHi ?? 0.55, 0, 0.95);
      const harmonize = bswClamp(params?.harmonize ?? 0.4, 0, 1);
      const seamPx = Math.round(bswClamp(params?.seamPx ?? 2, 0, 4));

      const aw = a.width;
      const ah = a.height;
      const bw = b.width;
      const bh = b.height;

      const aMask = maskOf(a.rgba, aw, ah);
      const bMask = maskOf(b.rgba, bw, bh);
      const aNeck = bswNeck(aMask, aw, ah, lo, hi);
      const bNeck = bswNeck(bMask, bw, bh, lo, hi);
      if (!aNeck) {
        return fallback("no-head-foreground");
      }
      if (!bNeck) {
        return fallback("no-body-foreground");
      }

      const aNeckY = aNeck.y;
      const bNeckY = bNeck.y;
      const aCx = aNeck.cx;
      const bCx = bNeck.cx;
      // width-match: scale the head band so its neck chord == B's neck chord
      const scale = bswClamp(bNeck.width / aNeck.width, 0.25, 4);

      // out-space band heights. head band = A's rows above its neck (scaled);
      // body band = B's neck row + everything below it.
      const headRowsA = aNeckY - aNeck.bbox.y0;
      const headRows = Math.max(1, Math.round(headRowsA * scale));
      const bodyRows = bh - bNeckY;
      if (bodyRows <= 0) {
        return fallback("empty-body-band");
      }

      const outW = bw;
      const outH = headRows + bodyRows;
      if (outH <= 0 || outH > 8 * Math.max(ah, bh) + 16) {
        return fallback("degenerate-size");
      }

      // --- head canvas: inverse-map the scaled head, centered on B's neck axis.
      // The seam row (out y = headRows) maps to A's neck row; +seamPx of overscan
      // below it samples A just under the neck so the seam band has head colour. ---
      const headRgba = bswBlank(outW, outH);
      const headBandBottom = Math.min(outH - 1, headRows + seamPx);
      for (let oy = 0; oy <= headBandBottom; oy++) {
        const ya = Math.round(aNeckY - (headRows - oy) / scale);
        if (ya < 0 || ya >= ah) {
          continue;
        }
        for (let ox = 0; ox < outW; ox++) {
          const xa = Math.round(aCx + (ox - bCx) / scale);
          if (xa < 0 || xa >= aw) {
            continue;
          }
          const si = (ya * aw + xa) * 4;
          if (a.rgba[si + 3] <= 24) {
            continue;
          }
          const di = (oy * outW + ox) * 4;
          headRgba[di] = a.rgba[si];
          headRgba[di + 1] = a.rgba[si + 1];
          headRgba[di + 2] = a.rgba[si + 2];
          headRgba[di + 3] = a.rgba[si + 3];
        }
      }

      // --- body canvas: B's body rows shifted so B's neck lands on the seam row.
      // +seamPx of overscan above the seam samples B's own neck for the blend. ---
      const bodyRgba = bswBlank(outW, outH);
      const bodyBandTop = Math.max(0, headRows - seamPx);
      for (let oy = bodyBandTop; oy < outH; oy++) {
        const yb = oy - headRows + bNeckY;
        if (yb < 0 || yb >= bh) {
          continue;
        }
        for (let ox = 0; ox < outW; ox++) {
          const si = (yb * bw + ox) * 4;
          if (b.rgba[si + 3] <= 24) {
            continue;
          }
          const di = (oy * outW + ox) * 4;
          bodyRgba[di] = b.rgba[si];
          bodyRgba[di + 1] = b.rgba[si + 1];
          bodyRgba[di + 2] = b.rgba[si + 2];
          bodyRgba[di + 3] = b.rgba[si + 3];
        }
      }

      // --- palette unify: harmonize the head toward B's palette family ---
      const bQuant = quantizeOklab(b.rgba, bw, bh);
      const bEntries = bswBEntries(bQuant);
      if (harmonize > 0 && bEntries.length) {
        for (let p = 0; p < outW * outH; p++) {
          const i = p * 4;
          if (headRgba[i + 3] <= 24) {
            continue;
          }
          const lab = srgbToOklab([headRgba[i], headRgba[i + 1], headRgba[i + 2]]);
          const [r, g, bl] = oklabToSrgb(bswHarmonize(lab, bEntries, harmonize));
          headRgba[i] = r;
          headRgba[i + 1] = g;
          headRgba[i + 2] = bl;
        }
      }

      // --- seam blend: ordered (Bayer) dither between head + body across the band ---
      const bandTop = headRows - seamPx;
      const bandBot = headRows + seamPx;
      const merged = bswBlank(outW, outH);
      for (let oy = 0; oy < outH; oy++) {
        for (let ox = 0; ox < outW; ox++) {
          const i = (oy * outW + ox) * 4;
          const hasH = headRgba[i + 3] > 24;
          const hasB = bodyRgba[i + 3] > 24;
          let src = null;
          if (seamPx === 0) {
            // hard seam: head above the neck row, body on/below it
            src = oy < headRows ? (hasH ? headRgba : hasB ? bodyRgba : null) : hasB ? bodyRgba : hasH ? headRgba : null;
          } else if (oy < bandTop) {
            src = hasH ? headRgba : hasB ? bodyRgba : null;
          } else if (oy >= bandBot) {
            src = hasB ? bodyRgba : hasH ? headRgba : null;
          } else {
            // seam band: Bayer dither between head (top) and body (bottom)
            const t = (oy - bandTop) / (bandBot - bandTop);
            const thr = (BSW_BAYER[oy & 3][ox & 3] + 0.5) / 16;
            if (t >= thr && hasB) {
              src = bodyRgba;
            } else if (hasH) {
              src = headRgba;
            } else if (hasB) {
              src = bodyRgba;
            }
          }
          if (src) {
            merged[i] = src[i];
            merged[i + 1] = src[i + 1];
            merged[i + 2] = src[i + 2];
            merged[i + 3] = src[i + 3];
          }
        }
      }

      // --- outline: one 1px dark keyline re-synthesized from the merged alpha ---
      const finalRgba = new Uint8ClampedArray(merged);
      const mMask = maskOf(merged, outW, outH);
      const er = bswErode4(mMask, outW, outH);
      for (let p = 0; p < outW * outH; p++) {
        if (mMask[p] && !er[p]) {
          finalRgba[p * 4] = 26;
          finalRgba[p * 4 + 1] = 22;
          finalRgba[p * 4 + 2] = 34;
          finalRgba[p * 4 + 3] = 255;
        }
      }

      const layers = [
        { label: "aNeck", width: aw, height: ah, rgba: bswNeckOverlay(a.rgba, aw, ah, aNeckY, aNeck.bbox) },
        { label: "bNeck", width: bw, height: bh, rgba: bswNeckOverlay(b.rgba, bw, bh, bNeckY, bNeck.bbox) },
        { label: "headBand", width: outW, height: outH, rgba: new Uint8ClampedArray(headRgba) },
        { label: "bodyBand", width: outW, height: outH, rgba: new Uint8ClampedArray(bodyRgba) },
        { label: "seam", width: outW, height: outH, rgba: bswSeamOverlay(merged, outW, outH, bandTop, bandBot) },
        { label: "final", width: outW, height: outH, rgba: new Uint8ClampedArray(finalRgba) },
      ];

      return {
        width: outW,
        height: outH,
        rgba: finalRgba,
        layers,
        meta: { rung: "band", aNeckY, bNeckY, scale },
      };
    } catch (err) {
      return fallback(`exception:${err && err.message ? err.message : String(err)}`);
    }
  },
};

STRATEGIES.push(bandswapStrategy);
