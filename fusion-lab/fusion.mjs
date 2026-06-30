/* Fusion Lab - fusion strategy engine. Each STRATEGIES entry is a pluggable
 * sprite-fusion algorithm: { id, label, params, fuse(a, b, p) -> { image, layers, meta } }
 * where A is the head donor and B is the body donor. Image primitives + the strategy
 * registry live here (kept dependency-free so they unit-test under `node --test`).
 * Stub for now - the algorithm lands in a later unit. */

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
    if (palette[k][0] < inkThresh && total[k] > 0 && inkPix[k] / total[k] > 0.5) {
      inkIndices.add(k);
    }
  }

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
  const nbrsOf = p => {
    const x = p % w;
    const y = (p - x) / w;
    const out = [];
    for (const [dx, dy] of N8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
        continue;
      }
      const q = ny * w + nx;
      if (S[q]) {
        out.push(q);
      }
    }
    return out;
  };

  // degree of each skeleton pixel; nodes are deg != 2
  const isNode = new Uint8Array(w * h);
  const degOf = new Map();
  const skelPixels = [];
  for (let p = 0; p < w * h; p++) {
    if (S[p]) {
      const deg = nbrsOf(p).length;
      degOf.set(p, deg);
      skelPixels.push(p);
      if (deg !== 2) {
        isNode[p] = 1;
      }
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

  // trace edges: walk deg-2 chains between nodes
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
    for (const w0 of nbrsOf(u)) {
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
        const nexts = nbrsOf(cur).filter(q => q !== prev);
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

  // compact node array to those referenced by surviving edges (+ isolated nodes)
  const used = new Set();
  for (const e of surviving) {
    used.add(e.a);
    used.add(e.b);
  }
  const remap = new Map();
  const nodes = [];
  for (let i = 0; i < allNodes.length; i++) {
    if (used.has(i) || allNodes[i].deg === 0) {
      remap.set(i, nodes.length);
      const { x, y, deg } = allNodes[i];
      nodes.push({ x, y, deg });
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
 *   direction (head-disk center -> mass centroid). ALWAYS returned (conf >= 0.2).
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
    // argmin rho; for a flat min-plateau take its middle index
    let rhoMin = Infinity;
    for (const p of pts) {
      if (p.rho < rhoMin) {
        rhoMin = p.rho;
      }
    }
    const minIdx = [];
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].rho <= rhoMin + 1e-6) {
        minIdx.push(i);
      }
    }
    const iMin = minIdx[(minIdx.length - 1) >> 1];

    // flanks within +-3 arclength
    let flankL = 0;
    let flankR = 0;
    for (let i = 0; i < pts.length; i++) {
      const ds = s[i] - s[iMin];
      if (ds < 0 && ds >= -3) {
        flankL = Math.max(flankL, pts[i].rho);
      } else if (ds > 0 && ds <= 3) {
        flankR = Math.max(flankR, pts[i].rho);
      }
    }
    const prominent =
      rhoMin > 0 && flankL >= 1.3 * rhoMin && flankR >= 1.3 * rhoMin;
    if (prominent) {
      const a = pts[Math.max(0, iMin - 1)];
      const b = pts[Math.min(pts.length - 1, iMin + 1)];
      let tx = b.x - a.x;
      let ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      let rhoHeadDisk = 0;
      for (const p of pts) {
        if (p.rho > rhoHeadDisk) {
          rhoHeadDisk = p.rho;
        }
      }
      const conf = clamp01((Math.min(flankL, flankR) - rhoMin) / Math.max(rhoHeadDisk, 1e-6));
      sockets.push({
        pos: { x: pts[iMin].x, y: pts[iMin].y },
        normal: { x: tx, y: ty },
        width: 2 * rhoMin,
        conf,
        kind: "pinch",
      });
    }
  }

  // ---- H3: head-disk contact arc (always defined) ----------------------
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
