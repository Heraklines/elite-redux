// Shared shiny-effect math (v2). Each effect is either:
//  - PALETTE class: a pure pointwise fn of source color f(r,g,b) -> rgb. In-game
//    these are the existing 32-slot variant palette swap (apply f to the 11 base
//    colors) => crossplay-safe, free, no shader edit.
//  - AURA class: depends on uv position / time / an edge field (ctx.e) / a sampler
//    (ctx.sa). The animated overlay layer => local-only (or server-keyed).
//    Signature: (r,g,b, x,y, t, ctx) -> [r,g,b, aMul].  ctx = { e, sa }.
//      e  = rim/edge strength 0..1 at this pixel (1 = silhouette edge)
//      sa = (x,y)=>[r,g,b,a] nearest sampler of the source frame
// Values are 0..1 floats. Pixel art is tiny so we just run this per pixel.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const fract = x => x - Math.floor(x);
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
export const hx = h => [
  Number.parseInt(h.slice(0, 2), 16) / 255,
  Number.parseInt(h.slice(2, 4), 16) / 255,
  Number.parseInt(h.slice(4, 6), 16) / 255,
];

export function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) {
      h = ((g - b) / d) % 6;
    } else if (mx === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h /= 6;
    if (h < 0) {
      h += 1;
    }
  }
  return [h, mx <= 0 ? 0 : d / mx, mx];
}
export function hsv2rgb(h, s, v) {
  const k = n => (n + h * 6) % 6;
  const f = n => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}
export function ramp(stops, t) {
  t = clamp(t);
  const n = stops.length - 1;
  const i = Math.min(n - 1, Math.floor(t * n));
  const f = t * n - i;
  return mix3(stops[i], stops[i + 1], f);
}

// ---- deterministic noise + voronoi ---------------------------------------
// Global texture seed + scale (the lab's seed + texture-scale sliders). The seed
// shifts the noise/voronoi domain so two mons (or two rolls) get DIFFERENT
// procedural placement; the scale resizes texture cells (stained glass, bioluminescence...).
export let FXSEED = 0,
  FXSCALE = 1;
export function setFxParams(seed = 0, scale = 1) {
  FXSEED = seed;
  FXSCALE = scale;
}
// Around-FX must never hard-clip at the sprite-box edge: fade any off-sprite FX
// out over the last `feather` px of the padded frame (the renderer multiplies the
// around alpha by this). The fade threshold is modulated by drifting fbm noise so
// the FX FRAYS into wisps at the edge instead of stopping in a clean straight band
// (tester feedback: a uniform fade still reads as an abrupt stop). In-game the
// same falloff keeps auras from slamming into the sprite's texture bounds.
export function edgeFalloff(px, py, PW, PH, t = 0, feather = 16) {
  const d = Math.min(px + 0.5, py + 0.5, PW - px - 0.5, PH - py - 0.5);
  if (d >= feather) {
    return 1;
  }
  if (d <= 0) {
    return 0;
  }
  const k = d / feather;
  // per-position fade depth: where the noise is low the FX reaches almost to the
  // border, where it is high the fade starts deeper inside - wispy, and it drifts
  const n = fbm((px / PW) * 8 + t * 0.09, (py / PH) * 8 - t * 0.06);
  // stretch the noise contrast (fbm clusters mid-range) so the wisps really cut
  const n2 = smooth(0.32, 0.68, n);
  const th = 0.15 + n2 * 0.85;
  const kk = clamp(k / th);
  // hard ramp on the outermost couple of px so the very border is always ~0
  return kk * kk * (3 - 2 * kk) * clamp(k * 8);
}
// Snap an FX color to the GBC-displayable gamut (RGB555 - 5 bits per channel).
export const gbcSnap = c => [
  Math.round(clamp(c[0]) * 31) / 31,
  Math.round(clamp(c[1]) * 31) / 31,
  Math.round(clamp(c[2]) * 31) / 31,
];
export const h2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
export function vnoise(x, y) {
  x = x * FXSCALE + FXSEED;
  y = y * FXSCALE + FXSEED * 1.7;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi);
  const b = h2(xi + 1, yi);
  const c = h2(xi, yi + 1);
  const d = h2(xi + 1, yi + 1);
  return mix(mix(a, b, u), mix(c, d, u), v);
}
export function fbm(x, y) {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    s += amp * vnoise(x * f, y * f);
    f *= 2;
    amp *= 0.5;
  }
  return s;
}
// returns nearest distance, border = (2nd - 1st) distance, cell = hash of nearest cell
export function voro(x, y, scale) {
  x = x * scale * FXSCALE + FXSEED;
  y = y * scale * FXSCALE + FXSEED * 1.3;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  let cell = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const px = cx + h2(cx, cy);
      const py = cy + h2(cy + 5.3, cx - 3.1);
      const dd = (px - x) * (px - x) + (py - y) * (py - y);
      if (dd < d1) {
        d2 = d1;
        d1 = dd;
        cell = h2(cx * 1.3 + 0.1, cy * 1.7 + 0.2);
      } else if (dd < d2) {
        d2 = dd;
      }
    }
  }
  return { d1: Math.sqrt(d1), border: Math.sqrt(d2) - Math.sqrt(d1), cell };
}

// rim/edge strength field for a frame (1 at silhouette edge -> 0 deep inside)
export function computeEdge(buf, W, H, R = 4) {
  const ef = new Float32Array(W * H);
  const A = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : buf[(y * W + x) * 4 + 3]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (buf[(y * W + x) * 4 + 3] <= 0.02) {
        continue;
      }
      let best = R + 1;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (A(x + dx, y + dy) <= 0.02) {
            const d = Math.hypot(dx, dy);
            if (d < best) {
              best = d;
            }
          }
        }
      }
      ef[y * W + x] = best > R ? 0 : clamp(1 - (best - 1) / R);
    }
  }
  return ef;
}

// distance-to-silhouette field over a padded canvas (for AROUND effects).
// returns { PW, PH, d (px distance, 0 inside sprite), cx, cy (normalized centroid) }
export function computeDist(buf, FW, FH, PAD) {
  const PW = FW + 2 * PAD;
  const PH = FH + 2 * PAD;
  const N = PW * PH;
  const INF = 1e6;
  const d = new Float32Array(N);
  let cx = 0;
  let cy = 0;
  let cnt = 0;
  let maxY = -1;
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const sx = px - PAD;
      const sy = py - PAD;
      const inside = sx >= 0 && sy >= 0 && sx < FW && sy < FH && buf[(sy * FW + sx) * 4 + 3] > 0.02;
      d[py * PW + px] = inside ? 0 : INF;
      if (inside) {
        cx += px;
        cy += py;
        cnt++;
        if (py > maxY) {
          maxY = py;
        }
      }
    }
  }
  const A = 1;
  const B = Math.SQRT2;
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      let v = d[y * PW + x];
      if (x > 0) {
        v = Math.min(v, d[y * PW + x - 1] + A);
      }
      if (y > 0) {
        v = Math.min(v, d[(y - 1) * PW + x] + A);
      }
      if (x > 0 && y > 0) {
        v = Math.min(v, d[(y - 1) * PW + x - 1] + B);
      }
      if (x < PW - 1 && y > 0) {
        v = Math.min(v, d[(y - 1) * PW + x + 1] + B);
      }
      d[y * PW + x] = v;
    }
  }
  for (let y = PH - 1; y >= 0; y--) {
    for (let x = PW - 1; x >= 0; x--) {
      let v = d[y * PW + x];
      if (x < PW - 1) {
        v = Math.min(v, d[y * PW + x + 1] + A);
      }
      if (y < PH - 1) {
        v = Math.min(v, d[(y + 1) * PW + x] + A);
      }
      if (x < PW - 1 && y < PH - 1) {
        v = Math.min(v, d[(y + 1) * PW + x + 1] + B);
      }
      if (x > 0 && y < PH - 1) {
        v = Math.min(v, d[(y + 1) * PW + x - 1] + B);
      }
      d[y * PW + x] = v;
    }
  }
  // fy = the FEET line (bottom of the silhouette, normalized) - ground-anchored
  // FX center on this instead of guessing from the centroid
  return {
    PW,
    PH,
    d,
    cx: cnt ? cx / cnt / PW : 0.5,
    cy: cnt ? cy / cnt / PH : 0.45,
    fy: maxY >= 0 ? (maxY + 1) / PH : 0.82,
  };
}

// ---- color clustering (k-means on the sprite's real palette) --------------
// Used by the "cluster" palettes: assign each pixel to one of K color clusters
// (region-faithful, NOT a single luma ramp), then recolor per cluster. Clusters
// are sorted by luma so the mapping is deterministic. In-game this is the same
// idea on the 11 base colors -> still the 32-slot swap, still crossplay-safe.
export function computeClusters(buf, FW, FH, K = 5) {
  const sample = [];
  for (let i = 0; i < FW * FH; i++) {
    if (buf[i * 4 + 3] > 0.5) {
      sample.push([buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]]);
    }
  }
  if (sample.length < K) {
    return { K: 1, cent: [[0.5, 0.5, 0.5]] };
  }
  sample.sort((a, b) => luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]));
  const cent = [];
  for (let j = 0; j < K; j++) {
    cent.push(sample[Math.floor(((j + 0.5) / K) * sample.length)].slice());
  }
  for (let it = 0; it < 10; it++) {
    const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
    for (const c of sample) {
      let bi = 0;
      let bd = 1e9;
      for (let j = 0; j < K; j++) {
        const d = (c[0] - cent[j][0]) ** 2 + (c[1] - cent[j][1]) ** 2 + (c[2] - cent[j][2]) ** 2;
        if (d < bd) {
          bd = d;
          bi = j;
        }
      }
      sum[bi][0] += c[0];
      sum[bi][1] += c[1];
      sum[bi][2] += c[2];
      sum[bi][3]++;
    }
    for (let j = 0; j < K; j++) {
      if (sum[j][3]) {
        cent[j] = [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]];
      }
    }
  }
  cent.sort((a, b) => luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]));
  return { K, cent };
}
export function clusterRank(cl, r, g, b) {
  // assignment happens in the cluster's own feature space when it has one
  // (hue-region / luma-band algos); default = RGB distance.
  const f = cl.feat ? cl.feat(r, g, b) : [r, g, b];
  const cents = cl.fcent ?? cl.cent;
  let bi = 0;
  let bd = 1e9;
  for (let j = 0; j < cents.length; j++) {
    const c = cents[j];
    let d = 0;
    for (let m = 0; m < f.length; m++) {
      d += (f[m] - c[m]) ** 2;
    }
    if (d < bd) {
      bd = d;
      bi = j;
    }
  }
  return bi;
}

