/* Fusion Lab strategy - SIGNATURE-GRAFT (conservative "B in A's flavor").
 *
 * APPROACH 4: keep B's whole body/shape intact, recolor it toward A's palette,
 * and transplant only A's DISTINCTIVE signature bits onto B - the standout
 * silhouette protrusions (spikes / wings / tails / horns) and the vivid
 * high-chroma accent regions (flame tips, fins, gems). The result reads as one
 * coherent creature: B, wearing A's hallmark features in A's colour identity.
 *
 * Pipeline (all DOM-free, rgba Uint8ClampedArray in/out, NEVER throws):
 *   1. base       - B's pixels, B's full size/shape (untouched silhouette).
 *   2. recolor    - OKLab luminance-role transfer: keep each B pixel's L, swap
 *                   its hue/chroma toward A's role-matched dominant palette by
 *                   `tint`. B takes on A's colour identity.
 *   3. detect     - A's signature features, two complementary detectors UNIONed:
 *                     (i)  silhouette protrusions = A.mask minus a morphological
 *                          OPENING of A.mask (thin spikes/wings/tails residual),
 *                          ranked by how far they extend from A's core.
 *                     (ii) high-chroma accents = small, isolated connected
 *                          components whose palette entry is far more saturated
 *                          than A's dominant body colour.
 *   4. place      - graft a few feature clusters onto B at the matching
 *                   silhouette extremity (top->head crest, rear->tail, ...),
 *                   scaled to B. Protrusions inherit A's colour (already
 *                   harmonised since B is now A-tinted); accents keep their vivid
 *                   "signature" colour.
 *   5. finish     - composite over the recoloured B, re-ink ONE 1px outline from
 *                   the merged alpha so grafts join B cleanly.
 *
 * Compose-only: re-implements the recolor / morphology / placement locally from
 * the exported primitives (fusion.mjs internals are not importable). */

import { STRATEGIES, maskOf, components, srgbToOklab, oklabToSrgb, quantizeOklab, edt, skeletonize, detectSockets, reconstructFrame } from "../fusion.mjs";

// ---- tiny scalar / colour helpers ----------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const chromaOf = lab => Math.hypot(lab[1], lab[2]);
const hueOf = lab => Math.atan2(lab[2], lab[1]);
function hueDist(h1, h2) {
  const d = Math.abs(h1 - h2) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

const ALPHA_THRESH = 24;
const INK = [26, 22, 34, 255]; // tinted near-black keyline

function countOpaque(rgba, n) {
  let c = 0;
  for (let p = 0; p < n; p++) {
    if (rgba[p * 4 + 3] > ALPHA_THRESH) {
      c++;
    }
  }
  return c;
}

// ---- OKLab role helpers (recolor) ----------------------------------------

/* rolesOf - per palette-index role {shadow|mid|highlight|ink} from the
 * quantizer's inkIndices + rampRoles (mirrors fusion.mjs' internal rolesOf). */
function rolesOf(quant) {
  const roles = new Array(quant.palette.length).fill("mid");
  for (const k of quant.inkIndices) {
    roles[k] = "ink";
  }
  for (const fam of quant.rampRoles.values()) {
    if (fam.shadow != null) {
      roles[fam.shadow] = "shadow";
    }
    if (fam.highlight != null) {
      roles[fam.highlight] = "highlight";
    }
  }
  return roles;
}

/* buildRecolorTargets - for each B palette index, the A OKLab to steer its
 * chroma+hue toward: same-role A entry of nearest hue (chromatic) or nearest L
 * (ink/neutral). A empty -> target = the B entry (identity, no change). */
function buildRecolorTargets(aQ, bQ) {
  const aRoles = rolesOf(aQ);
  const bRoles = rolesOf(bQ);
  const aEntries = aQ.palette.map((lab, k) => ({
    lab,
    role: aRoles[k],
    hue: hueOf(lab),
    chroma: chromaOf(lab),
    L: lab[0],
  }));
  const targets = new Array(bQ.palette.length);
  for (let k = 0; k < bQ.palette.length; k++) {
    const blab = bQ.palette[k];
    const brole = bRoles[k];
    const bhue = hueOf(blab);
    const bchroma = chromaOf(blab);
    let pool = aEntries.filter(e => e.role === brole);
    if (pool.length === 0) {
      pool = aEntries;
    }
    if (pool.length === 0) {
      targets[k] = blab;
      continue;
    }
    let best = pool[0];
    let bestD = Infinity;
    for (const e of pool) {
      const chromatic = bchroma > 0.02 && e.chroma > 0.02;
      const d = chromatic ? hueDist(e.hue, bhue) : Math.abs(e.L - blab[0]);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    targets[k] = best.lab;
  }
  return targets;
}

/* recolorTowardA - B's opaque pixels, each keeping its own L but moving its
 * (a,b) chroma toward the role-matched A target by `tint`. */
function recolorTowardA(b, bQ, targets, tint) {
  const w = b.width;
  const h = b.height;
  const out = Uint8ClampedArray.from(b.rgba);
  for (let p = 0; p < w * h; p++) {
    const k = bQ.indexMap[p];
    if (k === 255) {
      continue; // transparent / background stays
    }
    const i = p * 4;
    const lab = srgbToOklab([out[i], out[i + 1], out[i + 2]]);
    const t = targets[k] || lab;
    const na = lab[1] + tint * (t[1] - lab[1]);
    const nb = lab[2] + tint * (t[2] - lab[2]);
    const [r, g, bl] = oklabToSrgb([lab[0], na, nb]);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = bl;
  }
  return out;
}

// ---- morphology (8-connected; out-of-bounds reads as background) ----------

function erodeMask(mask, w, h, iters) {
  let cur = mask;
  for (let it = 0; it < iters; it++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!cur[p]) {
          continue;
        }
        let keep = 1;
        for (let dy = -1; dy <= 1 && keep; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || !cur[ny * w + nx]) {
              keep = 0;
              break;
            }
          }
        }
        out[p] = keep;
      }
    }
    cur = out;
  }
  return cur;
}

