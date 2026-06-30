/* Fusion Lab - interactive UI (Unit 5, Phase 4). Wires the fusion STRATEGIES into a
 * live page: pick a head donor (A) + body donor (B), pick a strategy, tweak its params
 * with live sliders, and see the fused result + every pipeline debug layer. A/B-compare a
 * second strategy and batch-test the current strategy across a stress list of body plans.
 *
 * Unit 2 (sprite streaming from the er-assets CDN, searchable A/B pickers) is preserved
 * below and EXTENDED. The build (build-site.mjs) inlines fusion.mjs (export-stripped) ahead
 * of this script, so STRATEGIES / quantizeOklab / reconstructFrame / ... are real globals -
 * no imports. The strategies emit PLAIN rgba buffers; here we wrap them in `new ImageData(...)`
 * and `putImageData` onto native-res canvases that CSS upscales crisply (image-rendering:
 * pixelated). fuse() never throws (it falls back to recolor), but the draw path is guarded
 * anyway so a bad frame can never crash the page. */

const LAB = window.LAB;
const CDN = LAB.cdn;
const SPECIES = LAB.species;

// dex <-> name lookups (names are how the pickers search)
const nameByDex = new Map(SPECIES.map(s => [s.i, s.n]));
const dexByName = new Map(SPECIES.map(s => [s.n.toLowerCase(), s.i]));

// ---- sprite loading (CDN) ----------------------------------------------------
const sheet = document.createElement("canvas");
const sctx = sheet.getContext("2d", { willReadFrequently: true });

// TexturePacker atlases come either as { textures: [{ frames }] } or a flat
// { frames } (array or keyed object) - mirror the Shiny Lab's tolerant parse.
const parseFrames = a =>
  a.textures ? a.textures[0].frames : Array.isArray(a.frames) ? a.frames : Object.values(a.frames);

const loadImg = src =>
  new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = "anonymous"; // CDN is CORS-clean, so getImageData stays untainted
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

/* loadSpecies(dex) -> SpriteData = { dex, name, width, height, rgba }
 * Built from FRAME 0 of the species atlas. rgba is a Uint8ClampedArray of the full,
 * untrimmed sprite (width*height*4). The fetch/canvas plumbing mirrors the Shiny Lab
 * loader; the pure pixel reconstruction is delegated to reconstructFrame. */
async function loadSpecies(dex) {
  const base = `${CDN}/${dex}`;
  const atlas = await fetch(base + ".json").then(r => {
    if (!r.ok) {
      throw new Error("no atlas");
    }
    return r.json();
  });
  const f0 = parseFrames(atlas)[0];
  const img = await loadImg(base + ".png");
  sheet.width = img.width;
  sheet.height = img.height;
  sctx.clearRect(0, 0, img.width, img.height);
  sctx.drawImage(img, 0, 0);
  const atlasRGBA = sctx.getImageData(0, 0, img.width, img.height).data;
  const sourceSize = f0.sourceSize || { w: f0.frame.w, h: f0.frame.h };
  const spriteSourceSize = f0.spriteSourceSize || { x: 0, y: 0 };
  // reconstructFrame is defined in fusion.mjs, which build-site.mjs inlines (export-stripped)
  // ahead of this script in the built page, so it is a real global at runtime.
  // biome-ignore lint/correctness/noUndeclaredVariables: inlined global, see above
  const { width, height, rgba } = reconstructFrame(
    atlasRGBA,
    img.width,
    img.height,
    f0.frame,
    spriteSourceSize,
    sourceSize,
  );
  return { dex, name: nameByDex.get(dex) || "No. " + dex, width, height, rgba };
}

// loadSpeciesCached(dex) -> Promise<SpriteData>, memoised by dex (the cache stores the
// in-flight promise so concurrent requests dedupe; a failed load is evicted so it can retry).
const spriteCache = new Map();
function loadSpeciesCached(dex) {
  if (spriteCache.has(dex)) {
    return spriteCache.get(dex);
  }
  const p = loadSpecies(dex).catch(err => {
    spriteCache.delete(dex);
    throw err;
  });
  spriteCache.set(dex, p);
  return p;
}

