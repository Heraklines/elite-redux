import assert from "node:assert/strict";
import test from "node:test";
import { reconstructFrame } from "./fusion.mjs";

// Build a tiny synthetic atlas: a 4x4 sheet that is fully transparent except a
// 2x2 coloured block whose top-left is at atlas (1,1).
function makeAtlas() {
  const atlasW = 4;
  const atlasH = 4;
  const atlas = new Uint8ClampedArray(atlasW * atlasH * 4);
  const set = (x, y, r, g, b, a) => {
    const i = (y * atlasW + x) * 4;
    atlas[i] = r;
    atlas[i + 1] = g;
    atlas[i + 2] = b;
    atlas[i + 3] = a;
  };
  set(1, 1, 255, 0, 0, 255); // red
  set(2, 1, 0, 255, 0, 255); // green
  set(1, 2, 0, 0, 255, 255); // blue
  set(2, 2, 255, 255, 0, 255); // yellow
  return { atlas, atlasW, atlasH };
}

const px = (rgba, width, x, y) => {
  const i = (y * width + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
};

test("reconstructFrame blits the trimmed sub-rect at the spriteSourceSize offset", () => {
  const { atlas, atlasW, atlasH } = makeAtlas();
  const frame = { x: 1, y: 1, w: 2, h: 2 }; // the 2x2 block in the atlas
  const spriteSourceSize = { x: 2, y: 3 }; // it lives at (2,3) in the full sprite
  const sourceSize = { w: 6, h: 6 }; // untrimmed sprite is 6x6

  const out = reconstructFrame(atlas, atlasW, atlasH, frame, spriteSourceSize, sourceSize);

  assert.equal(out.width, 6);
  assert.equal(out.height, 6);
  assert.equal(out.rgba.length, 6 * 6 * 4);
  assert.ok(out.rgba instanceof Uint8ClampedArray);

  // the block is placed at the offset, preserving its internal layout
  assert.deepEqual(px(out.rgba, 6, 2, 3), [255, 0, 0, 255]);
  assert.deepEqual(px(out.rgba, 6, 3, 3), [0, 255, 0, 255]);
  assert.deepEqual(px(out.rgba, 6, 2, 4), [0, 0, 255, 255]);
  assert.deepEqual(px(out.rgba, 6, 3, 4), [255, 255, 0, 255]);

  // everything outside the blitted block stays fully transparent
  assert.deepEqual(px(out.rgba, 6, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(px(out.rgba, 6, 5, 5), [0, 0, 0, 0]);
  assert.deepEqual(px(out.rgba, 6, 2, 2), [0, 0, 0, 0]); // just above the block
});

test("reconstructFrame with a zero offset (untrimmed frame) copies 1:1", () => {
  const { atlas, atlasW, atlasH } = makeAtlas();
  const frame = { x: 1, y: 1, w: 2, h: 2 };
  const spriteSourceSize = { x: 0, y: 0 };
  const sourceSize = { w: 2, h: 2 };

  const out = reconstructFrame(atlas, atlasW, atlasH, frame, spriteSourceSize, sourceSize);

  assert.equal(out.width, 2);
  assert.equal(out.height, 2);
  assert.deepEqual(px(out.rgba, 2, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(out.rgba, 2, 1, 0), [0, 255, 0, 255]);
  assert.deepEqual(px(out.rgba, 2, 0, 1), [0, 0, 255, 255]);
  assert.deepEqual(px(out.rgba, 2, 1, 1), [255, 255, 0, 255]);
});

test("reconstructFrame defaults a missing spriteSourceSize to (0,0) and clips out-of-bounds writes", () => {
  const { atlas, atlasW, atlasH } = makeAtlas();
  const frame = { x: 1, y: 1, w: 2, h: 2 };
  // sourceSize smaller than offset+frame would overflow: only the in-bounds pixel survives
  const sourceSize = { w: 1, h: 1 };

  const out = reconstructFrame(atlas, atlasW, atlasH, frame, undefined, sourceSize);

  assert.equal(out.width, 1);
  assert.equal(out.height, 1);
  assert.equal(out.rgba.length, 4);
  // only dest (0,0) is writable; it gets the block's top-left pixel
  assert.deepEqual(px(out.rgba, 1, 0, 0), [255, 0, 0, 255]);
});
