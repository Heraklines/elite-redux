import assert from "node:assert/strict";
import test from "node:test";
import { STRATEGIES } from "../fusion.mjs";
import { bandswapStrategy } from "./bandswap.mjs";

// ---- synthetic SpriteData fixtures (upright "creature" shapes: head-on-top
// joined to a body by a thin neck pinch) ---------------------------------------

const spriteOf = (rgba, width, height, dex = 1) => ({ dex, name: "test", width, height, rgba });

function paintRect(rgba, w, x0, y0, x1, y1, [r, g, b], a = 255) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
}

function makeSprite(w, h, rects) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (const [x0, y0, x1, y1, color] of rects) {
    paintRect(rgba, w, x0, y0, x1, y1, color);
  }
  return spriteOf(rgba, w, h);
}

const opaqueCount = (rgba, w, h) => {
  let n = 0;
  for (let p = 0; p < w * h; p++) {
    if (rgba[p * 4 + 3] > 24) {
      n++;
    }
  }
  return n;
};

// HEAD donor A: wide head on top, thin neck (~y 11-16), red body. Neck pinch is
// in the upper [0.2,0.55] bbox band so it is the search-window width minimum.
function makeHeadDonor() {
  return makeSprite(24, 32, [
    [6, 16, 17, 29, [160, 80, 80]], // body
    [10, 11, 13, 16, [160, 80, 80]], // neck (~4px wide)
    [7, 2, 16, 10, [210, 110, 110]], // head
    [9, 5, 10, 6, [20, 20, 24]], // eye (interior ink)
    [13, 5, 14, 6, [20, 20, 24]], // eye
  ]);
}

// BODY donor B: green torso + small head, thin neck (~y 8-13).
function makeBody() {
  return makeSprite(24, 32, [
    [6, 14, 17, 29, [70, 130, 70]], // torso
    [10, 8, 13, 13, [70, 130, 70]], // neck
    [8, 2, 15, 8, [90, 160, 90]], // head blob
    [8, 2, 15, 2, [20, 20, 24]], // dark cap (ink)
  ]);
}

const EXPECTED_LAYERS = ["aNeck", "bNeck", "headBand", "bodyBand", "seam", "final"];

// ---------------------------------------------------------------------------

test("bandswap: self-registers into the shared STRATEGIES registry with the contract shape", () => {
  assert.ok(Array.isArray(STRATEGIES));
  assert.ok(STRATEGIES.includes(bandswapStrategy), "strategy is in STRATEGIES");
  const found = STRATEGIES.find(s => s.id === "bandswap");
  assert.equal(found, bandswapStrategy);
  assert.equal(found.label, "Band-swap (IF autogen)");
  assert.equal(typeof found.fuse, "function");

  // params are well-formed numeric sliders with the documented defaults
  assert.ok(Array.isArray(found.params));
  const byKey = Object.fromEntries(found.params.map(p => [p.key, p]));
  assert.deepEqual(Object.keys(byKey).sort(), ["harmonize", "neckSearchHi", "neckSearchLo", "seamPx"]);
  assert.equal(byKey.neckSearchLo.default, 0.2);
  assert.equal(byKey.neckSearchHi.default, 0.55);
  assert.equal(byKey.harmonize.default, 0.4);
  assert.equal(byKey.seamPx.default, 2);
  for (const p of found.params) {
    assert.equal(typeof p.label, "string");
    for (const f of ["min", "max", "step", "default"]) {
      assert.equal(typeof p[f], "number", `param ${p.key}.${f}`);
    }
  }
});

test("bandswap: fuse(headDonor, body) returns a valid FusionResult with >0 opaque px, all layers, band meta", () => {
  const a = makeHeadDonor();
  const b = makeBody();

  let res;
  assert.doesNotThrow(() => {
    res = bandswapStrategy.fuse(a, b, { neckSearchLo: 0.2, neckSearchHi: 0.55, harmonize: 0.4, seamPx: 2 });
  });

  // dims: width tracks B (body frame); height = head band + body band, fits both
  assert.equal(typeof res.width, "number");
  assert.equal(typeof res.height, "number");
  assert.equal(res.width, b.width);
  assert.ok(res.height > 0);
  assert.ok(res.rgba instanceof Uint8ClampedArray);
  assert.equal(res.rgba.length, res.width * res.height * 4);
  assert.ok(opaqueCount(res.rgba, res.width, res.height) > 0, "result has opaque pixels");

  // one debug layer per stage, each a correctly-sized rgba buffer
  assert.ok(Array.isArray(res.layers));
  assert.deepEqual(res.layers.map(l => l.label), EXPECTED_LAYERS);
  for (const l of res.layers) {
    assert.ok(l.rgba instanceof Uint8ClampedArray, `${l.label} rgba`);
    assert.equal(l.rgba.length, l.width * l.height * 4, `${l.label} size`);
  }

  // meta: band rung, neck rows within their search windows, finite positive scale
  assert.equal(res.meta.rung, "band");
  assert.equal(typeof res.meta.scale, "number");
  assert.ok(Number.isFinite(res.meta.scale) && res.meta.scale > 0, "scale finite > 0");
  // A neck pinch (~y 11-16) and B neck pinch (~y 8-13) land in the upper band
  assert.ok(res.meta.aNeckY >= 6 && res.meta.aNeckY <= 18, `aNeckY=${res.meta.aNeckY}`);
  assert.ok(res.meta.bNeckY >= 5 && res.meta.bNeckY <= 16, `bNeckY=${res.meta.bNeckY}`);
});

