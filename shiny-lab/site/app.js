/* Shiny Lab - live renderer (v4). Any Pokemon, sprites pulled from the er-assets
 * CDN (jsDelivr, pinned sha) like the game does. Same effect math as fx.mjs
 * (PALETTE / AURA / AROUND / LABELS / PARTIAL / computeEdge / computeDist / voro /
 * mix / clamp / vnoise / ALL_* inlined above). Three combinable slots:
 *   Palette (crossplay-safe color) x Surface FX (on-sprite) x Around FX (around the mon).
 * Per-pixel JS on a padded canvas, CSS-upscaled (image-rendering:pixelated). No WebGL. */

const LAB = window.LAB;
const CDN = LAB.cdn;
const SPECIES = LAB.species;
const PAD = 22;
let FW = 0;
let FH = 0;
let PW = 0;
let PH = 0;
let curSpecies = LAB.def;
let CL = null;

const PALS = ["base", ...ALL_PALETTE];
const SLOTKIND = { palette: PALS, surface: ALL_AURA, around: ALL_AROUND };

// ---- sprite loading (CDN) ----------------------------------------------------
const sheet = document.createElement("canvas");
const sctx = sheet.getContext("2d", { willReadFrequently: true });
let frameBuf = [];
const edgeCache = new Map();
const distCache = new Map();
const edgeFor = ai => {
  if (!edgeCache.has(ai)) {
    edgeCache.set(ai, computeEdge(frameBuf[ai], FW, FH));
  }
  return edgeCache.get(ai);
};
const distFor = ai => {
  if (!distCache.has(ai)) {
    distCache.set(ai, computeDist(frameBuf[ai], FW, FH, PAD));
  }
  return distCache.get(ai);
};
const makeSampler = buf => (x, y) => {
  const xi = Math.max(0, Math.min(FW - 1, Math.round(x * FW)));
  const yi = Math.max(0, Math.min(FH - 1, Math.round(y * FH)));
  const i = (yi * FW + xi) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
};
const parseFrames = a =>
  a.textures ? a.textures[0].frames : Array.isArray(a.frames) ? a.frames : Object.values(a.frames);
const loadImg = src =>
  new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
const status = msg => {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.style.opacity = msg ? 1 : 0;
};

async function loadSpecies(id) {
  status("loading #" + id + " ...");
  const base = `${CDN}/${id}`;
  const atlas = await fetch(base + ".json").then(r => {
    if (!r.ok) {
      throw new Error("no atlas");
    }
    return r.json();
  });
  const fr = parseFrames(atlas);
  const f0 = fr[0];
  const nFW = (f0.sourceSize && f0.sourceSize.w) || f0.frame.w;
  const nFH = (f0.sourceSize && f0.sourceSize.h) || f0.frame.h;
  const img = await loadImg(base + ".png");
  sheet.width = img.width;
  sheet.height = img.height;
  sctx.clearRect(0, 0, img.width, img.height);
  sctx.drawImage(img, 0, 0);
  FW = nFW;
  FH = nFH;
  PW = FW + 2 * PAD;
  PH = FH + 2 * PAD;
  frameBuf = [];
  edgeCache.clear();
  distCache.clear();
  for (const f of fr) {
    const fb = new Float32Array(FW * FH * 4);
    const sss = f.spriteSourceSize || { x: 0, y: 0 };
    const sub = sctx.getImageData(f.frame.x, f.frame.y, f.frame.w, f.frame.h).data;
    for (let yy = 0; yy < f.frame.h; yy++) {
      for (let xx = 0; xx < f.frame.w; xx++) {
        const dx = sss.x + xx;
        const dy = sss.y + yy;
        if (dx < 0 || dy < 0 || dx >= FW || dy >= FH) {
          continue;
        }
        const di = (dy * FW + dx) * 4;
        const si = (yy * f.frame.w + xx) * 4;
        fb[di] = sub[si] / 255;
        fb[di + 1] = sub[si + 1] / 255;
        fb[di + 2] = sub[si + 2] / 255;
        fb[di + 3] = sub[si + 3] / 255;
      }
    }
    frameBuf.push(fb);
  }
  let dense = frameBuf[0];
  let dn = -1;
  for (const f of frameBuf) {
    let o = 0;
    for (let i = 3; i < f.length; i += 4) {
      if (f[i] > 0.5) {
        o++;
      }
    }
    if (o > dn) {
      dn = o;
      dense = f;
    }
  }
  CL = computeClusters(dense, FW, FH, 5);
  curSpecies = id;
  resizeCanvases();
  status("");
  // give each mon a different default texture seed (so e.g. Bioluminescent spots differ)
  fxSeed = (id * 13) % 257;
  const se = document.getElementById("seed");
  if (se) {
    se.value = fxSeed;
  }
}