// ---- clustering algo variants (the lab's "Clustering" selector) ------------
// Every algo returns { K, cent (RGB, luma-sorted), feat?, fcent? } so the
// cluster palettes render unchanged under any of them. feat/fcent = assignment
// space when it isn't plain RGB.
function _uniqueColors(buf, n) {
  const map = new Map();
  for (let i = 0; i < n; i++) {
    if (buf[i * 4 + 3] <= 0.5) {
      continue;
    }
    const r = Math.round(buf[i * 4] * 255);
    const g = Math.round(buf[i * 4 + 1] * 255);
    const b = Math.round(buf[i * 4 + 2] * 255);
    const k = (r << 16) | (g << 8) | b;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([k, c]) => ({
    rgb: [((k >> 16) & 255) / 255, ((k >> 8) & 255) / 255, (k & 255) / 255],
    n: c,
  }));
}
function _wkmeans(pts, wts, K, iters = 14) {
  const dim = pts[0].length;
  const order = pts.map((_, i) => i).sort((a, b) => wts[b] - wts[a]);
  const cent = [];
  for (let j = 0; j < K; j++) {
    cent.push(pts[order[Math.floor(((j + 0.5) / K) * order.length)]].slice());
  }
  const asg = new Array(pts.length).fill(0);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pts.length; i++) {
      let bi = 0;
      let bd = 1e9;
      for (let j = 0; j < K; j++) {
        let d = 0;
        for (let m = 0; m < dim; m++) {
          d += (pts[i][m] - cent[j][m]) ** 2;
        }
        if (d < bd) {
          bd = d;
          bi = j;
        }
      }
      asg[i] = bi;
    }
    for (let j = 0; j < K; j++) {
      const sum = new Array(dim + 1).fill(0);
      for (let i = 0; i < pts.length; i++) {
        if (asg[i] !== j) {
          continue;
        }
        for (let m = 0; m < dim; m++) {
          sum[m] += pts[i][m] * wts[i];
        }
        sum[dim] += wts[i];
      }
      if (sum[dim] > 0) {
        cent[j] = sum.slice(0, dim).map(v => v / sum[dim]);
      }
    }
  }
  return { cent, asg };
}
// Balanced: sqrt-weighted k-means over the sprite's DISTINCT colors (pixel art
// has few) - a big body region can't swallow a small-but-distinct one (eyes, gems).
export function computeClustersBalanced(buf, FW, FH, K = 5) {
  const uni = _uniqueColors(buf, FW * FH);
  if (uni.length === 0) {
    return { K: 1, cent: [[0.5, 0.5, 0.5]] };
  }
  const k = Math.min(K, uni.length);
  const { cent } = _wkmeans(
    uni.map(u => u.rgb),
    uni.map(u => Math.sqrt(u.n)),
    k,
  );
  cent.sort((a, b) => luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]));
  return { K: k, cent };
}
// Hue Regions: k-means in a hue/chroma-weighted cone - regions split by COLOR,
// a region's shading ramp stays together (closest to the hand-made romhack
// cluster feel; IEC-style).
export function computeClustersHue(buf, FW, FH, K = 5) {
  const feat = (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    const c = s * (0.25 + 0.75 * v);
    return [Math.cos(h * Math.PI * 2) * c * 1.7, Math.sin(h * Math.PI * 2) * c * 1.7, v * 0.55];
  };
  const uni = _uniqueColors(buf, FW * FH);
  if (uni.length === 0) {
    return { K: 1, cent: [[0.5, 0.5, 0.5]] };
  }
  const k = Math.min(K, uni.length);
  const { cent: fcent, asg } = _wkmeans(
    uni.map(u => feat(u.rgb[0], u.rgb[1], u.rgb[2])),
    uni.map(u => u.n),
    k,
  );
  // RGB centroid per cluster (weighted), for display + luma ordering
  const cent = [];
  for (let j = 0; j < k; j++) {
    const sum = [0, 0, 0, 0];
    uni.forEach((u, i) => {
      if (asg[i] === j) {
        sum[0] += u.rgb[0] * u.n;
        sum[1] += u.rgb[1] * u.n;
        sum[2] += u.rgb[2] * u.n;
        sum[3] += u.n;
      }
    });
    cent.push(sum[3] ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] : [0.5, 0.5, 0.5]);
  }
  const idx = cent.map((_, i) => i).sort((a, b) => luma(...cent[a]) - luma(...cent[b]));
  return { K: k, cent: idx.map(i => cent[i]), feat, fcent: idx.map(i => fcent[i]) };
}
// Luma Bands: quantile bands over brightness (the old-school ramp segmentation) -
// guaranteed monotone dark->light regions, hue is ignored.
export function computeClustersLuma(buf, FW, FH, K = 5) {
  const ls = [];
  for (let i = 0; i < FW * FH; i++) {
    if (buf[i * 4 + 3] > 0.5) {
      ls.push([luma(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]), buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]]);
    }
  }
  if (ls.length === 0) {
    return { K: 1, cent: [[0.5, 0.5, 0.5]] };
  }
  ls.sort((a, b) => a[0] - b[0]);
  const k = Math.min(K, ls.length);
  const cent = [];
  const fcent = [];
  for (let j = 0; j < k; j++) {
    const lo = Math.floor((j / k) * ls.length);
    const hi = Math.max(lo + 1, Math.floor(((j + 1) / k) * ls.length));
    const sum = [0, 0, 0, 0];
    for (let i = lo; i < hi; i++) {
      sum[0] += ls[i][1];
      sum[1] += ls[i][2];
      sum[2] += ls[i][3];
      sum[3] += ls[i][0];
    }
    const n = hi - lo;
    cent.push([sum[0] / n, sum[1] / n, sum[2] / n]);
    fcent.push([sum[3] / n]);
  }
  return { K: k, cent, feat: (r, g, b) => [luma(r, g, b)], fcent };
}
// IEC-style (from the decompiled Inclement Emerald Customizer): NEUTRALS
// (outline blacks / whites / near-grays, sat < 0.05) are segregated into their
// own cluster and never mixed with hues; the chromatic colors are then grouped
// by single-linkage circular HUE distance (threshold 0.05, wraparound), merged
// down to the cap by nearest mean hue. Variable K by nature.
export function computeClustersIec(buf, FW, FH, K = 5) {
  const feat = (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    const c = s * (0.3 + 0.7 * v);
    return [Math.cos(h * Math.PI * 2) * c * 2, Math.sin(h * Math.PI * 2) * c * 2, v * 0.25];
  };
  const uni = _uniqueColors(buf, FW * FH);
  if (uni.length === 0) {
    return { K: 1, cent: [[0.5, 0.5, 0.5]] };
  }
  const neut = [];
  const chrom = [];
  for (const u of uni) {
    const [h, s] = rgb2hsv(u.rgb[0], u.rgb[1], u.rgb[2]);
    (s < 0.05 ? neut : chrom).push({ ...u, h });
  }
  // single-linkage hue flood at threshold 0.05 (circular)
  const hd = (a, b) => {
    const d = Math.abs(a - b);
    return Math.min(d, 1 - d);
  };
  const groups = [];
  for (const u of chrom.sort((a, b) => a.h - b.h)) {
    const g = groups.find(gr => gr.some(m => hd(m.h, u.h) < 0.05));
    if (g) {
      g.push(u);
    } else {
      groups.push([u]);
    }
  }
  // merge trailing wraparound + shrink to cap by nearest mean hue
  const meanH = g => {
    let x = 0;
    let y = 0;
    for (const m of g) {
      x += Math.cos(m.h * Math.PI * 2) * m.n;
      y += Math.sin(m.h * Math.PI * 2) * m.n;
    }
    return fract(Math.atan2(y, x) / (Math.PI * 2) + 1);
  };
  const cap = Math.max(1, K - (neut.length ? 1 : 0));
  while (groups.length > cap) {
    let bi = 0;
    let bj = 1;
    let bd = 9;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const d = hd(meanH(groups[i]), meanH(groups[j]));
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    }
    groups[bi] = groups[bi].concat(groups[bj]);
    groups.splice(bj, 1);
  }
  if (neut.length) {
    groups.push(neut);
  }
  const cent = groups.map(g => {
    const sum = [0, 0, 0, 0];
    for (const m of g) {
      sum[0] += m.rgb[0] * m.n;
      sum[1] += m.rgb[1] * m.n;
      sum[2] += m.rgb[2] * m.n;
      sum[3] += m.n;
    }
    return [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
  });
  const idx = cent.map((_, i) => i).sort((a, b) => luma(...cent[a]) - luma(...cent[b]));
  return {
    K: groups.length,
    cent: idx.map(i => cent[i]),
    feat,
    fcent: idx.map(i => {
      const g = groups[i];
      const sum = [0, 0, 0, 0];
      for (const m of g) {
        const f = feat(m.rgb[0], m.rgb[1], m.rgb[2]);
        sum[0] += f[0] * m.n;
        sum[1] += f[1] * m.n;
        sum[2] += f[2] * m.n;
        sum[3] += m.n;
      }
      return [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
    }),
  };
}
export const CLUSTERING = {
  kmeans: { label: "K-means RGB (default)", fn: computeClusters },
  balanced: { label: "Balanced distinct-colors", fn: computeClustersBalanced },
  hue: { label: "Hue regions", fn: computeClustersHue },
  iec: { label: "IEC-style (hue linkage + neutral split)", fn: computeClustersIec },
  luma: { label: "Luma bands", fn: computeClustersLuma },
};
export function clusterTone(stops, i, k, pl, discrete = true) {
  const f = k > 1 ? i / (k - 1) : 0;
  const base = discrete ? stops[Math.round(f * (stops.length - 1))] : ramp(stops, f);
  const hsv = rgb2hsv(base[0], base[1], base[2]);
  return hsv2rgb(hsv[0], hsv[1], clamp(hsv[2] * (0.55 + 0.7 * pl)));
}

// ---- blend modes (Photoshop-style) ----------------------------------------
// We SET a tasteful mode per surface effect (not a user knob): screen/add make
// glow effects luminous, overlay/softlight add sheen/contrast, default = normal.
const _bl = (b, t, mode) => {
  switch (mode) {
    case "screen":
      return 1 - (1 - b) * (1 - t);
    case "multiply":
      return b * t;
    case "add":
      return Math.min(1, b + t);
    case "overlay":
      return b < 0.5 ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t);
    case "hardlight":
      return t < 0.5 ? 2 * b * t : 1 - 2 * (1 - b) * (1 - t);
    case "softlight":
      return t < 0.5
        ? b - (1 - 2 * t) * b * (1 - b)
        : b + (2 * t - 1) * ((b < 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b);
    case "dodge":
      return t >= 1 ? 1 : Math.min(1, b / (1 - t));
    case "difference":
      return Math.abs(b - t);
    default:
      return t;
  }
};
export function blendCol(base, top, mode, amt = 1) {
  if (!mode || mode === "normal") {
    return amt >= 1 ? top : mix3(base, top, amt);
  }
  const out = [_bl(base[0], top[0], mode), _bl(base[1], top[1], mode), _bl(base[2], top[2], mode)];
  return amt >= 1 ? out : mix3(base, out, amt);
}
export const SURFACE_BLEND = {
  holofoil: "screen",
  galaxy: "screen",
  plasma: "screen",
  aurora: "screen",
  aurorawings: "screen",
  mercury: "screen",
  prismatic: "screen",
  frostbite: "screen",
  starmap: "add",
  spectrumsplit: "screen",
  caustics: "screen",
  rainbow: "screen",
  electric: "add",
  lightningveins: "add",
  sparkle: "add",
  tron: "add",
  scansweep: "add",
  fractalflow: "screen",
  oilfilm: "overlay",
  scales: "overlay",
  dripgold: "overlay",
  gildededges: "overlay",
  neonwire: "overlay",
  circuit: "overlay",
  wormhole: "overlay",
  vaporwave: "softlight",
  synthscan: "softlight",
  rimlight: "softlight",
  kaleido: "softlight",
  stainedglass: "softlight",
  crystalfacets: "softlight",
  marble: "softlight",
  halftone: "hardlight",
  rainbowedge: "screen",
  softshade: "softlight",
  discoball: "screen",
  lensflare: "screen",
  starfall: "add",
  soapswirl: "screen",
  moire: "softlight",
  staticcharge: "add",
  spiritflame: "screen",
  lavalamp: "normal",
  shockwave: "normal",
};

// "Tint FX to palette": recolor a single-hue effect to the palette's hue while
// keeping its own brightness/shape, so Soft Halo / Orbiting Sparks / glows match
// the palette instead of needing duplicate effects. The multi-hue effects below
// keep their identity (tinting a rainbow makes no sense).
export function tintTo(rgb, th, ts, amt = 1) {
  const hsv = rgb2hsv(rgb[0], rgb[1], rgb[2]);
  const tinted = hsv2rgb(th, mix(hsv[1], ts, 0.7), hsv[2]);
  return amt >= 1 ? tinted : mix3(rgb, tinted, amt);
}
export const NO_TINT = new Set([
  "aurora",
  "rainbow",
  "holofoil",
  "galaxy",
  "plasma",
  "prismatic",
  "spectrumsplit",
  "oilfilm",
  "vaporwave",
  "synthscan",
  "sunsetsun",
  "rainbowedge",
  "stainedglass",
  "auroraveil",
  "cosmos",
  "galaxyspiral",
  "prismburst",
  "rainbowoutline",
  "rainbowglitter",
  "neonsign",
  "echoes",
  "triecho",
  "soapswirl",
  "discoball",
  "tiedye",
  "cmykprint",
  "tvbars",
  "gemplate",
  "checkerflip",
  "coderain",
  "rainbowarc",
  "confetti",
  "lasershow",
  "fireworks",
  "butterflies",
  "cardstorm",
  "ribbonloop",
  "planets",
  "equalizer",
  "fairydust",
  "glitterstorm",
  "prismrain",
  "chronoshift",
  "starrynight",
  "anaglyph",
  "koipond",
]);

const G = {
  gold: ["0c0700", "5a3410", "c98a2a", "ffd070", "fff6d8"].map(hx),
  obsidian: ["07070d", "141422", "262642", "4a4a78"].map(hx),
  chrome: ["0a0c12", "353d4d", "8b95a8", "eef2fb"].map(hx),
  inferno: ["000000", "350000", "a01200", "ff5a00", "ffd000", "fff6c0"].map(hx),
  toxic: ["03120a", "0c4f1c", "4fce24", "c8ff48", "f6ffd0"].map(hx),
  rose: ["341626", "8f4f6c", "f0a0c0", "ffe2ef"].map(hx),
  verdigris: ["0e1f19", "275446", "57a586", "bce8d2"].map(hx),
  shadowflame: ["08000f", "2e0038", "9a0f86", "ff3fc4", "ffc0f0"].map(hx),
  plasma: ["1a0040", "d0007a", "ff8a00", "fff0a0", "00e0ff"].map(hx),
  thermal: ["000018", "3a0a6a", "c01a6a", "ff6a00", "ffd000", "ffffff"].map(hx),
  copper: ["170a05", "5e2a16", "b5642e", "f0a85a", "ffe6b0"].map(hx),
};

// ===========================================================================
// PALETTE class - pure functions of color (crossplay-safe via 32-slot swap)
// ===========================================================================
export const PALETTE = {
  glacier: (r, g, b) => {
    let [h, s, v] = rgb2hsv(r, g, b);
    h = mix(h, 0.55, 0.6);
    s *= 0.7;
    v = Math.pow(v, 0.72);
    return mix3(hsv2rgb(h, s, v), [0.92, 0.98, 1.0], smooth(0.6, 1.0, v) * 0.5);
  },
  aurum: (r, g, b) => ramp(G.gold, Math.pow(luma(r, g, b), 0.9)),
  obsidian: (r, g, b) => ramp(G.obsidian, luma(r, g, b)),
  chrome: (r, g, b) => ramp(G.chrome, smooth(0.05, 0.95, luma(r, g, b))),
  amethyst: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(mix(h, 0.78, 0.85), clamp(s * 1.25 + 0.15), Math.pow(v, 0.85));
  },
  inferno: (r, g, b) => ramp(G.inferno, Math.pow(luma(r, g, b), 0.85)),
  toxic: (r, g, b) => ramp(G.toxic, luma(r, g, b)),
  rosequartz: (r, g, b) => ramp(G.rose, smooth(0.0, 1.0, Math.pow(luma(r, g, b), 0.8))),
  verdigris: (r, g, b) => ramp(G.verdigris, luma(r, g, b)),
  spectral: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(0.52, s * 0.35, Math.pow(v, 0.6) + 0.15);
  },
  negative: (r, g, b) => [1 - r, 1 - g, 1 - b],
  void: (r, g, b) => mix3(hx("160a2e"), hx("ff6ad5"), Math.pow(luma(r, g, b), 0.9)),
  shadowflame: (r, g, b) => ramp(G.shadowflame, Math.pow(luma(r, g, b), 0.85)),
  // --- v2 ---
  iridescent: (r, g, b) => {
    const L = luma(r, g, b);
    const c = hsv2rgb(fract(L * 2.2 + 0.05), 0.55, clamp(0.35 + L * 0.85));
    return mix3(c, [1, 1, 1], smooth(0.85, 1, L) * 0.5);
  },
  thermal: (r, g, b) => ramp(G.thermal, Math.pow(luma(r, g, b), 0.85)),
  sepia: (r, g, b) => {
    const L = luma(r, g, b);
    return [clamp(L * 1.08 + 0.05), clamp(L * 0.82 + 0.03), clamp(L * 0.58)];
  },
  copper: (r, g, b) => ramp(G.copper, Math.pow(luma(r, g, b), 0.9)),
  emerald: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(mix(h, 0.38, 0.85), clamp(s * 1.2 + 0.25), Math.pow(v, 0.82));
  },
  sapphire: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(mix(h, 0.62, 0.85), clamp(s * 1.25 + 0.25), Math.pow(v, 0.85));
  },
  comic: (r, g, b) => {
    const L = Math.round(smooth(0.05, 0.95, luma(r, g, b)) * 3) / 3;
    const [h, s] = rgb2hsv(r, g, b);
    return hsv2rgb(h, clamp(s * 1.1), 0.18 + L * 0.82);
  },
  synthwave: (r, g, b) => {
    const L = luma(r, g, b);
    return mix3(hx("2a0a4a"), mix3(hx("ff2a8a"), hx("20e0ff"), smooth(0.4, 0.95, L)), smooth(0.04, 0.6, L));
  },
  // --- v3 ---
  onyxgold: (r, g, b) =>
    ramp(["08080e", "14141f", "23233a", "c98a2a", "ffe08a"].map(hx), Math.pow(luma(r, g, b), 1.15)),
  ultraviolet: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(0.78, clamp(0.5 + s * 0.5), Math.pow(v, 1.4));
  },
  acid: (r, g, b) => ramp(["0a1400", "294d00", "7ad400", "d4ff3a", "f6ffd0"].map(hx), Math.pow(luma(r, g, b), 0.85)),
  bubblegum: (r, g, b) => mix3(hx("ff8ad0"), hx("7af0ff"), smooth(0.1, 0.9, luma(r, g, b))),
  blood: (r, g, b) => ramp(["0a0204", "4a0810", "a01525", "e8404a", "ffd0c0"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  abyss: (r, g, b) => ramp(["02030a", "07142e", "0e3a5e", "1f9ad0", "a0f0ff"].map(hx), Math.pow(luma(r, g, b), 1.1)),
  antique: (r, g, b) => {
    const L = luma(r, g, b);
    return [clamp(L + 0.12), clamp(L * 0.92 + 0.08), clamp(L * 0.7 + 0.03)];
  },
  frostfire: (r, g, b) => mix3(hx("1a3a6a"), hx("ff8a2a"), smooth(0.35, 0.75, luma(r, g, b))),
  camo: (r, g, b) => ramp(["232a18", "3f4a26", "6a7a3a", "aeb86a"].map(hx), Math.round(luma(r, g, b) * 3) / 3),
  jade: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(mix(h, 0.42, 0.85), clamp(s * 0.9 + 0.15), Math.pow(v, 0.9));
  },
  rosegold: (r, g, b) =>
    ramp(["2a1418", "7a4248", "d98a7a", "f5c0a0", "ffe8d8"].map(hx), Math.pow(luma(r, g, b), 0.92)),
  mono: (r, g, b) => {
    const L = smooth(0.05, 0.95, luma(r, g, b));
    return [L, L, L];
  },
  // --- v4 exotic ---
  prismarine: (r, g, b) =>
    ramp(["041a1e", "0a4a4a", "1f9a8a", "5fe0c0", "d0fff0"].map(hx), Math.pow(luma(r, g, b), 0.95)),
  nebula: (r, g, b) => ramp(["08021a", "2a0a5a", "7a1a9a", "d04ad0", "7af0ff"].map(hx), luma(r, g, b)),
  venom: (r, g, b) => ramp(["07040a", "1a0a1a", "2a4a14", "6ad020", "d8ff60"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  solarflare: (r, g, b) =>
    ramp(["1a0600", "7a2a00", "e08000", "ffd040", "fffae0"].map(hx), Math.pow(luma(r, g, b), 0.8)),
  royal: (r, g, b) => ramp(["0e0420", "3a1060", "7a2a9a", "d0a030", "ffe890"].map(hx), luma(r, g, b)),
  deepsea: (r, g, b) => ramp(["01060f", "03204a", "0a5a8a", "1fb0d0", "a0f0e0"].map(hx), Math.pow(luma(r, g, b), 1.05)),
  sakura: (r, g, b) => ramp(["2a1420", "7a4a60", "e0a0c0", "ffd0e0", "fff0f6"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  mythril: (r, g, b) => ramp(["0a0e16", "2a3a52", "6a8ab0", "c0d8f0", "f0f8ff"].map(hx), luma(r, g, b)),
  cursed: (r, g, b) => ramp(["060a06", "17121a", "2a3a14", "4a6a1a", "9aff3a"].map(hx), Math.pow(luma(r, g, b), 0.95)),
  pearl: (r, g, b) => {
    const L = luma(r, g, b);
    return mix3(hsv2rgb(fract(L * 1.5 + 0.1), 0.18, clamp(0.6 + L * 0.4)), [1, 1, 1], 0.4);
  },
  rust: (r, g, b) => ramp(["140804", "3a1a0a", "7a3a1a", "b56a2a", "e0a85a"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  moonstone: (r, g, b) => {
    const L = luma(r, g, b);
    return mix3(hsv2rgb(fract(L + 0.55), 0.2, clamp(0.65 + L * 0.35)), [0.95, 0.97, 1], 0.45);
  },
  oilspill: (r, g, b) => {
    const L = luma(r, g, b);
    return hsv2rgb(fract(L * 3), 0.7, clamp(0.15 + L * 0.55));
  },
  plasmatic: (r, g, b) => ramp(["1a0040", "d0007a", "ff8a00", "fff0a0", "00e0ff"].map(hx), luma(r, g, b)),
  // --- cluster palettes: recolor each color region separately (real 2-/multi-tone) ---
  duoink: (r, g, b, c) =>
    c ? clusterTone(["0e1a33", "e8c050"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  duoneon: (r, g, b, c) =>
    c ? clusterTone(["ff2a9a", "22e0ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  duomono: (r, g, b, c) =>
    c ? clusterTone(["0a0a12", "f4f6ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  duoblood: (r, g, b, c) =>
    c ? clusterTone(["0a0306", "e02438"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  duomint: (r, g, b, c) =>
    c ? clusterTone(["08231e", "7af0c0"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  duosunset: (r, g, b, c) =>
    c ? clusterTone(["241a4a", "ff8a3a"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  duomecha: (r, g, b, c) =>
    c ? clusterTone(["1c2230", "ff7a1a"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  trisunset: (r, g, b, c) =>
    c ? clusterTone(["1a0a3a", "d0407a", "ffd060"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  triforest: (r, g, b, c) =>
    c ? clusterTone(["10240f", "3f7a2a", "d8e070"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  quadvapor: (r, g, b, c) =>
    c
      ? clusterTone(["141a3a", "b03ad0", "22c0ff", "f0f8ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b))
      : [r, g, b],
  pentacandy: (r, g, b, c) =>
    c
      ? clusterTone(["ff9ec4", "ffd59e", "b6f0a0", "9ed8ff", "d9b6ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b))
      : [r, g, b],
  pentajewel: (r, g, b, c) =>
    c
      ? clusterTone(["8a1030", "103a8a", "0a6a3a", "5a1a8a", "c9a020"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b))
      : [r, g, b],
  // --- v5 ---
  synthwavesun: (r, g, b) =>
    ramp(["2a0a4a", "7a1a8a", "ff3a7a", "ff8a2a", "ffe060"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  sunset: (r, g, b) =>
    ramp(["3a1060", "8a2a7a", "e0407a", "ff6a3a", "ffaa2a", "ffe85a"].map(hx), Math.pow(luma(r, g, b), 0.82)),
  gameboy: (r, g, b, c) =>
    c ? clusterTone(["0f380f", "306230", "8bac0f", "9bbc0f"].map(hx), c.clRank(r, g, b), c.K, 0.5) : [r, g, b],
  retro: (r, g, b, c) => {
    if (!c) {
      return [r, g, b];
    }
    const cen = c.clColor(c.clRank(r, g, b));
    const hsv = rgb2hsv(cen[0], cen[1], cen[2]);
    return hsv2rgb(hsv[0], clamp(hsv[1] * 1.25), Math.round(hsv[2] * 4) / 4);
  },
  // --- v6 (Discord brainstorm) ---
  // Blueprint: dark linework -> white/pale cyan, everything else -> flat low-contrast
  // blues (posterized so it reads as a technical drawing, not a gradient).
  blueprint: (r, g, b) => {
    const L = luma(r, g, b);
    if (L < 0.2) {
      return mix3(hx("cfe4ff"), hx("ffffff"), smooth(0.2, 0.0, L));
    }
    const t = Math.round(smooth(0.18, 1.0, L) * 2) / 2; // 3 flat steps, gentle spread
    return ramp(["1b4c9c", "2560b4", "3274c8"].map(hx), t);
  },
  // Who's That...?: the quiz silhouette. Pure black, with the very lightest source
  // tones lifted a hair toward navy so the shape still reads on dark backdrops.
  whosthat: (r, g, b) => mix3(hx("000000"), hx("121631"), smooth(0.55, 1.0, luma(r, g, b))),
  // Lavender Ghost (GB Haunter): whites stay, blacks become pale lavender, the
  // mid-tones collapse to a dark purple body. The old version used hard if-cuts
  // (0.16 / 0.8), which banded ugly seams on smooth-shaded mons and turned
  // mostly-mid-luma sprites into an unreadable black blob - now the three zones
  // crossfade smoothly and the body keeps a readable purple ramp.
  lavender: (r, g, b) => {
    const L = luma(r, g, b);
    const shadow = mix3(hx("b9a6dc"), hx("d4c4ee"), clamp(L / 0.16));
    const body = ramp(["120a20", "251638", "382250"].map(hx), smooth(0.16, 0.8, L));
    const c = mix3(shadow, body, smooth(0.1, 0.24, L));
    return mix3(c, [r, g, b], smooth(0.7, 0.86, L));
  },
  // Overexposed: darken the lightest colours, push everything else close to white -
  // the sprite's highlights become its linework.
  overexposed: (r, g, b) => {
    const [h, s] = rgb2hsv(r, g, b);
    const L = luma(r, g, b);
    if (L > 0.68) {
      return hsv2rgb(h, clamp(s * 1.1 + 0.15), 0.32 - (L - 0.68) * 0.35);
    }
    return hsv2rgb(h, s * 0.22, clamp(0.86 + L * 0.14));
  },
  // Hyperpigment: way oversaturated, with value clamps so nothing collapses flat.
  hyperpigment: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(h, Math.pow(s, 0.42), clamp(v, 0.14, 0.95));
  },
  // Pop Art: hue quantized to bold ink buckets, saturation cranked, 3 flat values.
  popart: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    const hq = fract(Math.round(h * 6) / 6 + 0.02);
    const vq = 0.3 + (Math.round(smooth(0.05, 0.95, v) * 2) / 2) * 0.68;
    return hsv2rgb(hq, clamp(s * 1.7 + 0.15), vq);
  },
  // ============== v7 palettes: materials & worlds ==============
  platinum: (r, g, b) => ramp(["15161c", "3d4250", "9aa3b5", "e8ecf5", "ffffff"].map(hx), Math.pow(luma(r, g, b), 0.95)),
  brass: (r, g, b) => ramp(["191006", "4a3512", "9a7a24", "d4b45a", "f6e8b0"].map(hx), luma(r, g, b)),
  // Patina Bronze: bronze metal in the shadows, oxidized teal patina blooming
  // across the highlights - two materials, not one ramp.
  agedbronze: (r, g, b) => {
    const L = luma(r, g, b);
    const bronze = ramp(["140c04", "4a3010", "8a5a1e", "c89a4a"].map(hx), clamp(L * 1.5));
    const patina = ramp(["1e6a5a", "3aa88a", "8ae0c0"].map(hx), clamp((L - 0.5) * 2.2));
    return mix3(bronze, patina, smooth(0.5, 0.78, L));
  },
  ivory: (r, g, b) => ramp(["4a3a28", "8a7458", "cdbba0", "f2e9d8", "fffdf4"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  // Ember Ash: charcoal body whose DEEPEST shadows glow like live coals.
  emberash: (r, g, b) => {
    const L = luma(r, g, b);
    const gray = ramp(["1a1a1e", "3a3a40", "6a6a72", "a8a8b0"].map(hx), L);
    return mix3(gray, [1.0, 0.35, 0.06], smooth(0.22, 0.0, L) * 0.95);
  },
  lapis: (r, g, b) => ramp(["0a1030", "142a68", "2050b0", "4a80d8", "f0cd6a"].map(hx), Math.pow(luma(r, g, b), 1.05)),
  vermilion: (r, g, b) => ramp(["1a0505", "6a1208", "c8321a", "f06038", "ffd8b8"].map(hx), luma(r, g, b)),
  // Twilight Neon: dusky indigo body - but the brightest touches snap to hot pink.
  periwinkle: (r, g, b) => {
    const L = luma(r, g, b);
    if (L > 0.78) {
      return mix3(hx("ff3a9a"), hx("ffb8e0"), (L - 0.78) / 0.22);
    }
    return ramp(["12102a", "28245a", "44408a", "6a68b0"].map(hx), L / 0.78);
  },
  // Velvet Noir: crushed blacks, deep merlot mids, champagne highlights - a film grade.
  wine: (r, g, b) => {
    const Lc = smooth(0.16, 0.92, luma(r, g, b));
    return ramp(["050203", "2a060e", "6a1024", "a83a4a", "e8cba0"].map(hx), Lc);
  },
  honeyamber: (r, g, b) => ramp(["241203", "5c3608", "a86a10", "e8a828", "ffe090"].map(hx), Math.pow(luma(r, g, b), 0.85)),
  stormcloud: (r, g, b) => ramp(["10141c", "2c3648", "55647e", "9ab0c8", "b8f0ff"].map(hx), luma(r, g, b)),
  peacock: (r, g, b) => ramp(["0c1a20", "104a52", "178a78", "46c8a8", "f0d060"].map(hx), luma(r, g, b)),
  flamingo: (r, g, b) => ramp(["3a1420", "8a3048", "e06a78", "ffa8a0", "ffe8d8"].map(hx), luma(r, g, b)),
  cyberpunk: (r, g, b) => ramp(["0a0618", "251048", "6a1a7a", "e0247a", "ffd23a"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  matrixgreen: (r, g, b) => ramp(["020a02", "0a3a0a", "10801a", "30d040", "c8ffb0"].map(hx), luma(r, g, b)),
  opal: (r, g, b) => {
    const L = luma(r, g, b);
    return mix3(hsv2rgb(fract(L * 2.6 + 0.6), 0.32, clamp(0.72 + L * 0.28)), [1, 1, 1], 0.3);
  },
  dragonfruit: (r, g, b) => ramp(["1a1408", "3a7a3a", "e83a8a", "ff88b8", "fff0f4"].map(hx), luma(r, g, b)),
  // Tidepool: three-zone split - deep teal shadows, wet-sand mids, aqua-foam lights.
  lagoon: (r, g, b) => {
    const L = luma(r, g, b);
    const deep = mix3(hx("04303a"), hx("0e6a6a"), clamp(L * 2.4));
    const sand = mix3(hx("9a8458"), hx("cbb684"), clamp((L - 0.35) * 3));
    const foam = mix3(hx("5ee0d0"), hx("f0fff6"), clamp((L - 0.7) * 3.2));
    return mix3(mix3(deep, sand, smooth(0.3, 0.45, L)), foam, smooth(0.62, 0.8, L));
  },
  // Heat Mirage: the hue itself shimmers - it oscillates between sand and sky
  // as brightness rises, like air over hot dunes.
  mirage: (r, g, b) => {
    const L = luma(r, g, b);
    const hue = fract(0.1 + 0.09 * Math.sin(L * 11) + L * 0.35);
    return hsv2rgb(hue, 0.42 + 0.18 * Math.sin(L * 17), clamp(0.3 + L * 0.72));
  },
  // Eclipse: near-black body, only the very brightest tones ignite as corona.
  eclipse: (r, g, b) => ramp(["050408", "0e0c14", "1a1722", "2a2433", "ff8a1a"].map(hx), Math.pow(luma(r, g, b), 1.1)),
  midnightoil: (r, g, b) => ramp(["05070c", "0e1c2a", "14424a", "7a2a6a", "e070a8"].map(hx), luma(r, g, b)),
  terracotta: (r, g, b) => ramp(["3a1a10", "7a3a22", "c06a3a", "e8a070", "ffe0c0"].map(hx), luma(r, g, b)),
  porcelaindelft: (r, g, b) => ramp(["24406a", "5a7ab8", "c8d8ea", "f4f8fc", "ffffff"].map(hx), Math.pow(luma(r, g, b), 0.7)),
  seafoam: (r, g, b) => ramp(["14342c", "2a6a58", "5ab890", "aae8cc", "f0fff6"].map(hx), luma(r, g, b)),
  glowworm: (r, g, b) => ramp(["0a0e0a", "1c2a1e", "2a4a3a", "4ad0a0", "d8ffe8"].map(hx), Math.pow(luma(r, g, b), 1.1)),
  voidfire: (r, g, b) => ramp(["05010a", "2a0a5a", "6a1ad0", "3a8af0", "c8f0ff"].map(hx), Math.pow(luma(r, g, b), 0.9)),
  petrol: (r, g, b) => ramp(["0a1210", "144038", "1a6a58", "2a6a9a", "8a7ae0"].map(hx), luma(r, g, b)),
  // Sandstone: hard-banded strata - warm and cool bands alternate by brightness.
  duststorm: (r, g, b) => {
    const L = luma(r, g, b);
    const bi = Math.min(4, Math.floor(clamp(L) * 5));
    const warm = ["3a2412", "72522c", "9a7040", "c89a58", "e8cf9a"].map(hx);
    const cool = ["2e2a24", "5e564a", "8a8072", "b4ac9a", "ded8cc"].map(hx);
    return bi % 2 === 0 ? warm[bi] : cool[bi];
  },
  watermelon: (r, g, b) => ramp(["143a1e", "2a7a3a", "8ae06a", "ffb8c8", "ff5a7a"].map(hx), luma(r, g, b)),
  cyanotype: (r, g, b) => ramp(["0a1e4a", "10306a", "2a5a9a", "7aa8d8", "f4f8ff"].map(hx), Math.pow(luma(r, g, b), 0.65)),
  coralreef: (r, g, b) => ramp(["0e2a2e", "14666a", "e86a4a", "ffa88a", "fff0e0"].map(hx), luma(r, g, b)),
  // Ultra Grape: royal purple depths - and the highlights clash into acid green.
  grape: (r, g, b) => {
    const L = luma(r, g, b);
    if (L > 0.76) {
      return mix3(hx("9ae02a"), hx("e8ffb0"), (L - 0.76) / 0.24);
    }
    return ramp(["140a1e", "3a1a4a", "6a2a8a", "a45ac8"].map(hx), L / 0.76);
  },
  mintchoco: (r, g, b) => ramp(["120c08", "38281c", "6a4c30", "a8e0c8", "e8fff0"].map(hx), luma(r, g, b)),
  sherbet: (r, g, b) => ramp(["ffb0a0", "ffd8a0", "fff4b8", "c8f0c0", "b0d8ff"].map(hx), luma(r, g, b)),
  gunmetal: (r, g, b) => ramp(["0c0e12", "23272e", "41474f", "6a7078", "9aa2ac"].map(hx), luma(r, g, b)),
  arcticnight: (r, g, b) => ramp(["061024", "0e2a4a", "1a4a7a", "2a8a8a", "6af0c0"].map(hx), luma(r, g, b)),
  // Frozen Abyss: near-black glacial depths; highlights crack into hard cyan ice.
  blackice: (r, g, b) => {
    const L = luma(r, g, b);
    if (L > 0.72) {
      return mix3(hx("5ae0ff"), hx("f0feff"), (L - 0.72) / 0.28);
    }
    return ramp(["01040a", "07101c", "10202e", "1c3242"].map(hx), L / 0.72);
  },
  // Sunlit Grove: cool leaf-green shade split-toned into warm golden sunlight.
  meadow: (r, g, b) => {
    const L = luma(r, g, b);
    return mix3(hsv2rgb(0.36, 0.72, clamp(L * 0.85 + 0.07)), hsv2rgb(0.14, 0.72, clamp(L * 1.12)), smooth(0.4, 0.8, L));
  },
  // ============== v7 palettes: techniques ==============
  // Complement: rotate every hue 180 deg but KEEP its brightness (unlike Negative).
  complement: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(fract(h + 0.5), s, v);
  },
  hueplus: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(fract(h + 0.25), s, v);
  },
  hueminus: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(fract(h + 0.75), s, v);
  },
  xenoswap: (r, g, b) => [b, r, g],
  // Split-tone: cinematic teal shadows / orange highlights, luma preserved.
  splitteal: (r, g, b) => {
    const L = luma(r, g, b);
    return mix3(hsv2rgb(0.52, 0.55, clamp(L * 0.95 + 0.04)), hsv2rgb(0.07, 0.6, clamp(L * 1.08)), smooth(0.25, 0.75, L));
  },
  splitroyal: (r, g, b) => {
    const L = luma(r, g, b);
    return mix3(hsv2rgb(0.75, 0.6, clamp(L * 0.9 + 0.05)), hsv2rgb(0.12, 0.7, clamp(L * 1.05)), smooth(0.3, 0.8, L));
  },
  pastelize: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(h, s * 0.35, clamp(0.55 + v * 0.45));
  },
  noir: (r, g, b) => {
    const L = smooth(0.16, 0.84, luma(r, g, b));
    return [clamp(L * 0.92), clamp(L * 0.96), clamp(L * 1.06)];
  },
  infraredfilm: (r, g, b) => ramp(["2a020a", "7a0a2a", "d02a5a", "ff8ab0", "fff0f4"].map(hx), Math.pow(luma(r, g, b), 0.75)),
  virtualboy: (r, g, b, c) =>
    c ? clusterTone(["100000", "5a0000", "c81020", "ff4a3a"].map(hx), c.clRank(r, g, b), c.K, 0.5) : [r, g, b],
  // CGA: hard-quantize to the classic cyan/magenta/white/black 4-color mode.
  cga: (r, g, b) => {
    const opts = [
      [0.04, 0.04, 0.04],
      [0.2, 0.9, 0.95],
      [0.95, 0.2, 0.9],
      [0.98, 0.98, 0.98],
    ];
    let bi = 0;
    let bd = 9;
    for (let i = 0; i < 4; i++) {
      const d = (r - opts[i][0]) ** 2 + (g - opts[i][1]) ** 2 + (b - opts[i][2]) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return opts[bi];
  },
  poster: (r, g, b) => [Math.round(r * 3) / 3, Math.round(g * 3) / 3, Math.round(b * 3) / 3],
  glassbody: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return mix3(hsv2rgb(h, s * 0.5, clamp(v * 0.7 + 0.3)), [0.78, 0.95, 1.0], 0.45);
  },
  phantom: (r, g, b) => {
    const [, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(0.72, clamp(s * 0.4 + 0.25), clamp(0.45 + v * 0.55));
  },
  heatmap: (r, g, b) => ramp(["101060", "2a3af0", "2ae8e8", "ffe83a", "ff5a1a", "fff0d8"].map(hx), luma(r, g, b)),
  // Hue Glide: hue slides with brightness - shadows and highlights drift apart.
  hueglide: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return hsv2rgb(fract(h + luma(r, g, b) * 0.45), clamp(s * 1.05), v);
  },
  stencil: (r, g, b) => (luma(r, g, b) > 0.5 ? [0.96, 0.96, 0.94] : [0.06, 0.06, 0.08]),
  // ============== v7 cluster combos ==============
  duoice: (r, g, b, c) =>
    c ? clusterTone(["0e2440", "bfe8ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  creamsicle: (r, g, b, c) =>
    c ? clusterTone(["c05010", "ffe9c9"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  duoviolet: (r, g, b, c) =>
    c ? clusterTone(["3a0a6a", "aef03a"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  duogold: (r, g, b, c) =>
    c ? clusterTone(["a87818", "fffaf0"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  bumblebee: (r, g, b, c) =>
    c ? clusterTone(["141208", "ffd018"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  duosakura: (r, g, b, c) =>
    c ? clusterTone(["4a1a3a", "ffd8e8"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  trinebula: (r, g, b, c) =>
    c ? clusterTone(["1a0a4a", "b02ad0", "3ae0ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  triocean: (r, g, b, c) =>
    c ? clusterTone(["0a1e4a", "148aa0", "e8fff4"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  triember: (r, g, b, c) =>
    c ? clusterTone(["120604", "c81f1a", "ffb63a"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  tripoison: (r, g, b, c) =>
    c ? clusterTone(["140a1e", "6a1aa0", "b8f03a"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
  quadautumn: (r, g, b, c) =>
    c
      ? clusterTone(["3a0e14", "a03a1a", "e08a24", "f6e0b8"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b))
      : [r, g, b],
  quadcyber: (r, g, b, c) =>
    c
      ? clusterTone(["0a0a12", "ff2a8a", "22d0ff", "ffe83a"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b))
      : [r, g, b],
  pentaretro: (r, g, b, c) =>
    c
      ? clusterTone(["2a2416", "6a5a2a", "b08a3a", "d8c890", "7aa8a0"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b))
      : [r, g, b],
  pentagalaxy: (r, g, b, c) =>
    c
      ? clusterTone(["0a0a2a", "4a1a8a", "b02ad0", "2ac8e8", "f0f4ff"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b))
      : [r, g, b],
  // ============== v8 exotic batch ==============
  // Bismuth: hopper-crystal metal - luma collapses into hard STAIRS and each stair
  // flips to the next iridescent oxide hue; thin glints ride the step boundaries.
  bismuth: (r, g, b) => {
    const L = Math.pow(luma(r, g, b), 0.85);
    const step = Math.floor(L * 7.99) / 8;
    const edge = smooth(0.05, 0.0, Math.abs(fract(L * 8) - 0.5) - 0.43);
    const c = hsv2rgb(fract(0.52 + step * 3.25), 0.72, clamp(0.2 + step * 0.84));
    return mix3(c, [1, 1, 1], clamp(edge * 0.45 + smooth(0.94, 1, L) * 0.5));
  },
  // Solarized: Sabattier darkroom reversal - mid/bright tones partially invert per
  // channel while shadows stay, then a silver-gelatin tone unifies the print.
  solarized: (r, g, b) => {
    const f = v => mix(v, 1 - v, smooth(0.42, 0.8, v) * 0.85);
    const c = [f(r), f(g), f(b)];
    const L = luma(c[0], c[1], c[2]);
    return mix3(c, [clamp(L * 1.06), L, clamp(L * 0.9)], 0.55);
  },
  // Scarlet Letter: the frame drops to a soft grayscale EXCEPT truly red/orange
  // pixels, which keep their hue and gain bite (the film selective-color look).
  scarlet: (r, g, b) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    const dh = Math.min(Math.abs(h - 0.03), 1 - Math.abs(h - 0.03));
    const keep = smooth(0.15, 0.06, dh) * smooth(0.1, 0.28, s);
    const L = Math.pow(luma(r, g, b), 0.92);
    const grey = [clamp(L * 1.02), clamp(L * 0.99), clamp(L * 0.94)];
    const red = hsv2rgb(0.015, clamp(s * 1.3 + 0.12), clamp(v * 1.06));
    return mix3(grey, red, keep);
  },
  // Tri Aurora: cluster 3-tone - deep arctic teal / aurora green / magnetic violet.
  triaurora: (r, g, b, c) =>
    c ? clusterTone(["062228", "17d489", "9b4ae8"].map(hx), c.clRank(r, g, b), c.K, luma(r, g, b)) : [r, g, b],
};
export const PALETTE_ALPHA = { spectral: 0.62, glassbody: 0.6, phantom: 0.55 };
export const CLUSTER_PAL = new Set([
  "duoink",
  "duoneon",
  "duomono",
  "duoblood",
  "duomint",
  "duosunset",
  "duomecha",
  "trisunset",
  "triforest",
  "quadvapor",
  "pentacandy",
  "pentajewel",
  "gameboy",
  "retro",
  "virtualboy",
  "duoice",
  "creamsicle",
  "duoviolet",
  "duogold",
  "bumblebee",
  "duosakura",
  "trinebula",
  "triocean",
  "triember",
  "tripoison",
  "quadautumn",
  "quadcyber",
  "pentaretro",
  "pentagalaxy",
  "triaurora",
]);

// ===========================================================================
// AURA class - position / time / edge (local-only overlay). [r,g,b,aMul]
// ===========================================================================
export const AURA = {
  rainbow: (r, g, b, x, y, t) => {
    const [h, s, v] = rgb2hsv(r, g, b);
    return [...hsv2rgb(fract(h + t * 0.15), clamp(s + 0.25), v), 1];
  },
  aurora: (r, g, b, x, y, t) => {
    const band = Math.sin(y * 5.0 + t * 1.1 + Math.sin(x * 4.0 + t * 0.6) * 1.5);
    const col = ramp(["00ff9d", "13d6ff", "8a5cff", "ff5ce0"].map(hx), (band + 1) * 0.5);
    const k = (0.35 + 0.65 * (1 - luma(r, g, b))) * (0.5 + 0.5 * band);
    return [
      ...mix3([r, g, b], [Math.min(1, r + col[0] * k), Math.min(1, g + col[1] * k), Math.min(1, b + col[2] * k)], 0.85),
      1,
    ];
  },
  holofoil: (r, g, b, x, y, t) => {
    const irid = fract((x + y) * 1.4 + t * 0.18);
    const sheen = smooth(0.45, 0.95, Math.sin((x - y) * 3.0 - t * 1.8) * 0.5 + 0.5);
    return [...mix3([r, g, b], hsv2rgb(irid, 0.65, 1.0), 0.45 + 0.45 * sheen), 1];
  },
  prismatic: (r, g, b) => [r, g, b, 1], // channel split handled in renderer
  frostbite: (r, g, b, x, y, t) => {
    const n = fbm(x * 7 + 3, y * 7);
    const crack = smooth(0.62, 0.68, n) - smooth(0.7, 0.78, n);
    const spark =
      Math.pow(Math.max(0, Math.sin(x * 40 + y * 33 + t * 3)), 60) * h2(Math.floor(x * 40), Math.floor(y * 40));
    return [...mix3([r * 0.8, g * 0.9, b], [0.85, 0.95, 1.0], clamp(crack * 2 + spark)), 1];
  },
  glitch: (r, g, b) => [r, g, b, 1], // displacement handled in renderer
  hologram: (r, g, b, x, y, t) => {
    const scan = 0.7 + 0.3 * Math.sin(y * 90 + t * 5);
    const flick = 0.88 + 0.12 * Math.sin(t * 40);
    const edge = 0.4 + 0.6 * (1 - luma(r, g, b));
    return [
      ...[0.3 * r + 0.18, 0.8 * g + 0.58, 1.0 * b + 0.66].map(v => clamp(v * scan * flick * (0.7 + 0.3 * edge))),
      0.8,
    ];
  },
  galaxy: (r, g, b, x, y, t) => {
    const neb = fbm(x * 3 + t * 0.05, y * 3 - t * 0.03);
    let c = ramp(["05010f", "1a0a4a", "5a1a8a", "b03ad0", "20c0ff"].map(hx), clamp(neb * 1.3));
    const sx = Math.floor(x * 60);
    const sy = Math.floor(y * 60);
    const star = h2(sx, sy) > 0.985 ? Math.pow(0.5 + 0.5 * Math.sin(t * 4 + h2(sy, sx) * 30), 3) : 0;
    c = [Math.min(1, c[0] + star), Math.min(1, c[1] + star), Math.min(1, c[2] + star)];
    return [...mix3(c, [1, 1, 1], smooth(0.7, 1.0, luma(r, g, b)) * 0.4), 1];
  },
  plasma: (r, g, b, x, y, t) => {
    const v =
      Math.sin(x * 8 + t)
      + Math.sin(y * 8 + t * 1.3)
      + Math.sin((x + y) * 6 + t * 0.7)
      + Math.sin(Math.hypot(x - 0.5, y - 0.5) * 16 - t * 2);
    return [...mix3([r, g, b], ramp(G.plasma, fract((v + 4) / 8)), 0.82), 1];
  },
  molten: (r, g, b, x, y, t) => {
    const n = fbm(x * 4, y * 4 - t * 0.6);
    let c = ramp(G.inferno, clamp(Math.pow(n, 1.2) + (1 - luma(r, g, b)) * 0.2));
    const glow = Math.pow(clamp((n - 0.55) / 0.45), 2);
    c = [Math.min(1, c[0] + glow * 0.6), Math.min(1, c[1] + glow * 0.25), c[2]];
    return [...mix3([r, g, b], c, 0.85), 1];
  },
  electric: (r, g, b, x, y, t) => {
    const a1 = Math.pow(
      Math.max(0, 1 - Math.abs(Math.sin(y * 11 + Math.sin(t * 6 + y * 20) * 2.2) - (x - 0.5) * 2.2)),
      18,
    );
    const a2 = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(x * 9 + Math.sin(t * 5 + x * 16) * 2) - (y - 0.5) * 2)), 22);
    const arc = Math.max(a1, a2 * 0.8);
    const flick = 0.7 + 0.3 * (h2(Math.floor(t * 22), 3) > 0.5 ? 1 : 0.4);
    const base = [r * 0.22 + 0.06, g * 0.4 + 0.12, b * 0.62 + 0.26];
    return [
      ...[base[0] + arc * 1.4 * flick, base[1] + arc * 1.6 * flick, base[2] + arc * 1.9 * flick].map(v =>
        Math.min(1, v),
      ),
      1,
    ];
  },
  dissolve: (r, g, b, x, y, t) => {
    const thr = 0.5 + 0.42 * Math.sin(t * 0.6);
    const n = fbm(x * 6 + 11, y * 6);
    if (n < thr - 0.06) {
      return [r, g, b, 0];
    }
    const edge = smooth(0.06, 0.0, Math.abs(n - thr));
    const c = mix3([r, g, b], [1.0, 0.55, 0.1], edge);
    return [Math.min(1, c[0] + edge * 0.8), c[1], c[2], 1];
  },
  mercury: (r, g, b, x, y, t) => {
    const flow = Math.sin((x + y) * 6 + t * 1.2) * 0.5 + 0.5;
    const spec = Math.pow(fract(x * 2 + y + t * 0.3), 10);
    const c = mix3(ramp(G.chrome, smooth(0.1, 0.9, luma(r, g, b))), [0.92, 0.96, 1.0], smooth(0.35, 0.7, flow) * 0.6);
    return [Math.min(1, c[0] + spec), Math.min(1, c[1] + spec), Math.min(1, c[2] + spec), 1];
  },

  // ---------- v2: fancier + partial / region effects ----------
  lavacracks: (r, g, b, x, y, t) => {
    const n = fbm(x * 5, y * 5);
    const ridge = 1 - Math.abs(n - 0.5) * 2;
    const crack = smooth(0.8, 0.95, ridge);
    const base = ramp(G.obsidian, luma(r, g, b) * 0.8);
    const glow = crack * (0.55 + 0.45 * Math.sin(t * 3 + n * 12));
    return [Math.min(1, base[0] + glow), Math.min(1, base[1] + glow * 0.4), Math.min(1, base[2] + glow * 0.06), 1];
  },
  frozenice: (r, g, b, x, y, t) => {
    const n = fbm(x * 7, y * 7);
    const crack = (smooth(0.66, 0.7, n) - smooth(0.74, 0.8, n)) * 2;
    let c = mix3([r * 0.7, g * 0.85, b], [0.82, 0.93, 1.0], clamp(crack));
    c = mix3(c, [0.6, 0.84, 1.0], 0.35);
    const gleam = Math.pow(Math.max(0, 1 - Math.abs(x + y - fract(t * 0.18) * 2.2)), 10);
    return [...c.map((v, i) => Math.min(1, v + gleam * [0.9, 0.97, 1][i])), 1];
  },
  crystalfacets: (r, g, b, x, y, t) => {
    const v = voro(x + Math.sin(t * 0.3) * 0.02, y, 7);
    const [h, s, va] = rgb2hsv(r, g, b);
    const c = hsv2rgb(mix(h, 0.55, 0.35), s * 0.6 + 0.12, clamp(va * (0.45 + v.cell * 0.7) * 1.25));
    return [...mix3(c, [0.95, 0.99, 1.0], smooth(0.09, 0.0, v.border)), 1];
  },
  stainedglass: (r, g, b, x, y) => {
    const v = voro(x, y, 6);
    const c = hsv2rgb(v.cell, 0.72, 0.45 + 0.45 * luma(r, g, b));
    return [...mix3([0.02, 0.02, 0.05], c, smooth(0.0, 0.05, v.border)), 1];
  },
  marble: (r, g, b) => {
    const turb = fbm(0.3 + fbm(2, 2), 0) + 0; // placeholder, recomputed below
    return [r, g, b, 1];
  },
  bioluminescent: (r, g, b, x, y, t) => {
    const sn = fbm(x * 6 + 3, y * 6);
    const spot = smooth(0.68, 0.86, sn);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2 + sn * 12);
    const base = [r * 0.14, g * 0.2 + 0.03, b * 0.26 + 0.05];
    const glow = spot * pulse;
    return [
      Math.min(1, base[0] + glow * 0.15),
      Math.min(1, base[1] + glow * 0.95),
      Math.min(1, base[2] + glow * 0.85),
      1,
    ];
  },
  constellation: (r, g, b, x, y, t, ctx) => {
    const L = luma(r, g, b);
    const base = [0.05 + L * 0.07, 0.06 + L * 0.09, 0.17 + L * 0.2 + (ctx?.e ?? 0) * 0.22];
    const sx = Math.floor(x * 22);
    const sy = Math.floor(y * 22);
    const star = h2(sx, sy) > 0.88 ? Math.pow(0.5 + 0.5 * Math.sin(t * 3 + h2(sy, sx) * 20), 3) : 0;
    const ln = fract(x * 3 + y * 5);
    const line = (smooth(0.485, 0.5, ln) - smooth(0.5, 0.515, ln)) * 0.16;
    return [
      Math.min(1, base[0] + star + line),
      Math.min(1, base[1] + star + line),
      Math.min(1, base[2] + star * 0.8 + line),
      1,
    ];
  },
  aurorawings: (r, g, b, x, y, t) => {
    const region = smooth(0.6, 0.2, y); // strong toward the top (wings/head)
    const band = Math.sin(y * 6.0 + t * 1.1 + Math.sin(x * 5.0 + t * 0.6) * 1.5);
    const col = ramp(["00ff9d", "13d6ff", "8a5cff", "ff5ce0"].map(hx), (band + 1) * 0.5);
    const k = region * (0.5 + 0.5 * band);
    return [...[r + col[0] * k, g + col[1] * k, b + col[2] * k].map(v => Math.min(1, v)), 1];
  },
  gildededges: (r, g, b, x, y, t, ctx) => {
    const e = ctx?.e ?? 0;
    const body = ramp(G.obsidian, luma(r, g, b) * 0.7);
    const gold = ramp(G.gold, 0.55 + 0.45 * e + 0.1 * Math.sin(t * 3 + x * 18));
    return [...mix3(body, gold, smooth(0.22, 0.85, e)), 1];
  },
  rimlight: (r, g, b, x, y, t, ctx) => {
    const e = ctx?.e ?? 0;
    const rim = smooth(0.15, 0.95, e);
    const rc = hsv2rgb(fract(0.55 + 0.12 * Math.sin(t * 0.5)), 0.6, 1);
    const base = [r * 0.4, g * 0.43, b * 0.52];
    return [
      Math.min(1, base[0] + rim * rc[0]),
      Math.min(1, base[1] + rim * rc[1]),
      Math.min(1, base[2] + rim * rc[2]),
      1,
    ];
  },
  vaporwave: (r, g, b, x, y, t) => {
    const grad = mix3(hx("ff4fd8"), hx("29e7ff"), y);
    const c = mix3([r, g, b], grad, 0.62);
    const scan = 0.84 + 0.16 * Math.sin(y * 120 + t * 2);
    return [...c.map(v => v * scan), 1];
  },
  halftone: (r, g, b, x, y) => {
    const L = luma(r, g, b);
    const s = 11;
    const cx = fract(x * s) - 0.5;
    const cy = fract(y * s) - 0.5;
    const ink = Math.hypot(cx, cy) < (1 - L) * 0.62 ? 1 : 0;
    const [h, sat] = rgb2hsv(r, g, b);
    return [...(ink ? hsv2rgb(h, clamp(sat * 1.2), 0.28) : [0.96, 0.95, 0.9]), 1];
  },
  sparkle: (r, g, b, x, y, t) => {
    const base = PALETTE.glacier(r, g, b);
    const L = luma(r, g, b);
    const gx = Math.floor(x * 30);
    const gy = Math.floor(y * 30);
    const tw = L > 0.58 && h2(gx, gy) > 0.85 ? Math.pow(Math.max(0, Math.sin(t * 4 + h2(gy, gx) * 30)), 18) : 0;
    return [Math.min(1, base[0] + tw), Math.min(1, base[1] + tw), Math.min(1, base[2] + tw), 1];
  },
  lightningveins: (r, g, b, x, y, t) => {
    const n = fbm(x * 4 + t * 0.1, y * 4);
    const ridge = 1 - Math.abs(n - 0.5) * 2;
    const vein = smooth(0.88, 0.97, ridge);
    const flick = 0.6 + 0.4 * Math.sin(t * 10 + n * 20);
    const base = [r * 0.1 + 0.02, g * 0.12 + 0.03, b * 0.2 + 0.05];
    return [
      Math.min(1, base[0] + vein * flick * 0.7),
      Math.min(1, base[1] + vein * flick * 0.95),
      Math.min(1, base[2] + vein * flick * 1.4),
      1,
    ];
  },
  dripgold: (r, g, b, x, y, t) => {
    const front = 0.34 + 0.42 * fbm(x * 7, 2.0) + 0.05 * Math.sin(t * 0.5 + x * 10);
    const cover = smooth(0.05, 0.0, y - front);
    const gold = ramp(G.gold, Math.pow(luma(r, g, b), 0.9));
    let c = mix3([r, g, b], gold, cover);
    c = mix3(c, [1, 1, 0.85], smooth(0.05, 0.0, Math.abs(front - y)) * cover);
    return [...c, 1];
  },
  spectrumsplit: (r, g, b, x, y, t) => {
    const band = fract(y - t * 0.1 + x * 0.18);
    return [...mix3([r, g, b], hsv2rgb(band, 0.62, 1.0), 0.5 + 0.25 * Math.sin(t + y * 10)), 1];
  },
};
// marble needs x,y; define properly (overwrite placeholder)
AURA.marble = (r, g, b, x, y) => {
  const turb = fbm(x * 3 + fbm(x * 2, y * 2) * 2, y * 3);
  let c = mix3([0.92, 0.92, 0.95], [0.26, 0.24, 0.34], smooth(0.42, 0.6, turb));
  c = mix3(c, [0.95, 0.8, 0.42], clamp((smooth(0.49, 0.5, turb) - smooth(0.5, 0.51, turb)) * 6));
  const sh = 0.42 + 0.58 * luma(r, g, b);
  return [...c.map(v => clamp(v * sh + 0.05)), 1];
};
AURA.ripple = (r, g, b, x, y, t, ctx) => {
  const off = 0.018 * Math.sin((x + y) * 9 - t * 3);
  const s = ctx.sa(x + off, y + off * 0.6);
  return [s[0], s[1], s[2], 1];
};
AURA.circuit = (r, g, b, x, y, t) => {
  const gx = fract(x * 9);
  const gy = fract(y * 9);
  const lx = smooth(0.09, 0, Math.min(gx, 1 - gx));
  const ly = smooth(0.09, 0, Math.min(gy, 1 - gy));
  const trace = Math.max(lx, ly);
  const node = lx * ly > 0.15 ? 1 : 0;
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 - x * 20 - y * 12);
  const base = [r * 0.12, g * 0.18 + 0.02, b * 0.22 + 0.03];
  return [
    Math.min(1, base[0] + trace * 0.12),
    Math.min(1, base[1] + trace * 0.8 * pulse + node),
    Math.min(1, base[2] + trace * 0.7 * pulse + node),
    1,
  ];
};
AURA.scales = (r, g, b, x, y, t) => {
  const v = voro(x, y, 13);
  const h = fract((x + y) * 1.6 + v.cell * 0.4 + t * 0.06);
  return [...mix3([r, g, b], hsv2rgb(h, 0.5, 1), 0.15 + 0.45 * smooth(0.12, 0, v.border)), 1];
};
AURA.tvstatic = (r, g, b, x, y, t) => {
  const s = h2(Math.floor(x * 100) * 1.1 + Math.floor(t * 24) * 7.3, Math.floor(y * 110) * 1.7);
  const scan = 0.82 + 0.18 * Math.sin(y * 120 + t * 10);
  return [...mix3([r, g, b], [s, s, s], 0.4).map(v => v * scan), 1];
};
AURA.scansweep = (r, g, b, x, y, t) => {
  const gleam = Math.pow(Math.max(0, 1 - Math.abs(x - fract(t * 0.2)) * 6), 3);
  const [h, s, v] = rgb2hsv(r, g, b);
  const c = hsv2rgb(h, s, clamp(v + gleam * 0.5));
  return [Math.min(1, c[0] + gleam * 0.6), Math.min(1, c[1] + gleam * 0.9), Math.min(1, c[2] + gleam), 1];
};
AURA.poison = (r, g, b, x, y, t) => {
  const n = fbm(x * 6, y * 6 - t * 0.5);
  const bub = smooth(0.6, 0.7, n) - smooth(0.78, 0.88, n);
  const c = ramp(["0a1a06", "1c4a10", "5fd62a", "c8ff48"].map(hx), clamp(luma(r, g, b) * 0.7 + bub * 1.4));
  const glow = smooth(0.62, 0.7, n) * 0.4;
  return [Math.min(1, c[0] + glow * 0.4), Math.min(1, c[1] + glow), c[2], 1];
};

// ===========================================================================
// AROUND class - renders in the space AROUND the sprite (a real aura/halo).
// (nx,ny normalized over the padded canvas; df = px distance to silhouette;
//  ctx = { cx, cy } normalized centroid)  ->  [r,g,b,a]
// ===========================================================================
export const AROUND = {
  outline: (nx, ny, df, t) => {
    const a = Math.pow(clamp(1 - df / 9), 1.7);
    const p = 0.85 + 0.15 * Math.sin(t * 3);
    return [0.45 * p, 0.95 * p, p, a * 0.95];
  },
  halo: (nx, ny, df, t) => {
    const a = Math.pow(clamp(1 - df / 28), 2) * (0.85 + 0.15 * Math.sin(t * 2));
    return [1.0, 0.93, 0.72, a * 0.78];
  },
  flame: (nx, ny, df, t) => {
    const n = fbm(nx * 7, ny * 7 + t * 1.7);
    const m = clamp(1 - df / 18);
    const v = clamp(n * (0.55 + 0.9 * (1 - ny)) * m * 2.2 - 0.28);
    return [...ramp(G.inferno, clamp(v * 1.2)), clamp(v * 1.7)];
  },
  shadowfire: (nx, ny, df, t) => {
    const n = fbm(nx * 7 + 5, ny * 7 + t * 1.5);
    const m = clamp(1 - df / 18);
    const v = clamp(n * (0.55 + 0.9 * (1 - ny)) * m * 2.2 - 0.28);
    return [...ramp(["0a0010", "3a0048", "8a10a0", "e64fff"].map(hx), clamp(v * 1.2)), clamp(v * 1.7)];
  },
  frost: (nx, ny, df, t) => {
    const n = fbm(nx * 6 + 3, ny * 6);
    const m = clamp(1 - df / 22);
    const mist = clamp(n * m * 1.5 - 0.25);
    const sh =
      Math.pow(Math.max(0, Math.sin(nx * 50 + ny * 40 + t)), 40)
      * (h2(Math.floor(nx * 36), Math.floor(ny * 36)) > 0.6 ? 1 : 0)
      * m;
    return [...mix3([0.62, 0.82, 1.0], [0.95, 0.99, 1.0], sh), clamp(mist * 0.8 + sh)];
  },
  efield: (nx, ny, df, t) => {
    const ridge = 1 - Math.abs(fbm(nx * 5 + t * 0.2, ny * 5) - 0.5) * 2;
    const arc = smooth(0.9, 0.99, ridge);
    const m = clamp(1 - df / 16);
    const fl = 0.6 + 0.4 * Math.sin(t * 16 + nx * 30);
    return [0.6 * arc, 0.9 * arc, arc, arc * m * fl];
  },
  rings: (nx, ny, df, t) => {
    const ring = smooth(0.45, 0.95, Math.sin(df * 0.5 - t * 4));
    const m = clamp(1 - df / 26);
    return [...hsv2rgb(fract(0.55 + df * 0.012 - t * 0.05), 0.55, 1), ring * m * 0.7];
  },
  orbit: (nx, ny, df, t, ctx) => {
    const dx = nx - ctx.cx;
    const dy = (ny - ctx.cy) * 1.1;
    const ang = Math.atan2(dy, dx) / (Math.PI * 2);
    const rad = Math.hypot(dx, dy);
    const band = smooth(0.3, 0.34, rad) * (1 - smooth(0.46, 0.52, rad));
    const s =
      Math.pow(Math.max(0, Math.cos((ang * 9 - t * 0.4) * Math.PI * 2)), 26)
      + Math.pow(Math.max(0, Math.cos((ang * 9 - t * 0.4 + 0.5) * Math.PI * 2)), 26);
    return [1, 0.95, 0.7, clamp(s * band)];
  },
  auroraveil: (nx, ny, df, t) => {
    const band = Math.sin(nx * 7 + Math.sin(ny * 3 + t) * 1.5 + t * 0.6);
    const col = ramp(["00ff9d", "13d6ff", "8a5cff", "ff5ce0"].map(hx), (band + 1) / 2);
    const m = clamp(1 - df / 30) * (0.4 + 0.4 * (1 - ny));
    return [...col, clamp((0.5 + 0.5 * band) * m * 0.95)];
  },
  holyrays: (nx, ny, df, t, ctx) => {
    const ang = Math.atan2(ny - ctx.cy, nx - ctx.cx);
    const ray = Math.pow(Math.max(0, Math.sin(ang * 14 + Math.sin(t * 0.5) * 2)), 6);
    const up = clamp(1 - ny * 1.1);
    const m = clamp(1 - df / 32);
    return [1, 0.95, 0.78, ray * up * m * 0.6];
  },
  cosmos: (nx, ny, df, t) => {
    const neb = fbm(nx * 3 + t * 0.03, ny * 3);
    const c = ramp(["05010f", "120a3a", "3a1a6a", "7a2ab0"].map(hx), clamp(neb * 1.25));
    const star =
      h2(Math.floor(nx * 70), Math.floor(ny * 70)) > 0.965
        ? Math.pow(0.5 + 0.5 * Math.sin(t * 3 + h2(Math.floor(ny * 70), Math.floor(nx * 70)) * 30), 3)
        : 0;
    return [Math.min(1, c[0] + star), Math.min(1, c[1] + star), Math.min(1, c[2] + star), 0.92];
  },
  smoke: (nx, ny, df, t) => {
    const n = fbm(nx * 5, ny * 5 - t * 0.8);
    const m = clamp(1 - df / 24);
    const v = clamp(n * m * 1.6 - 0.32);
    return [0.55 * v + 0.1, 0.55 * v + 0.1, 0.6 * v + 0.12, v * 0.7];
  },
  radiant: (nx, ny, df, t, ctx) => {
    const ang = Math.atan2(ny - ctx.cy, nx - ctx.cx);
    const ray = Math.pow(Math.max(0, Math.sin(ang * 18 + t * 0.6)), 8);
    const m = clamp(1 - df / 32);
    return [1, 0.9, 0.55, ray * m * 0.55];
  },
  embers: (nx, ny, df, t) => {
    const spot =
      h2(Math.floor(nx * 36), Math.floor((ny + t * 0.25) * 36) * 1.3) > 0.93
        ? Math.pow(0.5 + 0.5 * Math.sin(t * 6 + nx * 40), 2)
        : 0;
    const m = clamp(1 - df / 20);
    return [1, 0.6, 0.2, spot * m];
  },
  snow: (nx, ny, df, t) => {
    const spot =
      h2(Math.floor((nx + Math.sin((ny + t * 0.3) * 4) * 0.04) * 26) * 1.1, Math.floor((ny - t * 0.18) * 26) * 1.7)
      > 0.92
        ? 1
        : 0;
    const m = clamp(1 - df / 24);
    return [0.9, 0.96, 1.0, spot * m * 0.9];
  },
  bubbles: (nx, ny, df, t) => {
    const spot =
      h2(Math.floor((nx + Math.sin(ny * 10 + t) * 0.02) * 16), Math.floor((ny + t * 0.2) * 16)) > 0.86 ? 1 : 0;
    const m = clamp(1 - df / 22);
    return [0.5, 0.85, 1.0, spot * m * 0.7];
  },
};

// --- v4 exotic surface FX ---
AURA.kaleido = (r, g, b, x, y, t, ctx) => {
  const a = t * 0.08;
  const dx = x - 0.5;
  const dy = y - 0.5;
  const rx = Math.abs(dx * Math.cos(a) - dy * Math.sin(a));
  const ry = Math.abs(dx * Math.sin(a) + dy * Math.cos(a));
  const s = ctx.sa(0.5 + rx * 1.6, 0.5 + ry * 1.6);
  const [h, sa2, v] = rgb2hsv(s[0], s[1], s[2]);
  return [...hsv2rgb(fract(h + t * 0.05), sa2, v), 1];
};
AURA.fractalflow = (r, g, b, x, y, t) => {
  const w = fbm(x * 4 + t * 0.1, y * 4);
  const n = fbm(x * 4 + w * 1.5, y * 4 + w * 1.5 - t * 0.1);
  return [...mix3([r, g, b], hsv2rgb(fract(n + t * 0.05), 0.6, clamp(0.35 + luma(r, g, b) * 0.7)), 0.7), 1];
};
AURA.wormhole = (r, g, b, x, y, t, ctx) => {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const rr = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx) + 0.35 / (rr + 0.12) - t * 0.6;
  const s = ctx.sa(0.5 + Math.cos(ang) * rr, 0.5 + Math.sin(ang) * rr);
  return [s[0], s[1], s[2], 1];
};
AURA.shatter = (r, g, b, x, y, t, ctx) => {
  const v = voro(x, y, 9);
  const s = ctx.sa(x + (v.cell - 0.5) * 0.06, y + (h2(Math.floor(x * 9), Math.floor(y * 9)) - 0.5) * 0.06);
  return [...mix3([s[0], s[1], s[2]], [0.02, 0.02, 0.04], smooth(0.04, 0, v.border)), 1];
};
AURA.heatshimmer = (r, g, b, x, y, t, ctx) => {
  const off = 0.012 * Math.sin(y * 30 + t * 4);
  const s = ctx.sa(x + off, y);
  return [Math.min(1, s[0] * 1.05 + 0.03), s[1], s[2] * 0.92, 1];
};
AURA.caustics = (r, g, b, x, y, t) => {
  const c1 = (Math.sin(x * 14 + t * 2) + Math.sin(y * 16 - t * 1.5) + Math.sin((x + y) * 12 + t)) / 3;
  const caus = Math.pow(Math.max(0, c1), 3);
  return [Math.min(1, r * 0.6 + caus * 0.7), Math.min(1, g * 0.8 + 0.05 + caus * 0.9), Math.min(1, b + 0.05 + caus), 1];
};
AURA.oilfilm = (r, g, b, x, y, t) => {
  const L = luma(r, g, b);
  return [...hsv2rgb(fract(L * 2 + Math.sin((x + y) * 6 + t) * 0.2 + t * 0.05), 0.6, clamp(0.35 + L * 0.75)), 1];
};
AURA.pixelpulse = (r, g, b, x, y, t, ctx) => {
  const s = 7 + Math.round(3 + 3 * Math.sin(t));
  const px = Math.floor(x * s) / s;
  const py = Math.floor(y * s) / s;
  const sm = ctx.sa(px + 0.5 / s, py + 0.5 / s);
  return [sm[0], sm[1], sm[2], 1];
};
AURA.neonwire = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const gx = fract(x * 7);
  const gy = fract(y * 7);
  const grid = Math.max(smooth(0.08, 0, Math.min(gx, 1 - gx)), smooth(0.08, 0, Math.min(gy, 1 - gy)));
  const base = [r * 0.1, g * 0.12, b * 0.18];
  const neon = Math.max(e, grid * 0.5) * (0.7 + 0.3 * Math.sin(t * 3));
  return [Math.min(1, base[0] + neon * 0.2), Math.min(1, base[1] + neon), Math.min(1, base[2] + neon), 1];
};
AURA.starmap = (r, g, b, x, y, t) => {
  const base = [0.03, 0.04, 0.1 + luma(r, g, b) * 0.15];
  const sx = Math.floor(x * 30);
  const sy = Math.floor(y * 30);
  const star = h2(sx, sy) > 0.84 ? Math.pow(0.5 + 0.5 * Math.sin(t * 3 + h2(sy, sx) * 20), 2) : 0;
  return [Math.min(1, base[0] + star), Math.min(1, base[1] + star), Math.min(1, base[2] + star), 1];
};

// --- v4 around FX (incl. partial: wing/foot/crown/under/rising/top/side) ---
AROUND.wingflame = (nx, ny, df, t, c) => {
  const reg = smooth(0.55, 0.12, ny) * smooth(0.05, 0.18, Math.abs(nx - c.cx));
  const n = fbm(nx * 8, ny * 8 - t * 1.8);
  const m = clamp(1 - df / 14);
  const v = clamp(n * m * reg * 3 - 0.2);
  return [...ramp(G.inferno, clamp(v * 1.2)), clamp(v * 1.7)];
};
AROUND.footfrost = (nx, ny, df, t, c) => {
  const gy = c?.fy ?? 0.82;
  const reg = smooth(gy - 0.27, gy + 0.03, ny);
  const n = fbm(nx * 7, ny * 7 + t * 0.3);
  const m = clamp(1 - df / 18);
  return [0.7, 0.85, 1.0, clamp(n * m * reg * 2 - 0.2) * 0.85];
};
AROUND.crown = (nx, ny, df, t, c) => {
  const hx = nx - c.cx;
  const hy = (ny - (c.cy - 0.33)) * 1.5;
  const r = Math.hypot(hx, hy);
  const ring = smooth(0.035, 0, Math.abs(r - 0.13)) * (ny < c.cy ? 1 : 0);
  return [1, 0.92, 0.6, ring * (0.7 + 0.3 * Math.sin(t * 3)) * 0.95];
};
AROUND.underlight = (nx, ny, df, t, c) => {
  const gy = c?.fy ?? 0.82;
  const reg = smooth(gy - 0.27, gy + 0.18, ny);
  const m = clamp(1 - df / 20);
  return [1.0, 0.8, 0.5, reg * m * 0.6 * (0.85 + 0.15 * Math.sin(t * 2))];
};
AROUND.uprising = (nx, ny, df, t) => {
  const reg = smooth(0.95, 0.2, ny);
  const spot = h2(Math.floor(nx * 32), Math.floor((ny + t * 0.4) * 32) * 1.3) > 0.93 ? 1 : 0;
  const m = clamp(1 - df / 20);
  return [0.7, 1.0, 0.85, spot * m * reg];
};
AROUND.topbeam = (nx, ny, df, t, c) => {
  const reg = smooth(0.55, 0, ny);
  const ray = Math.pow(Math.max(0, Math.cos((nx - c.cx) * 4)), 3);
  const m = clamp(1 - df / 30);
  return [1, 0.97, 0.8, ray * reg * m * 0.55];
};
AROUND.sideaura = (nx, ny, df, t) => {
  const reg = smooth(0.42, 0.62, nx);
  const ridge = 1 - Math.abs(fbm(nx * 5, ny * 5 + t * 0.3) - 0.5) * 2;
  const arc = smooth(0.85, 0.99, ridge);
  const m = clamp(1 - df / 18);
  return [0.7 * arc, 0.85 * arc, arc, arc * reg * m];
};
AROUND.magiccircle = (nx, ny, df, t, c) => {
  const ex = nx - c.cx;
  const ey = (ny - (c.fy ?? c.cy + 0.34)) * 2.6; // circle centered on the feet line
  const r = Math.hypot(ex, ey);
  const ang = Math.atan2(ey, ex);
  const ring = smooth(0.03, 0, Math.abs(r - 0.2));
  const rune = ring * (0.5 + 0.5 * Math.pow(Math.max(0, Math.sin(ang * 8 + t * 1.5)), 4));
  return [0.5, 0.8, 1.0, rune * 0.9];
};
AROUND.vortex = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = ny - c.cy;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const sp = Math.sin(ang * 3 + r * 22 - t * 4);
  const a = smooth(0.45, 0.95, sp) * clamp(1 - df / 26);
  return [...hsv2rgb(fract(0.6 + r - t * 0.05), 0.6, 1), a * 0.6];
};
AROUND.galaxyspiral = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = ny - c.cy;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const arm = Math.sin(ang * 2 + r * 16 - t * 1.5);
  const col = ramp(["1a0a3a", "5a1a8a", "b03ad0", "20c0ff"].map(hx), clamp((arm + 1) / 2));
  const a = smooth(0.4, 0.95, arm) * clamp(1 - df / 30);
  return [...col, a * 0.7];
};
AROUND.fireflies = (nx, ny, df, t) => {
  const sx = Math.floor((nx + Math.sin(ny * 6 + t) * 0.05) * 28);
  const sy = Math.floor((ny + Math.cos(nx * 6 + t * 0.7) * 0.05) * 28);
  const spot = h2(sx, sy) > 0.93 ? Math.pow(0.5 + 0.5 * Math.sin(t * 4 + h2(sy, sx) * 30), 3) : 0;
  const m = clamp(1 - df / 24);
  return [0.8, 1.0, 0.4, spot * m];
};
AROUND.petals = (nx, ny, df, t) => {
  const sx = Math.floor((nx + Math.sin((ny + t * 0.3) * 3) * 0.06) * 24);
  const sy = Math.floor((ny - t * 0.22) * 24);
  const spot = h2(sx * 1.1, sy * 1.7) > 0.92 ? 1 : 0;
  const m = clamp(1 - df / 24);
  return [1.0, 0.7, 0.85, spot * m * 0.85];
};
AROUND.rain = (nx, ny, df, t) => {
  const col = Math.floor(nx * 40);
  const ph = fract(ny * 3 - t * 1.5 + h2(col, 0));
  const streak = smooth(0, 0.06, ph) * smooth(0.18, 0, ph);
  const m = clamp(1 - df / 26);
  return [0.6, 0.75, 1.0, streak * m * 0.6];
};
AROUND.sparkstorm = (nx, ny, df, t) => {
  const colp = nx + Math.sin(t * 3 + Math.floor(nx * 8)) * 0.02;
  const bolt = Math.pow(Math.max(0, 1 - Math.abs(fract(colp * 8) - 0.5) * 8), 6);
  const flick = h2(Math.floor(t * 10), Math.floor(nx * 8)) > 0.65 ? 1 : 0;
  const m = clamp(1 - df / 28);
  return [0.85, 0.92, 1.0, bolt * flick * (1 - ny * 0.4) * m];
};
AROUND.prismburst = (nx, ny, df, t, c) => {
  const ang = Math.atan2(ny - c.cy, nx - c.cx);
  const ray = Math.pow(Math.max(0, Math.sin(ang * 16 + t * 0.4)), 4);
  const m = clamp(1 - df / 30);
  return [...hsv2rgb(fract(ang / (Math.PI * 2) + 0.5 + t * 0.1), 0.7, 1), ray * m * 0.6];
};
AROUND.icespikes = (nx, ny, df, t) => {
  const col = Math.floor(nx * 22);
  const base = 0.78 + h2(col, 3) * 0.18;
  const spike = ny > base ? smooth(0, 0.04, ny - base) * (1 - smooth(0, 0.18, ny - base)) : 0;
  const shard = spike * smooth(0.5, 0, Math.abs(fract(nx * 22) - 0.5));
  const m = clamp(1 - df / 16);
  return [0.7, 0.88, 1.0, (shard + spike * 0.3) * m];
};

// --- v5 surface ---
AURA.synthscan = (r, g, b, x, y, t) => {
  const grad = ramp(["ff2a8a", "ff8a2a", "ffe060", "9a3aff"].map(hx), fract(y * 0.9 - t * 0.06));
  const c = mix3([r, g, b], grad, 0.6);
  const scan = 0.78 + 0.22 * Math.sin(y * 110 + t * 2);
  return [...c.map(v => clamp(v * scan)), 1];
};
// Rainbow as a SURFACE FX: a bright rainbow glow that cycles around the sprite's
// own edge (uses the edge field). Reads like the RainbowMetagross outline but on-sprite.
AURA.rainbowedge = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const rim = smooth(0.15, 0.95, e);
  const rc = hsv2rgb(fract((x + y) * 0.6 + t * 0.25), 0.95, 1);
  return [...mix3([r, g, b], rc, rim * 0.92), 1];
};
AURA.sunsetsun = (r, g, b, x, y) => {
  const grad = ramp(["ffe85a", "ffaa2a", "ff6a3a", "e0407a", "a02a9a", "4a1a7a"].map(hx), clamp(y * 1.05));
  const gap = 0.1 + 0.55 * y;
  const band = y > 0.36 && fract(y * 13) < gap ? 0.22 : 1;
  return [
    ...mix3(
      [r, g, b],
      grad.map(v => v * band),
      0.92,
    ),
    1,
  ];
};
AURA.crosshatch = (r, g, b, x, y) => {
  const L = luma(r, g, b);
  const a1 = Math.sin((x + y) * 70) * 0.5 + 0.5;
  const a2 = Math.sin((x - y) * 70) * 0.5 + 0.5;
  const a3 = Math.sin(x * 95) * 0.5 + 0.5;
  let ink = 0;
  if (L < 0.62 && a1 < 0.42) {
    ink = 1;
  }
  if (L < 0.42 && a2 < 0.42) {
    ink = 1;
  }
  if (L < 0.24 && a3 < 0.42) {
    ink = 1;
  }
  const [h, s] = rgb2hsv(r, g, b);
  return ink ? [...hsv2rgb(h, clamp(s * 1.1), 0.12), 1] : [0.95, 0.94, 0.9, 1];
};
AURA.tron = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const peri = fract(Math.atan2(y - 0.5, x - 0.5) / (Math.PI * 2) + 0.5);
  let seg = 0;
  for (let i = 0; i < 3; i++) {
    seg = Math.max(seg, Math.pow(Math.max(0, 1 - Math.abs(fract(peri - t * 0.13 - i / 3 + 0.5) - 0.5) * 10), 3));
  }
  const rim = smooth(0.4, 1, e);
  const glow = seg * rim;
  const base = [r * 0.18, g * 0.22, b * 0.3];
  return [
    Math.min(1, base[0] + glow * 0.4 + rim * 0.05),
    Math.min(1, base[1] + glow + rim * 0.2),
    Math.min(1, base[2] + glow + rim * 0.35),
    1,
  ];
};

// --- v5 around: PokeMMO-style colored auras ---
AROUND.rainbowglitter = (nx, ny, df, t) => {
  const glow = Math.pow(clamp(1 - df / 22), 1.5) * 0.4;
  const gx = Math.floor(nx * 34);
  const gy = Math.floor(ny * 34);
  const tw = h2(gx + 0.5, gy + 0.5) > 0.9 ? Math.pow(0.5 + 0.5 * Math.sin(t * 5 + h2(gy, gx) * 30), 4) : 0;
  const m = clamp(1 - df / 26);
  const sp = hsv2rgb(fract(h2(gx, gy) + t * 0.1), 0.85, 1);
  const gc = hsv2rgb(fract((nx + ny) * 0.5 + t * 0.12), 0.7, 1);
  return [
    Math.min(1, gc[0] * glow + sp[0] * tw * m),
    Math.min(1, gc[1] * glow + sp[1] * tw * m),
    Math.min(1, gc[2] * glow + sp[2] * tw * m),
    clamp(glow + tw * m),
  ];
};
AROUND.luminous = (nx, ny, df, t) => {
  const glow = Math.pow(clamp(1 - df / 20), 1.4);
  const n = fbm(nx * 6, ny * 6 + t * 1.2);
  const a = glow * (0.7 + 0.3 * n);
  return [0.3 * a, (0.7 + 0.3 * n) * a, a, a * 0.9];
};
AROUND.cursedaura = (nx, ny, df, t) => {
  // cleaner ominous glow (not smoky): smooth red halo + a brighter thin rim + a faint flicker
  const glow = Math.pow(clamp(1 - df / 16), 1.5) * (0.78 + 0.22 * Math.sin(t * 2.5));
  const rim = Math.pow(clamp(1 - df / 7), 2) * 0.5;
  const flick = 0.9 + 0.1 * fbm(nx * 5, ny * 5 + t * 2);
  const a = clamp((glow + rim) * flick);
  return [a, 0.08 * a, 0.04 * a, a];
};
AROUND.goldenglow = (nx, ny, df, t) => {
  const glow = Math.pow(clamp(1 - df / 24), 1.5) * (0.85 + 0.15 * Math.sin(t * 2));
  const gx = Math.floor(nx * 30);
  const gy = Math.floor(ny * 30);
  const tw = h2(gx + 2, gy) > 0.92 ? Math.pow(0.5 + 0.5 * Math.sin(t * 4 + h2(gy, gx) * 20), 3) : 0;
  const m = clamp(1 - df / 26);
  return [
    Math.min(1, glow + tw * m),
    Math.min(1, 0.82 * glow + tw * m),
    Math.min(1, 0.4 * glow + tw * m * 0.6),
    clamp(glow + tw * m),
  ];
};
AROUND.shadowaura = (nx, ny, df, t) => {
  const glow = Math.pow(clamp(1 - df / 19), 1.35) * (0.7 + 0.3 * Math.sin(t * 1.5));
  const n = fbm(nx * 7 + 3, ny * 7 + t * 1.3);
  const wisp = clamp(n * clamp(1 - df / 17) * (0.5 + 0.7 * (1 - ny)) * 2 - 0.3);
  const a = clamp(glow + wisp);
  return [0.5 * a, 0.1 * a, 0.7 * a, a];
};
AROUND.rainbowoutline = (nx, ny, df, t, c) => {
  const ang = Math.atan2(ny - c.cy, nx - c.cx) / (Math.PI * 2) + 0.5;
  return [...hsv2rgb(fract(ang + t * 0.2), 0.9, 1), Math.pow(clamp(1 - df / 10), 1.6) * 0.95];
};

// --- v5 around: geometric shape particles ---
const _tri = (x, y) => Math.max(-y - 0.45, x * 0.866 + y * 0.5 - 0.45, -x * 0.866 + y * 0.5 - 0.45);
const _hex = (x, y) => {
  x = Math.abs(x);
  y = Math.abs(y);
  return Math.max(x * 0.866 + y * 0.5, y) - 0.5;
};
const _heart = (x, y) => {
  y = -y * 1.15 + 0.25;
  const a = x * x + y * y - 0.5;
  return a * a * a - x * x * y * y * y;
};
function _shapes(nx, ny, df, t, sdf, color, cell, drift) {
  const fy = ny - t * drift;
  const cx = Math.floor(nx * cell);
  const cy = Math.floor(fy * cell);
  if (h2(cx * 1.7 + 2.3, cy * 1.3 + 1.1) < 0.84) {
    return [0, 0, 0, 0];
  }
  const lx = (fract(nx * cell) - 0.5) * 2.2;
  const ly = (fract(fy * cell) - 0.5) * 2.2;
  if (sdf(lx, ly) > 0) {
    return [0, 0, 0, 0];
  }
  const m = clamp(1 - df / 24);
  return [color[0], color[1], color[2], m * (0.7 + 0.3 * Math.sin(t * 3 + cx * 1.3 + cy))];
}
AROUND.triangles = (nx, ny, df, t) => _shapes(nx, ny, df, t, _tri, [0.5, 0.9, 1.0], 11, 0.18);
AROUND.hexagons = (nx, ny, df, t) => _shapes(nx, ny, df, t, _hex, [0.6, 1.0, 0.8], 11, -0.12);
AROUND.hearts = (nx, ny, df, t) => _shapes(nx, ny, df, t, _heart, [1.0, 0.5, 0.7], 10, 0.16);
AROUND.staticfield = (nx, ny, df, t) => {
  const s = h2(Math.floor(nx * 90) * 1.1 + Math.floor(t * 22) * 7.3, Math.floor(ny * 100) * 1.7);
  const m = clamp(1 - df / 24);
  return [s, s, s, s > 0.5 ? m * 0.5 : 0];
};

// ===========================================================================
// v6 (Discord brainstorm): neon signage, mist silhouettes, HD light, glass,
// outline surgery, front/behind orbitals, sinister sun, HD stars, echoes.
// ===========================================================================

// Neon Sign: keep only the pure blacks + the silhouette edge as glowing neon tubes
// (colored from the nearest region's own hue, like bar lettering); the fill goes
// almost fully transparent.
AURA.neonsign = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const ink = Math.max(smooth(0.35, 0.9, e), luma(r, g, b) < 0.17 ? 1 : 0);
  if (ink < 0.05) {
    return [r * 0.5, g * 0.5, b * 0.6, 0.07];
  }
  let bh = 0;
  let bs = 0.9;
  let bw = -1;
  for (const [ox, oy] of [
    [0.05, 0],
    [-0.05, 0],
    [0, 0.05],
    [0, -0.05],
    [0.035, 0.035],
    [-0.035, -0.035],
  ]) {
    const s2 = ctx.sa(x + ox, y + oy);
    if (s2[3] < 0.5) {
      continue;
    }
    const hsv = rgb2hsv(s2[0], s2[1], s2[2]);
    const w = hsv[1] * hsv[2];
    if (w > bw) {
      bw = w;
      bh = hsv[0];
      bs = hsv[1];
    }
  }
  const col = bw > 0.04 ? hsv2rgb(bh, clamp(bs * 1.2 + 0.25), 1) : hsv2rgb(fract((x + y) * 0.5 + t * 0.08), 0.9, 1);
  const buzz = 0.8 + 0.2 * Math.sin(t * 2.4 + (x + y) * 4) * (h2(Math.floor(t * 14), 2) > 0.08 ? 1 : 0.3);
  return [col[0] * buzz, col[1] * buzz, col[2] * buzz, ink];
};
// Mist Veil: the whole silhouette frays into drifting mist (edge alpha erosion).
AURA.mistveil = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const n = fbm(x * 6 + t * 0.35, y * 6 - t * 0.22);
  const erode = smooth(0.25, 1.0, e) * smooth(0.32, 0.75, n);
  const whiten = clamp(erode * 1.3) * 0.55;
  return [mix(r, 0.9, whiten), mix(g, 0.94, whiten), mix(b, 1.0, whiten), clamp(1 - erode * 1.7)];
};
// Rising Mist: only the lower body dissolves, like the mountain-in-fog photo.
AURA.mistfeet = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const reg = smooth(0.45, 0.95, y);
  const n = fbm(x * 5 + t * 0.3, y * 6 - t * 0.15);
  const erode = clamp(reg * (0.35 + smooth(0.3, 0.8, n)) * (0.45 + 0.55 * e) * 1.5);
  const whiten = clamp(erode * 1.2) * 0.6;
  return [mix(r, 0.9, whiten), mix(g, 0.93, whiten), mix(b, 0.99, whiten), clamp(1 - erode * 1.45)];
};
// Bloom: HD soft glow - bright regions bleed light outward (smooth, not pixelated).
AURA.bloom = (r, g, b, x, y, t, ctx) => {
  const acc = [0, 0, 0];
  let n = 0;
  for (let ring = 1; ring <= 2; ring++) {
    const R = 0.028 * ring;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + ring;
      const s2 = ctx.sa(x + Math.cos(a) * R, y + Math.sin(a) * R);
      if (s2[3] < 0.5) {
        continue;
      }
      const w = smooth(0.52, 1.0, luma(s2[0], s2[1], s2[2])) / ring;
      acc[0] += s2[0] * w;
      acc[1] += s2[1] * w;
      acc[2] += s2[2] * w;
      n++;
    }
  }
  const k = n ? 1.0 / n : 0;
  const pulse = 0.82 + 0.18 * Math.sin(t * 1.7);
  return [clamp(r + acc[0] * k * pulse), clamp(g + acc[1] * k * pulse), clamp(b + acc[2] * k * pulse), 1];
};
// HD Lighting: blur the sprite's own lights/darks into a smooth low-opacity
// shading layer (softlight blend) so the lighting reads high-def.
AURA.softshade = (r, g, b, x, y, t, ctx) => {
  let acc = 0;
  let n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const s2 = ctx.sa(x + dx * 0.022, y + dy * 0.022);
      if (s2[3] < 0.5) {
        continue;
      }
      acc += luma(s2[0], s2[1], s2[2]);
      n++;
    }
  }
  const soft = n ? acc / n : luma(r, g, b);
  const tv = smooth(0.12, 0.88, soft);
  return [tv, tv, tv, 1];
};
// Glass Warp: refraction through uneven voronoi glass panes + bright pane seams.
AURA.glasswarp = (r, g, b, x, y, t, ctx) => {
  const v = voro(x + Math.sin(t * 0.4) * 0.012, y, 5);
  const ang = v.cell * Math.PI * 2;
  const s2 = ctx.sa(x + Math.cos(ang) * 0.035, y + Math.sin(ang) * 0.035);
  const c = s2[3] > 0.02 ? [s2[0], s2[1], s2[2]] : [r, g, b];
  const streak = Math.pow(Math.max(0, Math.sin((x + y) * 9 + v.cell * 8 + t * 0.5)), 22) * 0.45;
  const seam = smooth(0.045, 0.0, v.border) * 0.3;
  return [clamp(c[0] * 0.94 + streak + seam), clamp(c[1] * 0.97 + streak + seam), clamp(c[2] + streak + seam), 1];
};
// No Outline: delete the dark linework entirely - the fill floats disjointed.
AURA.unlined = (r, g, b) => [r, g, b, smooth(0.1, 0.2, luma(r, g, b))];
// Pulled Apart: the sprite shatters into voronoi shards, each shifted its own way,
// with the outline gaps left transparent (the "sprite pulled apart" idea).
AURA.sundered = (r, g, b, x, y, t, ctx) => {
  const v = voro(x, y, 4);
  const ang = v.cell * Math.PI * 2;
  const push = 0.045 + 0.025 * Math.sin(t * 1.4 + v.cell * 19);
  const s2 = ctx.sa(x - Math.cos(ang) * push, y - Math.sin(ang) * push);
  if (s2[3] < 0.02) {
    return [0, 0, 0, 0];
  }
  return [...mix3([s2[0], s2[1], s2[2]], [0.03, 0.03, 0.05], smooth(0.035, 0.0, v.border) * 0.75), 1];
};
// Living Shadow: the mon becomes a breathing flat shadow with a violet rim.
AURA.livingshadow = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const rim = smooth(0.3, 1.0, e) * (0.7 + 0.3 * Math.sin(t * 1.3));
  return [0.03 + rim * 0.22, 0.015 + rim * 0.05, 0.07 + rim * 0.5, 0.94];
};

// ============== v7 surface FX ==============
// Waterline: the mon stands half-sunk - a bright surface line, and below it a
// wavy, deep-blue mirror of its upper half.
AURA.waterline = (r, g, b, x, y, t, ctx) => {
  const WL = 0.58;
  if (y < WL - 0.012) {
    return [r, g, b, 1];
  }
  if (y < WL + 0.018) {
    const gl = 0.5 + 0.5 * Math.sin(x * 26 + t * 2.2);
    return [clamp(r * 0.45 + 0.35 + gl * 0.3), clamp(g * 0.5 + 0.42 + gl * 0.35), clamp(b * 0.55 + 0.5 + gl * 0.4), 1];
  }
  const depth = (y - WL) / (1 - WL);
  const wob = (0.015 + depth * 0.045) * Math.sin(y * 38 - t * 2.6);
  const s2 = ctx.sa(x + wob, 2 * WL - y);
  const c = s2[3] > 0.02 ? [s2[0], s2[1], s2[2]] : [r * 0.45, g * 0.55, b * 0.75];
  const shimmer = Math.pow(Math.max(0, Math.sin(y * 52 + x * 8 - t * 3)), 6) * (1 - depth) * 0.35;
  return [
    clamp(mix(c[0], 0.08, 0.4 + depth * 0.3) + shimmer * 0.7),
    clamp(mix(c[1], 0.28, 0.32 + depth * 0.26) + shimmer * 0.85),
    clamp(mix(c[2], 0.5, 0.24 + depth * 0.2) + shimmer),
    1,
  ];
};
// Fire Creep: flames crawling up the body from the feet.
AURA.firecreep = (r, g, b, x, y, t) => {
  const n = fbm(x * 6, y * 5 - t * 1.2);
  const reg = smooth(0.35, 0.95, y + (n - 0.5) * 0.4);
  const fire = ramp(G.inferno, clamp(n * 1.4 * reg));
  return [...mix3([r, g, b], fire, clamp(reg * 1.4) * 0.9), 1];
};
// Snowcap: thick snow settles on every upward-facing surface, with glints.
AURA.snowcap = (r, g, b, x, y, t, ctx) => {
  const open1 = ctx.sa(x, y - 0.03)[3] < 0.4 ? 1 : 0;
  const open2 = ctx.sa(x, y - 0.07)[3] < 0.4 ? 0.7 : 0;
  const open = Math.max(open1, open2);
  const n = 0.75 + 0.25 * vnoise(x * 22, y * 22);
  const cap = clamp(open * n * 1.6);
  let c = mix3([r, g, b], [0.96, 0.98, 1.0], cap);
  c = mix3(c, [0.62, 0.74, 0.95], cap > 0.1 && cap < 0.55 ? 0.3 : 0);
  const glint =
    cap > 0.6 && h2(Math.floor(x * 40), Math.floor(y * 40)) > 0.9
      ? Math.pow(0.5 + 0.5 * Math.sin(t * 3 + x * 30), 4) * 0.55
      : 0;
  return [clamp(c[0] + glint), clamp(c[1] + glint), clamp(c[2] + glint), 1];
};
// Disco Glints: mirror facets flashing hard, under sweeping colored club light.
AURA.discoball = (r, g, b, x, y, t) => {
  const gx = Math.floor(x * 9);
  const gy = Math.floor(y * 9);
  const ph = h2(gx, gy);
  const fl = Math.pow(Math.max(0, Math.sin(t * 2.4 + ph * 20)), 8);
  const facet = 0.9 + (h2(gx + 3, gy) - 0.5) * 0.2;
  const beam = Math.pow(Math.max(0, Math.sin((x + y) * 4.5 - t * 1.7)), 4) * 0.45;
  const bc = hsv2rgb(fract(t * 0.11), 0.65, 1);
  const col = hsv2rgb(fract(ph + t * 0.08), 0.5, 1);
  return [
    clamp(r * 0.8 * facet + col[0] * fl + bc[0] * beam),
    clamp(g * 0.8 * facet + col[1] * fl + bc[1] * beam),
    clamp(b * 0.8 * facet + col[2] * fl + bc[2] * beam),
    1,
  ];
};
// Lens Flare: a hot anamorphic flare drifting over the body, spikes and ghosts included.
AURA.lensflare = (r, g, b, x, y, t) => {
  const fx0 = 0.5 + 0.22 * Math.sin(t * 0.5);
  const fy0 = 0.32 + 0.14 * Math.cos(t * 0.35);
  const d = Math.hypot(x - fx0, y - fy0);
  const core = Math.pow(clamp(1 - d * 3), 5) * 1.1;
  const ana = Math.pow(clamp(1 - Math.abs(y - fy0) * 9), 4) * 0.55;
  const spikes = Math.pow(Math.max(0, Math.cos(Math.atan2(y - fy0, x - fx0) * 3)), 30) * Math.pow(clamp(1 - d * 1.8), 2) * 0.7;
  let ghost = 0;
  for (let i = 1; i <= 3; i++) {
    const k = i / 3;
    ghost += smooth(0.05, 0.02, Math.abs(Math.hypot(x - mix(fx0, 1 - fx0, k), y - mix(fy0, 1 - fy0, k)) - 0.04)) * 0.3;
  }
  const k = core + ana + spikes + ghost;
  return [clamp(r + k), clamp(g + k * 0.92), clamp(b + k * 0.75), 1];
};
// Old Film: sepia, grain, gate weave, scratches, vignette, flicker.
AURA.oldfilm = (r, g, b, x, y, t) => {
  const L = luma(r, g, b);
  let c = [clamp(L * 1.05 + 0.06), clamp(L * 0.88 + 0.04), clamp(L * 0.62)];
  const grain = (h2(Math.floor(x * 90) + Math.floor(t * 18) * 13, Math.floor(y * 90)) - 0.5) * 0.22;
  const scratch = h2(Math.floor(t * 7), 3) > 0.7 && Math.abs(x - h2(Math.floor(t * 7), 9)) < 0.004 ? 0.35 : 0;
  const vig = 1 - Math.pow(Math.hypot(x - 0.5, y - 0.5) * 1.2, 2) * 0.5;
  const flick = 0.92 + 0.08 * Math.sin(t * 19 + Math.sin(t * 7));
  c = c.map(v => clamp((v + grain + scratch) * vig * flick));
  return [c[0], c[1], c[2], 1];
};
// VHS: tracking-band displacement + chroma bleed + row noise (worn tape).
AURA.vhs = (r, g, b, x, y, t, ctx) => {
  const band = Math.floor(y * 24 + t * 2);
  const bad = h2(band, Math.floor(t * 5)) > 0.82;
  const dx = bad ? (h2(band + 3, Math.floor(t * 9)) - 0.5) * 0.1 : 0;
  const sR = ctx.sa(x + dx + 0.014, y);
  const sB = ctx.sa(x + dx - 0.014, y);
  const sG = ctx.sa(x + dx, y);
  const noise = bad ? (h2(Math.floor(x * 70), band * 7 + Math.floor(t * 30)) - 0.5) * 0.5 : 0;
  return [clamp(sR[0] + noise), clamp(sG[1] + noise), clamp(sB[2] + noise), sG[3] > 0.02 ? 1 : 0.15];
};
// Pixel Sort: whole columns smear their brightest color downward, hard.
AURA.pixelsort = (r, g, b, x, y, t, ctx) => {
  const col = Math.floor(x * 36);
  if (h2(col, 11) < 0.42) {
    return [r, g, b, 1];
  }
  let best = [r, g, b];
  let bl = luma(r, g, b);
  for (let i = 1; i <= 9; i++) {
    const s2 = ctx.sa(x, y - i * 0.03);
    if (s2[3] < 0.5) {
      continue;
    }
    const L2 = luma(s2[0], s2[1], s2[2]);
    if (L2 > bl) {
      bl = L2;
      best = [s2[0], s2[1], s2[2]];
    }
  }
  const drift = 0.5 + 0.5 * Math.sin(t * 0.9 + col);
  return [...mix3([r, g, b], best, clamp(smooth(0.3, 0.7, bl) * (0.55 + drift * 0.45))), 1];
};
// Hypno Rings: bold two-tone rings pulsing out from the heart, slightly spiraled.
AURA.moire = (r, g, b, x, y, t) => {
  const d = Math.hypot(x - 0.5, y - 0.48);
  const ang = Math.atan2(y - 0.48, x - 0.5);
  const ring = Math.sin(d * 44 - t * 3.1 + Math.sin(ang * 2 + t) * 0.9);
  const band = smooth(-0.25, 0.65, ring);
  const c1 = hsv2rgb(fract(0.86 + t * 0.02), 0.75, 0.98);
  const c2 = hsv2rgb(fract(0.53 + t * 0.02), 0.7, 0.3);
  const L = 0.4 + luma(r, g, b) * 0.7;
  const c = mix3(c2, c1, band);
  return [clamp(c[0] * L), clamp(c[1] * L), clamp(c[2] * L), 1];
};
// Contours: animated topographic iso-lines drawn on the body's brightness.
AURA.contours = (r, g, b, x, y, t) => {
  const L = luma(r, g, b);
  const band = fract(L * 6 - t * 0.12);
  const line = smooth(0.1, 0.02, Math.abs(band - 0.5)) * 0.9;
  const flat = mix3([r, g, b], [r * 0.7 + 0.08, g * 0.75 + 0.09, b * 0.8 + 0.12], 0.4);
  return [...mix3(flat, [0.1, 0.9, 0.7], line), 1];
};
// Code Rain: green glyph streams falling through the body (the matrix look).
AURA.coderain = (r, g, b, x, y, t) => {
  const gx = Math.floor(x * 14);
  const ph = fract(y * 1.6 - t * (0.35 + h2(gx, 1) * 0.4) + h2(gx, 3));
  const bit = h2(gx, Math.floor(y * 30) + Math.floor(t * 7)) > 0.5 ? 1 : 0.25;
  const head = smooth(0.12, 0.0, ph);
  const trail = smooth(0.55, 0.05, ph) * 0.7;
  const k = (head + trail) * bit;
  const base = [r * 0.1, g * 0.2 + 0.03, b * 0.12];
  return [clamp(base[0] + head * 0.7), clamp(base[1] + k), clamp(base[2] + k * 0.4), 1];
};
// Honeycomb Plate: hexagonal armor plating with glowing seams.
AURA.honeyplate = (r, g, b, x, y, t) => {
  const s = 8 * FXSCALE;
  const qx = (x * s) / 1.5;
  const qy = y * s * 0.866 - qx * 0.5;
  const cx0 = Math.round(qx);
  const cy0 = Math.round(qy);
  const lx = (qx - cx0) * 1.5;
  const ly = (qy - cy0 + (qx - cx0) * 0.5) * 1.155;
  const d = Math.max(Math.abs(lx) * 0.866 + Math.abs(ly) * 0.5, Math.abs(ly));
  const seam = smooth(0.32, 0.42, d);
  const cellL = 0.85 + 0.3 * (h2(cx0, cy0) - 0.5);
  const glowP = 0.5 + 0.5 * Math.sin(t * 2 + h2(cx0, cy0) * 12);
  const body = [r * cellL, g * cellL, b * cellL];
  return [...mix3(body, [0.3 + glowP * 0.4, 0.9, 1.0], seam * 0.8), 1];
};
// Carbon Weave: the body's own colors over a fine fiber weave, with a moving sheen.
AURA.carbonweave = (r, g, b, x, y, t) => {
  const w = Math.sin(x * 80) * Math.sin(y * 80);
  const [h, s, v] = rgb2hsv(r, g, b);
  const base = hsv2rgb(h, clamp(s * 0.6), clamp(v * (0.55 + 0.22 * w) + 0.05));
  const sheen = Math.pow(Math.max(0, Math.sin((x + y) * 4 - t * 0.8)), 8) * 0.3;
  return [clamp(base[0] + sheen * 0.7), clamp(base[1] + sheen * 0.85), clamp(base[2] + sheen), 1];
};
// Brushed Metal: anisotropic horizontal grain + a sweeping specular band.
AURA.brushedmetal = (r, g, b, x, y, t) => {
  const grain = 0.85 + 0.3 * vnoise(x * 4, y * 60);
  const L = smooth(0.05, 0.95, luma(r, g, b));
  const spec = Math.pow(Math.max(0, Math.sin((x - y) * 3 - t * 0.7)), 14) * 0.5;
  const m = ramp(G.chrome, L);
  return [clamp(m[0] * grain + spec), clamp(m[1] * grain + spec), clamp(m[2] * grain + spec), 1];
};
// Lava Lamp: huge slow blobs drifting through the body in warm two-tone.
AURA.lavalamp = (r, g, b, x, y, t) => {
  const v = fbm(x * 2 + Math.sin(t * 0.2), y * 2 - t * 0.14);
  const blob = smooth(0.5, 0.62, v);
  const base = mix3([r, g, b], hx("2a0a3a"), 0.7);
  const goo = ramp(["ff3a6a", "ff8a2a", "ffd23a"].map(hx), fract(v * 2 + t * 0.05));
  return [...mix3(base, goo, blob * 0.9), 1];
};
// Soap Swirl: swirling thin-film pastels over a bright base.
AURA.soapswirl = (r, g, b, x, y, t) => {
  const w = fbm(x * 3 + Math.sin(t * 0.3) * 0.5, y * 3 + Math.cos(t * 0.25) * 0.5);
  const hue = fract(w * 1.6 + (x - y) * 0.25 + t * 0.04);
  const film = hsv2rgb(hue, 0.45, 1);
  const L = luma(r, g, b);
  return [...mix3([clamp(L + 0.35), clamp(L + 0.38), clamp(L + 0.42)], film, 0.55), 1];
};
// X-Ray: inverted translucent blues with hot rims and a faint scan (radiograph).
AURA.xray = (r, g, b, x, y, t, ctx) => {
  const inv = 1 - luma(r, g, b);
  const e = ctx?.e ?? 0;
  const rim = smooth(0.2, 0.85, e);
  const scan = 0.88 + 0.12 * Math.sin(y * 70 + t * 2);
  return [
    clamp((inv * 0.55 + rim * 0.6) * scan + 0.03),
    clamp((inv * 0.9 + rim * 0.72) * scan + 0.05),
    clamp((inv * 1.3 + rim * 0.85) * scan + 0.12),
    0.95,
  ];
};
// Blueprint Scan: the mon as a live technical drawing - flat drafting blue,
// white edge linework, a grid, and a bright scanline sweeping through.
AURA.blueprintscan = (r, g, b, x, y, t, ctx) => {
  const grid = (fract(x * 10) < 0.06 || fract(y * 10) < 0.06 ? 1 : 0) * 0.3;
  const sweep = Math.pow(Math.max(0, 1 - Math.abs(y - fract(t * 0.22)) * 9), 3) * 0.85;
  const e = ctx?.e ?? 0;
  const L = luma(r, g, b);
  const base = mix3(hx("143f85"), hx("2f6fc9"), L);
  const k = grid + sweep + smooth(0.3, 0.95, e) * 0.95;
  return [clamp(base[0] + k * 0.72), clamp(base[1] + k * 0.85), clamp(base[2] + k), 1];
};
// Knitted: the sprite re-knitted in chunky yarn - fat V stitches, row shadows.
AURA.stitchwork = (r, g, b, x, y) => {
  const s = 9;
  const ry = Math.floor(y * s);
  const phase = fract(x * s + (ry % 2) * 0.5);
  const fy2 = fract(y * s);
  const vshape = Math.abs(phase - 0.5) * 1.5 + Math.abs(fy2 - 0.5) * 0.5;
  const shade = 0.5 + 0.65 * Math.sin(clamp(1 - vshape) * Math.PI * 0.55 + fy2 * 0.9);
  const gap = smooth(0.5, 0.42, Math.abs(fy2 - 0.5));
  const [h, sat, v] = rgb2hsv(r, g, b);
  const c = hsv2rgb(h, clamp(sat * 1.15 + 0.08), Math.round(clamp(v) * 3) / 3);
  return [clamp(c[0] * shade * gap + 0.02), clamp(c[1] * shade * gap + 0.02), clamp(c[2] * shade * gap + 0.02), 1];
};
// Mosaic Tile: little ceramic tiles with grout and per-tile color jitter.
AURA.mosaictile = (r, g, b, x, y, t, ctx) => {
  const s = 11 * FXSCALE;
  const tx = Math.floor(x * s);
  const ty = Math.floor(y * s);
  const cs = ctx.sa((tx + 0.5) / s, (ty + 0.5) / s);
  const base = cs[3] > 0.02 ? [cs[0], cs[1], cs[2]] : [r, g, b];
  const jit = (h2(tx, ty) - 0.5) * 0.14;
  const gx = fract(x * s);
  const gy = fract(y * s);
  const grout = Math.min(gx, 1 - gx, gy, 1 - gy) < 0.07 ? 1 : 0;
  const c = grout ? [0.16, 0.15, 0.14] : base.map(v => clamp(v + jit));
  return [c[0], c[1], c[2], 1];
};
// Papercut: flat poster layers with an inner drop-shadow between them.
AURA.papercut = (r, g, b, x, y, t, ctx) => {
  const lvl = c2 => Math.round(smooth(0.05, 0.95, luma(c2[0], c2[1], c2[2])) * 3);
  const L0 = lvl([r, g, b]);
  const s2 = ctx.sa(x - 0.03, y - 0.03);
  const shadow = s2[3] > 0.5 && lvl(s2) > L0 ? 0.5 : 0;
  const [h, s] = rgb2hsv(r, g, b);
  const c = hsv2rgb(h, clamp(s * 0.9 + 0.08), 0.3 + (L0 / 3) * 0.68);
  return [clamp(c[0] * (1 - shadow)), clamp(c[1] * (1 - shadow)), clamp(c[2] * (1 - shadow)), 1];
};
// Ink Wash: sumi-e - soft gray washes, pigment pooling dark at the edges.
AURA.inkwash = (r, g, b, x, y, t, ctx) => {
  const L = luma(r, g, b);
  const wash = 0.25 + smooth(0.1, 0.9, L) * 0.7 + (fbm(x * 5, y * 5) - 0.5) * 0.12;
  const e = ctx?.e ?? 0;
  const pool = smooth(0.35, 1, e) * 0.4;
  const v = clamp(wash * (1 - pool) + 0.06);
  return [clamp(v * 1.02), clamp(v), clamp(v * 0.94), 1];
};
// Gold Leaf: patches of gold foil pressed over dark lacquer.
AURA.goldleaf = (r, g, b, x, y, t) => {
  const v = voro(x, y, 6);
  const L = luma(r, g, b);
  if (v.cell > 0.45) {
    const sheen = 0.5 + 0.5 * Math.sin((x + y) * 18 + v.cell * 30 + t * 0.6);
    return [...ramp(G.gold, clamp(L * 0.7 + sheen * 0.35)), 1];
  }
  return [...ramp(["120a08", "2a1a14", "4a3020"].map(hx), L), 1];
};
// Rust Creep: corrosion crusting upward from below.
AURA.rustcreep = (r, g, b, x, y, t) => {
  const n = fbm(x * 7, y * 7);
  const rust = smooth(0.45, 0.8, n * 0.6 + y * 0.7 - 0.15);
  const crust = ramp(["3a1a0a", "7a3a12", "b05a1e", "d88a3a"].map(hx), clamp(luma(r, g, b) * 0.6 + n * 0.5));
  const pit = vnoise(x * 40, y * 40) < 0.12 && rust > 0.5 ? 0 : 1;
  return [...mix3([r, g, b], crust, rust * 0.92), pit];
};
// Petrified: turned to granite - matte gray, speckle, hairline cracks.
AURA.petrified = (r, g, b, x, y) => {
  const L = luma(r, g, b);
  const speck = (vnoise(x * 50, y * 50) - 0.5) * 0.12;
  const n = fbm(x * 6, y * 6);
  const crack = smooth(0.9, 0.98, 1 - Math.abs(n - 0.5) * 2) * 0.4;
  const v = clamp(0.2 + L * 0.6 + speck - crack);
  return [v, clamp(v * 0.98), clamp(v * 0.94), 1];
};
// Slime Coat: translucent green goo oozing down with glossy highlights.
AURA.slimecoat = (r, g, b, x, y, t) => {
  const front = 0.28 + 0.45 * fbm(x * 6, 2.0) + 0.05 * Math.sin(t * 0.6 + x * 9);
  const cover = smooth(0.06, 0.0, y - front);
  const goo = mix3([r * 0.3, g * 0.8 + 0.15, b * 0.2], [0.5, 0.95, 0.25], 0.4);
  const gloss = Math.pow(Math.max(0, Math.sin(x * 30 + y * 14 + t)), 30) * cover;
  let c = mix3([r, g, b], goo, cover * 0.75);
  c = mix3(c, [0.95, 1, 0.85], smooth(0.04, 0.0, Math.abs(front - y)) * 0.8 + gloss);
  return [c[0], c[1], c[2], 1];
};
// Soul Siphon: glowing motes peel off the body and stream toward a point above.
AURA.bubblewrap = (r, g, b, x, y, t) => {
  const tx = 0.5;
  const ty = 0.04;
  const dx = tx - x;
  const dy = ty - y;
  const dist = Math.hypot(dx, dy) + 1e-4;
  const lane = Math.floor((Math.atan2(dy, dx) + Math.PI) * 15);
  if (h2(lane, 3) < 0.3) {
    const drain0 = 0.5 + 0.5 * Math.sin(dist * 8 - t * 2);
    return [clamp(r * 0.5), clamp(g * 0.55 + 0.02), clamp(b * 0.7 + 0.08 + drain0 * 0.04), 1];
  }
  const ph = fract(dist * 2.4 + t * (0.45 + h2(lane, 1) * 0.35));
  const dot = Math.pow(smooth(0.16, 0.0, Math.abs(ph - 0.5)), 2.2);
  const pinch = clamp(0.4 + dist * 1.4);
  const k = dot * pinch * (0.7 + 0.3 * Math.sin(t * 3 + lane));
  return [clamp(r * 0.5 + k * 0.5), clamp(g * 0.55 + 0.02 + k * 0.95), clamp(b * 0.7 + 0.08 + k * 1.35), 1];
};
// Candy Cane: bold diagonal red/white swirl stripes shaded by the sprite.
AURA.candycane = (r, g, b, x, y, t) => {
  const L = 0.35 + luma(r, g, b) * 0.75;
  const band = fract((x + y) * 3.5 + t * 0.08);
  const c = band < 0.5 ? [1.0, 0.16, 0.22] : [1.0, 0.97, 0.95];
  const soft = smooth(0.0, 0.06, Math.abs(band - 0.5)) * 0.15;
  return [clamp(c[0] * L + soft), clamp(c[1] * L + soft), clamp(c[2] * L + soft), 1];
};
// Ember Motes: the body cools to charcoal while burning motes drift up off it.
AURA.embermotes = (r, g, b, x, y, t) => {
  const L = luma(r, g, b);
  const body = [0.13 + L * 0.27, 0.1 + L * 0.19, 0.1 + L * 0.16];
  let k = 0;
  for (let layer = 0; layer < 2; layer++) {
    const cellN = 15 + layer * 9;
    const fy = y + t * (0.16 + layer * 0.09);
    const cx0 = Math.floor(x * cellN);
    const cy0 = Math.floor(fy * cellN);
    if (h2(cx0 * 1.3 + layer * 5, cy0 * 1.7) < 0.68) {
      continue;
    }
    const jx = h2(cx0 + 7, cy0) * 0.6 + 0.2;
    const jy = h2(cx0, cy0 + 3) * 0.6 + 0.2;
    const lx = fract(x * cellN) - jx + Math.sin(t * 3 + cy0) * 0.07;
    const ly = fract(fy * cellN) - jy;
    const dot = Math.pow(clamp(1 - Math.hypot(lx, ly) * (2.3 - layer * 0.5)), 2.2);
    const tw = 0.7 + 0.3 * Math.sin(t * 4 + h2(cy0, cx0) * 20);
    k = Math.max(k, dot * tw);
  }
  return [clamp(body[0] + k * 1.9), clamp(body[1] + k * 0.9), clamp(body[2] + k * 0.2), 1];
};
// Fairy Dust: fine multicolor sparkle dust drifting across a softly-lit body.
AURA.fairydust = (r, g, b, x, y, t) => {
  let k = 0;
  let hue = 0;
  for (let layer = 0; layer < 2; layer++) {
    const cellN = 18 + layer * 8;
    const fx0 = x - t * (0.09 + layer * 0.05);
    const fy = y + t * (0.06 + layer * 0.045) + Math.sin(x * 6 + t) * 0.02;
    const cx0 = Math.floor(fx0 * cellN);
    const cy0 = Math.floor(fy * cellN);
    if (h2(cx0 * 2.1 + layer * 3, cy0 * 1.3) < 0.52) {
      continue;
    }
    const jx = h2(cx0 + 5, cy0) * 0.6 + 0.2;
    const jy = h2(cx0, cy0 + 9) * 0.6 + 0.2;
    const lx = fract(fx0 * cellN) - jx;
    const ly = fract(fy * cellN) - jy;
    const tw = Math.pow(0.5 + 0.5 * Math.sin(t * 5 + h2(cy0, cx0) * 25), 2);
    const cross =
      (smooth(0.05, 0.01, Math.abs(lx)) + smooth(0.05, 0.01, Math.abs(ly))) * smooth(0.4, 0.08, Math.hypot(lx, ly)) * 0.6;
    const dot = (Math.pow(clamp(1 - Math.hypot(lx, ly) * 2.5), 2) + cross) * tw;
    if (dot > k) {
      k = dot;
      hue = fract(h2(cx0, cy0) + t * 0.05);
    }
  }
  const sp = hsv2rgb(hue, 0.6, 1);
  return [clamp(r + 0.05 + sp[0] * k * 1.7), clamp(g + 0.04 + sp[1] * k * 1.7), clamp(b + 0.09 + sp[2] * k * 1.7), 1];
};
// Glitter Storm: dense wind-driven glitter, every fleck its own color and twinkle.
AURA.glitterstorm = (r, g, b, x, y, t) => {
  let k = 0;
  let gate = 0;
  for (let layer = 0; layer < 2; layer++) {
    const cellN = 22 + layer * 9;
    const fx0 = x + Math.sin(y * 8 + t * 1.5 + layer) * 0.02;
    const fy = y + t * (0.1 + layer * 0.06);
    const cx0 = Math.floor(fx0 * cellN);
    const cy0 = Math.floor(fy * cellN);
    const g0 = h2(cx0 * 1.3 + layer * 11, cy0 * 2.1);
    if (g0 < 0.38) {
      continue;
    }
    const tw = Math.pow(0.5 + 0.5 * Math.sin(t * 6 + g0 * 30), 3);
    const lx = fract(fx0 * cellN) - 0.5;
    const ly = fract(fy * cellN) - 0.5;
    const fleck = Math.pow(clamp(1 - (Math.abs(lx) + Math.abs(ly)) * 1.9), 2) * tw;
    if (fleck > k) {
      k = fleck;
      gate = g0;
    }
  }
  const col = hsv2rgb(fract(gate * 7), 0.75, 1);
  const deep = [r * 0.55, g * 0.55, b * 0.7];
  return [clamp(deep[0] + col[0] * k * 1.8), clamp(deep[1] + col[1] * k * 1.8), clamp(deep[2] + col[2] * k * 1.8), 1];
};
// Firefly Glade: a dusk-dark body where green motes wander and pulse.
AURA.fireflyglade = (r, g, b, x, y, t) => {
  const body = [r * 0.22, g * 0.28 + 0.02, b * 0.32 + 0.05];
  let k = 0;
  for (let i = 0; i < 2; i++) {
    const cellN = 8 + i * 5;
    const fx0 = x + Math.sin(t * (0.5 + i * 0.2) + y * 5 + i * 3) * 0.06;
    const fy = y + Math.cos(t * (0.4 + i * 0.15) + x * 4) * 0.05;
    const cx0 = Math.floor(fx0 * cellN);
    const cy0 = Math.floor(fy * cellN);
    if (h2(cx0 * 1.9 + i, cy0 * 1.3) < 0.76) {
      continue;
    }
    const lx = fract(fx0 * cellN) - 0.5;
    const ly = fract(fy * cellN) - 0.5;
    const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * 2.5 + h2(cy0, cx0) * 20), 6);
    k = Math.max(k, Math.pow(clamp(1 - Math.hypot(lx, ly) * 2.4), 3) * pulse);
  }
  return [clamp(body[0] + k * 0.6), clamp(body[1] + k * 1.3), clamp(body[2] + k * 0.35), 1];
};
// Starfall: bright shooting stars raking diagonally across a dimmed body.
// ph must ADVANCE with t (+t): head at ph=0 slides down-left, trail (ph>0) sits
// up-right BEHIND it. With -t the head climbed and the trail led the motion.
AURA.starfall = (r, g, b, x, y, t) => {
  const lane = Math.floor((x + y) * 6);
  const across = Math.abs(fract((x + y) * 6) - 0.5);
  const w = smooth(0.38, 0.06, across);
  const ph = fract((x - y) * 1.1 + t * (0.45 + h2(lane, 1) * 0.3) + h2(lane, 2));
  const head = Math.pow(smooth(0.1, 0.0, ph), 2) * 1.5;
  const trail = smooth(0.45, 0.02, ph) * 0.75;
  const gate = h2(lane, 5) > 0.25 ? 1 : 0;
  const k = (head + trail) * gate * w;
  return [clamp(r * 0.55 + k), clamp(g * 0.6 + k * 0.95), clamp(b * 0.75 + k * 0.8), 1];
};
// shared by the Astral forms: linework strength via local luma contrast - a pixel
// darker than its 4 neighbors is line art, whatever the sprite's overall brightness.
// Also returns the "next to a line" signal (pixel brighter than its neighbors) used
// for the glow halo. One neighbor loop serves both.
const _lineContrast = (x, y, L, ctx) => {
  if (!ctx?.sa) {
    return { line: smooth(0.3, 0.16, L), near: 0 };
  }
  const stx = 1 / (ctx.W || 96);
  const sty = 1 / (ctx.H || 96);
  let nsum = 0;
  let nc = 0;
  for (const [ox, oy] of [[stx, 0], [-stx, 0], [0, sty], [0, -sty]]) {
    const s = ctx.sa(x + ox, y + oy);
    if (s[3] > 0.02) {
      nsum += luma(s[0], s[1], s[2]);
      nc++;
    }
  }
  if (nc === 0) {
    return { line: 0, near: 0 };
  }
  const d = nsum / nc - L;
  return { line: smooth(0.02, 0.07, d), near: smooth(0.03, 0.1, -d) };
};
// Astral Form: the living-constellation star chart. Flat, deep night-sky body;
// the sprite's OWN linework stays fully lit as pale connecting lines (local-contrast
// detection, so it follows any sprite's shape), and BIG glowing constellation stars
// - solid core, soft halo, 4-point flare - sit anchored on those lines, joined to
// each other by the linework. A shimmer travels along the lines.
AURA.astral = (r, g, b, x, y, t, ctx) => {
  const L = luma(r, g, b);
  const e = ctx?.e ?? 0;
  // flat deep body with big soft nebula patches
  const neb = fbm(x * 2.6 + 7 + t * 0.03, y * 2.6 - t * 0.02);
  const body = mix3(hx("090f22"), hx("1d2b4d"), clamp(L * 0.4 + smooth(0.35, 0.85, neb) * 0.45));
  // scattered body stars: small soft glowing dots (bigger than single pixels).
  // FXSEED reshuffles the star map, FXSCALE (texture-noise slider) sets density.
  let tw = 0;
  const SCELL = 26 * FXSCALE;
  const bx = Math.floor(x * SCELL);
  const by = Math.floor(y * SCELL);
  if (h2(bx + FXSEED, by - FXSEED * 1.7) > 0.975) {
    const axs = (bx + 0.25 + h2(bx + 7 + FXSEED, by) * 0.5) / SCELL;
    const ays = (by + 0.25 + h2(by + 9, bx + FXSEED) * 0.5) / SCELL;
    const ds = Math.hypot(x - axs, y - ays);
    tw = smooth(0.013, 0.003, ds) * Math.pow(0.5 + 0.5 * Math.sin(t * 1.8 + h2(by, bx) * 25), 2);
  }
  // connecting lines: full linework, always lit but DIMMER than the stars, with a
  // shimmer sliding along it - these are the strands joining the stars together
  const { line, near } = _lineContrast(x, y, L, ctx);
  const shim = 0.75 + 0.25 * Math.sin((x + y) * 30 - t * 2.5);
  const constel = line * shim * 0.6;
  const halo = near * 0.12;
  // BIG constellation stars anchored ON the linework: solid round core + soft glow
  // + a 4-point flare, pulsing slowly. Two anchor candidates per cell; every
  // candidate that lands on a line becomes a star, so the constellation actually
  // populates. The star is round and overflows the thin line it decorates.
  let node = 0;
  const NCELL = 13 * FXSCALE;
  const gx = Math.floor(x * NCELL);
  const gy = Math.floor(y * NCELL);
  if (ctx?.sa && h2(gx * 1.7 + 2 + FXSEED, gy * 1.3 + 5 - FXSEED) > 0.35) {
    const R = 0.028;
    for (let k = 0; k < 2; k++) {
      const ax = (gx + 0.2 + h2(gx + k * 11 + FXSEED, gy) * 0.6) / NCELL;
      const ay = (gy + 0.2 + h2(gy + 3, gx + k * 17 + FXSEED) * 0.6) / NCELL;
      const d = Math.hypot(x - ax, y - ay);
      if (d >= R * 2.8) {
        continue;
      }
      const sA = ctx.sa(ax, ay);
      if (sA[3] <= 0.02 || _lineContrast(ax, ay, luma(sA[0], sA[1], sA[2]), ctx).line <= 0.25) {
        continue;
      }
      const pulse = 0.8 + 0.2 * Math.sin(t * 2 + h2(gy + k, gx) * 20);
      const core = smooth(R * 0.65, R * 0.15, d);
      const glow = smooth(R * 2.6, R * 0.4, d) * 0.42;
      const flare =
        Math.max(smooth(0.007, 0.0015, Math.abs(x - ax)), smooth(0.007, 0.0015, Math.abs(y - ay))) *
        smooth(R * 2.8, R * 0.5, d) *
        0.6;
      node = Math.max(node, (core + glow + flare) * pulse);
    }
  }
  const rim = smooth(0.35, 1, e) * 0.12;
  let c = mix3(body, hx("b6c8ec"), clamp(constel));
  const boost = constel * 0.15 + halo + tw + rim;
  c = [clamp(c[0] + boost * 0.72), clamp(c[1] + boost * 0.84), clamp(c[2] + boost)];
  // stars snap toward pure starlight on top of everything
  c = mix3(c, [0.96, 0.99, 1], clamp(node));
  return [c[0], c[1], c[2], 1];
};
// Smolder: charcoal body, embers gnawing hot at the silhouette, sparks rising.
AURA.smolder = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const L = luma(r, g, b);
  const ash = [0.1 + L * 0.22, 0.09 + L * 0.2, 0.1 + L * 0.2];
  const gnaw = smooth(0.3, 1, e) * (0.45 + 0.55 * fbm(x * 9, y * 9 + t * 0.8));
  const ember = ramp(["3a0a00", "a02a06", "ff7a1a", "ffd23a"].map(hx), clamp(gnaw * 1.3));
  const spark = h2(Math.floor(x * 36), Math.floor((y + t * 0.12) * 36)) > 0.96 && e > 0.25 ? 0.85 : 0;
  const c = mix3(ash, ember, clamp(gnaw * 1.6));
  return [clamp(c[0] + spark), clamp(c[1] + spark * 0.55), clamp(c[2] + spark * 0.15), 1];
};
// Frost Core: ice crystallizing outward from the heart of the body.
AURA.frostcore = (r, g, b, x, y, t) => {
  const rr = Math.hypot(x - 0.5, y - 0.52);
  const core = smooth(0.5, 0.12, rr + (fbm(x * 8, y * 8) - 0.5) * 0.2);
  const ice = mix3([r * 0.75, g * 0.88, b], [0.9, 0.97, 1.0], clamp(core * 0.8 + vnoise(x * 24, y * 24) * 0.25 * core));
  const gl = Math.pow(Math.max(0, Math.sin(rr * 30 - t * 1.5)), 8) * core * 0.3;
  return [clamp(ice[0] + gl), clamp(ice[1] + gl), clamp(ice[2] + gl), 1];
};
// Shockwave: a hot refraction ring punches outward from the center.
AURA.shockwave = (r, g, b, x, y, t, ctx) => {
  const rr = Math.hypot(x - 0.5, y - 0.5) + 1e-4;
  const front = fract(t * 0.45) * 0.75;
  const d = rr - front;
  const k = Math.exp(-Math.abs(d) * 20) * 0.09;
  const s2 = ctx.sa(x + ((x - 0.5) / rr) * k, y + ((y - 0.5) / rr) * k);
  const ring = Math.exp(-Math.abs(d) * 22) * (1 - front) * 1.1;
  const c = s2[3] > 0.02 ? [s2[0], s2[1], s2[2]] : [r, g, b];
  return [clamp(c[0] + ring * 1.1), clamp(c[1] + ring * 0.85), clamp(c[2] + ring * 0.55), 1];
};
// Runic Etch: a few LARGE glowing sigils carved into the body, breathing light.
AURA.runes = (r, g, b, x, y, t) => {
  const s = 3.2 * FXSCALE;
  const gx = Math.floor(x * s + FXSEED);
  const gy = Math.floor(y * s + FXSEED * 1.3);
  const lx = (fract(x * s + FXSEED) - 0.5) * 2;
  const ly = (fract(y * s + FXSEED * 1.3) - 0.5) * 2;
  const id = h2(gx * 1.7, gy * 2.3);
  const base = [r * 0.5, g * 0.5, b * 0.6];
  if (id < 0.35) {
    return [base[0], base[1], base[2], 1];
  }
  const inBox = smooth(0.8, 0.6, Math.abs(lx)) * smooth(0.8, 0.6, Math.abs(ly));
  let st = smooth(0.16, 0.05, Math.abs(lx));
  st = Math.max(st, smooth(0.14, 0.04, Math.abs(ly - (id - 0.5) * 0.8)));
  if (id > 0.6) {
    st = Math.max(st, smooth(0.14, 0.04, Math.abs(ly - lx * (id > 0.8 ? 0.8 : -0.8))));
  }
  const glyph = st * inBox;
  const pulse = 0.55 + 0.45 * Math.sin(t * 2.2 + id * 19);
  return [
    clamp(base[0] + glyph * 0.45 * pulse),
    clamp(base[1] + glyph * 1.15 * pulse),
    clamp(base[2] + glyph * 1.05 * pulse),
    1,
  ];
};
// Static Charge: hard crackling arcs racing along the silhouette, with surges.
AURA.staticcharge = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const rim = smooth(0.18, 0.8, e);
  const s = Math.pow(Math.max(0, Math.sin(x * 30 + y * 26 + t * 22 + h2(Math.floor(t * 16), 2) * 25)), 12);
  const gate = h2(Math.floor(t * 10), Math.floor(x * 12) + Math.floor(y * 9)) > 0.3 ? 1 : 0.1;
  const surge = h2(Math.floor(t * 4), 7) > 0.86 ? rim * 0.7 : 0;
  const k = clamp(rim * s * gate * 1.7 + surge);
  return [clamp(r + k * 0.75), clamp(g + k * 0.95), clamp(b + k * 1.4), 1];
};
// CMYK Print: misregistered process-ink halftone (subtractive print look).
AURA.cmykprint = (r, g, b, x, y, t, ctx) => {
  const inks = [
    [0.012, 0.0, [0, 1, 1]],
    [-0.008, 0.008, [1, 0, 1]],
    [0.0, -0.012, [1, 1, 0]],
  ];
  let out = [0.96, 0.95, 0.92];
  for (let i = 0; i < 3; i++) {
    const s2 = ctx.sa(x + inks[i][0], y + inks[i][1]);
    const src = s2[3] > 0.02 ? s2 : [r, g, b, 1];
    const amt = 1 - src[i];
    const sscale = 9 + i;
    const dx = fract(x * sscale + i * 0.33) - 0.5;
    const dy = fract(y * sscale + i * 0.21) - 0.5;
    const dot = Math.hypot(dx, dy) < amt * 0.58 ? 1 : 0;
    if (dot) {
      out = [out[0] * (0.15 + inks[i][2][0] * 0.85), out[1] * (0.15 + inks[i][2][1] * 0.85), out[2] * (0.15 + inks[i][2][2] * 0.85)];
    }
  }
  return [out[0], out[1], out[2], 1];
};
// Binary Body: the mon rendered as scrolling 0s and 1s.
AURA.binarybody = (r, g, b, x, y, t) => {
  const gx = Math.floor(x * 13);
  const gy = Math.floor(y * 18 + t * (0.5 + h2(gx, 7)));
  const one = h2(gx, gy) > 0.5;
  const lx = fract(x * 13) - 0.5;
  const ly = fract(y * 18 + t * (0.5 + h2(gx, 7))) - 0.5;
  const glyph = one ? (Math.abs(lx) < 0.12 && Math.abs(ly) < 0.32 ? 1 : 0) : Math.abs(Math.hypot(lx * 1.4, ly) - 0.26) < 0.09 ? 1 : 0;
  const L = luma(r, g, b);
  const k = glyph * (0.35 + L * 0.75);
  return [0.02 + k * 0.3, 0.05 + k, 0.1 + k * 0.5, 1];
};
// Origami: folded-paper facets, each triangle flat-shaded.
AURA.origami = (r, g, b, x, y, t, ctx) => {
  const s = 5;
  const gx = Math.floor(x * s);
  const gy = Math.floor(y * s);
  const upper = fract(x * s) + fract(y * s) < 1 ? 0 : 1;
  const cs = ctx.sa((gx + (upper ? 0.7 : 0.3)) / s, (gy + (upper ? 0.7 : 0.3)) / s);
  const base = cs[3] > 0.02 ? [cs[0], cs[1], cs[2]] : [r, g, b];
  const shade = 0.8 + 0.35 * h2(gx * 2 + upper, gy * 3);
  const foldd = Math.min(fract(x * s), 1 - fract(x * s), fract(y * s), 1 - fract(y * s), Math.abs(fract(x * s) + fract(y * s) - 1) * 0.7);
  const line = smooth(0.05, 0.0, foldd) * 0.25;
  return [clamp(base[0] * shade - line), clamp(base[1] * shade - line), clamp(base[2] * shade - line), 1];
};
// Crackle Glaze: fired-ceramic hairline crackle + a soft glaze sheen.
AURA.crackleglaze = (r, g, b, x, y, t) => {
  const v = voro(x, y, 15);
  const line = smooth(0.02, 0.0, v.border) * 0.35;
  const sheen = Math.pow(Math.max(0, Math.sin((x - y) * 5 + t * 0.5)), 6) * 0.15;
  const c = mix3([r, g, b], [0.94, 0.96, 0.97], 0.22);
  return [clamp(c[0] - line + sheen), clamp(c[1] - line + sheen), clamp(c[2] - line + sheen), 1];
};
// Kintsugi: thick molten-gold seams repair the body's fractures, glowing softly.
AURA.kintsugi = (r, g, b, x, y, t) => {
  const v = voro(x, y, 5.5);
  const seam = smooth(0.06, 0.0, v.border);
  const halo = smooth(0.16, 0.03, v.border) * 0.3;
  const gold = ramp(G.gold, 0.62 + 0.32 * Math.sin(t * 1.5 + v.cell * 10 + (x + y) * 6));
  const c = mix3([r, g, b], gold, clamp(seam * 1.2));
  return [clamp(c[0] + halo * gold[0]), clamp(c[1] + halo * gold[1]), clamp(c[2] + halo * gold[2] * 0.5), 1];
};
// Active Camo: bold drifting camouflage blotches that never sit still.
AURA.activecamo = (r, g, b, x, y, t) => {
  const v = fbm(x * 2.4 + t * 0.09, y * 2.4 - t * 0.06);
  const tone = ramp(["161c0c", "3a521c", "7a8a2e", "d8d29a"].map(hx), Math.floor(clamp(v * 1.15) * 3.99) / 3);
  const L = 0.45 + luma(r, g, b) * 0.85;
  return [clamp(tone[0] * L), clamp(tone[1] * L), clamp(tone[2] * L), 1];
};
// Watercolor: wet pigment mottling, colors pooling darker at the edges.
AURA.watercolor = (r, g, b, x, y, t, ctx) => {
  const pig = fbm(x * 5 + 7, y * 5);
  const [h, s, v] = rgb2hsv(r, g, b);
  let c = hsv2rgb(h, clamp(s * 0.8), clamp(v * (0.85 + (pig - 0.5) * 0.5) + 0.12));
  const e = ctx?.e ?? 0;
  c = c.map(vv => clamp(vv * (1 - smooth(0.35, 1, e) * 0.3)));
  return [...mix3(c, [0.98, 0.96, 0.9], 0.12), 1];
};
// Spirit Flame: cold blue fire licking hard off the top of the silhouette.
AURA.spiritflame = (r, g, b, x, y, t, ctx) => {
  const open1 = ctx.sa(x, y - 0.05)[3] < 0.4 ? 1 : 0;
  const open2 = ctx.sa(x, y - 0.11)[3] < 0.4 ? 0.55 : 0;
  const open = Math.max(open1, open2);
  const n = fbm(x * 8, y * 6 - t * 2.2);
  const lick = open * smooth(0.22, 0.68, n) * 1.4;
  return [clamp(r * (1 - lick * 0.3) + lick * 0.18), clamp(g + lick * 0.75), clamp(b + lick * 1.5), 1];
};
// Data Corruption: whole blocks of the sprite swap and solarize.
AURA.datacorrupt = (r, g, b, x, y, t, ctx) => {
  const bx = Math.floor(x * 7);
  const by = Math.floor(y * 7);
  const slot = Math.floor(t * 1.6);
  if (h2(bx * 1.3 + slot, by * 1.7) > 0.78) {
    const s2 = ctx.sa(fract(x + h2(bx, by + slot) * 0.6), fract(y + h2(by, bx + slot) * 0.6));
    const c = s2[3] > 0.02 ? [s2[0], s2[1], s2[2]] : [1 - r, 1 - g, 1 - b];
    return [c[0], c[1], c[2], 1];
  }
  return [r, g, b, 1];
};
// Double Exposure: a hue-shifted luminous ghost of the mon orbits over itself.
AURA.doubleexposure = (r, g, b, x, y, t, ctx) => {
  const s2 = ctx.sa(x + 0.07 * Math.sin(t * 0.6), y + 0.05 * Math.cos(t * 0.45));
  if (s2[3] < 0.4) {
    return [r, g, b, 1];
  }
  const [h, s, v] = rgb2hsv(s2[0], s2[1], s2[2]);
  const gc = hsv2rgb(fract(h + 0.45), clamp(s + 0.2), v);
  return [
    1 - (1 - r) * (1 - gc[0] * 0.75),
    1 - (1 - g) * (1 - gc[1] * 0.75),
    1 - (1 - b) * (1 - gc[2] * 0.75),
    1,
  ];
};
// Paper Burn: a smoldering char front eats across the sprite and resets.
AURA.paperburn = (r, g, b, x, y, t) => {
  const prog = (x + y) * 0.5 + (fbm(x * 5, y * 5) - 0.5) * 0.25;
  const front = fract(t * 0.14) * 1.5 - 0.2;
  const d = prog - front;
  if (d > 0.04) {
    return [r, g, b, 1];
  }
  if (d > -0.04) {
    const gl = smooth(0.04, 0.0, Math.abs(d));
    return [clamp(r + gl), clamp(g + gl * 0.5 - 0.1), clamp(b - 0.2), 1];
  }
  const holes = vnoise(x * 30, y * 30) < 0.2 ? 0 : 1;
  return [0.09, 0.08, 0.08, holes * 0.95];
};
// Overgrowth: moss creeping up the body, dotted with tiny blossoms.
AURA.mossgrow = (r, g, b, x, y, t) => {
  const n = fbm(x * 8, y * 8);
  const reg = smooth(0.35, 0.85, y + (n - 0.5) * 0.4);
  const moss = ramp(["1a2e10", "2e5a1c", "4a8a2e"].map(hx), clamp(luma(r, g, b) * 0.8 + n * 0.3));
  const flower = vnoise(x * 34, y * 34) > 0.93 && reg > 0.5 ? 1 : 0;
  let c = mix3([r, g, b], moss, reg * 0.85);
  c = mix3(c, [1, 0.8, 0.9], flower * 0.9);
  return [c[0], c[1], c[2], 1];
};
// Gem Plate: large faceted jewels armor the body - deep tones, hard facet glints.
AURA.gemplate = (r, g, b, x, y, t) => {
  const v = voro(x, y, 4.5);
  const hue = fract(v.cell * 5.3);
  const depth = smooth(0.0, 0.55, v.d1);
  const jewel = hsv2rgb(hue, 0.85, clamp(0.92 - depth * 0.55) * (0.4 + luma(r, g, b) * 0.8));
  const facet = Math.pow(Math.max(0, Math.sin((x * 0.7 - y) * 30 + v.cell * 40)), 16) * smooth(0.45, 0.1, v.d1) * 0.55;
  const border = smooth(0.05, 0.015, v.border);
  const spark = Math.pow(Math.max(0, Math.sin(t * 2.5 + v.cell * 30)), 30) * smooth(0.28, 0.03, v.d1) * 0.9;
  const c = mix3(jewel, [0.05, 0.045, 0.09], border);
  return [clamp(c[0] + facet + spark), clamp(c[1] + facet + spark), clamp(c[2] + facet * 0.9 + spark), 1];
};
// Tie-Dye: a psychedelic hue spiral twisting out from the center.
AURA.tiedye = (r, g, b, x, y, t) => {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const ang = Math.atan2(dy, dx) + Math.hypot(dx, dy) * 7 - t * 0.15;
  const hue = fract((Math.floor((ang / (Math.PI * 2)) * 6 + 6) % 6) / 6);
  const c = hsv2rgb(hue, 0.7, clamp(0.5 + luma(r, g, b) * 0.6));
  return [...mix3([r, g, b], c, 0.8), 1];
};
// Checker Flip: checkerboard tiles flip to the complement in traveling waves.
AURA.checkerflip = (r, g, b, x, y, t) => {
  const cx0 = Math.floor(x * 9);
  const cy0 = Math.floor(y * 9);
  const flip = Math.sin(t * 2.5 - (cx0 + cy0) * 0.55) > 0 !== ((cx0 + cy0) % 2 === 0);
  if (!flip) {
    return [r, g, b, 1];
  }
  const [h, s, v] = rgb2hsv(r, g, b);
  return [...hsv2rgb(fract(h + 0.5), clamp(s + 0.15), v), 1];
};
// Polka Dot: bold complementary dots stamped over the body.
AURA.polkadot = (r, g, b, x, y) => {
  const s = 8;
  const lx = fract(x * s + (Math.floor(y * s) % 2) * 0.5) - 0.5;
  const ly = fract(y * s) - 0.5;
  const dot = smooth(0.3, 0.24, Math.hypot(lx, ly));
  const [h, sa2, v] = rgb2hsv(r, g, b);
  const dc = hsv2rgb(fract(h + 0.5), clamp(sa2 * 0.8 + 0.3), clamp(v * 0.9 + 0.2));
  return [...mix3([r, g, b], dc, dot), 1];
};
// Graffiti: hard stencil colors, dark overspray at the edges, neon paint runs.
AURA.graffiti = (r, g, b, x, y, t, ctx) => {
  const [h, s, v] = rgb2hsv(r, g, b);
  let c = hsv2rgb(h, clamp(s * 1.5 + 0.15), 0.22 + (Math.round(smooth(0.05, 0.95, v) * 2) / 2) * 0.75);
  const col = Math.floor(x * 16);
  const start = h2(col, 6) * 0.45;
  const len = 0.18 + h2(col, 9) * 0.35 * (0.7 + 0.3 * Math.sin(t * 0.7 + col));
  const inDrip = h2(col, 4) > 0.6 && y > start && y < start + len && Math.abs(fract(x * 16) - 0.5) < 0.22;
  if (inDrip) {
    const accent = hsv2rgb(fract(0.3 + h2(col, 2) * 0.25), 0.95, 1);
    const tip = y > start + len - 0.06 ? 1 : 0.8;
    c = mix3(c, accent, tip);
  }
  const e = ctx?.e ?? 0;
  const spray = smooth(0.3, 0.85, e) * (vnoise(x * 50, y * 50) > 0.55 ? 0.6 : 0);
  c = mix3(c, [0.04, 0.04, 0.07], spray);
  return [c[0], c[1], c[2], 1];
};
// Inner Storm: thunderclouds churn inside the silhouette, lightning included.
AURA.innerstorm = (r, g, b, x, y, t) => {
  const cloud = fbm(x * 4 + t * 0.1, y * 4 - t * 0.05);
  let c = mix3([r * 0.25, g * 0.28, b * 0.38], [0.5, 0.55, 0.68], smooth(0.35, 0.75, cloud));
  const flash = h2(Math.floor(t * 2.6), 5) > 0.82 ? smooth(0.5, 0.85, fbm(x * 3 + 9, y * 3)) : 0;
  c = mix3(c, [0.95, 0.97, 1.0], flash * 0.9);
  return [c[0], c[1], c[2], 1];
};
// Meltdown: the sprite visibly sags and runs like heated wax, with a glossy sheen.
AURA.meltdown = (r, g, b, x, y, t, ctx) => {
  const wave = fbm(x * 5.5, 2.4);
  const sag = smooth(0.08, 1, y) * (0.55 + 0.35 * Math.sin(t * 0.55)) * 0.55 * wave;
  const s2 = ctx.sa(x + Math.sin(y * 14 + t) * 0.012 * sag * 10, y - sag);
  if (s2[3] < 0.02) {
    return [r, g, b, 0];
  }
  const gloss = Math.pow(Math.max(0, Math.sin(x * 24 + y * 10 - t * 1.2)), 18) * clamp(sag * 8) * 0.5;
  return [clamp(s2[0] * 1.04 + gloss), clamp(s2[1] + gloss), clamp(s2[2] * 0.94 + gloss), 1];
};
// Sequins: flip-disc shimmer waving across the body in two tones.
AURA.sequins = (r, g, b, x, y, t) => {
  const s = 13;
  const gx = Math.floor(x * s);
  const gy = Math.floor(y * s);
  const lx = fract(x * s) - 0.5;
  const ly = fract(y * s) - 0.5;
  if (Math.hypot(lx, ly) > 0.44) {
    return [r * 0.5, g * 0.5, b * 0.55, 1];
  }
  const wave = Math.sin(t * 3 - (gx + gy) * 0.55);
  const [h, sat, v] = rgb2hsv(r, g, b);
  const c = wave > 0 ? hsv2rgb(h, clamp(sat + 0.2), clamp(v * 1.25 + 0.12)) : hsv2rgb(fract(h + 0.12), clamp(sat + 0.1), clamp(v * 0.7));
  const spec = smooth(0.2, 0.02, Math.hypot(lx + 0.1, ly + 0.1)) * Math.max(0, wave) * 0.5;
  return [clamp(c[0] + spec), clamp(c[1] + spec), clamp(c[2] + spec), 1];
};
// TV Bars: SMPTE color bars scrolling through the body.
AURA.tvbars = (r, g, b, x, y, t) => {
  const bars = [
    [0.75, 0.75, 0.75],
    [0.75, 0.75, 0.0],
    [0.0, 0.75, 0.75],
    [0.0, 0.75, 0.0],
    [0.75, 0.0, 0.75],
    [0.75, 0.0, 0.0],
    [0.0, 0.0, 0.75],
  ];
  const bar = bars[Math.floor(fract(x + t * 0.05) * 7)];
  const L = 0.35 + luma(r, g, b) * 0.8;
  return [clamp(bar[0] * L + 0.08), clamp(bar[1] * L + 0.08), clamp(bar[2] * L + 0.08), 1];
};
// Reveal Scan: the mon hides as a dark silhouette; a scanline unveils it.
AURA.revealscan = (r, g, b, x, y, t) => {
  const band = fract(t * 0.28);
  const d = x - band;
  const inband = smooth(0.09, 0.0, Math.abs(d));
  const wake = d < 0 ? smooth(0.4, 0.0, -d) * 0.6 : 0;
  const darkc = [r * 0.08 + 0.02, g * 0.1 + 0.03, b * 0.16 + 0.07];
  const k = clamp(inband * 1.2 + wake);
  return [
    clamp(mix(darkc[0], r * 1.15, k) + inband * 0.2),
    clamp(mix(darkc[1], g * 1.15, k) + inband * 0.3),
    clamp(mix(darkc[2], b * 1.15, k) + inband * 0.4),
    1,
  ];
};
// Spotlight: a roving stage light picks out part of the mon.
AURA.spotlight = (r, g, b, x, y, t) => {
  const cx0 = 0.5 + 0.32 * Math.sin(t * 0.7);
  const cy0 = 0.42 + 0.25 * Math.cos(t * 0.55);
  const lit = smooth(0.4, 0.12, Math.hypot(x - cx0, y - cy0));
  return [clamp(r * (0.12 + 1.15 * lit) + lit * 0.08), clamp(g * (0.12 + 1.12 * lit) + lit * 0.07), clamp(b * (0.12 + 1.05 * lit) + lit * 0.04), 1];
};
// Demake: chunky low-res pixels quantized to a tiny console palette.
AURA.demake = (r, g, b, x, y, t, ctx) => {
  const s = 22;
  const s2 = ctx.sa((Math.floor(x * s) + 0.5) / s, (Math.floor(y * s) + 0.5) / s);
  const src = s2[3] > 0.02 ? s2 : [r, g, b, 1];
  const pal = ["000000", "5a5a8a", "3a7a3a", "b04a3a", "d8a038", "6a9ad8", "e8e0d0", "ffffff"].map(hx);
  let bi = 0;
  let bd = 9;
  for (let i = 0; i < pal.length; i++) {
    const d = (src[0] - pal[i][0]) ** 2 + (src[1] - pal[i][1]) ** 2 + (src[2] - pal[i][2]) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return [pal[bi][0], pal[bi][1], pal[bi][2], s2[3] > 0.02 ? 1 : 0];
};
// Gen 1: the mon as a Red/Blue sprite - chunky half-res pixels with hard alpha,
// GREYSCALE 4-tone biased bright (Gen 1 bodies are mostly white/light grey),
// heavy BLACK linework (silhouette outline + the sprite's own internal line art,
// found by local contrast), and selective checkerboard dithering on midtones.
// Texture-noise slider = chunk size; FX color modes re-tint the ramp (Super Game
// Boy / DMG-green style).
AURA.genone = (r, g, b, x, y, t, ctx) => {
  const s = Math.max(16, Math.round(44 / (FXSCALE || 1)));
  const cxq = Math.floor(x * s);
  const cyq = Math.floor(y * s);
  const px2 = (cxq + 0.5) / s;
  const py2 = (cyq + 0.5) / s;
  const s2 = ctx?.sa ? ctx.sa(px2, py2) : [r, g, b, 1];
  if (s2[3] <= 0.4) {
    return [0, 0, 0, 0]; // hard pixel alpha - no soft edges on a Game Boy
  }
  const GB = ["101010", "5a5a5a", "aaaaaa", "f8f8f8"].map(hx);
  const Lc = luma(s2[0], s2[1], s2[2]);
  if (ctx?.sa) {
    // silhouette outline: any chunk bordering transparency goes black
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (ctx.sa((cxq + ox + 0.5) / s, (cyq + oy + 0.5) / s)[3] <= 0.4) {
        return [GB[0][0], GB[0][1], GB[0][2], 1];
      }
    }
    // internal line art: the sprite's own linework (darker than its surroundings)
    // re-inks in black - this is what makes it read as a drawn Gen 1 sprite
    if (_lineContrast(px2, py2, Lc, ctx).line > 0.35) {
      return [GB[0][0], GB[0][1], GB[0][2], 1];
    }
  }
  // bright-biased 4 tones (Gen 1 bodies are mostly the two light shades);
  // genuine midtones get the classic 50% checkerboard dither, flats stay flat
  const v = clamp(Math.pow(Lc, 0.62) * 3.6 - 0.25, 0, 3);
  const base = Math.floor(v);
  const frac = v - base;
  let lvl = frac > 0.35 && frac < 0.65 ? base + ((cxq + cyq) & 1) : Math.round(v);
  lvl = Math.max(0, Math.min(3, lvl));
  return [GB[lvl][0], GB[lvl][1], GB[lvl][2], 1];
};
// Marching Ants: an animated dashed selection crawling along the outline.
AURA.marchingants = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const rim = smooth(0.5, 0.95, e);
  const dash = fract((x + y) * 22 - t * 1.6) < 0.5 ? 1 : 0;
  const k = rim * dash;
  return [clamp(r * 0.92 + k), clamp(g * 0.92 + k), clamp(b * 0.92 + k * 0.4), 1];
};
// Phosphor: glow-in-the-dark - the bright parts breathe radioactive green.
AURA.phosphor = (r, g, b, x, y, t) => {
  const L = luma(r, g, b);
  const glow = smooth(0.45, 0.9, L) * (0.55 + 0.45 * Math.sin(t * 1.1 + L * 6));
  const base = [r * 0.16, g * 0.2, b * 0.3];
  return [clamp(base[0] + glow * 0.25), clamp(base[1] + glow), clamp(base[2] + glow * 0.45), 1];
};

// --- v8 exotic batch (surface) ---
// Aquarium: the body becomes a backlit tank - deep graded water, drifting god-ray
// bands, and small fish cruising across the silhouette on seeded lanes.
AURA.aquarium = (r, g, b, x, y, t, ctx) => {
  const L = luma(r, g, b);
  let col = mix3(hx("0a3d55"), hx("0e6a80"), clamp(0.2 + L * 0.55 + (1 - y) * 0.25));
  col = mix3(col, hx("031320"), smooth(0.55, 1, y) * 0.5);
  const ray = Math.pow(Math.max(0, Math.sin(x * 7 + Math.sin(y * 4 + t * 0.4) * 1.2 + t * 0.22)), 6) * (1 - y) * 0.45;
  col = [clamp(col[0] + ray * 0.4), clamp(col[1] + ray * 0.65), clamp(col[2] + ray * 0.75)];
  let fish = 0;
  let belly = 0;
  for (let i = 0; i < 3; i++) {
    const lane = 0.28 + i * 0.22 + (h2(i, 7 + FXSEED) - 0.5) * 0.06;
    const dir = i % 2 === 0 ? 1 : -1;
    const spd = 0.045 + h2(i + 11, 3) * 0.04;
    const fx0 = dir > 0 ? fract(h2(i, 13) + t * spd) : 1 - fract(h2(i, 13) + t * spd);
    const bob = Math.sin(t * 1.7 + i * 4.2) * 0.016;
    const lx = (x - fx0) * dir;
    const ly = (y - lane - bob) * 2.2;
    const wig = Math.sin(t * 5 + i * 3) * 0.02 * clamp(0.5 - lx * 4, 0.2, 1);
    // body ellipse (half-length ~0.065) + a tail-fin ellipse trailing behind
    const body = Math.hypot(lx / 0.065, (ly - wig) / 0.024) - 1;
    const tail = Math.hypot((lx + 0.088) / 0.036, (ly - wig * 2.2) / 0.018) - 1;
    const d = Math.min(body, tail);
    const f = smooth(0.25, -0.15, d);
    fish = Math.max(fish, f);
    belly = Math.max(belly, f * smooth(0.004, 0.016, -(ly - wig)) * 0.9);
  }
  col = mix3(col, hx("020d14"), clamp(fish * 0.92));
  col = mix3(col, hx("d8f4e8"), clamp(belly * 0.55));
  const top = smooth(0.1, 0.02, y) * (0.5 + 0.5 * Math.sin(x * 30 + t * 2)) * 0.2;
  return [clamp(col[0] + top * 0.4), clamp(col[1] + top * 0.7), clamp(col[2] + top * 0.8), 1];
};
// Starry Night: the sprite repainted as swirling post-impressionist brushwork -
// the sampler rides a slow curl field, colors bend toward cobalt + moon-gold, and
// a directional stroke texture follows the flow like impasto ridges.
AURA.starrynight = (r, g, b, x, y, t, ctx) => {
  const sw = fbm(x * 2.6 + 3, y * 2.6 - t * 0.04) - 0.5;
  const a = sw * 3.2 + Math.sin(t * 0.11) * 0.12;
  const dx = x - 0.5;
  const dy = y - 0.5;
  const ca = Math.cos(a * 0.65);
  const sa = Math.sin(a * 0.65);
  const ux = 0.5 + dx * ca - dy * sa + Math.sin(y * 26 + a * 5) * 0.006;
  const uy = 0.5 + dx * sa + dy * ca + Math.cos(x * 22 - a * 4) * 0.006;
  const s = ctx.sa(ux, uy);
  const src = s[3] > 0.02 ? [s[0], s[1], s[2]] : [r, g, b];
  const L = luma(src[0], src[1], src[2]);
  const [h, sat] = rgb2hsv(src[0], src[1], src[2]);
  let col = mix3(hx("101f4d"), hx("f0c838"), clamp(L * 1.25 - 0.06));
  col = mix3(col, hsv2rgb(h, clamp(sat * 0.9), clamp(L + 0.08)), 0.3);
  const stroke = Math.sin((x * Math.sin(a) + y * Math.cos(a)) * 80 + sw * 30) * 0.5 + 0.5;
  col = col.map(v => clamp(v * (0.78 + stroke * 0.46) + stroke * stroke * 0.03));
  return [col[0], col[1], col[2], 1];
};
// Anaglyph 3D: a red/cyan stereo pair built from the silhouette itself - the edge
// field becomes the depth map (the rim pops toward you), so the mon reads as relief.
AURA.anaglyph = (r, g, b, x, y, t, ctx) => {
  const depth = 1 - (ctx?.e ?? 0);
  const off = (0.25 + depth * 0.75) * 0.016 + 0.0025 * Math.sin(t * 0.7);
  const sR = ctx.sa(x + off, y);
  const sC = ctx.sa(x - off, y);
  const lR = sR[3] > 0.02 ? luma(sR[0], sR[1], sR[2]) : luma(r, g, b);
  const lC = sC[3] > 0.02 ? luma(sC[0], sC[1], sC[2]) : luma(r, g, b);
  return [clamp(Math.pow(lR, 0.9)), clamp(Math.pow(lC, 0.9) * 0.92), clamp(Math.pow(lC, 0.9)), 1];
};
// Infinite Zoom: a TRUE log-polar Droste tunnel - the outer ring shows the sprite
// itself, and each inward ring (one factor of ZOOM smaller in radius) shows the
// next radial slice, so concentric copies shrink seamlessly into the vanishing
// point, endlessly zooming inward.
AURA.droste = (r, g, b, x, y, t, ctx) => {
  const ZOOM = 2.6;
  const RMAX = 0.42; // ~outer radius of the sprite in frame uv
  const dx = x - 0.5;
  const dy = y - 0.5;
  const rr = Math.hypot(dx, dy) + 1e-4;
  const ux = dx / rr;
  const uy = dy / rr;
  const u = Math.log(RMAX / rr) / Math.log(ZOOM) + t * 0.09;
  const fr = fract(u);
  const rho = RMAX * Math.pow(ZOOM, -fr);
  const samp = rad => {
    const s = ctx.sa(0.5 + ux * rad, 0.5 + uy * rad);
    return s[3] > 0.02 ? [s[0], s[1], s[2]] : [0.03, 0.04, 0.09];
  };
  let col = samp(rho);
  // seamless crossfade where the ring wraps (sampled radius jumps ZOOMx)
  const seam = smooth(0.88, 1, fr);
  if (seam > 0) {
    col = mix3(col, samp(Math.min(rho * ZOOM, 0.6)), seam);
  }
  // tunnel depth shading toward the vanishing point
  const depth = smooth(0.45, 0.03, rr);
  col = mix3(col, [0.02, 0.03, 0.08], depth * 0.6);
  return [clamp(col[0]), clamp(col[1]), clamp(col[2]), 1];
};
// Ferrofluid: glossy near-black liquid metal; the rim bristles with magnetic
// spikes (angular cells keyed to the edge field) whose tips catch the light.
AURA.ferrofluid = (r, g, b, x, y, t, ctx) => {
  const e = ctx?.e ?? 0;
  const L = luma(r, g, b);
  const ang = Math.atan2(y - 0.5, x - 0.5) / (Math.PI * 2) + 0.5;
  const N = 22;
  const cell = Math.floor(ang * N);
  const cf = fract(ang * N) - 0.5;
  const hh = h2(cell, 5 + FXSEED);
  // each spike: a long triangle peaking at the rim, breathing slowly
  const len = (0.35 + hh * 0.65) * (0.75 + 0.25 * Math.sin(t * 1.1 + hh * 14));
  const tri = Math.pow(Math.max(0, 1 - Math.abs(cf) * 2), 0.8);
  const prof = e - (1 - len * tri);
  const spike = smooth(0.0, 0.12, prof) * tri;
  // oil-black base with a slow iridescent swirl
  const sheen = hsv2rgb(fract(L * 1.5 + t * 0.04), 0.5, 0.05 + L * 0.1);
  const base = mix3([0.012, 0.012, 0.022], sheen, 0.55);
  // spikes read as glossy ridges: soft flank light + a hot tip
  const flank = spike * 0.16;
  const tip = Math.pow(smooth(0.55, 1, spike), 2.5) * 0.6;
  const spec = Math.pow(Math.max(0, Math.sin((x * 0.7 - y) * 5 - t * 0.5)), 26);
  return [
    clamp(base[0] + flank * 0.5 + spec * 0.4 + tip * 0.8),
    clamp(base[1] + flank * 0.6 + spec * 0.45 + tip * 0.9),
    clamp(base[2] + flank * 0.9 + spec * 0.55 + tip * 1.2),
    1,
  ];
};
// Plasma Globe: violet streamers leap from the core to the inside of the
// silhouette, forking like a Tesla ball; the core itself breathes.
AURA.plasmaglobe = (r, g, b, x, y, t, ctx) => {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const rr = Math.hypot(dx, dy) + 1e-4;
  const ang = Math.atan2(dy, dx);
  const e = ctx?.e ?? 0;
  const n = fbm(ang * 1.6 + 9, rr * 2.4 - t * 0.5);
  const ridge = 1 - Math.abs(n - 0.5) * 2;
  const stream = Math.pow(smooth(0.72, 0.97, ridge), 1.7);
  const reach = smooth(0.03, 0.12, rr) * (0.35 + 0.65 * smooth(0.05, 0.75, e));
  const flick = 0.65 + 0.35 * Math.sin(t * 8 + n * 26);
  const core = smooth(0.09, 0.01, rr) * (0.7 + 0.3 * Math.sin(t * 3));
  const base = [r * 0.1 + 0.04, g * 0.08 + 0.02, b * 0.2 + 0.08];
  const k = clamp(stream * reach * flick + core);
  return [clamp(base[0] + k * 0.95), clamp(base[1] + k * 0.45), clamp(base[2] + k * 1.35), 1];
};
// Trapped in Amber: warm fossil resin - honey translucency with dark gnarl
// inclusions, tiny suspended bubbles, and a slow glossy light band.
AURA.amber = (r, g, b, x, y, t, ctx) => {
  const L = luma(r, g, b);
  let col = ramp(["241102", "6a3a06", "c8860f", "ffd668"].map(hx), clamp(0.16 + L * 0.8));
  const gn = fbm(x * 3.6 + 11, y * 3.6);
  col = mix3(col, hx("160a01"), smooth(0.58, 0.74, gn) * 0.5);
  const cell = 22 * FXSCALE;
  const bx = Math.floor(x * cell);
  const by = Math.floor(y * cell);
  let bub = 0;
  if (h2(bx + FXSEED, by - FXSEED) > 0.5) {
    const ax = (bx + 0.25 + h2(bx, by + 5) * 0.5) / cell;
    const ay = (by + 0.25 + h2(by, bx + 9) * 0.5) / cell;
    const d = Math.hypot(x - ax, y - ay);
    bub = smooth(0.009, 0.004, d) * 0.85 - smooth(0.0035, 0.001, d) * 0.6;
  }
  const gloss = Math.pow(Math.max(0, 1 - Math.abs(x * 0.8 + y * 0.5 - fract(t * 0.06) * 1.9) * 3.2), 9) * 0.4;
  return [
    clamp(col[0] + bub * 0.9 + gloss),
    clamp(col[1] + bub * 0.7 + gloss * 0.85),
    clamp(col[2] + bub * 0.35 + gloss * 0.5),
    1,
  ];
};
// Moonlit: cold silver moonlight from high right; slow cloud shadows drift across
// the body and the upper rim catches a pale glow.
AURA.moonlit = (r, g, b, x, y, t, ctx) => {
  const L = luma(r, g, b);
  const e = ctx?.e ?? 0;
  const cr = L * 0.66;
  const cg = L * 0.74;
  const cb = clamp(L * 0.95 + 0.07);
  const mglow = smooth(0.85, 0.15, Math.hypot(x - 0.8, y - 0.16)) * 0.4;
  const cl = fbm(x * 3.2 - t * 0.1, y * 3.2 + 4);
  const shadow = smooth(0.42, 0.66, cl) * 0.55;
  const rim = smooth(0.3, 0.9, e) * smooth(0.6, 0.1, y) * 0.4;
  const lit = mglow + rim;
  return [
    clamp((cr + lit * 0.85) * (1 - shadow)),
    clamp((cg + lit * 0.95) * (1 - shadow)),
    clamp((cb + lit * 1.1) * (1 - shadow * 0.85)),
    1,
  ];
};
// Chronoshift: three eras sweep across the body - sepia PAST, true-color PRESENT,
// neon FUTURE - with bright scan seams where the timelines meet.
AURA.chronoshift = (r, g, b, x, y, t) => {
  const L = luma(r, g, b);
  const zone = fract(x - t * 0.12 + Math.sin(y * 2.5 + t * 0.4) * 0.04);
  const past = [clamp(L * 1.08 + 0.04), clamp(L * 0.84 + 0.02), clamp(L * 0.56)];
  const [h, s, v] = rgb2hsv(r, g, b);
  const future = hsv2rgb(fract(h + 0.52), clamp(s * 1.35 + 0.18), clamp(v * 1.12 + 0.08));
  const wPres = smooth(0.3, 0.36, zone) - smooth(0.63, 0.69, zone);
  const wFut = smooth(0.63, 0.69, zone);
  let col = mix3(past, [r, g, b], wPres);
  col = mix3(col, future, wFut);
  const seam =
    smooth(0.02, 0.0, Math.abs(zone - 0.33)) + smooth(0.02, 0.0, Math.abs(zone - 0.66)) + smooth(0.025, 0.0, Math.min(zone, 1 - zone));
  return [clamp(col[0] + seam * 0.9), clamp(col[1] + seam), clamp(col[2] + seam * 0.8), 1];
};

// --- v6 around ---
// Around FX in AROUND_OVERLAY are ALSO evaluated on sprite pixels (df=0) and
// composited OVER the mon - so an orbit can pass in front of and behind the body.
// Inside the effect: skip the "behind" half when df <= 0.01 (the sprite occludes it).
export const AROUND_OVERLAY = new Set([
  "helix",
  "atomrings",
  "windribbons",
  "ribbonloop",
  "planets",
  "lightcage",
  "chains",
  "hexdome",
  "orbitdebris",
  "starcircle",
  "cometorbit",
  "emberspiral",
  "runeorbit",
  "fogbank",
  "zaps",
  "koipond",
  "saturnrings",
]);
// Energy Helix: a double strand winding around the mon, front arcs over the sprite.
AROUND.helix = (nx, ny, df, t, c) => {
  const env = smooth(0.04, 0.16, ny) * smooth(0.98, 0.86, ny);
  if (env <= 0) {
    return [0, 0, 0, 0];
  }
  const phase = ny * 9 - t * 2.0;
  let a = 0;
  let bright = 0;
  for (let s = 0; s < 2; s++) {
    const p = phase + s * Math.PI;
    const px = c.cx + Math.sin(p) * 0.18;
    const depth = Math.cos(p);
    if (depth < 0 && df <= 0.01) {
      continue; // behind the mon
    }
    const strand = smooth(0.024, 0.007, Math.abs(nx - px));
    const k = strand * (depth < 0 ? 0.45 : 1);
    if (k > a) {
      a = k;
      bright = depth * 0.5 + 0.5;
    }
  }
  const col = mix3(hx("1f6fd0"), hx("aef4ff"), bright);
  return [col[0], col[1], col[2], a * env * 0.95];
};
// Atomic Orbit: three tilted electron rings; near halves sweep in front of the mon.
AROUND.atomrings = (nx, ny, df, t, c) => {
  let a = 0;
  let col = [0.6, 0.95, 1.0];
  for (let i = 0; i < 3; i++) {
    const rot = (i * Math.PI) / 3 + t * 0.22 * (i % 2 ? -1 : 1);
    const dx = nx - c.cx;
    const dy = ny - c.cy;
    const ux = dx * Math.cos(rot) + dy * Math.sin(rot);
    const uy = -dx * Math.sin(rot) + dy * Math.cos(rot);
    const px = ux / 0.36;
    const py = uy / 0.13;
    const rr = Math.hypot(px, py);
    const front = py > 0;
    if (!front && df <= 0.01) {
      continue;
    }
    const ring = smooth(0.05, 0.012, Math.abs(rr - 1) * 0.36) * (front ? 1 : 0.4);
    const ea = Math.atan2(py, px);
    const et = t * 1.8 + i * 2.1;
    const edot = Math.pow(Math.max(0, Math.cos(ea - et)), 40) * smooth(0.2, 0.05, Math.abs(rr - 1)) * (front ? 1.4 : 0);
    const k = ring * 0.55 + edot;
    if (k > a) {
      a = k;
      col = mix3(hx("48c8ff"), hx("fff2b0"), clamp(edot * 2));
    }
  }
  return [col[0], col[1], col[2], clamp(a)];
};
// Nuclear Winter: soft glowing ash-snow drifting down through a toxic haze.
AROUND.nuclearwinter = (nx, ny, df, t) => {
  let k = 0;
  for (let i = 0; i < 2; i++) {
    const cell = 12 + i * 7;
    const fx0 = nx + Math.sin((ny + t * 0.2) * 4 + i * 2) * 0.04;
    const fy = ny - t * (0.09 + i * 0.05);
    const cx0 = Math.floor(fx0 * cell);
    const cy0 = Math.floor(fy * cell);
    if (h2(cx0 * 1.3 + i * 7, cy0 * 1.7) < 0.76) {
      continue;
    }
    const jx = h2(cx0 + 7, cy0) * 0.5 + 0.25;
    const jy = h2(cx0, cy0 + 3) * 0.5 + 0.25;
    const lx = fract(fx0 * cell) - jx;
    const ly = fract(fy * cell) - jy;
    const glowp = 0.6 + 0.4 * Math.sin(t * 2 + h2(cy0, cx0) * 15);
    k = Math.max(k, Math.pow(clamp(1 - Math.hypot(lx, ly) * 2.8), 2.2) * glowp);
  }
  const m = clamp(1 - df / 26);
  const haze = clamp(fbm(nx * 4, ny * 4 + t * 0.1) * clamp(1 - df / 30) * smooth(0.4, 0.9, ny) * 1.3 - 0.35);
  return [mix(0.3, 0.8, k), mix(0.55, 1.0, k), mix(0.4, 0.82, k), clamp(k * 1.1 + haze * 0.5) * m];
};
// Sinister Sun: a black sun with a crimson corona looming behind the mon.
AROUND.sinistersun = (nx, ny, df, t, c) => {
  const sx = nx - c.cx;
  const sy = (ny - (c.cy - 0.24)) * 1.05;
  const r = Math.hypot(sx, sy);
  const ang = Math.atan2(sy, sx);
  const disc = smooth(0.012, -0.006, r - 0.15);
  const jag = 0.018 * Math.sin(ang * 13 + t * 0.7) + 0.011 * Math.sin(ang * 29 - t * 1.2);
  const corona = smooth(0.085, 0.0, Math.abs(r - 0.175 - jag)) * (0.65 + 0.35 * Math.sin(t * 2.6 + ang * 5));
  const rays = Math.pow(Math.max(0, Math.sin(ang * 7 - t * 0.3)), 16) * smooth(0.5, 0.18, r) * smooth(0.12, 0.18, r);
  const heat = clamp(corona + rays);
  const col = mix3([0.04, 0.0, 0.03], [0.85, 0.09, 0.1], heat);
  return [col[0], col[1], col[2], clamp(disc * 0.96 + corona * 0.85 + rays * 0.55)];
};
// HD Stars: smooth anti-aliased 4/5-point stars (deliberately NOT pixel art).
const _starSdf = (lx, ly, points, rot) => {
  const ang = Math.atan2(ly, lx) + rot;
  const rr = Math.hypot(lx, ly);
  const spoke = 0.5 + 0.5 * Math.cos(ang * points);
  const rad = mix(0.1, 0.52, Math.pow(spoke, 3));
  return smooth(rad, rad * 0.45, rr);
};
AROUND.hdstars = (nx, ny, df, t) => {
  const cell = 6;
  const cx0 = Math.floor(nx * cell);
  const cy0 = Math.floor(ny * cell);
  if (h2(cx0 * 2.1, cy0 * 1.9) < 0.45) {
    return [0, 0, 0, 0];
  }
  const jx = h2(cx0 + 7, cy0) * 0.4 + 0.3;
  const jy = h2(cx0, cy0 + 3) * 0.4 + 0.3;
  const tw = Math.pow(0.5 + 0.5 * Math.sin(t * 2.2 + h2(cy0, cx0) * 20), 2);
  const size = 0.55 + 0.5 * tw;
  const lx = ((fract(nx * cell) - jx) * 2) / size;
  const ly = ((fract(ny * cell) - jy) * 2) / size;
  const s = _starSdf(lx, ly, h2(cx0, cy0) > 0.5 ? 5 : 4, t * 0.25 + cx0);
  const glow = Math.pow(clamp(1 - Math.hypot(lx, ly) * 0.85), 3) * 0.55;
  const cross =
    (smooth(0.09, 0.02, Math.abs(lx)) + smooth(0.09, 0.02, Math.abs(ly))) * smooth(1.3, 0.2, Math.hypot(lx, ly)) * 0.4;
  const m = clamp(1 - df / 26);
  const col = mix3([1, 0.95, 0.78], [0.78, 0.9, 1], h2(cx0 * 3, cy0));
  return [col[0], col[1], col[2], clamp(s * (0.6 + 0.4 * tw) + (glow + cross) * tw) * m];
};
// Double Team: red/blue after-images of the mon itself, offset left + right
// (the triples "triple shadow" idea - needs the sprite sampler c.spr).
AROUND.echoes = (nx, ny, df, t, c) => {
  if (!c.spr) {
    return [0, 0, 0, 0];
  }
  const sway = 0.012 * Math.sin(t * 1.5);
  let out = [0, 0, 0, 0];
  for (const [dir, tint] of [
    [-1, [1.0, 0.28, 0.4]],
    [1, [0.34, 0.6, 1.0]],
  ]) {
    const s2 = c.spr(nx - dir * (0.09 + sway * dir), ny + Math.abs(sway) * 0.4);
    if (s2[3] > 0.02) {
      const L = 0.3 + luma(s2[0], s2[1], s2[2]) * 0.7;
      const a = 0.55 * s2[3];
      if (a > out[3]) {
        out = [tint[0] * L, tint[1] * L, tint[2] * L, a];
      }
    }
  }
  return out;
};
// Double Team Tri: like Double Team but the after-images are SOLID colours - the
// two echoes take the two other hues of a triad built from the mon's dominant
// colour (c.main, the most colorful cluster centroid), so mon + echoes read as a
// complementary tri palette. Only a hint of the sprite's own shading is kept.
AROUND.triecho = (nx, ny, df, t, c) => {
  if (!c.spr) {
    return [0, 0, 0, 0];
  }
  const sway = 0.014 * Math.sin(t * 1.5);
  const base = c.main ? rgb2hsv(c.main[0], c.main[1], c.main[2]) : [0.6, 0.7, 0.85];
  const sat = Math.max(0.6, base[1]);
  let out = [0, 0, 0, 0];
  for (const [dir, rot] of [
    [-1, 1 / 3],
    [1, 2 / 3],
  ]) {
    const s2 = c.spr(nx - dir * (0.1 + sway * dir), ny + Math.abs(sway) * 0.4);
    if (s2[3] > 0.02) {
      const L = luma(s2[0], s2[1], s2[2]);
      const col = hsv2rgb(fract(base[0] + rot), sat, clamp(0.5 + L * 0.4));
      const a = 0.68 * s2[3];
      if (a > out[3]) {
        out = [col[0], col[1], col[2], a];
      }
    }
  }
  return out;
};
// Ground Mist: white rolling fog hugging the mon's feet (pairs with Rising Mist).
AROUND.lowmist = (nx, ny, df, t, c) => {
  const gy = c?.fy ?? 0.82;
  const reg = smooth(gy - 0.34, gy + 0.03, ny);
  const n = fbm(nx * 4 + t * 0.14, ny * 5 - t * 0.06);
  const m = clamp(1 - df / 20);
  return [0.88, 0.92, 0.97, clamp(n * reg * m * 1.9 - 0.25) * 0.85];
};

// ============== v7 around FX ==============
// Meteor Shower: fat burning streaks raking down diagonally, heads white-hot.
AROUND.meteors = (nx, ny, df, t) => {
  const p = nx * 0.76 + ny * 0.64;
  const q = nx * 0.64 - ny * 0.76;
  const lane = Math.floor(q * 6);
  if (h2(lane, 5) < 0.42) {
    return [0, 0, 0, 0];
  }
  const across = Math.abs(fract(q * 6) - 0.5);
  const w = smooth(0.34, 0.08, across);
  const ph = fract(p * 0.9 - t * (0.5 + h2(lane, 1) * 0.3) + h2(lane, 2));
  const head = Math.pow(smooth(0.07, 0.0, ph), 2) * 1.6;
  const trail = smooth(0.4, 0.0, ph) * 0.85;
  const m = clamp(1 - df / 32);
  const k = (head + trail) * w * m;
  return [1, clamp(0.7 + head * 0.3), clamp(0.4 + head * 0.55), clamp(k)];
};
// Thunderstorm: driving rain always, jagged bolts + a sky flash in bursts.
AROUND.stormstrikes = (nx, ny, df, t, c) => {
  const m = clamp(1 - df / 32);
  const colr = Math.floor(nx * 34);
  const rph = fract(ny * 2.2 - t * (1.6 + h2(colr, 1) * 0.8) + h2(colr, 2));
  const rain = smooth(0.0, 0.08, rph) * smooth(0.3, 0.08, rph) * (h2(colr, 4) > 0.35 ? 0.5 : 0);
  const gloom = clamp(fbm(nx * 3, ny * 3 - t * 0.15) * smooth(0.5, 0.1, ny) * 1.2 - 0.4) * 0.5;
  const slot = Math.floor(t * 1.6);
  const on = h2(slot, 7) > 0.66;
  let bolt = 0;
  let flash = 0;
  if (on) {
    const colx = c.cx + (h2(slot, 3) - 0.5) * 0.55;
    const jag = (fbm(2.5, ny * 6 + slot) - 0.5) * 0.16;
    const age = fract(t * 1.6);
    const decay = smooth(0.55, 0.05, age);
    bolt = smooth(0.022, 0.004, Math.abs(nx - colx - jag)) * smooth(0.02, 0.18, ny) * decay * 1.3;
    flash = 0.2 * decay;
  }
  const k = clamp(rain * 0.8 + gloom + bolt + flash);
  const bright = clamp(0.55 + bolt + flash * 2);
  return [bright * 0.92, bright * 0.95, bright, k * m];
};
// Rainbow Arc: a soft rainbow arches over the mon.
AROUND.rainbowarc = (nx, ny, df, t, c) => {
  if (ny > c.cy) {
    return [0, 0, 0, 0];
  }
  const r = Math.hypot(nx - c.cx, (ny - c.cy) * 1.15);
  const band = smooth(0.3, 0.34, r) * (1 - smooth(0.46, 0.5, r));
  const hue = clamp((0.48 - r) / 0.2);
  const m = clamp(1 - df / 34);
  return [...hsv2rgb(hue * 0.8, 0.8, 1), band * m * 0.65 * (0.85 + 0.15 * Math.sin(t))];
};
// Autumn Gust: big warm leaves tumbling sideways on the wind, with a stem vein.
AROUND.autumnleaves = (nx, ny, df, t) => {
  const cell = 6;
  const fx0 = nx - t * 0.2;
  const fy = ny + Math.sin(nx * 5 + t * 1.3) * 0.035;
  const cx0 = Math.floor(fx0 * cell);
  const cy0 = Math.floor(fy * cell);
  if (h2(cx0 * 1.7, cy0 * 1.3) < 0.72) {
    return [0, 0, 0, 0];
  }
  const rot = t * (1 + h2(cx0, cy0)) + h2(cy0, cx0) * 7;
  const lx0 = (fract(fx0 * cell) - 0.5) * 2.1;
  const ly0 = (fract(fy * cell) - 0.5) * 2.1;
  const lx = lx0 * Math.cos(rot) - ly0 * Math.sin(rot);
  const ly = lx0 * Math.sin(rot) + ly0 * Math.cos(rot);
  const leaf = Math.abs(lx) + Math.abs(ly * 1.7) < 0.4 ? 1 : 0;
  const vein = Math.abs(ly) < 0.03 && Math.abs(lx) < 0.34 ? 0.25 : 0;
  const shade = 0.75 + 0.25 * Math.sin(rot * 2);
  const col = ramp(["7a3a10", "c05a14", "e0912a", "d4b03a"].map(hx), h2(cx0 * 3, cy0));
  const m = clamp(1 - df / 26);
  return [clamp(col[0] * shade - vein), clamp(col[1] * shade - vein), clamp(col[2] * shade - vein), leaf * m * 0.95];
};
// Music Notes: big golden eighth-notes bobbing upward around the mon.
AROUND.musicnotes = (nx, ny, df, t) => {
  const cell = 5;
  const fy = ny + t * 0.14;
  const cx0 = Math.floor(nx * cell);
  const cy0 = Math.floor(fy * cell);
  if (h2(cx0 * 2.3, cy0 * 1.9) < 0.7) {
    return [0, 0, 0, 0];
  }
  const lx = (fract(nx * cell) - 0.5) * 2 + Math.sin(t * 2 + cy0 * 3) * 0.08;
  const ly = (fract(fy * cell) - 0.5) * 2;
  const head = Math.hypot((lx + 0.16) * 1.15, (ly + 0.3) * 1.5) < 0.2 ? 1 : 0;
  const stem = Math.abs(lx - 0.0) < 0.045 && ly > -0.32 && ly < 0.42 ? 1 : 0;
  const flag = ly > 0.14 && ly < 0.44 && lx > 0.0 && lx < 0.18 - (ly - 0.14) * 0.35 ? 1 : 0;
  const note = Math.max(head, stem, flag);
  const halo = Math.pow(clamp(1 - Math.hypot(lx, ly) * 1.4), 3) * 0.25;
  const m = clamp(1 - df / 26);
  const gold = 0.8 + 0.2 * Math.sin(t * 3 + cx0);
  return [1 * gold, 0.9 * gold, 0.5 * gold, clamp(note + halo) * m];
};
// Butterflies: bright wings genuinely flapping as they wander around the mon.
AROUND.butterflies = (nx, ny, df, t) => {
  const cell = 5;
  const fx0 = nx + Math.sin(t * 0.8 + ny * 4) * 0.05;
  const fy = ny + Math.cos(t * 0.6 + nx * 4) * 0.05;
  const cx0 = Math.floor(fx0 * cell);
  const cy0 = Math.floor(fy * cell);
  if (h2(cx0 * 1.9, cy0 * 2.1) < 0.74) {
    return [0, 0, 0, 0];
  }
  const flap = 0.3 + 0.7 * Math.abs(Math.sin(t * 5 + h2(cx0, cy0) * 9));
  const lx = (fract(fx0 * cell) - 0.5) * 2.2;
  const ly = (fract(fy * cell) - 0.5) * 2.2;
  const wing =
    Math.hypot((Math.abs(lx) - 0.2 * flap) / (0.22 * flap), ly / 0.3) < 1 && Math.abs(lx) > 0.03 ? 1 : 0;
  const bodySeg = Math.abs(lx) < 0.035 && Math.abs(ly) < 0.2 ? 1 : 0;
  const col = hsv2rgb(fract(h2(cy0, cx0) * 3), 0.75, 1);
  const m = clamp(1 - df / 24);
  if (bodySeg) {
    return [0.2, 0.15, 0.1, m * 0.95];
  }
  const patt = 0.75 + 0.25 * Math.sin(lx * 30 + ly * 20);
  return [col[0] * patt, col[1] * patt, col[2] * patt, wing * m * 0.95];
};
// Bat Swarm: dark flapping silhouettes wheeling through the gloom.
AROUND.batswarm = (nx, ny, df, t) => {
  const cell = 5.5;
  const fx0 = nx - t * 0.12;
  const fy = ny + Math.sin(t * 2 + Math.floor(fx0 * cell)) * 0.03;
  const cx0 = Math.floor(fx0 * cell);
  const cy0 = Math.floor(fy * cell);
  if (h2(cx0 * 2.7, cy0 * 1.3) < 0.7) {
    return [0, 0, 0, 0];
  }
  const lx = (fract(fx0 * cell) - 0.5) * 2.2;
  const ly = (fract(fy * cell) - 0.5) * 2.2;
  const flap = Math.sin(t * 8 + h2(cx0, cy0) * 9) * 0.35;
  const wingY = Math.abs(lx) * (0.5 + flap);
  const wing = Math.abs(ly - wingY + 0.1) < 0.12 - Math.abs(lx) * 0.12 && Math.abs(lx) < 0.55 ? 1 : 0;
  const head = Math.hypot(lx / 0.09, (ly + 0.12) / 0.12) < 1 ? 1 : 0;
  const m = clamp(1 - df / 28);
  return [0.08, 0.05, 0.12, Math.max(wing, head) * m * 0.95];
};
// Moonrise: a pale crescent and a few stars hanging behind one shoulder.
AROUND.moonrise = (nx, ny, df, t, c) => {
  const mx = c.cx - 0.27;
  const my = c.cy - 0.3;
  const r1 = Math.hypot(nx - mx, ny - my);
  const r2 = Math.hypot(nx - mx + 0.045, ny - my - 0.015);
  const cres = smooth(0.008, 0.0, r1 - 0.11) * smooth(0.0, 0.012, r2 - 0.105);
  const glow = Math.pow(clamp(1 - r1 / 0.3), 3) * 0.25;
  let star = 0;
  if (ny < c.cy) {
    const sc = 16;
    const scx = Math.floor(nx * sc);
    const scy = Math.floor(ny * sc);
    if (h2(scx * 1.7, scy * 2.3) > 0.85) {
      const slx = fract(nx * sc) - (h2(scx + 3, scy) * 0.5 + 0.25);
      const sly = fract(ny * sc) - (h2(scx, scy + 5) * 0.5 + 0.25);
      const tw = Math.pow(0.5 + 0.5 * Math.sin(t * 2.5 + h2(scy, scx) * 25), 3);
      star = Math.pow(clamp(1 - Math.hypot(slx, sly) * 4), 2) * tw;
    }
  }
  const a = clamp(cres * 0.95 + glow + star);
  return [0.92, 0.93, 0.85, a];
};
// Geyser: real droplet arcs - water beads launch up and fall in parabolas.
AROUND.geyser = (nx, ny, df, t, c) => {
  const bx = c.cx;
  const by = c.fy ?? c.cy + 0.34; // erupts from the feet line
  let k = 0;
  for (let i = 0; i < 14; i++) {
    const ph = fract(t * 0.55 + h2(i, 1));
    const vx = (h2(i, 2) - 0.5) * 0.55;
    const px = bx + vx * ph;
    const py = by - (1.15 * ph - 1.3 * ph * ph) * (0.5 + h2(i, 3) * 0.35);
    const d = Math.hypot(nx - px, ny - py);
    k = Math.max(k, Math.pow(clamp(1 - d * 14), 1.8) * (1 - ph * 0.35));
  }
  const mist = clamp(fbm(nx * 6, ny * 6 + t) * smooth(0.3, 0.05, Math.hypot(nx - bx, (ny - by) * 1.6)) - 0.28) * 0.8;
  return [0.68, 0.87, 1.0, clamp(k * 1.5 + mist)];
};
// Whirlpool: swirling water rings coiling at the feet.
AROUND.whirlpool = (nx, ny, df, t, c) => {
  const gy = c.fy ?? c.cy + 0.34; // ellipse CENTERED on the feet line, not hanging below it
  const ey = (ny - gy) * 2.6;
  const fx0 = nx - c.cx;
  const r = Math.hypot(fx0, ey);
  const ang = Math.atan2(ey, fx0);
  const swirl = Math.sin(ang * 3 + r * 26 - t * 4);
  const band = smooth(0.5, 0.42, r) * smooth(0.06, 0.14, r) * (ny > c.cy ? 1 : 0);
  const a = smooth(0.35, 0.9, swirl) * band;
  return [0.4 + a * 0.3, 0.7, 1.0, a * 0.8];
};
// Wind Ribbons: white wind streams wrap the body, front and behind - and they
// stay wrapped AROUND the mon instead of smearing across the whole frame.
AROUND.windribbons = (nx, ny, df, t, c) => {
  let a = 0;
  let bright = 0.7;
  const hug = smooth(0.5, 0.34, Math.abs(nx - c.cx));
  if (hug <= 0) {
    return [0, 0, 0, 0];
  }
  for (let b = 0; b < 3; b++) {
    const py = c.cy - 0.22 + b * 0.19 + 0.025 * Math.sin(t * 2 + b * 2 + nx * 6);
    const band = smooth(0.04, 0.012, Math.abs(ny - py));
    if (band <= 0) {
      continue;
    }
    const ph = fract(nx * 1.6 - t * (0.5 + b * 0.13) + b * 0.37);
    const front = Math.sin(ph * Math.PI * 2) > 0;
    if (!front && df <= 0.01) {
      continue;
    }
    const streak = smooth(0.1, 0.4, ph) * smooth(0.95, 0.55, ph);
    const k = band * streak * (front ? 1 : 0.45) * hug;
    if (k > a) {
      a = k;
      bright = front ? 1 : 0.55;
    }
  }
  return [0.85 * bright, 0.95 * bright, bright, a * 0.9];
};
// Ribbon Dancer: one wide rainbow ribbon looping around the mon.
AROUND.ribbonloop = (nx, ny, df, t, c) => {
  const py = c.cy + 0.26 * Math.sin(nx * 5.5 - t * 1.3);
  const seg = Math.sin(nx * 2.75 - t * 0.65);
  const front = seg > 0;
  if (!front && df <= 0.01) {
    return [0, 0, 0, 0];
  }
  const band = smooth(0.06, 0.02, Math.abs(ny - py));
  const env = smooth(0.02, 0.12, nx) * smooth(0.98, 0.88, nx);
  const col = hsv2rgb(fract(nx * 0.8 + t * 0.12), 0.85, front ? 1 : 0.55);
  return [col[0], col[1], col[2], band * env * (front ? 0.95 : 0.5)];
};
// Blade Flurry: bright slash arcs flashing across.
AROUND.slashes = (nx, ny, df, t, c) => {
  let a = 0;
  for (let i = 0; i < 3; i++) {
    const ph = fract(t * 0.55 + i / 3);
    const env = smooth(0.02, 0.1, ph) * smooth(0.4, 0.18, ph);
    if (env <= 0) {
      continue;
    }
    const rot = h2(Math.floor(t * 0.55 + i / 3) * 3 + i, 1) * Math.PI;
    const dx = nx - c.cx;
    const dy = ny - c.cy;
    const ux = dx * Math.cos(rot) + dy * Math.sin(rot);
    const uy = -dx * Math.sin(rot) + dy * Math.cos(rot);
    const core = smooth(0.022, 0.004, Math.abs(uy - ux * ux * 0.6)) * smooth(0.55, 0.35, Math.abs(ux));
    const glow = smooth(0.07, 0.01, Math.abs(uy - ux * ux * 0.6)) * smooth(0.55, 0.3, Math.abs(ux)) * 0.45;
    a = Math.max(a, (core * 1.4 + glow) * env);
  }
  return [1, 0.98, 0.88, clamp(a * 1.3)];
};
// Tiny Planets: a shaded planet + moons orbiting through the scene.
AROUND.planets = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  const bodies = [
    [0.5, 0.34, 0.13, 0.05, 0.58, true],
    [2.4, 0.3, 0.11, 0.028, 0.12, false],
    [1.3, 0.38, 0.16, 0.02, 0.86, false],
  ];
  for (const [spd, rx, ry, rad, hue, ringed] of bodies) {
    const th = t * spd;
    const px = c.cx + Math.cos(th) * rx;
    const py = c.cy + Math.sin(th) * ry;
    const front = Math.sin(th) > 0;
    if (!front && df <= 0.01) {
      continue;
    }
    const d = Math.hypot(nx - px, ny - py);
    const disc = smooth(rad, rad * 0.75, d);
    if (disc > 0) {
      const shade = clamp(0.45 + ((px - nx) / rad) * 0.4);
      const col = hsv2rgb(hue, 0.6, (front ? 1 : 0.5) * shade);
      if (disc * 0.95 > out[3]) {
        out = [col[0], col[1], col[2], disc * 0.95];
      }
    }
    if (ringed) {
      const ring = smooth(0.006, 0.0, Math.abs(Math.hypot((nx - px) * 1, (ny - py) * 3.2) - rad * 1.9));
      if (ring * 0.8 > out[3]) {
        const col = hsv2rgb(hue, 0.3, front ? 0.95 : 0.5);
        out = [col[0], col[1], col[2], ring * 0.8];
      }
    }
  }
  return out;
};
// Clockwork: golden gears turning behind the mon.
AROUND.clockwork = (nx, ny, df, t, c) => {
  let a = 0;
  let hub = 0;
  const gears = [
    [c.cx - 0.2, c.cy - 0.12, 0.14, 8, 0.5],
    [c.cx + 0.18, c.cy + 0.08, 0.1, 7, -0.7],
    [c.cx + 0.02, c.cy - 0.3, 0.08, 6, 0.9],
  ];
  for (const [gx, gy, rad, teeth, spd] of gears) {
    const dx = nx - gx;
    const dy = ny - gy;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const tooth = Math.sin(ang * teeth - t * spd * teeth) > 0 ? 0.026 : 0;
    a = Math.max(a, smooth(0.022, 0.0, Math.abs(r - rad - tooth)));
    a = Math.max(a, smooth(0.014, 0.0, Math.abs(r - rad * 0.42)));
    const spoke = Math.pow(Math.max(0, Math.cos(ang * 3 - t * spd * 3)), 30) * (r < rad * 0.95 && r > rad * 0.42 ? 1 : 0);
    a = Math.max(a, spoke * 0.8);
    hub = Math.max(hub, smooth(rad * 0.18, 0.0, r));
  }
  const m = clamp(1 - df / 30);
  const k = clamp(a + hub) * m;
  return [0.88, 0.7, 0.3, k * 0.92];
};
// Fireworks: shells bursting in sequence around the mon.
AROUND.fireworks = (nx, ny, df, t) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 2; i++) {
    const slot = Math.floor(t * 0.7 + i * 0.5);
    const age = fract(t * 0.7 + i * 0.5);
    const bx = 0.15 + h2(slot, 1 + i) * 0.7;
    const by = 0.1 + h2(slot, 3 + i) * 0.35;
    const dx = nx - bx;
    const dy = ny - by;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const ray = Math.pow(Math.max(0, Math.cos(ang * 9 + h2(slot, 5) * 9)), 14);
    const shell = smooth(0.075, 0.0, Math.abs(r - age * 0.42)) * ray * (1 - age) * 1.4;
    const core = Math.pow(clamp(1 - r * 6), 2) * smooth(0.3, 0.05, age);
    const spark = h2(Math.floor(nx * 40), Math.floor(ny * 40) + slot) > 0.94 && r < age * 0.44 ? (1 - age) * 0.9 : 0;
    const k = clamp(shell + core + spark);
    if (k > out[3]) {
      const col = hsv2rgb(fract(h2(slot, 8) + i * 0.3), 0.75, 1);
      out = [col[0], col[1], col[2], k];
    }
  }
  return out;
};
// Sand Gust: stinging desert wind blowing through.
AROUND.sandgust = (nx, ny, df, t) => {
  const row = Math.floor(ny * 36);
  const ph = fract(nx * 1.6 - t * (0.9 + h2(row, 1) * 0.7) + h2(row, 2));
  const streak = smooth(0.0, 0.08, ph) * smooth(0.4, 0.08, ph) * (h2(row, 4) > 0.45 ? 1 : 0);
  const haze = clamp(fbm(nx * 3 - t * 0.5, ny * 5) * smooth(0.25, 0.6, ny) - 0.3) * 0.6;
  const m = clamp(1 - df / 28);
  return [0.85, 0.72, 0.48, clamp(streak * 0.7 + haze) * m];
};
// Spotlights: two stage beams sweeping from above.
AROUND.spotlights = (nx, ny, df, t) => {
  let a = 0;
  for (const s of [-1, 1]) {
    const ox = 0.5 + s * 0.42;
    const swing = Math.sin(t * 0.8 + s) * 0.35;
    const dirx = -s * 0.35 + swing;
    const px = ox + dirx * ny;
    a = Math.max(a, smooth(0.1 * (0.3 + ny), 0.0, Math.abs(nx - px)) * clamp(0.9 - ny * 0.4));
  }
  const m = clamp(1 - df / 36);
  return [1, 0.96, 0.8, a * m * 0.55];
};
// Cage of Light: golden bars enclose the mon - the near bars pass in front.
AROUND.lightcage = (nx, ny, df, t, c) => {
  const s = 7;
  const idx = Math.floor(nx * s);
  const front = idx % 2 === 0;
  if (!front && df <= 0.01) {
    return [0, 0, 0, 0];
  }
  const wob = 0.015 * Math.sin(t * 1.2 + idx * 2);
  const bar = smooth(0.055, 0.02, Math.abs(fract(nx * s + wob) - 0.5));
  const env = smooth(0.02, 0.12, ny) * smooth(0.98, 0.88, ny);
  const pulse = 0.8 + 0.2 * Math.sin(t * 2.5 + idx);
  return [1 * pulse, 0.85 * pulse, 0.4 * pulse, bar * env * (front ? 0.9 : 0.5)];
};
// Chained: actual iron links - alternating flat and edge-on ovals - orbiting the body.
AROUND.chains = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = (ny - c.cy) * 1.25;
  const rr = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const front = dy > 0;
  if (!front && df <= 0.01) {
    return [0, 0, 0, 0];
  }
  const R = 0.38;
  const u = ((ang + t * 0.45) / (Math.PI * 2)) * 12;
  const li = Math.floor(u);
  const lu = (fract(u) - 0.5) * 0.2;
  const lv = rr - R;
  const flat = li % 2 === 0;
  const ringd = Math.abs(Math.hypot(lu / (flat ? 0.085 : 0.05), lv / (flat ? 0.035 : 0.014)) - 1);
  const link = smooth(0.55, 0.15, ringd);
  const glint = Math.pow(Math.max(0, Math.sin(ang * 6 + t * 2)), 10) * 0.45;
  const v = (front ? 0.58 : 0.32) + glint;
  return [v, v, clamp(v * 1.06), clamp(link * 1.4) * (front ? 0.95 : 0.55)];
};
// Feather Fall: big soft feathers rocking down, each with a visible quill.
AROUND.featherfall = (nx, ny, df, t) => {
  const cell = 5.5;
  const fy = ny - t * 0.09;
  const fx0 = nx + Math.sin((ny + t * 0.2) * 5) * 0.05;
  const cx0 = Math.floor(fx0 * cell);
  const cy0 = Math.floor(fy * cell);
  if (h2(cx0 * 1.3, cy0 * 2.3) < 0.72) {
    return [0, 0, 0, 0];
  }
  const rot = Math.sin(t * 2 + h2(cx0, cy0) * 8) * 0.7 + 0.5;
  const lx0 = (fract(fx0 * cell) - 0.5) * 2.1;
  const ly0 = (fract(fy * cell) - 0.5) * 2.1;
  const lx = lx0 * Math.cos(rot) - ly0 * Math.sin(rot);
  const ly = lx0 * Math.sin(rot) + ly0 * Math.cos(rot);
  const body = Math.hypot(lx / 0.42, ly / 0.16) < 1 && lx > -0.42 ? 1 : 0;
  const quill = Math.abs(ly) < 0.022 && Math.abs(lx) < 0.42 ? 0.3 : 0;
  const barbs = 0.85 + 0.15 * Math.sin(lx * 40 + ly * 8);
  const m = clamp(1 - df / 26);
  const v = (0.86 + h2(cy0, cx0) * 0.14) * barbs;
  return [clamp(v - quill), clamp(v - quill), clamp(v * 1.03 - quill), body * m * 0.92];
};
// Will-o-Wisps: teal spirit orbs with fading trails circling the mon.
AROUND.spiritorbs = (nx, ny, df, t, c) => {
  let a = 0;
  for (let i = 0; i < 3; i++) {
    const spd = 0.7 + i * 0.25;
    const rx = 0.26 + i * 0.07;
    const ry = 0.16 + i * 0.05;
    for (let k = 0; k < 5; k++) {
      const th = t * spd + i * 2.1 - k * 0.12;
      const px = c.cx + Math.cos(th) * rx;
      const py = c.cy + Math.sin(th * 1.3) * ry;
      const d = Math.hypot(nx - px, ny - py);
      a = Math.max(a, smooth(0.045, 0.005, d) * (1 - k / 5) * (k === 0 ? 1 : 0.5));
    }
  }
  return [0.45, 1.0, 0.9, clamp(a) * 0.95];
};
// Event Horizon: a black hole looms behind - dark disc, lensing ring, infalling streaks.
AROUND.eventhorizon = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = ny - c.cy;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const disc = smooth(0.01, -0.01, r - 0.17);
  const ring = smooth(0.02, 0.004, Math.abs(r - 0.19)) * (0.8 + 0.2 * Math.sin(ang * 3 + t));
  const spiral = smooth(0.55, 0.95, Math.sin(ang * 2 + Math.log(r + 0.05) * 10 + t * 1.5)) * smooth(0.42, 0.2, r) * smooth(0.16, 0.22, r);
  const col = mix3([0.01, 0.0, 0.03], [0.85, 0.6, 1.0], clamp(ring + spiral * 0.7));
  return [col[0], col[1], col[2], clamp(disc * 0.97 + ring * 0.9 + spiral * 0.5)];
};
// Card Storm: playing cards flipping end-over-end around the mon.
AROUND.cardstorm = (nx, ny, df, t) => {
  const cell = 7;
  const fy = ny + t * 0.12;
  const cx0 = Math.floor(nx * cell);
  const cy0 = Math.floor(fy * cell);
  if (h2(cx0 * 2.9, cy0 * 1.7) < 0.8) {
    return [0, 0, 0, 0];
  }
  const flip = Math.cos(t * 3 + h2(cx0, cy0) * 9);
  const lx = (fract(nx * cell) - 0.5) * 2.1;
  const ly = (fract(fy * cell) - 0.5) * 2.1;
  const card = Math.abs(lx) < 0.42 * Math.max(0.08, Math.abs(flip)) && Math.abs(ly) < 0.55 ? 1 : 0;
  const face = flip > 0;
  const pip = face && Math.hypot(lx / Math.max(0.12, Math.abs(flip)), ly) < 0.16 ? 1 : 0;
  const red = h2(cx0, cy0 + 1) > 0.5;
  const m = clamp(1 - df / 26);
  const base = face ? 0.97 : 0.4;
  return [
    clamp(base - pip * (red ? 0.1 : 0.85) + (face ? 0 : 0.1)),
    clamp(base - pip * 0.85),
    clamp(base - pip * 0.85 + (face ? 0 : 0.25)),
    card * m * 0.95,
  ];
};
// Coin Rain: spinning gold coins tumbling down.
AROUND.coinrain = (nx, ny, df, t) => {
  const cell = 9;
  const fy = ny - t * 0.28;
  const cx0 = Math.floor(nx * cell);
  const cy0 = Math.floor(fy * cell);
  if (h2(cx0 * 1.9, cy0 * 2.7) < 0.8) {
    return [0, 0, 0, 0];
  }
  const spin = Math.sin(t * 5 + h2(cx0, cy0) * 9);
  const lx = (fract(nx * cell) - 0.5) * 2.1;
  const ly = (fract(fy * cell) - 0.5) * 2.1;
  const w = Math.max(0.12, Math.abs(spin));
  const rd = Math.hypot(lx / w, ly / 0.42);
  const coin = rd < 1 ? 1 : 0;
  const rim = rd > 0.72 ? 0.28 : 0;
  const glint = Math.pow(Math.max(0, spin), 6) * (rd < 0.7 ? 1 : 0);
  const m = clamp(1 - df / 26);
  return [clamp(0.88 - rim + glint * 0.12), clamp(0.7 - rim + glint * 0.28), clamp(0.22 - rim * 0.1 + glint * 0.3), coin * m];
};
// Levitating Shards: crystal fragments bobbing in slow orbit.
AROUND.shardlevitate = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 6; i++) {
    const th = (i / 6) * Math.PI * 2 + t * 0.2;
    const px = c.cx + Math.cos(th) * (0.3 + h2(i, 1) * 0.1);
    const py = c.cy + Math.sin(th) * 0.2 + Math.sin(t * 1.5 + i * 1.7) * 0.03;
    const rot = t * 0.5 + i;
    const dx0 = nx - px;
    const dy0 = ny - py;
    const lx = dx0 * Math.cos(rot) - dy0 * Math.sin(rot);
    const ly = dx0 * Math.sin(rot) + dy0 * Math.cos(rot);
    const shard = Math.abs(lx) * 2.2 + Math.abs(ly) * 0.9 < 0.062 ? 1 : 0;
    if (shard) {
      const grad = clamp(0.6 + ly * 8);
      const glint = Math.pow(Math.max(0, Math.sin(t * 3 + i * 2)), 8) * 0.6;
      out = [clamp(0.55 * grad + glint), clamp(0.85 * grad + glint), clamp(1.0 * grad + glint), 0.95];
    } else {
      const halo = Math.pow(clamp(1 - Math.hypot(dx0, dy0) * 14), 2) * 0.3;
      if (halo > out[3]) {
        out = [0.5, 0.8, 1.0, halo];
      }
    }
  }
  const m = clamp(1 - df / 30);
  return [out[0], out[1], out[2], out[3] * m];
};
// Smoke Rings: lazy vapor toroids rising and widening.
AROUND.smokerings = (nx, ny, df, t, c) => {
  let a = 0;
  for (let i = 0; i < 3; i++) {
    const ph = fract(t * 0.14 + i / 3);
    const py = c.cy + 0.32 - ph * 0.75;
    const rw = 0.08 + ph * 0.3;
    const d = Math.abs(Math.hypot((nx - c.cx) / rw, (ny - py) / 0.045) - 1);
    a = Math.max(a, smooth(0.5, 0.1, d) * (1 - ph) * 0.7);
  }
  return [0.75, 0.75, 0.8, a];
};
// Radar Sweep: a green HUD ring with a sweeping wedge and blips.
AROUND.radarsweep = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = (ny - c.cy) * 1.1;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const ring = smooth(0.008, 0.0, Math.abs(r - 0.4)) + smooth(0.005, 0.0, Math.abs(r - 0.26)) * 0.5;
  const sweepd = fract((ang - t * 1.1) / (Math.PI * 2));
  const wedge = smooth(0.25, 0.0, sweepd) * smooth(0.44, 0.36, r) * 0.5;
  const blip = h2(Math.floor(nx * 20), Math.floor(ny * 20)) > 0.96 && r < 0.42 ? Math.pow(1 - sweepd, 3) : 0;
  const k = clamp(ring * 0.8 + wedge + blip);
  return [0.3, 1.0, 0.5, k * 0.85];
};
// Hell Sigil: a burning pentagram seal beneath the mon.
AROUND.hellsigil = (nx, ny, df, t, c) => {
  const ex = nx - c.cx;
  const ey = (ny - (c.cy + 0.34)) * 2.6;
  const r = Math.hypot(ex, ey);
  const ring = smooth(0.025, 0.0, Math.abs(r - 0.22));
  let star = 0;
  for (let i = 0; i < 5; i++) {
    const a1 = (i / 5) * Math.PI * 2 + t * 0.3;
    const a2 = (((i + 2) % 5) / 5) * Math.PI * 2 + t * 0.3;
    const x1 = Math.cos(a1) * 0.22;
    const y1 = Math.sin(a1) * 0.22;
    const x2 = Math.cos(a2) * 0.22;
    const y2 = Math.sin(a2) * 0.22;
    const ddx = x2 - x1;
    const ddy = y2 - y1;
    const tt = clamp(((ex - x1) * ddx + (ey - y1) * ddy) / (ddx * ddx + ddy * ddy));
    star = Math.max(star, smooth(0.012, 0.0, Math.hypot(ex - x1 - ddx * tt, ey - y1 - ddy * tt)));
  }
  const pulse = 0.7 + 0.3 * Math.sin(t * 2.8);
  return [1.0, 0.15, 0.08, clamp(ring + star) * pulse * 0.95];
};
// Laser Show: colored beams fanning from behind the mon.
AROUND.lasershow = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const ang = -Math.PI / 2 + (i - 2) * 0.35 + Math.sin(t * 0.9 + i) * 0.25;
    const dx = nx - c.cx;
    const dy = ny - (c.cy + 0.1);
    const along = dx * Math.cos(ang) + dy * Math.sin(ang);
    const across = -dx * Math.sin(ang) + dy * Math.cos(ang);
    if (along < 0.05) {
      continue;
    }
    const beam = smooth(0.012, 0.002, Math.abs(across)) * clamp(1 - along * 0.8);
    if (beam > out[3]) {
      const col = hsv2rgb(fract(i * 0.2 + t * 0.05), 0.9, 1);
      out = [col[0], col[1], col[2], beam];
    }
  }
  return [out[0], out[1], out[2], out[3] * 0.85];
};
// Glyph Rain: green data columns cascading behind the mon.
AROUND.glyphrain = (nx, ny, df, t) => {
  const gx = Math.floor(nx * 16);
  const ph = fract(ny * 1.4 - t * (0.45 + h2(gx, 1) * 0.5) + h2(gx, 3));
  const on = h2(gx, Math.floor(ny * 26) + Math.floor(t * 6)) > 0.45 ? 1 : 0;
  const head = smooth(0.1, 0.0, ph);
  const trail = smooth(0.5, 0.04, ph) * 0.6;
  const m = clamp(1 - df / 30);
  const k = (head + trail) * on * m;
  return [clamp(0.3 + head * 0.7), 1.0, 0.45, clamp(k) * 0.9];
};
// Ring of Fire: a burning ground ring encircling the feet.
AROUND.firering = (nx, ny, df, t, c) => {
  const ex = nx - c.cx;
  const ey = (ny - (c.fy ?? c.cy + 0.33)) * 2.7; // ring centered on the feet line
  const r = Math.hypot(ex, ey);
  const ang = Math.atan2(ey, ex);
  const n = fbm(ang * 1.6 + 5, t * 1.4);
  const lift = smooth(0.3, 0.0, Math.abs(r - 0.26)) * smooth(0.0, -0.35, ey) * n;
  const ring = smooth(0.05, 0.0, Math.abs(r - 0.26)) * (0.6 + 0.4 * n);
  const k = clamp(ring + lift * 1.6);
  return [...ramp(G.inferno, clamp(0.35 + k * 0.6)), clamp(k * 1.3)];
};
// Creeping Shadow: a dark pool below, tendrils climbing the air behind.
AROUND.creepingshadow = (nx, ny, df, t, c) => {
  const pool = smooth(0.45, 0.1, Math.hypot(nx - c.cx, (ny - (c.fy ?? c.cy + 0.36)) * 3.2)) * 0.85;
  const n = fbm(nx * 6 + 9, ny * 5 - t * 0.5);
  const tendril = clamp(n * clamp(1 - df / 12) * smooth(0.2, 0.7, ny) * 2.2 - 0.75);
  const a = clamp(pool + tendril);
  return [0.06, 0.02, 0.12, a * 0.92];
};
// Equalizer: audio bars bouncing along the ground line (= the feet line).
AROUND.equalizer = (nx, ny, df, t, c) => {
  const gy = (c?.fy ?? 0.96) + 0.02;
  const gx = Math.floor(nx * 18);
  const hgt = 0.06 + 0.2 * h2(gx, Math.floor(t * 5)) * (0.6 + 0.4 * Math.sin(t * 3 + gx));
  const bar = Math.abs(fract(nx * 18) - 0.5) < 0.32 && ny > gy - hgt && ny < gy + 0.01 ? 1 : 0;
  const m = clamp(1 - df / 26);
  const col = hsv2rgb(mix(0.35, 0.0, clamp(hgt / 0.26)), 0.9, 1);
  return [col[0], col[1], col[2], bar * m * 0.95];
};
// Confetti: fat multicolor scraps tumbling down thick. Party time.
AROUND.confetti = (nx, ny, df, t) => {
  const m = clamp(1 - df / 28);
  for (let layer = 0; layer < 2; layer++) {
    const cell = 8 + layer * 4;
    const fy = ny - t * (0.18 + layer * 0.08);
    const fx0 = nx + Math.sin((ny + t * 0.4) * 6 + layer * 2) * 0.025;
    const cx0 = Math.floor(fx0 * cell);
    const cy0 = Math.floor(fy * cell);
    if (h2(cx0 * 1.7 + layer * 9, cy0 * 2.1) < 0.55) {
      continue;
    }
    const rot = t * 3 + h2(cx0, cy0) * 9;
    const lx0 = (fract(fx0 * cell) - 0.5) * 2.2;
    const ly0 = (fract(fy * cell) - 0.5) * 2.2;
    const lx = lx0 * Math.cos(rot) - ly0 * Math.sin(rot);
    const ly = lx0 * Math.sin(rot) + ly0 * Math.cos(rot);
    const flutter = Math.max(0.25, Math.abs(Math.sin(rot * 1.4)));
    if (Math.abs(lx) < 0.4 && Math.abs(ly) < 0.16 * flutter) {
      const col = hsv2rgb(fract(h2(cy0, cx0) * 5), 0.9, 1);
      const shade = 0.7 + 0.3 * Math.sin(rot);
      return [col[0] * shade, col[1] * shade, col[2] * shade, m];
    }
  }
  return [0, 0, 0, 0];
};
// Personal Raincloud: a gloomy cloud rains on the mon alone.
AROUND.raincloud = (nx, ny, df, t, c) => {
  const cy0 = c.cy - 0.42;
  let cloud = 0;
  for (const [ox, s] of [
    [-0.1, 0.09],
    [0.0, 0.12],
    [0.1, 0.08],
  ]) {
    cloud = Math.max(cloud, smooth(s, s * 0.4, Math.hypot(nx - c.cx - ox, (ny - cy0) * 1.6)));
  }
  const puff = fbm(nx * 8 + t * 0.2, ny * 8) * 0.35;
  const colr = Math.floor(nx * 44);
  const under = ny > cy0 + 0.05 && ny < c.cy + 0.35 && Math.abs(nx - c.cx) < 0.15;
  const rph = fract(ny * 3.2 - t * 2.4 + h2(colr, 1));
  const drop = under && h2(colr, 3) > 0.35 ? smooth(0.0, 0.05, rph) * smooth(0.22, 0.05, rph) * 0.75 : 0;
  const flash = h2(Math.floor(t * 1.8), 5) > 0.88 ? smooth(0.6, 0.95, fract(t * 1.8)) * cloud : 0;
  const v = 0.38 + puff * 0.3 + flash * 1.4;
  return [clamp(v * 0.95), clamp(v * 0.95), clamp(v * 1.08), clamp(cloud * (0.75 + puff) + drop + flash * 0.5)];
};
// Portal: a swirling violet gateway stands open behind the mon.
AROUND.portal = (nx, ny, df, t, c) => {
  const dx = (nx - c.cx) / 0.2;
  const dy = (ny - c.cy) / 0.32;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const rim = smooth(0.12, 0.02, Math.abs(r - 1)) * (0.8 + 0.2 * Math.sin(ang * 5 + t * 3));
  const inner = r < 1 ? smooth(0.3, 0.9, fbm(ang * 0.8 + t * 0.4, r * 3 - t * 0.6)) * (1 - r * 0.5) : 0;
  const col = mix3(hx("1a0430"), hx("c04aff"), clamp(rim + inner * 0.7));
  return [col[0], col[1], col[2], clamp(rim * 0.95 + inner * 0.8)];
};
// Manga Burst: comic speedlines radiating out from the mon.
AROUND.speedlines = (nx, ny, df, t, c) => {
  const ang = Math.atan2(ny - c.cy, nx - c.cx);
  const sector = Math.floor(((ang / (Math.PI * 2)) + 0.5) * 44);
  const ln = h2(sector, 3 + Math.floor(t * 2));
  const thin = smooth(0.35, 0.9, Math.pow(Math.max(0, Math.cos((((ang / (Math.PI * 2)) + 0.5) * 44 - sector - 0.5) * Math.PI)), 8));
  const r = Math.hypot(nx - c.cx, ny - c.cy);
  const reach = smooth(0.24 + ln * 0.12, 0.34 + ln * 0.12, r);
  return [0.95, 0.95, 0.98, thin * reach * (ln > 0.25 ? 0.85 : 0)];
};
// Lock-On: a targeting reticle spinning around the mon.
AROUND.lockon = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = (ny - c.cy) * 1.15;
  const r = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx) + t * 0.9;
  const dash = fract((ang / (Math.PI * 2)) * 4) < 0.6 ? 1 : 0;
  const ring = smooth(0.012, 0.002, Math.abs(r - 0.34)) * dash;
  const tick = Math.pow(Math.max(0, Math.cos(ang * 4)), 60) * smooth(0.035, 0.008, Math.abs(r - 0.34)) * 1.5;
  const pulse = 0.75 + 0.25 * Math.sin(t * 5);
  return [0.3, 1.0, 0.95, clamp(ring + tick) * pulse * 0.9];
};
// Hex Barrier: a hexfield dome shimmers around the whole mon.
AROUND.hexdome = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = (ny - c.cy) * 1.12;
  const r = Math.hypot(dx, dy);
  if (r > 0.5) {
    return [0, 0, 0, 0];
  }
  const rim = smooth(0.05, 0.0, Math.abs(r - 0.44)) * (0.7 + 0.3 * Math.sin(t * 2));
  const s = 14;
  const qx = (nx * s) / 1.5;
  const qy = ny * s * 0.866 - qx * 0.5;
  const hx0 = Math.round(qx);
  const hy0 = Math.round(qy);
  const lx = (qx - hx0) * 1.5;
  const ly = (qy - hy0 + (qx - hx0) * 0.5) * 1.155;
  const hd = Math.max(Math.abs(lx) * 0.866 + Math.abs(ly) * 0.5, Math.abs(ly));
  const grid = smooth(0.38, 0.46, hd) * smooth(0.48, 0.38, r) * 0.12;
  const ripple = smooth(0.05, 0.0, Math.abs(r - fract(t * 0.45) * 0.48)) * smooth(0.38, 0.46, hd) * 0.5;
  return [0.4, 0.9, 1.0, clamp(rim * 0.9 + grid + ripple)];
};
// Guardian Wings: two arcs of soft light unfurl behind the shoulders.
AROUND.guardianwings = (nx, ny, df, t, c) => {
  let a = 0;
  const flap = 1 + 0.08 * Math.sin(t * 1.4);
  for (const s of [-1, 1]) {
    const dx = (nx - (c.cx + s * 0.2)) / (0.13 * flap);
    const dy = (ny - (c.cy - 0.06)) / (0.3 * flap);
    const r = Math.hypot(dx, dy);
    const outer = Math.sign(dx) === s;
    if (!outer) {
      continue;
    }
    a = Math.max(a, smooth(0.4, 0.05, Math.abs(r - 1)) * clamp(1.1 - ny));
  }
  return [1.0, 0.96, 0.8, a * 0.7];
};
// Snow Globe: the mon sealed in a glass globe with drifting snow.
AROUND.snowglobe = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = ny - c.cy;
  const r = Math.hypot(dx, dy);
  const R = 0.46;
  const rim = smooth(0.012, 0.002, Math.abs(r - R));
  const glint = smooth(0.1, 0.02, Math.hypot(nx - (c.cx - 0.2), ny - (c.cy - 0.28))) * 0.5;
  let flake = 0;
  if (r < R) {
    const sc = 22;
    const fx0 = nx + Math.sin((ny + t * 0.25) * 5) * 0.03;
    const fy = ny - t * 0.13;
    const scx = Math.floor(fx0 * sc);
    const scy = Math.floor(fy * sc);
    if (h2(scx * 1.1, scy * 1.7) > 0.86) {
      const slx = fract(fx0 * sc) - (h2(scx + 3, scy) * 0.5 + 0.25);
      const sly = fract(fy * sc) - (h2(scx, scy + 5) * 0.5 + 0.25);
      flake = Math.pow(clamp(1 - Math.hypot(slx, sly) * 3.4), 2);
    }
  }
  const base = smooth(0.03, 0.0, Math.abs(ny - (c.cy + R * 0.9))) * smooth(0.4, 0.2, Math.abs(dx));
  return [0.92, 0.95, 1.0, clamp(rim * 0.9 + glint + flake * 0.95 + base * 0.6)];
};
// Orbit Debris: chunks of rock tumbling around the mon.
AROUND.orbitdebris = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const th = t * (0.35 + h2(i, 2) * 0.3) + i * 1.26;
    const px = c.cx + Math.cos(th) * (0.3 + h2(i, 1) * 0.08);
    const py = c.cy + Math.sin(th) * (0.13 + h2(i, 3) * 0.04);
    const front = Math.sin(th) > 0;
    if (!front && df <= 0.01) {
      continue;
    }
    const d = Math.hypot(nx - px, ny - py);
    const rad = 0.02 + h2(i, 5) * 0.015;
    const lump = rad * (0.8 + 0.35 * Math.sin(Math.atan2(ny - py, nx - px) * 5 + i));
    const rock = smooth(lump, lump * 0.6, d);
    if (rock > out[3]) {
      const v = (front ? 0.55 : 0.3) * (0.7 + 0.3 * Math.sin(i * 3 + t));
      out = [v, clamp(v * 0.92), clamp(v * 0.8), rock];
    }
  }
  return out;
};
// Star Ring: big golden stars orbiting the mon with sparkle trails, front and behind.
AROUND.starcircle = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 6; i++) {
    const th = t * 0.7 + (i / 6) * Math.PI * 2;
    const px = c.cx + Math.cos(th) * 0.31;
    const py = c.cy + Math.sin(th) * 0.13;
    const front = Math.sin(th) > 0;
    if (!front && df <= 0.01) {
      continue;
    }
    const s = _starSdf((nx - px) / 0.085, (ny - py) / 0.085, 5, th);
    const glow = Math.pow(clamp(1 - Math.hypot(nx - px, ny - py) / 0.09), 2) * 0.4;
    let k = clamp(s + glow) * (front ? 1 : 0.55);
    for (let tr = 1; tr <= 3; tr++) {
      const th2 = th - tr * 0.09;
      const tx = c.cx + Math.cos(th2) * 0.31;
      const ty = c.cy + Math.sin(th2) * 0.13;
      k = Math.max(k, Math.pow(clamp(1 - Math.hypot(nx - tx, ny - ty) / 0.035), 2) * (1 - tr / 4) * (front ? 0.7 : 0.35));
    }
    if (k > out[3]) {
      const v = front ? 1 : 0.55;
      out = [v, 0.88 * v, 0.45 * v, k];
    }
  }
  return out;
};
// Falling Star: one grand shooting star sails past, again and again.
AROUND.fallingstar = (nx, ny, df, t) => {
  const ph = fract(t * 0.22);
  const px = -0.2 + ph * 1.5;
  const py = 0.12 + ph * 0.3;
  const dx = nx - px;
  const dy = ny - py;
  const head = Math.pow(clamp(1 - Math.hypot(dx, dy) * 9), 4);
  const along = dx * -0.98 + dy * -0.2;
  const across = dx * 0.2 + dy * -0.98;
  const trail = along > 0 && along < 0.4 ? smooth(0.02, 0.002, Math.abs(across)) * (1 - along / 0.4) * 0.8 : 0;
  const sparkle = trail > 0 && h2(Math.floor(nx * 50), Math.floor(ny * 50) + Math.floor(t * 12)) > 0.85 ? 0.6 : 0;
  const vis = smooth(0.0, 0.06, ph) * smooth(1.0, 0.85, ph);
  return [1, 0.95, 0.75, clamp(head + trail + sparkle) * vis];
};
// Zero-G Lift: rocks and dust visibly floating upward, shaded like debris.
AROUND.gravitylift = (nx, ny, df, t) => {
  const m = clamp(1 - df / 26);
  for (let layer = 0; layer < 2; layer++) {
    const cell = 7 + layer * 5;
    const fy = ny + t * (0.09 + layer * 0.05);
    const fx0 = nx + Math.sin(t * 0.7 + Math.floor(fy * cell) * 2) * 0.015;
    const cx0 = Math.floor(fx0 * cell);
    const cy0 = Math.floor(fy * cell);
    if (h2(cx0 * 1.7 + layer * 3, cy0 * 1.9) < 0.7) {
      continue;
    }
    const lx = (fract(fx0 * cell) - 0.5) * 2;
    const ly = (fract(fy * cell) - 0.5) * 2;
    const wob = 0.75 + 0.35 * Math.sin(Math.atan2(ly, lx) * 4 + h2(cx0, cy0) * 12);
    const rad = (0.2 + h2(cy0, cx0) * 0.2) * wob;
    if (Math.hypot(lx, ly) < rad) {
      const lit = clamp(0.55 - ly * 1.4);
      const v = (0.4 + h2(cx0 + 1, cy0) * 0.3) * (0.6 + lit);
      return [clamp(v), clamp(v * 0.93), clamp(v * 0.82), m * 0.95];
    }
  }
  return [0, 0, 0, 0];
};
// Shock Pulse: the mon's own silhouette echoes outward as energy rings.
AROUND.shockpulse = (nx, ny, df, t) => {
  let a = 0;
  for (let i = 0; i < 2; i++) {
    const ph = fract(t * 0.6 + i * 0.5);
    const iso = df / 20 - ph;
    a = Math.max(a, smooth(0.09, 0.0, Math.abs(iso)) * (1 - ph));
  }
  return [0.55, 0.95, 1.0, a * 0.85];
};
// Fog Bank: two drifting fog layers. The back layer swallows the midsection
// behind the mon (as before); a second FRONT layer (fogbank is in AROUND_OVERLAY,
// so it also draws OVER the sprite, df=0 there) drifts the other way and gets
// steadily thicker toward the bottom of the box.
AROUND.fogbank = (nx, ny, df, t) => {
  const n2 = fbm(nx * 2.4 + t * 0.14 + 9.2, ny * 4.6 + 3.7);
  const grow = smooth(0.34, 0.98, ny);
  const front = clamp(n2 * 1.45 - 0.3 + grow * 0.3) * grow * 0.9;
  if (df < 0.5) {
    // overlay pass: only the front layer covers the mon
    return [0.9, 0.92, 0.96, front];
  }
  const n = fbm(nx * 3 - t * 0.18, ny * 6);
  const band = smooth(0.32, 0.55, ny) * smooth(0.95, 0.72, ny);
  const m = clamp(1 - df / 36);
  const back = clamp(n * band * 1.6 - 0.25) * m * 0.85;
  const a = clamp(back + front * (1 - back * 0.5));
  const fmix = a > 0 ? clamp(front / (front + back + 1e-6)) : 0;
  return [mix(0.85, 0.9, fmix), mix(0.87, 0.92, fmix), mix(0.92, 0.96, fmix), a];
};
// Comet Orbit: a blazing head with a long ember tail circles through the scene.
AROUND.cometorbit = (nx, ny, df, t, c) => {
  const th = t * 1.1;
  let out = [0, 0, 0, 0];
  for (let k = 0; k < 14; k++) {
    const a = th - k * 0.06;
    const px = c.cx + Math.cos(a) * 0.33;
    const py = c.cy + Math.sin(a) * 0.15;
    const front = Math.sin(a) > 0;
    if (!front && df <= 0.01) {
      continue;
    }
    const fade = 1 - k / 14;
    const rad = k === 0 ? 0.05 : 0.032 * fade + 0.008;
    const d = Math.hypot(nx - px, ny - py);
    const jit = k === 0 ? 1 : 0.7 + h2(k, Math.floor(t * 8)) * 0.5;
    const dot = Math.pow(clamp(1 - d / rad), 1.6) * fade * jit * (front ? 1 : 0.5);
    if (dot > out[3]) {
      const col = k === 0 ? [1, 0.98, 0.9] : mix3([1, 0.8, 0.3], [0.9, 0.3, 0.08], k / 14);
      out = [col[0], col[1], col[2], dot];
    }
  }
  return out;
};
// Petal Vortex: cherry petals caught in a slow cyclone around the body.
AROUND.petalvortex = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 12; i++) {
    const spd = 0.7 + h2(i, 1) * 0.5;
    const a = t * spd + i * 0.53;
    const rr = 0.16 + h2(i, 2) * 0.24 + 0.03 * Math.sin(t * 2 + i);
    const lift = fract(t * 0.09 + h2(i, 3));
    const px = c.cx + Math.cos(a) * rr;
    const py = c.cy + 0.3 - lift * 0.62 + Math.sin(a) * rr * 0.3;
    const rot = a * 2.2;
    const dx0 = nx - px;
    const dy0 = ny - py;
    const lx = dx0 * Math.cos(rot) - dy0 * Math.sin(rot);
    const ly = dx0 * Math.sin(rot) + dy0 * Math.cos(rot);
    if (Math.hypot(lx / 0.028, ly / 0.016) < 1) {
      const shade = 0.85 + 0.15 * Math.sin(rot);
      out = [1 * shade, (0.68 + h2(i, 4) * 0.18) * shade, 0.85 * shade, 0.95];
    }
  }
  const m = clamp(1 - df / 28);
  return [out[0], out[1], out[2], out[3] * m];
};
// Ember Spiral: fire motes climbing a spiral path around the mon, front and behind.
AROUND.emberspiral = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 14; i++) {
    const ph = fract(t * 0.2 + i / 14);
    const a = ph * Math.PI * 5 + i * 1.7;
    const front = Math.sin(a) > 0;
    if (!front && df <= 0.01) {
      continue;
    }
    const px = c.cx + Math.cos(a) * (0.25 + ph * 0.05);
    const py = c.cy + 0.32 - ph * 0.66;
    const d = Math.hypot(nx - px, ny - py);
    const size = 0.055 * (1 - ph * 0.45);
    const dot = Math.pow(clamp(1 - d / size), 2) * (1 - ph * 0.3);
    const tw = 0.7 + 0.3 * Math.sin(t * 6 + i * 3);
    const kk = dot * tw * (front ? 1 : 0.5);
    if (kk > out[3]) {
      out = [1, clamp(0.5 + ph * 0.35), 0.12, kk];
    }
  }
  return out;
};
// Rune Orbit: glowing sigil plates wheeling around the mon, front and behind.
AROUND.runeorbit = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const a = t * 0.6 + (i / 5) * Math.PI * 2;
    const front = Math.sin(a) > 0;
    if (!front && df <= 0.01) {
      continue;
    }
    const px = c.cx + Math.cos(a) * 0.32;
    const py = c.cy + Math.sin(a) * 0.14;
    const lx = (nx - px) / 0.055;
    const ly = (ny - py) / 0.07;
    if (Math.abs(lx) > 1.6 || Math.abs(ly) > 1.6) {
      continue;
    }
    const id = h2(i * 3.3, 7.7);
    let st = smooth(0.24, 0.08, Math.abs(lx));
    st = Math.max(st, smooth(0.22, 0.06, Math.abs(ly - (id - 0.5))));
    st = Math.max(st, smooth(0.22, 0.06, Math.abs(ly - lx * (id > 0.5 ? 0.7 : -0.7))));
    const inPlate = smooth(1.05, 0.9, Math.max(Math.abs(lx), Math.abs(ly)));
    const halo = Math.pow(clamp(1 - Math.hypot(lx, ly) / 1.6), 2) * 0.3;
    const pulse = 0.7 + 0.3 * Math.sin(t * 3 + i * 2);
    const kk = clamp(st * inPlate + inPlate * 0.2 + halo) * pulse * (front ? 1 : 0.5);
    if (kk > out[3]) {
      out = [0.45, 1.0, 0.85, kk];
    }
  }
  return out;
};
// Prism Rain: falling crystal slivers flashing rainbow as they catch the light.
AROUND.prismrain = (nx, ny, df, t) => {
  const cell = 8;
  const fy = ny - t * 0.28;
  const cx0 = Math.floor(nx * cell);
  const cy0 = Math.floor(fy * cell);
  if (h2(cx0 * 1.9, cy0 * 1.3) < 0.68) {
    return [0, 0, 0, 0];
  }
  const lx = (fract(nx * cell) - 0.5) * 2;
  const ly = (fract(fy * cell) - 0.5) * 2;
  const tilt = (h2(cx0, cy0) - 0.5) * 1.2;
  const sx = lx + ly * tilt;
  const sliver = Math.abs(sx) < 0.11 && Math.abs(ly) < 0.5 ? 1 : 0;
  const flash = Math.pow(0.5 + 0.5 * Math.sin(t * 4 + h2(cy0, cx0) * 20), 3);
  const glow = Math.pow(clamp(1 - Math.hypot(sx, ly) * 1.8), 3) * flash * 0.4;
  const col = mix3([0.8, 0.92, 1], hsv2rgb(fract(h2(cx0, cy0) + t * 0.15), 0.85, 1), flash);
  const m = clamp(1 - df / 26);
  return [col[0], col[1], col[2], clamp(sliver * (0.5 + 0.5 * flash) + glow) * m];
};
// Lightning Zaps: jagged bolts snap off the body in random directions, briefly
// and not too often - most of the time nothing shows. Each bolt has a random
// length (0.5x-1.5x), and every fired bolt chains: a 20% roll spawns one more in
// the same instant, re-rolled recursively (hard cap 10 total) - so now and then
// the mon overcharges and bursts with bolts. Bolts also roll a DEPTH: ~45% are
// FRONT bolts that arc over the sprite (zaps is in AROUND_OVERLAY; the overlay
// pass calls with df=0), the rest stay behind the mon.
AROUND.zaps = (nx, ny, df, t, c) => {
  const onBody = df <= 0.01;
  const dx = nx - c.cx;
  const dy = ny - c.cy;
  const r = Math.hypot(dx, dy);
  if (r < 0.03) {
    return [0, 0, 0, 0];
  }
  const angP = Math.atan2(dy, dx);
  let a = 0;
  let hot = 0;
  const MAXB = 10;
  let budget = MAXB;
  for (let k = 0; k < 2 && budget > 0; k++) {
    const cyc = t * 1.3 + k * 0.41 + h2(k + 1 + FXSEED, 9.2) * 5;
    const slot = Math.floor(cyc);
    // most windows stay empty (the 2nd base bolt much more so)
    if (h2(slot * 1.31 + 0.17 + FXSEED, 11 + k * 7) > (k === 0 ? 0.45 : 0.22)) {
      continue;
    }
    const life = fract(cyc);
    const flash = smooth(0.0, 0.03, life) * smooth(0.3, 0.12, life);
    if (flash <= 0.02) {
      continue;
    }
    for (let j = 0; j < MAXB && budget > 0; j++) {
      // the window's first bolt always draws; each extra needs a fresh 20% roll
      if (j > 0 && h2(slot * 2.7 + j * 13.3 + FXSEED, 29 + k * 5) > 0.2) {
        break;
      }
      budget--;
      const front = h2(slot * 3.1 + j * 19 + k * 7.3, 4.9) < 0.45;
      if (onBody && !front) {
        continue; // behind the mon
      }
      const fl2 = flash * (0.7 + 0.3 * h2(slot + j * 7, k + 3.3));
      const ang0 = h2(slot + k * 17 + j * 39 + FXSEED * 1.3, 3.7) * Math.PI * 2;
      const len = 0.5 + h2(slot + j * 23, k * 9 + 6.1); // 0.5x .. 1.5x
      let da = angP - ang0;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 1.2) {
        continue;
      }
      // jagged perpendicular displacement along the ray, finer kinks on top
      const jig =
        (vnoise(r * 26 + slot * 5.13 + j * 61, slot * 9.7 + k * 37.1 + j * 17) - 0.5) * 0.09 * Math.min(1, r * 7) +
        (vnoise(r * 70 + slot * 3.7 + j * 31, slot * 4.3 + k * 23.7) - 0.5) * 0.022;
      const off = Math.abs(r * Math.sin(da) - jig);
      const width = 0.011 + r * 0.01;
      const reach = smooth(0.55 * len, 0.42 * len, r);
      const beam = smooth(width, width * 0.25, off) * reach;
      const glow = smooth(width * 4.5, width, off) * reach * 0.3;
      const kk = (beam + glow) * fl2;
      if (kk > a) {
        a = kk;
        hot = smooth(0.26, 0.08, r);
      }
    }
  }
  return [mix(0.78, 1, hot), mix(0.88, 1, hot), 1, clamp(a) * 0.95];
};
// Sakura Blossoms: five-petal cherry blossoms drifting gently down with a lazy
// sway, loose petals fluttering between them.
AROUND.blossoms = (nx, ny, df, t, c) => {
  const m = clamp(1 - df / 30);
  if (m <= 0) {
    return [0, 0, 0, 0];
  }
  let out = [0, 0, 0, 0];
  for (let layer = 0; layer < 2; layer++) {
    const cell = (layer === 0 ? 5 : 8) * FXSCALE;
    const fall = layer === 0 ? 0.05 : 0.085;
    const fy = ny - t * fall;
    const fx0 = nx + Math.sin(ny * 2.2 + t * 0.4 + layer * 2.6) * 0.035;
    const cx0 = Math.floor(fx0 * cell);
    const cy0 = Math.floor(fy * cell);
    if (h2(cx0 * 1.7 + layer * 13.1 + FXSEED, cy0 * 2.3 + layer * 7.7 - FXSEED) < (layer === 0 ? 0.62 : 0.55)) {
      continue;
    }
    const jx = 0.3 + h2(cx0 + 4.2, cy0 + 1.1) * 0.4;
    const jy = 0.3 + h2(cx0 + 8.8, cy0 + 3.3) * 0.4;
    const lx = fract(fx0 * cell) - jx;
    const ly = fract(fy * cell) - jy;
    const spin = t * (0.5 + h2(cx0, cy0 + 9) * 0.6) * (h2(cx0 + 2, cy0) > 0.5 ? 1 : -1) + h2(cx0, cy0) * 6;
    if (layer === 0) {
      // a full five-petal blossom, slowly rotating
      const R = 0.18 + h2(cx0 + 1, cy0 + 5) * 0.07;
      const d = Math.hypot(lx, ly);
      const ang = Math.atan2(ly, lx);
      const rr = R * (0.58 + 0.42 * Math.abs(Math.cos((ang - spin * 0.5) * 2.5)));
      if (d < rr && out[3] < 0.95) {
        const rim = smooth(0.5, 1.0, d / rr);
        const col = mix3(hx("ffe3ee"), hx("ff9ec8"), rim);
        const heart = smooth(0.32, 0.1, d / R);
        const cc = mix3(col, hx("ffd23a"), heart * 0.5);
        out = [cc[0], cc[1], cc[2], 0.95];
      }
    } else {
      // a single loose petal, fluttering end over end
      const ca = Math.cos(spin);
      const sa2 = Math.sin(spin);
      const px2 = lx * ca - ly * sa2;
      const py2 = lx * sa2 + ly * ca;
      const flut = Math.max(0.3, Math.abs(Math.sin(spin * 1.3)));
      if (Math.hypot(px2 / 0.16, py2 / (0.09 * flut)) < 1 && out[3] < 0.85) {
        const shade = 0.82 + 0.18 * Math.sin(spin);
        out = [shade, 0.72 * shade, 0.85 * shade, 0.85];
      }
    }
  }
  return [out[0], out[1], out[2], out[3] * m];
};
// Paper Lanterns: warm glowing lanterns floating up around the mon.
AROUND.paperlanterns = (nx, ny, df, t) => {
  const cell = 6;
  const fy = ny + t * 0.07;
  const fx0 = nx + Math.sin(t * 0.5 + Math.floor(fy * cell)) * 0.02;
  const cx0 = Math.floor(fx0 * cell);
  const cy0 = Math.floor(fy * cell);
  if (h2(cx0 * 2.1, cy0 * 2.9) < 0.8) {
    return [0, 0, 0, 0];
  }
  const lx = (fract(fx0 * cell) - 0.5) * 2.2;
  const ly = (fract(fy * cell) - 0.5) * 2.2;
  const sway = Math.sin(t * 1.2 + cx0 * 2) * 0.06;
  const bx = lx - sway;
  const body = Math.pow(Math.abs(bx / 0.28), 3) + Math.pow(Math.abs(ly / 0.36), 3) < 1 ? 1 : 0;
  const cap = Math.abs(ly + 0.4) < 0.045 && Math.abs(bx) < 0.16 ? 1 : 0;
  const base = Math.abs(ly - 0.4) < 0.04 && Math.abs(bx) < 0.14 ? 1 : 0;
  const rib = body && Math.abs(Math.sin(bx * 16)) > 0.88 ? 0.18 : 0;
  const inner = Math.pow(clamp(1 - Math.hypot(bx, ly) * 2.2), 2);
  const glow = Math.pow(clamp(1 - Math.hypot(bx, ly) * 1.3), 2) * 0.45;
  const warm = 0.78 + 0.22 * Math.sin(t * 2 + h2(cx0, cy0) * 9);
  const m = clamp(1 - df / 28);
  if (cap || base) {
    return [0.45 * warm, 0.2 * warm, 0.1 * warm, 0.95 * m];
  }
  if (body) {
    return [
      clamp((0.95 + inner * 0.05) * warm - rib),
      clamp((0.5 + inner * 0.4) * warm - rib),
      clamp((0.18 + inner * 0.25) * warm - rib),
      0.95 * m,
    ];
  }
  return [1, 0.7, 0.3, glow * warm * m];
};