// resolve a user-typed string (a species name, or anything containing a dex id) -> dex
const resolveDex = str => {
  const v = (str || "").trim();
  if (!v) {
    return null;
  }
  const byName = dexByName.get(v.toLowerCase());
  if (byName) {
    return byName;
  }
  const m = v.match(/(\d+)/);
  if (m && nameByDex.has(+m[1])) {
    return +m[1];
  }
  return null;
};

// ---- shared drawing helpers --------------------------------------------------

// paint a strategy result (or any { width, height, rgba }) onto a native-res canvas;
// CSS image-rendering:pixelated upscales it crisply. Guarded: a malformed/empty result
// blanks the canvas instead of throwing (ImageData() throws on a length mismatch).
function paintResult(canvas, result) {
  if (!result || !result.rgba || result.rgba.length !== result.width * result.height * 4) {
    canvas.width = 1;
    canvas.height = 1;
    return;
  }
  canvas.width = result.width;
  canvas.height = result.height;
  canvas
    .getContext("2d")
    .putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0);
}

const fmtNum = v => (typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(3)) : v);
function fmtMeta(meta) {
  if (!meta) {
    return "-";
  }
  return Object.entries(meta)
    .map(([k, v]) => `${k}: ${fmtNum(v)}`)
    .join("  ·  ");
}
const slug = s =>
  String(s || "A")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "a";

const defaultParams = strategy => {
  const o = {};
  for (const p of strategy.params || []) {
    o[p.key] = p.default;
  }
  return o;
};

// ---- A/B sides ---------------------------------------------------------------
const sides = {}; // "A" | "B" -> { dex, sprite, ctx, canvas, input, cap, baseCap }

function drawSprite(side, sprite) {
  const { canvas, ctx } = side;
  canvas.width = sprite.width;
  canvas.height = sprite.height; // native res; CSS image-rendering:pixelated upscales crisply
  ctx.putImageData(new ImageData(sprite.rgba, sprite.width, sprite.height), 0, 0);
}

const setStatus = (side, msg) => {
  if (side.cap) {
    side.cap.textContent = msg ? `${side.baseCap} - ${msg}` : side.baseCap;
  }
};

async function selectSide(key, dex, opts = {}) {
  const side = sides[key];
  setStatus(side, "loading #" + dex + " ...");
  try {
    const sprite = await loadSpeciesCached(dex);
    side.dex = dex;
    side.sprite = sprite;
    side.input.value = sprite.name;
    drawSprite(side, sprite);
    setStatus(side, sprite.name);
    if (opts.fuse !== false) {
      scheduleFuse();
    }
  } catch {
    setStatus(side, "#" + dex + " not found");
  }
}

function stepSide(key, d) {
  const cur = sides[key].dex;
  const idx = SPECIES.findIndex(s => s.i === cur);
  const n = (idx + d + SPECIES.length) % SPECIES.length;
  selectSide(key, SPECIES[n].i);
}

const randomDex = () => SPECIES[Math.floor(Math.random() * SPECIES.length)].i;

function setupSide(key) {
  const input = document.getElementById("mon" + key);
  const canvas = document.getElementById("canvas" + key);
  const cap = document.querySelector(".canvas-wrap." + key.toLowerCase() + " figcaption");
  sides[key] = {
    dex: null,
    sprite: null,
    canvas,
    ctx: canvas.getContext("2d"),
    input,
    cap,
    baseCap: cap ? cap.textContent : "",
  };
  // populate the datalist with searchable <option value="Name"> entries
  const dl = document.getElementById("monlist" + key);
  SPECIES.forEach(s => dl.appendChild(new Option(s.n, s.n)));
  // wire input + buttons
  input.addEventListener("change", () => {
    const id = resolveDex(input.value);
    if (id) {
      selectSide(key, id);
    }
  });
  document.getElementById("monPrev" + key).onclick = () => stepSide(key, -1);
  document.getElementById("monNext" + key).onclick = () => stepSide(key, 1);
  document.getElementById("monRand" + key).onclick = () => selectSide(key, randomDex());
}

