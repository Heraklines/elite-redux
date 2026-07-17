import { getTypeRgb } from "#data/type";
import { PokemonType } from "#enums/pokemon-type";
import {
  ER_TRANSFORM_FX_MAX_PARTICLES,
  type ErTransformParticleMotion,
  type ErTransformParticleShape,
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
