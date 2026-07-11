/* Shiny Lab - EXOTIC multi-sprite effects (v2). Unlike palette/surface/around (per-pixel
 * passes flattened into ONE buffer), these draw LAYERED COPIES / transforms of the fully
 * composited look using 2D canvas ops. Copies inherit whatever palette/surface/around is
 * equipped (they sample the rendered look). Three kinds, three independent slots:
 *
 *   kind "exotic" - ADDITIVE layers around the body:   { behind(c,env)?, front(c,env)? }
 *   kind "rig"    - REPLACES the body draw:             { draw(c,env) }
 *   kind "moment" - auto-looping finite SEQUENCE over everything:
 *                   { hidesBase(env)?, behind(c,env)?, front(c,env) }
 *
 * env = {
 *   t          - seconds, master-speed scaled
 *   look       - canvas of the CURRENT composited look (PW x PH)
 *   ring(n)    - canvas of the look ~n*80ms AGO (frame history; falls back to look)
 *   lookData() - lazy ImageData of the current look (cached for the frame)
 *   baseAlpha()- Uint8Array(PW*PH) 0/1 silhouette of the RAW sprite (no aura bleed)
 *   PW, PH     - padded sprite frame size;  ox, oy - where the look sits on the canvas
 *   EW, EH     - full scene canvas size (draw anywhere inside)
 *   cx, cy     - silhouette center in look-space px;  fy - feet line in look-space px
 *   seed       - deterministic per-mon seed;  compact - small gallery tile
 *   species    - current species id;  sig - look signature (bump = rebuild color caches)
 *   evo        - { prev, next[], chain[] } species ids in the evolution line
 *   aux(id)    - canvas of another species' sprite frame (async; null until loaded)
 * }
 * No WebGL; ctx.filter + composite ops do the tinting work. Everything cacheable is
 * cached per species / per look signature so the per-frame cost is transforms only. */

const EXO_TAU = Math.PI * 2;
const exoRand = (seed, i) => {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const exoClamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const exoSmooth = p => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));

/* stamp(c, env, img, opts): draw a look-sized canvas with a transform.
 * opts: x,y = anchor position on the scene canvas (default = mon center); sx,sy = scale
 * (negative flips); rot; alpha; filter; comp; anchorFeet = anchor at the feet line. */
function exoStamp(c, env, img, o) {
  const sx = o.sx ?? o.s ?? 1;
  const sy = o.sy ?? o.s ?? 1;
  const x = o.x ?? env.ox + env.cx;
  const y = o.y ?? env.oy + env.cy;
  c.save();
  c.imageSmoothingEnabled = false;
  c.globalAlpha = o.alpha ?? 1;
  if (o.comp) c.globalCompositeOperation = o.comp;
  if (o.filter) c.filter = o.filter;
  c.translate(x, y);
  if (o.rot) c.rotate(o.rot);
  if (o.skewX) c.transform(1, 0, o.skewX, 1, 0, 0);
  c.scale(sx, sy);
  c.drawImage(img, -env.cx, -(o.anchorFeet ? env.fy : env.cy));
  c.restore();
}

/* stamp an arbitrary-size image (another species' sprite): x,y anchor, h = target height */
function exoStampImg(c, env, img, o) {
  if (!img) return;
  const s = (o.h ?? img.height) / img.height;
  c.save();
  c.imageSmoothingEnabled = false;
  c.globalAlpha = o.alpha ?? 1;
  if (o.comp) c.globalCompositeOperation = o.comp;
  if (o.filter) c.filter = o.filter;
  c.translate(o.x, o.y);
  if (o.rot) c.rotate(o.rot);
  c.scale(s * (o.flip ? -1 : 1) * (o.sxMul ?? 1), s * (o.syMul ?? 1));
  c.drawImage(img, -img.width / 2, -(o.anchorFeet ? exoImgFeet(img) : img.height / 2));
  c.restore();
}
const exoImgMeta = new WeakMap();
function exoImgFeet(img) {
  let f = exoImgMeta.get(img);
  if (f !== undefined) return f;
  const d = img.getContext("2d").getImageData(0, 0, img.width, img.height).data;
  f = img.height;
  outer: for (let y = img.height - 1; y >= 0; y--) {
    for (let x = 0; x < img.width; x += 2) {
      if (d[(y * img.width + x) * 4 + 3] > 40) {
        f = y + 1;
        break outer;
      }
    }
  }
  exoImgMeta.set(img, f);
  return f;
}
/* dominant palette (3 css colors) of an aux sprite canvas */
const exoPalMeta = new WeakMap();
function exoAuxPalette(img) {
  let p = exoPalMeta.get(img);
  if (p) return p;
  const d = img.getContext("2d").getImageData(0, 0, img.width, img.height).data;
  const buckets = new Map();
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] < 160) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const mx = Math.max(r, g, b);
    if (mx < 30) continue; // skip the black outline
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, sat: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    e.sat += mx - Math.min(r, g, b);
    buckets.set(key, e);
  }
  const arr = [...buckets.values()].map(e => ({
    r: e.r / e.n,
    g: e.g / e.n,
    b: e.b / e.n,
    w: e.n * (1 + e.sat / e.n / 60),
  }));
  arr.sort((a, b) => b.w - a.w);
  p = arr.slice(0, 3).map(e => `rgb(${e.r | 0},${e.g | 0},${e.b | 0})`);
  while (p.length < 3) p.push(p[0] || "rgb(150,150,190)");
  exoPalMeta.set(img, p);
  return p;
}

/* ---- per-species / per-sig cache -------------------------------------------- */
const exoCacheMap = new Map();
function exoCached(key, make) {
  let v = exoCacheMap.get(key);
  if (v === undefined) {
    if (exoCacheMap.size > 96) exoCacheMap.clear();
    v = make();
    exoCacheMap.set(key, v);
  }
  return v;
}
/* silhouette edge points with outward normals: [x, y, nx, ny][] */
function exoEdge(env) {
  return exoCached(`edge:${env.species}:${env.PW}`, () => {
    const A = env.baseAlpha();
    const W = env.PW;
    const H = env.PH;
    const pts = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (A[i] && (!A[i - 1] || !A[i + 1] || !A[i - W] || !A[i + W]) && ((x + y) & 1) === 0) {
          let nx = x - env.cx;
          let ny = y - env.cy;
          const l = Math.hypot(nx, ny) || 1;
          pts.push([x, y, nx / l, ny / l]);
        }
      }
    }
    return pts;
  });
}
/* smoothed radial contour: 96 [x, y] points around the silhouette */
function exoContour(env) {
  return exoCached(`contour:${env.species}:${env.PW}`, () => {
    const A = env.baseAlpha();
    const W = env.PW;
    const H = env.PH;
    const N = 96;
    const rad = new Float32Array(N);
    const maxR = Math.hypot(W, H) / 2;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * EXO_TAU;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let r = 0;
      for (let rr = 2; rr < maxR; rr++) {
        const x = Math.round(env.cx + dx * rr);
        const y = Math.round(env.cy + dy * rr);
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        if (A[y * W + x]) r = rr;
      }
      rad[k] = r || 4;
    }
    for (let p = 0; p < 2; p++) {
      const c2 = Float32Array.from(rad);
      for (let k = 0; k < N; k++) {
        rad[k] = (c2[(k + N - 1) % N] + c2[k] * 2 + c2[(k + 1) % N]) / 4;
      }
    }
    const pts = [];
    for (let k = 0; k < N; k++) {
      const a = (k / N) * EXO_TAU;
      pts.push([env.cx + Math.cos(a) * rad[k], env.cy + Math.sin(a) * rad[k]]);
    }
    return pts;
  });
}
/* inner distance field (BFS from the silhouette boundary inward) */
function exoInnerDist(env) {
  return exoCached(`idist:${env.species}:${env.PW}`, () => {
    const A = env.baseAlpha();
    const W = env.PW;
    const H = env.PH;
    const D = new Int16Array(W * H).fill(-1);
    const q = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!A[i]) continue;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !A[i - 1] || !A[i + 1] || !A[i - W] || !A[i + W]) {
          D[i] = 0;
          q.push(i);
        }
      }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const d = D[i] + 1;
      const x = i % W;
      if (x > 0 && A[i - 1] && D[i - 1] < 0) {
        D[i - 1] = d;
        q.push(i - 1);
      }
      if (x < W - 1 && A[i + 1] && D[i + 1] < 0) {
        D[i + 1] = d;
        q.push(i + 1);
      }
      if (i - W >= 0 && A[i - W] && D[i - W] < 0) {
        D[i - W] = d;
        q.push(i - W);
      }
      if (i + W < W * H && A[i + W] && D[i + W] < 0) {
        D[i + W] = d;
        q.push(i + W);
      }
    }
    return D;
  });
}
/* tight bounding box of the actual sprite content (gradients/lines/props must
 * anchor to THIS, not the padded frame, or they read as floating boxes) */
function exoBBox(env) {
  return exoCached(`bbox:${env.species}:${env.PW}`, () => {
    const A = env.baseAlpha();
    const W = env.PW;
    const H = env.PH;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!A[y * W + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < x0) {
      x0 = 0;
      y0 = 0;
      x1 = W - 1;
      y1 = H - 1;
    }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  });
}
/* white canvas whose alpha = the raw silhouette (for destination-in clips) */
function exoMaskCv(env) {
  return exoCached(`mask:${env.species}:${env.PW}`, () => {
    const A = env.baseAlpha();
    const cv = document.createElement("canvas");
    cv.width = env.PW;
    cv.height = env.PH;
    const cc = cv.getContext("2d");
    const id = cc.createImageData(env.PW, env.PH);
    for (let i = 0; i < A.length; i++) {
      if (A[i]) {
        id.data[i * 4] = 255;
        id.data[i * 4 + 1] = 255;
        id.data[i * 4 + 2] = 255;
        id.data[i * 4 + 3] = 255;
      }
    }
    cc.putImageData(id, 0, 0);
    return cv;
  });
}
/* small scratch canvas pool (look-sized) */
const exoScratchPool = [];
function exoScratch(env, n) {
  let cv = exoScratchPool[n || 0];
  if (!cv) {
    cv = document.createElement("canvas");
    exoScratchPool[n || 0] = cv;
  }
  if (cv.width !== env.PW || cv.height !== env.PH) {
    cv.width = env.PW;
    cv.height = env.PH;
  }
  return cv;
}
/* 3 luminance-cluster pane canvases + centroids + boundary-line canvas */
function exoLumaClusters(env) {
  return exoCached(`lumcl:${env.sig}`, () => {
    const A = env.baseAlpha();
    const ld = env.lookData().data;
    const W = env.PW;
    const H = env.PH;
    const lum = i => 0.299 * ld[i * 4] + 0.587 * ld[i * 4 + 1] + 0.114 * ld[i * 4 + 2];
    const lums = [];
    for (let i = 0; i < W * H; i++) {
      if (A[i]) lums.push(lum(i));
    }
    lums.sort((a, b) => a - b);
    const t1 = lums[Math.floor(lums.length / 3)] || 85;
    const t2 = lums[Math.floor((lums.length * 2) / 3)] || 170;
    const idx = new Int8Array(W * H).fill(-1);
    for (let i = 0; i < W * H; i++) {
      if (A[i]) {
        const l = lum(i);
        idx[i] = l < t1 ? 0 : l < t2 ? 1 : 2;
      }
    }
    const masks = [];
    const cent = [];
    const cols = [];
    for (let cl = 0; cl < 3; cl++) {
      const m = document.createElement("canvas");
      m.width = W;
      m.height = H;
      const mc = m.getContext("2d");
      const id = mc.createImageData(W, H);
      let n = 0;
      let sx = 0;
      let sy = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      for (let i = 0; i < W * H; i++) {
        if (idx[i] !== cl) continue;
        id.data[i * 4] = ld[i * 4];
        id.data[i * 4 + 1] = ld[i * 4 + 1];
        id.data[i * 4 + 2] = ld[i * 4 + 2];
        id.data[i * 4 + 3] = ld[i * 4 + 3];
        n++;
        sx += i % W;
        sy += Math.floor(i / W);
        cr += ld[i * 4];
        cg += ld[i * 4 + 1];
        cb += ld[i * 4 + 2];
      }
      mc.putImageData(id, 0, 0);
      masks.push(m);
      cent.push(n ? [sx / n, sy / n] : [env.cx, env.cy]);
      cols.push(n ? `rgb(${(cr / n) | 0},${(cg / n) | 0},${(cb / n) | 0})` : "rgb(150,160,200)");
    }
    const bound = document.createElement("canvas");
    bound.width = W;
    bound.height = H;
    const bc = bound.getContext("2d");
    const bid = bc.createImageData(W, H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (idx[i] < 0) continue;
        if (idx[i - 1] !== idx[i] || idx[i + 1] !== idx[i] || idx[i - W] !== idx[i] || idx[i + W] !== idx[i]) {
          bid.data[i * 4] = 12;
          bid.data[i * 4 + 1] = 12;
          bid.data[i * 4 + 2] = 20;
          bid.data[i * 4 + 3] = 215;
        }
      }
    }
    bc.putImageData(bid, 0, 0);
    return { idx, masks, cent, cols, bound };
  });
}
/* n alpha-mask canvases banding the body by inner distance (rim -> core) */
function exoBandMasks(env, n) {
  return exoCached(`bands:${env.species}:${env.PW}:${n}`, () => {
    const D = exoInnerDist(env);
    let maxD = 1;
    for (let i = 0; i < D.length; i++) {
      if (D[i] > maxD) maxD = D[i];
    }
    const W = env.PW;
    const H = env.PH;
    const out = [];
    for (let b = 0; b < n; b++) {
      const m = document.createElement("canvas");
      m.width = W;
      m.height = H;
      const mc = m.getContext("2d");
      const id = mc.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        if (D[i] < 0) continue;
        if (Math.min(n - 1, Math.floor((D[i] / (maxD + 1)) * n)) === b) {
          id.data[i * 4 + 3] = 255;
        }
      }
      mc.putImageData(id, 0, 0);
      out.push(m);
    }
    return out;
  });
}
/* draw a look-sized source through an alpha mask (scratch #2), then stamp */
function exoMasked(c, env, src, mask, o) {
  const s = exoScratch(env, 2);
  const sc = s.getContext("2d");
  sc.clearRect(0, 0, env.PW, env.PH);
  sc.imageSmoothingEnabled = false;
  sc.drawImage(src, 0, 0);
  sc.globalCompositeOperation = "destination-in";
  sc.drawImage(mask, 0, 0);
  sc.globalCompositeOperation = "source-over";
  exoStamp(c, env, s, o || {});
}
/* procedural poke ball (Origin Shell / Meteor Ball / Inventory Spill) */
function exoBall(c, x, y, r, rot, alpha) {
  c.save();
  c.globalAlpha = alpha ?? 1;
  c.translate(x, y);
  if (rot) c.rotate(rot);
  c.beginPath();
  c.arc(0, 0, r, 0, EXO_TAU);
  c.clip();
  c.fillStyle = "#f2f2f6";
  c.fillRect(-r, -r, r * 2, r * 2);
  c.fillStyle = "#e23b34";
  c.fillRect(-r, -r, r * 2, r);
  c.fillStyle = "#20242e";
  c.fillRect(-r, -r * 0.11, r * 2, r * 0.22);
  c.beginPath();
  c.arc(0, 0, r * 0.24, 0, EXO_TAU);
  c.fillStyle = "#20242e";
  c.fill();
  c.beginPath();
  c.arc(0, 0, r * 0.14, 0, EXO_TAU);
  c.fillStyle = "#fafafa";
  c.fill();
  c.beginPath();
  c.arc(-r * 0.35, -r * 0.45, r * 0.16, 0, EXO_TAU);
  c.fillStyle = "rgba(255,255,255,0.65)";
  c.fill();
  c.restore();
  c.save();
  c.globalAlpha = (alpha ?? 1) * 0.9;
  c.strokeStyle = "#141821";
  c.lineWidth = 1;
  c.beginPath();
  c.arc(x, y, r, 0, EXO_TAU);
  c.stroke();
  c.restore();
}
const EXO_TYPE_COLORS = {
  NORMAL: "#a8a878",
  FIRE: "#f08030",
  WATER: "#6890f0",
  ELECTRIC: "#f8d030",
  GRASS: "#78c850",
  ICE: "#98d8d8",
  FIGHTING: "#c03028",
  POISON: "#a040a0",
  GROUND: "#e0c068",
  FLYING: "#a890f0",
  PSYCHIC: "#f85888",
  BUG: "#a8b820",
  ROCK: "#b8a038",
  GHOST: "#705898",
  DRAGON: "#7038f8",
  DARK: "#705848",
  STEEL: "#b8b8d0",
  FAIRY: "#ee99ac",
};