// randPair: two random DIFFERENT species into A + B, loaded together, then a single fuse.
async function randomPair() {
  const a = randomDex();
  let b = randomDex();
  let guard = 0;
  while (b === a && SPECIES.length > 1 && guard++ < 24) {
    b = randomDex();
  }
  await Promise.all([selectSide("A", a, { fuse: false }), selectSide("B", b, { fuse: false })]);
  doFuse();
}

// ---- 4.1 strategy select + live params --------------------------------------
let currentStrategy = null;
const currentParams = {}; // identity is STABLE (mutated in place) so slider closures stay valid
let lastResult = null;
let fuseTimer = 0;

const strategySel = document.getElementById("strategy");
const paramsHost = document.getElementById("params");
const resultCanvas = document.getElementById("canvasResult");
let metaEl = null;
let paramSlidersEl = null;

function scheduleFuse() {
  clearTimeout(fuseTimer);
  fuseTimer = setTimeout(doFuse, 120); // debounce rapid slider drags (~120ms)
}

function setMeta(text) {
  if (metaEl) {
    metaEl.textContent = text;
  }
}

// build one labeled range slider per strategy.params[] entry, each with a live readout.
function buildParamSliders(strategy, paramsObj, host, onInput) {
  host.innerHTML = "";
  for (const pdef of strategy.params || []) {
    const row = document.createElement("div");
    row.className = "param-row";
    const lab = document.createElement("label");
    lab.className = "param-label";
    lab.textContent = pdef.label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = pdef.min;
    input.max = pdef.max;
    input.step = pdef.step;
    input.value = paramsObj[pdef.key];
    const val = document.createElement("span");
    val.className = "param-val";
    val.textContent = fmtNum(+input.value);
    input.addEventListener("input", () => {
      const v = +input.value;
      paramsObj[pdef.key] = v;
      val.textContent = fmtNum(v);
      onInput();
    });
    row.append(lab, input, val);
    host.appendChild(row);
  }
}

function setupStrategy() {
  // scaffold the params panel: a head (title + meta readout) + the sliders host.
  paramsHost.innerHTML =
    '<div class="params-head"><span class="params-title">Parameters</span>' +
    '<span id="metaStatus" class="meta-status">-</span></div>' +
    '<div id="paramSliders" class="param-sliders"></div>';
  metaEl = document.getElementById("metaStatus");
  paramSlidersEl = document.getElementById("paramSliders");

  STRATEGIES.forEach(s => strategySel.appendChild(new Option(s.label, s.id)));

  const applyStrategy = id => {
    currentStrategy = STRATEGIES.find(s => s.id === id) || STRATEGIES[0];
    for (const k of Object.keys(currentParams)) {
      delete currentParams[k];
    }
    Object.assign(currentParams, defaultParams(currentStrategy));
    buildParamSliders(currentStrategy, currentParams, paramSlidersEl, scheduleFuse);
    doFuse();
  };
  strategySel.addEventListener("change", e => applyStrategy(e.target.value));

  // initial (no fuse yet - sprites load during boot, which fires the first fuse)
  currentStrategy = STRATEGIES[0];
  strategySel.value = currentStrategy.id;
  Object.assign(currentParams, defaultParams(currentStrategy));
  buildParamSliders(currentStrategy, currentParams, paramSlidersEl, scheduleFuse);
}

