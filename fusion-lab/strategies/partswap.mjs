/* Fusion Lab - APPROACH 1: PART-SWAP DONE RIGHT (strategy plugin).
 *
 * The fix for the broken overlap. socketGraft cleared only a narrow COLUMN of B
 * under the socket and pasted A's whole head region on top, so B's old head (and
 * everything outside the column) survived underneath -> a full-body double-exposure.
 *
 * This strategy does an HONEST part swap instead:
 *   1. analyse B -> find B's neck/head-socket (the CUT line) + its attach width.
 *   2. analyse A -> isolate ONLY A's head (foreground above A's own neck), discard
 *      A's body entirely.
 *   3. DELETE B's head: clear EVERY B pixel above the cut line (B contributes a
 *      body only - no original B head remains anywhere).
 *   4. place + scale A's isolated head so its base width matches B's socket width
 *      (clamped), seated on the socket with a small forced overlap (no gap).
 *   5. palette-unify: recolor the grafted head into B's palette family (OKLab
 *      luminance-role transfer - keep the head's own L ramp, swap chroma/hue toward
 *      B's role-matched palette by `harmonize`), so the halves read as one creature.
 *   6. finish: composite head-over-body-with-head-removed, re-synthesise ONE 1px
 *      outline from the merged alpha, re-stamp the head interior (anti eyeless).
 *
 * Because B's head is fully deleted and A's body is fully discarded, there is NO
 * full-body overlap - only the intended 1-2px weld band where head meets body.
 *
 * DOM-free: plain rgba Uint8ClampedArray in/out. NEVER throws (try/catch -> returns
 * B unchanged with meta.rung='fallback'). Reference: Stages 5-12 of
 * docs/plans/2026-06-30-sprite-fusion-algorithm-design.md. */

import { STRATEGIES, maskOf, components, srgbToOklab, oklabToSrgb, quantizeOklab, edt, skeletonize, detectSockets, reconstructFrame } from "../fusion.mjs";

const A_THRESH = 24;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---- tiny rgba helpers (own; fusion.mjs internals are not exported) -------

const blankRGBA = (w, h) => new Uint8ClampedArray(w * h * 4);

function setPx(out, w, h, x, y, r, g, b, a) {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= w || y >= h) {
    return;
  }
  const i = (y * w + x) * 4;
  out[i] = r;
  out[i + 1] = g;
  out[i + 2] = b;
  out[i + 3] = a;
}

function dimCopy(rgba) {
  const o = Uint8ClampedArray.from(rgba);
  for (let i = 0; i < o.length; i += 4) {
    o[i] = (o[i] * 0.38) | 0;
    o[i + 1] = (o[i + 1] * 0.38) | 0;
    o[i + 2] = (o[i + 2] * 0.38) | 0;
  }
  return o;
}

function maskLayerRGBA(mask, w, h, r = 228, g = 230, b = 244) {
  const out = blankRGBA(w, h);
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) {
      out[p * 4] = r;
      out[p * 4 + 1] = g;
      out[p * 4 + 2] = b;
      out[p * 4 + 3] = 255;
    }
  }
  return out;
}

const countMask = mask => {
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    n += mask[i];
  }
  return n;
};

// ---- geometry helpers -----------------------------------------------------

