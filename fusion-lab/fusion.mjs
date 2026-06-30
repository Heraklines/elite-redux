/* Fusion Lab - fusion strategy engine. Each STRATEGIES entry is a pluggable
 * sprite-fusion algorithm: { id, label, params, fuse(a, b, params) -> FusionResult }
 * where A is the head donor and B is the body donor (the result silhouette is B's body;
 * A contributes its head (graft) or its palette (recolor)).
 *
 *   SpriteData   = { dex, name, width, height, rgba:Uint8ClampedArray }   (Unit 2 loader)
 *   FusionResult = { width, height, rgba:Uint8ClampedArray,
 *                    layers: Array<{ label, width, height, rgba }>, meta: object }
 *
 * Strategies operate on / return PLAIN rgba buffers, never `ImageData` - so they unit-test
 * headlessly under `node --test`. The UI (a later unit) wraps `rgba` into `new ImageData(...)`
 * for drawing; this file stays DOM-free (no ImageData / canvas / document). Image primitives,
 * the strategy registry, and the two strategies (recolor + socketGraft) all live here.
 *
 * The two strategies are defined + pushed at the BOTTOM of this file (after the primitives
 * they compose). Math reference: docs/plans/2026-06-30-sprite-fusion-algorithm-design.md. */

export const STRATEGIES = [];

/* =========================================================================
 * Image-processing primitives (Stage 0-4 of the CHIMERA-FORGE pipeline).
 * Pure functions over typed arrays - no DOM, no canvas - so they unit-test
 * headlessly under `node --test`. Math reference:
 * docs/plans/2026-06-30-sprite-fusion-algorithm-design.md ("Staged Pipeline").
 * ========================================================================= */

/* maskOf - alpha mask. mask[p] = 1 where alpha > aThresh, else 0.
 * Design: M[x,y] = (alpha > 24). The threshold is strict (> not >=).
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba  length w*h*4
 * @param {number} w
 * @param {number} h
 * @param {number} [aThresh=24]
 * @returns {Uint8Array} length w*h, values 0/1
 */
export function maskOf(rgba, w, h, aThresh = 24) {
  const n = w * h;
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    mask[p] = rgba[p * 4 + 3] > aThresh ? 1 : 0;
  }
  return mask;
}

/* components - 8-connected connected components with despeckle.
 * BFS labels every foreground run, then drops components smaller than minPx
 * (their pixels are reset to label 0). Surviving components are relabeled
 * 1..k in descending-area order so `labels` is dense and stable.
 *
 * @param {Uint8Array} mask  0/1, length w*h
 * @param {number} w
 * @param {number} h
 * @param {number} [minPx=6]
 * @returns {{labels: Int32Array, areasDesc: Array<{label:number, area:number}>}}
 */
export function components(mask, w, h, minPx = 6) {
  const n = w * h;
  const raw = new Int32Array(n); // provisional labels (1..)
  const comps = []; // comps[c-1] = array of pixel indices
  let next = 1;
  const queue = new Int32Array(n);
  for (let start = 0; start < n; start++) {
    if (mask[start] === 0 || raw[start] !== 0) {
      continue;
    }
    const label = next++;
    const pixels = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    raw[start] = label;
    while (head < tail) {
      const p = queue[head++];
      pixels.push(p);
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = px + dx;
          if (nx < 0 || nx >= w) {
            continue;
          }
          const q = ny * w + nx;
          if (mask[q] === 1 && raw[q] === 0) {
            raw[q] = label;
            queue[tail++] = q;
          }
        }
      }
    }
    comps.push(pixels);
  }

  // keep survivors (area >= minPx), rank by area descending, relabel 1..k
  const survivors = [];
  for (let c = 0; c < comps.length; c++) {
    if (comps[c].length >= minPx) {
      survivors.push(comps[c]);
    }
  }
  survivors.sort((a, b) => b.length - a.length);

  const labels = new Int32Array(n); // 0 everywhere; fill survivors
  const areasDesc = [];
  for (let i = 0; i < survivors.length; i++) {
    const label = i + 1;
    for (const p of survivors[i]) {
      labels[p] = label;
    }
    areasDesc.push({ label, area: survivors[i].length });
  }
  return { labels, areasDesc };
}

/* ---- OKLab colour space (Bjorn Ottosson). r,g,b in 0..255. -------------- */

