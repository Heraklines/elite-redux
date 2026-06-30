import assert from "node:assert/strict";
import test from "node:test";
import {
  components,
  detectSockets,
  edt,
  maskOf,
  oklabToSrgb,
  quantizeOklab,
  reconstructFrame,
  skeletonize,
  srgbToOklab,
} from "./fusion.mjs";

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

// ---------------------------------------------------------------------------
// 2.1 maskOf + components (alpha mask + connected-components despeckle)
// ---------------------------------------------------------------------------

// Build an RGBA buffer from a 0/1 grid (opaque white where 1, transparent 0).
function rgbaFromGrid(grid, w, h, alpha = 255) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x]) {
        const i = (y * w + x) * 4;
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = alpha;
      }
    }
  }
  return rgba;
}

test("maskOf thresholds on alpha (> aThresh), 1 for opaque, 0 for transparent", () => {
  const w = 3;
  const h = 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  // three pixels with alpha 0, 24 (== threshold, excluded), 25 (> threshold)
  rgba[3] = 0;
  rgba[7] = 24;
  rgba[11] = 25;
  const mask = maskOf(rgba, w, h, 24);
  assert.ok(mask instanceof Uint8Array);
  assert.deepEqual([...mask], [0, 0, 1]);
});

test("components is 8-connected and drops sub-minPx specks (their pixels -> label 0)", () => {
  // 5x5: a solid 3x3 blob (9 px) top-left + a single-pixel speck at (4,3).
  const w = 5;
  const h = 5;
  const grid = [
    [1, 1, 1, 0, 0],
    [1, 1, 1, 0, 0],
    [1, 1, 1, 0, 0],
    [0, 0, 0, 0, 1], // speck
    [0, 0, 0, 0, 0],
  ];
  const mask = maskOf(rgbaFromGrid(grid, w, h), w, h);
  const { labels, areasDesc } = components(mask, w, h, 6);

  assert.ok(labels instanceof Int32Array);
  // the speck (area 1 < 6) is removed
  assert.equal(labels[3 * w + 4], 0);
  // the blob survives with a single non-zero label
  const blobLabel = labels[0 * w + 0];
  assert.notEqual(blobLabel, 0);
  let blobCount = 0;
  for (const v of labels) {
    if (v === blobLabel) {
      blobCount++;
    }
  }
  assert.equal(blobCount, 9);
  // only one surviving component, area 9
  assert.equal(areasDesc.length, 1);
  assert.equal(areasDesc[0].label, blobLabel);
  assert.equal(areasDesc[0].area, 9);
});

test("components joins 8-connected diagonals into one component", () => {
  // two pixels touching only at a corner -> still one component (area 2)
  const w = 3;
  const h = 3;
  const grid = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ];
  const mask = maskOf(rgbaFromGrid(grid, w, h), w, h);
  // minPx=2 so the 2-px diagonal pair survives
  const { labels, areasDesc } = components(mask, w, h, 2);
  assert.equal(areasDesc.length, 1);
  assert.equal(areasDesc[0].area, 2);
  assert.equal(labels[0], labels[1 * w + 1]);
});

// ---------------------------------------------------------------------------
// 2.2 srgbToOklab / oklabToSrgb
// ---------------------------------------------------------------------------

test("srgbToOklab: white -> L~=1, black -> L~=0", () => {
  const white = srgbToOklab([255, 255, 255]);
  const black = srgbToOklab([0, 0, 0]);
  assert.ok(Math.abs(white[0] - 1) < 1e-3, `white L=${white[0]}`);
  assert.ok(Math.abs(white[1]) < 1e-3 && Math.abs(white[2]) < 1e-3, "white is achromatic");
  assert.ok(Math.abs(black[0]) < 1e-3, `black L=${black[0]}`);
});