// --- v8 exotic batch (around) ---
// Magnetosphere: dipole field lines loop from pole to pole around the body,
// shimmering as charge slides along them (iso-bands of the dipole stream function).
AROUND.magnetosphere = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = ny - c.cy;
  const rr = Math.hypot(dx, dy) + 1e-3;
  const psi = (dx * dx) / (rr * rr) / rr;
  const iso = Math.abs(fract(psi * 1.1 + 0.5) - 0.5) * 2;
  const line = smooth(0.16, 0.03, iso);
  const flow = 0.5 + 0.5 * Math.sin(t * 1.8 - psi * 9);
  const m = clamp(1 - df / 30) * smooth(0.08, 0.2, rr);
  return [0.42, 0.78, 1.0, line * (0.4 + 0.6 * flow) * m * 0.6];
};
// Sun Dogs: the 22-degree ice halo ring with two bright parhelia flanking the mon,
// crystals glinting along the circle.
AROUND.sundogs = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = (ny - (c.cy - 0.04)) * 1.06;
  const rr = Math.hypot(dx, dy);
  const R = 0.3;
  const shim = 0.55 + 0.45 * Math.sin(Math.atan2(dy, dx) * 5 + t * 0.7);
  const halo = smooth(0.016, 0.004, Math.abs(rr - R)) * shim * 0.55;
  const dL = Math.hypot(nx - (c.cx - R), ny - (c.cy - 0.04));
  const dR = Math.hypot(nx - (c.cx + R), ny - (c.cy - 0.04));
  const dogs = smooth(0.05, 0.008, Math.min(dL, dR)) * (0.7 + 0.3 * Math.sin(t * 1.3));
  const col = mix3(hx("cfe4ff"), hx("fff3cf"), clamp(dogs * 1.4));
  return [col[0], col[1], col[2], clamp(halo + dogs) * clamp(1 - df / 40) * 0.85];
};
// Light Pillars: tall shimmering columns of light at seeded positions - the
// ice-crystal optics of a freezing night.
AROUND.lightpillars = (nx, ny, df, t) => {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const px = 0.16 + i * 0.225 + (h2(i, 3 + FXSEED) - 0.5) * 0.08;
    const w = 0.005 + h2(i, 9) * 0.008;
    const pillar = smooth(w * 3.2, w * 0.4, Math.abs(nx - px));
    const flick = 0.45 + 0.55 * Math.sin(t * (0.9 + h2(i, 5) * 1.3) + h2(i, 7) * 20);
    const vert = smooth(0.05, 0.22, ny) * smooth(0.98, 0.72, ny);
    a = Math.max(a, pillar * vert * (0.2 + 0.8 * flick));
  }
  return [0.72, 0.86, 1.0, a * clamp(1 - df / 40) * 0.55];
};
// Koi Pond: three koi circle the mon at different depths - near fish sweep IN
// FRONT of the body (overlay pass), far fish stay behind; a ripple marks the lane.
AROUND.koipond = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const rad = 0.17 + i * 0.068;
    const dir = i % 2 === 0 ? 1 : -1;
    const th = t * (0.5 - i * 0.09) * dir + i * 2.4;
    const px = c.cx + Math.cos(th) * rad;
    const py = c.cy + Math.sin(th) * rad * 0.85;
    const front = Math.sin(th) * dir > 0;
    if (!front && df <= 0.01) {
      continue;
    }
    const hdx = -Math.sin(th) * dir;
    const hdy = Math.cos(th) * dir * 0.85;
    const hl = Math.hypot(hdx, hdy) + 1e-5;
    const ux = hdx / hl;
    const uy = hdy / hl;
    const lx = (nx - px) * ux + (ny - py) * uy;
    const ly = -(nx - px) * uy + (ny - py) * ux;
    const wig = Math.sin(t * 5.5 + i * 3.1) * 0.006 * clamp(1 - lx * 30, 0.3, 1.4);
    // koi SDF: body ellipse + trailing tail-fin ellipse + small head bump
    const body = Math.hypot(lx / 0.036, (ly - wig) / 0.013) - 1;
    const tail = Math.hypot((lx + 0.052) / 0.024, (ly - wig * 2.2) / 0.011) - 1;
    const d = Math.min(body, tail);
    const f = smooth(0.35, -0.2, d);
    if (f <= 0) {
      continue;
    }
    // koi patterning: white base with orange-gold patches along the back
    const patch = h2(i + FXSEED, Math.floor((lx + 0.06) * 90)) > 0.45 ? 1 : 0;
    const back = smooth(0.002, 0.008, -(ly - wig));
    const kcol = mix3(hx("f2ede2"), hx("e87a1a"), clamp(patch * back * 1.2 + 0.08 * back));
    const shade = front ? 1 : 0.5;
    const a = f * (front ? 0.95 : 0.55);
    if (a > out[3]) {
      out = [kcol[0] * shade, kcol[1] * shade, kcol[2] * shade, a];
    }
  }
  const rip =
    smooth(0.012, 0.003, Math.abs(Math.hypot(nx - c.cx, (ny - c.cy) * 1.18) - 0.235))
    * (0.4 + 0.6 * Math.sin(t * 1.6 + nx * 24))
    * 0.14;
  const m = df > 0.01 ? clamp(1 - df / 34) : 1;
  return [
    out[0] + rip * 0.6,
    out[1] + rip * 0.75,
    out[2] + rip * 0.9,
    clamp(out[3] * m + rip * clamp(1 - df / 30)),
  ];
};
// Ring System: a tilted, banded ring plane girdles the mon - the near arc sweeps
// in FRONT (overlay pass), Cassini-style gaps split the rings.
AROUND.saturnrings = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = ny - (c.cy + 0.07);
  const rr = Math.hypot(dx, dy / 0.38);
  const R0 = 0.24;
  const R1 = 0.37;
  if (rr < R0 * 0.9 || rr > R1 * 1.12) {
    return [0, 0, 0, 0];
  }
  const front = dy > 0;
  if (!front && df <= 0.01) {
    return [0, 0, 0, 0];
  }
  const band = (rr - R0) / (R1 - R0);
  const gap = smooth(0.02, 0.005, Math.abs(band - 0.6)) * 0.85 + smooth(0.012, 0.003, Math.abs(band - 0.27)) * 0.6;
  const bands =
    (0.45 + 0.55 * Math.sin(band * 15 + Math.sin(band * 5.2) * 1.6)) * smooth(-0.02, 0.1, band) * (1 - smooth(0.9, 1.02, band));
  const a = clamp(bands * (1 - gap)) * (front ? 0.85 : 0.42);
  const col = mix3(hx("6a5238"), hx("e8d4a0"), clamp(0.25 + band * 0.55 + (front ? 0.18 : 0)));
  return [col[0], col[1], col[2], a];
};
// Raindrop Puddle: rings expand across still water at the mon's feet, each seeded
// drop fading as it spreads, plus a soft sheen on the surface.
AROUND.puddle = (nx, ny, df, t, c) => {
  const gy = c?.fy ?? 0.82;
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const seedx = c.cx + (h2(i, 4 + FXSEED) - 0.5) * 0.4;
    const ph = fract(t * 0.45 + h2(i, 8));
    const rad = 0.015 + ph * 0.085;
    const rr = Math.hypot(nx - seedx, (ny - gy) * 2.6);
    const ring = smooth(0.014, 0.004, Math.abs(rr - rad)) * (1 - ph * ph);
    a = Math.max(a, ring);
  }
  const sheen = smooth(0.035, 0.006, Math.abs(ny - gy)) * 0.22 * (0.7 + 0.3 * Math.sin(t * 1.7 + nx * 20));
  const m = clamp(1 - df / 26);
  return [0.62, 0.78, 0.95, clamp(a * 0.95 + sheen) * m];
};
// Void Rifts: two jagged tears in space slowly open and close beside the mon -
// swirling dark cores rimmed with violet fire.
AROUND.voidrift = (nx, ny, df, t, c) => {
  let out = [0, 0, 0, 0];
  for (let i = 0; i < 2; i++) {
    const cx0 = c.cx + (i === 0 ? -1 : 1) * 0.25 * (0.85 + h2(i, 3) * 0.3);
    const cy0 = c.cy + (h2(i, 5) - 0.5) * 0.34;
    const open = smooth(0.1, 0.45, Math.sin(t * 0.4 + i * 2.4) * 0.5 + 0.5);
    if (open < 0.04) {
      continue;
    }
    const dx = nx - cx0;
    const dy = ny - cy0;
    const ang = Math.atan2(dy, dx) + i * 1.7;
    const rr = Math.hypot(dx, dy * 2.4);
    const jag = (fbm(ang * 1.4 + i * 7, t * 0.12) - 0.5) * 0.02;
    const R = 0.035 + open * 0.055 + jag;
    const inside = smooth(0.01, -0.012, rr - R);
    const rim = smooth(0.018, 0.003, Math.abs(rr - R));
    const swirl = fbm(ang * 2 - t * 0.6, rr * 9);
    // deep-violet core with glowing swirl veins (reads on dark backdrops too),
    // edged in brighter violet fire
    const core = inside * (0.75 + swirl * 0.25);
    const col = mix3(hx("1a0b2e"), hx("b05aff"), clamp(rim * 1.6 + swirl * inside * 0.5));
    const aa = clamp(core * 0.9 + rim * (0.75 + 0.25 * Math.sin(t * 2 + i)));
    if (aa > out[3]) {
      out = [col[0], col[1], col[2], aa];
    }
  }
  return [out[0], out[1], out[2], out[3] * clamp(1 - df / 32)];
};
// Solar Wind: charged streaks stream radially outward from the mon, bending
// slightly as they escape - warm at the root, cooling as they fly.
AROUND.solarwind = (nx, ny, df, t, c) => {
  const dx = nx - c.cx;
  const dy = ny - c.cy;
  const rr = Math.hypot(dx, dy) + 1e-4;
  const ang = Math.atan2(dy, dx);
  const bend = Math.sin(t * 0.5 + ang * 2.5) * 0.4 * rr;
  const v = (ang + bend) * 9;
  const u = rr * 14 - t * 2.6;
  const ph = fract(u * 0.09 + h2(Math.floor(v), 3));
  const line = smooth(0.0, 0.1, ph) * smooth(0.42, 0.14, ph);
  const density = h2(Math.floor(v), 11) > 0.35 ? 1 : 0;
  const m = clamp(1 - df / 34) * smooth(0.06, 0.16, rr);
  const warm = clamp(1.3 - rr * 2.4);
  return [1.0, 0.55 + warm * 0.35, 0.2 + warm * 0.35, line * density * m * 0.55];
};
// Sand Timer: fine golden grains sift down around the mon and a glowing pile
// shimmers at the feet line - time literally pouring past.
AROUND.sandtimer = (nx, ny, df, t, c) => {
  const gy = c?.fy ?? 0.82;
  // fine round grains sifting down: dense sub-pixel cells with soft dot profiles
  const cell = 70;
  const fy2 = ny + t * 0.16;
  const sway = Math.sin(fy2 * 9 + t * 0.6) * 0.012 * smooth(0.9, 0.2, ny);
  const cx0 = Math.floor((nx + sway) * cell);
  const cy0 = Math.floor(fy2 * cell);
  let grain = 0;
  if (h2(cx0 * 1.3 + FXSEED, cy0 * 1.7) > 0.55) {
    const ax = (cx0 + 0.2 + h2(cx0, cy0) * 0.6) / cell - sway;
    const ay = (cy0 + 0.2 + h2(cy0, cx0) * 0.6) / cell;
    grain = smooth(0.02, 0.006, Math.hypot(nx - ax, ny - ay));
  }
  const waist = smooth(0.5, 0.2, Math.abs(nx - c.cx));
  // grains fall far from the silhouette too - a long df leash, the app-side
  // edgeFalloff handles the frame border
  const m = clamp(1 - df / 60);
  // glowing mound shimmering at the feet line, slowly swelling and draining
  const swell = 0.6 + 0.4 * Math.sin(t * 0.35);
  const mound = smooth(0.028 * swell + 0.012, 0.004, Math.abs(ny - gy)) * smooth(0.3, 0.05, Math.abs(nx - c.cx));
  const spark = mound * (0.5 + 0.5 * Math.sin(t * 2.2 + nx * 40));
  const a = grain * waist + mound * 0.25 + spark * 0.3;
  return [1.0, 0.9, 0.58, a * m * 0.9];
};