function srgbToLinear(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(x) {
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/* srgbToOklab - sRGB(0..255) -> OKLab [L,a,b]. White -> L~1, black -> L~0.
 * @param {number[]} rgb [r,g,b] in 0..255
 * @returns {[number,number,number]} [L,a,b]
 */
export function srgbToOklab([r, g, b]) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/* oklabToSrgb - OKLab [L,a,b] -> sRGB(0..255), rounded & clamped to 0..255.
 * @param {number[]} lab [L,a,b]
 * @returns {[number,number,number]} [r,g,b] in 0..255
 */
export function oklabToSrgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

function labDist2(a, b) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

/* quantizeOklab - median-cut palette in OKLab over opaque pixels (INKFORGE).
 *
 * Builds <= maxColors boxes by repeatedly splitting the widest-range box at its
 * median along its longest OKLab axis, then merges near-identical box means
 * (median-cut over-segments flat regions). `indexMap[p]` = nearest palette index
 * for opaque pixels, or 255 (sentinel) for transparent/background.
 *
 *  - inkIndices: dark palette entries (L < 0.30*Lmax) whose pixels mostly have a
 *    brighter opaque 4-neighbor (outline/keyline role).
 *  - rampRoles: non-ink entries grouped by OKLab hue family (chromatic merged
 *    within 20 deg; achromatic pooled as one neutral family), each family sorted
 *    by L into {shadow, mid, highlight} (palette indices).
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba length w*h*4
 * @param {number} w
 * @param {number} h
 * @param {number} [maxColors=24]
 * @returns {{palette:number[][], indexMap:Uint8Array,
 *            inkIndices:Set<number>, rampRoles:Map<number,object>}}
 */
export function quantizeOklab(rgba, w, h, maxColors = 24) {
  const n = w * h;
  // TODO(tune): 255 transparent-sentinel collides if maxColors > 254 (never
  // happens for the <=24 default); widen the index buffer if that ceiling rises.
  const indexMap = new Uint8Array(n).fill(255);

  const pts = []; // opaque pixels: { p, lab }
  for (let p = 0; p < n; p++) {
    if (rgba[p * 4 + 3] > 24) {
      pts.push({ p, lab: srgbToOklab([rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]]) });
    }
  }
  if (pts.length === 0) {
    return { palette: [], indexMap, inkIndices: new Set(), rampRoles: new Map() };
  }

  const boxRange = box => {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const { lab } of box) {
      for (let a = 0; a < 3; a++) {
        if (lab[a] < mn[a]) {
          mn[a] = lab[a];
        }
        if (lab[a] > mx[a]) {
          mx[a] = lab[a];
        }
      }
    }
    return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  };

  // median-cut
  const boxes = [pts];
  while (boxes.length < maxColors) {
    let bi = -1;
    let bestRange = 1e-6;
    let bestAxis = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) {
        continue;
      }
      const r = boxRange(boxes[i]);
      for (let a = 0; a < 3; a++) {
        if (r[a] > bestRange) {
          bestRange = r[a];
          bi = i;
          bestAxis = a;
        }
      }
    }
    if (bi < 0) {
      break; // no splittable box left
    }
    const box = boxes[bi];
    box.sort((u, v) => u.lab[bestAxis] - v.lab[bestAxis]);
    const mid = box.length >> 1;
    const left = box.slice(0, mid);
    const right = box.slice(mid);
    if (left.length === 0 || right.length === 0) {
      break;
    }
    boxes.splice(bi, 1, left, right);
  }

  // raw palette = box means, then merge near-identical entries
  const raw = boxes.map(box => {
    const m = [0, 0, 0];
    for (const { lab } of box) {
      m[0] += lab[0];
      m[1] += lab[1];
      m[2] += lab[2];
    }
    return [m[0] / box.length, m[1] / box.length, m[2] / box.length];
  });
  const MERGE_EPS2 = 0.02 * 0.02;
  const palette = [];
  for (const c of raw) {
    if (!palette.some(m => labDist2(m, c) < MERGE_EPS2)) {
      palette.push(c.slice());
    }
  }

  // indexMap = nearest final palette entry
  for (const { p, lab } of pts) {
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const d = labDist2(lab, palette[k]);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    indexMap[p] = best;
  }

  // ink: dark entries whose pixels mostly have a brighter opaque 4-neighbor
  let Lmax = 0;
  for (const c of palette) {
    if (c[0] > Lmax) {
      Lmax = c[0];
    }
  }
  const inkThresh = 0.3 * Lmax;
  const total = new Array(palette.length).fill(0);
  const inkPix = new Array(palette.length).fill(0);
  const N4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const { p } of pts) {
    const k = indexMap[p];
    total[k]++;
    if (palette[k][0] >= inkThresh) {
      continue;
    }
    const x = p % w;
    const y = (p - x) / w;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
        continue;
      }
      const kq = indexMap[ny * w + nx];
      if (kq !== 255 && palette[kq][0] > palette[k][0]) {
        inkPix[k]++;
        break;
      }
    }
  }
  const inkIndices = new Set();
  for (let k = 0; k < palette.length; k++) {
    // design: flag entries whose pixels are >70% ink (outline-role)
    if (palette[k][0] < inkThresh && total[k] > 0 && inkPix[k] / total[k] > 0.7) {
      inkIndices.add(k);
    }
  }
  // TODO(tune): also emit signatureAccentIndices (high-chroma, small-area,
  // isolated hue families - flame tips, electric cheeks) for Stage 10/11.

  // ramp roles: group non-ink entries by hue family, sort by L into roles
  const hueDeg = c => (Math.atan2(c[2], c[1]) * 180) / Math.PI;
  const hueDiff = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  };
  const CHROMA_MIN = 0.02;
  const neutrals = [];
  const chromatic = [];
  for (let k = 0; k < palette.length; k++) {
    if (inkIndices.has(k)) {
      continue;
    }
    if (Math.hypot(palette[k][1], palette[k][2]) < CHROMA_MIN) {
      neutrals.push(k);
    } else {
      chromatic.push(k);
    }
  }
  chromatic.sort((a, b) => hueDeg(palette[a]) - hueDeg(palette[b]));
  const families = [];
  for (const k of chromatic) {
    const hk = hueDeg(palette[k]);
    let fam = families.find(f => f.hue !== null && hueDiff(f.hue, hk) < 20);
    if (!fam) {
      fam = { hue: hk, members: [] };
      families.push(fam);
    }
    fam.members.push(k);
  }
  if (neutrals.length) {
    families.push({ hue: null, members: neutrals });
  }
  const rampRoles = new Map();
  let fid = 0;
  for (const f of families) {
    const sorted = f.members.slice().sort((a, b) => palette[a][0] - palette[b][0]);
    rampRoles.set(fid++, {
      hueDeg: f.hue,
      members: sorted,
      shadow: sorted[0],
      mid: sorted[(sorted.length - 1) >> 1],
      highlight: sorted[sorted.length - 1],
    });
  }

  return { palette, indexMap, inkIndices, rampRoles };
}

/* edt - exact Euclidean distance transform (Felzenszwalb-Huttenlocher).
 *
 * Returns, for every foreground pixel, the actual (sqrt) Euclidean distance to
 * the nearest background pixel; background pixels are 0. Implemented as the
 * classic two-pass 1-D squared-distance lower-envelope composition (columns
 * then rows), which is exact and O(n).
 *
 * @param {Uint8Array} mask 0/1, length w*h (1 = foreground)
 * @param {number} w
 * @param {number} h
 * @returns {Float32Array} distance field, length w*h
 */
export function edt(mask, w, h) {
  const INF = 1e20;
  // TODO(tune): a fully-opaque mask (no background seed anywhere) leaves the
  // sentinel in place -> distances ~sqrt(1e20). Real sprites always have a
  // transparent border so this degenerate case is not handled specially.
  // seed: foreground = INF (must reach a 0), background = 0
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    g[i] = mask[i] ? INF : 0;
  }

  // 1-D squared distance transform of a single array f (length n) -> d
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const dt1d = n => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s =
        (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) {
        k++;
      }
      const dist = q - v[k];
      d[q] = dist * dist + f[v[k]];
    }
  };

  // pass 1: columns
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      f[y] = g[y * w + x];
    }
    dt1d(h);
    for (let y = 0; y < h; y++) {
      g[y * w + x] = d[y];
    }
  }
  // pass 2: rows
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      f[x] = g[y * w + x];
    }
    dt1d(w);
    for (let x = 0; x < w; x++) {
      g[y * w + x] = d[x];
    }
  }

  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = Math.sqrt(g[i]);
  }
  return out;
}