test("bandswap: the result actually mixes A's head tones over B's body region (not a passthrough)", () => {
  const a = makeHeadDonor();
  const b = makeBody();
  const res = bandswapStrategy.fuse(a, b);

  // sample the top rows (head band) - they should carry opaque (grafted-head) pixels
  let headPx = 0;
  for (let y = 0; y < Math.min(6, res.height); y++) {
    for (let x = 0; x < res.width; x++) {
      if (res.rgba[(y * res.width + x) * 4 + 3] > 24) {
        headPx++;
      }
    }
  }
  assert.ok(headPx > 0, "head band produced opaque pixels near the top of the canvas");

  // the head band debug layer is non-empty (head was extracted + placed)
  const headBand = res.layers.find(l => l.label === "headBand");
  assert.ok(opaqueCount(headBand.rgba, headBand.width, headBand.height) > 0, "headBand layer non-empty");
  const bodyBand = res.layers.find(l => l.label === "bodyBand");
  assert.ok(opaqueCount(bodyBand.rgba, bodyBand.width, bodyBand.height) > 0, "bodyBand layer non-empty");
});

test("bandswap: seamPx=0 (hard seam) still returns a valid result", () => {
  const a = makeHeadDonor();
  const b = makeBody();
  let res;
  assert.doesNotThrow(() => {
    res = bandswapStrategy.fuse(a, b, { seamPx: 0 });
  });
  assert.equal(res.meta.rung, "band");
  assert.ok(opaqueCount(res.rgba, res.width, res.height) > 0);
});

test("bandswap: degenerate inputs never throw and return a structurally valid result", () => {
  const a = makeHeadDonor();
  const b = makeBody();
  const emptyA = spriteOf(new Uint8ClampedArray(24 * 32 * 4), 24, 32);
  const emptyB = spriteOf(new Uint8ClampedArray(24 * 32 * 4), 24, 32);
  const tiny = spriteOf(new Uint8ClampedArray(1 * 1 * 4).fill(255), 1, 1);

  const cases = [
    ["empty A", emptyA, b],
    ["empty B", a, emptyB],
    ["both empty", emptyA, emptyB],
    ["tiny A", tiny, b],
    ["tiny B", a, tiny],
    ["tiny both", tiny, tiny],
  ];

  for (const [name, ha, bo] of cases) {
    let res;
    assert.doesNotThrow(() => {
      res = bandswapStrategy.fuse(ha, bo);
    }, `${name} must not throw`);
    assert.equal(typeof res.width, "number", name);
    assert.equal(typeof res.height, "number", name);
    assert.ok(res.rgba instanceof Uint8ClampedArray, name);
    assert.equal(res.rgba.length, res.width * res.height * 4, name);
    assert.ok(Array.isArray(res.layers) && res.layers.length >= 1, name);
    assert.ok(typeof res.meta.rung === "string", name);
  }
});

test("bandswap: empty A / empty B fall back to B unchanged with meta.rung='fallback'", () => {
  const a = makeHeadDonor();
  const b = makeBody();
  const emptyA = spriteOf(new Uint8ClampedArray(24 * 32 * 4), 24, 32);

  const res = bandswapStrategy.fuse(emptyA, b);
  assert.equal(res.meta.rung, "fallback");
  assert.equal(typeof res.meta.reason, "string");
  // returns B unchanged (B's dims + pixels)
  assert.equal(res.width, b.width);
  assert.equal(res.height, b.height);
  assert.deepEqual([...res.rgba], [...b.rgba], "fallback returns B's pixels unchanged");
});

test("bandswap: harmonize=0 leaves head tones untouched relative to harmonize=1 (param wired)", () => {
  const a = makeHeadDonor();
  const b = makeBody();
  const r0 = bandswapStrategy.fuse(a, b, { harmonize: 0 });
  const r1 = bandswapStrategy.fuse(a, b, { harmonize: 1 });
  assert.equal(r0.meta.rung, "band");
  assert.equal(r1.meta.rung, "band");
  // the two head bands should differ once harmonization is fully applied
  const hb0 = r0.layers.find(l => l.label === "headBand").rgba;
  const hb1 = r1.layers.find(l => l.label === "headBand").rgba;
  let differ = false;
  for (let i = 0; i < hb0.length && !differ; i += 4) {
    if (hb0[i + 3] > 24 && (hb0[i] !== hb1[i] || hb0[i + 1] !== hb1[i + 1] || hb0[i + 2] !== hb1[i + 2])) {
      differ = true;
    }
  }
  assert.ok(differ, "harmonize=1 recolors the head toward B's palette vs harmonize=0");
});