function maskBBox(mask, w, h) {
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

// foreground bbox intersected with its top `frac` of height (head-region heuristic
// fed to detectSockets so H3's head-disk targets the head, not the torso).
function topBandRegion(bbox, frac) {
  if (!bbox) {
    return null;
  }
  const y1 = Math.round(bbox.y0 + frac * (bbox.y1 - bbox.y0));
  return { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: clamp(y1, bbox.y0, bbox.y1) };
}

/* buildAnalysis - the per-sprite bundle detectSockets consumes, assembled from the
 * exported primitives: { w, h, mask, edt, skeleton, components, headRegion }. */
function buildAnalysis(sprite) {
  const w = sprite.width;
  const h = sprite.height;
  const mask = maskOf(sprite.rgba, w, h);
  const bbox = maskBBox(mask, w, h);
  const comp = components(mask, w, h);
  const field = edt(mask, w, h);
  const skeleton = skeletonize(mask, w, h, field);
  const headRegion = topBandRegion(bbox, 0.45);
  return { w, h, mask, bbox, edt: field, skeleton, components: comp, headRegion };
}

// best socket of a kind (highest conf); neck cut prefers a pinch, then a contact.
function pickSocket(sockets) {
  const byKind = kind => sockets.filter(s => s.kind === kind).sort((a, b) => b.conf - a.conf)[0];
  return byKind("pinch") || byKind("contact") || null;
}

/* extractHead - isolate ONLY A's head: A's foreground above A's neck cut line.
 * cut = A's own socket Y if detected, else top 40% of A's bbox. Returns the head
 * mask, its bbox, the base (centre of the bottom head row = graft anchor) and the
 * attach width (bottom-row chord, paired with B's socket width to set the scale). */
function extractHead(a, analysis, aSocket) {
  const w = a.width;
  const h = a.height;
  const bbox = analysis.bbox;
  if (!bbox) {
    return { count: 0 };
  }
  let cutY;
  if (aSocket) {
    cutY = Math.round(aSocket.pos.y);
  } else {
    cutY = Math.round(bbox.y0 + 0.4 * (bbox.y1 - bbox.y0));
  }
  cutY = clamp(cutY, bbox.y0 + 1, bbox.y1);

  const headMask = new Uint8Array(w * h);
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let count = 0;
  for (let y = bbox.y0; y < cutY; y++) {
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      if (a.rgba[(y * w + x) * 4 + 3] > A_THRESH) {
        headMask[y * w + x] = 1;
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
        count++;
      }
    }
  }
  if (count < 6) {
    return { count };
  }
  // attach width + anchor from the bottom-most head row (where it meets the body)
  let chord = 0;
  let sx = 0;
  for (let x = minx; x <= maxx; x++) {
    if (headMask[maxy * w + x]) {
      chord++;
      sx += x;
    }
  }
  if (chord < 1) {
    // bottom row empty (shouldn't happen) - fall back to whole-head centroid
    let cx = 0;
    let cn = 0;
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        if (headMask[y * w + x]) {
          cx += x;
          cn++;
        }
      }
    }
    sx = cx;
    chord = maxx - minx + 1;
    return {
      count,
      mask: headMask,
      bbox: { x0: minx, y0: miny, x1: maxx, y1: maxy },
      base: { x: cn ? cx / cn : (minx + maxx) / 2, y: maxy },
      plugWidth: Math.max(2, chord),
      cutY,
    };
  }
  return {
    count,
    mask: headMask,
    bbox: { x0: minx, y0: miny, x1: maxx, y1: maxy },
    base: { x: sx / chord, y: maxy },
    plugWidth: Math.max(2, chord),
    cutY,
  };
}

// ---- OKLab role helpers (own copy; fusion.mjs internals are not exported) --