function dilateMask(mask, w, h, iters) {
  let cur = mask;
  for (let it = 0; it < iters; it++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (cur[p]) {
          out[p] = 1;
          continue;
        }
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && cur[ny * w + nx]) {
              on = 1;
              break;
            }
          }
        }
        out[p] = on;
      }
    }
    cur = out;
  }
  return cur;
}

// ---- signature-feature detectors -----------------------------------------

/* detectProtrusions - A.mask minus a morphological opening of A.mask: the thin
 * bits the opening can't preserve (spikes / wings / tails). Returns the labelled
 * residual components. */
function detectProtrusions(aMask, w, h, aArea) {
  const k = clamp(Math.round(Math.sqrt(Math.max(1, aArea)) * 0.1), 2, 6);
  const opened = dilateMask(erodeMask(aMask, w, h, k), w, h, k);
  const resid = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    resid[p] = aMask[p] && !opened[p] ? 1 : 0;
  }
  const minPx = Math.max(4, Math.round(aArea * 0.003));
  return components(resid, w, h, minPx);
}

/* detectAccents - high-OKLab-chroma palette entries that are much more saturated
 * than A's dominant body colour and don't dominate the area, as labelled
 * connected components (flame tips, fins, gems). */
function detectAccents(a, w, h, aQ) {
  const np = aQ.palette.length;
  const areas = new Array(np).fill(0);
  let total = 0;
  for (let p = 0; p < w * h; p++) {
    const k = aQ.indexMap[p];
    if (k !== 255) {
      areas[k]++;
      total++;
    }
  }
  let dom = 0;
  for (let k = 1; k < np; k++) {
    if (areas[k] > areas[dom]) {
      dom = k;
    }
  }
  const domChroma = np ? chromaOf(aQ.palette[dom]) : 0;
  const isAccent = new Array(np).fill(false);
  for (let k = 0; k < np; k++) {
    const c = chromaOf(aQ.palette[k]);
    if (c > 0.06 && c > Math.max(domChroma * 1.25, 0.05) && areas[k] < total * 0.3) {
      isAccent[k] = true;
    }
  }
  const accMask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const k = aQ.indexMap[p];
    if (k !== 255 && isAccent[k]) {
      accMask[p] = 1;
    }
  }
  const minPx = Math.max(4, Math.round(total * 0.002));
  return components(accMask, w, h, minPx);
}

// ---- geometry helpers ----------------------------------------------------

