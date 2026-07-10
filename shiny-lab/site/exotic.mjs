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
    for (let cl = 0; cl < 3; cl++) {
      const m = document.createElement("canvas");
      m.width = W;
      m.height = H;
      const mc = m.getContext("2d");
      const id = mc.createImageData(W, H);
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < W * H; i++) {
        if (idx[i] !== cl) continue;
        id.data[i * 4] = ld[i * 4];
        id.data[i * 4 + 1] = ld[i * 4 + 1];
        id.data[i * 4 + 2] = ld[i * 4 + 2];
        id.data[i * 4 + 3] = ld[i * 4 + 3];
        n++;
        sx += i % W;
        sy += Math.floor(i / W);
      }
      mc.putImageData(id, 0, 0);
      masks.push(m);
      cent.push(n ? [sx / n, sy / n] : [env.cx, env.cy]);
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
    return { idx, masks, cent, bound };
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

  carousel: {
    label: "Carousel",
    kind: "exotic",
    _pass(c, env, wantFront) {
      const R = (env.compact ? 0.3 : 0.38) * env.PW;
      for (let k = 0; k < 3; k++) {
        const a = env.t * 0.9 + (k * EXO_TAU) / 3;
        const depth = Math.sin(a);
        if (depth >= 0 !== wantFront) continue;
        exoStamp(c, env, env.ring(2), {
          x: env.ox + env.cx + Math.cos(a) * R,
          y: env.oy + env.cy + depth * 0.15 * env.PH,
          s: 0.26 + 0.09 * depth,
          alpha: 0.75 + 0.2 * depth,
          filter: `brightness(${0.75 + 0.3 * depth})`,
        });
      }
    },
    behind(c, env) {
      this._pass(c, env, false);
    },
    front(c, env) {
      this._pass(c, env, true);
    },
  },

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

  /* nesting dolls: a shrinking row of selves wobbling like roly-poly toys, hopping
   * in a little wave; they slide out from behind the mon and tuck back in each cycle */
  matryoshka: {
    label: "Matryoshka",
    kind: "exotic",
    front(c, env) {
      const n = env.compact ? 2 : 3;
      const baseX = env.ox + env.cx;
      const feetY = env.oy + env.fy;
      const P = 8;
      const p = ((env.t % P) + P) % P;
      const scales = [0.46, 0.3, 0.19];
      for (let k = 0; k < n; k++) {
        const emerge = exoSmooth(exoClamp((p - 0.3 * k) / 0.7, 0, 1));
        const retreat = exoSmooth(exoClamp((p - (P - 1.4) - 0.18 * k) / 0.7, 0, 1));
        const vis = emerge * (1 - retreat);
        if (vis <= 0.02) continue;
        const targX = baseX - (env.compact ? 0.3 + k * 0.2 : 0.34 + k * 0.2) * env.PW;
        const x = baseX + (targX - baseX) * vis;
        const rock = Math.sin(env.t * 2.1 + k * 1.9) * 0.09;
        const hp = (env.t * 0.9 + 100 - k * 0.2) % 2.8;
        const hopping = hp < 0.34;
        const hop = hopping ? Math.sin((hp / 0.34) * Math.PI) * 5 : 0;
        const sq = hopping ? 1 - 0.16 * Math.sin((hp / 0.34) * Math.PI) : 1;
        exoStamp(c, env, env.ring(2 + k * 4), {
          x,
          y: feetY - hop,
          sx: scales[k] * (2 - sq),
          sy: scales[k] * sq,
          rot: rock,
          alpha: 0.95 * vis,
          filter: `saturate(${1 + k * 0.15}) brightness(${1 + k * 0.1})`,
          anchorFeet: true,
        });
      }
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

  /* a private storm: layered cloud, wind-blown rain with ground splashes, and seeded
   * forked lightning that ILLUMINATES the mon for a beat */
  personalweather: {
    label: "Personal Weather",
    kind: "exotic",
    front(c, env) {
      const cxA = env.ox + env.cx;
      const top = env.oy + Math.max(2, env.cy - 0.52 * env.PH);
      const groundY = env.oy + env.fy;
      const cx0 = cxA + Math.sin(env.t * 0.5) * 4;
      const beat = Math.floor(env.t * 0.8);
      const strike = exoRand(env.seed, beat) > 0.7;
      const bp = env.t * 0.8 - beat;
      const flash = strike && bp < 0.16;
      const shake = flash ? (exoRand(env.seed, beat * 3 + Math.floor(env.t * 60)) - 0.5) * 2.4 : 0;
      c.save();
      c.imageSmoothingEnabled = false;
      // lightning first (under the cloud, over the mon)
      if (flash) {
        const fade = 1 - bp / 0.16;
        const hitX = cxA + (exoRand(env.seed, beat + 7) - 0.5) * 0.3 * env.PW;
        const seg = 5;
        c.lineCap = "round";
        for (const [w, col] of [
          [4, `rgba(150,180,255,${0.3 * fade})`],
          [1.6, `rgba(255,255,210,${0.95 * fade})`],
        ]) {
          c.strokeStyle = col;
          c.lineWidth = w;
          c.beginPath();
          let lx = cx0 + shake;
          let ly = top + 7;
          c.moveTo(lx, ly);
          for (let s = 1; s <= seg; s++) {
            lx = cx0 + (hitX - cx0) * (s / seg) + (exoRand(env.seed, beat * 11 + s) - 0.5) * 9;
            ly = top + 7 + ((groundY - top - 7) * s) / seg;
            c.lineTo(lx, ly);
            if (s === 2) {
              // fork
              c.moveTo(lx, ly);
              c.lineTo(lx + (exoRand(env.seed, beat + 31) - 0.5) * 22, ly + 12);
              c.moveTo(lx, ly);
            }
          }
          c.stroke();
        }
        // the mon lights up
        c.save();
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 0.4 * fade;
        c.filter = "brightness(2.2) saturate(0.4)";
        c.drawImage(env.look, env.ox, env.oy);
        c.restore();
      }
      // cloud: dark under-belly, gray body, lit top rim
      const puffs = [
        [-12, 2, 7],
        [-4, -3, 9],
        [5, -4, 8],
        [12, 1, 6],
        [2, 3, 9],
      ];
      for (const [layer, col, dy] of [
        [0, flash ? "rgba(210,215,235,0.95)" : "rgba(48,52,68,0.95)", 2.5],
        [1, flash ? "rgba(235,238,250,0.95)" : "rgba(88,94,114,0.95)", 0],
        [2, flash ? "rgba(255,255,255,0.9)" : "rgba(130,138,162,0.8)", -2.5],
      ]) {
        c.fillStyle = col;
        for (const [dx, dy0, r] of puffs) {
          c.beginPath();
          c.arc(cx0 + dx + shake, top + dy0 + dy, r - layer * 0.8, 0, EXO_TAU);
          c.fill();
        }
      }
      // rain: angled streaks with splashes at the ground line
      const wind = Math.sin(env.t * 0.7) * 1.6;
      c.strokeStyle = "rgba(150,200,255,0.75)";
      c.lineWidth = 1;
      for (let i = 0; i < 16; i++) {
        const rx = cx0 + (exoRand(env.seed, i) - 0.5) * 32;
        const fall = (env.t * (1.7 + 0.7 * exoRand(env.seed, i + 50)) + exoRand(env.seed, i + 99)) % 1;
        const ry = top + 10 + fall * (groundY - top - 10);
        if (fall > 0.94) {
          c.beginPath();
          c.arc(rx + wind, groundY - 1, 1.5 + (fall - 0.94) * 30, Math.PI, EXO_TAU);
          c.stroke();
        } else {
          c.globalAlpha = 0.5 + 0.5 * (1 - fall);
          c.beginPath();
          c.moveTo(rx + wind * fall, ry);
          c.lineTo(rx + wind * fall - 1 - wind, ry + 5);
          c.stroke();
          c.globalAlpha = 1;
        }
      }
      c.restore();
    },
  },

  /* miniature past-selves physically walk the silhouette contour - up the tail,
   * over the head, down the far side (behind), out front near the feet */
  escher: {
    label: "Escher Pilgrimage",
    kind: "exotic",
    _pass(c, env, wantFront) {
      const pts = exoContour(env);
      const N = pts.length;
      const n = env.compact ? 3 : 5;
      for (let k = 0; k < n; k++) {
        const u = (((env.t * 0.05 * (1 + 0.11 * ((k * 37) % 5)) + k / n) % 1) + 1) % 1;
        const idx = u * N;
        const i0 = Math.floor(idx) % N;
        const i1 = (i0 + 1) % N;
        const fr = idx - i0;
        const x = pts[i0][0] + (pts[i1][0] - pts[i0][0]) * fr;
        const y = pts[i0][1] + (pts[i1][1] - pts[i0][1]) * fr;
        let nx = x - env.cx;
        let ny = y - env.cy;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l;
        ny /= l;
        const front = y > env.cy; // lower half walks in front, upper half behind
        if (front !== wantFront) continue;
        const hop = Math.abs(Math.sin(u * N * 1.1)) * 1.5;
        exoStamp(c, env, env.ring(3 + k * 4), {
          x: env.ox + x + nx * (2 + hop),
          y: env.oy + y + ny * (2 + hop),
          s: env.compact ? 0.13 : 0.16,
          rot: Math.atan2(-ny, -nx) - Math.PI / 2,
          alpha: front ? 0.95 : 0.7,
          filter: front ? "none" : "brightness(0.75)",
          anchorFeet: true,
        });
      }
    },
    behind(c, env) {
      this._pass(c, env, false);
    },
    front(c, env) {
      this._pass(c, env, true);
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
          if (f < 0.13) {
            const w = 1 - f / 0.13;
            px[i * 4] = 255;
            px[i * 4 + 1] = 255;
            px[i * 4 + 2] = 255;
            px[i * 4 + 3] = 110 * w;
          } else if (Math.abs(f - 0.5) < 0.09) {
            const w = 1 - Math.abs(f - 0.5) / 0.09;
            px[i * 4] = 10;
            px[i * 4 + 1] = 18;
            px[i * 4 + 2] = 70;
            px[i * 4 + 3] = 95 * w;
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
      c.globalAlpha = 0.35;
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

  /* full fake-3D rotation: front sprite compresses to a rim, mirrored darkened
   * "back" expands, the ground shadow tracks the turn */
  turntable: {
    label: "Impossible Turntable",
    kind: "rig",
    draw(c, env) {
      const th = env.t * 0.85;
      const k = Math.cos(th);
      const sk = Math.sin(th);
      const feetY = env.oy + env.fy;
      c.save();
      c.globalAlpha = 0.38;
      c.fillStyle = "#000";
      c.beginPath();
      c.ellipse(
        env.ox + env.cx + sk * 0.05 * env.PW,
        feetY + 2,
        Math.max(5, (Math.abs(k) * 0.26 + 0.08) * env.PW),
        4.5,
        0,
        0,
        EXO_TAU,
      );
      c.fill();
      c.restore();
      const back = k < 0;
      exoStamp(c, env, env.look, {
        x: env.ox + env.cx + sk * 1.5,
        y: feetY,
        sx: Math.max(0.06, Math.abs(k)) * (back ? -1 : 1),
        filter: back ? "brightness(0.6) saturate(0.72)" : "none",
        anchorFeet: true,
      });
      if (Math.abs(k) < 0.3) {
        const w = 1 - Math.abs(k) / 0.3;
        c.save();
        c.globalCompositeOperation = "lighter";
        const g = c.createLinearGradient(env.ox + env.cx - 3, 0, env.ox + env.cx + 3, 0);
        g.addColorStop(0, "rgba(140,200,255,0)");
        g.addColorStop(0.5, `rgba(220,240,255,${0.55 * w})`);
        g.addColorStop(1, "rgba(140,200,255,0)");
        c.fillStyle = g;
        c.fillRect(env.ox + env.cx - 3, env.oy + env.cy - 0.45 * env.PH, 6, 0.85 * env.PH);
        c.restore();
      }
    },
  },

  /* dead broadcast: seeded snow fills the silhouette, a scan beam resolves the real
   * mon feet-to-head, it holds with scanlines + sync jitters, rolls, collapses back */
  tvres: {
    label: "Television Resurrection",
    kind: "rig",
    _noise(env, v) {
      return exoCached(`tv:${env.species}:${env.PW}:${v}`, () => {
        const A = env.baseAlpha();
        const cv = document.createElement("canvas");
        cv.width = env.PW;
        cv.height = env.PH;
        const cc = cv.getContext("2d");
        const id = cc.createImageData(env.PW, env.PH);
        for (let i = 0; i < A.length; i++) {
          if (!A[i]) continue;
          const g = 30 + exoRand(env.species + v * 999, i) * 210;
          id.data[i * 4] = g;
          id.data[i * 4 + 1] = g;
          id.data[i * 4 + 2] = g + 12;
          id.data[i * 4 + 3] = 255;
        }
        cc.putImageData(id, 0, 0);
        return cv;
      });
    },
    _scan(env) {
      return exoCached(`tvscan:${env.species}:${env.PW}`, () => {
        const A = env.baseAlpha();
        const cv = document.createElement("canvas");
        cv.width = env.PW;
        cv.height = env.PH;
        const cc = cv.getContext("2d");
        const id = cc.createImageData(env.PW, env.PH);
        for (let y = 0; y < env.PH; y += 3) {
          for (let x = 0; x < env.PW; x++) {
            const i = y * env.PW + x;
            if (A[i]) {
              id.data[i * 4 + 3] = 70;
            }
          }
        }
        cc.putImageData(id, 0, 0);
        return cv;
      });
    },
    draw(c, env) {
      const P = 6.5;
      const p = ((env.t % P) + P) % P;
      const nz = this._noise(env, Math.floor(env.t * 9) % 2);
      c.save();
      c.imageSmoothingEnabled = false;
      if (p < 1.6) {
        const q = exoSmooth(p / 1.6);
        const sy = Math.round(env.PH * (1 - q));
        c.globalAlpha = 0.92;
        c.drawImage(nz, env.ox, env.oy);
        c.globalAlpha = 1;
        if (env.PH - sy > 0) {
          c.drawImage(env.look, 0, sy, env.PW, env.PH - sy, env.ox, env.oy + sy, env.PW, env.PH - sy);
        }
        c.globalCompositeOperation = "lighter";
        const g = c.createLinearGradient(0, env.oy + sy - 6, 0, env.oy + sy + 6);
        g.addColorStop(0, "rgba(120,220,255,0)");
        g.addColorStop(0.5, "rgba(220,250,255,0.8)");
        g.addColorStop(1, "rgba(120,220,255,0)");
        c.fillStyle = g;
        c.fillRect(env.ox, env.oy + sy - 6, env.PW, 12);
      } else if (p < 4.6) {
        const jbeat = Math.floor(env.t * 0.55);
        const jit = exoRand(env.seed, jbeat) > 0.55 && env.t * 0.55 - jbeat < 0.12;
        if (jit) {
          const H6 = Math.ceil(env.PH / 6);
          for (let s2 = 0; s2 < 6; s2++) {
            const off = Math.round((exoRand(env.seed, jbeat * 7 + s2) - 0.5) * 8);
            c.drawImage(env.look, 0, s2 * H6, env.PW, H6, env.ox + off, env.oy + s2 * H6, env.PW, H6);
          }
        } else {
          c.drawImage(env.look, env.ox, env.oy);
        }
        c.globalAlpha = 0.55;
        c.drawImage(this._scan(env), env.ox, env.oy);
      } else if (p < 5.4) {
        const q = exoSmooth((p - 4.6) / 0.8);
        const yo = Math.round(q * env.PH) % env.PH;
        c.save();
        c.beginPath();
        c.rect(env.ox, env.oy, env.PW, env.PH);
        c.clip();
        c.drawImage(env.look, env.ox, env.oy + yo);
        c.drawImage(env.look, env.ox, env.oy + yo - env.PH);
        c.globalCompositeOperation = "lighter";
        c.fillStyle = "rgba(160,230,255,0.25)";
        c.fillRect(env.ox, env.oy + yo - 2, env.PW, 4);
        c.restore();
        c.globalAlpha = 0.3;
        c.drawImage(nz, env.ox, env.oy);
      } else {
        const q = (p - 5.4) / 1.1;
        c.globalAlpha = 1 - q;
        c.drawImage(env.look, env.ox, env.oy);
        c.globalAlpha = 0.25 + 0.67 * q;
        c.drawImage(nz, env.ox, env.oy);
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

  /* the wrong package: the PRE-EVOLUTION drops in, looks around confused, gets
   * vacuumed back up, and the real mon slams down in a dust cloud */
  wrongevo: {
    label: "Wrong Delivery",
    kind: "moment",
    _p(env) {
      const P = 6.5;
      return ((env.t % P) + P) % P;
    },
    hidesBase(env) {
      return this._p(env) < 1.95;
    },
    _guest(c, env, o) {
      const aux = env.evo && env.evo.prev ? env.aux(env.evo.prev) : null;
      if (aux) {
        exoStampImg(c, env, aux, { ...o, h: env.PH * 0.52 * (o.hMul ?? 1), anchorFeet: true });
      } else {
        // no pre-evolution: a hue-shifted mirrored mini of itself got delivered
        exoStamp(c, env, env.ring(6), {
          x: o.x,
          y: o.y,
          sx: -0.5 * (o.sxMul ?? 1),
          sy: 0.5 * (o.syMul ?? 1),
          rot: o.rot,
          alpha: o.alpha ?? 1,
          filter: `hue-rotate(60deg) ${o.filter || ""}`,
          anchorFeet: true,
        });
      }
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 2.15) return;
      const feetX = env.ox + env.cx;
      const feetY = env.oy + env.fy;
      const topY = env.oy - env.PH * 0.2;
      c.save();
      c.imageSmoothingEnabled = false;
      if (p < 0.55) {
        // drop in (with a growing landing shadow)
        const d = exoSmooth(p / 0.55);
        c.save();
        c.globalAlpha = 0.3 * d;
        c.fillStyle = "#000";
        c.beginPath();
        c.ellipse(feetX, feetY + 2, 10 * d + 3, 3, 0, 0, EXO_TAU);
        c.fill();
        c.restore();
        const land = p > 0.47;
        this._guest(c, env, {
          x: feetX,
          y: topY + (feetY - topY) * d,
          sxMul: land ? 1.18 : 1,
          syMul: land ? 0.82 : 1,
          hMul: land ? 0.94 : 1,
        });
      } else if (p < 1.15) {
        // confused idle + "?"
        const q = p - 0.55;
        this._guest(c, env, { x: feetX, y: feetY, rot: Math.sin(q * 7) * 0.12 });
        c.font = "10px monospace";
        c.textAlign = "center";
        c.globalAlpha = 0.5 + 0.5 * Math.sin(q * 12);
        c.fillStyle = "#fff";
        c.strokeStyle = "rgba(0,0,0,0.8)";
        c.lineWidth = 2;
        const qy = feetY - env.PH * 0.58 + Math.sin(q * 4) * 1.5;
        c.strokeText("?", feetX + 8, qy);
        c.fillText("?", feetX + 8, qy);
      } else if (p < 1.5) {
        // vacuumed back up
        const q = exoSmooth((p - 1.15) / 0.35);
        this._guest(c, env, {
          x: feetX,
          y: feetY - q * (feetY - topY),
          sxMul: 1 - q * 0.7,
          syMul: 1 + q * 1.5,
          hMul: 1 + q * 0.5,
          alpha: 1 - q * 0.85,
        });
        c.save();
        c.globalCompositeOperation = "lighter";
        c.strokeStyle = `rgba(180,220,255,${0.5 * (1 - q)})`;
        c.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const lx = feetX + (exoRand(env.seed, i + 9) - 0.5) * 14;
          c.beginPath();
          c.moveTo(lx, feetY - q * env.PH * 0.8);
          c.lineTo(lx, feetY - q * env.PH * 0.8 - 8);
          c.stroke();
        }
        c.restore();
      } else if (p < 1.72) {
        // the real mon slams down
        const q = exoSmooth((p - 1.5) / 0.22);
        exoStamp(c, env, env.look, { x: feetX, y: topY + (feetY - topY) * q, anchorFeet: true });
      } else {
        // squash-settle + dust
        const q = (p - 1.72) / 0.43;
        const sq = 1 - 0.16 * Math.max(0, 1 - q * 2.2) + 0.03 * Math.sin(q * 9) * (1 - q);
        exoStamp(c, env, env.look, { x: feetX, y: feetY, sx: 2 - sq, sy: sq, anchorFeet: true });
        c.globalAlpha = Math.max(0, 1 - q * 1.4) * 0.55;
        c.fillStyle = "#9aa0b4";
        for (let i = 0; i < 6; i++) {
          const ang = exoRand(env.seed, i + 33) * EXO_TAU;
          const r = (4 + q * 26) * (0.6 + 0.6 * exoRand(env.seed, i + 66));
          c.beginPath();
          c.arc(feetX + Math.cos(ang) * r, feetY - 2 - Math.abs(Math.sin(ang)) * q * 6, 2.5 * (1 - q * 0.6), 0, EXO_TAU);
          c.fill();
        }
      }
      c.restore();
    },
  },

  /* the mon tears a sheet of its own past out of its body, hurls it, and the
   * stolen frame boomerangs back and snaps into place */
  frametheft: {
    label: "Frame Theft",
    kind: "moment",
    _p(env) {
      const P = 5;
      return ((env.t % P) + P) % P;
    },
    hidesBase(env) {
      return this._p(env) < 1.6;
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 1.6) return;
      const rx = env.cx - 0.3 * env.PW;
      const ry = env.cy - 0.32 * env.PH;
      const rw = 0.6 * env.PW;
      const rh = 0.56 * env.PH;
      // body with the stolen region hollowed to a dim anchor
      const hollow = p < 1.42 ? Math.min(1, p / 0.2) : Math.max(0, 1 - (p - 1.42) / 0.1);
      const body = exoScratch(env, 0);
      const bc = body.getContext("2d");
      bc.clearRect(0, 0, env.PW, env.PH);
      bc.drawImage(env.look, 0, 0);
      if (hollow > 0) {
        bc.save();
        bc.globalCompositeOperation = "source-atop";
        bc.fillStyle = `rgba(8,10,20,${0.62 * hollow})`;
        bc.fillRect(rx, ry, rw, rh);
        bc.restore();
      }
      exoStamp(c, env, body, {});
      if (hollow <= 0) return;
      // sheet flight path: rip out -> hurl right -> boomerang back -> snap
      let sx = 0;
      let sy2 = 0;
      let rot = 0;
      let alpha = 1;
      let curl = 0;
      if (p < 0.3) {
        const q = exoSmooth(p / 0.3);
        sx = q * 0.16 * env.PW;
        sy2 = -q * 0.1 * env.PH;
        rot = -q * 0.25;
        curl = q * 2.5;
      } else if (p < 0.85) {
        const q = exoSmooth((p - 0.3) / 0.55);
        sx = 0.16 * env.PW + q * 0.42 * env.PW;
        sy2 = -0.1 * env.PH + Math.sin(q * Math.PI) * -0.14 * env.PH;
        rot = -0.25 - q * 2.4;
        curl = 2.5 + Math.sin(q * Math.PI) * 2;
      } else if (p < 1.42) {
        const q = exoSmooth((p - 0.85) / 0.57);
        sx = (0.58 - q * 0.58) * env.PW;
        sy2 = (-0.1 + Math.sin(q * Math.PI) * -0.2 + q * 0.1) * env.PH;
        rot = -2.65 + q * 2.65;
        curl = 2.5 * (1 - q);
      } else {
        // snap flash
        const q = (p - 1.42) / 0.18;
        alpha = 1;
        c.save();
        c.globalCompositeOperation = "lighter";
        c.strokeStyle = `rgba(200,235,255,${0.8 * (1 - q)})`;
        c.lineWidth = 1.5;
        c.strokeRect(env.ox + rx - 1, env.oy + ry - 1, rw + 2, rh + 2);
        c.restore();
      }
      const cxS = env.ox + rx + rw / 2 + sx;
      const cyS = env.oy + ry + rh / 2 + sy2;
      c.save();
      c.imageSmoothingEnabled = false;
      c.translate(cxS, cyS);
      c.rotate(rot);
      c.globalAlpha = alpha;
      // 5 vertical strips with a travelling curl
      const strips = 5;
      const sw = rw / strips;
      for (let s2 = 0; s2 < strips; s2++) {
        const dy = Math.sin((s2 / (strips - 1)) * Math.PI + p * 9) * curl;
        c.drawImage(env.ring(4), rx + s2 * sw, ry, sw, rh, -rw / 2 + s2 * sw, -rh / 2 + dy, sw, rh);
      }
      c.strokeStyle = "rgba(230,240,255,0.5)";
      c.lineWidth = 0.75;
      c.strokeRect(-rw / 2, -rh / 2, rw, rh);
      c.restore();
    },
  },

  /* the mon faints - then scrubs its own timeline backward to undo it. time
   * stamps the attempt out, it tries again at double speed, then accepts. */
  rewinddenial: {
    label: "Rewind Denial",
    kind: "moment",
    _p(env) {
      const P = 8.5;
      return ((env.t % P) + P) % P;
    },
    hidesBase(env) {
      return this._p(env) < 5;
    },
    _fall(c, env, img, th, o) {
      const dir = exoRand(env.seed, 5) > 0.5 ? 1 : -1;
      c.save();
      c.imageSmoothingEnabled = false;
      c.translate(env.ox + env.cx, env.oy + env.fy);
      c.rotate(dir * th);
      c.globalAlpha = o.alpha ?? 1;
      if (o.filter) c.filter = o.filter;
      c.drawImage(img, -env.cx, -env.fy);
      c.restore();
    },
    _scrub(c, env, q, intensity) {
      // body rises while its frames play BACKWARD, with rewind glitch slices
      const th = 1.35 * (1 - q);
      const k = Math.floor((1 - q) * 18) + 1;
      const img = env.ring(k);
      const beat = Math.floor(env.t * 20);
      if (exoRand(env.seed, beat) < 0.35 * intensity) {
        const body = exoScratch(env, 1);
        const bc = body.getContext("2d");
        bc.clearRect(0, 0, env.PW, env.PH);
        const H6 = Math.ceil(env.PH / 6);
        for (let s = 0; s < 6; s++) {
          const off = Math.round((exoRand(env.seed, beat * 7 + s) - 0.5) * 7 * intensity);
          bc.drawImage(img, 0, s * H6, env.PW, H6, off, s * H6, env.PW, H6);
        }
        this._fall(c, env, body, th, { filter: "saturate(1.4)" });
      } else {
        this._fall(c, env, img, th, {});
      }
      // rewind badge
      if (Math.sin(env.t * 14) > -0.3) {
        c.save();
        c.fillStyle = "rgba(120,235,255,0.95)";
        const bx = env.ox + env.cx + 0.3 * env.PW;
        const by = env.oy + env.cy - 0.38 * env.PH;
        for (const dx of [0, 6]) {
          c.beginPath();
          c.moveTo(bx + dx, by);
          c.lineTo(bx + dx + 5, by - 3.5);
          c.lineTo(bx + dx + 5, by + 3.5);
          c.closePath();
          c.fill();
        }
        c.restore();
      }
    },
    _stamp(c, env, q, col) {
      const R = (1 - q) * 0.5 * env.PW + 3;
      c.save();
      c.globalCompositeOperation = "lighter";
      c.strokeStyle = `rgba(${col},${0.3 + 0.6 * q})`;
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(env.ox + env.cx, env.oy + env.cy, R, 0, EXO_TAU);
      c.stroke();
      if (q > 0.75) {
        c.globalAlpha = (q - 0.75) * 3;
        const g = c.createRadialGradient(env.ox + env.cx, env.oy + env.cy, 1, env.ox + env.cx, env.oy + env.cy, 0.4 * env.PW);
        g.addColorStop(0, `rgba(${col},0.55)`);
        g.addColorStop(1, `rgba(${col},0)`);
        c.fillStyle = g;
        c.fillRect(env.ox, env.oy, env.PW, env.PH);
      }
      c.restore();
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 5) return;
      if (p < 0.7) {
        this._fall(c, env, env.look, exoSmooth(p / 0.7) * 1.35, {
          filter: `brightness(${1 - 0.35 * (p / 0.7)})`,
        });
      } else if (p < 0.95) {
        this._fall(c, env, env.look, 1.35, { filter: "brightness(0.65)" });
      } else if (p < 1.75) {
        this._scrub(c, env, (p - 0.95) / 0.8, 1);
      } else if (p < 2.0) {
        exoStamp(c, env, env.look, {});
        this._stamp(c, env, (p - 1.75) / 0.25, "120,235,255");
      } else if (p < 2.45) {
        this._fall(c, env, env.look, exoSmooth((p - 2.0) / 0.45) * 1.35, {
          filter: `brightness(${1 - 0.35 * ((p - 2.0) / 0.45)})`,
        });
      } else if (p < 2.95) {
        this._scrub(c, env, (p - 2.45) / 0.5, 1.8);
      } else if (p < 3.15) {
        exoStamp(c, env, env.look, {});
        this._stamp(c, env, (p - 2.95) / 0.2, "255,110,110");
      } else if (p < 3.7) {
        const q = (p - 3.15) / 0.55;
        this._fall(c, env, env.look, exoSmooth(q) * 1.35, {
          alpha: 1 - q * 0.8,
          filter: `brightness(${1 - 0.4 * q}) saturate(${1 - q * 0.7})`,
        });
      } else if (p < 4.6) {
        // gone - a faint wisp rises from where it lay
        const q = (p - 3.7) / 0.9;
        c.save();
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 0.25 * (1 - q);
        c.filter = "blur(1px) brightness(1.5) saturate(0)";
        c.drawImage(env.look, env.ox, env.oy - q * 10);
        c.restore();
      } else {
        // ...it gets over it (respawn shimmer)
        const q = (p - 4.6) / 0.4;
        exoStamp(c, env, env.look, { alpha: exoSmooth(q) });
        c.save();
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 0.5 * Math.sin(q * Math.PI);
        c.filter = "brightness(2)";
        c.drawImage(env.look, env.ox, env.oy);
        c.restore();
      }
    },
  },

  /* ================= TIME BEHAVING BADLY ======================================== */

  /* the body is woven from oblique bands of different moments; a travelling seam
   * reassigns each band's age; a faint present-frame anchor keeps it readable */
  timequilt: {
    label: "Time Quilt",
    kind: "rig",
    draw(c, env) {
      const N = env.compact ? 4 : 7;
      const cx = env.ox + env.cx;
      const cy = env.oy + env.cy;
      const diag = Math.hypot(env.PW, env.PH);
      c.save();
      c.globalAlpha = 0.3;
      c.imageSmoothingEnabled = false;
      c.drawImage(env.look, env.ox, env.oy);
      c.restore();
      for (let k = 0; k < N; k++) {
        const lag = 2 + Math.floor(exoRand(env.seed, k * 13 + Math.floor(env.t * 0.45 + k / N)) * 17);
        c.save();
        c.translate(cx, cy);
        c.rotate(0.42);
        c.beginPath();
        c.rect(-diag / 2 + (k * diag) / N, -diag / 2, diag / N + 0.6, diag);
        c.clip();
        c.rotate(-0.42);
        c.translate(-cx, -cy);
        c.imageSmoothingEnabled = false;
        c.drawImage(env.ring(lag), env.ox, env.oy + Math.sin(env.t * 1.5 + k * 2.1) * 0.8);
        c.restore();
      }
      // the seam that reassigns time
      const su = (((env.t * 0.45) % 1) + 1) % 1;
      c.save();
      c.translate(cx, cy);
      c.rotate(0.42);
      c.globalCompositeOperation = "lighter";
      const g = c.createLinearGradient(-diag / 2 + su * diag - 3, 0, -diag / 2 + su * diag + 3, 0);
      g.addColorStop(0, "rgba(140,220,255,0)");
      g.addColorStop(0.5, "rgba(200,245,255,0.4)");
      g.addColorStop(1, "rgba(140,220,255,0)");
      c.fillStyle = g;
      c.fillRect(-diag / 2 + su * diag - 3, -diag / 2, 6, diag);
      c.restore();
    },
  },

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
      for (let b = 0; b < 4; b++) {
        const wob = b < 3 ? Math.round(2 * Math.sin(env.t * 2 + b * 1.4) + 2) : 0;
        exoMasked(c, env, lags[b] + wob > 0 ? env.ring(lags[b] + wob) : env.look, masks[b], {
          filter: b < 3 ? `saturate(${1 + (3 - b) * 0.08}) brightness(${1 - (3 - b) * 0.04})` : "none",
        });
      }
    },
  },

  /* the body periodically stops paying time: it freezes while a live ghost keeps
   * moving, then repays the debt in two rapid stepped bursts back onto the beat */
  framedebt: {
    label: "Frame Debt",
    kind: "rig",
    draw(c, env) {
      const P = 6;
      const p = ((env.t % P) + P) % P;
      c.save();
      c.imageSmoothingEnabled = false;
      if (p < 3.2 || p >= 5.1) {
        c.drawImage(env.look, env.ox, env.oy);
      } else if (p < 4.7) {
        // frozen: the ring index grows so the SAME wall-clock moment stays on screen
        const k = Math.min(23, Math.round((p - 3.2) / 0.08));
        c.drawImage(env.ring(k), env.ox, env.oy);
        c.globalAlpha = 0.22;
        c.drawImage(env.look, env.ox, env.oy); // the live self it owes
        c.globalAlpha = 1;
        // accruing debt ticks
        c.globalCompositeOperation = "lighter";
        c.fillStyle = "rgba(255,220,120,0.8)";
        const nT = Math.floor((p - 3.2) / 0.3);
        for (let i = 0; i <= nT && i < 5; i++) {
          c.fillRect(env.ox + env.cx + 0.3 * env.PW, env.oy + env.cy - 0.4 * env.PH + i * 4, 3, 2);
        }
      } else {
        // repayment: two quantized bursts
        const q = (p - 4.7) / 0.4;
        const lag = Math.max(0, Math.round(18 * (1 - (q < 0.5 ? q * 0.8 : 0.4 + (q - 0.5) * 1.2))));
        c.globalAlpha = 0.4;
        c.drawImage(env.ring(Math.min(23, lag + 5)), env.ox + 2, env.oy);
        c.globalAlpha = 1;
        c.drawImage(env.ring(lag), env.ox - 1 + Math.round(exoRand(env.seed, Math.floor(env.t * 30)) * 2), env.oy);
      }
      c.restore();
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
        const sx0 = env.cx + (exoRand(env.seed, k + 5) - 0.5) * 0.45 * env.PW;
        const sy0 = env.cy + (exoRand(env.seed, k + 55) - 0.5) * 0.45 * env.PH;
        c.save();
        c.beginPath();
        c.arc(bx, by, r, 0, EXO_TAU);
        c.clip();
        c.imageSmoothingEnabled = false;
        c.globalAlpha = 0.95;
        c.drawImage(env.ring(4 + k * 5), bx - sx0 * mag, by - sy0 * mag, env.PW * mag, env.PH * mag);
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

  /* one misplaced animation cel simply fails to advance, hangs behind the body,
   * then hurriedly jogs through the missed positions and clicks back in */
  lostkeyframe: {
    label: "Lost Keyframe",
    kind: "rig",
    draw(c, env) {
      const P = 4;
      const p = ((env.t % P) + P) % P;
      const cyc = Math.floor(env.t / P);
      const rw = 0.3 * env.PW;
      const rh = 0.26 * env.PH;
      const rx = env.cx - 0.28 * env.PW + exoRand(env.seed, cyc) * 0.26 * env.PW;
      const ry = env.cy - 0.14 * env.PH + exoRand(env.seed, cyc + 50) * 0.24 * env.PH;
      c.save();
      c.imageSmoothingEnabled = false;
      c.drawImage(env.look, env.ox, env.oy);
      let off = 0;
      if (p < 2.6) {
        off = 1;
      } else if (p < 3) {
        off = Math.ceil((1 - (p - 2.6) / 0.4) * 3) / 3; // quantized jog home
      }
      if (off > 0) {
        const dx = Math.round(4 * off);
        const dy = Math.round(3 * off);
        c.globalAlpha = 0.35;
        c.fillStyle = "#0a0c16";
        c.fillRect(env.ox + rx, env.oy + ry, rw, rh);
        c.globalAlpha = 1;
        c.drawImage(env.ring(8), rx, ry, rw, rh, env.ox + rx + dx, env.oy + ry + dy, rw, rh);
        c.strokeStyle = "rgba(200,230,255,0.35)";
        c.lineWidth = 0.75;
        c.strokeRect(env.ox + rx + dx, env.oy + ry + dy, rw, rh);
      } else if (p < 3.15) {
        c.save();
        c.globalCompositeOperation = "lighter";
        c.strokeStyle = `rgba(200,240,255,${(1 - (p - 3) / 0.15) * 0.7})`;
        c.strokeRect(env.ox + rx, env.oy + ry, rw, rh);
        c.restore();
      }
      c.restore();
    },
  },

  /* a bright scanner climbs the body; everything below it plays BACKWARD, the
   * boundary drags sideways like tape over a playback head */
  rewindscanner: {
    label: "Rewind Scanner",
    kind: "rig",
    draw(c, env) {
      const P = 5;
      const p = ((env.t % P) + P) % P;
      c.save();
      c.imageSmoothingEnabled = false;
      if (p >= 3.2) {
        c.drawImage(env.look, env.ox, env.oy);
        c.restore();
        return;
      }
      if (p >= 2.8) {
        c.drawImage(env.look, env.ox, env.oy);
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = ((3.2 - p) / 0.4) * 0.35;
        c.drawImage(env.look, env.ox, env.oy);
        c.restore();
        return;
      }
      const q = p / 2.8;
      const scanY = Math.round(env.PH * (1 - q));
      const lag = Math.min(23, Math.floor(q * 20));
      if (scanY > 0) {
        c.drawImage(env.look, 0, 0, env.PW, scanY, env.ox, env.oy, env.PW, scanY);
      }
      if (env.PH - scanY > 0) {
        c.drawImage(env.ring(lag), 0, scanY, env.PW, env.PH - scanY, env.ox, env.oy + scanY, env.PW, env.PH - scanY);
      }
      // magnetic drag at the head
      const sh = 3;
      if (scanY > sh) {
        c.drawImage(env.look, 0, scanY - sh, env.PW, sh, env.ox - Math.round(env.PW * 0.06), env.oy + scanY - sh, Math.round(env.PW * 1.12), sh);
      }
      c.save();
      c.globalCompositeOperation = "lighter";
      const g = c.createLinearGradient(0, env.oy + scanY - 4, 0, env.oy + scanY + 4);
      g.addColorStop(0, "rgba(120,255,220,0)");
      g.addColorStop(0.5, "rgba(220,255,245,0.75)");
      g.addColorStop(1, "rgba(120,255,220,0)");
      c.fillStyle = g;
      c.fillRect(env.ox, env.oy + scanY - 4, env.PW, 8);
      c.restore();
      c.restore();
    },
  },

  /* a pocket of slow time wanders across the body: pixels inside update at a
   * third of the rate and shed one faint ripple as it moves on */
  localdilation: {
    label: "Local Time Dilation",
    kind: "rig",
    draw(c, env) {
      const zx = env.ox + env.cx + Math.sin(env.t * 0.35) * 0.28 * env.PW;
      const zy = env.oy + env.cy + Math.cos(env.t * 0.27) * 0.24 * env.PH;
      const r = 0.24 * env.PW;
      c.save();
      c.imageSmoothingEnabled = false;
      c.drawImage(env.look, env.ox, env.oy);
      const lag = Math.min(23, Math.round((env.t - Math.floor(env.t / 0.24) * 0.24) / 0.08) + 1);
      c.save();
      c.beginPath();
      c.arc(zx, zy, r, 0, EXO_TAU);
      c.clip();
      c.translate(zx, zy);
      c.scale(1.05, 1.05);
      c.translate(-zx, -zy);
      c.drawImage(env.ring(lag), env.ox, env.oy);
      c.globalAlpha = 0.12;
      c.drawImage(env.ring(Math.min(23, lag + 7)), env.ox + 1, env.oy);
      c.restore();
      c.save();
      c.globalCompositeOperation = "screen";
      c.strokeStyle = "rgba(150,200,255,0.4)";
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(zx, zy, r, 0, EXO_TAU);
      c.stroke();
      c.restore();
      c.restore();
    },
  },

  /* ================= IDENTITY & LINEAGE ========================================= */

  /* a slatted zoetrope of the whole evolution line rotates behind the mon; the
   * shifting genetic barcode periodically resolves into a readable ancestor */
  evodrum: {
    label: "Evolution Drum",
    kind: "exotic",
    behind(c, env) {
      const chain = (env.evo && env.evo.chain) || [];
      let S = chain.map(id => (id === env.species ? env.look : env.aux(id))).filter(Boolean);
      if (S.length < 2) {
        S = [env.ring(4), env.ring(12), env.look];
      }
      const n = env.compact ? 8 : 12;
      const R = 0.55 * env.PW;
      const dh = 0.72 * env.PH;
      const dy = env.oy + env.cy;
      const dx0 = env.ox + env.cx;
      c.save();
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 0.28;
      c.fillStyle = "#05060d";
      c.beginPath();
      c.ellipse(dx0, dy, R * 1.06, dh * 0.56, 0, 0, EXO_TAU);
      c.fill();
      c.globalAlpha = 1;
      for (let k = 0; k < n; k++) {
        const a = env.t * 0.3 + (k / n) * EXO_TAU;
        const ca = Math.cos(a);
        if (ca <= 0.06) continue; // back of the cylinder
        const u = ((Math.sin(a * 0.5) + env.t * 0.02) % 1 + 1) % 1;
        const uu = (((a / EXO_TAU) % 1) + 1) % 1;
        const mi = Math.floor(uu * S.length) % S.length;
        const colU = uu * S.length - Math.floor(uu * S.length);
        const src = S[mi];
        const sw = Math.max(2, src.width / 9);
        const x = dx0 + Math.sin(a) * R;
        const w = Math.max(1.5, ca * ((R * EXO_TAU) / n) * 0.85);
        c.globalAlpha = 0.55 + 0.35 * ca;
        c.filter = `brightness(${0.55 + 0.45 * ca})`;
        c.drawImage(src, Math.min(src.width - sw, colU * src.width), 0, sw, src.height, x - w / 2, dy - dh / 2, w, dh);
        c.filter = "none";
        void u;
      }
      c.globalAlpha = 1;
      c.restore();
    },
  },

  /* the line's most distant relative worn as a crown of luminous fragments that
   * assemble into its full silhouette at the top of each cycle */
  futurecrown: {
    label: "Future Crown",
    kind: "exotic",
    front(c, env) {
      const chain = (env.evo && env.evo.chain) || [];
      let target = null;
      if (chain.length > 1) {
        const far = chain[chain.length - 1] === env.species ? chain[0] : chain[chain.length - 1];
        target = far === env.species ? null : env.aux(far);
      }
      const src = target || env.ring(10);
      const P = 6;
      const p = ((env.t % P) + P) % P;
      const asm = p < 1.6 ? (p < 0.4 ? exoSmooth(p / 0.4) : p < 1.2 ? 1 : exoSmooth((1.6 - p) / 0.4)) : 0;
      const hx = env.ox + env.cx;
      const hy = env.oy + Math.max(6, env.cy - 0.52 * env.PH);
      const n = 8;
      const fh = 0.3 * env.PH;
      const fs = fh / src.height;
      const fw = (src.width * fs) / n;
      c.save();
      c.imageSmoothingEnabled = false;
      c.globalCompositeOperation = "lighter";
      for (let k = 0; k < n; k++) {
        const oa = env.t * 0.7 + (k / n) * EXO_TAU;
        const ox2 = hx + Math.cos(oa) * 0.17 * env.PW * (1 - asm) + (k - (n - 1) / 2) * fw * asm;
        const oy2 = hy + Math.sin(oa * 1.7) * 4 * (1 - asm) - fh * 0.5 * asm;
        c.globalAlpha = 0.55 + 0.4 * asm;
        c.filter = `brightness(${1.3 + 0.5 * asm}) saturate(1.3)`;
        c.drawImage(src, (k * src.width) / n, 0, src.width / n, src.height, ox2 - fw / 2, oy2, fw, fh * (asm > 0 ? 1 : 0.55));
      }
      c.restore();
    },
  },

  /* the mon's own type icons cut into angular armor plates hovering off the
   * silhouette, clamping inward in a periodic lock */
  typeplates: {
    label: "Type-Plate Exoskeleton",
    kind: "exotic",
    _pass(c, env, wantFront) {
      const types = env.types && env.types.length > 0 ? env.types : ["NORMAL"];
      const pts = exoContour(env);
      const n = env.compact ? 4 : 6;
      const P = 5;
      const p = ((env.t % P) + P) % P;
      const lock = p < 0.9 ? Math.sin((p / 0.9) * Math.PI) : 0;
      for (let k = 0; k < n; k++) {
        const pt = pts[Math.floor((k / n) * pts.length + 6) % pts.length];
        let nx = pt[0] - env.cx;
        let ny = pt[1] - env.cy;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l;
        ny /= l;
        const front = pt[1] > env.cy;
        if (front !== wantFront) continue;
        const hov = (4 + 2 * Math.sin(env.t * 1.8 + k * 1.3)) * (1 - lock) + 0.5 * lock;
        const px = env.ox + pt[0] + nx * hov;
        const py = env.oy + pt[1] + ny * hov;
        const col = EXO_TYPE_COLORS[types[k % types.length]] || "#a8a878";
        const s = env.compact ? 3.6 : 5;
        c.save();
        c.translate(px, py);
        c.rotate(Math.atan2(ny, nx) + Math.PI / 2 + Math.sin(env.t + k) * 0.06);
        c.beginPath();
        c.moveTo(0, -s * 1.2);
        c.lineTo(s, -s * 0.3);
        c.lineTo(s * 0.7, s);
        c.lineTo(-s * 0.7, s);
        c.lineTo(-s, -s * 0.3);
        c.closePath();
        c.fillStyle = col;
        c.globalAlpha = 0.95;
        c.fill();
        c.lineWidth = 1;
        c.strokeStyle = "rgba(10,12,20,0.8)";
        c.stroke();
        c.globalAlpha = 0.5;
        c.fillStyle = "#fff";
        c.fillRect(-s * 0.5, -s * 0.7, s * 0.5, 1.2);
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

  /* a tiny pilot version of the mon steers the full-size body from a glass
   * cockpit at its center of mass, leaning against the motion */
  iconpilot: {
    label: "Icon Pilot",
    kind: "rig",
    draw(c, env) {
      exoStamp(c, env, env.look, {});
      const px0 = env.ox + env.cx;
      const py0 = env.oy + env.cy - 0.04 * env.PH;
      const R = 0.14 * env.PW;
      c.save();
      c.globalCompositeOperation = "source-atop";
      const g0 = c.createRadialGradient(px0, py0, R * 0.2, px0, py0, R);
      g0.addColorStop(0, "rgba(6,10,24,0.9)");
      g0.addColorStop(1, "rgba(6,10,24,0.75)");
      c.fillStyle = g0;
      c.beginPath();
      c.arc(px0, py0, R, 0, EXO_TAU);
      c.fill();
      c.restore();
      c.save();
      c.beginPath();
      c.arc(px0, py0, R, 0, EXO_TAU);
      c.clip();
      const hop = Math.abs(Math.sin(env.t * 2.6)) * 1.2;
      exoStamp(c, env, env.ring(2), {
        x: px0 + Math.sin(env.t * 1.4) * 2,
        y: py0 + R * 0.8 - hop,
        s: (R * 1.5) / env.PH,
        rot: -Math.sin(env.t * 1.4) * 0.14,
        anchorFeet: true,
      });
      c.restore();
      c.save();
      c.strokeStyle = "rgba(160,210,255,0.75)";
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(px0, py0, R, 0, EXO_TAU);
      c.stroke();
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.3;
      c.beginPath();
      c.arc(px0 - R * 0.3, py0 - R * 0.35, R * 0.45, Math.PI * 0.9, Math.PI * 1.6);
      c.lineWidth = 2;
      c.strokeStyle = "#cfe6ff";
      c.stroke();
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
        c.translate(env.ox + env.cx + side * 0.3 * env.PW, env.oy + env.cy - 0.12 * env.PH);
        c.rotate(side * (0.5 + flap));
        c.scale(side * 1.7, 1.5);
        c.globalAlpha = 0.5;
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
      const cw = 0.13 * env.PW * pulse;
      c.save();
      c.globalCompositeOperation = "lighter";
      const g = c.createRadialGradient(bx, by + 0.06 * env.PH, 1, bx, by + 0.06 * env.PH, cw * 1.8);
      g.addColorStop(0, "rgba(200,235,255,0.6)");
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

  /* the mon's origin ball closes around it, rotates shut, then cracks apart into
   * heraldic shoulder arcs that dissolve */
  originshell: {
    label: "Origin Shell",
    kind: "moment",
    _p(env) {
      const P = 7;
      return ((env.t % P) + P) % P;
    },
    hidesBase(env) {
      const p = this._p(env);
      return p >= 0.6 && p < 1.12;
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 2.6) return;
      const bx = env.ox + env.cx;
      const by = env.oy + env.cy;
      const R = 0.44 * env.PW;
      c.save();
      if (p < 0.6) {
        // hemispheres close from above and below
        const q = exoSmooth(p / 0.6);
        const gap = (1 - q) * env.PH * 0.55;
        for (const side of [-1, 1]) {
          c.save();
          c.beginPath();
          c.rect(bx - R - 4, side < 0 ? by - gap - R * 2 : by + gap, R * 2 + 8, R * 2);
          c.clip();
          exoBall(c, bx, by + side * -gap * side * 0 + (side < 0 ? -gap : gap), R, 0, 0.97);
          c.restore();
        }
      } else if (p < 1.12) {
        // sealed: wobble + seam glint
        const rot = Math.sin(env.t * 9) * 0.05;
        exoBall(c, bx, by, R, rot, 1);
        c.save();
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = 0.4 + 0.3 * Math.sin(env.t * 12);
        c.fillStyle = "#fff";
        c.fillRect(bx - R, by - 1, R * 2 * (((env.t * 1.7) % 1) + 0) * 0.999, 1.5);
        c.restore();
      } else if (p < 1.5) {
        // crack apart
        const q = exoSmooth((p - 1.12) / 0.38);
        if (q < 0.25) {
          c.save();
          c.globalCompositeOperation = "lighter";
          c.globalAlpha = 1 - q * 4;
          c.fillStyle = "#fff";
          c.fillRect(bx - R, by - R, R * 2, R * 2);
          c.restore();
        }
        for (const side of [-1, 1]) {
          c.save();
          c.translate(bx + side * q * 0.4 * env.PW, by - q * 0.1 * env.PH + side * q * 6);
          c.rotate(side * q * 0.9);
          c.beginPath();
          c.rect(-R - 4, side < 0 ? -R * 2 : 0, R * 2 + 8, R * 2);
          c.clip();
          c.globalAlpha = 1 - q * 0.3;
          exoBall(c, 0, 0, R, 0, 1);
          c.restore();
        }
      } else {
        // shoulder arcs dissolve
        const q = (p - 1.5) / 1.1;
        for (const side of [-1, 1]) {
          c.save();
          c.translate(bx + side * (0.4 + q * 0.1) * env.PW, by - 0.1 * env.PH);
          c.rotate(side * (0.9 + q * 0.4));
          c.globalAlpha = Math.max(0, 0.7 - q);
          c.beginPath();
          c.rect(-R, -R * 2 * (side < 0 ? 1 : 0), R * 2, R * 2);
          c.clip();
          exoBall(c, 0, 0, R * (1 - q * 0.3), 0, 1);
          c.restore();
        }
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
      const la = env.t * 0.4;
      const lx = env.cx + Math.cos(la) * 0.38 * env.PW;
      const ly = env.cy + Math.sin(la * 0.7) * 0.28 * env.PH;
      c.save();
      c.globalCompositeOperation = "lighter";
      const g = c.createRadialGradient(env.ox + lx, env.oy + ly, 2, env.ox + lx, env.oy + ly, 0.5 * env.PW);
      g.addColorStop(0, "rgba(255,244,214,0.4)");
      g.addColorStop(1, "rgba(255,244,214,0)");
      c.fillStyle = g;
      c.fillRect(env.ox, env.oy, env.PW, env.PH);
      c.restore();
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
    },
  },

  /* glazed ceramic segments hanging from puppeteer threads, each lagging the bob;
   * the strings snap the whole marionette into a display pose each cycle */
  porcelain: {
    label: "Porcelain Marionette",
    kind: "rig",
    draw(c, env) {
      const P = 6;
      const p = ((env.t % P) + P) % P;
      const snap = p < 0.5 ? Math.sin((p / 0.5) * Math.PI) : 0;
      const cols = 2;
      const rows = 3;
      const cw = env.PW / cols;
      const ch = env.PH / rows;
      c.save();
      c.imageSmoothingEnabled = false;
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const k = gy * cols + gx;
          const lag = Math.sin(env.t * 2.2 - k * 0.7) * 1.6 * (1 - snap) - snap * 2.5;
          const sx0 = env.ox + gx * cw;
          const sy0 = env.oy + gy * ch + lag;
          c.filter = "saturate(0.55) brightness(1.14) contrast(1.06)";
          c.drawImage(env.look, gx * cw, gy * ch, cw, ch, sx0, sy0, cw, ch);
          c.filter = "none";
          // puppeteer thread to the segment
          c.strokeStyle = "rgba(190,195,215,0.4)";
          c.lineWidth = 0.75;
          c.beginPath();
          c.moveTo(sx0 + cw / 2, 0);
          c.lineTo(sx0 + cw / 2, sy0 + 2);
          c.stroke();
        }
      }
      // hairline seams
      c.strokeStyle = "rgba(30,32,44,0.35)";
      c.lineWidth = 0.6;
      for (let gx = 1; gx < cols; gx++) {
        c.beginPath();
        c.moveTo(env.ox + gx * cw, env.oy + 6);
        c.lineTo(env.ox + gx * cw, env.oy + env.PH - 6);
        c.stroke();
      }
      for (let gy = 1; gy < rows; gy++) {
        c.beginPath();
        c.moveTo(env.ox + 6, env.oy + gy * ch);
        c.lineTo(env.ox + env.PW - 6, env.oy + gy * ch);
        c.stroke();
      }
      // glaze highlight
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.16;
      const g = c.createRadialGradient(
        env.ox + env.cx - 0.15 * env.PW,
        env.oy + env.cy - 0.2 * env.PH,
        2,
        env.ox + env.cx,
        env.oy + env.cy,
        0.5 * env.PW,
      );
      g.addColorStop(0, "#fff");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.fillRect(env.ox, env.oy, env.PW, env.PH);
      c.restore();
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
            cc.fillStyle = `rgb(${(r * 0.5) | 0},${(g * 0.5) | 0},${(b * 0.5) | 0})`;
            cc.fillRect(x0, y0, cell, cell);
            cc.strokeStyle = `rgb(${Math.min(255, r * 1.15) | 0},${Math.min(255, g * 1.15) | 0},${Math.min(255, b * 1.15) | 0})`;
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
      // embroidery hoop behind
      c.save();
      c.strokeStyle = "#8a6b45";
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(env.ox + env.cx, env.oy + env.cy, 0.52 * env.PW, 0.5 * env.PH, 0, 0, EXO_TAU);
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

  /* the body sliced into diagonal ribbons that perform staggered half-turns -
   * fronts become backs, edges wrap, and for a beat it is a woven knot */
  mobius: {
    label: "Mobius Ribbons",
    kind: "rig",
    draw(c, env) {
      const N = env.compact ? 5 : 8;
      const cx = env.ox + env.cx;
      const cy = env.oy + env.cy;
      const diag = Math.hypot(env.PW, env.PH);
      const order = [];
      for (let k = 0; k < N; k++) {
        order.push([k, Math.abs(Math.cos(env.t * 0.5 + k * 0.24))]);
      }
      order.sort((a, b) => b[1] - a[1]); // edge-on ribbons draw last (on top)
      for (const [k] of order) {
        const f = Math.cos(env.t * 0.5 + k * 0.24);
        const fx = Math.max(0.07, Math.abs(f)) * (f < 0 ? -1 : 1);
        const midX = -diag / 2 + ((k + 0.5) * diag) / N;
        c.save();
        c.translate(cx, cy);
        c.rotate(-0.55);
        c.beginPath();
        c.rect(-diag / 2 + (k * diag) / N, -diag / 2, diag / N + 0.5, diag);
        c.clip();
        c.translate(midX, 0);
        c.scale(fx, 1);
        c.translate(-midX, 0);
        c.rotate(0.55);
        c.translate(-cx, -cy);
        c.imageSmoothingEnabled = false;
        if (f < 0) c.filter = "brightness(0.62) saturate(0.8)";
        c.drawImage(env.look, env.ox, env.oy);
        c.restore();
      }
    },
  },

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
          if (amp > 0.05 && k % 3 === 1) {
            c.globalCompositeOperation = "multiply";
            c.globalAlpha = 0.85;
          }
          c.drawImage(env.look, gx * cw, gy * ch, cw, ch, -cw / 2, -ch / 2, cw, ch);
          c.restore();
        }
      }
      c.restore();
    },
  },

  /* a parade-balloon body: exaggerated squash and stretch, a waving tether, and a
   * periodic slow leak sealed by a flying patch */
  inflatable: {
    label: "Inflatable Mascot",
    kind: "rig",
    draw(c, env) {
      const P = 7;
      const p = ((env.t % P) + P) % P;
      let deflate = 0;
      if (p < 0.8) deflate = exoSmooth(p / 0.8) * 0.1;
      else if (p < 1.2) deflate = 0.1;
      else if (p < 1.7) deflate = 0.1 * (1 - exoSmooth((p - 1.2) / 0.5)) - 0.03 * Math.sin(((p - 1.2) / 0.5) * Math.PI);
      const sy = 1 + 0.1 * Math.sin(env.t * 2.2) - deflate;
      const sx = 1 - 0.07 * Math.sin(env.t * 2.2) + deflate * 0.5;
      const feetX = env.ox + env.cx;
      const feetY = env.oy + env.fy;
      // tether
      c.save();
      c.strokeStyle = "rgba(60,64,84,0.8)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(feetX + 2, feetY - 2);
      c.quadraticCurveTo(
        feetX + 10 + Math.sin(env.t * 1.7) * 4,
        feetY + 6,
        feetX + 18 + Math.sin(env.t * 1.1) * 6,
        feetY + 12,
      );
      c.stroke();
      c.restore();
      exoStamp(c, env, env.look, { x: feetX, y: feetY, sx, sy, anchorFeet: true });
      // balloon sheen
      c.save();
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.2;
      c.beginPath();
      c.ellipse(feetX - 0.13 * env.PW, env.oy + env.cy - 0.18 * env.PH * sy, 0.1 * env.PW, 0.16 * env.PH, -0.4, 0, EXO_TAU);
      c.fillStyle = "#fff";
      c.fill();
      c.restore();
      // leak: puffs stream out, then the patch flies in
      if (p < 1.2) {
        const pts = exoEdge(env);
        const pt = pts[Math.floor(exoRand(env.seed, Math.floor(env.t / P)) * pts.length)] || [env.cx, env.cy, 1, 0];
        for (let i = 0; i < 3; i++) {
          const q = ((p * 2 + i * 0.33) % 1 + 1) % 1;
          c.save();
          c.globalAlpha = (1 - q) * 0.8;
          c.fillStyle = "#cfd6ea";
          c.beginPath();
          c.arc(env.ox + pt[0] + pt[2] * (4 + q * 16), env.oy + pt[1] + pt[3] * (4 + q * 16) - q * 4, 1.6, 0, EXO_TAU);
          c.fill();
          c.restore();
        }
        if (p > 0.8) {
          const q = (p - 0.8) / 0.4;
          c.save();
          c.fillStyle = "#e8b84a";
          c.strokeStyle = "#5e4a17";
          c.lineWidth = 0.75;
          const px2 = env.ox + pt[0] + (1 - q) * 26;
          const py2 = env.oy + pt[1] - (1 - q) * 20;
          c.translate(px2, py2);
          c.rotate((1 - q) * 2.5);
          c.fillRect(-3, -3, 6, 6);
          c.strokeRect(-3, -3, 6, 6);
          c.restore();
        }
      }
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

  /* rim, middle, and core of the body live on different depth planes; a gentle
   * camera sway turns the mon into a layered diorama */
  parallax: {
    label: "Parallax Diorama",
    kind: "rig",
    draw(c, env) {
      const masks = exoBandMasks(env, 3);
      const camX = Math.sin(env.t * 0.5) * 2.6;
      const camY = Math.cos(env.t * 0.37) * 1.5;
      const depth = [1, 0.5, 0.12];
      const shade = ["none", "brightness(0.95)", "brightness(0.88) saturate(0.92)"];
      for (let b = 2; b >= 0; b--) {
        exoMasked(c, env, env.look, masks[b], {
          x: env.ox + env.cx + camX * depth[b],
          y: env.oy + env.cy + camY * depth[b],
          filter: shade[b],
        });
      }
    },
  },

  /* gravity flips for its loose pixels: motes tear off the lower edge, arc up
   * past the head, and rain back in from above */
  gravityrev: {
    label: "Gravity Reversal",
    kind: "exotic",
    _pts(env) {
      return exoCached(`grav:${env.sig}`, () => {
        const pts = exoEdge(env).filter(p2 => p2[3] > 0.25);
        const ld = env.lookData().data;
        const out = [];
        for (let i = 0; i < 10; i++) {
          const pt = pts[Math.floor(exoRand(env.seed, i * 7) * pts.length)] || [env.cx, env.fy, 0, 1];
          const li = (Math.round(pt[1] - 2) * env.PW + Math.round(pt[0])) * 4;
          out.push({
            x: pt[0],
            y: pt[1],
            col: `rgb(${ld[li] || 120},${ld[li + 1] || 130},${ld[li + 2] || 160})`,
            spd: 0.55 + exoRand(env.seed, i + 30) * 0.5,
            ph: exoRand(env.seed, i + 60),
            dir: exoRand(env.seed, i + 90) > 0.5 ? 1 : -1,
          });
        }
        return out;
      });
    },
    front(c, env) {
      const pts = this._pts(env);
      c.save();
      for (const pt of pts) {
        const q = ((env.t * pt.spd * 0.25 + pt.ph) % 1 + 1) % 1;
        const py2 = env.oy + pt.y - q * (pt.y + env.oy - 2);
        const px2 = env.ox + pt.x + Math.sin(q * Math.PI) * 9 * pt.dir;
        c.globalAlpha = q < 0.08 ? q / 0.08 : q > 0.9 ? (1 - q) / 0.1 : 1;
        c.fillStyle = pt.col;
        c.fillRect(px2 - 1, py2 - 1, 2, 2);
      }
      // rising current inside the body
      c.globalCompositeOperation = "source-atop";
      c.globalAlpha = 0.25;
      c.fillStyle = "#cfe4ff";
      for (let i = 0; i < 3; i++) {
        const q = ((env.t * 0.5 + i / 3) % 1 + 1) % 1;
        const lx = env.ox + env.cx + (i - 1) * 0.16 * env.PW;
        c.fillRect(lx, env.oy + env.fy - q * (env.fy - 6), 1, 5);
      }
      c.restore();
    },
  },

  /* horizontal slices scale in a travelling wave - the feet surge toward the
   * camera, then the face looms instead */
  forcedgiant: {
    label: "Forced Perspective",
    kind: "rig",
    draw(c, env) {
      const N = 8;
      const sh = env.PH / N;
      const pc = ((env.t * 0.25) % 1 + 1) % 1;
      const active = pc < 0.16 ? Math.sin((pc / 0.16) * Math.PI) : 0;
      const headward = Math.floor(env.t * 0.25) % 2 === 1;
      c.save();
      c.imageSmoothingEnabled = false;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const w = headward ? 1 - u : u;
        const s = 1 + active * (0.55 * w * w - 0.14 * (1 - w));
        const sw = env.PW * s;
        c.drawImage(env.look, 0, i * sh, env.PW, sh, env.ox + env.cx - (env.cx / env.PW) * sw, env.oy + i * sh, sw, sh + 0.5);
      }
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

  /* the outline detaches and becomes an animal of its own: it crawls the
   * perimeter, bunches at corners, and takes the occasional nip */
  outlinepredator: {
    label: "Outline Predator",
    kind: "exotic",
    front(c, env) {
      const pts = exoContour(env);
      const N = pts.length;
      const head = ((env.t * 0.085) % 1 + 1) % 1;
      const len = 0.13 + 0.05 * Math.sin(env.t * 1.7);
      c.save();
      c.lineCap = "round";
      c.lineJoin = "round";
      for (const [w, col] of [
        [3.2, "rgba(6,8,16,0.55)"],
        [1.8, "rgba(10,12,24,0.95)"],
      ]) {
        c.strokeStyle = col;
        c.lineWidth = w;
        c.beginPath();
        const segs = 16;
        for (let s = 0; s <= segs; s++) {
          const u = (head - (s / segs) * len + 1) % 1;
          const pt = pts[Math.floor(u * N) % N];
          s === 0 ? c.moveTo(env.ox + pt[0], env.oy + pt[1]) : c.lineTo(env.ox + pt[0], env.oy + pt[1]);
        }
        c.stroke();
      }
      const hp = pts[Math.floor(head * N) % N];
      c.fillStyle = "#e8f2ff";
      c.beginPath();
      c.arc(env.ox + hp[0], env.oy + hp[1], 1.1, 0, EXO_TAU);
      c.fill();
      // occasional nip + the body repels it
      const P = 6;
      const p = ((env.t % P) + P) % P;
      if (p < 0.7) {
        let nx = hp[0] - env.cx;
        let ny = hp[1] - env.cy;
        const l = Math.hypot(nx, ny) || 1;
        nx /= l;
        ny /= l;
        const bx = env.ox + hp[0] - nx * 2.5;
        const by = env.oy + hp[1] - ny * 2.5;
        if (p < 0.35) {
          c.fillStyle = `rgba(8,10,18,${0.8 * (1 - p / 0.35)})`;
          c.beginPath();
          c.arc(bx, by, 2.4 * (p / 0.35 < 0.5 ? (p / 0.35) * 2 : 1), 0, EXO_TAU);
          c.fill();
        } else {
          const q = (p - 0.35) / 0.35;
          c.save();
          c.globalCompositeOperation = "lighter";
          const g = c.createRadialGradient(bx, by, 1, bx, by, 8);
          g.addColorStop(0, `rgba(190,230,255,${0.7 * (1 - q)})`);
          g.addColorStop(1, "rgba(190,230,255,0)");
          c.fillStyle = g;
          c.fillRect(bx - 8, by - 8, 16, 16);
          c.restore();
        }
      }
      c.restore();
    },
  },

  /* the equipped surface refuses to stay on the body: a ribbon of the look peels
   * off, loops behind and in front, and pours back through the other side */
  surfaceescape: {
    label: "Surface Escape",
    kind: "exotic",
    _pass(c, env, wantFront) {
      const links = env.compact ? 6 : 9;
      const rx = (env.compact ? 0.42 : 0.52) * env.PW;
      const ry = 0.4 * env.PH;
      for (let i = 0; i < links; i++) {
        const u = ((env.t * 0.13 + i * 0.024) % 1 + 1) % 1;
        const a = u * EXO_TAU;
        const depth = Math.sin(a);
        if (depth >= 0 !== wantFront) continue;
        const px2 = env.ox + env.cx + Math.cos(a) * rx;
        const py2 = env.oy + env.cy + depth * ry * 0.35 - Math.cos(a * 2) * 4;
        const tang = a + Math.PI / 2;
        const sw = 6;
        const sx0 = exoClamp(env.cx - 0.25 * env.PW + i * sw, 0, env.PW - sw);
        c.save();
        c.translate(px2, py2);
        c.rotate(tang);
        c.scale(1, 0.85 + 0.25 * depth);
        c.imageSmoothingEnabled = false;
        c.globalAlpha = 0.8 + 0.15 * depth;
        c.globalCompositeOperation = "screen";
        c.filter = `brightness(${1 + 0.2 * depth}) saturate(1.35)`;
        c.drawImage(env.look, sx0, env.cy - 9, sw, 18, -sw / 2, -9, sw, 18);
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

  /* the silhouette becomes a glass doorway: the evolution line floats as a
   * miniature diorama inside, behind a faint membrane of the present self */
  portalanatomy: {
    label: "Portal Anatomy",
    kind: "rig",
    draw(c, env) {
      exoStamp(c, env, env.look, { filter: "brightness(0.3) saturate(0.55)" });
      const s = exoScratch(env, 3);
      const sc = s.getContext("2d");
      sc.clearRect(0, 0, env.PW, env.PH);
      sc.imageSmoothingEnabled = false;
      // inner void glow
      const g = sc.createRadialGradient(env.cx, env.cy, 2, env.cx, env.cy, 0.5 * env.PW);
      g.addColorStop(0, "rgba(70,60,130,0.85)");
      g.addColorStop(1, "rgba(15,12,40,0.9)");
      sc.fillStyle = g;
      sc.fillRect(0, 0, env.PW, env.PH);
      // drifting dust
      sc.globalCompositeOperation = "lighter";
      for (let i = 0; i < 8; i++) {
        const q = ((env.t * (0.1 + 0.06 * exoRand(env.seed, i)) + exoRand(env.seed, i + 20)) % 1 + 1) % 1;
        sc.globalAlpha = 0.6 * Math.sin(q * Math.PI);
        sc.fillStyle = "#cfd8ff";
        sc.fillRect(env.cx + (exoRand(env.seed, i + 40) - 0.5) * 0.6 * env.PW, env.PH * (1 - q), 1, 1);
      }
      sc.globalAlpha = 1;
      sc.globalCompositeOperation = "source-over";
      // the lineage floats inside at different parallax depths
      const chain = ((env.evo && env.evo.chain) || []).filter(id => id !== env.species);
      let drawn = 0;
      for (let k = 0; k < chain.length && drawn < 2; k++) {
        const img = env.aux(chain[k]);
        if (!img) continue;
        const depth2 = 1 - drawn * 0.45;
        const h = 0.26 * env.PH * depth2;
        const fs = h / img.height;
        const ix = env.cx + Math.sin(env.t * 0.4 + drawn * 2.6) * 0.16 * env.PW * depth2;
        const iy = env.cy + Math.cos(env.t * 0.31 + drawn * 1.9) * 0.13 * env.PH * depth2 + drawn * 6;
        sc.globalAlpha = 0.55 + 0.35 * depth2;
        sc.drawImage(img, ix - (img.width * fs) / 2, iy - h / 2, img.width * fs, h);
        drawn++;
      }
      sc.globalAlpha = 1;
      sc.globalCompositeOperation = "destination-in";
      sc.drawImage(exoMaskCv(env), 0, 0);
      sc.globalCompositeOperation = "source-over";
      exoStamp(c, env, s, {});
      exoStamp(c, env, env.look, { alpha: 0.26 }); // present-self membrane
      // glass edge
      const pts = exoEdge(env);
      c.save();
      c.globalCompositeOperation = "lighter";
      c.fillStyle = "rgba(170,210,255,0.5)";
      for (let i = 0; i < pts.length; i += 2) {
        c.fillRect(env.ox + pts[i][0], env.oy + pts[i][1], 1, 1);
      }
      c.restore();
    },
  },

  /* bright motes launch off the body, orbit, and land on a color cluster - each
   * landing repaints the cluster with the mote's color for a beat */
  chromaticfeedback: {
    label: "Chromatic Feedback",
    kind: "exotic",
    front(c, env) {
      const L = exoLumaClusters(env);
      const s = exoScratch(env, 4);
      for (let k = 0; k < 3; k++) {
        const Pk = 3 + k * 0.4;
        const q = ((env.t / Pk + k / 3) % 1 + 1) % 1;
        const hue = (k * 120 + Math.floor(env.t / Pk) * 47) % 360;
        const col = `hsl(${hue} 85% 65%)`;
        const target = (k + Math.floor(env.t / Pk)) % 3;
        const [tx, ty] = L.cent[target];
        let px2 = 0;
        let py2 = 0;
        if (q < 0.7) {
          const a0 = exoRand(env.seed, k + 7) * EXO_TAU;
          const a = a0 + (q / 0.7) * 2.4;
          const r = 0.2 * env.PW + Math.sin((q / 0.7) * Math.PI) * 0.3 * env.PW;
          px2 = env.ox + env.cx + Math.cos(a) * r;
          py2 = env.oy + env.cy + Math.sin(a) * r * 0.8;
        } else {
          const qq = exoSmooth((q - 0.7) / 0.3);
          const a = exoRand(env.seed, k + 7) * EXO_TAU + 2.4;
          px2 = env.ox + env.cx + Math.cos(a) * 0.2 * env.PW * (1 - qq) + (env.ox + tx - (env.ox + env.cx)) * qq;
          py2 = env.oy + env.cy + Math.sin(a) * 0.16 * env.PH * (1 - qq) + (env.oy + ty - (env.oy + env.cy)) * qq;
        }
        c.save();
        c.globalCompositeOperation = "lighter";
        c.fillStyle = col;
        c.beginPath();
        c.arc(px2, py2, 1.6, 0, EXO_TAU);
        c.fill();
        c.globalAlpha = 0.4;
        c.beginPath();
        c.arc(px2, py2, 3.4, 0, EXO_TAU);
        c.fill();
        c.restore();
        // landing pulse repaints the receiving cluster
        if (q > 0.94 || q < 0.18) {
          const pulse = q > 0.94 ? (q - 0.94) / 0.06 : 1 - q / 0.18;
          const sc = s.getContext("2d");
          sc.clearRect(0, 0, env.PW, env.PH);
          sc.drawImage(L.masks[target], 0, 0);
          sc.globalCompositeOperation = "source-in";
          sc.fillStyle = col;
          sc.fillRect(0, 0, env.PW, env.PH);
          sc.globalCompositeOperation = "source-over";
          exoStamp(c, env, s, { alpha: 0.45 * pulse, comp: "lighter" });
        }
      }
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
      c.scale(flip, -0.55);
      c.globalAlpha = 0.4;
      c.filter = agree ? "none" : "hue-rotate(140deg) saturate(1.6)";
      c.drawImage(s, -env.cx, -env.fy);
      c.restore();
    },
  },

  /* a huge translucent type sigil approaches from behind, passes THROUGH the body
   * plane recoloring what it covers, and exits past the camera */
  maskedeclipse: {
    label: "Masked Eclipse",
    kind: "exotic",
    _state(env) {
      const P = 9;
      const p = ((env.t % P) + P) % P;
      const type = (env.types && env.types[0]) || "NORMAL";
      const col = EXO_TYPE_COLORS[type] || "#a8a878";
      const dx0 = env.ox + env.cx + Math.sin(env.t * 0.23) * 0.1 * env.PW;
      const dy0 = env.oy + env.cy - 0.05 * env.PH;
      return { p, col, dx0, dy0 };
    },
    _disc(c, env, S, r, alpha) {
      c.save();
      c.globalAlpha = alpha;
      const g = c.createRadialGradient(S.dx0, S.dy0, r * 0.2, S.dx0, S.dy0, r);
      g.addColorStop(0, S.col);
      g.addColorStop(0.8, S.col);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(S.dx0, S.dy0, r, 0, EXO_TAU);
      c.fill();
      c.globalCompositeOperation = "lighter";
      c.strokeStyle = S.col;
      c.lineWidth = 1.5;
      c.globalAlpha = alpha * 1.6;
      c.beginPath();
      c.arc(S.dx0, S.dy0, r * 0.82, 0, EXO_TAU);
      c.stroke();
      c.restore();
    },
    behind(c, env) {
      const S = this._state(env);
      if (S.p < 3.4) {
        const q = exoSmooth(S.p / 3.4);
        this._disc(c, env, S, (0.14 + q * 0.42) * env.PW, 0.16 + q * 0.22);
      }
    },
    front(c, env) {
      const S = this._state(env);
      if (S.p >= 3.4 && S.p < 6) {
        // crossing the body plane: covered body pixels take the type's color
        const q = (S.p - 3.4) / 2.6;
        const r = 0.56 * env.PW;
        const s = exoScratch(env, 6);
        const sc = s.getContext("2d");
        sc.clearRect(0, 0, env.PW, env.PH);
        sc.save();
        sc.beginPath();
        sc.arc(S.dx0 - env.ox, S.dy0 - env.oy, r * Math.sin(q * Math.PI), 0, EXO_TAU);
        sc.clip();
        sc.imageSmoothingEnabled = false;
        sc.filter = "saturate(0.25) brightness(1.05)";
        sc.drawImage(env.look, 0, 0);
        sc.filter = "none";
        sc.globalCompositeOperation = "source-atop";
        sc.globalAlpha = 0.45;
        sc.fillStyle = S.col;
        sc.fillRect(0, 0, env.PW, env.PH);
        sc.restore();
        exoStamp(c, env, s, {});
        this._disc(c, env, S, r * Math.sin(q * Math.PI) + 2, 0.1);
      } else if (S.p >= 6 && S.p < 8) {
        const q = exoSmooth((S.p - 6) / 2);
        this._disc(c, env, S, (0.56 + q * 0.5) * env.PW, 0.3 * (1 - q));
      }
    },
  },

  /* ================= MOMENTS (battle theater) =================================== */

  /* the ball itself arrives as a meteor: a flaming streak, a ground strike, and
   * the mon rising out of the impact dust */
  meteorball: {
    label: "Meteor Ball",
    kind: "moment",
    _p(env) {
      const P = 7;
      return ((env.t % P) + P) % P;
    },
    hidesBase(env) {
      return this._p(env) < 1.9;
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 2.4) return;
      const feetX = env.ox + env.cx;
      const feetY = env.oy + env.fy;
      c.save();
      c.imageSmoothingEnabled = false;
      if (p < 0.7) {
        const q = exoSmooth(p / 0.7);
        const bx = env.ox - 0.2 * env.PW + q * (feetX - env.ox + 0.2 * env.PW);
        const by = env.oy - 0.15 * env.PH + q * (feetY - env.oy + 0.15 * env.PH);
        c.save();
        c.globalCompositeOperation = "lighter";
        for (let i = 1; i <= 5; i++) {
          const tq = Math.max(0, q - i * 0.06);
          const tx = env.ox - 0.2 * env.PW + tq * (feetX - env.ox + 0.2 * env.PW);
          const ty = env.oy - 0.15 * env.PH + tq * (feetY - env.oy + 0.15 * env.PH);
          c.globalAlpha = 0.5 - i * 0.08;
          c.fillStyle = i < 3 ? "#ffd27a" : "#ff8a4a";
          c.beginPath();
          c.arc(tx, ty, 5 - i * 0.7, 0, EXO_TAU);
          c.fill();
        }
        c.restore();
        exoBall(c, bx, by, 5.5, q * 9, 1);
      } else {
        const q2 = (p - 0.7) / 1.7;
        // shock ring + dust
        if (p < 1.5) {
          const rq = (p - 0.7) / 0.8;
          c.save();
          c.globalCompositeOperation = "lighter";
          c.strokeStyle = `rgba(255,220,150,${0.8 * (1 - rq)})`;
          c.lineWidth = 2.5 * (1 - rq) + 0.5;
          c.beginPath();
          c.ellipse(feetX, feetY, 6 + rq * 0.5 * env.PW, 3 + rq * 0.1 * env.PH, 0, 0, EXO_TAU);
          c.stroke();
          c.restore();
        }
        for (let i = 0; i < 7; i++) {
          const dq = exoClamp(q2 * 1.6 - i * 0.06, 0, 1);
          if (dq <= 0 || dq >= 1) continue;
          const ang = exoRand(env.seed, i + 11) * Math.PI;
          c.globalAlpha = (1 - dq) * 0.7;
          c.fillStyle = "#b9a98a";
          c.beginPath();
          c.arc(feetX + Math.cos(ang) * (6 + dq * 24) * (exoRand(env.seed, i) > 0.5 ? 1 : -1), feetY - Math.sin(ang) * dq * 14, 2.2 * (1 - dq * 0.5), 0, EXO_TAU);
          c.fill();
        }
        c.globalAlpha = 1;
        // the mon rises out of the crater
        if (p >= 0.9) {
          const rq = exoSmooth(exoClamp((p - 0.9) / 1, 0, 1));
          c.save();
          c.beginPath();
          c.rect(env.ox - env.PW, env.oy - env.PH, env.PW * 3, feetY - (env.oy - env.PH));
          c.clip();
          c.drawImage(env.look, env.ox, env.oy + (1 - rq) * 0.35 * env.PH);
          c.restore();
        }
        // the spent ball bounces away
        if (p < 1.8) {
          const bq = (p - 0.7) / 1.1;
          exoBall(c, feetX + bq * 0.45 * env.PW, feetY - Math.abs(Math.sin(bq * Math.PI * 2)) * 12 * (1 - bq), 4 * (1 - bq * 0.4), bq * 7, 1 - bq * 0.8);
        }
      }
      c.restore();
    },
  },

  /* the body compresses into bellows, shivers with anticipation, then snaps wide
   * and fires a fan of its own bright pixels */
  accordion: {
    label: "Accordion Cannon",
    kind: "moment",
    _p(env) {
      const P = 6;
      return ((env.t % P) + P) % P;
    },
    hidesBase(env) {
      return this._p(env) < 1.6;
    },
    front(c, env) {
      const p = this._p(env);
      if (p >= 1.6) return;
      let k = 1;
      let shiver = 0;
      if (p < 0.5) k = 1 - exoSmooth(p / 0.5) * 0.45;
      else if (p < 0.7) {
        k = 0.55;
        shiver = Math.sin(env.t * 60) * 1;
      } else if (p < 1) {
        const q = (p - 0.7) / 0.3;
        k = 0.55 + exoSmooth(q) * 0.6; // overshoot to 1.15
      } else {
        k = 1.15 - exoSmooth((p - 1) / 0.6) * 0.15;
      }
      const cx = env.ox + env.cx + shiver;
      const strips = 4;
      const sw = env.PW / strips;
      c.save();
      c.imageSmoothingEnabled = false;
      for (let si = 0; si < strips; si++) {
        const srcCx = (si + 0.5) * sw;
        const destCx = cx + (srcCx - env.cx) * k;
        c.drawImage(env.look, si * sw, 0, sw, env.PH, destCx - (sw * k) / 2, env.oy, sw * k, env.PH);
      }
      // release: pixel fan + wave
      if (p >= 0.7 && p < 1.4) {
        const q = (p - 0.7) / 0.7;
        c.save();
        c.globalCompositeOperation = "lighter";
        for (let i = 0; i < 8; i++) {
          const ang = -0.5 + (i / 7) * 1;
          const d = q * (0.35 + 0.25 * exoRand(env.seed, i)) * env.PW;
          c.globalAlpha = (1 - q) * 0.9;
          c.fillStyle = `hsl(${(i * 40) % 360} 80% 75%)`;
          c.fillRect(cx + 0.2 * env.PW + Math.cos(ang) * d, env.oy + env.cy + Math.sin(ang) * d, 2, 2);
        }
        c.strokeStyle = `rgba(220,240,255,${(1 - q) * 0.6})`;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(cx + 0.18 * env.PW, env.oy + env.cy, 4 + q * 0.3 * env.PW, -0.7, 0.7);
        c.stroke();
        c.restore();
      }
      c.restore();
    },
  },

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
        let r = 3.4;
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
      c.save();
      c.imageSmoothingEnabled = false;
      if (p < 0.6) {
        // fold right half over the left
        const q = exoSmooth(p / 0.6);
        c.drawImage(env.look, 0, 0, env.cx, env.PH, env.ox, env.oy, env.cx, env.PH);
        const k = Math.cos(q * Math.PI);
        c.save();
        c.translate(env.ox + env.cx, 0);
        c.scale(Math.max(0.04, Math.abs(k)) * (k < 0 ? -1 : 1), 1);
        c.translate(-(env.ox + env.cx), 0);
        if (k < 0) c.filter = "brightness(0.7)";
        c.drawImage(env.look, env.cx, 0, env.PW - env.cx, env.PH, env.ox + env.cx, env.oy, env.PW - env.cx, env.PH);
        c.restore();
      } else if (p < 1.2) {
        // fold the top half down (left half remains as the packet base)
        const q = exoSmooth((p - 0.6) / 0.6);
        const k = Math.cos(q * Math.PI);
        c.save();
        c.beginPath();
        c.rect(env.ox, env.oy + env.cy, env.cx, env.PH - env.cy);
        c.clip();
        c.drawImage(env.look, 0, 0, env.cx, env.PH, env.ox, env.oy, env.cx, env.PH);
        c.restore();
        c.save();
        c.translate(0, env.oy + env.cy);
        c.scale(1, Math.max(0.04, Math.abs(k)) * (k < 0 ? -1 : 1));
        c.translate(0, -(env.oy + env.cy));
        if (k < 0) c.filter = "brightness(0.6)";
        c.beginPath();
        c.rect(env.ox, env.oy, env.cx, env.cy);
        c.clip();
        c.drawImage(env.look, 0, 0, env.cx, env.PH, env.ox, env.oy, env.cx, env.PH);
        c.restore();
      } else {
        // the parcel: tips backward, then slides under its own shadow
        const bw = env.cx * 0.6;
        const bh = (env.PH - env.cy) * 0.5;
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

  /* the mon notices YOUR cursor: it leans toward it, flattens when you get close,
   * and lunges with a startled "!" - move the mouse over the stage */
  cursorbait: {
    label: "Cursor Bait",
    kind: "rig",
    draw(c, env) {
      const cur = env.cursor;
      if (!cur) {
        exoStamp(c, env, env.look, { rot: Math.sin(env.t * 0.8) * 0.015 });
        return;
      }
      const bx = env.ox + env.cx;
      const by = env.oy + env.cy;
      const dx = cur.x - bx;
      const dy = cur.y - by;
      const d = Math.hypot(dx, dy) || 1;
      const near = exoClamp(1 - d / (0.55 * env.PW), 0, 1);
      const lean = exoClamp(dx / (2.2 * env.PW), -0.15, 0.15);
      const lunge = near > 0 ? Math.max(0, Math.sin(env.t * 9)) * near * 3 : 0;
      exoStamp(c, env, env.look, {
        x: env.ox + env.cx + exoClamp(dx, -34, 34) * 0.1 + (dx / d) * lunge,
        y: env.oy + env.fy,
        sx: 1 + 0.1 * near,
        sy: 1 - 0.12 * near,
        rot: lean * (1 - near * 0.5),
        anchorFeet: true,
      });
      // gaze glint on the contour point facing the cursor
      const pts = exoContour(env);
      let best = pts[0];
      let bd = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < pts.length; i += 3) {
        const dot = (pts[i][0] - env.cx) * dx + (pts[i][1] - env.cy) * dy;
        if (dot > bd) {
          bd = dot;
          best = pts[i];
        }
      }
      c.save();
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.5 + 0.4 * Math.sin(env.t * 8);
      c.fillStyle = "#eaf4ff";
      c.beginPath();
      c.arc(env.ox + best[0], env.oy + best[1], 1.4 + near, 0, EXO_TAU);
      c.fill();
      // startled "!" when you get very close
      if (near > 0.55) {
        c.globalAlpha = (near - 0.55) * 2.2;
        c.font = "10px monospace";
        c.textAlign = "center";
        c.fillStyle = "#ffd23e";
        c.strokeStyle = "rgba(0,0,0,0.8)";
        c.lineWidth = 2;
        const ey = env.oy + env.cy - 0.55 * env.PH;
        c.strokeText("!", bx + 6, ey);
        c.fillText("!", bx + 6, ey);
      }
      c.restore();
    },
  },

  /* the body becomes a live lens: the stage backdrop bends and slides inside the
   * silhouette while caustics crawl the edge (site preview of the WebGL idea) */
  worldlens: {
    label: "World-Lens Skin",
    kind: "rig",
    draw(c, env) {
      const s = exoScratch(env, 7);
      const sc = s.getContext("2d");
      sc.clearRect(0, 0, env.PW, env.PH);
      const wob1 = Math.sin(env.t * 0.9) * 5;
      const wob2 = Math.cos(env.t * 0.7) * 4;
      const bg = env.bg || "void";
      if (bg === "checker") {
        const cell = 9;
        for (let y = -1; y * cell < env.PH + cell; y++) {
          for (let x = -1; x * cell < env.PW + cell; x++) {
            sc.fillStyle = (x + y) % 2 === 0 ? "#1a1d29" : "#11131d";
            sc.fillRect(x * cell + wob1, y * cell + wob2, cell, cell);
          }
        }
      } else {
        const cols =
          bg === "snow" ? ["#eaf2ff", "#b9c8e6"] : bg === "mid" ? ["#241a3a", "#0a0712"] : ["#1b2236", "#070810"];
        // magnified, displaced copy of the stage gradient
        const g = sc.createRadialGradient(
          env.cx - wob1 * 2,
          env.cy - 0.1 * env.PH - wob2 * 2,
          2,
          env.cx - wob1 * 2,
          env.cy - wob2 * 2,
          0.75 * env.PW,
        );
        g.addColorStop(0, cols[0]);
        g.addColorStop(1, cols[1]);
        sc.fillStyle = g;
        sc.fillRect(0, 0, env.PW, env.PH);
      }
      // internal refraction band
      sc.globalCompositeOperation = "overlay";
      const g2 = sc.createLinearGradient(0, env.cy + wob2 * 2, env.PW, env.cy - wob1 * 2);
      g2.addColorStop(0, "rgba(255,255,255,0)");
      g2.addColorStop(0.5, "rgba(255,255,255,0.35)");
      g2.addColorStop(1, "rgba(255,255,255,0)");
      sc.fillStyle = g2;
      sc.fillRect(0, 0, env.PW, env.PH);
      sc.globalCompositeOperation = "destination-in";
      sc.drawImage(exoMaskCv(env), 0, 0);
      sc.globalCompositeOperation = "source-over";
      exoStamp(c, env, s, { alpha: 0.9 });
      exoStamp(c, env, env.look, { alpha: 0.24 }); // ghost of the features
      // edge caustics
      const pts = exoEdge(env);
      c.save();
      c.globalCompositeOperation = "lighter";
      for (let i = 0; i < pts.length; i += 2) {
        const tw = Math.sin(env.t * 2.4 + pts[i][0] * 0.22 + pts[i][1] * 0.31);
        if (tw < 0.45) continue;
        c.globalAlpha = (tw - 0.45) * 1.2;
        c.fillStyle = "#dceeff";
        c.fillRect(env.ox + pts[i][0], env.oy + pts[i][1], 1, 1);
      }
      c.restore();
    },
  },
};

const ALL_EXOTIC = Object.keys(EXOTIC).filter(k => EXOTIC[k].kind === "exotic");
const ALL_RIG = Object.keys(EXOTIC).filter(k => EXOTIC[k].kind === "rig");
const ALL_MOMENT = Object.keys(EXOTIC).filter(k => EXOTIC[k].kind === "moment");
export { EXOTIC, ALL_EXOTIC, ALL_RIG, ALL_MOMENT };