// ---- render a full look (palette + surface + around) onto a padded buffer -----
function renderLook(slots, buf, ef, dist, t, out, amt) {
  const sa = makeSampler(buf);
  const ac = { cx: dist.cx, cy: dist.cy };
  const ctx = {
    e: 0,
    sa,
    W: FW,
    H: FH,
    K: CL ? CL.K : 1,
    clRank: (r, g, b) => (CL ? clusterRank(CL, r, g, b) : 0),
    clColor: i => (CL ? CL.cent[i] : [0.5, 0.5, 0.5]),
  };
  const pal = slots.palette && slots.palette !== "base" ? slots.palette : null;
  const surf = slots.surface || null;
  const aro = slots.around || null;
  // FX color: default = each effect's own colors; palette = match the palette's
  // most colorful tone; custom = a hand-picked color (the aura color picker).
  const doTint = fxColorMode !== "default";
  let tintH = fxCustomH;
  let tintS = fxCustomS;
  if (fxColorMode === "palette") {
    let best = -1;
    const refs = CL
      ? CL.cent
      : [
          [0.3, 0.4, 0.6],
          [0.6, 0.7, 0.95],
        ];
    for (const cen of refs) {
      const c = pal ? PALETTE[pal](cen[0], cen[1], cen[2], ctx) : cen;
      const hsv = rgb2hsv(c[0], c[1], c[2]);
      if (hsv[1] * hsv[2] > best) {
        best = hsv[1] * hsv[2];
        tintH = hsv[0];
        tintS = Math.max(0.5, hsv[1]);
      }
    }
  }
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const k = (py * PW + px) * 4;
      const sx = px - PAD;
      const sy = py - PAD;
      const on = sx >= 0 && sy >= 0 && sx < FW && sy < FH && buf[(sy * FW + sx) * 4 + 3] > 0.02;
      if (on) {
        const i = (sy * FW + sx) * 4;
        const a0 = buf[i + 3];
        const x = (sx + 0.5) / FW;
        const y = (sy + 0.5) / FH;
        ctx.e = ef[sy * FW + sx];
        const r = buf[i];
        const g = buf[i + 1];
        const b = buf[i + 2];
        let a = a0;
        let col = pal ? PALETTE[pal](r, g, b, ctx) : [r, g, b];
        if (pal) {
          a = a0 * (PALETTE_ALPHA[pal] ?? 1);
          if (amt.pal < 1) {
            col = [mix(r, col[0], amt.pal), mix(g, col[1], amt.pal), mix(b, col[2], amt.pal)];
            a = mix(a0, a, amt.pal);
          }
        }
        if (surf) {
          const base2 = col;
          const aPal = a;
          let sc;
          if (surf === "prismatic") {
            const off = 0.012 * (0.6 + 0.4 * Math.sin(t * 2));
            sc = [sa(x + off, y)[0], col[1], sa(x - off, y)[2]];
          } else if (surf === "glitch") {
            const slice = Math.floor(y * 16);
            const rnd = vnoise(slice * 3.1 + 0.5, Math.floor(t * 8) * 1.3 + 0.5);
            const dx = rnd > 0.62 ? (vnoise(slice + 9, Math.floor(t * 8)) - 0.5) * 0.14 : 0;
            const s2 = sa(x + dx, y);
            if (s2[3] <= 0.02) {
              out[k + 3] = 0;
              continue;
            }
            const scan = py % 3 === 0 ? 0.6 : 1;
            sc = [sa(x + dx + 0.01, y)[0] * scan, s2[1] * scan, sa(x + dx - 0.01, y)[2] * scan];
            a = s2[3];
          } else {
            const res = AURA[surf](base2[0], base2[1], base2[2], x, y, t, ctx);
            sc = [res[0], res[1], res[2]];
            a = aPal * res[3];
          }
          if (doTint && !NO_TINT.has(surf)) {
            sc = tintTo(sc, tintH, tintS);
          }
          let blended = blendCol(base2, sc, SURFACE_BLEND[surf] || "normal");
          if (amt.surf < 1) {
            blended = [mix(base2[0], blended[0], amt.surf), mix(base2[1], blended[1], amt.surf), mix(base2[2], blended[2], amt.surf)];
            a = mix(aPal, a, amt.surf);
          }
          col = blended;
        }
        out[k] = col[0] * 255;
        out[k + 1] = col[1] * 255;
        out[k + 2] = col[2] * 255;
        out[k + 3] = a * 255;
      } else if (aro) {
        const nx = (px + 0.5) / PW;
        const ny = (py + 0.5) / PH;
        const df = dist.d[py * PW + px];
        const res = AROUND[aro](nx, ny, df, t, ac);
        let rc = [res[0], res[1], res[2]];
        if (doTint && !NO_TINT.has(aro)) {
          rc = tintTo(rc, tintH, tintS);
        }
        out[k] = rc[0] * 255;
        out[k + 1] = rc[1] * 255;
        out[k + 2] = rc[2] * 255;
        out[k + 3] = res[3] * amt.aro * 255;
      } else {
        out[k + 3] = 0;
      }
    }
  }
}

