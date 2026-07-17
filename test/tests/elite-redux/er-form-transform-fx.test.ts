import { getTypeRgb } from "#data/type";
import { PokemonType } from "#enums/pokemon-type";
import {
  ER_TRANSFORM_FX_MAX_PARTICLES,
  type ErTransformParticleMotion,
  type ErTransformParticleShape,
  erTransformBuildMask,
  erTransformSignedDt,
  getErTransformTypeFx,
} from "#sprites/er-form-transform-fx";
import { describe, expect, it } from "vitest";

/**
 * Pure config-derivation tests for the per-type transform burst FX. No scene /
 * GameManager is needed: `getErTransformTypeFx` is a total pure function. The
 * render harness cannot capture the animation itself (CLAUDE.md "out of scope:
 * animation/timing"), so the config being valid for EVERY type + a working
 * fallback is the unit-testable contract.
 */

const VALID_SHAPES: ErTransformParticleShape[] = ["leaf", "droplet", "ember", "mote", "spark", "shard"];
const VALID_MOTIONS: ErTransformParticleMotion[] = ["rise", "fall", "burst", "sway"];

/** Every value in the PokemonType enum (numeric members only, incl. UNKNOWN = -1). */
const ALL_TYPES: PokemonType[] = Object.values(PokemonType).filter((v): v is PokemonType => typeof v === "number");

describe("ER transform FX - per-type config derivation", () => {
  it("covers every value in the PokemonType enum with no gaps", () => {
    // UNKNOWN..STELLAR = 20 distinct type values.
    expect(ALL_TYPES.length).toBe(20);
  });

  it.each(
    ALL_TYPES.map(t => [PokemonType[t], t] as const),
  )("yields a valid, bounded, visible config for %s", (_name, type) => {
    const fx = getErTransformTypeFx(type);

    // Bounded particle count (the perf contract).
    expect(fx.count).toBeGreaterThanOrEqual(1);
    expect(fx.count).toBeLessThanOrEqual(ER_TRANSFORM_FX_MAX_PARTICLES);

    // Renderable shape + motion.
    expect(VALID_SHAPES).toContain(fx.shape);
    expect(VALID_MOTIONS).toContain(fx.motion);

    // Positive geometry so a particle is actually drawn.
    expect(fx.size).toBeGreaterThan(0);
    expect(fx.spread).toBeGreaterThan(0);
    expect(fx.spin).toBeGreaterThanOrEqual(0);

    // A visible light tint: valid rgb bytes, never fully black (invisible glow).
    expect(fx.rgb).toHaveLength(3);
    for (const channel of fx.rgb) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
    expect(fx.rgb[0] + fx.rgb[1] + fx.rgb[2]).toBeGreaterThan(0);
  });

  it("uses the canonical getTypeRgb colour for a coloured type", () => {
    expect(getErTransformTypeFx(PokemonType.GRASS).rgb).toEqual(getTypeRgb(PokemonType.GRASS));
    expect(getErTransformTypeFx(PokemonType.FIRE).rgb).toEqual(getTypeRgb(PokemonType.FIRE));
  });

  it("maps the maintainer's grass example to drifting leaves", () => {
    const grass = getErTransformTypeFx(PokemonType.GRASS);
    expect(grass.shape).toBe("leaf");
    expect(grass.motion).toBe("sway");
    // Green light (grass rgb has a dominant green channel).
    expect(grass.rgb[1]).toBeGreaterThan(grass.rgb[0]);
    expect(grass.rgb[1]).toBeGreaterThan(grass.rgb[2]);
  });

  it("themes the other reference types distinctly", () => {
    expect(getErTransformTypeFx(PokemonType.ELECTRIC).shape).toBe("spark");
    expect(getErTransformTypeFx(PokemonType.WATER).motion).toBe("fall");
    expect(getErTransformTypeFx(PokemonType.FIRE).shape).toBe("ember");
    expect(getErTransformTypeFx(PokemonType.FIRE).motion).toBe("rise");
  });

  it("falls back to visible neutral motes for UNKNOWN (getTypeRgb black -> white)", () => {
    const fx = getErTransformTypeFx(PokemonType.UNKNOWN);
    expect(fx.shape).toBe("mote");
    expect(fx.motion).toBe("burst");
    expect(fx.rgb).toEqual([255, 255, 255]);
    expect(fx.count).toBeGreaterThanOrEqual(1);
    expect(fx.count).toBeLessThanOrEqual(ER_TRANSFORM_FX_MAX_PARTICLES);
  });

  it("falls back for an out-of-range numeric type (future-proofing)", () => {
    const fx = getErTransformTypeFx(9999 as PokemonType);
    expect(VALID_SHAPES).toContain(fx.shape);
    expect(VALID_MOTIONS).toContain(fx.motion);
    expect(fx.rgb).toEqual([255, 255, 255]);
    expect(fx.count).toBeLessThanOrEqual(ER_TRANSFORM_FX_MAX_PARTICLES);
  });

  it("never exceeds the particle cap even if a preset were mis-authored", () => {
    for (const type of ALL_TYPES) {
      expect(getErTransformTypeFx(type).count).toBeLessThanOrEqual(ER_TRANSFORM_FX_MAX_PARTICLES);
    }
  });
});