function maskCentroidArea(mask, w, h) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        sx += x;
        sy += y;
        n++;
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
  if (n === 0) {
    return null;
  }
  return { cx: sx / n, cy: sy / n, n, diag: Math.hypot(x1 - x0, y1 - y0) || 1 };
}

/* clusterInfo - per-feature geometry: bbox, centroid, the attach `base` (cluster
 * pixel nearest A's core centroid), the outward `dir` (core -> centroid), and the
 * tip distance (how far it extends - the extremity score). */
function clusterInfo(labels, w, h, label, aCx, aCy) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let sx = 0;
  let sy = 0;
  let n = 0;
  let base = null;
  let baseD = Infinity;
  let tipD = -Infinity;
  for (let p = 0; p < w * h; p++) {
    if (labels[p] !== label) {
      continue;
    }
    const x = p % w;
    const y = (p - x) / w;
    if (x < minx) {
      minx = x;
    }
    if (x > maxx) {
      maxx = x;
    }
    if (y < miny) {
      miny = y;
    }
    if (y > maxy) {
      maxy = y;
    }
    sx += x;
    sy += y;
    n++;
    const d = (x - aCx) ** 2 + (y - aCy) ** 2;
    if (d < baseD) {
      baseD = d;
      base = { x, y };
    }
    if (d > tipD) {
      tipD = d;
    }
  }
  if (n === 0 || !base) {
    return null;
  }
  const cx = sx / n;
  const cy = sy / n;
  let dirx = cx - aCx;
  let diry = cy - aCy;
  const dl = Math.hypot(dirx, diry) || 1;
  dirx /= dl;
  diry /= dl;
  return {
    label,
    n,
    bbox: { x0: minx, y0: miny, x1: maxx, y1: maxy },
    base,
    dir: { x: dirx, y: diry },
    tipDist: Math.sqrt(Math.max(0, tipD)),
  };
}

/* bExtremity - B's silhouette boundary point along `dir` from B's centroid:
 * march outward, remember the last opaque pixel. That rim point is where the
 * grafted feature attaches (it then extends further outward). */
function bExtremity(bMask, w, h, bCx, bCy, dir) {
  let lastx = bCx;
  let lasty = bCy;
  let found = false;
  const maxT = Math.hypot(w, h);
  for (let t = 0; t <= maxT; t += 0.5) {
    const x = Math.round(bCx + dir.x * t);
    const y = Math.round(bCy + dir.y * t);
    if (x < 0 || y < 0 || x >= w || y >= h) {
      break;
    }
    if (bMask[y * w + x]) {
      lastx = x;
      lasty = y;
      found = true;
    }
  }
  return { x: lastx, y: lasty, found };
}

/* placeFeature - inverse-map blit of one A cluster onto OUT at B's rim point,
 * scaled (anchored so the cluster's attach base lands on `target`). Records the
 * painted pixels so the finish pass can re-stamp vivid accents. */
function placeFeature(out, w, h, a, labels, feature, target, scale, keepVivid, painted) {
  const aw = a.width;
  const ah = a.height;
  const bb = feature.bbox;
  // dest bbox = transform of the cluster bbox corners
  let dminx = Infinity;
  let dminy = Infinity;
  let dmaxx = -Infinity;
  let dmaxy = -Infinity;
  for (const [cx, cy] of [
    [bb.x0, bb.y0],
    [bb.x1, bb.y0],
    [bb.x0, bb.y1],
    [bb.x1, bb.y1],
  ]) {
    const px = target.x + (cx - feature.base.x) * scale;
    const py = target.y + (cy - feature.base.y) * scale;
    dminx = Math.min(dminx, px);
    dminy = Math.min(dminy, py);
    dmaxx = Math.max(dmaxx, px);
    dmaxy = Math.max(dmaxy, py);
  }
  const x0 = clamp(Math.floor(dminx), 0, w - 1);
  const x1 = clamp(Math.ceil(dmaxx), 0, w - 1);
  const y0 = clamp(Math.floor(dminy), 0, h - 1);
  const y1 = clamp(Math.ceil(dmaxy), 0, h - 1);
  let n = 0;
  for (let dy = y0; dy <= y1; dy++) {
    for (let dx = x0; dx <= x1; dx++) {
      const ax = Math.round(feature.base.x + (dx - target.x) / scale);
      const ay = Math.round(feature.base.y + (dy - target.y) / scale);
      if (ax < 0 || ay < 0 || ax >= aw || ay >= ah) {
        continue;
      }
      if (labels[ay * aw + ax] !== feature.label) {
        continue;
      }
      const si = (ay * aw + ax) * 4;
      if (a.rgba[si + 3] <= ALPHA_THRESH) {
        continue;
      }
      const di = (dy * w + dx) * 4;
      const r = a.rgba[si];
      const g = a.rgba[si + 1];
      const bl = a.rgba[si + 2];
      const al = a.rgba[si + 3];
      out[di] = r;
      out[di + 1] = g;
      out[di + 2] = bl;
      out[di + 3] = al;
      if (keepVivid) {
        painted.push([dy * w + dx, r, g, bl, al]);
      }
      n++;
    }
  }
  return n;
}