// ---- gallery -----------------------------------------------------------------
const tiles = [];
const io = new IntersectionObserver(
  es =>
    es.forEach(e => {
      const t = tiles.find(x => x.el === e.target);
      if (t) {
        t.vis = e.isIntersecting;
      }
    }),
  { rootMargin: "150px" },
);
function mkTile(kind, name) {
  const el = document.createElement("div");
  el.className = `tile ${kind}`;
  const pill = PARTIAL.has(name) ? '<span class="pill">partial</span>' : "";
  const dotc = kind === "around" ? "aro" : kind === "surface" ? "aura" : "pal";
  el.innerHTML = `<div class="frame"><canvas></canvas></div>
    <div class="name"><span class="dot ${dotc}"></span>${name === "base" ? "Base" : LABELS[name]}${pill}</div>`;
  const cv = el.querySelector("canvas");
  const ctx = cv.getContext("2d");
  const slots =
    kind === "palette" ? { palette: name } : kind === "surface" ? { palette: "base", surface: name } : { around: name };
  el.addEventListener("click", () => setSlot(kind, name));
  const tile = { kind, name, slots, cv, ctx, img: null, el, vis: true };
  tiles.push(tile);
  io.observe(el);
  return el;
}
function buildGallery() {
  PALS.forEach(n => document.getElementById("palGrid").appendChild(mkTile("palette", n)));
  ALL_AURA.forEach(n => document.getElementById("surfGrid").appendChild(mkTile("surface", n)));
  ALL_AROUND.forEach(n => document.getElementById("aroGrid").appendChild(mkTile("around", n)));
  document.getElementById("palCount").textContent = ALL_PALETTE.length + 1;
  document.getElementById("surfCount").textContent = ALL_AURA.length;
  document.getElementById("aroCount").textContent = ALL_AROUND.length;
}
function resizeCanvases() {
  heroCv.width = PW;
  heroCv.height = PH;
  heroImg = heroCtx.createImageData(PW, PH);
  for (const t of tiles) {
    t.cv.width = PW;
    t.cv.height = PH;
    t.img = t.ctx.createImageData(PW, PH);
  }
}

// ---- state / hero ------------------------------------------------------------
const heroCv = document.getElementById("heroCanvas");
const heroCtx = heroCv.getContext("2d");
let heroImg = null;
const slots = { palette: "glacier", surface: "", around: "auroraveil" };
let speed = 1;
let palIntensity = 1;
let surfIntensity = 1;
let aroIntensity = 1;
let fxSeed = 0;
let fxScale = 1;
let fxColorMode = "default"; // default | palette | custom
let fxCustomH = 0.92;
let fxCustomS = 0.7;

const nameOf = kind => {
  const v = slots[kind];
  return !v || v === "base" ? "" : LABELS[v];
};
function refreshHero() {
  const parts = [nameOf("palette"), nameOf("surface"), nameOf("around")].filter(Boolean);
  document.getElementById("heroName").textContent = parts.length > 0 ? parts.join("  +  ") : "Base";
  document.querySelector(".stage .glow").style.background =
    `radial-gradient(circle, ${slots.around ? "#ffd27a" : slots.surface ? "#ff7ad9" : "#5ad1ff"}33, transparent 70%)`;
  for (const k of ["palette", "surface", "around"]) {
    document.getElementById("sel_" + k).value = slots[k];
  }
  tiles.forEach(t => t.el.classList.toggle("active", slots[t.kind] === t.name));
}
function setSlot(kind, name) {
  slots[kind] = name === slots[kind] && kind !== "palette" ? "" : name;
  refreshHero();
}