test("oklabToSrgb(srgbToOklab(c)) round-trips within ~2/255", () => {
  const colors = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [128, 64, 200],
    [17, 200, 90],
    [200, 200, 40],
    [123, 45, 67],
  ];
  for (const c of colors) {
    const back = oklabToSrgb(srgbToOklab(c));
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(back[i] - c[i]) <= 2, `channel ${i} of ${c}: got ${back[i]}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2.3 quantizeOklab (median-cut palette + ink + ramp roles)
// ---------------------------------------------------------------------------

// helper: paint a solid RGBA rect into a buffer
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

test("quantizeOklab: red square on transparent -> 1 meaningful color, bg = sentinel 255", () => {
  const w = 4;
  const h = 4;
  const rgba = new Uint8ClampedArray(w * h * 4); // all transparent
  paintRect(rgba, w, 0, 0, 1, 1, [255, 0, 0]); // 2x2 red block, opaque

  const { palette, indexMap, inkIndices, rampRoles } = quantizeOklab(rgba, w, h);

  assert.ok(palette.length >= 1 && palette.length <= 2, `palette length ${palette.length}`);
  assert.ok(indexMap instanceof Uint8Array);

  // all four red pixels share one (non-sentinel) index
  const redIdx = indexMap[0];
  assert.notEqual(redIdx, 255);
  assert.equal(indexMap[1], redIdx);
  assert.equal(indexMap[0 * w + 0], redIdx);
  assert.equal(indexMap[1 * w + 1], redIdx);

  // every transparent pixel maps to the sentinel
  assert.equal(indexMap[2], 255);
  assert.equal(indexMap[3 * w + 3], 255);

  // pure mid-bright red is not "ink"
  assert.ok(!inkIndices.has(redIdx));
  assert.ok(rampRoles instanceof Map);
});

test("quantizeOklab: dark border around a bright fill -> border index flagged ink", () => {
  const w = 5;
  const h = 5;
  const rgba = new Uint8ClampedArray(w * h * 4);
  paintRect(rgba, w, 0, 0, 4, 4, [10, 10, 10]); // near-black, opaque, whole 5x5
  paintRect(rgba, w, 1, 1, 3, 3, [255, 255, 255]); // bright 3x3 center

  const { palette, indexMap, inkIndices } = quantizeOklab(rgba, w, h);
  assert.equal(palette.length, 2, `palette length ${palette.length}`);

  const borderIdx = indexMap[0]; // corner (0,0) is dark border
  const centerIdx = indexMap[2 * w + 2]; // (2,2) bright center
  assert.notEqual(borderIdx, centerIdx);
  assert.ok(inkIndices.has(borderIdx), "dark border is ink");
  assert.ok(!inkIndices.has(centerIdx), "bright center is not ink");
});

test("quantizeOklab: ramp roles sort each family shadow<=mid<=highlight by L", () => {
  // a 1x3 column of three same-hue reds of increasing lightness
  const w = 1;
  const h = 3;
  const rgba = new Uint8ClampedArray(w * h * 4);
  paintRect(rgba, w, 0, 0, 0, 0, [90, 12, 12]);
  paintRect(rgba, w, 0, 1, 0, 1, [170, 30, 30]);
  paintRect(rgba, w, 0, 2, 0, 2, [245, 90, 90]);

  const { palette, inkIndices, rampRoles } = quantizeOklab(rgba, w, h);

  // every non-ink palette entry is accounted for in exactly one family
  const nonInk = palette.map((_, k) => k).filter(k => !inkIndices.has(k));
  let counted = 0;
  for (const role of rampRoles.values()) {
    counted += role.members.length;
    // role ordering is monotone in L
    assert.ok(palette[role.shadow][0] <= palette[role.mid][0], "shadow <= mid");
    assert.ok(palette[role.mid][0] <= palette[role.highlight][0], "mid <= highlight");
  }
  assert.equal(counted, nonInk.length);
});

// ---------------------------------------------------------------------------
// 2.4 edt (exact Euclidean distance transform; distance to nearest background)
// ---------------------------------------------------------------------------

test("edt: filled 5x5 square inside a 7x7 bg border -> center max, edge-adjacent = 1", () => {
  const w = 7;
  const h = 7;
  const mask = new Uint8Array(w * h);
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      mask[y * w + x] = 1;
    }
  }
  const field = edt(mask, w, h);
  assert.ok(field instanceof Float32Array);

  // background is 0
  assert.equal(field[0], 0);
  assert.equal(field[3 * w + 0], 0);

  // center (3,3) is the farthest foreground pixel from the border
  const center = field[3 * w + 3];
  let max = 0;
  for (const v of field) {
    if (v > max) {
      max = v;
    }
  }
  assert.equal(center, max);
  assert.ok(Math.abs(center - 3) < 1e-4, `center distance ${center}`);

  // a foreground pixel adjacent to the border is distance 1
  assert.ok(Math.abs(field[3 * w + 1] - 1) < 1e-4, `edge-adjacent ${field[3 * w + 1]}`);
  assert.ok(Math.abs(field[1 * w + 1] - 1) < 1e-4, `corner-adjacent ${field[1 * w + 1]}`);
});

test("edt: a single isolated foreground pixel has distance ~1 (nearest bg neighbor)", () => {
  const w = 5;
  const h = 5;
  const mask = new Uint8Array(w * h);
  mask[2 * w + 2] = 1; // lone fg pixel at center
  const field = edt(mask, w, h);
  assert.ok(Math.abs(field[2 * w + 2] - 1) < 1e-4, `isolated pixel ${field[2 * w + 2]}`);
  assert.equal(field[0], 0);
});

// ---------------------------------------------------------------------------
// 2.5 skeletonize (Zhang-Suen thinning -> graph + per-edge radius + prune)
// ---------------------------------------------------------------------------

test("skeletonize: a straight horizontal bar -> one edge, two degree-1 endpoints", () => {
  // 13x5 grid, an 11x3 fg bar centered (1px bg border all around)
  const w = 13;
  const h = 5;
  const mask = new Uint8Array(w * h);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 11; x++) {
      mask[y * w + x] = 1;
    }
  }
  const field = edt(mask, w, h);
  const { graph, prunedRatio } = skeletonize(mask, w, h, field);

  assert.equal(graph.edges.length, 1, "exactly one edge");
  assert.equal(graph.nodes.length, 2, "exactly two nodes");
  for (const node of graph.nodes) {
    assert.equal(node.deg, 1, "both nodes are degree-1 endpoints");
  }

  const e = graph.edges[0];
  // the edge connects the two endpoint nodes
  assert.deepEqual([e.a, e.b].sort(), [0, 1]);
  // endpoints lie on the same (middle) row, spanning the bar horizontally
  const [na, nb] = graph.nodes;
  assert.equal(na.y, nb.y, "endpoints share a row (horizontal)");
  assert.ok(Math.abs(na.x - nb.x) >= 6, "endpoints span the bar width");

  // every edge point carries a numeric rho (local half-thickness from edtField)
  for (const pt of e.points) {
    assert.equal(typeof pt.rho, "number");
    assert.ok(pt.rho >= 0);
  }
  // a clean bar has no spurs -> nothing pruned
  assert.equal(prunedRatio, 0);
});

// ---------------------------------------------------------------------------
// 2.6 detectSockets (H1 skeleton-rho pinch + H3 head-disk contact arc)
// ---------------------------------------------------------------------------

// Build the full analysis bundle the way Unit 4 will.
function analyze(mask, w, h) {
  const field = edt(mask, w, h);
  const skeleton = skeletonize(mask, w, h, field);
  const comp = components(mask, w, h, 1);
  return { w, h, mask, edt: field, skeleton, components: comp };
}

test("detectSockets: dumbbell -> H1 pinch socket sits at the neck, width ~= 2*rho_neck", () => {
  // two 7x5 blobs joined by a 1px-thick, 3px-long neck at the middle row
  const w = 19;
  const h = 11;
  const mask = new Uint8Array(w * h);
  const rect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        mask[y * w + x] = 1;
      }
    }
  };
  rect(1, 3, 7, 7); // left blob
  rect(11, 3, 17, 7); // right blob
  rect(8, 5, 10, 5); // neck (rho here = 1)

  const analysis = analyze(mask, w, h);
  const sockets = detectSockets({ width: w, height: h, mask }, analysis);

  assert.ok(Array.isArray(sockets) && sockets.length >= 1);

  const pinch = sockets.find(s => s.kind === "pinch");
  assert.ok(pinch, "an H1 pinch socket was found");
  // the pinch lands on the neck (x in [8,10], middle row y=5)
  assert.ok(pinch.pos.x >= 8 && pinch.pos.x <= 10, `pinch x=${pinch.pos.x}`);
  assert.equal(pinch.pos.y, 5);
  // width = 2*rho_neck ~= 2 (rho_neck = 1), within +-1 px
  assert.ok(Math.abs(pinch.width - 2) <= 1, `pinch width=${pinch.width}`);
  // normal is the (roughly horizontal) edge tangent, unit length
  assert.ok(Math.abs(Math.hypot(pinch.normal.x, pinch.normal.y) - 1) < 1e-6, "unit normal");
  assert.ok(Math.abs(pinch.normal.x) > Math.abs(pinch.normal.y), "tangent ~ horizontal");
  assert.ok(pinch.conf > 0 && Number.isFinite(pinch.conf));

  // H3 always returns a contact socket
  const contact = sockets.find(s => s.kind === "contact");
  assert.ok(contact, "an H3 contact socket was found");
  assert.ok(contact.width > 0 && Number.isFinite(contact.width));
  assert.ok(contact.conf >= 0.2, "H3 conf is lower-bounded");
});

test("detectSockets: H3 contact arc is defined even with no detectable pinch", () => {
  // a single round-ish blob: no neck -> no H1 pinch, but H3 must still fire
  const w = 11;
  const h = 11;
  const mask = new Uint8Array(w * h);
  for (let y = 2; y <= 8; y++) {
    for (let x = 2; x <= 8; x++) {
      mask[y * w + x] = 1;
    }
  }
  const analysis = analyze(mask, w, h);
  const sockets = detectSockets({ width: w, height: h, mask }, analysis);
  const contact = sockets.find(s => s.kind === "contact");
  assert.ok(contact, "H3 contact socket always defined");
  assert.ok(contact.width > 0);
  // prominence-rejection path: a solid blob has no pinch
  assert.ok(
    !sockets.find(s => s.kind === "pinch"),
    "no H1 pinch on a neckless round blob",
  );
});

test("detectSockets: no foreground -> returns [] without throwing", () => {
  const w = 6;
  const h = 6;
  const rgba = new Uint8ClampedArray(w * h * 4); // fully transparent
  const mask = maskOf(rgba, w, h);
  const field = edt(mask, w, h);
  const skeleton = skeletonize(mask, w, h, field);
  const sockets = detectSockets(
    { width: w, height: h, mask },
    { w, h, mask, edt: field, skeleton },
  );
  assert.deepEqual(sockets, []);
});

// ---------------------------------------------------------------------------
// EDT fractional answer (review: a broken envelope must not pass)
// ---------------------------------------------------------------------------

test("edt: a fractional nearest-bg offset (1,2) yields sqrt(5)", () => {
  // 7x7 fully foreground except a single background hole at (3,5).
  // (2,3) -> nearest bg (3,5) is offset (1,2) => distance sqrt(5) ~= 2.2360680.
  const w = 7;
  const h = 7;
  const mask = new Uint8Array(w * h).fill(1);
  mask[5 * w + 3] = 0; // the only background pixel
  const field = edt(mask, w, h);
  assert.equal(field[5 * w + 3], 0);
  assert.ok(Math.abs(field[3 * w + 2] - Math.sqrt(5)) < 1e-4, `got ${field[3 * w + 2]}`);
});

// ---------------------------------------------------------------------------
// skeletonize: pure cycle (loop topology) + branch trace + spur prune
// ---------------------------------------------------------------------------

test("skeletonize: a 1px ring (pure cycle) survives as one node + one self-edge", () => {
  // 5x5 square annulus inside a 7x7 (no deg!=2 pixel -> needs a synthetic node)
  const w = 7;
  const h = 7;
  const mask = new Uint8Array(w * h);
  for (let x = 1; x <= 5; x++) {
    mask[1 * w + x] = 1;
    mask[5 * w + x] = 1;
  }
  for (let y = 1; y <= 5; y++) {
    mask[y * w + 1] = 1;
    mask[y * w + 5] = 1;
  }
  const field = edt(mask, w, h);
  const { graph } = skeletonize(mask, w, h, field);
  // NOT the 8-node/12-edge corner-artifact blowup
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.edges.length, 1);
  const e = graph.edges[0];
  assert.equal(e.a, e.b, "the loop is a self-edge");
  assert.ok(e.points.length > 4, "the edge traces the whole ring");
});

test("skeletonize: clean Y keeps a deg-3 branch; a short stub is pruned", () => {
  const w = 17;
  const rect = (m, x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        m[y * w + x] = 1;
      }
    }
  };

  // (A) clean Y/T with a TALL stub -> a real deg-3 branch, nothing pruned
  {
    const h = 12;
    const mask = new Uint8Array(w * h);
    rect(mask, 2, 7, 14, 9); // bar
    rect(mask, 7, 1, 9, 8); // tall stub (survives)
    const { graph, prunedRatio } = skeletonize(mask, w, h, edt(mask, w, h));
    assert.ok(graph.nodes.some(n => n.deg === 3), "a surviving deg-3 branch");
    assert.equal(graph.edges.length, 3, "three arms traced");
    assert.equal(graph.nodes.filter(n => n.deg === 1).length, 3, "three endpoints");
    assert.equal(prunedRatio, 0);
  }

  // (B) same bar with a SHORT stub -> the spur is pruned (prunedRatio > 0)
  {
    const h = 9;
    const mask = new Uint8Array(w * h);
    rect(mask, 2, 4, 14, 6); // bar
    rect(mask, 7, 1, 9, 5); // short stub (pruned)
    const { graph, prunedRatio } = skeletonize(mask, w, h, edt(mask, w, h));
    assert.ok(prunedRatio > 0, `prunedRatio=${prunedRatio}`);
    assert.equal(graph.edges.length, 2, "the two bar arms survive");
    assert.equal(graph.nodes.filter(n => n.deg === 1).length, 2, "two bar tips");
  }
});