const paletteHue = lab => Math.atan2(lab[2], lab[1]);
const chromaOf = lab => Math.hypot(lab[1], lab[2]);
function hueDist(h1, h2) {
  const d = Math.abs(h1 - h2) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/* rolesOf - per palette-index role {shadow|mid|highlight|ink} from the quantizer's
 * inkIndices + rampRoles (Stage 11 luminance buckets). */
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

/* buildHeadTargets - for each HEAD palette index, the B OKLab to steer its
 * chroma+hue toward: the same-role B entry of nearest hue (chromatic) or nearest L
 * (ink/neutral). B empty -> identity (the head keeps its own colour). */
function buildHeadTargets(headQ, bQ) {
  const bRoles = rolesOf(bQ);
  const bEntries = bQ.palette.map((lab, k) => ({
    lab,
    role: bRoles[k],
    hue: paletteHue(lab),
    chroma: chromaOf(lab),
    L: lab[0],
  }));
  const hRoles = rolesOf(headQ);
  const targets = new Array(headQ.palette.length);
  for (let k = 0; k < headQ.palette.length; k++) {
    const hlab = headQ.palette[k];
    const hrole = hRoles[k];
    const hhue = paletteHue(hlab);
    const hchroma = chromaOf(hlab);
    let pool = bEntries.filter(e => e.role === hrole);
    if (pool.length === 0) {
      pool = bEntries;
    }
    if (pool.length === 0) {
      targets[k] = hlab;
      continue;
    }
    let best = pool[0];
    let bestD = Infinity;
    for (const e of pool) {
      const chromatic = hchroma > 0.02 && e.chroma > 0.02;
      const d = chromatic ? hueDist(e.hue, hhue) : Math.abs(e.L - hlab[0]);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    targets[k] = best.lab;
  }
  return targets;
}

// ---- finish pass (Stage 12 lite) ------------------------------------------

// 4-neighbour erosion; image-border pixels erode (treated as outside).
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

/* finishMerged - re-synthesise ONE 1px outline from the merged alpha
 * (mask AND NOT erode(mask), painted a dark tinted tone), then re-stamp the head
 * interior (only where eroded, i.e. NOT on the new outline) so the face is not an
 * eyeless cutout. */
function finishMerged(merged, headStamp, w, h) {
  const mask = maskOf(merged, w, h);
  const er = erode4(mask, w, h);
  const out = Uint8ClampedArray.from(merged);
  const ink = [26, 22, 34, 255]; // tinted near-black keyline (Gen-5 outlines are tinted)
  for (let p = 0; p < w * h; p++) {
    if (mask[p] && !er[p]) {
      out[p * 4] = ink[0];
      out[p * 4 + 1] = ink[1];
      out[p * 4 + 2] = ink[2];
      out[p * 4 + 3] = ink[3];
    }
  }
  for (const [p, r, g, b, a] of headStamp) {
    if (er[p]) {
      out[p * 4] = r;
      out[p * 4 + 1] = g;
      out[p * 4 + 2] = b;
      out[p * 4 + 3] = a;
    }
  }
  return out;
}

// ---- cheap plausibility score (Stage 8 lite) ------------------------------

// triangular score: 1 at `ideal`, falling linearly to 0 at lo/hi, 0 outside.
function scoreRange(v, lo, hi, ideal) {
  if (v <= lo || v >= hi) {
    return 0;
  }
  if (v === ideal) {
    return 1;
  }
  return v < ideal ? (v - lo) / (ideal - lo) : (hi - v) / (hi - ideal);
}

function scoreCandidate(mergedMask, mergedArea, headArea, bArea, w, h) {
  const comp = components(mergedMask, w, h, 1);
  const largest = comp.areasDesc.length ? comp.areasDesc[0].area : 0;
  const conn = mergedArea > 0 ? largest / mergedArea : 0; // outline-closed / single-blob proxy
  const areaRatio = bArea > 0 ? mergedArea / bArea : 0;
  const sil = scoreRange(areaRatio, 0.5, 1.7, 1.0);
  const headRatio = mergedArea > 0 ? headArea / mergedArea : 0;
  const headS = scoreRange(headRatio, 0.04, 0.7, 0.3);
  return 0.4 * sil + 0.25 * headS + 0.35 * conn;
}

// ---- the strategy ---------------------------------------------------------

function partswapFuse(a, b, params) {
  const P = {
    scaleLo: params?.scaleLo ?? 0.4,
    scaleHi: params?.scaleHi ?? 1.8,
    overlapPx: Math.round(params?.overlapPx ?? 1),
    harmonize: clamp(params?.harmonize ?? 0.5, 0, 1),
    scoreFloor: params?.scoreFloor ?? 0.25,
  };
  const w = b.width;
  const h = b.height;
  const fallback = reason => ({
    width: w,
    height: h,
    rgba: Uint8ClampedArray.from(b.rgba),
    layers: [{ label: "final", width: w, height: h, rgba: Uint8ClampedArray.from(b.rgba) }],
    meta: { rung: "fallback", reason },
  });

  try {
    // -- Stage 1: analyse B, find the neck cut line ------------------------
    const B = buildAnalysis(b);
    const bArea = countMask(B.mask);
    if (bArea < 8 || !B.bbox) {
      return fallback("empty-b");
    }
    const bSockets = detectSockets({ width: w, height: h, mask: B.mask }, B);
    const bSocket = pickSocket(bSockets);
    if (!bSocket) {
      return fallback("no-b-socket");
    }
    const cutY = clamp(Math.round(bSocket.pos.y), B.bbox.y0 + 1, B.bbox.y1);

    // -- Stage 2: analyse A, isolate ONLY A's head ------------------------
    const A = buildAnalysis(a);
    if (!A.bbox) {
      return fallback("empty-a");
    }
    const aSocket = pickSocket(detectSockets({ width: a.width, height: a.height, mask: A.mask }, A));
    const head = extractHead(a, A, aSocket);
    if (!head.count || head.count < 6) {
      return fallback("no-head");
    }

    // -- Stage 3: DELETE B's head (clear every B pixel above the cut) ------
    const bBody = Uint8ClampedArray.from(b.rgba);
    for (let y = 0; y < cutY; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        bBody[i] = 0;
        bBody[i + 1] = 0;
        bBody[i + 2] = 0;
        bBody[i + 3] = 0;
      }
    }

    // -- Stage 4: place + scale A's head onto B's socket ------------------
    const aw = a.width;
    const scale = clamp(bSocket.width / head.plugWidth, P.scaleLo, P.scaleHi);
    const destBaseX = bSocket.pos.x;
    const destBaseY = bSocket.pos.y + P.overlapPx; // forced overlap -> no gap
    const tf = (ax, ay) => [destBaseX + (ax - head.base.x) * scale, destBaseY + (ay - head.base.y) * scale];
    let dminx = Infinity;
    let dminy = Infinity;
    let dmaxx = -Infinity;
    let dmaxy = -Infinity;
    for (const [cx, cy] of [
      [head.bbox.x0, head.bbox.y0],
      [head.bbox.x1, head.bbox.y0],
      [head.bbox.x0, head.bbox.y1],
      [head.bbox.x1, head.bbox.y1],
    ]) {
      const [px, py] = tf(cx, cy);
      dminx = Math.min(dminx, px);
      dminy = Math.min(dminy, py);
      dmaxx = Math.max(dmaxx, px);
      dmaxy = Math.max(dmaxy, py);
    }
    const x0 = clamp(Math.floor(dminx), 0, w - 1);
    const x1 = clamp(Math.ceil(dmaxx), 0, w - 1);
    const y0 = clamp(Math.floor(dminy), 0, h - 1);
    const y1 = clamp(Math.ceil(dmaxy), 0, h - 1);

    // inverse-map each dest pixel back into A's head, sample nearest -> raw head
    const placed = blankRGBA(w, h);
    const rawSamples = []; // { di, r, g, b, a }
    for (let dy = y0; dy <= y1; dy++) {
      for (let dx = x0; dx <= x1; dx++) {
        const sax = Math.round(head.base.x + (dx - destBaseX) / scale);
        const say = Math.round(head.base.y + (dy - destBaseY) / scale);
        if (sax < head.bbox.x0 || sax > head.bbox.x1 || say < head.bbox.y0 || say > head.bbox.y1) {
          continue;
        }
        if (!head.mask[say * aw + sax]) {
          continue;
        }
        const si = (say * aw + sax) * 4;
        if (a.rgba[si + 3] <= A_THRESH) {
          continue;
        }
        const di = dy * w + dx;
        const r = a.rgba[si];
        const g = a.rgba[si + 1];
        const bb = a.rgba[si + 2];
        const al = a.rgba[si + 3];
        placed[di * 4] = r;
        placed[di * 4 + 1] = g;
        placed[di * 4 + 2] = bb;
        placed[di * 4 + 3] = al;
        rawSamples.push({ di, r, g, b: bb, a: al });
      }
    }
    if (rawSamples.length < 6) {
      return fallback("placed-head-empty");
    }

    // -- Stage 5: palette-unify the grafted head into B's palette family ---
    const bQ = quantizeOklab(b.rgba, w, h);
    const headQ = quantizeOklab(placed, w, h);
    const targets = headQ.palette.length ? buildHeadTargets(headQ, bQ) : [];
    const merged = Uint8ClampedArray.from(bBody); // head-over-body composite
    const headStamp = [];
    for (const s of rawSamples) {
      const lab = srgbToOklab([s.r, s.g, s.b]);
      const k = headQ.indexMap[s.di];
      const t = k !== 255 && targets[k] ? targets[k] : lab;
      const na = lab[1] + P.harmonize * (t[1] - lab[1]);
      const nb = lab[2] + P.harmonize * (t[2] - lab[2]);
      const [nr, ng, nbl] = oklabToSrgb([lab[0], na, nb]); // keep head L
      const i = s.di * 4;
      merged[i] = nr;
      merged[i + 1] = ng;
      merged[i + 2] = nbl;
      merged[i + 3] = s.a;
      headStamp.push([s.di, nr, ng, nbl, s.a]);
    }

    // -- Stage 6: finish (outline re-synthesis + interior re-stamp) --------
    const finalRgba = finishMerged(merged, headStamp, w, h);

    // -- score / floor -----------------------------------------------------
    const mergedMask = maskOf(merged, w, h);
    const mergedArea = countMask(mergedMask);
    const score = scoreCandidate(mergedMask, mergedArea, rawSamples.length, bArea, w, h);
    if (score < P.scoreFloor) {
      return fallback("below-floor");
    }

    // -- debug layers ------------------------------------------------------
    const bSocketLayer = dimCopy(b.rgba);
    for (let x = B.bbox.x0; x <= B.bbox.x1; x++) {
      setPx(bSocketLayer, w, h, x, cutY, 255, 90, 90, 255); // the cut line
    }
    const sx = Math.round(bSocket.pos.x);
    const sy = Math.round(bSocket.pos.y);
    const sCol = bSocket.kind === "pinch" ? [255, 210, 80] : [120, 200, 255];
    for (let d = -2; d <= 2; d++) {
      setPx(bSocketLayer, w, h, sx + d, sy, sCol[0], sCol[1], sCol[2], 255);
      setPx(bSocketLayer, w, h, sx, sy + d, sCol[0], sCol[1], sCol[2], 255);
    }

    const layers = [
      { label: "bSocket", width: w, height: h, rgba: bSocketLayer },
      { label: "aHead", width: a.width, height: a.height, rgba: maskLayerRGBA(head.mask, a.width, a.height) },
      { label: "bBody", width: w, height: h, rgba: Uint8ClampedArray.from(bBody) },
      { label: "placedHead", width: w, height: h, rgba: placed },
      { label: "harmonized", width: w, height: h, rgba: Uint8ClampedArray.from(merged) },
      { label: "final", width: w, height: h, rgba: Uint8ClampedArray.from(finalRgba) },
    ];

    return {
      width: w,
      height: h,
      rgba: finalRgba,
      layers,
      meta: { rung: "graft", score, socketKind: bSocket.kind },
    };
  } catch (err) {
    return fallback(`exception:${err && err.message ? err.message : err}`);
  }
}

export const partswapStrategy = {
  id: "partswap",
  label: "Part-swap (cut+blend)",
  params: [
    { key: "scaleLo", label: "Scale min", min: 0.2, max: 1, step: 0.05, default: 0.4 },
    { key: "scaleHi", label: "Scale max", min: 1, max: 3, step: 0.05, default: 1.8 },
    { key: "overlapPx", label: "Overlap px", min: 0, max: 4, step: 1, default: 1 },
    { key: "harmonize", label: "Harmonize", min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: "scoreFloor", label: "Score floor", min: 0, max: 1, step: 0.02, default: 0.25 },
  ],
  fuse(a, b, params) {
    return partswapFuse(a, b, params);
  },
};

STRATEGIES.push(partswapStrategy);

// reconstructFrame is part of the plugin import contract (atlas-frame rebuild);
// referenced here so the verbatim import line stays intentional, not dead.
void reconstructFrame;