/**
 * Pure signed-distance-field morph math (ported from shiny-lab/site/effects.mjs).
 * These are the algorithm's core - fully deterministic, no scene, no canvas - so
 * the shape morph is unit-testable even though the animated render itself is
 * animation-tier (CLAUDE.md "out of scope: animation/timing").
 */
describe("ER transform FX - SDF shape morph math", () => {
  /** Build a `w x h` RGBA buffer whose opaque pixels are `filled(x, y)`. */
  function rgbaMask(w: number, h: number, filled: (x: number, y: number) => boolean): Uint8ClampedArray {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        data[(y * w + x) * 4 + 3] = filled(x, y) ? 255 : 0;
      }
    }
    return data;
  }

  it("centroid-aligns a mask and reports its opaque pixel count", () => {
    const w = 6;
    const h = 6;
    // A 2x2 block in the top-left corner (centroid ~ (0.5, 0.5)).
    const data = rgbaMask(w, h, (x, y) => x < 2 && y < 2);
    const W = 20;
    const H = 20;
    const { mask, offX, offY, count } = erTransformBuildMask(data, w, h, W, H);
    expect(count).toBe(4);
    // The 2x2 centroid (0.5, 0.5) is shifted to the grid centre (10, 10).
    expect(offX).toBe(Math.round(W / 2 - 0.5));
    expect(offY).toBe(Math.round(H / 2 - 0.5));
    // All four opaque pixels survived the re-projection onto the common grid.
    let placed = 0;
    for (const cell of mask) {
      placed += cell;
    }
    expect(placed).toBe(4);
  });

  it("reports an empty silhouette as count 0 (the fail-closed trigger)", () => {
    const data = rgbaMask(8, 8, () => false);
    const { count } = erTransformBuildMask(data, 8, 8, 24, 24);
    expect(count).toBe(0);
  });

  it("signs the distance field negative inside, positive outside, ~0 on the edge", () => {
    const W = 16;
    const H = 16;
    // A centred 6x6 solid square.
    const mask = new Uint8Array(W * H);
    for (let y = 5; y < 11; y++) {
      for (let x = 5; x < 11; x++) {
        mask[y * W + x] = 1;
      }
    }
    const sdf = erTransformSignedDt(mask, W, H);
    // Deep inside the square is strongly negative.
    expect(sdf[8 * W + 8]).toBeLessThan(0);
    // Far outside is strongly positive.
    expect(sdf[0]).toBeGreaterThan(0);
    // A cell just outside the square edge is positive-small.
    expect(sdf[8 * W + 11]).toBeGreaterThan(0);
    expect(sdf[8 * W + 11]).toBeLessThan(3);
  });

  it("interpolating two SDFs + thresholding at 0 is a real shape morph (not a crossfade)", () => {
    const W = 32;
    const H = 32;
    // Centroid-aligned (concentric) masses, as the in-game masks are: a SMALL
    // centred square -> a LARGER centred square. A true SDF morph sweeps the
    // boundary through the GEOMETRIC MIDPOINT as p rises (so edge cells flip at a
    // p proportional to their distance between the two outlines); a mask crossfade
    // would flip the whole target region at a single threshold instead.
    const makeSquare = (half: number): Uint8Array => {
      const m = new Uint8Array(W * H);
      for (let y = 16 - half; y < 16 + half; y++) {
        for (let x = 16 - half; x < 16 + half; x++) {
          m[y * W + x] = 1;
        }
      }
      return m;
    };
    const sdfSrc = erTransformSignedDt(makeSquare(3), W, H); // source: x,y in [13,19)
    const sdfTgt = erTransformSignedDt(makeSquare(7), W, H); // target: x,y in [9,23)
    const inside = (p: number, x: number, y: number): boolean => {
      const i = y * W + x;
      return sdfSrc[i] + (sdfTgt[i] - sdfSrc[i]) * p <= 0;
    };

    // The shared centre is solid at every p (the mass never vanishes mid-morph).
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(inside(p, 16, 16)).toBe(true);
    }
    // A cell just OUTSIDE the source but INSIDE the target: empty at p=0, filled
    // at p=1, and the boundary sweeps past it by mid-morph (near the source edge).
    expect(inside(0, 20, 16)).toBe(false);
    expect(inside(1, 20, 16)).toBe(true);
    expect(inside(0.5, 20, 16)).toBe(true);
    // A cell near the TARGET edge flips only LATE (boundary reaches it near p=1),
    // proving the outline moves gradually rather than snapping on like a crossfade.
    expect(inside(0.25, 22, 16)).toBe(false);
    expect(inside(1, 22, 16)).toBe(true);
    // A cell OUTSIDE even the target stays empty throughout.
    for (const p of [0, 0.5, 1]) {
      expect(inside(p, 27, 16)).toBe(false);
    }
  });
});
