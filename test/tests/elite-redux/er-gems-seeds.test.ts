import { ER_GEM_MULTIPLIER, ER_GEM_TIER, ER_GEM_TYPES, erGemTextureKey } from "#data/elite-redux/er-elemental-gems";
import { ER_SEED_CONFIG, ER_SEED_TIER, seedProcsForTerrain } from "#data/elite-redux/er-terrain-seeds";
import { TerrainType } from "#data/terrain";
import { ModifierTier } from "#enums/modifier-tier";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

describe("er-elemental-gems", () => {
  it("covers all 18 elemental types (no Stellar gem)", () => {
    expect(ER_GEM_TYPES).toHaveLength(18);
    expect(ER_GEM_TYPES).not.toContain(PokemonType.STELLAR);
  });

  it("derives the er-assets texture key from the type", () => {
    expect(erGemTextureKey(PokemonType.FIRE)).toBe("er_fire_gem");
    expect(erGemTextureKey(PokemonType.ELECTRIC)).toBe("er_electric_gem");
  });

  it("boosts by 1.3x and is Great-ball tier", () => {
    expect(ER_GEM_MULTIPLIER).toBeCloseTo(1.3);
    expect(ER_GEM_TIER).toBe(ModifierTier.GREAT);
  });
});

describe("er-terrain-seeds", () => {
  it("each seed procs only for its matching terrain", () => {
    expect(seedProcsForTerrain("electricSeed", TerrainType.ELECTRIC)).toBe(true);
    expect(seedProcsForTerrain("electricSeed", TerrainType.GRASSY)).toBe(false);
    expect(seedProcsForTerrain("mistySeed", TerrainType.MISTY)).toBe(true);
    expect(seedProcsForTerrain("psychicSeed", TerrainType.PSYCHIC)).toBe(true);
    expect(seedProcsForTerrain("grassySeed", TerrainType.NONE)).toBe(false);
  });

  it("has the four terrain seeds at Great-ball tier", () => {
    expect(Object.keys(ER_SEED_CONFIG)).toHaveLength(4);
    expect(ER_SEED_TIER).toBe(ModifierTier.GREAT);
  });
});