/* Zhang-Suen thinning to a 1-px skeleton. Out-of-bounds neighbors read as 0.
 * Neighbour order p2..p9 (clockwise from north):  p9 p2 p3 / p8 p1 p4 / p7 p6 p5
 */
function zhangSuenThin(mask, w, h) {
  const S = Uint8Array.from(mask);
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : S[y * w + x]);

  let changed = true;
  const toClear = [];
  const step = sub => {
    toClear.length = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (S[y * w + x] === 0) {
          continue;
        }
        const p2 = at(x, y - 1);
        const p3 = at(x + 1, y - 1);
        const p4 = at(x + 1, y);
        const p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1);
        const p7 = at(x - 1, y + 1);
        const p8 = at(x - 1, y);
        const p9 = at(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) {
          continue;
        }
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let i = 0; i < 8; i++) {
          if (seq[i] === 0 && seq[i + 1] === 1) {
            A++;
          }
        }
        if (A !== 1) {
          continue;
        }
        if (sub === 0) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) {
            continue;
          }
        } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) {
          continue;
        }
        toClear.push(y * w + x);
      }
    }
    for (const idx of toClear) {
      S[idx] = 0;
    }
    return toClear.length > 0;
  };

  while (changed) {
    changed = false;
    if (step(0)) {
      changed = true;
    }
    if (step(1)) {
      changed = true;
    }
  }
  return S;
}

/* skeletonize - Zhang-Suen thinning + graph trace + radius stamp + spur prune.
 *
 * The 1-px skeleton is traced into a graph: degree-1 pixels are endpoint nodes,
 * degree>=3 are branch nodes, and chains of degree-2 pixels between nodes become
 * edges. Each edge point is stamped with `rho = edtField` (local half-thickness).
 * Leaf->branch spur edges shorter than `max(4, 1.5*rho_base)` are pruned (rho_base
 * = rho at the branch end); the pruned fraction is returned as `prunedRatio`.
 *
 * @param {Uint8Array} mask 0/1, length w*h
 * @param {number} w
 * @param {number} h
 * @param {Float32Array} edtField distance field from edt()
 * @returns {{graph:{nodes:Array<{x,y,deg}>, edges:Array<{a:number,b:number,points:Array<{x,y,rho}>}>}, prunedRatio:number}}
 */
export function skeletonize(mask, w, h, edtField) {
  const S = zhangSuenThin(mask, w, h);
  const inS = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : S[y * w + x]);
  const N8 = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  // Graph adjacency: 8-connected, but a diagonal neighbour is dropped when it is
  // "redundant" - reachable through a shared orthogonal skeleton pixel. This
  // collapses the staircase triangles 8-connectivity manufactures at convex
  // corners, so e.g. a 1px ring resolves to a clean cycle instead of a ring of
  // false branch nodes + duplicate corner edges.
  const adj = p => {
    const x = p % w;
    const y = (p - x) / w;
    const out = [];
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inS(nx, ny)) {
        continue;
      }
      if (dx !== 0 && dy !== 0 && (inS(x + dx, y) || inS(x, y + dy))) {
        continue; // redundant diagonal across a corner
      }
      out.push(ny * w + nx);
    }
    return out;
  };

  // degree (via corrected adjacency); nodes are deg != 2
  const isNode = new Uint8Array(w * h);
  const degOf = new Map();
  const adjOf = new Map();
  const skelPixels = [];
  for (let p = 0; p < w * h; p++) {
    if (S[p]) {
      const a = adj(p);
      adjOf.set(p, a);
      degOf.set(p, a.length);
      skelPixels.push(p);
      if (a.length !== 2) {
        isNode[p] = 1;
      }
    }
  }

  // A pure cycle (a connected skeleton loop with no deg!=2 pixel) would emit no
  // node and therefore no edge, losing the loop entirely. Seed one synthetic node
  // (lowest-index pixel) per node-less component so the loop survives as a single
  // self-edge.
  const seen = new Uint8Array(w * h);
  for (const start of skelPixels) {
    if (seen[start]) {
      continue;
    }
    const stack = [start];
    seen[start] = 1;
    const comp = [];
    let hasNode = false;
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      if (isNode[p]) {
        hasNode = true;
      }
      for (const q of adjOf.get(p)) {
        if (!seen[q]) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (!hasNode) {
      let seed = comp[0];
      for (const p of comp) {
        if (p < seed) {
          seed = p;
        }
      }
      isNode[seed] = 1;
    }
  }

  // node array + pixel->nodeIndex map
  const allNodes = [];
  const nodeIndexByPix = new Map();
  for (const p of skelPixels) {
    if (isNode[p]) {
      const x = p % w;
      nodeIndexByPix.set(p, allNodes.length);
      allNodes.push({ x, y: (p - x) / w, deg: degOf.get(p), pix: p });
    }
  }

  // trace edges: walk deg-2 chains between nodes (corrected adjacency)
  const key = (a, b) => `${a}->${b}`;
  const walked = new Set();
  const rawEdges = [];
  const ptOf = p => {
    const x = p % w;
    return { x, y: (p - x) / w, rho: edtField[p] };
  };
  for (const u of skelPixels) {
    if (!isNode[u]) {
      continue;
    }
    for (const w0 of adjOf.get(u)) {
      if (walked.has(key(u, w0))) {
        continue;
      }
      walked.add(key(u, w0));
      const points = [ptOf(u)];
      let prev = u;
      let cur = w0;
      // guard against pathological loops
      let guard = 0;
      while (guard++ < skelPixels.length + 4) {
        points.push(ptOf(cur));
        if (isNode[cur]) {
          break;
        }
        const nexts = adjOf.get(cur).filter(q => q !== prev);
        if (nexts.length === 0) {
          break;
        }
        prev = cur;
        cur = nexts[0];
      }
      // mark the reverse direction so we don't walk it again from the far end
      if (points.length >= 2) {
        const beforeLast = points[points.length - 2];
        const beforeLastPix = beforeLast.y * w + beforeLast.x;
        walked.add(key(cur, beforeLastPix));
      }
      rawEdges.push({
        a: nodeIndexByPix.get(u),
        b: nodeIndexByPix.has(cur) ? nodeIndexByPix.get(cur) : nodeIndexByPix.get(u),
        points,
      });
    }
  }

  // prune leaf<->branch spurs shorter than max(4, 1.5*rho_base)
  const arclen = pts => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return len;
  };
  let prunedCount = 0;
  const surviving = [];
  for (const e of rawEdges) {
    const da = allNodes[e.a].deg;
    const db = allNodes[e.b].deg;
    const isSpur = (da === 1 && db >= 3) || (db === 1 && da >= 3);
    if (isSpur) {
      const branchNode = da >= 3 ? allNodes[e.a] : allNodes[e.b];
      const rhoBase = edtField[branchNode.pix] || 0;
      const threshold = Math.max(4, 1.5 * rhoBase);
      if (arclen(e.points) < threshold) {
        prunedCount++;
        continue;
      }
    }
    surviving.push(e);
  }
  const prunedRatio = rawEdges.length === 0 ? 0 : prunedCount / rawEdges.length;

  // recompute node degree from the SURVIVING edges (a self-loop counts twice) so
  // emitted `deg` matches the pruned graph, then compact to referenced nodes
  // (plus any genuinely isolated deg-0 nodes).
  const degCount = new Array(allNodes.length).fill(0);
  for (const e of surviving) {
    if (e.a === e.b) {
      degCount[e.a] += 2;
    } else {
      degCount[e.a]++;
      degCount[e.b]++;
    }
  }
  const remap = new Map();
  const nodes = [];
  for (let i = 0; i < allNodes.length; i++) {
    if (degCount[i] > 0 || allNodes[i].deg === 0) {
      remap.set(i, nodes.length);
      nodes.push({ x: allNodes[i].x, y: allNodes[i].y, deg: degCount[i] });
    }
  }
  const edges = surviving.map(e => ({
    a: remap.get(e.a),
    b: remap.get(e.b),
    points: e.points,
  }));

  return { graph: { nodes, edges }, prunedRatio };
}

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

