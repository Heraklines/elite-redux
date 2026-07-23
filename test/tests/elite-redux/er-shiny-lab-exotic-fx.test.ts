import {
  AROUND_IDS,
  ER_SHINY_LAB_DEFAULT_PARAMS,
  PALETTE_IDS,
  SURFACE_IDS,
} from "#data/elite-redux/er-shiny-lab-effects";
import { clearFxGroups, registerFxGroup, renderErShinyLabLook } from "#data/elite-redux/er-shiny-lab-renderer";
import { describe, expect, it } from "vitest";

// Focused gates for the exotic topology effects graduated on 2026-07-20:
//   surfaces: gildedbones, carvedrelief, innerember, nestedportrait
//   around:   warpwell
// These pin the contract the brief demanded: deterministic output, seed-driven
// placement, silhouette/alpha preservation, padded bounds, stable anchors, and
// the append-only registry rule that protects every saved index.

const EXOTIC_SURFACES = ["gildedbones", "carvedrelief", "innerember", "nestedportrait"] as const;
const EXOTIC_AROUND = ["warpwell"] as const;

/** Varied disc sprite with a dark outline ring (same shape as the registry gate). */
function source(w = 24, h = 24) {
  const data = new Uint8ClampedArray(w * h * 4);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rad = Math.min(w, h) * 0.4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.hypot(x - cx, y - cy);
      if (d > rad) {
        data[i + 3] = 0;
        continue;
      }
      if (d > rad - 1.6) {
        data[i] = 20;
        data[i + 1] = 18;
        data[i + 2] = 30;
      } else {
        data[i] = 20 + x * 9;
        data[i + 1] = 30 + y * 8;
        data[i + 2] = 220 - x * 7;
      }
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function render(id: string, category: "surface" | "around", params = {}, time = 3.5, src = source()) {
  const slots = {
    palette: null,
    surface: category === "surface" ? id : null,
    around: category === "around" ? id : null,
  };
  return renderErShinyLabLook(src, slots, { ...ER_SHINY_LAB_DEFAULT_PARAMS, ...params }, time, { pad: 10 });
}

function alphaAt(out: { width: number; data: Uint8ClampedArray }, x: number, y: number): number {
  return out.data[(y * out.width + x) * 4 + 3];
}

describe("ER Shiny Lab exotic effects - determinism", () => {
  for (const id of [...EXOTIC_SURFACES, ...EXOTIC_AROUND]) {
    it(`${id} renders byte-identical output for identical params`, () => {
      const category = (EXOTIC_SURFACES as readonly string[]).includes(id) ? "surface" : "around";
      const a = render(id, category);
      const b = render(id, category);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a?.data).toEqual(b?.data);
    });
  }
});

describe("ER Shiny Lab exotic effects - seed placement", () => {
  it("innerember changes pixel placement with seed (vnoise-driven fire)", () => {
    const a = render("innerember", "surface", { seed: 1 });
    const b = render("innerember", "surface", { seed: 999 });
    expect(a?.data).not.toEqual(b?.data);
  });
  it("gildedbones topology is seed-independent (silhouette only)", () => {
    // The midline skeleton must NOT move with the seed - it is anatomy, not noise.
    const a = render("gildedbones", "surface", { seed: 1 });
    const b = render("gildedbones", "surface", { seed: 999 });
    expect(a?.data).toEqual(b?.data);
  });
});

describe("ER Shiny Lab exotic effects - silhouette + alpha", () => {
  for (const id of EXOTIC_SURFACES) {
    it(`${id} leaves fully-transparent source pixels transparent (no around equipped)`, () => {
      const src = source();
      const out = render(id, "surface");
      expect(out).not.toBeNull();
      const pad = 10;
      let violated = 0;
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          // Source-transparent pixel: with no around effect the renderer must
          // write alpha 0 at the padded position.
          if (
            src.data[(y * src.width + x) * 4 + 3] === 0
            && alphaAt(out as { width: number; data: Uint8ClampedArray }, x + pad, y + pad) !== 0
          ) {
            violated++;
          }
        }
      }
      expect(violated).toBe(0);
    });
    it(`${id} keeps on-body pixels opaque (alpha preservation)`, () => {
      const out = render(id, "surface");
      const pad = 10;
      // Center of the disc: definitely body.
      expect(alphaAt(out as { width: number; data: Uint8ClampedArray }, 12 + pad, 12 + pad)).toBe(255);
    });
  }
});

describe("ER Shiny Lab exotic effects - bounds", () => {
  for (const id of [...EXOTIC_SURFACES, ...EXOTIC_AROUND]) {
    it(`${id} writes only inside the padded output buffer`, () => {
      const category = (EXOTIC_SURFACES as readonly string[]).includes(id) ? "surface" : "around";
      const src = source();
      const out = render(id, category);
      expect(out).not.toBeNull();
      expect(out?.width).toBe(src.width + 20);
      expect(out?.height).toBe(src.height + 20);
      expect(out?.data.length).toBe((src.width + 20) * (src.height + 20) * 4);
    });
  }
});