// ===========================================================================
// Exotic topology effects - ported from the in-game Shiny Lab (Phase D,
// 2026-07-20). These need silhouette topology (inside-distance SDF, interior
// Voronoi midline, edge normals, matcap z, per-pixel id) computed lazily per
// frame by app.js and handed in via ctx.topo / ctx.px / ctx.py, plus stable
// animation anchors via ac.stableCx/stableCy. Each degrades to a no-op when
// the topology/anchor ctx is absent.
// ===========================================================================
const EXOTIC_DEEP = 22;
const INSIDE_INF = 1e6;

/** Two-pass chamfer INSIDE distance (0 outside -> grows inward). */
function computeInsideDist(buf, W, H) {
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
      if (x > 0) v = Math.min(v, d[y * W + x - 1] + A);
      if (y > 0) v = Math.min(v, d[(y - 1) * W + x] + A);
      if (x > 0 && y > 0) v = Math.min(v, d[(y - 1) * W + x - 1] + B);
      if (x < W - 1 && y > 0) v = Math.min(v, d[(y - 1) * W + x + 1] + B);
      d[y * W + x] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      let v = d[y * W + x];
      if (x < W - 1) v = Math.min(v, d[y * W + x + 1] + A);
      if (y < H - 1) v = Math.min(v, d[(y + 1) * W + x] + A);
      if (x < W - 1 && y < H - 1) v = Math.min(v, d[(y + 1) * W + x + 1] + B);
      if (x > 0 && y < H - 1) v = Math.min(v, d[(y + 1) * W + x - 1] + B);
      d[y * W + x] = v;
    }
  }
  return d;
}