/* detectSockets - propose attachment sockets (Stage 3 hypothesis bag, H1 + H3).
 *
 * `analysis` is the per-sprite bundle Unit 4 assembles and is consistent across
 * the pipeline:
 *   { w, h, mask:Uint8Array, edt:Float32Array,
 *     skeleton:{graph,prunedRatio}, components?:{labels,areasDesc},
 *     headRegion?:{x0,y0,x1,y1} }   // headRegion optional; defaults to full image
 *
 * Returns Socket[] where
 *   Socket = { pos:{x,y}, normal:{x,y}, width, conf, kind:'pinch'|'contact' }.
 *
 * H1 (pinch): on the longest skeleton edge, s* = argmin rho subject to a
 *   prominence test (flanks within +-3 arclength reach rho >= 1.3*rho_min).
 *   width = 2*rho_min, normal = edge tangent (unit), conf from flank/min ratio.
 * H3 (contact arc): head-disk center = argmax edt (within headRegion), radius
 *   R = edt there; socket at the disk boundary toward the body along the spine
 *   direction (head-disk center -> mass centroid). Always returned whenever any
 *   foreground exists (conf lower-bounded at 0.2).
 *
 * @param {{width:number,height:number,mask?:Uint8Array}} spriteData
 * @param {object} analysis
 * @returns {Array<{pos:{x:number,y:number}, normal:{x:number,y:number}, width:number, conf:number, kind:string}>}
 */
export function detectSockets(spriteData, analysis) {
  const w = analysis.w ?? spriteData.width;
  const h = analysis.h ?? spriteData.height;
  const mask = analysis.mask ?? spriteData.mask;
  const field = analysis.edt;
  const edges = analysis.skeleton?.graph?.edges ?? [];
  const sockets = [];

  // ---- H1: skeleton-rho pinch ------------------------------------------
  // longest skeleton edge with enough points to have a centerline
  let main = null;
  let mainLen = -1;
  for (const e of edges) {
    if (e.points.length < 3) {
      continue;
    }
    let len = 0;
    for (let i = 1; i < e.points.length; i++) {
      len += Math.hypot(e.points[i].x - e.points[i - 1].x, e.points[i].y - e.points[i - 1].y);
    }
    if (len > mainLen) {
      mainLen = len;
      main = e;
    }
  }
  if (main) {
    const pts = main.points;
    // cumulative arclength
    const s = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) {
      s[i] = s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    let rhoHeadDisk = 0;
    for (const p of pts) {
      if (p.rho > rhoHeadDisk) {
        rhoHeadDisk = p.rho;
      }
    }
    // Evaluate the prominence test at EVERY local minimum and keep the most
    // prominent one. Picking the index-median of all min-rho pixels (the prior
    // approach) drifts off the neck for asymmetric shapes whenever a limb tip or
    // a thin stretch elsewhere on the edge shares the neck's thickness; scoring
    // each local min by its flank/min ratio is appendage-immune.
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const r = pts[i].rho;
      if (r <= 0) {
        continue;
      }
      const lOk = i === 0 || pts[i - 1].rho >= r;
      const rOk = i === pts.length - 1 || pts[i + 1].rho >= r;
      if (!lOk || !rOk) {
        continue; // not a (non-strict) local minimum
      }
      let flankL = 0;
      let flankR = 0;
      for (let j = 0; j < pts.length; j++) {
        const ds = s[j] - s[i];
        if (ds < 0 && ds >= -3) {
          flankL = Math.max(flankL, pts[j].rho);
        } else if (ds > 0 && ds <= 3) {
          flankR = Math.max(flankR, pts[j].rho);
        }
      }
      if (flankL >= 1.3 * r && flankR >= 1.3 * r) {
        const score = Math.min(flankL, flankR) / r;
        if (!best || score > best.score) {
          best = { i, r, flankL, flankR, score };
        }
      }
    }
    if (best) {
      const i = best.i;
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      // Orient the tangent toward the higher-rho (head-disk) end of the edge so
      // the consumer gets a stable facing, not a trace-direction-dependent,
      // 180-degree-ambiguous one. The raw tangent (a->b) points toward the edge
      // END; flip it when the head disk is at the START.
      if (pts[0].rho > pts[pts.length - 1].rho) {
        tx = -tx;
        ty = -ty;
      }
      const conf = clamp01((Math.min(best.flankL, best.flankR) - best.r) / Math.max(rhoHeadDisk, 1e-6));
      sockets.push({
        pos: { x: pts[i].x, y: pts[i].y },
        normal: { x: tx, y: ty },
        width: 2 * best.r,
        conf,
        kind: "pinch",
      });
    }
  }

  // ---- H3: head-disk contact arc (always defined when foreground exists) ----
  // TODO(tune): without Stage-2 body-plan classification the head region defaults
  // to the GLOBAL argmax EDT (largest inscribed disk); Unit 4 will pass
  // analysis.headRegion so this targets the actual head rather than the torso.
  const region = analysis.headRegion ?? { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  let hx = -1;
  let hy = -1;
  let R = 0;
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      const d = field[y * w + x];
      if (d > R) {
        R = d;
        hx = x;
        hy = y;
      }
    }
  }
  if (R > 0) {
    // foreground centroid -> spine direction (head-disk center toward the body)
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let p = 0; p < w * h; p++) {
      if (mask[p]) {
        sx += p % w;
        sy += (p / w) | 0;
        count++;
      }
    }
    let dirx = count ? sx / count - hx : 0;
    let diry = count ? sy / count - hy : 1;
    let dl = Math.hypot(dirx, diry);
    if (dl < 1e-6) {
      dirx = 0;
      diry = 1;
      dl = 1;
    }
    dirx /= dl;
    diry /= dl;

    const px = hx + R * dirx;
    const py = hy + R * diry;

    // chord = foreground extent through (px,py) perpendicular to the spine dir
    const perpx = -diry;
    const perpy = dirx;
    const sample = (fx, fy) => {
      const ix = Math.round(fx);
      const iy = Math.round(fy);
      return ix < 0 || iy < 0 || ix >= w || iy >= h ? 0 : mask[iy * w + ix];
    };
    let chord = sample(px, py) ? 1 : 0;
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let t = 1; t < Math.max(w, h); t++) {
        if (sample(px + perpx * t * dir, py + perpy * t * dir)) {
          chord++;
        } else {
          break;
        }
      }
    }
    const width = chord > 0 ? chord : Math.max(1, Math.round(R));
    const conf = clamp01(Math.max(0.2, R / (0.5 * Math.min(w, h))));
    sockets.push({
      pos: { x: px, y: py },
      normal: { x: dirx, y: diry },
      width,
      conf,
      kind: "contact",
    });
  }

  return sockets;
}

