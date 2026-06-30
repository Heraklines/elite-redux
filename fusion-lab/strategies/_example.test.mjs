import assert from "node:assert/strict";
import test from "node:test";
import { STRATEGIES } from "../fusion.mjs";
import { passthroughBStrategy } from "./_example.mjs";

// tiny synthetic SpriteData fixture (matches the loader's shape: {dex,name,width,height,rgba})
const spriteOf = (rgba, width, height, dex = 1) => ({ dex, name: "test", width, height, rgba });

// a w*h sprite where every pixel is one flat [r,g,b,a] colour
function makeSprite(w, h, [r, g, b, a]) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    rgba[p * 4] = r;
    rgba[p * 4 + 1] = g;
    rgba[p * 4 + 2] = b;
    rgba[p * 4 + 3] = a;
  }
  return spriteOf(rgba, w, h);
}

test("_example: passthroughB self-registers into the shared STRATEGIES registry", () => {
  assert.ok(Array.isArray(STRATEGIES));
  // importing ./_example.mjs ran its STRATEGIES.push(...), and both modules share
  // the same fusion.mjs instance, so the registry contains this exact object.
  assert.ok(STRATEGIES.includes(passthroughBStrategy), "strategy is in STRATEGIES");
  const found = STRATEGIES.find(s => s.id === "passthroughB");
  assert.equal(found, passthroughBStrategy);
  assert.equal(found.label, "Passthrough B (template)");
  assert.deepEqual(found.params, []);
  assert.equal(typeof found.fuse, "function");
});

test("_example: fuse(a, b) returns B's pixels (a copy) and a debug layer", () => {
  const a = makeSprite(2, 2, [255, 0, 0, 255]); // head donor: red
  const b = makeSprite(3, 2, [0, 128, 255, 200]); // body donor: distinct blue

  const res = passthroughBStrategy.fuse(a, b);

  // result tracks B's dimensions and pixels exactly
  assert.equal(res.width, b.width);
  assert.equal(res.height, b.height);
  assert.ok(res.rgba instanceof Uint8ClampedArray);
  assert.deepEqual([...res.rgba], [...b.rgba], "result rgba == B's pixels");
  assert.notEqual(res.rgba, b.rgba, "rgba is a copy, not B's buffer");

  // one layer, labelled "b", carrying a copy of B
  assert.ok(Array.isArray(res.layers) && res.layers.length >= 1);
  const layer = res.layers[0];
  assert.equal(layer.label, "b");
  assert.equal(layer.width, b.width);
  assert.equal(layer.height, b.height);
  assert.equal(layer.rgba.length, b.width * b.height * 4);
  assert.deepEqual([...layer.rgba], [...b.rgba]);

  assert.equal(res.meta.rung, "passthrough");
});