describe("ER Shiny Lab exotic effects - stable anchors", () => {
  it("warpwell orbit anchor is stable across frames of a jumping animation", () => {
    clearFxGroups();
    // Two frames: same disc, second shifted down 4 px (a hop). A frame-anchored
    // landmark would move 4 px; the stable union anchor must not.
    const f0 = source();
    const f1raw = source();
    const f1 = { width: f1raw.width, height: f1raw.height, data: new Uint8ClampedArray(f1raw.data.length) };
    const shift = 4;
    for (let y = 0; y < f1.height; y++) {
      for (let x = 0; x < f1.width; x++) {
        const sy = y - shift;
        if (sy >= 0) {
          const si = (sy * f1.width + x) * 4;
          const di = (y * f1.width + x) * 4;
          f1.data[di] = f1raw.data[si];
          f1.data[di + 1] = f1raw.data[si + 1];
          f1.data[di + 2] = f1raw.data[si + 2];
          f1.data[di + 3] = f1raw.data[si + 3];
        }
      }
    }
    registerFxGroup("hop", [f0, f1]);
    const slots = { palette: null, surface: null, around: "warpwell" };
    const p = { ...ER_SHINY_LAB_DEFAULT_PARAMS };
    const o0 = renderErShinyLabLook(f0, slots, p, 0, { pad: 10, fxGroup: "hop" });
    const o1 = renderErShinyLabLook(f1, slots, p, 0, { pad: 10, fxGroup: "hop" });
    expect(o0).not.toBeNull();
    expect(o1).not.toBeNull();
    // Recompute the group union anchor exactly as the renderer does (union
    // silhouette centroid across both frames), so the expected horizon centre
    // at t=0 (orbit angle 0 -> +0.16 x, +0 y) is known in padded pixels.
    const pad = 10;
    let sx = 0;
    let sy = 0;
    let cnt = 0;
    for (const f of [f0, f1]) {
      for (let y = 0; y < f.height; y++) {
        for (let x = 0; x < f.width; x++) {
          if (f.data[(y * f.width + x) * 4 + 3] > 0.02 * 255) {
            sx += x + pad;
            sy += y + pad;
            cnt++;
          }
        }
      }
    }
    const PW = f0.width + 2 * pad;
    const PH = f0.height + 2 * pad;
    const stableCx = sx / cnt / PW;
    const stableCy = sy / cnt / PH;
    const hx = Math.round((stableCx + 0.16) * PW);
    const hy = Math.round(stableCy * 0.75 * PH); // orbit y at t=0 (sin=0)
    // Sample the output at the expected horizon: it must be the opaque
    // near-black disc, and it must be at the SAME padded position in both
    // frames even though the silhouette hopped 4 px.
    const at = (o: { width: number; data: Uint8ClampedArray }, x: number, y: number) => {
      const i = (y * o.width + x) * 4;
      return [o.data[i], o.data[i + 1], o.data[i + 2], o.data[i + 3]];
    };
    const c0 = at(o0 as { width: number; data: Uint8ClampedArray }, hx, hy);
    const c1 = at(o1 as { width: number; data: Uint8ClampedArray }, hx, hy);
    expect(c0[3], `expected opaque horizon at (${hx},${hy}) frame 0, got ${c0}`).toBeGreaterThan(200);
    expect(c0[0] + c0[1] + c0[2], `horizon should be near-black, got ${c0}`).toBeLessThan(120);
    // Same padded position in frame 1 (shifted silhouette) = same horizon.
    expect(c1[3], `horizon must not follow the hopping silhouette, got ${c1}`).toBeGreaterThan(200);
    expect(c1[0] + c1[1] + c1[2]).toBeLessThan(120);
    clearFxGroups();
  });
});

describe("ER Shiny Lab registry - append-only contract", () => {
  it("the pre-2026-07-20 id prefixes are unchanged (saved-index safety)", () => {
    // Lengths BEFORE the exotic append: palette 138, surface 125, around 107.
    // Every saved look encodes an effect by position; inserting anywhere above
    // the tail would silently re-skin existing saves.
    expect(PALETTE_IDS.length).toBe(138);
    expect(SURFACE_IDS.length).toBe(129);
    expect(AROUND_IDS.length).toBe(107);
    expect(SURFACE_IDS[124]).toBe("phosphor");
    expect(SURFACE_IDS.slice(125)).toEqual(["gildedbones", "carvedrelief", "innerember", "nestedportrait"]);
    expect(AROUND_IDS[105]).toBe("paperlanterns");
    expect(AROUND_IDS[106]).toBe("warpwell");
    expect(PALETTE_IDS[137]).toBe("pentagalaxy");
  });
});