/* reconstructFrame - PURE frame reconstruction from a TexturePacker atlas.
 *
 * Sprites ship as trimmed atlas frames: a frame's atlas sub-rect (`frame.{x,y,w,h}`)
 * is only the non-transparent bounding box, and `spriteSourceSize.{x,y}` says where
 * that box sits inside the full, untrimmed sprite of size `sourceSize.{w,h}`. This
 * rebuilds the full sprite: a transparent `sourceSize` buffer with the atlas sub-rect
 * blitted in at the trim offset.
 *
 * Operates entirely on typed arrays - NO DOM / canvas - so it unit-tests headlessly
 * and is reused by the fusion algorithm in a later unit. The browser loader
 * (`loadSpecies` in app.js) feeds it the full atlas RGBA from a one-shot getImageData.
 *
 * @param {Uint8ClampedArray} atlasRGBA  full atlas pixels, length atlasW*atlasH*4
 * @param {number} atlasW                atlas width in px
 * @param {number} atlasH                atlas height in px
 * @param {{x:number,y:number,w:number,h:number}} frame          sub-rect inside the atlas
 * @param {{x:number,y:number}} spriteSourceSize                 trim offset into the full sprite
 * @param {{w:number,h:number}} sourceSize                       full (untrimmed) sprite size
 * @returns {{width:number,height:number,rgba:Uint8ClampedArray}}
 */
export function reconstructFrame(atlasRGBA, atlasW, atlasH, frame, spriteSourceSize, sourceSize) {
  const width = sourceSize.w;
  const height = sourceSize.h;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const offX = (spriteSourceSize && spriteSourceSize.x) || 0;
  const offY = (spriteSourceSize && spriteSourceSize.y) || 0;
  for (let yy = 0; yy < frame.h; yy++) {
    for (let xx = 0; xx < frame.w; xx++) {
      const sx = frame.x + xx;
      const sy = frame.y + yy;
      if (sx < 0 || sy < 0 || sx >= atlasW || sy >= atlasH) {
        continue;
      }
      const dx = offX + xx;
      const dy = offY + yy;
      if (dx < 0 || dy < 0 || dx >= width || dy >= height) {
        continue;
      }
      const si = (sy * atlasW + sx) * 4;
      const di = (dy * width + dx) * 4;
      rgba[di] = atlasRGBA[si];
      rgba[di + 1] = atlasRGBA[si + 1];
      rgba[di + 2] = atlasRGBA[si + 2];
      rgba[di + 3] = atlasRGBA[si + 3];
    }
  }
  return { width, height, rgba };
}

/* =========================================================================
 * Fusion STRATEGIES (Unit 4) - compose the primitives above into fusions.
 * Pure rgba in/out (SpriteData -> FusionResult), no DOM. Two rungs of the
 * design's fallback ladder are implemented:
 *   - recolor      (rung 5, the floor) - always works, never garbage.
 *   - socketGraft   (rung 2, money path) - H1+H3 socket graft, MVP of Stage 5-12;
 *                   wrapped in try/catch and falls back to recolor.
 * ========================================================================= */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const DEFAULT_BETA = 0.55;

// ---- tiny rgba canvas helpers (debug-layer painting) ---------------------

const blankRGBA = (w, h) => new Uint8ClampedArray(w * h * 4);

function setPx(out, w, h, x, y, [r, g, b, a]) {
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

function fillRect(out, w, x0, y0, rw, rh, [r, g, b, a]) {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      const i = (y * w + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = a;
    }
  }
}

// dimmed copy of an rgba buffer so overlay markers pop against the source sprite
function dimCopy(rgba) {
  const o = Uint8ClampedArray.from(rgba);
  for (let i = 0; i < o.length; i += 4) {
    o[i] = (o[i] * 0.38) | 0;
    o[i + 1] = (o[i + 1] * 0.38) | 0;
    o[i + 2] = (o[i + 2] * 0.38) | 0;
  }
  return o;
}

function heatColor(t) {
  t = clamp(t, 0, 1);
  const r = Math.round(255 * clamp(1.4 * t - 0.2, 0, 1));
  const g = Math.round(255 * clamp(1 - Math.abs(2 * t - 1), 0, 1));
  const b = Math.round(255 * clamp(1.2 - 1.4 * t, 0, 1));
  return [r, g, b];
}

const countMask = mask => {
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    n += mask[i];
  }
  return n;
};