/**
 * Interior Voronoi border field ("medial axis strength"): every edge pixel is
 * a seed propagated inward with the chamfer; a pixel whose 4-neighbour carries
 * a DIFFERENT seed sits on the internal midline between limbs/edges. The
 * midline is dilated ~2 px so strokes riding it have width.
 */
function computeVoroField(buf, W, H) {
  const N = W * H;
  const seed = new Int32Array(N);
  const dist = new Float32Array(N);
  let nextSeed = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (buf[i * 4 + 3] <= 0.02) {
        seed[i] = 0;
        dist[i] = 0;
        continue;
      }
      const edge =
        x === 0 || y === 0 || x === W - 1 || y === H - 1
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
  const spread = (x, y, nx, ny, w) => {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
    const i = y * W + x;
    const j = ny * W + nx;
    if (seed[j] === 0) return;
    const nd = dist[i] + w;
    if (seed[i] > 0 && (seed[j] < 0 || nd < dist[j] - 0.5)) {
      seed[j] = seed[i];
      dist[j] = nd;
    }
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (seed[y * W + x] <= 0) continue;
      spread(x, y, x - 1, y, 1);
      spread(x, y, x, y - 1, 1);
      spread(x, y, x - 1, y - 1, Math.SQRT2);
      spread(x, y, x + 1, y - 1, Math.SQRT2);
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      if (seed[y * W + x] <= 0) continue;
      spread(x, y, x + 1, y, 1);
      spread(x, y, x, y + 1, 1);
      spread(x, y, x + 1, y + 1, Math.SQRT2);
      spread(x, y, x - 1, y + 1, Math.SQRT2);
    }
  }
  const border = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (seed[i] <= 0) continue;
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
  for (let pass = 0; pass < 2; pass++) {
    const src = border.slice();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (src[i] > 0) continue;
        const m = Math.max(src[i - 1], src[i + 1], src[i - W], src[i + W]);
        if (m > 0) {
          border[i] = m * 0.55;
        }
      }
    }
  }
  return border;
}

