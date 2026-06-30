import assert from "node:assert/strict";
import test from "node:test";
import { STRATEGIES } from "../fusion.mjs";
import { morphStrategy } from "./morph.mjs";

// ---- synthetic SpriteData fixtures ----------------------------------------
const spriteOf = (rgba, width, height, dex = 1) => ({ dex, name: "test", width, height, rgba });

// filled axis-aligned ellipse: rx/ry half-axes about (cx,cy), one flat colour.
function ellipseSprite(w, h, cx, cy, rx, ry, [r, g, b]) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1) {
        const i = (y * w + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    }
  }
  return spriteOf(rgba, w, h);
}

function emptySprite(w, h) {
  return spriteOf(new Uint8ClampedArray(w * h * 4), w, h);
}

function singlePixelSprite(w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const i = ((((h / 2) | 0) * w + ((w / 2) | 0)) * 4);
  rgba[i] = 200;
  rgba[i + 1] = 40;
  rgba[i + 2] = 40;
  rgba[i + 3] = 255;
  return spriteOf(rgba, w, h);
}

const countOpaque = rgba => {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 24) {
      n++;
    }
  }
  return n;
};

// A: a TALL ellipse (vertical PCA axis), warm. B: a WIDE ellipse, cool.
const tallA = () => ellipseSprite(24, 24, 12, 12, 5, 10, [220, 70, 60]);
const wideB = () => ellipseSprite(24, 24, 12, 12, 10, 5, [60, 90, 220]);

test("morph: self-registers into the shared STRATEGIES registry", () => {
  assert.ok(Array.isArray(STRATEGIES));
  assert.ok(STRATEGIES.includes(morphStrategy), "strategy object is in STRATEGIES");
  const found = STRATEGIES.find(s => s.id === "morph");
  assert.equal(found, morphStrategy);
  assert.equal(found.label, "Silhouette morph");
  assert.equal(typeof found.fuse, "function");
  assert.ok(Array.isArray(found.params) && found.params.length === 3);
  assert.deepEqual(found.params.map(p => p.key), ["blend", "nPoints", "crisp"]);
});

test("morph: fuse(a,b) returns a NEW shape with opaque pixels + all 7 layers + meta", () => {
  const res = morphStrategy.fuse(tallA(), wideB(), { blend: 0.5, nPoints: 96, crisp: 1 });

  assert.ok(Number.isInteger(res.width) && res.width > 0);
  assert.ok(Number.isInteger(res.height) && res.height > 0);
  assert.ok(res.rgba instanceof Uint8ClampedArray);
  assert.equal(res.rgba.length, res.width * res.height * 4);

  const opaque = countOpaque(res.rgba);
  assert.ok(opaque > 0, `expected opaque pixels, got ${opaque}`);

  assert.ok(Array.isArray(res.layers));
  const labels = res.layers.map(l => l.label);
  for (const want of ["contourA", "contourB", "correspondence", "meanShape", "warpedA", "warpedB", "final"]) {
    assert.ok(labels.includes(want), `missing layer "${want}" (got ${labels.join(", ")})`);
  }
  for (const l of res.layers) {
    assert.ok(l.rgba instanceof Uint8ClampedArray);
    assert.equal(l.rgba.length, l.width * l.height * 4, `layer ${l.label} rgba size`);
  }

  assert.ok(res.meta);
  assert.equal(res.meta.rung, "morph");
  assert.equal(res.meta.blend, 0.5);
  assert.equal(res.meta.nPoints, 96);
});

test("morph: produces a GENUINELY blended shape, not a copy of B (or A)", () => {
  const a = tallA();
  const b = wideB();
  const res = morphStrategy.fuse(a, b, { blend: 0.5, nPoints: 96, crisp: 1 });

  // result is its own buffer
  assert.notEqual(res.rgba, a.rgba);
  assert.notEqual(res.rgba, b.rgba);

  // the morphed silhouette must differ from B's raw pixels (it is a new shape /
  // re-rendered in the normalized frame). Compare opaque-pixel counts: a 50/50
  // meld of a tall and a wide ellipse should NOT match B's area exactly.
  const opaque = countOpaque(res.rgba);
  const bOpaque = countOpaque(b.rgba);
  assert.notEqual(opaque, bOpaque, "morph area equals B area => suspiciously a passthrough");

  // sanity: a meaningful chunk of the canvas is filled (not a stray speck)
  assert.ok(opaque > 20, `morph silhouette too small: ${opaque}px`);
});

test("morph: blend endpoints t=0 and t=1 both yield valid, non-empty results", () => {
  for (const blend of [0, 1]) {
    const res = morphStrategy.fuse(tallA(), wideB(), { blend, nPoints: 64, crisp: 0.5 });
    assert.ok(countOpaque(res.rgba) > 0, `blend=${blend} produced empty result`);
    assert.ok(["morph", "fallback"].includes(res.meta.rung));
  }
});

test("morph: clamps out-of-range params instead of throwing", () => {
  // nPoints below the slider min, blend/crisp out of [0,1]
  const res = morphStrategy.fuse(tallA(), wideB(), { blend: 5, nPoints: 1, crisp: -3 });
  assert.ok(res.rgba instanceof Uint8ClampedArray);
  assert.ok(res.meta);
  if (res.meta.rung === "morph") {
    assert.ok(res.meta.nPoints >= 16, "nPoints clamped to >= 16");
    assert.ok(res.meta.blend >= 0 && res.meta.blend <= 1, "blend clamped to [0,1]");
  }
});

test("morph: NEVER throws on degenerate input, falls back to B unchanged", () => {
  const valid = wideB();

  // empty A
  let res = morphStrategy.fuse(emptySprite(24, 24), valid);
  assert.equal(res.width, valid.width);
  assert.equal(res.height, valid.height);
  assert.deepEqual([...res.rgba], [...valid.rgba], "empty-A fallback returns B unchanged");
  assert.equal(res.meta.rung, "fallback");
  assert.ok(typeof res.meta.reason === "string" && res.meta.reason.length > 0);
  assert.ok(Array.isArray(res.layers) && res.layers.length >= 1);

  // empty B (fallback returns B, which is legitimately empty -> 0 opaque, no throw)
  res = morphStrategy.fuse(valid, emptySprite(24, 24));
  assert.equal(res.meta.rung, "fallback");
  assert.equal(countOpaque(res.rgba), 0);

  // single-pixel A and single-pixel B
  res = morphStrategy.fuse(singlePixelSprite(24, 24), valid);
  assert.equal(res.meta.rung, "fallback");
  res = morphStrategy.fuse(valid, singlePixelSprite(24, 24));
  assert.equal(res.meta.rung, "fallback");

  // both empty
  res = morphStrategy.fuse(emptySprite(10, 10), emptySprite(10, 10));
  assert.equal(res.meta.rung, "fallback");
  assert.equal(countOpaque(res.rgba), 0);

  // 1x1 canvases (extreme degenerate)
  res = morphStrategy.fuse(spriteOf(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1), valid);
  assert.equal(res.meta.rung, "fallback");
});

test("morph: does not mutate the input sprite buffers", () => {
  const a = tallA();
  const b = wideB();
  const aCopy = Uint8ClampedArray.from(a.rgba);
  const bCopy = Uint8ClampedArray.from(b.rgba);
  morphStrategy.fuse(a, b, { blend: 0.5, nPoints: 96, crisp: 1 });
  assert.deepEqual([...a.rgba], [...aCopy], "A buffer mutated");
  assert.deepEqual([...b.rgba], [...bCopy], "B buffer mutated");
});
