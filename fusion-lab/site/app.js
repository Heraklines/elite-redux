/* Fusion Lab - live A/B preview (Unit 2, Phase 1). Sprites stream from the er-assets
 * CDN (jsDelivr, pinned sha) exactly like the game and the Shiny Lab: fetch the
 * TexturePacker atlas JSON + PNG, draw the sheet to an offscreen canvas, and rebuild
 * frame 0 with the pure `reconstructFrame` (inlined from fusion.mjs in the built page).
 * Two searchable pickers (A = head donor, B = body donor) each drive a native-res canvas
 * upscaled with CSS image-rendering:pixelated. The fusion step lands in a later unit. */

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

// ---- A/B sides ---------------------------------------------------------------
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

async function selectSide(key, dex) {
  const side = sides[key];
  setStatus(side, "loading #" + dex + " ...");
  try {
    const sprite = await loadSpecies(dex);
    side.dex = dex;
    side.sprite = sprite;
    side.input.value = sprite.name;
    drawSprite(side, sprite);
    setStatus(side, sprite.name);
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

// ---- boot --------------------------------------------------------------------
setupSide("A");
setupSide("B");

const defA = LAB.def;
const defB = nameByDex.has(130) && defA !== 130 ? 130 : (SPECIES.find(s => s.i !== defA) || SPECIES[0]).i;
selectSide("A", defA);
selectSide("B", defB);