// ---- 4.2 render the fusion ---------------------------------------------------
function doFuse() {
  const A = sides.A && sides.A.sprite;
  const B = sides.B && sides.B.sprite;
  if (!A || !B || !currentStrategy) {
    return;
  }
  let result;
  try {
    result = currentStrategy.fuse(A, B, currentParams);
  } catch (err) {
    lastResult = null;
    setMeta("fuse error: " + (err && err.message ? err.message : err));
    return;
  }
  lastResult = result;
  try {
    paintResult(resultCanvas, result); // A=head donor, B=body donor -> result
    setMeta(fmtMeta(result.meta));
    renderDebug(result.layers || []);
    renderCompare();
  } catch (err) {
    setMeta("draw error: " + (err && err.message ? err.message : err));
  }
}

// ---- 4.3 debug-layer grid ----------------------------------------------------
const debugEl = document.getElementById("debug");

function makeLayerTile(layer) {
  const fig = document.createElement("figure");
  fig.className = "dbg-tile";
  const frame = document.createElement("div");
  frame.className = "dbg-frame";
  const cv = document.createElement("canvas");
  cv.width = layer.width;
  cv.height = layer.height;
  if (layer.rgba && layer.rgba.length === layer.width * layer.height * 4) {
    cv.getContext("2d").putImageData(
      new ImageData(new Uint8ClampedArray(layer.rgba), layer.width, layer.height),
      0,
      0,
    );
  }
  // zoom each tile crisply: >=x3 for sprite-sized layers, capped so wide swatches stay sane.
  const zoom = 3;
  const maxW = 300;
  const dispW = Math.min(layer.width * zoom, maxW);
  cv.style.width = dispW + "px";
  cv.style.height = Math.max(1, Math.round((dispW * layer.height) / layer.width)) + "px";
  frame.appendChild(cv);
  const cap = document.createElement("figcaption");
  cap.textContent = layer.label;
  fig.append(frame, cap);
  return fig;
}

function renderDebug(layers) {
  debugEl.innerHTML = "";
  for (const layer of layers) {
    debugEl.appendChild(makeLayerTile(layer));
  }
}

// ---- 4.4 A/B compare ---------------------------------------------------------
const compareEl = document.getElementById("compare");
let cmpSel = null;
let cmpCvA = null;
let cmpCvB = null;
let cmpMetaA = null;
let cmpMetaB = null;
// the right panel only depends on (A, B, compare-strategy) - NOT on the live sliders -
// so cache it across slider drags.
let cmpRightCache = { key: null, res: null };

function setupCompare() {
  compareEl.innerHTML =
    '<div class="cmp-head"><span class="cmp-title">A/B compare</span>' +
    '<label class="cmp-lbl">vs</label><select id="cmpStrategy" class="cmp-sel"></select></div>' +
    '<div class="cmp-grid">' +
    '<figure class="cmp-cell"><div class="cmp-frame"><canvas id="cmpCvA"></canvas></div>' +
    '<figcaption id="cmpMetaA"></figcaption></figure>' +
    '<figure class="cmp-cell"><div class="cmp-frame"><canvas id="cmpCvB"></canvas></div>' +
    '<figcaption id="cmpMetaB"></figcaption></figure>' +
    "</div>";
  cmpSel = document.getElementById("cmpStrategy");
  cmpCvA = document.getElementById("cmpCvA");
  cmpCvB = document.getElementById("cmpCvB");
  cmpMetaA = document.getElementById("cmpMetaA");
  cmpMetaB = document.getElementById("cmpMetaB");
  STRATEGIES.forEach(s => cmpSel.appendChild(new Option(s.label, s.id)));
  // default the compare side to the OTHER strategy (eyeball recolor-vs-graft out of the box)
  cmpSel.value = (STRATEGIES[1] || STRATEGIES[0]).id;
  cmpSel.addEventListener("change", () => {
    cmpRightCache.key = null;
    renderCompare();
  });
}

