import assert from "node:assert/strict";
import test from "node:test";
import { STRATEGIES } from "../fusion.mjs";
import { signatureStrategy } from "./signature.mjs";

// ---- synthetic SpriteData fixtures ---------------------------------------

const spriteOf = (rgba, width, height, dex = 1) => ({ dex, name: "test", width, height, rgba });

function blank(w, h) {
  return spriteOf(new Uint8ClampedArray(w * h * 4), w, h);
}

function setPx(s, x, y, [r, g, b, a]) {
  const i = (y * s.width + x) * 4;
  s.rgba[i] = r;
  s.rgba[i + 1] = g;
  s.rgba[i + 2] = b;
  s.rgba[i + 3] = a;
}

function fillRect(s, x0, y0, x1, y1, col) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      setPx(s, x, y, col);
    }
  }
}

function countOpaque(rgba) {
  let n = 0;
  for (let p = 0; p < rgba.length / 4; p++) {
    if (rgba[p * 4 + 3] > 24) {
      n++;
    }
  }
  return n;
}

// b = plain neutral-grey blob (a filled square body)
function makeBodyB(w = 32, h = 32) {
  const b = blank(w, h);
  fillRect(b, 10, 11, 22, 24, [120, 120, 120, 255]);
  return b;
}

// a = blue body blob with a vivid RED spike protruding out the TOP
//   - the spike is thin + long  -> silhouette protrusion
//   - red vs blue body          -> high-chroma accent
function makeDonorA(w = 32, h = 32) {
  const a = blank(w, h);
  fillRect(a, 10, 12, 22, 25, [48, 120, 196, 255]); // blue body
  fillRect(a, 15, 3, 17, 12, [224, 40, 40, 255]); // red spike out the top
  return a;
}

// ---- tests ---------------------------------------------------------------

test("signature: self-registers into the shared STRATEGIES registry", () => {
  assert.ok(Array.isArray(STRATEGIES));
  assert.ok(STRATEGIES.includes(signatureStrategy), "strategy is in STRATEGIES");
  const found = STRATEGIES.find(s => s.id === "signature");
  assert.equal(found, signatureStrategy);
  assert.equal(found.label, "Signature-graft");
  assert.equal(typeof found.fuse, "function");
  // params: tint, featureCount, featureScale
  const keys = found.params.map(p => p.key);
  assert.deepEqual(keys, ["tint", "featureCount", "featureScale"]);
  for (const p of found.params) {
    assert.equal(typeof p.default, "number");
    assert.ok(p.min <= p.default && p.default <= p.max);
  }
});

test("signature: fuse returns B-dimensioned result with opaque px, layers, meta", () => {
  const a = makeDonorA();
  const b = makeBodyB();
  const res = signatureStrategy.fuse(a, b, { tint: 0.5, featureCount: 3, featureScale: 1 });

  // dims track B exactly
  assert.equal(res.width, b.width);
  assert.equal(res.height, b.height);
  assert.ok(res.rgba instanceof Uint8ClampedArray);
  assert.equal(res.rgba.length, b.width * b.height * 4);
  assert.ok(countOpaque(res.rgba) > 0, "result has opaque pixels");

  // the six documented layers, all B/A sized
  assert.ok(Array.isArray(res.layers));
  const labels = res.layers.map(l => l.label);
  for (const want of ["bBase", "bRecolored", "aProtrusions", "aAccents", "placedSignature", "final"]) {
    assert.ok(labels.includes(want), `layer ${want} present`);
  }
  for (const l of res.layers) {
    assert.ok(l.rgba instanceof Uint8ClampedArray);
    assert.equal(l.rgba.length, l.width * l.height * 4);
  }

  // meta
  assert.equal(res.meta.rung, "signature");
  assert.equal(typeof res.meta.nFeatures, "number");
  assert.ok(res.meta.nFeatures >= 0);
});

test("signature: recolor actually changes B's body colours", () => {
  const a = makeDonorA();
  const b = makeBodyB();
  const res = signatureStrategy.fuse(a, b, { tint: 0.6, featureCount: 3, featureScale: 1 });

  const recolored = res.layers.find(l => l.label === "bRecolored").rgba;
  let changed = 0;
  for (let p = 0; p < b.width * b.height; p++) {
    if (b.rgba[p * 4 + 3] > 24) {
      const i = p * 4;
      if (
        recolored[i] !== b.rgba[i] ||
        recolored[i + 1] !== b.rgba[i + 1] ||
        recolored[i + 2] !== b.rgba[i + 2]
      ) {
        changed++;
      }
    }
  }
  assert.ok(changed > 0, "recolor moved at least one body pixel's colour");
});

test("signature: B's silhouette is preserved and the graft adds pixels", () => {
  const a = makeDonorA();
  const b = makeBodyB();
  const res = signatureStrategy.fuse(a, b, { tint: 0.5, featureCount: 3, featureScale: 1 });

  // every original B body pixel is still opaque in the result (silhouette intact)
  let bodyKept = true;
  for (let p = 0; p < b.width * b.height; p++) {
    if (b.rgba[p * 4 + 3] > 24 && res.rgba[p * 4 + 3] <= 24) {
      bodyKept = false;
      break;
    }
  }
  assert.ok(bodyKept, "B's body pixels remain opaque (silhouette preserved)");

  // grafting at least one signature feature => more opaque px than the plain body
  assert.ok(res.meta.nFeatures >= 1, "detected + placed at least one signature bit");
  assert.ok(
    countOpaque(res.rgba) > countOpaque(b.rgba),
    "graft adds signature pixels outside B's body",
  );
});

test("signature: never throws on degenerate input (empty A, empty B, mismatched dims)", () => {
  const emptyA = blank(16, 16);
  const emptyB = blank(20, 12);
  const realA = makeDonorA();
  const realB = makeBodyB();

  // empty donor -> graceful fallback, B-dimensioned, no throw
  const r1 = signatureStrategy.fuse(emptyA, realB, {});
  assert.equal(r1.width, realB.width);
  assert.equal(r1.height, realB.height);
  assert.ok(r1.rgba instanceof Uint8ClampedArray);
  assert.equal(r1.meta.rung, "fallback");

  // empty body
  const r2 = signatureStrategy.fuse(realA, emptyB, {});
  assert.equal(r2.width, emptyB.width);
  assert.equal(r2.height, emptyB.height);
  assert.equal(r2.meta.rung, "fallback");

  // both empty
  const r3 = signatureStrategy.fuse(emptyA, emptyB, {});
  assert.equal(r3.meta.rung, "fallback");

  // mismatched dims, no params object at all
  const r4 = signatureStrategy.fuse(makeDonorA(24, 24), makeBodyB(40, 28));
  assert.equal(r4.width, 40);
  assert.equal(r4.height, 28);
  assert.ok(r4.rgba instanceof Uint8ClampedArray);
});

test("signature: B unchanged when A == B is impossible here, but tint=0 keeps body colour", () => {
  const a = makeDonorA();
  const b = makeBodyB();
  const res = signatureStrategy.fuse(a, b, { tint: 0, featureCount: 2, featureScale: 1 });
  const recolored = res.layers.find(l => l.label === "bRecolored").rgba;
  // tint 0 -> no chroma move -> body colours identical to B
  for (let p = 0; p < b.width * b.height; p++) {
    if (b.rgba[p * 4 + 3] > 24) {
      const i = p * 4;
      assert.equal(recolored[i], b.rgba[i]);
      assert.equal(recolored[i + 1], b.rgba[i + 1]);
      assert.equal(recolored[i + 2], b.rgba[i + 2]);
    }
  }
});
