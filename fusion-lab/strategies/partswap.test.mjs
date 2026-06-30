import assert from "node:assert/strict";
import test from "node:test";
import { STRATEGIES } from "../fusion.mjs";
import { partswapStrategy } from "./partswap.mjs";

// ---- synthetic SpriteData fixtures ---------------------------------------

const spriteOf = (rgba, width, height, dex = 1, name = "test") => ({ dex, name, width, height, rgba });
const blank = (w, h) => new Uint8ClampedArray(w * h * 4);

function put(rgba, w, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0) {
    return;
  }
  const i = (y * w + x) * 4;
  if (i + 3 >= rgba.length) {
    return;
  }
  rgba[i] = r;
  rgba[i + 1] = g;
  rgba[i + 2] = b;
  rgba[i + 3] = a;
}

function disc(rgba, w, cx, cy, r, color) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        put(rgba, w, x, y, color);
      }
    }
  }
}

function rect(rgba, w, x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      put(rgba, w, x, y, color);
    }
  }
}

const countOpaque = (rgba, thresh = 24) => {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > thresh) {
      n++;
    }
  }
  return n;
};

// B = BODY donor: blue head disc + thin neck (the pinch) + wide torso.
function makeBody() {
  const w = 32;
  const h = 44;
  const rgba = blank(w, h);
  const body = [60, 140, 200, 255];
  rect(rgba, w, 8, 18, 23, 40, body); // torso
  rect(rgba, w, 14, 14, 17, 18, body); // thin neck (pinch)
  disc(rgba, w, 16, 9, 6, [60, 110, 220, 255]); // head
  return spriteOf(rgba, w, h, 2, "body");
}

// A = HEAD donor: distinct orange head disc + neck + green body.
function makeHeadDonor() {
  const w = 32;
  const h = 44;
  const rgba = blank(w, h);
  rect(rgba, w, 6, 20, 25, 42, [60, 200, 90, 255]); // body (discarded)
  rect(rgba, w, 13, 16, 18, 20, [210, 150, 60, 255]); // neck
  disc(rgba, w, 16, 9, 7, [230, 140, 40, 255]); // distinct head
  return spriteOf(rgba, w, h, 3, "head");
}

const EXPECTED_LAYERS = ["bSocket", "aHead", "bBody", "placedHead", "harmonized", "final"];

// ---- tests ----------------------------------------------------------------

test("partswap: self-registers into the shared STRATEGIES registry", () => {
  assert.ok(Array.isArray(STRATEGIES));
  assert.ok(STRATEGIES.includes(partswapStrategy), "strategy is in STRATEGIES");
  const found = STRATEGIES.find(s => s.id === "partswap");
  assert.equal(found, partswapStrategy);
  assert.equal(found.label, "Part-swap (cut+blend)");
  assert.equal(typeof found.fuse, "function");
  assert.equal(found.params.length, 5);
  for (const p of found.params) {
    for (const key of ["key", "label", "min", "max", "step", "default"]) {
      assert.ok(key in p, `param missing ${key}`);
    }
  }
});

test("partswap: fuse returns a well-formed FusionResult on real fixtures", () => {
  const a = makeHeadDonor();
  const b = makeBody();
  const res = partswapStrategy.fuse(a, b, {});

  assert.equal(res.width, b.width);
  assert.equal(res.height, b.height);
  assert.ok(res.rgba instanceof Uint8ClampedArray);
  assert.equal(res.rgba.length, b.width * b.height * 4);
  assert.ok(countOpaque(res.rgba) > 0, "result has opaque pixels");

  assert.ok(Array.isArray(res.layers) && res.layers.length >= 6, "has >=6 debug layers");
  const labels = res.layers.map(l => l.label);
  for (const lbl of EXPECTED_LAYERS) {
    assert.ok(labels.includes(lbl), `missing layer "${lbl}"`);
  }
  for (const l of res.layers) {
    assert.ok(l.rgba instanceof Uint8ClampedArray);
    assert.equal(l.rgba.length, l.width * l.height * 4, `layer ${l.label} rgba size`);
  }

  assert.ok(["graft", "fallback"].includes(res.meta.rung), `meta.rung=${res.meta.rung}`);
});

test("partswap: grafts on these fixtures (real cut+swap, no full-body overlap)", () => {
  const a = makeHeadDonor();
  const b = makeBody();
  const res = partswapStrategy.fuse(a, b, {});

  assert.equal(res.meta.rung, "graft", `expected graft, got ${res.meta.rung} (${res.meta.reason ?? ""})`);
  assert.equal(typeof res.meta.score, "number");
  assert.ok(res.meta.score >= 0.25, "score above floor");
  assert.ok(["pinch", "contact"].includes(res.meta.socketKind));

  // no full-body overlap: result area is comparable to B's, not ~A+B stacked.
  const bArea = countOpaque(b.rgba);
  const resArea = countOpaque(res.rgba);
  assert.ok(resArea > 0.3 * bArea && resArea < 2.2 * bArea, `area ratio sane: ${resArea}/${bArea}`);

  // B's head was deleted: the bBody layer must be empty above the cut row.
  const bBody = res.layers.find(l => l.label === "bBody");
  // find topmost opaque row of B and of bBody; bBody's top must be strictly lower.
  const topRow = rgba => {
    for (let y = 0; y < 44; y++) {
      for (let x = 0; x < 32; x++) {
        if (rgba[(y * 32 + x) * 4 + 3] > 24) {
          return y;
        }
      }
    }
    return Infinity;
  };
  assert.ok(topRow(bBody.rgba) > topRow(b.rgba), "B's head region cleared above the cut");
});

test("partswap: NEVER throws on degenerate input (empty / tiny)", () => {
  const empty = spriteOf(blank(16, 16), 16, 16);
  const tiny1 = spriteOf(new Uint8ClampedArray([200, 200, 200, 255]), 1, 1);
  const tiny2 = makeTiny2();
  const good = makeBody();
  const goodHead = makeHeadDonor();

  const cases = [
    [empty, empty],
    [empty, good],
    [goodHead, empty],
    [tiny1, tiny1],
    [tiny1, good],
    [good, tiny1],
    [tiny2, tiny2],
    [goodHead, tiny2],
  ];
  for (const [a, b] of cases) {
    let res;
    assert.doesNotThrow(() => {
      res = partswapStrategy.fuse(a, b, {});
    }, `fuse threw on ${a.width}x${a.height} / ${b.width}x${b.height}`);
    assert.equal(res.width, b.width);
    assert.equal(res.height, b.height);
    assert.ok(res.rgba instanceof Uint8ClampedArray);
    assert.ok(Array.isArray(res.layers) && res.layers.length >= 1);
    assert.ok(["graft", "fallback"].includes(res.meta.rung), `rung=${res.meta.rung}`);
  }
});

test("partswap: tolerates missing params object", () => {
  const a = makeHeadDonor();
  const b = makeBody();
  assert.doesNotThrow(() => partswapStrategy.fuse(a, b));
  assert.doesNotThrow(() => partswapStrategy.fuse(a, b, undefined));
});

function makeTiny2() {
  const rgba = blank(2, 2);
  rect(rgba, 2, 0, 0, 1, 1, [120, 120, 120, 255]);
  return spriteOf(rgba, 2, 2);
}