function wireControls() {
  for (const k of ["palette", "surface", "around"]) {
    const sel = document.getElementById("sel_" + k);
    if (k !== "palette") {
      sel.appendChild(new Option("None", ""));
    }
    SLOTKIND[k].forEach(n => sel.appendChild(new Option(n === "base" ? "Base (no palette)" : LABELS[n], n)));
    sel.addEventListener("change", e => {
      slots[k] = e.target.value;
      refreshHero();
    });
  }
  document.getElementById("speed").addEventListener("input", e => (speed = +e.target.value));
  document.getElementById("int_palette").addEventListener("input", e => (palIntensity = +e.target.value));
  document.getElementById("int_surface").addEventListener("input", e => (surfIntensity = +e.target.value));
  document.getElementById("int_around").addEventListener("input", e => (aroIntensity = +e.target.value));
  document.getElementById("seed").addEventListener("input", e => (fxSeed = +e.target.value));
  document.getElementById("texscale").addEventListener("input", e => (fxScale = +e.target.value));
  document.getElementById("seedRand").addEventListener("click", () => {
    fxSeed = Math.floor(Math.random() * 257);
    document.getElementById("seed").value = fxSeed;
  });
  document.querySelectorAll("#tintSeg button").forEach(btn =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#tintSeg button").forEach(x => x.classList.remove("on"));
      btn.classList.add("on");
      fxColorMode = btn.dataset.tint;
      document.getElementById("fxcolor").style.display = fxColorMode === "custom" ? "" : "none";
    }),
  );
  document.getElementById("fxcolor").addEventListener("input", e => {
    const h = e.target.value, hsv = rgb2hsv(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
    fxCustomH = hsv[0];
    fxCustomS = Math.max(0.5, hsv[1]);
    fxColorMode = "custom";
    document.querySelectorAll("#tintSeg button").forEach(x => x.classList.toggle("on", x.dataset.tint === "custom"));
    document.getElementById("fxcolor").style.display = "";
  });
  document.querySelectorAll("#bgSeg button").forEach(b =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#bgSeg button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      document.getElementById("stage").className = "stage " + b.dataset.bg;
    }),
  );
  document.getElementById("clear").addEventListener("click", () => {
    slots.palette = "base";
    slots.surface = "";
    slots.around = "";
    refreshHero();
  });
  document.getElementById("surprise").addEventListener("click", () => {
    const pick = a => a[Math.floor(Math.random() * a.length)];
    slots.palette = pick(ALL_PALETTE);
    slots.surface = Math.random() < 0.5 ? "" : pick(ALL_AURA);
    slots.around = Math.random() < 0.4 ? "" : pick(ALL_AROUND);
    refreshHero();
  });
}

// ---- species picker ----------------------------------------------------------
function pickSpecies(id) {
  loadSpecies(id)
    .then(() => {
      const s = SPECIES.find(x => x.i === id);
      document.getElementById("mon").value = s ? `${s.n} #${id}` : "#" + id;
    })
    .catch(() => status("#" + id + " not found"));
}
function stepSpecies(d) {
  const idx = SPECIES.findIndex(s => s.i === curSpecies);
  const n = (idx + d + SPECIES.length) % SPECIES.length;
  pickSpecies(SPECIES[n].i);
}
function buildPicker() {
  const dl = document.getElementById("monlist");
  SPECIES.forEach(s => dl.appendChild(new Option(`${s.n} #${s.i}`)));
  const inp = document.getElementById("mon");
  inp.addEventListener("change", () => {
    const m = inp.value.match(/#(\d+)/) || inp.value.match(/^\s*(\d+)\s*$/);
    const id = m ? +m[1] : (SPECIES.find(s => s.n.toLowerCase() === inp.value.trim().toLowerCase()) || {}).i;
    if (id) {
      pickSpecies(id);
    }
  });
  document.getElementById("monPrev").onclick = () => stepSpecies(-1);
  document.getElementById("monNext").onclick = () => stepSpecies(1);
  document.getElementById("monRand").onclick = () => pickSpecies(SPECIES[Math.floor(Math.random() * SPECIES.length)].i);
}

// ---- loop --------------------------------------------------------------------
let lastThumb = 0;
let rr = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (frameBuf.length === 0 || !heroImg || !tiles[0] || !tiles[0].img) {
    return;
  }
  setFxParams(fxSeed, fxScale);
  const t = now / 1000;
  const ai = Math.floor(t * 12) % frameBuf.length;
  const cur = frameBuf[ai];
  const ef = edgeFor(ai);
  const dist = distFor(ai);
  renderLook(slots, cur, ef, dist, t * speed, heroImg.data, { pal: palIntensity, surf: surfIntensity, aro: aroIntensity });
  heroCtx.putImageData(heroImg, 0, 0);
  if (now - lastThumb > 60) {
    lastThumb = now;
    const vis = tiles.filter(tl => tl.vis);
    const N = Math.min(vis.length, 16);
    for (let j = 0; j < N; j++) {
      const tl = vis[(rr + j) % vis.length];
      renderLook(tl.slots, cur, ef, dist, t, tl.img.data, { pal: 1, surf: 1, aro: 1 });
      tl.ctx.putImageData(tl.img, 0, 0);
    }
    rr = vis.length > 0 ? (rr + N) % vis.length : 0;
  }
}

// ---- boot --------------------------------------------------------------------
buildGallery();
wireControls();
buildPicker();
refreshHero();
pickSpecies(LAB.def);
requestAnimationFrame(loop);