// ---- geometry helpers ----------------------------------------------------

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

/* topBandRegion - the head-region heuristic Unit 4 feeds detectSockets so H3's
 * head-disk targets the actual head, not the torso (resolves the Stage-3 TODO).
 * = foreground bbox intersected with its top `frac` (~45%) of height. */
function topBandRegion(mask, w, h, frac) {
  const bb = maskBBox(mask, w, h);
  if (!bb) {
    return null;
  }
  const y1 = Math.round(bb.y0 + frac * (bb.y1 - bb.y0));
  return { x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: clamp(y1, bb.y0, bb.y1) };
}

/* buildAnalysis - assemble the per-sprite analysis bundle detectSockets consumes:
 * { w, h, mask, edt, skeleton, components, headRegion }. */
function buildAnalysis(sprite) {
  const w = sprite.width;
  const h = sprite.height;
  const mask = maskOf(sprite.rgba, w, h);
  const comp = components(mask, w, h);
  const field = edt(mask, w, h);
  const skeleton = skeletonize(mask, w, h, field);
  const headRegion = topBandRegion(mask, w, h, 0.45);
  return { w, h, mask, edt: field, skeleton, components: comp, headRegion };
}

/* extractHead - locate A's head "plug": the foreground inside A's head region,
 * its base (where the head meets the body, used as the graft anchor), and its
 * attach width (the base-row chord, paired against B's socket width to scale). */
function extractHead(a, analysis) {
  const w = a.width;
  const region = analysis.headRegion;
  if (!region) {
    return { count: 0 };
  }
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let sx = 0;
  let count = 0;
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      if (a.rgba[(y * w + x) * 4 + 3] > 24) {
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
        count++;
      }
    }
  }
  if (count === 0) {
    return { count: 0 };
  }
  let chord = 0;
  for (let x = minx; x <= maxx; x++) {
    if (a.rgba[(maxy * w + x) * 4 + 3] > 24) {
      chord++;
    }
  }
  const plugWidth = Math.max(2, chord || maxx - minx + 1);
  return {
    count,
    bbox: { x0: minx, y0: miny, x1: maxx, y1: maxy },
    base: { x: sx / count, y: maxy },
    plugWidth,
  };
}

// ---- candidate render (render-2) -----------------------------------------

/* composeCandidate - place A's head on B's body at one socket. Axis-aligned
 * clamped scale + translate (MVP of Stage 6/7; no TPS warp / RotSprite yet):
 *  - scale  = clamp(socket.width / headPlugWidth, scaleLo, scaleHi)
 *  - bodyDir = direction from the socket into B's body (socket-kind aware; the
 *    pinch normal points toward the head, the contact normal toward the body)
 *  - clear B's pixels on the head side of the cut (within the head's span)
 *  - composite A's head, anchored so its base lands on socket.pos + overlap.
 * Returns { rgba, headStamp, headArea, kind, scale } - headStamp re-paints the
 * head interior after the outline pass (anti eyeless-cutout). */
function composeCandidate(a, head, b, socket, P, kind) {
  const w = b.width;
  const h = b.height;
  const aw = a.width;
  const out = Uint8ClampedArray.from(b.rgba);

  let bdx = socket.normal.x;
  let bdy = socket.normal.y;
  if (kind === "pinch") {
    bdx = -bdx;
    bdy = -bdy;
  }
  const bl = Math.hypot(bdx, bdy) || 1;
  bdx /= bl;
  bdy /= bl;

  const scale = clamp(socket.width / head.plugWidth, P.scaleLo, P.scaleHi);
  const baseX = socket.pos.x + bdx * P.overlapPx;
  const baseY = socket.pos.y + bdy * P.overlapPx;

  // clear B's head: pixels on the head side of the socket cut, within the head's span
  const clearHalf = Math.max(socket.width, head.plugWidth * scale) * 0.6 + 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const along = (x + 0.5 - socket.pos.x) * bdx + (y + 0.5 - socket.pos.y) * bdy;
      if (along >= 0) {
        continue; // body side - keep
      }
      const perp = (x + 0.5 - socket.pos.x) * -bdy + (y + 0.5 - socket.pos.y) * bdx;
      if (Math.abs(perp) > clearHalf) {
        continue; // outside the head column - keep (don't nuke far body parts)
      }
      const i = (y * w + x) * 4;
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
    }
  }

  // dest bbox = transform of A's head bbox corners
  const tf = (ax, ay) => [baseX + (ax - head.base.x) * scale, baseY + (ay - head.base.y) * scale];
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

  // inverse-map each dest pixel back into A's head and sample (nearest)
  const headStamp = [];
  let headArea = 0;
  for (let dy = y0; dy <= y1; dy++) {
    for (let dx = x0; dx <= x1; dx++) {
      const sxp = Math.round(head.base.x + (dx - baseX) / scale);
      const syp = Math.round(head.base.y + (dy - baseY) / scale);
      if (sxp < head.bbox.x0 || sxp > head.bbox.x1 || syp < head.bbox.y0 || syp > head.bbox.y1) {
        continue;
      }
      const si = (syp * aw + sxp) * 4;
      if (a.rgba[si + 3] <= 24) {
        continue;
      }
      const di = (dy * w + dx) * 4;
      const r = a.rgba[si];
      const g = a.rgba[si + 1];
      const bb = a.rgba[si + 2];
      const al = a.rgba[si + 3];
      out[di] = r;
      out[di + 1] = g;
      out[di + 2] = bb;
      out[di + 3] = al;
      headStamp.push([dy * w + dx, r, g, bb, al]);
      headArea++;
    }
  }
  return { rgba: out, headStamp, headArea, kind, scale };
}

// ---- finish pass (Stage 12 lite) -----------------------------------------

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

/* finishCandidate - re-synthesise ONE 1px outline from the merged alpha
 * (outline = mask AND NOT erode(mask), painted a dark tinted tone) and re-stamp
 * A's head interior so the face is not an eyeless cutout. */
function finishCandidate(cand, w, h) {
  const mask = maskOf(cand.rgba, w, h);
  const er = erode4(mask, w, h);
  const out = Uint8ClampedArray.from(cand.rgba);
  const ink = [26, 22, 34, 255]; // tinted near-black keyline
  for (let p = 0; p < w * h; p++) {
    if (mask[p] && !er[p]) {
      out[p * 4] = ink[0];
      out[p * 4 + 1] = ink[1];
      out[p * 4 + 2] = ink[2];
      out[p * 4 + 3] = ink[3];
    }
  }
  // re-stamp A's head interior (only where eroded, i.e. not on the new outline)
  for (const [p, r, g, b, a] of cand.headStamp) {
    if (er[p]) {
      out[p * 4] = r;
      out[p * 4 + 1] = g;
      out[p * 4 + 2] = b;
      out[p * 4 + 3] = a;
    }
  }
  return out;
}

