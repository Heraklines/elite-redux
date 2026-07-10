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
      c.save();
      c.globalCompositeOperation = "lighter";
      const g = c.createLinearGradient(term - 3, 0, term + 3, 0);
      g.addColorStop(0, "rgba(160,220,255,0)");
      g.addColorStop(0.5, "rgba(200,240,255,0.5)");
      g.addColorStop(1, "rgba(160,220,255,0)");
      c.fillStyle = g;
      c.fillRect(term - 3, env.oy, 6, env.PH);
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
};

const ALL_EXOTIC = Object.keys(EXOTIC).filter(k => EXOTIC[k].kind === "exotic");
const ALL_RIG = Object.keys(EXOTIC).filter(k => EXOTIC[k].kind === "rig");
const ALL_MOMENT = Object.keys(EXOTIC).filter(k => EXOTIC[k].kind === "moment");
export { EXOTIC, ALL_EXOTIC, ALL_RIG, ALL_MOMENT };