/** Outward normals + tangents from the inside-distance gradient. */
function computeFxNormals(sdf, W, H) {
  const N = W * H;
  const nx = new Float32Array(N);
  const ny = new Float32Array(N);
  const tx = new Float32Array(N);
  const ty = new Float32Array(N);
  const at = (x, y) => {
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

/** Fake relief-sphere z: 0 at the silhouette rim, 1 once ~12 px deep. */
function computeMatcapZ(sdf, W, H) {
  const z = new Float32Array(W * H);
  const R = 12;
  for (let i = 0; i < W * H; i++) {
    const dd = Math.min(sdf[i], R) / R;
    z[i] = Math.sqrt(Math.max(0, 1 - (1 - dd) * (1 - dd)));
  }
  return z;
}

/** Deterministic per-pixel identity (integer lattice hash -> [0,1)). */
function computePixId(W, H) {
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

/**
 * Compute the topology bundle for one frame buffer. app.js caches this per
 * animation frame and passes it as ctx.topo. Only the exotic effects read it.
 */
export function computeFxTopology(buf, W, H) {
  const sdf = computeInsideDist(buf, W, H);
  return {
    sdf,
    voro: computeVoroField(buf, W, H),
    ...computeFxNormals(sdf, W, H),
    matcapZ: computeMatcapZ(sdf, W, H),
    pixId: computePixId(W, H),
  };
}

// Gilded Bones: engraved gold inlay following the mon's TRUE midline skeleton
// (the interior Voronoi border field), fading to dark lacquer near the rim.
AURA.gildedbones = (r, g, b, x, y, t, ctx) => {
  const topo = ctx?.topo;
  if (!topo) return [r, g, b, 1];
  const i = ctx.py * ctx.W + ctx.px;
  const v = topo.voro[i];
  const d = Math.min(topo.sdf[i], EXOTIC_DEEP) / EXOTIC_DEEP;
  const wire = smooth(0.45, 0.95, v);
  const echo = smooth(0.2, 0.5, v) * 0.35;
  const shimmer = 0.75 + 0.25 * Math.sin(d * 9 - t * 1.4);
  const gold = ramp(G.gold, clamp(wire * shimmer + echo));
  const lacq = [r * 0.5, g * 0.48, b * 0.52];
  const m = clamp(wire * (0.4 + 0.6 * d) + echo * d);
  return [mix(lacq[0], gold[0], m), mix(lacq[1], gold[1], m), mix(lacq[2], gold[2], m), 1];
};

// Carved Relief: flat pixel art re-lit as cast metal / carved gem. A fake
// relief sphere (matcapZ from the inside-distance) is lit by a fixed key light
// against the outward normals, with a cool rim at the silhouette.
AURA.carvedrelief = (r, g, b, x, y, t, ctx) => {
  const topo = ctx?.topo;
  if (!topo) return [r, g, b, 1];
  const i = ctx.py * ctx.W + ctx.px;
  const nx = topo.nx[i];
  const ny = topo.ny[i];
  const z = topo.matcapZ[i];
  const key = clamp(0.5 + 0.55 * (-nx * 0.7 - ny * 0.7) * z + 0.35 * z);
  const rim = Math.pow(1 - z, 2.5) * 0.35;
  const [h, s, v] = rgb2hsv(r, g, b);
  const lit = hsv2rgb(h, s, clamp(v * (0.35 + 0.85 * key)));
  return [clamp(lit[0] + rim * 0.6), clamp(lit[1] + rim * 0.75), clamp(lit[2] + rim), 1];
};

// Inner Ember: translucent skin over a breathing furnace. A depth-normalized
// glow lives DEEP inside the body; rim pixels keep the body's own shading.
AURA.innerember = (r, g, b, x, y, t, ctx) => {
  const topo = ctx?.topo;
  if (!topo) return [r, g, b, 1];
  const i = ctx.py * ctx.W + ctx.px;
  const d = Math.min(topo.sdf[i], EXOTIC_DEEP) / EXOTIC_DEEP;
  const n = vnoise(x * 3.1 + t * 0.13, y * 3.1 - t * 0.09);
  const breathe = 0.72 + 0.28 * Math.sin(t * 0.9 + topo.pixId[i] * 0.6);
  const fire = Math.pow(d, 1.8) * (0.55 + 0.75 * n) * breathe;
  const hot = ramp(G.inferno, clamp(fire * 1.15));
  const m = Math.pow(d, 2.1) * 0.85;
  const skin = mix3([r * 0.8, g * 0.8, b * 0.8], hot, m);
  return [skin[0], skin[1], skin[2], 1];
};

// Nested Portrait: a dim ghost-plaque near the chest holds a recursively scaled
// miniature of the whole sprite, 2 levels deep. The window tracks the BODY
// (frame anchors) so it moves with the chest; the live pixel stays partially
// present so the window never reads as a hole.
AURA.nestedportrait = (r, g, b, x, y, t, ctx) => {
  const a = ctx?.anchors;
  if (!a) return [r, g, b, 1];
  const wx = a.frameCx;
  const wy = a.frameCy * 0.92;
  const dx = x - wx;
  const dy = y - wy;
  const rad = Math.hypot(dx, dy);
  const R = 0.2;
  if (rad >= R) return [r, g, b, 1];
  const ghostify = s => {
    const [h, sat, val] = rgb2hsv(s[0], s[1], s[2]);
    return hsv2rgb(mix(h, 0.62, 0.75), clamp(sat * 0.5 + 0.1), clamp(val * 0.55 + 0.28));
  };
  const span = 0.62;
  const map = (u, v) => [
    clamp(wx + (u - 0.5) * span, 0.005, 0.995),
    clamp(wy + (v - 0.5) * span * (ctx.H / Math.max(ctx.W, 1)), 0.005, 0.995),
  ];
  const u = (dx / R) * 0.5 + 0.5;
  const v = (dy / R) * 0.5 + 0.5;
  let [mu, mv] = map(u, v);
  let s = ctx.sa(mu, mv);
  if (rad < R * 0.48) {
    const u2 = (dx / (R * 0.48)) * 0.5 + 0.5;
    const v2 = (dy / (R * 0.48)) * 0.5 + 0.5;
    [mu, mv] = map(u2, v2);
    const s2 = ctx.sa(mu, mv);
    if (s2[3] > 0.02) s = s2;
  }
  const pulse = 0.92 + 0.08 * Math.sin(t * 1.1);
  if (s[3] <= 0.02) {
    return [r * 0.55 + 0.04, g * 0.55 + 0.05, b * 0.6 + 0.09, 1];
  }
  const gh = ghostify(s);
  const m = 0.82 * pulse;
  return [mix(r, gh[0] * pulse, m), mix(g, gh[1] * pulse, m), mix(b, gh[2] * pulse, m), 1];
};

// Warp Well: an orbiting void whose horizon lens-bends a copy of the sprite
// toward it. Anchored to the STABLE union centroid so the well does not wobble
// across the animation. (Distinct from the game's static locked eventhorizon.)
AROUND.warpwell = (nx, ny, df, t, ctx) => {
  const ang = t * 0.35;
  const mxp = (ctx?.stableCx ?? 0.5) + Math.cos(ang) * 0.16;
  const myp = (ctx?.stableCy ?? 0.45) * 0.75 + Math.sin(ang) * 0.1;
  const dx = nx - mxp;
  const dy = ny - myp;
  const r = Math.hypot(dx, dy);
  const horizon = 0.045;
  const reach = 0.24;
  if (r > reach) return [0, 0, 0, 0];
  if (r < horizon) {
    const rimGlow = smooth(horizon * 0.6, horizon, r);
    return [0.02 + rimGlow * 0.14, 0.0, 0.05 + rimGlow * 0.22, 1];
  }
  const pull = (reach - r) / (reach - horizon);
  const bend = pull * pull * 0.55;
  const s = ctx?.spr ? ctx.spr(nx - dx * bend, ny - dy * bend) : [0, 0, 0, 0];
  const fade = 1 - smooth(horizon, reach, r);
  const glow = smooth(horizon, horizon * 1.6, r) * (1 - smooth(horizon * 1.6, reach * 0.7, r));
  if (s[3] > 0.02) {
    const lum = luma(s[0], s[1], s[2]);
    return [
      s[0] * 0.85 + glow * 0.25,
      s[1] * 0.8 + glow * 0.18,
      clamp(s[2] * 0.9 + glow * 0.4 + lum * 0.05),
      s[3] * (0.3 + 0.6 * fade),
    ];
  }
  return [glow * 0.3, glow * 0.2, glow * 0.5, glow * 0.6 * fade];
};

export const ALL_PALETTE = Object.keys(PALETTE);
export const ALL_AURA = Object.keys(AURA);
export const ALL_AROUND = Object.keys(AROUND);

export const LABELS = {
  glacier: "Glacier",
  aurum: "Aurum",
  obsidian: "Obsidian",
  chrome: "Chrome",
  amethyst: "Amethyst",
  inferno: "Inferno",
  toxic: "Toxic",
  rosequartz: "Rose Quartz",
  verdigris: "Verdigris",
  spectral: "Spectral",
  negative: "Negative",
  void: "Void Bloom",
  shadowflame: "Shadowflame",
  iridescent: "Iridescent",
  thermal: "Thermal",
  sepia: "Daguerreotype",
  copper: "Copper",
  emerald: "Emerald",
  sapphire: "Sapphire",
  comic: "Cel / Comic",
  synthwave: "Synthwave",
  rainbow: "Rainbow Cycle",
  aurora: "Aurora",
  holofoil: "Holo Foil",
  prismatic: "Prismatic",
  frostbite: "Frostbite",
  glitch: "Datamosh",
  hologram: "Hologram",
  galaxy: "Galaxy",
  plasma: "Plasma",
  molten: "Molten",
  electric: "Electric",
  dissolve: "Dissolve",
  mercury: "Mercury",
  lavacracks: "Lava Cracks",
  frozenice: "Frozen",
  crystalfacets: "Crystal",
  stainedglass: "Stained Glass",
  marble: "Marble",
  bioluminescent: "Bioluminescent",
  constellation: "Constellation",
  aurorawings: "Aurora Wings",
  gildededges: "Gilded Edges",
  rimlight: "Rim Light",
  vaporwave: "Vaporwave",
  halftone: "Halftone",
  sparkle: "Starlit",
  lightningveins: "Lightning Veins",
  dripgold: "Dripping Gold",
  spectrumsplit: "Prism Split",
  // v3 palettes
  onyxgold: "Onyx Gold",
  ultraviolet: "Ultraviolet",
  acid: "Acid",
  bubblegum: "Bubblegum",
  blood: "Blood",
  abyss: "Abyss",
  antique: "Antique",
  frostfire: "Frostfire",
  camo: "Camo",
  jade: "Jade",
  rosegold: "Rose Gold",
  mono: "Monochrome",
  // v3 surface
  ripple: "Ripple",
  circuit: "Circuit",
  scales: "Iridescent Scales",
  tvstatic: "TV Static",
  scansweep: "Scan Sweep",
  poison: "Toxic Bubbles",
  // v3 around
  outline: "Outline Glow",
  halo: "Soft Halo",
  flame: "Flame Aura",
  shadowfire: "Shadow Fire",
  frost: "Frost Aura",
  efield: "Electric Field",
  rings: "Energy Rings",
  orbit: "Orbiting Sparks",
  auroraveil: "Aurora Veil",
  holyrays: "Holy Light",
  cosmos: "Cosmic Backdrop",
  smoke: "Smoke",
  radiant: "Radiant Burst",
  embers: "Ember Swarm",
  snow: "Snowfall",
  bubbles: "Bubble Aura",
  // v4 palettes
  prismarine: "Prismarine",
  nebula: "Nebula",
  venom: "Venom",
  solarflare: "Solar Flare",
  royal: "Royal",
  deepsea: "Deep Sea",
  sakura: "Sakura",
  mythril: "Mythril",
  cursed: "Cursed",
  pearl: "Pearl",
  rust: "Rust",
  moonstone: "Moonstone",
  oilspill: "Oil Spill",
  plasmatic: "Plasmatic",
  // v4 surface
  kaleido: "Kaleidoscope",
  fractalflow: "Fractal Flow",
  wormhole: "Wormhole",
  shatter: "Shatter",
  heatshimmer: "Heat Shimmer",
  caustics: "Caustics",
  oilfilm: "Oil Film",
  pixelpulse: "Pixel Pulse",
  neonwire: "Neon Wire",
  starmap: "Star Map",
  // v4 around (partial + new)
  wingflame: "Wing Flames",
  footfrost: "Foot Frost",
  crown: "Crown Halo",
  underlight: "Underglow",
  uprising: "Rising Wisps",
  topbeam: "Top Beam",
  sideaura: "Side Surge",
  magiccircle: "Magic Circle",
  vortex: "Vortex",
  galaxyspiral: "Galaxy Spiral",
  fireflies: "Fireflies",
  petals: "Petal Fall",
  rain: "Rain",
  sparkstorm: "Spark Storm",
  prismburst: "Prism Burst",
  icespikes: "Ice Spikes",
  // cluster palettes (region-faithful 2-/multi-tone) + HD
  duoink: "Duo Ink",
  duoneon: "Duo Neon",
  duomono: "Duo Mono",
  duoblood: "Duo Blood",
  duomint: "Duo Mint",
  duosunset: "Duo Sunset",
  duomecha: "Duo Mecha",
  trisunset: "Tri Sunset",
  triforest: "Tri Forest",
  quadvapor: "Quad Vapor",
  pentacandy: "Penta Candy",
  pentajewel: "Penta Jewel",
  // v5
  synthwavesun: "Synthwave Sun",
  sunset: "Sunset",
  gameboy: "Game Boy",
  retro: "Retro Limiter",
  synthscan: "Synth Scanlines",
  sunsetsun: "Sunset Sun",
  crosshatch: "Crosshatch",
  tron: "Tron Lines",
  rainbowedge: "Rainbow Edge",
  rainbowglitter: "Rainbow Glitter",
  luminous: "Luminous",
  cursedaura: "Cursed Aura",
  goldenglow: "Golden Glow",
  shadowaura: "Shadow Aura",
  rainbowoutline: "Rainbow Outline",
  triangles: "Triangles",
  hexagons: "Hexagons",
  hearts: "Hearts",
  staticfield: "Static Field",
  // v6 palettes
  blueprint: "Blueprint",
  whosthat: "Who's That...?",
  lavender: "Lavender Ghost",
  overexposed: "Overexposed",
  hyperpigment: "Hyperpigment",
  popart: "Pop Art",
  // v6 surface
  neonsign: "Neon Sign",
  mistveil: "Mist Veil",
  mistfeet: "Rising Mist",
  bloom: "Bloom",
  softshade: "HD Lighting",
  glasswarp: "Glass Warp",
  unlined: "No Outline",
  sundered: "Pulled Apart",
  livingshadow: "Living Shadow",
  // v6 around
  helix: "Energy Helix",
  atomrings: "Atomic Orbit",
  nuclearwinter: "Nuclear Winter",
  sinistersun: "Sinister Sun",
  hdstars: "HD Stars",
  echoes: "Double Team",
  lowmist: "Ground Mist",
  // v7 palettes
  platinum: "Platinum",
  brass: "Brass",
  agedbronze: "Patina Bronze",
  ivory: "Ivory",
  emberash: "Ember Ash",
  lapis: "Lapis Lazuli",
  vermilion: "Vermilion",
  periwinkle: "Twilight Neon",
  wine: "Velvet Noir",
  honeyamber: "Honey Amber",
  stormcloud: "Stormcloud",
  peacock: "Peacock",
  flamingo: "Flamingo",
  cyberpunk: "Cyberpunk",
  matrixgreen: "Matrix",
  opal: "Opal",
  dragonfruit: "Dragonfruit",
  lagoon: "Tidepool",
  mirage: "Heat Mirage",
  eclipse: "Eclipse",
  midnightoil: "Midnight Oil",
  terracotta: "Terracotta",
  porcelaindelft: "Porcelain",
  seafoam: "Seafoam",
  glowworm: "Glowworm",
  voidfire: "Voidfire",
  petrol: "Petrol Sheen",
  duststorm: "Sandstone",
  watermelon: "Watermelon",
  cyanotype: "Cyanotype",
  coralreef: "Coral Reef",
  grape: "Ultra Grape",
  mintchoco: "Mint Choc",
  sherbet: "Sherbet",
  gunmetal: "Gunmetal",
  arcticnight: "Arctic Night",
  blackice: "Frozen Abyss",
  meadow: "Sunlit Grove",
  complement: "Complement",
  hueplus: "Hue +90",
  hueminus: "Hue -90",
  xenoswap: "Xeno Swap",
  splitteal: "Teal & Orange",
  splitroyal: "Royal Grade",
  pastelize: "Pastel",
  noir: "Noir",
  infraredfilm: "Infrared Film",
  virtualboy: "Virtual Boy",
  cga: "CGA",
  poster: "Posterize",
  glassbody: "Glass",
  phantom: "Phantom",
  heatmap: "Heat Map",
  hueglide: "Hue Glide",
  stencil: "Stencil",
  duoice: "Duo Ice",
  creamsicle: "Creamsicle",
  duoviolet: "Duo Clash",
  duogold: "Duo Regal",
  bumblebee: "Bumblebee",
  duosakura: "Duo Sakura",
  trinebula: "Tri Nebula",
  triocean: "Tri Ocean",
  triember: "Tri Ember",
  tripoison: "Tri Poison",
  quadautumn: "Quad Autumn",
  quadcyber: "Quad Cyber",
  pentaretro: "Penta Retro",
  pentagalaxy: "Penta Galaxy",
  // v7 surface
  waterline: "Waterline",
  firecreep: "Fire Creep",
  snowcap: "Snowcap",
  discoball: "Disco Glints",
  lensflare: "Lens Flare",
  oldfilm: "Old Film",
  vhs: "VHS Tape",
  pixelsort: "Pixel Sort",
  moire: "Hypno Rings",
  contours: "Contours",
  coderain: "Code Rain",
  honeyplate: "Honeycomb Plate",
  carbonweave: "Carbon Fiber",
  brushedmetal: "Brushed Metal",
  lavalamp: "Lava Lamp",
  soapswirl: "Soap Film",
  xray: "X-Ray",
  blueprintscan: "Blueprint Scan",
  stitchwork: "Knitted",
  mosaictile: "Mosaic",
  papercut: "Papercraft",
  inkwash: "Ink Wash",
  goldleaf: "Gold Leaf",
  rustcreep: "Rust Creep",
  petrified: "Petrified",
  slimecoat: "Slime Coat",
  bubblewrap: "Soul Siphon",
  candycane: "Candy Cane",
  embermotes: "Ember Motes",
  fairydust: "Fairy Dust",
  glitterstorm: "Glitter Storm",
  fireflyglade: "Firefly Glade",
  starfall: "Starfall",
  smolder: "Smolder",
  frostcore: "Frost Core",
  shockwave: "Shockwave",
  runes: "Runic Etch",
  staticcharge: "Static Charge",
  cmykprint: "CMYK Print",
  binarybody: "Binary Body",
  origami: "Origami",
  crackleglaze: "Crackle Glaze",
  kintsugi: "Kintsugi",
  activecamo: "Active Camo",
  watercolor: "Watercolor",
  spiritflame: "Spirit Flame",
  datacorrupt: "Data Corruption",
  doubleexposure: "Double Exposure",
  paperburn: "Paper Burn",
  mossgrow: "Overgrowth",
  gemplate: "Gem Plate",
  tiedye: "Tie-Dye",
  checkerflip: "Checker Flip",
  polkadot: "Polka Dots",
  graffiti: "Graffiti",
  innerstorm: "Inner Storm",
  meltdown: "Meltdown",
  sequins: "Sequins",
  tvbars: "Color Bars",
  revealscan: "Reveal Scan",
  spotlight: "Spotlight",
  demake: "Demake",
  marchingants: "Marching Ants",
  phosphor: "Phosphor",
  // exotic topology (2026-07-20)
  gildedbones: "Gilded Bones",
  carvedrelief: "Carved Relief",
  innerember: "Inner Ember",
  nestedportrait: "Nested Portrait",
  // v7 around
  meteors: "Meteor Shower",
  stormstrikes: "Thunderstorm",
  rainbowarc: "Rainbow Arc",
  autumnleaves: "Autumn Gust",
  musicnotes: "Music Notes",
  butterflies: "Butterflies",
  batswarm: "Bat Swarm",
  moonrise: "Moonrise",
  geyser: "Geyser",
  whirlpool: "Whirlpool",
  windribbons: "Wind Ribbons",
  ribbonloop: "Ribbon Dancer",
  slashes: "Blade Flurry",
  planets: "Tiny Planets",
  clockwork: "Clockwork",
  fireworks: "Fireworks",
  sandgust: "Sand Gust",
  spotlights: "Stage Lights",
  lightcage: "Cage of Light",
  chains: "Chained",
  featherfall: "Feather Fall",
  spiritorbs: "Will-o-Wisps",
  eventhorizon: "Event Horizon",
  cardstorm: "Card Storm",
  coinrain: "Coin Rain",
  shardlevitate: "Shard Levitation",
  smokerings: "Smoke Rings",
  radarsweep: "Radar Sweep",
  hellsigil: "Hell Sigil",
  lasershow: "Laser Show",
  glyphrain: "Glyph Rain",
  firering: "Ring of Fire",
  creepingshadow: "Creeping Shadow",
  equalizer: "Equalizer",
  confetti: "Confetti",
  raincloud: "Personal Raincloud",
  portal: "Portal",
  speedlines: "Manga Burst",
  lockon: "Lock-On",
  hexdome: "Hex Barrier",
  guardianwings: "Guardian Wings",
  snowglobe: "Snow Globe",
  orbitdebris: "Orbit Debris",
  starcircle: "Star Ring",
  fallingstar: "Falling Star",
  gravitylift: "Zero-G Lift",
  shockpulse: "Shock Pulse",
  fogbank: "Fog Bank",
  paperlanterns: "Paper Lanterns",
  warpwell: "Warp Well",
  cometorbit: "Comet Orbit",
  petalvortex: "Petal Vortex",
  emberspiral: "Ember Spiral",
  runeorbit: "Rune Orbit",
  prismrain: "Prism Rain",
  zaps: "Lightning Zaps",
  blossoms: "Sakura Blossoms",
  astral: "Astral Form",
  triecho: "Double Team Tri",
  genone: "Gen 1",
  // v8 exotic batch
  bismuth: "Bismuth",
  solarized: "Solarized",
  scarlet: "Scarlet Letter",
  triaurora: "Tri Aurora",
  aquarium: "Aquarium",
  starrynight: "Starry Night",
  anaglyph: "Anaglyph 3D",
  droste: "Infinite Zoom",
  ferrofluid: "Ferrofluid",
  plasmaglobe: "Plasma Globe",
  amber: "Trapped in Amber",
  moonlit: "Moonlit",
  chronoshift: "Chronoshift",
  magnetosphere: "Magnetosphere",
  sundogs: "Sun Dogs",
  lightpillars: "Light Pillars",
  koipond: "Koi Pond",
  saturnrings: "Saturn Rings",
  puddle: "Raindrop Puddle",
  voidrift: "Void Rifts",
  solarwind: "Solar Wind",
  sandtimer: "Sand Timer",
};

// effects that read the edge field / are inherently "partial" (for tagging in UI)
export const PARTIAL = new Set([
  "lavacracks",
  "frozenice",
  "constellation",
  "aurorawings",
  "gildededges",
  "rimlight",
  "dripgold",
  "sparkle",
  "lightningveins",
  "wingflame",
  "footfrost",
  "crown",
  "underlight",
  "uprising",
  "topbeam",
  "sideaura",
  "neonsign",
  "mistveil",
  "mistfeet",
  "livingshadow",
  "lowmist",
  "waterline",
  "firecreep",
  "snowcap",
  "smolder",
  "spiritflame",
  "staticcharge",
  "marchingants",
  "rustcreep",
  "mossgrow",
  "frostcore",
  "ferrofluid",
]);