// ---- finish pass ---------------------------------------------------------

function erode4(mask, w, h) {
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

/* finishOutline - re-synthesise ONE 1px keyline from the merged alpha
 * (mask AND NOT erode(mask)), then re-stamp vivid accent pixels so the
 * "signature" pop is not swallowed by the ink. */
function finishOutline(rgba, w, h, vividPainted) {
  const mask = maskOf(rgba, w, h, ALPHA_THRESH);
  const er = erode4(mask, w, h);
  const out = Uint8ClampedArray.from(rgba);
  for (let p = 0; p < w * h; p++) {
    if (mask[p] && !er[p]) {
      out[p * 4] = INK[0];
      out[p * 4 + 1] = INK[1];
      out[p * 4 + 2] = INK[2];
      out[p * 4 + 3] = INK[3];
    }
  }
  for (const [p, r, g, b, a] of vividPainted) {
    out[p * 4] = r;
    out[p * 4 + 1] = g;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = a;
  }
  return out;
}

// ---- debug-layer painters ------------------------------------------------

function dimCopy(rgba) {
  const o = Uint8ClampedArray.from(rgba);
  for (let i = 0; i < o.length; i += 4) {
    o[i] = (o[i] * 0.38) | 0;
    o[i + 1] = (o[i + 1] * 0.38) | 0;
    o[i + 2] = (o[i + 2] * 0.38) | 0;
  }
  return o;
}

function overlayLabels(base, w, h, labels, [r, g, b]) {
  const out = Uint8ClampedArray.from(base);
  for (let p = 0; p < w * h; p++) {
    if (labels[p] > 0) {
      out[p * 4] = r;
      out[p * 4 + 1] = g;
      out[p * 4 + 2] = b;
      out[p * 4 + 3] = 255;
    }
  }
  return out;
}

// ---- strategy ------------------------------------------------------------

export const signatureStrategy = {
  id: "signature",
  label: "Signature-graft",
  params: [
    { key: "tint", label: "Recolor toward A", min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: "featureCount", label: "Signature bits", min: 1, max: 6, step: 1, default: 3 },
    { key: "featureScale", label: "Feature scale", min: 0.5, max: 1.5, step: 0.05, default: 1 },
  ],
  fuse(a, b, params) {
    const W = b.width;
    const H = b.height;
    const fallback = reason => ({
      width: W,
      height: H,
      rgba: Uint8ClampedArray.from(b.rgba),
      layers: [{ label: "bBase", width: W, height: H, rgba: Uint8ClampedArray.from(b.rgba) }],
      meta: { rung: "fallback", reason },
    });

    try {
      const tint = clamp(params?.tint ?? 0.5, 0, 1);
      const featureCount = clamp(Math.round(params?.featureCount ?? 3), 1, 6);
      const featureScaleP = clamp(params?.featureScale ?? 1, 0.5, 1.5);

      const aw = a.width;
      const ah = a.height;
      const nA = aw * ah;
      const nB = W * H;
      if (nA === 0 || nB === 0 || countOpaque(b.rgba, nB) === 0 || countOpaque(a.rgba, nA) === 0) {
        return fallback("degenerate-input");
      }

      // --- Stage 1+2: recolor B toward A (B keeps its L, swaps hue/chroma) ----
      const aQ = quantizeOklab(a.rgba, aw, ah);
      const bQ = quantizeOklab(b.rgba, W, H);
      const targets = buildRecolorTargets(aQ, bQ);
      const recolored = recolorTowardA(b, bQ, targets, tint);

      // --- Stage 3: detect A's signature features (two detectors, unioned) ----
      const aMask = maskOf(a.rgba, aw, ah, ALPHA_THRESH);
      const aGeo = maskCentroidArea(aMask, aw, ah);
      const protr = detectProtrusions(aMask, aw, ah, aGeo ? aGeo.n : 0);
      const accents = detectAccents(a, aw, ah, aQ);

      const protrFeats = [];
      for (const { label } of protr.areasDesc) {
        const info = clusterInfo(protr.labels, aw, ah, label, aGeo.cx, aGeo.cy);
        if (info) {
          info.kind = "protrusion";
          info.labels = protr.labels;
          protrFeats.push(info);
        }
      }
      // protrusions: prefer the ones that extend FARTHEST from A's core
      protrFeats.sort((x, y) => y.tipDist - x.tipDist);

      const accFeats = [];
      for (const { label } of accents.areasDesc) {
        const info = clusterInfo(accents.labels, aw, ah, label, aGeo.cx, aGeo.cy);
        if (info) {
          info.kind = "accent";
          info.labels = accents.labels;
          accFeats.push(info);
        }
      }
      // accents: prefer the biggest vivid blobs (most "signature")
      accFeats.sort((x, y) => y.n - x.n);

      // union, alternating protrusion/accent for a tasteful, diverse few
      const chosen = [];
      let pi = 0;
      let ai = 0;
      while (chosen.length < featureCount && (pi < protrFeats.length || ai < accFeats.length)) {
        if (pi < protrFeats.length) {
          chosen.push(protrFeats[pi++]);
        }
        if (chosen.length >= featureCount) {
          break;
        }
        if (ai < accFeats.length) {
          chosen.push(accFeats[ai++]);
        }
      }

      // --- Stage 4: place the signature bits onto B at matching extremities ----
      const bMask = maskOf(recolored, W, H, ALPHA_THRESH);
      const bGeo = maskCentroidArea(bMask, W, H);
      const placed = Uint8ClampedArray.from(recolored);
      const vividPainted = []; // accent pixels to protect from the ink pass
      const scale = clamp(featureScaleP * (bGeo.diag / aGeo.diag), 0.45, 1.6);
      let nFeatures = 0;
      const placedDirs = [];
      for (const f of chosen) {
        // de-stack: skip a feature pointing nearly the same way as a placed one
        if (placedDirs.some(d => d.x * f.dir.x + d.y * f.dir.y > 0.96)) {
          continue;
        }
        const target = bExtremity(bMask, W, H, bGeo.cx, bGeo.cy, f.dir);
        if (!target.found) {
          continue;
        }
        const painted = placeFeature(
          placed,
          W,
          H,
          a,
          f.labels,
          f,
          target,
          scale,
          f.kind === "accent",
          vividPainted,
        );
        if (painted > 0) {
          nFeatures++;
          placedDirs.push(f.dir);
        }
      }

      // --- Stage 5: finish (one re-inked outline; keep vivid accents) ---------
      const final = finishOutline(placed, W, H, vividPainted);

      const layers = [
        { label: "bBase", width: W, height: H, rgba: Uint8ClampedArray.from(b.rgba) },
        { label: "bRecolored", width: W, height: H, rgba: Uint8ClampedArray.from(recolored) },
        {
          label: "aProtrusions",
          width: aw,
          height: ah,
          rgba: overlayLabels(dimCopy(a.rgba), aw, ah, protr.labels, [255, 96, 96]),
        },
        {
          label: "aAccents",
          width: aw,
          height: ah,
          rgba: overlayLabels(dimCopy(a.rgba), aw, ah, accents.labels, [96, 235, 140]),
        },
        { label: "placedSignature", width: W, height: H, rgba: Uint8ClampedArray.from(placed) },
        { label: "final", width: W, height: H, rgba: Uint8ClampedArray.from(final) },
      ];

      return {
        width: W,
        height: H,
        rgba: final,
        layers,
        meta: { rung: "signature", nFeatures },
      };
    } catch (err) {
      return fallback(`exception:${err && err.message ? err.message : err}`);
    }
  },
};

STRATEGIES.push(signatureStrategy);