// ---- cheap plausibility score (Stage 8 lite) -----------------------------

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

function scoreCandidate(cand, bArea, w, h) {
  const comp = components(cand.mask, w, h, 1);
  const largest = comp.areasDesc.length ? comp.areasDesc[0].area : 0;
  const conn = cand.area > 0 ? largest / cand.area : 0; // outline-closed proxy
  const areaRatio = bArea > 0 ? cand.area / bArea : 0;
  const sil = scoreRange(areaRatio, 0.6, 1.6, 1.0);
  const headRatio = cand.area > 0 ? cand.headArea / cand.area : 0;
  const headS = scoreRange(headRatio, 0.04, 0.7, 0.3);
  return 0.4 * sil + 0.25 * headS + 0.35 * conn;
}

// ---- debug-layer painters ------------------------------------------------

function maskLayerRGBA(mask, w, h, [r, g, b] = [228, 230, 244]) {
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

function heatLayerRGBA(field, w, h) {
  let mx = 0;
  for (let i = 0; i < field.length; i++) {
    if (field[i] > mx) {
      mx = field[i];
    }
  }
  const out = blankRGBA(w, h);
  for (let p = 0; p < w * h; p++) {
    if (field[p] <= 0) {
      continue;
    }
    const [r, g, b] = heatColor(mx > 0 ? field[p] / mx : 0);
    out[p * 4] = r;
    out[p * 4 + 1] = g;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = 255;
  }
  return out;
}

function skeletonLayerRGBA(b, skel) {
  const w = b.width;
  const h = b.height;
  const out = dimCopy(b.rgba);
  for (const e of skel.graph.edges) {
    for (const pt of e.points) {
      setPx(out, w, h, pt.x, pt.y, [92, 232, 142, 255]);
    }
  }
  for (const n of skel.graph.nodes) {
    setPx(out, w, h, n.x, n.y, [255, 92, 92, 255]);
  }
  return out;
}

function socketLayerRGBA(b, sockets) {
  const w = b.width;
  const h = b.height;
  const out = dimCopy(b.rgba);
  for (const s of sockets) {
    const col = s.kind === "pinch" ? [255, 210, 80, 255] : [120, 200, 255, 255];
    const x = Math.round(s.pos.x);
    const y = Math.round(s.pos.y);
    for (let d = -2; d <= 2; d++) {
      setPx(out, w, h, x + d, y, col);
      setPx(out, w, h, x, y + d, col);
    }
    for (let t = 1; t <= 4; t++) {
      setPx(out, w, h, Math.round(s.pos.x + s.normal.x * t), Math.round(s.pos.y + s.normal.y * t), [
        255, 255, 255, 255,
      ]);
    }
  }
  return out;
}

function swatchRGBA(palette) {
  const cell = 8;
  const n = Math.max(1, palette.length);
  const width = n * cell;
  const height = cell;
  const rgba = blankRGBA(width, height);
  for (let i = 0; i < palette.length; i++) {
    const [r, g, b] = oklabToSrgb(palette[i]);
    fillRect(rgba, width, i * cell, 0, cell, cell, [r, g, b, 255]);
  }
  return { width, height, rgba };
}

function roleMapRGBA(quant, roles, w, h) {
  const col = {
    shadow: [60, 60, 92],
    mid: [140, 140, 162],
    highlight: [236, 236, 246],
    ink: [22, 20, 30],
  };
  const out = blankRGBA(w, h);
  for (let p = 0; p < w * h; p++) {
    const k = quant.indexMap[p];
    if (k === 255) {
      continue;
    }
    const c = col[roles[k]] || col.mid;
    out[p * 4] = c[0];
    out[p * 4 + 1] = c[1];
    out[p * 4 + 2] = c[2];
    out[p * 4 + 3] = 255;
  }
  return out;
}

// ---- OKLab role helpers (recolor) ----------------------------------------

const paletteHue = lab => Math.atan2(lab[2], lab[1]);
const chromaOf = lab => Math.hypot(lab[1], lab[2]);
function hueDist(h1, h2) {
  const d = Math.abs(h1 - h2) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/* rolesOf - per palette-index role label {shadow|mid|highlight|ink} from the
 * quantizer's inkIndices + rampRoles (the luminance buckets of Stage 11). */
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
 * chroma+hue toward: the same-role A entry of nearest hue (chromatic) or nearest
 * L (ink/neutral). When A === B the nearest match is the entry itself, so the
 * transfer is identity (the recolor(a,a) ~= a contract). A with no palette ->
 * target = the B entry (no change). */
function buildRecolorTargets(aQuant, bQuant) {
  const aRoles = rolesOf(aQuant);
  const bRoles = rolesOf(bQuant);
  const aEntries = aQuant.palette.map((lab, k) => ({
    lab,
    role: aRoles[k],
    hue: paletteHue(lab),
    chroma: chromaOf(lab),
    L: lab[0],
  }));
  const targets = new Array(bQuant.palette.length);
  for (let k = 0; k < bQuant.palette.length; k++) {
    const blab = bQuant.palette[k];
    const brole = bRoles[k];
    const bhue = paletteHue(blab);
    const bchroma = chromaOf(blab);
    let pool = aEntries.filter(e => e.role === brole);
    if (pool.length === 0) {
      pool = aEntries;
    }
    if (pool.length === 0) {
      targets[k] = blab; // A empty -> identity
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

// ---- recolor strategy (rung 5, the floor) --------------------------------

/* recolorFuse - B's pixels recoloured toward A's role-matched palette. Each
 * opaque B pixel keeps its own L (preserves shading + light direction) and moves
 * its (a,b) chroma toward the target by `beta`; transparent stays transparent.
 * Used both as the `recolor` strategy and as socketGraft's never-throw fallback. */
function recolorFuse(a, b, params) {
  const beta = clamp(params?.beta ?? DEFAULT_BETA, 0, 1);
  const aQ = quantizeOklab(a.rgba, a.width, a.height);
  const bQ = quantizeOklab(b.rgba, b.width, b.height);
  const targets = buildRecolorTargets(aQ, bQ);

  const w = b.width;
  const h = b.height;
  const out = Uint8ClampedArray.from(b.rgba);
  for (let p = 0; p < w * h; p++) {
    const k = bQ.indexMap[p];
    if (k === 255) {
      continue; // transparent / background stays as-is
    }
    const i = p * 4;
    const lab = srgbToOklab([out[i], out[i + 1], out[i + 2]]);
    const t = targets[k] || lab;
    const na = lab[1] + beta * (t[1] - lab[1]);
    const nb = lab[2] + beta * (t[2] - lab[2]);
    const [r, g, bl] = oklabToSrgb([lab[0], na, nb]);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = bl;
  }

  const aSwatch = swatchRGBA(aQ.palette);
  const bSwatch = swatchRGBA(bQ.palette);
  const layers = [
    { label: "paletteA", width: aSwatch.width, height: aSwatch.height, rgba: aSwatch.rgba },
    { label: "paletteB", width: bSwatch.width, height: bSwatch.height, rgba: bSwatch.rgba },
    { label: "roleMapB", width: w, height: h, rgba: roleMapRGBA(bQ, rolesOf(bQ), w, h) },
  ];
  return { width: w, height: h, rgba: out, layers, meta: { rung: "recolor" } };
}

// ---- socketGraft strategy (rung 2, money path) ---------------------------

/* socketGraftFuse - graft A's head onto B's body at the best H1/H3 socket.
 * Whole body wrapped in try/catch; falls back to recolor on ANY throw, when no
 * socket/viable candidate is found, or when the best score is below `scoreFloor`.
 * On success meta = { rung:'graft', score, socketKind }. Emits a debug layer per
 * stage (maskA, maskB, edtB heat, skeletonB, sockets, the 2 candidates, chosen,
 * final). MVP of Stage 5-12: clamped scale + translate, no TPS warp / re-shade. */
function socketGraftFuse(a, b, params) {
  const P = {
    scaleLo: params?.scaleLo ?? 0.5,
    scaleHi: params?.scaleHi ?? 1.8,
    overlapPx: Math.round(params?.overlapPx ?? 1),
    scoreFloor: params?.scoreFloor ?? 0.3,
  };
  const fallback = reason => {
    const r = recolorFuse(a, b, { beta: DEFAULT_BETA });
    r.meta = { ...r.meta, reason };
    return r;
  };

  try {
    const A = buildAnalysis(a);
    const B = buildAnalysis(b);
    const head = extractHead(a, A);
    if (!head.count || head.count < 6) {
      return fallback("no-head"); // degenerate / empty A
    }

    const bSockets = detectSockets({ width: b.width, height: b.height, mask: B.mask }, B);
    if (!bSockets.length) {
      return fallback("no-socket");
    }

    // best socket per kind (H1 pinch + H3 contact), highest conf
    const pickKind = kind =>
      bSockets.filter(s => s.kind === kind).sort((x, y) => y.conf - x.conf)[0];
    const chosenSockets = [pickKind("pinch"), pickKind("contact")].filter(Boolean);

    const bArea = countMask(B.mask);
    const minHead = Math.max(6, 0.02 * bArea);
    const rasters = []; // every composite (for layers)
    const cands = []; // viable composites (for scoring)
    for (const s of chosenSockets) {
      const c = composeCandidate(a, head, b, s, P, s.kind);
      c.mask = maskOf(c.rgba, b.width, b.height);
      c.area = countMask(c.mask);
      c.viable = c.headArea >= minHead;
      c.score = c.viable ? scoreCandidate(c, bArea, b.width, b.height) : 0;
      rasters.push(c);
      if (c.viable) {
        cands.push(c);
      }
    }
    if (!cands.length) {
      return fallback("no-viable-candidate");
    }

    cands.sort((x, y) => y.score - x.score);
    const chosen = cands[0];
    if (chosen.score < P.scoreFloor) {
      return fallback("below-floor");
    }

    const finalRgba = finishCandidate(chosen, b.width, b.height);

    const layers = [
      { label: "maskA", width: a.width, height: a.height, rgba: maskLayerRGBA(A.mask, a.width, a.height) },
      { label: "maskB", width: b.width, height: b.height, rgba: maskLayerRGBA(B.mask, b.width, b.height) },
      { label: "edtB", width: b.width, height: b.height, rgba: heatLayerRGBA(B.edt, b.width, b.height) },
      { label: "skeletonB", width: b.width, height: b.height, rgba: skeletonLayerRGBA(b, B.skeleton) },
      { label: "sockets", width: b.width, height: b.height, rgba: socketLayerRGBA(b, bSockets) },
    ];
    for (const c of rasters) {
      layers.push({
        label: `candidate:${c.kind}${c.viable ? "" : " (rejected)"} s=${c.score.toFixed(2)}`,
        width: b.width,
        height: b.height,
        rgba: Uint8ClampedArray.from(c.rgba),
      });
    }
    layers.push({
      label: "chosen (pre-finish)",
      width: b.width,
      height: b.height,
      rgba: Uint8ClampedArray.from(chosen.rgba),
    });
    layers.push({ label: "final", width: b.width, height: b.height, rgba: Uint8ClampedArray.from(finalRgba) });

    return {
      width: b.width,
      height: b.height,
      rgba: finalRgba,
      layers,
      meta: { rung: "graft", score: chosen.score, socketKind: chosen.kind },
    };
  } catch (err) {
    return fallback(`exception:${err && err.message ? err.message : err}`);
  }
}

// ---- registry ------------------------------------------------------------

STRATEGIES.push(
  {
    id: "recolor",
    label: "Recolor (OKLab role)",
    params: [{ key: "beta", label: "Blend", min: 0, max: 1, step: 0.02, default: 0.55 }],
    fuse: recolorFuse,
  },
  {
    id: "socketGraft",
    label: "Socket Graft (H1+H3)",
    params: [
      { key: "scaleLo", label: "Scale min", min: 0.2, max: 1, step: 0.05, default: 0.5 },
      { key: "scaleHi", label: "Scale max", min: 1, max: 3, step: 0.05, default: 1.8 },
      { key: "overlapPx", label: "Overlap px", min: 0, max: 4, step: 1, default: 1 },
      { key: "scoreFloor", label: "Score floor", min: 0, max: 1, step: 0.02, default: 0.3 },
    ],
    fuse: socketGraftFuse,
  },
);