function renderCompare() {
  if (!cmpCvA) {
    return;
  }
  const A = sides.A.sprite;
  const B = sides.B.sprite;
  if (!A || !B || !currentStrategy) {
    return;
  }
  // left = the current main result (current strategy + live params)
  paintResult(cmpCvA, lastResult);
  cmpMetaA.textContent = `${currentStrategy.label}  ·  ${fmtMeta(lastResult && lastResult.meta)}`;

  // right = the compare strategy at its defaults (cached by A/B/strategy)
  const cmpStrat = STRATEGIES.find(s => s.id === cmpSel.value) || currentStrategy;
  const key = `${A.dex}|${B.dex}|${cmpStrat.id}`;
  let right = cmpRightCache.key === key ? cmpRightCache.res : null;
  if (cmpRightCache.key !== key) {
    try {
      right = cmpStrat.fuse(A, B, defaultParams(cmpStrat));
    } catch (err) {
      right = null;
      cmpMetaB.textContent = `${cmpStrat.label}  ·  error: ${err && err.message ? err.message : err}`;
    }
    cmpRightCache = { key, res: right };
  }
  if (right) {
    paintResult(cmpCvB, right);
    cmpMetaB.textContent = `${cmpStrat.label}  ·  ${fmtMeta(right.meta)}`;
  }
}

// ---- 4.5 batch contact-sheet -------------------------------------------------
// stress list: ~12 diverse body plans (Pikachu, Charizard, Gyarados, Snorlax, Onix,
// Arcanine, Jigglypuff, Magneton, Scyther, Lapras, Gengar, Machamp).
const STRESS = [25, 6, 130, 143, 95, 59, 39, 82, 123, 131, 94, 68];
let batchBtn = null;
let downloadBtn = null;
let batchSheet = null;
let batchProgress = null;
let batchMaster = null; // last composed contact-sheet canvas (for Download PNG)
let batchRunning = false;

function setupBatch() {
  const toolbar = document.querySelector(".toolbar");
  batchBtn = document.createElement("button");
  batchBtn.id = "batchBtn";
  batchBtn.textContent = "Batch";
  downloadBtn = document.createElement("button");
  downloadBtn.id = "downloadBtn";
  downloadBtn.textContent = "Download PNG";
  downloadBtn.disabled = true;
  toolbar.append(batchBtn, downloadBtn);

  const section = document.createElement("section");
  section.id = "batch";
  section.className = "batch";
  section.innerHTML =
    '<div class="batch-head"><span class="batch-title">Batch contact sheet</span>' +
    '<span id="batchProgress" class="batch-progress"></span></div>' +
    '<div id="batchSheet" class="batch-sheet"></div>';
  compareEl.insertAdjacentElement("afterend", section);
  batchSheet = document.getElementById("batchSheet");
  batchProgress = document.getElementById("batchProgress");

  batchBtn.addEventListener("click", runBatch);
  downloadBtn.addEventListener("click", downloadBatch);
}

function makeBatchTile(name, res, isError) {
  const fig = document.createElement("figure");
  fig.className = "batch-tile";
  const frame = document.createElement("div");
  frame.className = "batch-frame";
  const cv = document.createElement("canvas");
  if (res && res.rgba && res.rgba.length === res.width * res.height * 4) {
    cv.width = res.width;
    cv.height = res.height;
    cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(res.rgba), res.width, res.height), 0, 0);
  } else {
    cv.width = 1;
    cv.height = 1;
  }
  frame.appendChild(cv);
  const cap = document.createElement("figcaption");
  const rung = res && res.meta && res.meta.rung ? res.meta.rung : isError ? "load fail" : "-";
  const nameEl = document.createElement("span");
  nameEl.className = "bt-name";
  nameEl.textContent = name;
  const rungEl = document.createElement("span");
  rungEl.className = "bt-rung";
  rungEl.textContent = rung;
  cap.append(nameEl, rungEl);
  fig.append(frame, cap);
  return fig;
}