const EXOTIC = {
  /* ================= EXOTIC (additive layers) =================================== */
  afterimage: {
    label: "Afterimage Trail",
    kind: "exotic",
    behind(c, env) {
      const lags = [4, 8, 12];
      for (let k = lags.length - 1; k >= 0; k--) {
        exoStamp(c, env, env.ring(lags[k]), {
          x: env.ox + env.cx - (k + 1) * 3,
          y: env.oy + env.cy + Math.sin(env.t * 2 + k) * 1.5,
          alpha: [0.4, 0.25, 0.13][k],
          filter: `hue-rotate(${(k + 1) * 45}deg) saturate(1.6)`,
        });
      }
    },
  },

  chorus: {
    label: "Chorus of Selves",
    kind: "exotic",
    behind(c, env) {
      const spread = (env.compact ? 0.2 : 0.28) * env.PW;
      for (let k = 0; k < 4; k++) {
        const side = k % 2 === 0 ? -1 : 1;
        const rank = 1 + Math.floor(k / 2);
        exoStamp(c, env, env.ring(3 + k * 5), {
          x: env.ox + env.cx + side * spread * rank * 0.62,
          y: env.oy + env.cy - rank * 2,
          s: 1 - rank * 0.16,
          alpha: 0.42 - rank * 0.13,
          filter: `hue-rotate(${side * rank * 25}deg)`,
        });
      }
    },
  },

  mirrormatch: {
    label: "Mirror Match",
    kind: "exotic",
    behind(c, env) {
      exoStamp(c, env, env.ring(4), {
        x: env.ox + env.cx - (env.compact ? 0.22 : 0.28) * env.PW,
        y: env.oy + env.cy - 2,
        sx: -0.92,
        sy: 0.92,
        alpha: 0.8,
        filter: "invert(1) hue-rotate(180deg)",
      });
    },
  },

  shadowpuppet: {
    label: "Shadow Puppet",
    kind: "exotic",
    behind(c, env) {
      const stretch = 0.42 + 0.1 * Math.sin(env.t * 0.7);
      exoStamp(c, env, env.ring(3), {
        x: env.ox + env.cx + 0.1 * env.PW,
        y: env.oy + env.fy,
        sx: 1.04,
        sy: -stretch, // flipped upward-drawn = lies along the ground away from the mon
        skewX: -0.9 + 0.1 * Math.sin(env.t * 0.5),
        alpha: 0.5,
        filter: "brightness(0)",
        anchorFeet: true,
      });
    },
  },

  spectralmolt: {
    label: "Spectral Molt",
    kind: "exotic",
    front(c, env) {
      const period = 4;
      const p = (((env.t % period) + period) % period) / period;
      if (p > 0.75) return;
      const q = p / 0.75;
      exoStamp(c, env, env.ring(Math.floor(q * 14) + 2), {
        y: env.oy + env.cy - q * 0.5 * env.PH,
        s: 1 + q * 0.18,
        alpha: (1 - q) * 0.5,
        filter: "hue-rotate(200deg) brightness(1.5) saturate(0.7)",
        comp: "lighter",
      });
    },
  },

  minime: {
    label: "Mini-Me",
    kind: "exotic",
    front(c, env) {
      const sway = Math.sin(env.t * 1.2);
      exoStamp(c, env, env.ring(2), {
        x: env.ox + env.cx + sway * (env.compact ? 0.26 : 0.34) * env.PW,
        y: env.oy + env.fy - Math.abs(Math.sin(env.t * 3.1)) * 6,
        sx: 0.3 * (Math.cos(env.t * 1.2) >= 0 ? 1 : -1),
        sy: 0.3,
        alpha: 1,
        anchorFeet: true,
      });
    },
  },

  /* orbiting glass shards, each holding a magnified hue-shifted crop of the FINAL look */
  prismcourt: {
    label: "Prism Court",
    kind: "exotic",
    _pass(c, env, wantFront) {
      const n = env.compact ? 4 : 6;
      for (let k = 0; k < n; k++) {
        const a = env.t * 0.22 + (k / n) * EXO_TAU;
        const depth = Math.sin(a);
        if (depth >= 0 !== wantFront) continue;
        const px = env.ox + env.cx + Math.cos(a) * (env.compact ? 0.33 : 0.42) * env.PW;
        const py = env.oy + env.cy + depth * 0.14 * env.PH - 0.04 * env.PH;
        const sz = (0.12 + 0.04 * depth) * env.PW;
        c.save();
        c.translate(px, py);
        c.rotate(env.t * 0.15 + k * 2.1);
        c.beginPath();
        for (let v = 0; v < 3; v++) {
          const va = (v / 3) * EXO_TAU + exoRand(env.seed, k * 7 + v) * 1.2;
          const vr = sz * (0.75 + 0.5 * exoRand(env.seed, k * 13 + v));
          const vx = Math.cos(va) * vr;
          const vy = Math.sin(va) * vr;
          v ? c.lineTo(vx, vy) : c.moveTo(vx, vy);
        }
        c.closePath();
        c.save();
        c.clip();
        c.imageSmoothingEnabled = false;
        c.globalCompositeOperation = "screen";
        c.globalAlpha = 0.92;
        c.filter = `saturate(1.6) brightness(${1.1 + 0.25 * depth}) hue-rotate(${k * 34}deg)`;
        const mag = 1.7;
        const sox = (exoRand(env.seed, k + 40) - 0.5) * 0.5 * env.PW;
        const soy = (exoRand(env.seed, k + 80) - 0.5) * 0.4 * env.PH;
        c.drawImage(env.look, -env.cx * mag - sox, -env.cy * mag - soy, env.PW * mag, env.PH * mag);
        c.restore();
        c.globalAlpha = 0.55;
        c.strokeStyle = "rgba(210,235,255,0.85)";
        c.lineWidth = 1;
        c.stroke();
        c.restore();
      }
    },
    behind(c, env) {
      this._pass(c, env, false);
    },
    front(c, env) {
      this._pass(c, env, true);
    },
  },

  /* a glossy magnetic bead orbits; the nearest silhouette edge grows black liquid
   * spikes reaching toward it, recoiling smooth as it passes */
  ferrofluid: {
    label: "Ferrofluid Compass",
    kind: "exotic",
    _bead(env) {
      const a = env.t * 0.55;
      return {
        x: env.cx + Math.cos(a) * (env.compact ? 0.42 : 0.5) * env.PW,
        y: env.cy + Math.sin(a) * 0.36 * env.PH,
        front: Math.sin(a) > 0,
      };
    },
    _drawBead(c, env, B) {
      const bx = env.ox + B.x;
      const by = env.oy + B.y;
      const g = c.createRadialGradient(bx - 1.5, by - 1.5, 0.5, bx, by, 5);
      g.addColorStop(0, "#cfd6ea");
      g.addColorStop(0.35, "#3a4054");
      g.addColorStop(1, "#05060c");
      c.fillStyle = g;
      c.beginPath();
      c.arc(bx, by, 4.5, 0, EXO_TAU);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath();
      c.arc(bx - 1.6, by - 1.8, 1.1, 0, EXO_TAU);
      c.fill();
    },
    behind(c, env) {
      const B = this._bead(env);
      if (!B.front) this._drawBead(c, env, B);
    },
    front(c, env) {
      const B = this._bead(env);
      const pts = exoEdge(env);
      c.save();
      for (const [x, y, nx, ny] of pts) {
        const dx = B.x - x;
        const dy = B.y - y;
        const d = Math.hypot(dx, dy) || 1;
        const attract = exoClamp(1 - d / (0.45 * env.PW), 0, 1);
        if (attract <= 0.03) continue;
        if ((dx * nx + dy * ny) / d < 0.25) continue; // only edges facing the bead
        const L = 2 + attract * attract * 13;
        const ux = dx / d;
        const uy = dy / d;
        const wob = Math.sin(env.t * 7 + x * 0.5 + y * 0.3) * attract * 1.4;
        c.fillStyle = `rgba(6,6,14,${0.45 + 0.45 * attract})`;
        c.beginPath();
        c.moveTo(env.ox + x - uy * 1.7, env.oy + y + ux * 1.7);
        c.lineTo(env.ox + x + uy * 1.7, env.oy + y - ux * 1.7);
        c.lineTo(env.ox + x + ux * L - uy * wob, env.oy + y + uy * L + ux * wob);
        c.closePath();
        c.fill();
      }
      c.restore();
      if (B.front) this._drawBead(c, env, B);
    },
  },

  /* the silhouette becomes a living elevation map: contour bands crawl inward,
   * ridges catch light, valleys darken - overlays the equipped look */
  topographic: {
    label: "Topographic Pulse",
    kind: "exotic",
    front(c, env) {
      const STATES = 12;
      const s = Math.floor((((env.t * 0.45) % 1) + 1) % 1 * STATES) % STATES;
      const cv = exoCached(`topo:${env.species}:${env.PW}:${s}`, () => {
        const D = exoInnerDist(env);
        const W = env.PW;
        const H = env.PH;
        const t = document.createElement("canvas");
        t.width = W;
        t.height = H;
        const tc = t.getContext("2d");
        const id = tc.createImageData(W, H);
        const px = id.data;
        for (let i = 0; i < W * H; i++) {
          const d = D[i];
          if (d < 0) continue;
          const f = (((d * 0.11 - s / STATES) % 1) + 1) % 1;
          if (f < 0.14) {
            const w = 1 - f / 0.14;
            px[i * 4] = 255;
            px[i * 4 + 1] = 255;
            px[i * 4 + 2] = 235;
            px[i * 4 + 3] = 165 * w;
          } else if (Math.abs(f - 0.5) < 0.1) {
            const w = 1 - Math.abs(f - 0.5) / 0.1;
            px[i * 4] = 8;
            px[i * 4 + 1] = 16;
            px[i * 4 + 2] = 80;
            px[i * 4 + 3] = 135 * w;
          }
        }
        tc.putImageData(id, 0, 0);
        return t;
      });
      c.save();
      c.imageSmoothingEnabled = false;
      c.globalCompositeOperation = "overlay";
      c.drawImage(cv, env.ox, env.oy);
      c.globalCompositeOperation = "screen";
      c.globalAlpha = 0.55;
      c.drawImage(cv, env.ox, env.oy);
      c.restore();
    },
  },

  /* ================= RIG (replaces the body draw) =============================== */

  paperdoll: {
    label: "Paper Doll",
    kind: "rig",
    draw(c, env) {
      const period = 5;
      const p = (((env.t % period) + period) % period) / period;
      const win = 0.22;
      if (p > win) {
        exoStamp(c, env, env.look, {});
        return;
      }
      const q = p / win;
      const k = Math.cos(q * Math.PI * 2);
      const backSide = k < 0;
      exoStamp(c, env, env.look, {
        sx: Math.max(0.04, Math.abs(k)) * (backSide ? -1 : 1),
        filter: backSide ? "brightness(0.55) sepia(0.5)" : "none",
      });
    },
  },

  lunarphase: {
    label: "Lunar Phase",
    kind: "rig",
    draw(c, env) {
      const term = env.ox + env.PW * (0.5 + 0.45 * Math.sin(env.t * 0.6));
      c.save();
      c.beginPath();
      c.rect(0, 0, term, env.EH);
      c.clip();
      exoStamp(c, env, env.look, {});
      c.restore();
      c.save();
      c.beginPath();
      c.rect(term, 0, env.EW - term, env.EH);
      c.clip();
      exoStamp(c, env, env.look, { filter: "hue-rotate(150deg) saturate(1.7) brightness(1.2)" });
      c.restore();
    },
  },

  liquefy: {
    label: "Liquefy",
    kind: "rig",
    draw(c, env) {
      const feetY = env.oy + env.fy;
      c.save();
      c.beginPath();
      c.rect(0, 0, env.EW, feetY);
      c.clip();
      exoStamp(c, env, env.look, {});
      c.restore();
      const depth = Math.min(env.EH - feetY - 1, Math.floor(env.PH * 0.35));
      c.save();
      c.imageSmoothingEnabled = false;
      for (let d = 0; d < depth; d += 2) {
        const srcY = env.fy - d - 1;
        if (srcY < 0) break;
        c.globalAlpha = 0.45 * (1 - d / depth);
        const wob = Math.sin(d * 0.55 + env.t * 3.2) * (1.5 + d * 0.08);
        c.drawImage(env.look, 0, srcY, env.PW, 2, env.ox + wob, feetY + d, env.PW, 2);
      }
      c.restore();
    },
  },

  /* at battle scale it reads normal - up close every color block is a tiny tinted
   * copy of the mon itself; the population reshuffles and the body breathes */
  mosaic: {
    label: "Recursive Mosaic",
    kind: "rig",
    _variant(env, v) {
      return exoCached(`mosaic:${env.sig}:${v}`, () => {
        const A = env.baseAlpha();
        const ld = env.lookData().data;
        const W = env.PW;
        const H = env.PH;
        const cell = 6;
        const cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        const cc = cv.getContext("2d");
        cc.imageSmoothingEnabled = false;
        for (let gy = 0; gy * cell < H; gy++) {
          for (let gx = 0; gx * cell < W; gx++) {
            const x0 = gx * cell;
            const y0 = gy * cell;
            let n = 0;
            let r = 0;
            let g = 0;
            let b = 0;
            for (let yy = 0; yy < cell && y0 + yy < H; yy++) {
              for (let xx = 0; xx < cell && x0 + xx < W; xx++) {
                const i = (y0 + yy) * W + x0 + xx;
                if (!A[i]) continue;
                n++;
                r += ld[i * 4];
                g += ld[i * 4 + 1];
                b += ld[i * 4 + 2];
              }
            }
            if (n < cell * cell * 0.22) continue;
            if ((gx + gy + v) % 2 === 0) continue; // two interleaved variants shuffle
            cc.fillStyle = `rgb(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0})`;
            cc.fillRect(x0, y0, cell, cell);
            cc.globalAlpha = 0.62;
            cc.drawImage(env.look, 0, 0, W, H, x0, y0, cell, cell);
            cc.globalAlpha = 1;
          }
        }
        cc.globalCompositeOperation = "destination-in";
        cc.drawImage(exoMaskCv(env), 0, 0);
        return cv;
      });
    },
    draw(c, env) {
      exoStamp(c, env, env.look, {}); // aura + base colors underneath
      const breath = 1 + 0.012 * Math.sin(env.t * 1.7);
      const v = Math.floor(env.t * 1.4) % 2;
      exoStamp(c, env, this._variant(env, v), { s: breath, alpha: 0.96 });
      exoStamp(c, env, this._variant(env, 1 - v), { s: breath, alpha: 0.96 });
    },
  },

  /* the lineage's palettes overwrite the body cluster by cluster, each generation
   * out of phase; the pre-evolution's ghost surfaces at the boundaries */
  palimpsest: {
    label: "Ancestral Palimpsest",
    kind: "rig",
    _states(env) {
      const chain = env.evo && env.evo.chain && env.evo.chain.length > 1 ? env.evo.chain : null;
      const cols = [];
      let loaded = 0;
      if (chain) {
        for (const id of chain) {
          if (id === env.species) {
            cols.push(null);
            loaded++;
          } else {
            const cv = env.aux(id);
            if (cv) {
              cols.push(exoAuxPalette(cv));
              loaded++;
            } else {
              cols.push(null);
            }
          }
        }
      }
      const L = chain ? chain.length : 3;
      return exoCached(`pal:${env.sig}:${loaded}:${L}`, () => {
        const A = env.baseAlpha();
        const ld = env.lookData().data;
        const W = env.PW;
        const H = env.PH;
        const lums = [];
        for (let i = 0; i < W * H; i++) {
          if (A[i]) lums.push(0.299 * ld[i * 4] + 0.587 * ld[i * 4 + 1] + 0.114 * ld[i * 4 + 2]);
        }
        lums.sort((a, b) => a - b);
        const t1 = lums[Math.floor(lums.length / 3)] || 85;
        const t2 = lums[Math.floor((lums.length * 2) / 3)] || 170;
        const states = [];
        for (let s = 0; s < L; s++) {
          const cv = document.createElement("canvas");
          cv.width = W;
          cv.height = H;
          const cc = cv.getContext("2d");
          for (let cl = 0; cl < 3; cl++) {
            const m = document.createElement("canvas");
            m.width = W;
            m.height = H;
            const mc = m.getContext("2d");
            const id = mc.createImageData(W, H);
            for (let i = 0; i < W * H; i++) {
              if (!A[i]) continue;
              const lum = 0.299 * ld[i * 4] + 0.587 * ld[i * 4 + 1] + 0.114 * ld[i * 4 + 2];
              if ((lum < t1 ? 0 : lum < t2 ? 1 : 2) !== cl) continue;
              id.data[i * 4] = ld[i * 4];
              id.data[i * 4 + 1] = ld[i * 4 + 1];
              id.data[i * 4 + 2] = ld[i * 4 + 2];
              id.data[i * 4 + 3] = ld[i * 4 + 3];
            }
            mc.putImageData(id, 0, 0);
            const m2 = document.createElement("canvas");
            m2.width = W;
            m2.height = H;
            m2.getContext("2d").drawImage(m, 0, 0);
            const memberPal = chain ? cols[(s + cl) % L] : null;
            const col = memberPal
              ? memberPal[cl % memberPal.length]
              : `hsl(${(env.species * 7 + s * 97 + cl * 41) % 360} 62% 55%)`;
            mc.globalCompositeOperation = "color";
            mc.fillStyle = col;
            mc.fillRect(0, 0, W, H);
            mc.globalCompositeOperation = "destination-in";
            mc.drawImage(m2, 0, 0);
            cc.drawImage(m, 0, 0);
          }
          states.push(cv);
        }
        return states;
      });
    },
    draw(c, env) {
      const states = this._states(env);
      const L = states.length;
      const cyc = ((((env.t * 0.14) % 1) + 1) % 1) * L;
      const s0 = Math.floor(cyc) % L;
      const s1 = (s0 + 1) % L;
      const f = exoSmooth(cyc - s0);
      exoStamp(c, env, env.look, {});
      c.save();
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 0.8 * (1 - f);
      c.drawImage(states[s0], env.ox, env.oy);
      c.globalAlpha = 0.8 * f;
      c.drawImage(states[s1], env.ox, env.oy);
      c.restore();
      const prev = env.evo && env.evo.prev ? env.aux(env.evo.prev) : null;
      if (prev) {
        const gh = (Math.sin(env.t * 0.5) + 1) / 2;
        if (gh > 0.55) {
          exoStampImg(c, env, prev, {
            x: env.ox + env.cx + Math.sin(env.t * 0.23) * 3,
            y: env.oy + env.cy,
            h: env.PH * 0.62,
            alpha: (gh - 0.55) * 0.55,
            comp: "source-atop",
            filter: "saturate(0) contrast(1.5) brightness(1.4)",
          });
        }
      }
    },
  },

  /* ================= MOMENT (auto-looping sequences) ============================ */

  shatter: {
    label: "Shatter",
    kind: "moment",
    _p(env) {
      const P = 5;
      return ((env.t % P) + P) % P;
    },
    hidesBase(env) {
      return this._p(env) < 1.15;
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 1.15) return;
      const disp = Math.sin((p / 1.15) * Math.PI);
      const N = 6;
      const cw = env.PW / N;
      const ch = env.PH / N;
      c.save();
      c.imageSmoothingEnabled = false;
      for (let gy = 0; gy < N; gy++) {
        for (let gx = 0; gx < N; gx++) {
          const i = gy * N + gx;
          const vx = (exoRand(env.seed, i) - 0.5) * 46;
          const vy = (exoRand(env.seed, i + 77) - 0.75) * 40;
          c.save();
          c.globalAlpha = 1 - 0.25 * disp;
          c.translate(
            env.ox + gx * cw + cw / 2 + vx * disp,
            env.oy + gy * ch + ch / 2 + vy * disp + 14 * disp * disp,
          );
          c.rotate((exoRand(env.seed, i + 154) - 0.5) * 1.6 * disp);
          c.drawImage(env.look, gx * cw, gy * ch, cw, ch, -cw / 2, -ch / 2, cw, ch);
          c.restore();
        }
      }
      c.restore();
    },
  },

  /* ================= TIME BEHAVING BADLY ======================================== */

  /* three staged backup singers - nonadjacent history frames, deliberate poses,
   * converging into the live body at the top of each cycle */
  echochoir: {
    label: "Echo Choir",
    kind: "exotic",
    behind(c, env) {
      const P = 6;
      const p = ((env.t % P) + P) % P;
      const conv = p < 0.5 ? exoSmooth(p / 0.5) : p < 1 ? exoSmooth((1 - p) / 0.5) : 0;
      const bx = env.ox + env.cx;
      const by = env.oy + env.cy;
      const spots = [
        [-0.34, 0.06, false],
        [0.34, 0.06, true],
        [0, -0.16, false],
      ];
      for (let k = 0; k < 3; k++) {
        const [ux, uy, flip] = spots[k];
        exoStamp(c, env, env.ring(6 + k * 6), {
          x: bx + ux * env.PW * (1 - conv),
          y: by + uy * env.PH * (1 - conv),
          sx: (flip ? -1 : 1) * (0.82 - k * 0.05),
          sy: 0.82 - k * 0.05,
          rot: Math.sin(env.t * 2.4 + (k * EXO_TAU) / 3) * 0.09 * (1 - conv),
          alpha: 0.5 * (1 - conv * 0.9),
          filter: `hue-rotate(${(k - 1) * 22}deg) saturate(1.25)`,
        });
      }
    },
  },

  /* temporal growth rings: the silhouette edge is the oldest moment, the core is
   * the present - motion ripples inward like rings through a trunk */
  chronocore: {
    label: "Chrono Core",
    kind: "rig",
    draw(c, env) {
      const masks = exoBandMasks(env, 4);
      const lags = [16, 10, 5, 0];
      const shade = [
        "brightness(0.78) saturate(1.6) hue-rotate(-16deg)",
        "brightness(0.9) saturate(1.3) hue-rotate(-8deg)",
        "brightness(0.98) saturate(1.1)",
        "none",
      ];
      for (let b = 0; b < 4; b++) {
        const wob = b < 3 ? Math.round(2 * Math.sin(env.t * 2 + b * 1.4) + 2) : 0;
        exoMasked(c, env, lags[b] + wob > 0 ? env.ring(lags[b] + wob) : env.look, masks[b], { filter: shade[b] });
      }
      // a ripple of light travelling inward through the rings
      const rq = (((env.t * 0.5) % 1) + 1) % 1;
      const rb = Math.floor(rq * 4);
      exoMasked(c, env, exoMaskCv(env), masks[Math.min(3, rb)], {
        comp: "lighter",
        alpha: 0.14 * Math.sin(((rq * 4) % 1) * Math.PI),
      });
    },
  },

  /* glassy bubbles drift around the mon, each preserving a magnified specimen of
   * a different past moment; they pass in front of and behind the body */
  aquarium: {
    label: "Temporal Aquarium",
    kind: "exotic",
    _pass(c, env, wantFront) {
      const n = env.compact ? 2 : 4;
      for (let k = 0; k < n; k++) {
        const a = env.t * 0.3 + (k / n) * EXO_TAU;
        const depth = Math.sin(a);
        if (depth >= 0 !== wantFront) continue;
        const bx = env.ox + env.cx + Math.cos(a) * (env.compact ? 0.36 : 0.44) * env.PW;
        const by = env.oy + env.cy + Math.sin(a * 1.3 + k) * 0.3 * env.PH;
        const r = (0.09 + 0.02 * depth) * env.PW;
        const mag = 2.1;
        // sample INSIDE the body so every bubble holds a real specimen
        const bb = exoBBox(env);
        const sx0 = bb.cx + (exoRand(env.seed, k + 5) - 0.5) * bb.w * 0.45;
        const sy0 = bb.cy + (exoRand(env.seed, k + 55) - 0.5) * bb.h * 0.45;
        c.save();
        c.beginPath();
        c.arc(bx, by, r, 0, EXO_TAU);
        c.clip();
        c.imageSmoothingEnabled = false;
        c.globalAlpha = 0.95;
        c.filter = "brightness(1.15)";
        c.drawImage(env.ring(4 + k * 5), bx - sx0 * mag, by - sy0 * mag, env.PW * mag, env.PH * mag);
        c.filter = "none";
        c.globalCompositeOperation = "screen";
        const g = c.createRadialGradient(bx - r * 0.4, by - r * 0.4, 1, bx, by, r);
        g.addColorStop(0, "rgba(190,225,255,0.4)");
        g.addColorStop(1, "rgba(120,160,220,0.05)");
        c.fillStyle = g;
        c.fillRect(bx - r, by - r, r * 2, r * 2);
        c.restore();
        c.save();
        c.strokeStyle = `rgba(200,230,255,${0.5 + 0.2 * depth})`;
        c.lineWidth = 1;
        c.beginPath();
        c.arc(bx, by, r, 0, EXO_TAU);
        c.stroke();
        c.restore();
      }
    },
    behind(c, env) {
      this._pass(c, env, false);
    },
    front(c, env) {
      this._pass(c, env, true);
    },
  },

  /* ================= IDENTITY & LINEAGE ========================================= */

  /* a slatted zoetrope of the whole evolution line rotates behind the mon; the
   * shifting genetic barcode periodically resolves into a readable ancestor */
  evodrum: {
    label: "Evolution Drum",
    kind: "exotic",
    /* normalized filmstrip of the whole line (uniform height, trimmed to content) */
    _strip(env) {
      const chain = (env.evo && env.evo.chain) || [];
      const S = chain.map(id => (id === env.species ? null : env.aux(id)));
      const loaded = S.filter(Boolean).length;
      return exoCached(`drum:${env.sig}:${loaded}`, () => {
        const bb = exoBBox(env);
        const H = 44;
        const parts = [];
        for (let i = 0; i < chain.length; i++) {
          if (chain[i] === env.species) {
            parts.push({ img: env.look, sx: bb.x0, sy: bb.y0, sw: bb.w, sh: bb.h });
          } else if (S[i]) {
            parts.push({ img: S[i], sx: 0, sy: 0, sw: S[i].width, sh: S[i].height });
          }
        }
        if (parts.length < 2) {
          parts.length = 0;
          for (const lag of [14, 7, 0]) {
            parts.push({ img: lag ? env.ring(lag) : env.look, sx: bb.x0, sy: bb.y0, sw: bb.w, sh: bb.h });
          }
        }
        let tw = 0;
        const widths = parts.map(pt => {
          const w = Math.max(8, Math.round((pt.sw / pt.sh) * H) + 4);
          tw += w;
          return w;
        });
        const cv = document.createElement("canvas");
        cv.width = tw;
        cv.height = H;
        const cc = cv.getContext("2d");
        cc.imageSmoothingEnabled = false;
        let x = 0;
        for (let i = 0; i < parts.length; i++) {
          const pt = parts[i];
          cc.drawImage(pt.img, pt.sx, pt.sy, pt.sw, pt.sh, x + 2, 0, widths[i] - 4, H);
          x += widths[i];
        }
        return cv;
      });
    },
    behind(c, env) {
      const strip = this._strip(env);
      const bb = exoBBox(env);
      const n = env.compact ? 10 : 14;
      const R = 0.42 * env.PW + bb.w * 0.12;
      const dh = bb.h * 0.85;
      const dy = env.oy + bb.cy;
      const dx0 = env.ox + bb.cx;
      c.save();
      c.imageSmoothingEnabled = false;
      // drum shell
      c.globalAlpha = 0.25;
      c.fillStyle = "#05060d";
      c.beginPath();
      c.ellipse(dx0, dy, R * 1.05, dh * 0.58, 0, 0, EXO_TAU);
      c.fill();
      // slats: the film strip wrapped around the cylinder, front face only
      for (let k = 0; k < n; k++) {
        const a = env.t * 0.28 + (k / n) * EXO_TAU;
        const ca = Math.cos(a);
        if (ca <= 0.08) continue;
        const uu = (((a / EXO_TAU) % 1) + 1) % 1;
        const sw = strip.width / n;
        const x = dx0 + Math.sin(a) * R;
        const w = Math.max(1.5, ca * ((R * EXO_TAU) / n) * 0.8);
        c.globalAlpha = 0.35 + 0.45 * ca;
        c.filter = `brightness(${0.5 + 0.5 * ca}) saturate(0.9)`;
        c.drawImage(strip, uu * strip.width, 0, Math.min(sw, strip.width - uu * strip.width), strip.height, x - w / 2, dy - dh / 2, w, dh);
      }
      c.filter = "none";
      // drum rims
      c.globalAlpha = 0.5;
      c.strokeStyle = "#2c3348";
      c.lineWidth = 1.5;
      for (const ry of [-dh / 2 - 1, dh / 2 + 1]) {
        c.beginPath();
        c.ellipse(dx0, dy + ry, R, 3.2, 0, Math.PI, EXO_TAU);
        c.stroke();
      }
      c.restore();
    },
  },

  /* a fragment of the mon's own essence unfolded into a spectral machine: mirrored
   * wings, orbit rings, and a glowing reliquary core at the chest */
  relicpossession: {
    label: "Relic Possession",
    kind: "exotic",
    behind(c, env) {
      const rw = 0.3 * env.PW;
      const sx0 = env.cx - rw / 2;
      const sy0 = env.cy - 0.3 * env.PH;
      const flap = Math.sin(env.t * 1.6) * 0.16;
      for (const side of [-1, 1]) {
        c.save();
        c.translate(env.ox + env.cx + side * 0.26 * env.PW, env.oy + env.cy - 0.1 * env.PH);
        c.rotate(side * (0.45 + flap));
        c.scale(side * 1.05, 0.95);
        c.globalAlpha = 0.32;
        c.globalCompositeOperation = "screen";
        c.imageSmoothingEnabled = false;
        c.filter = "saturate(1.6) brightness(1.25)";
        c.drawImage(env.look, sx0, sy0, rw, rw, -rw / 2, -rw / 2, rw, rw);
        c.restore();
      }
    },
    front(c, env) {
      const bx = env.ox + env.cx;
      const by = env.oy + env.cy;
      // orbit rings
      c.save();
      c.strokeStyle = "rgba(190,220,255,0.4)";
      c.lineWidth = 1;
      for (let r2 = 0; r2 < 2; r2++) {
        c.beginPath();
        c.ellipse(bx, by, 0.42 * env.PW, 0.12 * env.PH, Math.sin(env.t * (0.5 + r2 * 0.23)) * 0.5, 0, EXO_TAU);
        c.stroke();
      }
      c.restore();
      // reliquary core at the chest
      const pulse = 0.85 + 0.15 * Math.sin(env.t * 3.4);
      const cw = 0.085 * env.PW * pulse;
      c.save();
      c.globalCompositeOperation = "lighter";
      const g = c.createRadialGradient(bx, by + 0.06 * env.PH, 1, bx, by + 0.06 * env.PH, cw * 1.8);
      g.addColorStop(0, "rgba(200,235,255,0.42)");
      g.addColorStop(1, "rgba(120,170,255,0)");
      c.fillStyle = g;
      c.fillRect(bx - cw * 2, by - cw * 2 + 0.06 * env.PH, cw * 4, cw * 4);
      c.beginPath();
      c.arc(bx, by + 0.06 * env.PH, cw, 0, EXO_TAU);
      c.clip();
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 0.95;
      c.filter = "saturate(1.8) brightness(1.4)";
      c.drawImage(env.look, bx - env.cx * 0.5 - 0, by + 0.06 * env.PH - env.cy * 0.5, env.PW * 0.5, env.PH * 0.5);
      c.restore();
    },
  },

  /* the name's letters live as runes orbiting the body, periodically snapping
   * into the full name overhead before bursting apart again */
  nameanagram: {
    label: "Anagram Engine",
    kind: "exotic",
    front(c, env) {
      const name = (env.name || "PKMN").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "PKMN";
      const P = 8;
      const p = ((env.t % P) + P) % P;
      const align = p < 2 ? (p < 0.4 ? exoSmooth(p / 0.4) : p < 1.6 ? 1 : exoSmooth((2 - p) / 0.4)) : 0;
      const bx = env.ox + env.cx;
      const topY = env.oy + Math.max(8, env.cy - 0.55 * env.PH);
      c.save();
      c.font = `${env.compact ? 7 : 9}px monospace`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineWidth = 2.5;
      for (let i = 0; i < name.length; i++) {
        const oa = env.t * (0.5 + 0.13 * ((i * 29) % 4)) + (i / name.length) * EXO_TAU;
        const orx = bx + Math.cos(oa) * 0.44 * env.PW;
        const ory = env.oy + env.cy + Math.sin(oa * 1.3) * 0.4 * env.PH;
        const ax = bx + (i - (name.length - 1) / 2) * (env.compact ? 5.5 : 7);
        const gx = orx + (ax - orx) * align;
        const gy = ory + (topY - ory) * align;
        c.globalAlpha = 0.75 + 0.25 * align;
        c.strokeStyle = "rgba(6,8,16,0.85)";
        c.strokeText(name[i], gx, gy);
        c.fillStyle = align > 0.5 ? "#ffe9a8" : `hsl(${(i * 37 + env.t * 30) % 360} 80% 75%)`;
        c.fillText(name[i], gx, gy);
      }
      if (align > 0.7) {
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = (align - 0.7) * 1.2;
        c.strokeStyle = "rgba(255,235,170,0.5)";
        c.lineWidth = 0.75;
        c.beginPath();
        c.moveTo(bx - name.length * 4, topY + 6);
        c.lineTo(bx + name.length * 4, topY + 6);
        c.stroke();
      }
      c.restore();
    },
  },

  /* ================= IMPOSSIBLE MATERIALS ======================================= */

  /* every tone becomes a translucent pane, cluster boundaries turn to lead lines,
   * and a drifting backlight makes different panes flare in turn */
  stainedglass: {
    label: "Stained Glass",
    kind: "rig",
    draw(c, env) {
      const L = exoLumaClusters(env);
      const bbSG = exoBBox(env);
      const la = env.t * 0.4;
      const lx = bbSG.cx + Math.cos(la) * bbSG.w * 0.4;
      const ly = bbSG.cy + Math.sin(la * 0.7) * bbSG.h * 0.32;
      for (let cl = 0; cl < 3; cl++) {
        const d = Math.hypot(L.cent[cl][0] - lx, L.cent[cl][1] - ly) / (0.6 * env.PW);
        exoStamp(c, env, L.masks[cl], {
          filter: `saturate(1.85) contrast(1.1) brightness(${1.3 - 0.45 * exoClamp(d, 0, 1)})`,
          alpha: 0.97,
        });
      }
      c.save();
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 0.9;
      c.drawImage(L.bound, env.ox, env.oy);
      c.restore();
      // the light source shining THROUGH the panes (masked to the body)
      const sSG = exoScratch(env, 2);
      const scSG = sSG.getContext("2d");
      scSG.clearRect(0, 0, env.PW, env.PH);
      const gSG = scSG.createRadialGradient(lx, ly, 2, lx, ly, bbSG.w * 0.55);
      gSG.addColorStop(0, "rgba(255,246,215,0.75)");
      gSG.addColorStop(1, "rgba(255,246,215,0)");
      scSG.fillStyle = gSG;
      scSG.fillRect(0, 0, env.PW, env.PH);
      scSG.globalCompositeOperation = "destination-in";
      scSG.drawImage(exoMaskCv(env), 0, 0);
      exoStamp(c, env, sSG, { comp: "screen", alpha: 0.85 });
    },
  },

  /* the body creases into shaded triangular facets that hinge in staggered folds,
   * blooming into an impossible paper star once per cycle */
  origami: {
    label: "Origami Storm",
    kind: "rig",
    draw(c, env) {
      const P = 7;
      const p = ((env.t % P) + P) % P;
      const bloom = p < 1.4 ? Math.sin((p / 1.4) * Math.PI) : 0;
      const gn = env.compact ? 2 : 3;
      const cw = env.PW / gn;
      const ch = env.PH / gn;
      if (bloom > 0.05) {
        c.save();
        c.globalAlpha = 0.3;
        c.imageSmoothingEnabled = false;
        c.drawImage(env.look, env.ox, env.oy);
        c.restore();
      }
      c.save();
      c.imageSmoothingEnabled = false;
      for (let gy = 0; gy < gn; gy++) {
        for (let gx = 0; gx < gn; gx++) {
          for (let tr = 0; tr < 2; tr++) {
            const k = (gy * gn + gx) * 2 + tr;
            const x0 = gx * cw;
            const y0 = gy * ch;
            const fcx = x0 + cw * (tr ? 0.66 : 0.33);
            const fcy = y0 + ch * (tr ? 0.66 : 0.33);
            const dirx = fcx - env.cx;
            const diry = fcy - env.cy;
            const dl = Math.hypot(dirx, diry) || 1;
            const disp = bloom * 0.22 * env.PW;
            c.save();
            c.translate(env.ox + fcx + (dirx / dl) * disp, env.oy + fcy + (diry / dl) * disp);
            c.rotate(bloom * (exoRand(env.seed, k) - 0.5) * 1.4);
            c.translate(-(env.ox + fcx), -(env.oy + fcy));
            c.beginPath();
            if (tr === 0) {
              c.moveTo(env.ox + x0, env.oy + y0);
              c.lineTo(env.ox + x0 + cw, env.oy + y0);
              c.lineTo(env.ox + x0, env.oy + y0 + ch);
            } else {
              c.moveTo(env.ox + x0 + cw, env.oy + y0);
              c.lineTo(env.ox + x0 + cw, env.oy + y0 + ch);
              c.lineTo(env.ox + x0, env.oy + y0 + ch);
            }
            c.closePath();
            c.clip();
            c.filter = `brightness(${1 + 0.18 * Math.sin(env.t * 1.3 + k * 1.9)})`;
            c.drawImage(env.look, env.ox, env.oy);
            c.restore();
          }
        }
      }
      c.restore();
    },
  },

  /* the sprite re-embroidered in X stitches on a hoop, loose threads swaying
   * from the edges as the fabric breathes */
  crossstitch: {
    label: "Cross-Stitch",
    kind: "rig",
    _tex(env) {
      return exoCached(`stitch:${env.sig}`, () => {
        const A = env.baseAlpha();
        const ld = env.lookData().data;
        const W = env.PW;
        const H = env.PH;
        const cell = 3;
        const cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        const cc = cv.getContext("2d");
        cc.lineWidth = 1.1;
        cc.lineCap = "round";
        for (let gy = 0; gy * cell < H; gy++) {
          for (let gx = 0; gx * cell < W; gx++) {
            const x0 = gx * cell;
            const y0 = gy * cell;
            let n = 0;
            let r = 0;
            let g = 0;
            let b = 0;
            for (let yy = 0; yy < cell && y0 + yy < H; yy++) {
              for (let xx = 0; xx < cell && x0 + xx < W; xx++) {
                const i = (y0 + yy) * W + x0 + xx;
                if (!A[i]) continue;
                n++;
                r += ld[i * 4];
                g += ld[i * 4 + 1];
                b += ld[i * 4 + 2];
              }
            }
            if (n < 3) continue;
            r /= n;
            g /= n;
            b /= n;
            cc.fillStyle = `rgb(${(r * 0.42) | 0},${(g * 0.42) | 0},${(b * 0.42) | 0})`;
            cc.fillRect(x0, y0, cell, cell);
            cc.strokeStyle = `rgb(${Math.min(255, r * 1.3) | 0},${Math.min(255, g * 1.3) | 0},${Math.min(255, b * 1.3) | 0})`;
            cc.beginPath();
            cc.moveTo(x0 + 0.5, y0 + 0.5);
            cc.lineTo(x0 + cell - 0.5, y0 + cell - 0.5);
            cc.moveTo(x0 + cell - 0.5, y0 + 0.5);
            cc.lineTo(x0 + 0.5, y0 + cell - 0.5);
            cc.stroke();
          }
        }
        return cv;
      });
    },
    draw(c, env) {
      // embroidery hoop hugging the body
      const bbCS = exoBBox(env);
      c.save();
      c.strokeStyle = "#8a6b45";
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(env.ox + bbCS.cx, env.oy + bbCS.cy, bbCS.w * 0.62 + 5, bbCS.h * 0.62 + 5, 0, 0, EXO_TAU);
      c.stroke();
      c.strokeStyle = "#5e4426";
      c.lineWidth = 1;
      c.stroke();
      c.restore();
      exoStamp(c, env, this._tex(env), { s: 1 + 0.01 * Math.sin(env.t * 1.4) });
      // loose threads from the edge
      const pts = exoEdge(env);
      c.save();
      c.lineWidth = 0.9;
      for (let k = 0; k < 4; k++) {
        const pt = pts[Math.floor(exoRand(env.seed, k + 3) * pts.length)] || [env.cx, env.cy, 1, 0];
        const sway = Math.sin(env.t * 1.8 + k * 2) * 5;
        c.strokeStyle = "rgba(220,205,180,0.7)";
        c.beginPath();
        c.moveTo(env.ox + pt[0], env.oy + pt[1]);
        c.quadraticCurveTo(
          env.ox + pt[0] + pt[2] * 8 + sway,
          env.oy + pt[1] + pt[3] * 8 + 4,
          env.ox + pt[0] + pt[2] * 12 + sway * 1.6,
          env.oy + pt[1] + pt[3] * 12 + 9,
        );
        c.stroke();
      }
      c.restore();
    },
  },

  /* the body sealed under translucent bubble cells that pop in little chains
   * and reinflate one by one */
  bubblewrap: {
    label: "Bubblewrap",
    kind: "rig",
    _field(env) {
      return exoCached(`bubble:${env.sig}`, () => {
        const A = env.baseAlpha();
        const ld = env.lookData().data;
        const W = env.PW;
        const H = env.PH;
        const cell = 5;
        const cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        const cc = cv.getContext("2d");
        const cells = [];
        for (let gy = 0; gy * cell < H; gy++) {
          for (let gx = 0; gx * cell < W; gx++) {
            const x0 = gx * cell;
            const y0 = gy * cell;
            let n = 0;
            let r = 0;
            let g = 0;
            let b = 0;
            for (let yy = 0; yy < cell && y0 + yy < H; yy++) {
              for (let xx = 0; xx < cell && x0 + xx < W; xx++) {
                const i = (y0 + yy) * W + x0 + xx;
                if (!A[i]) continue;
                n++;
                r += ld[i * 4];
                g += ld[i * 4 + 1];
                b += ld[i * 4 + 2];
              }
            }
            if (n < cell * cell * 0.4) continue;
            const col = [r / n, g / n, b / n];
            cells.push({ x: x0 + cell / 2, y: y0 + cell / 2, col });
            cc.fillStyle = `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},0.95)`;
            cc.beginPath();
            cc.arc(x0 + cell / 2, y0 + cell / 2, cell / 2 - 0.3, 0, EXO_TAU);
            cc.fill();
            cc.fillStyle = "rgba(255,255,255,0.5)";
            cc.beginPath();
            cc.arc(x0 + cell / 2 - 1.1, y0 + cell / 2 - 1.1, 0.8, 0, EXO_TAU);
            cc.fill();
          }
        }
        return { cv, cells };
      });
    },
    draw(c, env) {
      const F = this._field(env);
      c.save();
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 0.5;
      c.drawImage(env.look, env.ox, env.oy);
      c.globalAlpha = 1;
      c.drawImage(F.cv, env.ox, env.oy);
      // popping chain
      const beat = Math.floor(env.t / 2.2);
      const bp = (env.t / 2.2 - Math.floor(env.t / 2.2)) * 2.2;
      for (let k = 0; k < 3 && F.cells.length > 0; k++) {
        const cellI = Math.floor(exoRand(env.seed, beat * 5 + k) * F.cells.length);
        const cell = F.cells[cellI];
        const t0 = k * 0.18;
        if (bp < t0 || bp > t0 + 0.9) continue;
        const q = (bp - t0) / 0.9;
        c.beginPath();
        c.arc(env.ox + cell.x, env.oy + cell.y, 2.2, 0, EXO_TAU);
        if (q < 0.25) {
          c.fillStyle = "rgba(14,16,26,0.75)"; // popped flat
          c.fill();
        } else {
          const rg = exoClamp((q - 0.25) / 0.75, 0, 1);
          c.fillStyle = `rgba(${cell.col[0] | 0},${cell.col[1] | 0},${cell.col[2] | 0},0.95)`;
          c.beginPath();
          c.arc(env.ox + cell.x, env.oy + cell.y, 2.2 * rg, 0, EXO_TAU);
          c.fill();
        }
      }
      c.restore();
    },
  },

  /* ================= FAKE 3D & HOSTILE PHYSICS ================================== */

  /* the sprite drifts apart into a shallow cloud of overlapping viewpoints, then
   * periodically clicks back into the exact source image */
  cubist: {
    label: "Cubist Breathing",
    kind: "rig",
    draw(c, env) {
      const P = 8;
      const p = ((env.t % P) + P) % P;
      const amp = p < 6 ? 1 : p < 7 ? 1 - exoSmooth((p - 6) / 1) : 0;
      const cols = 3;
      const rows = 4;
      const cw = env.PW / cols;
      const ch = env.PH / rows;
      c.save();
      c.imageSmoothingEnabled = false;
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const k = gy * cols + gx;
          const dx = Math.sin(env.t * 0.5 + k * 1.7) * 3 * amp;
          const dy = Math.cos(env.t * 0.42 + k * 2.3) * 2.2 * amp;
          const rot = Math.sin(env.t * 0.35 + k) * 0.07 * amp;
          const sc = 1 + 0.07 * Math.sin(env.t * 0.6 + k * 3.1) * amp;
          const fcx = env.ox + (gx + 0.5) * cw;
          const fcy = env.oy + (gy + 0.5) * ch;
          c.save();
          c.translate(fcx + dx, fcy + dy);
          c.rotate(rot);
          c.scale(sc, sc);
          if (amp > 0.05 && k % 4 === 1) {
            c.globalCompositeOperation = "multiply";
            c.globalAlpha = 0.65;
          }
          c.drawImage(env.look, gx * cw, gy * ch, cw, ch, -cw / 2, -ch / 2, cw, ch);
          c.restore();
        }
      }
      c.restore();
    },
  },

  /* the sprite extruded from stacked silhouette slabs that yaw like a chunky
   * voxel statue carved from the equipped look */
  voxel: {
    label: "Voxel Idol",
    kind: "rig",
    draw(c, env) {
      const yaw = Math.sin(env.t * 0.6);
      const ox2 = yaw * 2.4;
      const oy2 = -1.5;
      const n = env.compact ? 3 : 5;
      c.save();
      c.globalAlpha = 0.35;
      c.fillStyle = "#000";
      c.beginPath();
      c.ellipse(env.ox + env.cx + yaw * 4, env.oy + env.fy + 3, 0.3 * env.PW, 4, 0, 0, EXO_TAU);
      c.fill();
      c.restore();
      c.save();
      c.imageSmoothingEnabled = false;
      for (let k = n; k >= 1; k--) {
        c.filter = `brightness(${0.5 + (0.09 * (n - k)) / 1}) saturate(0.85)`;
        c.drawImage(env.look, env.ox - ox2 * k, env.oy - oy2 * k);
      }
      c.filter = "none";
      c.drawImage(env.look, env.ox, env.oy);
      c.restore();
    },
  },

  /* ================= CROSS-LAYER ALCHEMY ======================================== */

  /* the aura lives ONLY inside the projected shadow: a hidden garden of stars and
   * blooms slides across the ground under an outwardly restrained mon */
  shadowbloom: {
    label: "Shadow Bloom",
    kind: "exotic",
    behind(c, env) {
      const sx0 = env.ox + env.cx + Math.sin(env.t * 0.8) * 3;
      const sy0 = env.oy + env.fy + 3;
      const rx = 0.45 * env.PW;
      const ry = 0.13 * env.PH;
      c.save();
      c.beginPath();
      c.ellipse(sx0, sy0, rx, ry, 0, 0, EXO_TAU);
      c.fillStyle = "rgba(8,8,18,0.6)";
      c.fill();
      c.clip();
      c.globalCompositeOperation = "lighter";
      for (let i = 0; i < 10; i++) {
        const tw = (Math.sin(env.t * (1.5 + exoRand(env.seed, i)) + i * 2.4) + 1) / 2;
        const px2 = sx0 + (exoRand(env.seed, i + 10) - 0.5) * rx * 1.8;
        const py2 = sy0 + (exoRand(env.seed, i + 40) - 0.5) * ry * 1.8;
        c.globalAlpha = tw * 0.85;
        c.fillStyle = `hsl(${(i * 47 + env.t * 20) % 360} 85% 70%)`;
        c.beginPath();
        c.arc(px2, py2, 0.8 + tw * 1.1, 0, EXO_TAU);
        c.fill();
        if (i < 3) {
          // little blooms: 4-petal crosses
          const bs = 1.5 + tw * 2;
          c.globalAlpha = tw * 0.7;
          c.fillRect(px2 - bs, py2 - 0.5, bs * 2, 1);
          c.fillRect(px2 - 0.5, py2 - bs, 1, bs * 2);
        }
      }
      c.restore();
    },
  },

  /* the ground reflection is a different individual: shiny-shifted, out of step,
   * and it only reluctantly snaps back into agreement */
  contrarian: {
    label: "Contrarian Reflection",
    kind: "exotic",
    behind(c, env) {
      const P = 6.5;
      const p = ((env.t % P) + P) % P;
      const agree = p > 4.6 && p < 5.8;
      const lag = agree ? 0 : 12;
      const flip = agree ? 1 : -1;
      const feetY = env.oy + env.fy + 1;
      const s = exoScratch(env, 5);
      const sc = s.getContext("2d");
      sc.clearRect(0, 0, env.PW, env.PH);
      sc.imageSmoothingEnabled = false;
      // ripple: 3 slice bands with horizontal offsets
      const rippleAmt = p > 4.2 && p < 4.6 ? Math.sin(((p - 4.2) / 0.4) * Math.PI) * 3 : 1;
      const H3 = Math.ceil(env.PH / 6);
      for (let b = 0; b < 6; b++) {
        const off = Math.sin(b * 1.3 + env.t * 2.2) * rippleAmt;
        sc.drawImage(env.ring(lag), 0, b * H3, env.PW, H3, off, b * H3, env.PW, H3);
      }
      c.save();
      c.imageSmoothingEnabled = false;
      c.translate(env.ox + env.cx, feetY);
      c.scale(flip, -0.62);
      c.globalAlpha = 0.55;
      c.filter = agree ? "brightness(0.9)" : "hue-rotate(140deg) saturate(1.7) brightness(1.05)";
      c.drawImage(s, -env.cx, -env.fy);
      c.restore();
    },
  },

  /* ================= MOMENTS (battle theater) =================================== */

  /* one 200ms beat of comic-print violence: halftone panel, speed wedges, a
   * misregistered CMY double-print, and a POW star - then business as usual */
  comicpanel: {
    label: "Comic Hitstop",
    kind: "moment",
    _p(env) {
      const P = 4.5;
      return ((env.t % P) + P) % P;
    },
    _dots(env) {
      return exoCached(`halftone:${env.PW}`, () => {
        const cv = document.createElement("canvas");
        cv.width = env.PW;
        cv.height = env.PH;
        const cc = cv.getContext("2d");
        cc.fillStyle = "#e8dfc8";
        cc.fillRect(0, 0, env.PW, env.PH);
        cc.fillStyle = "#b8452e";
        for (let y = 0; y < env.PH; y += 5) {
          for (let x = (y / 5) % 2 === 0 ? 0 : 2.5; x < env.PW; x += 5) {
            cc.beginPath();
            cc.arc(x, y, 1.1, 0, EXO_TAU);
            cc.fill();
          }
        }
        return cv;
      });
    },
    hidesBase(env) {
      return this._p(env) < 0.55;
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 0.55) return;
      const jx = Math.round((exoRand(env.seed, Math.floor(env.t * 40)) - 0.5) * 2);
      c.save();
      c.imageSmoothingEnabled = false;
      // halftone panel behind (rotated card)
      c.save();
      c.translate(env.ox + env.cx + jx, env.oy + env.cy);
      c.rotate(-0.12);
      c.globalAlpha = 0.92;
      c.drawImage(this._dots(env), -env.cx - 6, -env.cy - 6, env.PW + 12, env.PH + 12);
      // speed wedges
      c.fillStyle = "#14161f";
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * EXO_TAU + 0.35;
        c.save();
        c.rotate(ang);
        c.beginPath();
        c.moveTo(0.65 * env.PW, -7);
        c.lineTo(0.65 * env.PW, 7);
        c.lineTo(0.24 * env.PW, 0);
        c.closePath();
        c.fill();
        c.restore();
      }
      c.restore();
      // misregistered print copies + the held frame
      c.globalAlpha = 0.45;
      c.globalCompositeOperation = "multiply";
      c.filter = "contrast(1.9) grayscale(1)";
      c.drawImage(env.ring(2), env.ox + jx + 2, env.oy - 1);
      c.globalCompositeOperation = "screen";
      c.filter = "hue-rotate(180deg)";
      c.drawImage(env.ring(2), env.ox + jx - 2, env.oy + 1);
      c.filter = "none";
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = 1;
      c.drawImage(env.ring(2), env.ox + jx, env.oy);
      // POW star
      const sx0 = env.ox + env.cx + 0.3 * env.PW;
      const sy0 = env.oy + env.cy - 0.32 * env.PH;
      c.save();
      c.translate(sx0, sy0);
      c.rotate(0.2);
      c.beginPath();
      for (let i = 0; i < 16; i++) {
        const r = i % 2 === 0 ? 9 : 4.5;
        const a = (i / 16) * EXO_TAU;
        i === 0 ? c.moveTo(Math.cos(a) * r, Math.sin(a) * r) : c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      c.fillStyle = "#ffd23e";
      c.fill();
      c.lineWidth = 1.2;
      c.strokeStyle = "#14161f";
      c.stroke();
      c.restore();
      c.restore();
    },
  },

  /* pockets get turned out: the mon's belongings tumble loose, bounce, and one
   * gets snatched back while the decoys pop into pixels */
  inventoryspill: {
    label: "Inventory Spill",
    kind: "moment",
    _p(env) {
      const P = 6.5;
      return ((env.t % P) + P) % P;
    },
    _item(c, env, kind, x, y, r, rot, alpha) {
      if (kind === 0) {
        exoBall(c, x, y, r, rot, alpha);
        return;
      }
      c.save();
      c.globalAlpha = alpha;
      c.translate(x, y);
      c.rotate(rot);
      if (kind === 1) {
        // berry
        c.fillStyle = "#e0524f";
        c.beginPath();
        c.arc(0, 0.5, r * 0.9, 0, EXO_TAU);
        c.fill();
        c.fillStyle = "#5a9c3a";
        c.fillRect(-0.8, -r - 1, 1.6, 3);
        c.fillStyle = "rgba(255,255,255,0.5)";
        c.beginPath();
        c.arc(-r * 0.35, 0, r * 0.25, 0, EXO_TAU);
        c.fill();
      } else {
        // charm card
        c.fillStyle = "#e8c34a";
        c.fillRect(-r * 0.7, -r, r * 1.4, r * 2);
        c.strokeStyle = "#7a611c";
        c.lineWidth = 0.75;
        c.strokeRect(-r * 0.7, -r, r * 1.4, r * 2);
        c.fillStyle = "#fff3c4";
        c.fillRect(-r * 0.3, -r * 0.5, r * 0.6, r);
      }
      c.restore();
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 2) return;
      const feetY = env.oy + env.fy;
      const cx = env.ox + env.cx;
      for (let i = 0; i < 5; i++) {
        const kind = i % 3;
        const vx = (exoRand(env.seed, i + 4) - 0.5) * 0.55 * env.PW;
        const vy0 = -(14 + exoRand(env.seed, i + 44) * 16);
        const grabbed = i === 0;
        let q = exoClamp(p / 1.1, 0, 1);
        let x = cx + vx * q;
        // one bounce
        const tq = q * 1.35;
        let y = env.oy + env.cy + vy0 * tq + 38 * tq * tq;
        if (y > feetY - 2) {
          const t2 = tq - 0.9;
          y = t2 > 0 ? Math.min(feetY - 2, feetY - 2 - Math.abs(Math.sin(t2 * 6)) * 7 * Math.max(0, 1 - t2 * 1.4)) : feetY - 2;
        }
        let alpha = 1;
        let r = 5;
        if (p > 1.1) {
          const q2 = exoClamp((p - 1.1) / 0.6, 0, 1);
          if (grabbed) {
            x += (cx - x) * exoSmooth(q2);
            y += (env.oy + env.cy - y) * exoSmooth(q2);
            r *= 1 - q2 * 0.7;
            alpha = 1 - q2 * 0.9;
          } else if (q2 > 0.4) {
            // pop into pixels
            const pq = (q2 - 0.4) / 0.6;
            alpha = 0;
            c.save();
            c.globalAlpha = (1 - pq) * 0.9;
            c.fillStyle = "#e8e2cf";
            for (let d = 0; d < 3; d++) {
              const ang = (d / 3) * EXO_TAU + i;
              c.fillRect(x + Math.cos(ang) * pq * 8, y + Math.sin(ang) * pq * 8 - pq * 3, 1.5, 1.5);
            }
            c.restore();
          }
        }
        if (alpha > 0) {
          c.save();
          c.globalAlpha = alpha * 0.3;
          c.fillStyle = "#000";
          c.beginPath();
          c.ellipse(x, feetY + 1, r * 0.9, 2, 0, 0, EXO_TAU);
          c.fill();
          c.restore();
          this._item(c, env, kind, x, y, r, q * (4 + i), alpha);
        }
      }
    },
  },

  /* the mon folds itself along crisp seams into a flat-packed parcel, tips over,
   * and posts itself under its own shadow */
  flatpack: {
    label: "Flat-Pack Faint",
    kind: "moment",
    _p(env) {
      const P = 8;
      return ((env.t % P) + P) % P;
    },
    _avg(env) {
      return exoCached(`avgcol:${env.sig}`, () => {
        const A = env.baseAlpha();
        const ld = env.lookData().data;
        let n = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < A.length; i += 3) {
          if (!A[i]) continue;
          n++;
          r += ld[i * 4];
          g += ld[i * 4 + 1];
          b += ld[i * 4 + 2];
        }
        return n ? `rgb(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0})` : "rgb(120,120,140)";
      });
    },
    hidesBase(env) {
      return this._p(env) < 3.2;
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 3.2) return;
      const feetX = env.ox + env.cx;
      const feetY = env.oy + env.fy;
      const col = this._avg(env);
      const bb = exoBBox(env);
      const midY = env.oy + bb.cy;
      const midX = env.ox + bb.cx;
      c.save();
      c.imageSmoothingEnabled = false;
      if (p < 0.65) {
        // fold the TOP half down over the bottom - the mon visibly halves
        const q = exoSmooth(p / 0.65);
        const k = Math.cos(q * Math.PI);
        c.drawImage(env.look, 0, bb.cy, env.PW, env.PH - bb.cy, env.ox, midY, env.PW, env.PH - bb.cy);
        c.save();
        c.translate(0, midY);
        c.scale(1, Math.max(0.05, Math.abs(k)) * (k < 0 ? -1 : 1));
        c.translate(0, -midY);
        if (k < 0) c.filter = "brightness(0.62)";
        c.drawImage(env.look, 0, 0, env.PW, bb.cy, env.ox, env.oy, env.PW, bb.cy);
        c.restore();
        // crease line
        c.strokeStyle = "rgba(230,235,250,0.4)";
        c.lineWidth = 0.75;
        c.beginPath();
        c.moveTo(env.ox + bb.x0, midY);
        c.lineTo(env.ox + bb.x1, midY);
        c.stroke();
      } else if (p < 1.25) {
        // then the LEFT half folds right over the remaining bottom strip
        const q = exoSmooth((p - 0.65) / 0.6);
        const k = Math.cos(q * Math.PI);
        c.save();
        c.beginPath();
        c.rect(midX, midY, env.PW, env.PH - bb.cy);
        c.clip();
        c.drawImage(env.look, 0, bb.cy, env.PW, env.PH - bb.cy, env.ox, midY, env.PW, env.PH - bb.cy);
        c.restore();
        c.save();
        c.translate(midX, 0);
        c.scale(Math.max(0.05, Math.abs(k)) * (k < 0 ? -1 : 1), 1);
        c.translate(-midX, 0);
        if (k < 0) c.filter = "brightness(0.55)";
        c.beginPath();
        c.rect(env.ox, midY, midX - env.ox, env.PH - bb.cy);
        c.clip();
        c.drawImage(env.look, 0, bb.cy, env.PW, env.PH - bb.cy, env.ox, midY, env.PW, env.PH - bb.cy);
        c.restore();
      } else {
        // the parcel: tips backward, then slides under its own shadow
        const bw = bb.w * 0.42;
        const bh = bb.h * 0.36;
        let rot = 0;
        let scale = 1;
        let slide = 0;
        let alpha = 1;
        if (p < 1.9) rot = exoSmooth((p - 1.2) / 0.7) * 1.35;
        else {
          rot = 1.35;
          const q = exoClamp((p - 1.9) / 0.9, 0, 1);
          scale = 1 - q * 0.75;
          slide = q * 10;
          alpha = 1 - exoSmooth(Math.max(0, q - 0.55) / 0.45);
        }
        c.save();
        c.globalAlpha = 0.4;
        c.fillStyle = "#000";
        c.beginPath();
        c.ellipse(feetX, feetY + 2, bw * 0.9, 3.5, 0, 0, EXO_TAU);
        c.fill();
        c.restore();
        if (alpha > 0) {
          c.save();
          c.globalAlpha = alpha;
          c.translate(feetX, feetY + slide * 0.3);
          c.rotate(-rot);
          c.scale(scale, scale);
          c.fillStyle = col;
          c.fillRect(-bw / 2, -bh, bw, bh);
          c.strokeStyle = "rgba(20,22,32,0.8)";
          c.lineWidth = 1;
          c.strokeRect(-bw / 2, -bh, bw, bh);
          c.beginPath();
          c.moveTo(-bw / 2, -bh / 2);
          c.lineTo(bw / 2, -bh / 2);
          c.moveTo(0, -bh);
          c.lineTo(0, 0);
          c.strokeStyle = "rgba(20,22,32,0.45)";
          c.stroke();
          c.restore();
        }
        // respawn shimmer at the very end
        if (p > 2.95) {
          c.globalAlpha = exoSmooth((p - 2.95) / 0.25);
          c.drawImage(env.look, env.ox, env.oy);
        }
      }
      c.restore();
    },
  },

  /* the victory lap prints itself: each lunge stamps an ink impression, the last
   * one turns metallic, and the mon steps out of its own poster */
  printingpress: {
    label: "Printing Press",
    kind: "moment",
    _p(env) {
      const P = 8;
      return ((env.t % P) + P) % P;
    },
    hidesBase(env) {
      return this._p(env) < 3;
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 3) return;
      const stampX = [-0.26, -0.08, 0.1];
      const stampT = [0.35, 0.85, 1.35];
      const hues = [210, 330, 90];
      c.save();
      c.imageSmoothingEnabled = false;
      for (let i = 0; i < 3; i++) {
        if (p < stampT[i]) continue;
        const isFinal = i === 2;
        const age = p - stampT[i];
        let fade = exoClamp(1 - Math.max(0, p - 2.2) / 0.8, 0, 1);
        c.save();
        c.globalAlpha = 0.5 * fade;
        if (isFinal && p > 1.5) {
          const sweep = ((p * 0.9) % 1 + 1) % 1;
          c.filter = `grayscale(1) contrast(1.3) brightness(${1.15 + 0.5 * Math.sin(sweep * Math.PI)})`;
        } else {
          c.filter = `grayscale(1) sepia(1) hue-rotate(${hues[i]}deg) saturate(2.4) contrast(1.2)`;
        }
        c.drawImage(env.look, env.ox + stampX[i] * env.PW, env.oy);
        c.restore();
        void age;
      }
      // the live mon lunging forward
      let mx = 0;
      let squash = 1;
      if (p < 1.6) {
        const seg = p < 0.35 ? p / 0.35 : p < 0.85 ? (p - 0.35) / 0.5 : (p - 0.85) / 0.75;
        const segI = p < 0.35 ? 0 : p < 0.85 ? 1 : 2;
        const from = segI === 0 ? -0.26 : stampX[segI - 1] + 0.0;
        const to = stampX[segI] + 0.18;
        mx = (from + (to - from) * exoSmooth(exoClamp(seg, 0, 1))) * env.PW;
        squash = 1 - 0.1 * Math.sin(exoClamp(seg, 0, 1) * Math.PI);
      } else if (p < 2.3) {
        mx = 0.28 * env.PW;
      } else {
        mx = 0.28 * env.PW * (1 - exoSmooth((p - 2.3) / 0.7));
      }
      exoStamp(c, env, env.look, {
        x: env.ox + env.cx + mx,
        y: env.oy + env.fy,
        sx: 2 - squash,
        sy: squash,
        anchorFeet: true,
      });
      c.restore();
    },
  },

  /* the name's letters trace a constellation around the winner, then collapse
   * into a signature sweep beneath its feet */
  autograph: {
    label: "Autograph",
    kind: "moment",
    _p(env) {
      const P = 8;
      return ((env.t % P) + P) % P;
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 3) return;
      const name = (env.name || "PKMN").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "PKMN";
      const pts = exoContour(env);
      const cx = env.ox + env.cx;
      const feetY = env.oy + env.fy;
      const spots = [];
      for (let i = 0; i < name.length; i++) {
        const pt = pts[Math.floor(((i * 2.6) / name.length) % 1 * pts.length + i * 13) % pts.length];
        let nx = pt[0] - env.cx;
        let ny = pt[1] - env.cy;
        const l = Math.hypot(nx, ny) || 1;
        spots.push([env.ox + pt[0] + (nx / l) * 8, env.oy + pt[1] + (ny / l) * 8]);
      }
      c.save();
      c.font = `${env.compact ? 6 : 8}px monospace`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      const fly = exoClamp(p / 0.6, 0, 1);
      const collapse = exoClamp((p - 1.7) / 0.6, 0, 1);
      const fade = exoClamp(1 - (p - 2.5) / 0.5, 0, 1);
      // constellation lines
      if (p > 0.6 && collapse < 1) {
        const reveal = exoClamp((p - 0.6) / 1, 0, 1);
        c.save();
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 0.45 * (1 - collapse) * fade;
        c.strokeStyle = "#bcd8ff";
        c.lineWidth = 0.75;
        c.beginPath();
        const nSeg = Math.floor(reveal * (spots.length - 1));
        for (let i = 0; i <= nSeg; i++) {
          i === 0 ? c.moveTo(spots[0][0], spots[0][1]) : c.lineTo(spots[i][0], spots[i][1]);
        }
        c.stroke();
        c.restore();
      }
      for (let i = 0; i < name.length; i++) {
        const fq = exoClamp(fly * name.length - i, 0, 1);
        const sx0 = cx + (spots[i][0] - cx) * exoSmooth(fq);
        const sy0 = env.oy + env.cy + (spots[i][1] - env.oy - env.cy) * exoSmooth(fq);
        const bx = cx + (i - (name.length - 1) / 2) * 5.5;
        const by = feetY + 8;
        const gx = sx0 + (bx - sx0) * exoSmooth(collapse);
        const gy = sy0 + (by - sy0) * exoSmooth(collapse);
        const tw = 0.6 + 0.4 * Math.sin(env.t * 6 + i * 1.9);
        c.globalAlpha = (collapse > 0 ? 0.95 : tw) * fade;
        c.strokeStyle = "rgba(6,8,16,0.85)";
        c.lineWidth = 2;
        c.strokeText(name[i], gx, gy);
        c.fillStyle = collapse > 0.5 ? "#ffe9a8" : "#dcecff";
        c.fillText(name[i], gx, gy);
      }
      // signature underline sweep
      if (collapse > 0.6) {
        const uq = exoClamp((collapse - 0.6) / 0.4, 0, 1);
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 0.8 * fade;
        c.strokeStyle = "#ffe9a8";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(cx - name.length * 3, feetY + 13);
        c.quadraticCurveTo(cx, feetY + 15.5, cx - name.length * 3 + uq * name.length * 6.4, feetY + 13.5);
        c.stroke();
      }
      c.restore();
    },
  },

  /* ================= T3 PREVIEWS (site-only fakes) ============================== */

  /* ================= CELESTIAL MONUMENTS (catalog batch A) ====================== */

  /* the mon eclipses a colossal black sun: body goes eclipse-dark, silhouette rim
   * burns molten, a writhing corona flares behind the disc */
  blacksun: {
    label: "Black Sun Coronation",
    kind: "rig",
    draw(c, env) {
      const bb = exoBBox(env);
      const R = Math.max(bb.w, bb.h) * (env.compact ? 0.62 : 0.72);
      const x = env.ox + bb.cx;
      const y = env.oy + bb.cy - bb.h * 0.05;
      // writhing corona spikes behind the disc
      c.save();
      c.globalCompositeOperation = "lighter";
      const nSp = env.compact ? 16 : 26;
      for (let k = 0; k < nSp; k++) {
        const a = (k / nSp) * EXO_TAU + Math.sin(env.t * 0.7 + k * 1.7) * 0.07;
        const len = R * (0.16 + 0.2 * (0.5 + 0.5 * Math.sin(env.t * 2.1 + k * 2.3 + exoRand(env.seed, k) * 6)));
        c.globalAlpha = 0.4 + 0.2 * Math.sin(env.t * 3 + k);
        c.fillStyle = k % 3 ? "#ffb347" : "#ff5c2e";
        c.beginPath();
        c.moveTo(x + Math.cos(a - 0.06) * R, y + Math.sin(a - 0.06) * R);
        c.lineTo(x + Math.cos(a + 0.06) * R, y + Math.sin(a + 0.06) * R);
        c.lineTo(x + Math.cos(a) * (R + len), y + Math.sin(a) * (R + len));
        c.closePath();
        c.fill();
      }
      // the blazing rim ring
      c.globalAlpha = 0.9;
      c.strokeStyle = "#ffd9a0";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, R, 0, EXO_TAU);
      c.stroke();
      c.restore();
      // the black sun disc
      const g = c.createRadialGradient(x, y, R * 0.2, x, y, R);
      g.addColorStop(0, "#05060a");
      g.addColorStop(0.82, "#0a0c14");
      g.addColorStop(1, "#241406");
      c.save();
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, R, 0, EXO_TAU);
      c.fill();
      c.restore();
      // eclipse-dark body with a molten silhouette rim
      exoStamp(c, env, env.look, { filter: "brightness(0.24) saturate(0.6)" });
      const pts = exoEdge(env);
      c.save();
      c.globalCompositeOperation = "lighter";
      for (const p of pts) {
        const tw = 0.5 + 0.5 * Math.sin(env.t * 3 + p[0] * 0.4 + p[1] * 0.23);
        if (tw < 0.25) continue;
        c.globalAlpha = 0.2 + 0.6 * tw;
        c.fillStyle = tw > 0.72 ? "#ffe9c0" : "#ff9a3d";
        c.fillRect(env.ox + p[0] + p[2], env.oy + p[1] + p[3], 1, 1);
      }
      c.restore();
    },
  },

  /* biblically-accurate engine: counter-rotating rings of small winged selves, the
   * rings studded with blinking eyes, a burning halo floating over the head */
  seraphengine: {
    label: "Seraph Engine",
    kind: "exotic",
    behind(c, env) {
      const bb = exoBBox(env);
      const x = env.ox + bb.cx;
      const y = env.oy + bb.cy;
      const R0 = Math.max(bb.w, bb.h) * 0.62;
      for (let ring = 1; ring >= 0; ring--) {
        const R = R0 * (1 + ring * 0.42);
        const n = (env.compact ? 5 : 8) + ring * 4;
        const dir = ring % 2 ? -1 : 1;
        const base = env.t * 0.18 * dir + ring * 0.4;
        for (let k = 0; k < n; k++) {
          const a = base + (k / n) * EXO_TAU;
          exoStamp(c, env, env.ring(2 + ring * 6), {
            x: x + Math.cos(a) * R,
            y: y + Math.sin(a) * R * 0.86,
            s: 0.2 - ring * 0.05,
            rot: a + Math.PI / 2,
            alpha: 0.42 - ring * 0.14,
            filter: `sepia(1) hue-rotate(${8 + ring * 22}deg) saturate(2.2) brightness(1.3)`,
          });
        }
        c.save();
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 0.3;
        c.strokeStyle = "#ffe9b0";
        c.lineWidth = 1;
        c.beginPath();
        c.ellipse(x, y, R, R * 0.86, 0, 0, EXO_TAU);
        c.stroke();
        // blinking eyes riding the ring
        const ne = 10 + ring * 6;
        for (let e = 0; e < ne; e++) {
          const a = -base * 1.4 + (e / ne) * EXO_TAU;
          const blink = 0.5 + 0.5 * Math.sin(env.t * 1.3 + e * 2.7 + ring * 5);
          if (blink < 0.35) continue;
          const ex = x + Math.cos(a) * R;
          const ey = y + Math.sin(a) * R * 0.86;
          c.globalAlpha = 0.7 * blink;
          c.fillStyle = "#fff6dd";
          c.beginPath();
          c.ellipse(ex, ey, 2.3, 1.2 * blink, a, 0, EXO_TAU);
          c.fill();
          c.fillStyle = "#3a66ff";
          c.beginPath();
          c.arc(ex, ey, 0.8, 0, EXO_TAU);
          c.fill();
        }
        c.restore();
      }
    },
    front(c, env) {
      const bb = exoBBox(env);
      const x = env.ox + bb.cx;
      const y = env.oy + bb.y0 - 6 + Math.sin(env.t * 1.1) * 1.2;
      c.save();
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.7 + 0.2 * Math.sin(env.t * 2.3);
      c.strokeStyle = "#ffe08a";
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(x, y, bb.w * 0.3, bb.w * 0.1, 0, 0, EXO_TAU);
      c.stroke();
      c.globalAlpha *= 0.35;
      c.lineWidth = 5;
      c.strokeStyle = "#ffca3a";
      c.beginPath();
      c.ellipse(x, y, bb.w * 0.3, bb.w * 0.1, 0, 0, EXO_TAU);
      c.stroke();
      c.restore();
    },
  },

  /* rings of light keep condensing onto the body and bursting into sparks at the
   * moment of contact - an endless coronation */
  halocollapse: {
    label: "Halo Collapse",
    kind: "exotic",
    _pass(c, env, wantFront) {
      const bb = exoBBox(env);
      const x = env.ox + bb.cx;
      const y = env.oy + bb.cy;
      const Rmax = Math.max(bb.w, bb.h) * 1.1;
      const Rmin = Math.max(bb.w, bb.h) * 0.34;
      for (let k = 0; k < 2; k++) {
        const q = ((env.t * 0.42 + k * 0.5) % 1 + 1) % 1;
        if (q < 0.78) {
          const R = Rmax - (Rmax - Rmin) * exoSmooth(q / 0.78);
          c.save();
          c.globalCompositeOperation = "lighter";
          c.strokeStyle = k ? "#8ad2ff" : "#ffd27a";
          c.lineWidth = 1.5 + (1 - q);
          c.globalAlpha = 0.3 + 0.55 * q;
          c.beginPath();
          if (wantFront) c.ellipse(x, y, R, R * 0.32, 0, 0, Math.PI);
          else c.ellipse(x, y, R, R * 0.32, 0, Math.PI, EXO_TAU);
          c.stroke();
          c.restore();
        } else if (wantFront) {
          // contact burst
          const p = (q - 0.78) / 0.22;
          c.save();
          c.globalCompositeOperation = "lighter";
          for (let i = 0; i < 14; i++) {
            const a = exoRand(env.seed, k * 40 + i) * EXO_TAU;
            const d = Rmin + p * 14 * (0.5 + exoRand(env.seed, k * 40 + i + 20));
            c.globalAlpha = (1 - p) * 0.9;
            c.fillStyle = i % 3 ? (k ? "#bfe6ff" : "#ffe9b8") : "#fff";
            c.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5, 1.5, 1.5);
          }
          c.restore();
          // flash washing over the body
          exoStamp(c, env, exoMaskCv(env), { alpha: (1 - p) * 0.3, comp: "lighter" });
        }
      }
    },
    behind(c, env) {
      this._pass(c, env, false);
    },
    front(c, env) {
      this._pass(c, env, true);
    },
  },

  /* ================= IMPOSSIBLE BODIES (catalog batch B) ======================== */

  /* the body is dissected into its three tonal panes, sliding apart along a
   * diagonal while godray shafts pour through the gaps */
  godray: {
    label: "Godray Dissection",
    kind: "rig",
    draw(c, env) {
      const lc = exoLumaClusters(env);
      const bb = exoBBox(env);
      const ang = -0.7;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const sep = (env.compact ? 3 : 5) * (0.5 + 0.5 * Math.sin(env.t * 0.7));
      // the three panes, separated along the dissection axis
      for (let k = 0; k < 3; k++) {
        const off = (k - 1) * sep;
        exoMasked(c, env, env.look, lc.masks[k], {
          x: env.ox + env.cx + dx * off,
          y: env.oy + env.cy + dy * off,
          filter: k === 2 ? "brightness(1.12)" : k === 0 ? "brightness(0.9)" : "none",
        });
      }
      // godray shafts through the seams (short, fading at both ends)
      c.save();
      c.globalCompositeOperation = "lighter";
      c.translate(env.ox + bb.cx, env.oy + bb.cy);
      c.rotate(ang + Math.PI / 2);
      const shaft = bb.h * 0.85;
      for (let i = 0; i < 3; i++) {
        const w = 1.5 + i;
        const gx = (i - 1) * sep * 2.2;
        const g = c.createLinearGradient(0, -shaft, 0, shaft);
        g.addColorStop(0, "rgba(255,244,200,0)");
        g.addColorStop(0.35, "rgba(255,244,200,0.4)");
        g.addColorStop(0.65, "rgba(255,244,200,0.4)");
        g.addColorStop(1, "rgba(255,244,200,0)");
        c.globalAlpha = 0.3 + 0.2 * Math.sin(env.t * 1.3 + i * 2);
        c.fillStyle = g;
        c.fillRect(gx - w / 2, -shaft, w, shaft * 2);
      }
      c.restore();
    },
  },

  /* the body shatters into mosaic tiles that ascend in a wave and settle back,
   * over and over - a cyclic rapture */
  mosaicascension: {
    label: "Mosaic Ascension",
    kind: "rig",
    draw(c, env) {
      const bb = exoBBox(env);
      const T = env.compact ? 6 : 5;
      const cyc = ((env.t * 0.22) % 1 + 1) % 1;
      const w = cyc < 0.5 ? cyc * 2 : (1 - cyc) * 2; // ascend then settle
      c.save();
      c.imageSmoothingEnabled = false;
      for (let ty = bb.y0; ty <= bb.y1; ty += T) {
        for (let tx = bb.x0; tx <= bb.x1; tx += T) {
          const h = exoRand(env.seed, tx * 7 + ty * 13);
          const rowU = (ty - bb.y0) / Math.max(1, bb.h); // 0 at crown
          const lift = exoSmooth(exoClamp(w * 1.7 - rowU * 0.8 - h * 0.35, 0, 1));
          const rise = lift * (10 + h * 26);
          const drift = (h - 0.5) * lift * 10;
          c.globalAlpha = 1 - lift * 0.7;
          c.drawImage(env.look, tx, ty, T, T, env.ox + tx + drift, env.oy + ty - rise, T, T);
        }
      }
      c.restore();
    },
  },

  /* the mon as a three-aspect deity: gold and shadow selves fan out behind it
   * inside a burning mandorla, flame beads arcing over the trinity */
  triuneidol: {
    label: "Triune Idol",
    kind: "exotic",
    behind(c, env) {
      const bb = exoBBox(env);
      const x = env.ox + bb.cx;
      const y = env.oy + bb.cy;
      // mandorla
      const g = c.createRadialGradient(x, y, 0, x, y, bb.h * 0.9);
      g.addColorStop(0, "rgba(255,224,150,0.28)");
      g.addColorStop(0.7, "rgba(190,120,60,0.12)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.save();
      c.globalCompositeOperation = "lighter";
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, y, bb.w * 0.95, bb.h * 0.95, 0, 0, EXO_TAU);
      c.fill();
      c.restore();
      // the gold and shadow aspects
      const sway = Math.sin(env.t * 0.6) * 0.045;
      for (const side of [-1, 1]) {
        exoStamp(c, env, env.ring(5), {
          x: x + side * bb.w * 0.34,
          y: y + 1,
          rot: side * (0.32 + sway),
          s: 0.94,
          alpha: 0.55,
          filter: side < 0 ? "sepia(1) saturate(2.4) brightness(1.15)" : "brightness(0.45) saturate(1.3) hue-rotate(250deg)",
        });
      }
      // flame beads arcing over the trinity
      c.save();
      c.globalCompositeOperation = "lighter";
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        const fx = x + Math.cos(a) * bb.w * 0.72;
        const fy2 = y - bb.h * 0.2 + Math.sin(a) * bb.h * 0.62;
        const tw = 0.5 + 0.5 * Math.sin(env.t * 2.2 + i * 1.9);
        c.globalAlpha = 0.3 + 0.5 * tw;
        c.fillStyle = "#ffd27a";
        c.beginPath();
        c.arc(fx, fy2, 1 + tw, 0, EXO_TAU);
        c.fill();
      }
      c.restore();
    },
  },

  /* ================= IDENTITY AS MYTHOLOGY (catalog batch C) ==================== */

  /* two-faced god: the left half is the self, the right half is its next (or
   * previous) form, joined at a burning seam */
  janusmantle: {
    label: "Janus Mantle",
    kind: "rig",
    draw(c, env) {
      const bb = exoBBox(env);
      const other =
        env.evo?.next?.length ? env.aux(env.evo.next[0]) : env.evo?.prev ? env.aux(env.evo.prev) : null;
      const seamX = env.ox + bb.cx + Math.sin(env.t * 0.6) * 1.2;
      // left half: the true self
      c.save();
      c.beginPath();
      c.rect(env.ox - 20, env.oy - 20, seamX - (env.ox - 20), env.PH + 40);
      c.clip();
      exoStamp(c, env, env.look, {});
      c.restore();
      // right half: the other face (mirrored so both look outward)
      c.save();
      c.beginPath();
      c.rect(seamX, env.oy - 20, env.ox + env.PW + 40 - seamX, env.PH + 40);
      c.clip();
      if (other) {
        exoStampImg(c, env, other, {
          x: env.ox + bb.cx,
          y: env.oy + env.fy,
          h: bb.h,
          flip: true,
          alpha: 0.95,
          filter: "saturate(1.1)",
          anchorFeet: true,
        });
      } else {
        exoStamp(c, env, env.look, { sx: -1, filter: "invert(1) hue-rotate(180deg)" });
      }
      c.restore();
      // the burning seam
      c.save();
      c.globalCompositeOperation = "lighter";
      for (let y = bb.y0; y <= bb.y1; y += 2) {
        const tw = 0.5 + 0.5 * Math.sin(env.t * 3 + y * 0.4);
        c.globalAlpha = 0.25 + 0.55 * tw;
        c.fillStyle = tw > 0.7 ? "#fff5d9" : "#ffb45a";
        c.fillRect(seamX - 0.6, env.oy + y, 1.2, 2);
      }
      c.restore();
    },
  },

  /* the mon's name burns in orbit around it, each letter a floating sigil glyph
   * flaring as it crosses the front */
  namesigil: {
    label: "Name Sigil",
    kind: "exotic",
    _pass(c, env, wantFront) {
      const name = (env.name || "PKMN").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "PKMN";
      const bb = exoBBox(env);
      const x = env.ox + bb.cx;
      const y = env.oy + bb.cy;
      const R = Math.max(bb.w, bb.h) * 0.68;
      c.save();
      c.textAlign = "center";
      c.textBaseline = "middle";
      for (let k = 0; k < name.length; k++) {
        const a = env.t * 0.4 + (k / name.length) * EXO_TAU;
        const depth = Math.sin(a);
        if (depth >= 0 !== wantFront) continue;
        const px = x + Math.cos(a) * R;
        const py = y + depth * R * 0.3;
        const sz = 8 + 3 * depth;
        const flare = depth > 0.7 ? (depth - 0.7) / 0.3 : 0;
        c.save();
        c.translate(px, py);
        c.rotate(Math.cos(a) * 0.2);
        c.font = `700 ${sz}px monospace`;
        if (flare > 0) {
          c.globalCompositeOperation = "lighter";
          c.globalAlpha = flare * 0.5;
          c.fillStyle = "#ffefc4";
          c.fillText(name[k], 0, 0);
        }
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 0.55 + 0.45 * depth;
        c.fillStyle = flare > 0 ? "#fff3d0" : "#ffb45a";
        c.fillText(name[k], 0, 0);
        c.restore();
      }
      c.restore();
    },
    behind(c, env) {
      this._pass(c, env, false);
    },
    front(c, env) {
      this._pass(c, env, true);
    },
  },

  /* ================= IMPOSSIBLE MATERIALS (catalog batch D) ===================== */

  /* the mon brushed in sumi ink: black-water trails ribbon off the stroke, wisps
   * curl from the back, a red hanko seal signs the piece */
  inkdragon: {
    label: "Ink Dragon Calligraphy",
    kind: "rig",
    draw(c, env) {
      const bb = exoBBox(env);
      // ink trails (older frames smeared into the wash)
      for (let k = 3; k >= 1; k--) {
        exoStamp(c, env, env.ring(k * 5), {
          x: env.ox + env.cx - k * 4,
          y: env.oy + env.cy + Math.sin(env.t * 1.1 + k) * 2,
          sx: 1 + k * 0.04,
          sy: 1 - k * 0.03,
          alpha: 0.18 - k * 0.035,
          filter: "brightness(0) blur(1px)",
        });
      }
      // the brushed body
      exoStamp(c, env, env.look, { filter: "grayscale(1) contrast(1.5) brightness(0.9)" });
      // ink wisps curling off the back
      c.save();
      for (let i = 0; i < 6; i++) {
        const q = ((env.t * (0.16 + exoRand(env.seed, i) * 0.12) + exoRand(env.seed, i + 33)) % 1 + 1) % 1;
        const px = env.ox + bb.x0 + exoRand(env.seed, i + 66) * bb.w;
        const py = env.oy + bb.y0 + 2 - q * 14;
        c.globalAlpha = Math.sin(q * Math.PI) * 0.4;
        c.fillStyle = "#1a1d24";
        c.beginPath();
        c.arc(px + Math.sin(q * 9 + i) * 3, py, 1.6 * (1 - q * 0.5), 0, EXO_TAU);
        c.fill();
      }
      // the red hanko seal
      const sx2 = env.ox + Math.min(env.PW - 9, bb.x1 + 4);
      const sy2 = env.oy + env.fy - 8;
      c.globalAlpha = 0.85;
      c.fillStyle = "#c23b2e";
      c.fillRect(sx2, sy2, 7, 7);
      c.fillStyle = "#f5e9d9";
      c.fillRect(sx2 + 1.5, sy2 + 1.6, 4, 1.1);
      c.fillRect(sx2 + 1.5, sy2 + 4.3, 4, 1.1);
      c.restore();
    },
  },

  /* a blacked-out body lit only by its own glowing anatomy: the tonal boundary
   * lines burn neon, hue slowly cycling, a pulse racing around the outline */
  neonanatomy: {
    label: "Neon Anatomy",
    kind: "rig",
    draw(c, env) {
      const lc = exoLumaClusters(env);
      const hue = (env.t * 40) % 360;
      // dark shell
      exoStamp(c, env, env.look, { filter: "brightness(0.42) saturate(0.55)" });
      // neon veins = the cluster boundary lines, glowing
      exoStamp(c, env, lc.bound, {
        comp: "lighter",
        filter: `invert(1) sepia(1) saturate(9) hue-rotate(${hue}deg) blur(1px)`,
        alpha: 0.32,
      });
      exoStamp(c, env, lc.bound, {
        comp: "lighter",
        filter: `invert(1) sepia(1) saturate(9) hue-rotate(${hue}deg) brightness(1.2)`,
        alpha: 0.4 + 0.15 * Math.sin(env.t * 2.2),
      });
      // pulse racing along the outline
      const pts = exoContour(env);
      const u = ((env.t * 0.35) % 1 + 1) % 1;
      const i0 = Math.floor(u * pts.length);
      c.save();
      c.globalCompositeOperation = "lighter";
      for (let d = 0; d < 8; d++) {
        const p = pts[(i0 + d) % pts.length];
        c.globalAlpha = (1 - d / 8) * 0.9;
        c.fillStyle = `hsl(${hue}, 100%, 75%)`;
        c.fillRect(env.ox + p[0] - 1, env.oy + p[1] - 1, 2, 2);
      }
      c.restore();
    },
  },

  /* ================= MOMENT SPECTACLES (catalog batch E) ======================== */

  /* ================= SCENE-SPLIT RIFT (catalog batch F) ========================= */

  /* the whole stage is torn along a crackling rift: a cold world on one side, a
   * hot one on the other, and the mon graded half-and-half where it straddles */
  scenesplit: {
    label: "Scene-Split Rift",
    kind: "rig",
    draw(c, env) {
      const bb = exoBBox(env);
      const x = env.ox + bb.cx;
      const wob = Math.sin(env.t * 0.7) * 3;
      const seg = 9;
      const xs = [];
      for (let i = 0; i <= seg; i++) {
        xs.push(x + wob + (exoRand(env.seed, i * 3) - 0.5) * 10 + Math.sin(env.t * 1.3 + i * 1.7) * 1.5);
      }
      const leftPath = () => {
        c.beginPath();
        c.moveTo(0, 0);
        for (let i = 0; i <= seg; i++) c.lineTo(xs[i], (env.EH * i) / seg);
        c.lineTo(0, env.EH);
        c.closePath();
      };
      const rightPath = () => {
        c.beginPath();
        c.moveTo(env.EW, 0);
        for (let i = 0; i <= seg; i++) c.lineTo(xs[i], (env.EH * i) / seg);
        c.lineTo(env.EW, env.EH);
        c.closePath();
      };
      // the two worlds: a soft glow bleeding out from the rift, not a solid panel
      c.save();
      c.globalCompositeOperation = "lighter";
      leftPath();
      c.save();
      c.clip();
      const gl = c.createLinearGradient(x - env.EW * 0.2, 0, x, 0);
      gl.addColorStop(0, "rgba(58,102,255,0)");
      gl.addColorStop(1, "rgba(58,102,255,0.17)");
      c.fillStyle = gl;
      c.fillRect(0, 0, env.EW, env.EH);
      c.restore();
      rightPath();
      c.save();
      c.clip();
      const gr = c.createLinearGradient(x + env.EW * 0.2, 0, x, 0);
      gr.addColorStop(0, "rgba(255,122,58,0)");
      gr.addColorStop(1, "rgba(255,122,58,0.15)");
      c.fillStyle = gr;
      c.fillRect(0, 0, env.EW, env.EH);
      c.restore();
      c.restore();
      // the mon, graded per world half
      c.save();
      leftPath();
      c.clip();
      exoStamp(c, env, env.look, { filter: "saturate(0.8) hue-rotate(40deg) brightness(0.94)" });
      c.restore();
      c.save();
      rightPath();
      c.clip();
      exoStamp(c, env, env.look, { filter: "saturate(1.25) hue-rotate(-25deg) brightness(1.06)" });
      c.restore();
      // the crackling rift
      c.save();
      c.globalCompositeOperation = "lighter";
      c.strokeStyle = "#eaf2ff";
      c.lineWidth = 1.4;
      c.globalAlpha = 0.6 + 0.3 * Math.sin(env.t * 6);
      c.beginPath();
      for (let i = 0; i <= seg; i++) {
        i ? c.lineTo(xs[i], (env.EH * i) / seg) : c.moveTo(xs[i], (env.EH * i) / seg);
      }
      c.stroke();
      for (let i = 0; i < 6; i++) {
        const q = ((env.t * (0.6 + exoRand(env.seed, i) * 0.6) + exoRand(env.seed, i + 44)) % 1 + 1) % 1;
        const yy = exoRand(env.seed, i + 88) * env.EH;
        const idx = Math.min(seg, Math.floor((yy / env.EH) * seg));
        c.globalAlpha = (1 - q) * 0.9;
        c.fillStyle = i % 2 ? "#8ab8ff" : "#ffb47a";
        c.fillRect(xs[idx] + (exoRand(env.seed, i + 120) - 0.5) * 2 + q * 8 * (i % 2 ? -1 : 1), yy, 1.3, 1.3);
      }
      c.restore();
    },
  },
};

const ALL_EXOTIC = Object.keys(EXOTIC).filter(k => EXOTIC[k].kind === "exotic");
const ALL_RIG = Object.keys(EXOTIC).filter(k => EXOTIC[k].kind === "rig");
const ALL_MOMENT = Object.keys(EXOTIC).filter(k => EXOTIC[k].kind === "moment");
export { EXOTIC, ALL_EXOTIC, ALL_RIG, ALL_MOMENT };
