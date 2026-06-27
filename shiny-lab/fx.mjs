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
  return { PW, PH, d, cx: cnt ? cx / cnt / PW : 0.5, cy: cnt ? cy / cnt / PH : 0.45 };
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
  let bi = 0;
  let bd = 1e9;
  for (let j = 0; j < cl.cent.length; j++) {
    const c = cl.cent[j];
    const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
    if (d < bd) {
      bd = d;
      bi = j;
    }
  }
  return bi;
}
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
};
export const PALETTE_ALPHA = { spectral: 0.62 };
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
AROUND.footfrost = (nx, ny, df, t) => {
  const reg = smooth(0.55, 0.85, ny);
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
AROUND.underlight = (nx, ny, df, t) => {
  const reg = smooth(0.55, 1.0, ny);
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
  const ey = (ny - (c.cy + 0.34)) * 2.6;
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
]);