// fix the current A as head donor, vary B across STRESS; render the current strategy across
// all pairs into the scrollable sheet. Async + yields so sprite loads never block the UI.
async function runBatch() {
  if (batchRunning) {
    return;
  }
  const A = sides.A.sprite;
  if (!A || !currentStrategy) {
    return;
  }
  batchRunning = true;
  batchBtn.disabled = true;
  downloadBtn.disabled = true;
  batchSheet.innerHTML = "";
  const list = STRESS.filter(d => nameByDex.has(d)); // only species the build actually has
  const cells = [];
  let i = 0;
  for (const dex of list) {
    i++;
    batchProgress.textContent = `fusing ${i}/${list.length} ...`;
    let B = null;
    try {
      B = await loadSpeciesCached(dex);
    } catch {
      B = null;
    }
    let res = null;
    if (B) {
      try {
        res = currentStrategy.fuse(A, B, currentParams);
      } catch (err) {
        res = null;
      }
    }
    const name = B ? B.name : nameByDex.get(dex) || "#" + dex;
    batchSheet.appendChild(makeBatchTile(name, res, !B));
    cells.push({ name, res });
    await new Promise(r => setTimeout(r, 0)); // yield to the event loop between sprites
  }
  batchProgress.textContent = `done - ${cells.length} fusions`;
  batchMaster = composeMaster(cells, A);
  downloadBtn.disabled = cells.length === 0;
  batchBtn.disabled = false;
  batchRunning = false;
}

// compose every batch cell into ONE labeled canvas for Download PNG (imageSmoothing off so
// the nearest-neighbour upscale stays crisp).
function composeMaster(cells, A) {
  const ZOOM = 2;
  const pad = 8;
  const labelH = 16;
  const titleH = 22;
  let mw = 1;
  let mh = 1;
  for (const c of cells) {
    if (c.res) {
      mw = Math.max(mw, c.res.width);
      mh = Math.max(mh, c.res.height);
    }
  }
  const cellW = mw * ZOOM + pad * 2;
  const cellH = mh * ZOOM + pad + labelH;
  const cols = Math.min(4, Math.max(1, cells.length));
  const rows = Math.ceil(cells.length / cols);
  const cv = document.createElement("canvas");
  cv.width = cols * cellW;
  cv.height = titleH + rows * cellH + pad;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0b0d16";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#e8ecf6";
  ctx.font = "13px Segoe UI, sans-serif";
  ctx.fillText(`head: ${A.name}  -  ${currentStrategy.label}`, pad, 15);
  cells.forEach((c, idx) => {
    const cx = (idx % cols) * cellW;
    const cy = titleH + Math.floor(idx / cols) * cellH;
    if (c.res && c.res.rgba && c.res.rgba.length === c.res.width * c.res.height * 4) {
      const tmp = document.createElement("canvas");
      tmp.width = c.res.width;
      tmp.height = c.res.height;
      tmp
        .getContext("2d")
        .putImageData(new ImageData(new Uint8ClampedArray(c.res.rgba), c.res.width, c.res.height), 0, 0);
      ctx.drawImage(tmp, cx + pad, cy + pad, c.res.width * ZOOM, c.res.height * ZOOM);
    }
    ctx.fillStyle = "#9aa3b8";
    ctx.font = "11px Segoe UI, sans-serif";
    const rung = c.res && c.res.meta && c.res.meta.rung ? c.res.meta.rung : "-";
    ctx.fillText(`${c.name} [${rung}]`, cx + pad, cy + cellH - 4, cellW - pad * 2);
  });
  return cv;
}

function downloadBatch() {
  if (!batchMaster) {
    return;
  }
  batchMaster.toBlob(blob => {
    if (!blob) {
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contact-${slug(sides.A.sprite ? sides.A.sprite.name : "A")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
}

// ---- boot --------------------------------------------------------------------
setupSide("A");
setupSide("B");
setupStrategy();
setupCompare();
setupBatch();
document.getElementById("fuseBtn").addEventListener("click", doFuse);
document.getElementById("randPair").addEventListener("click", randomPair);

const defA = LAB.def;
const defB = nameByDex.has(130) && defA !== 130 ? 130 : (SPECIES.find(s => s.i !== defA) || SPECIES[0]).i;
Promise.all([selectSide("A", defA, { fuse: false }), selectSide("B", defB, { fuse: false })]).then(doFuse);
