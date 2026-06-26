/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #129 - World Map "Conditions" panel formatter.
//
// getErBiomeEffectLines(biomeId) is a PURE formatter over the existing per-biome
// tables (battle rules / economy / item flavor), so this runs UNGATED (no
// GameManager / globalScene). It asserts the player-facing Conditions text for a
// spread of biomes, plus the maintainer rule that no line contains an em dash.
// =============================================================================

import { getErBiomeEffectLines } from "#data/elite-redux/er-biome-effects-display";
import { BiomeId } from "#enums/biome-id";
import { describe, expect, it } from "vitest";

describe("ER World Map biome Conditions lines (#129)", () => {
  it("DESERT lists its permanent sandstorm", () => {
    const lines = getErBiomeEffectLines(BiomeId.DESERT);
    expect(lines.some(l => /sandstorm/i.test(l))).toBe(true);
  });

  it("FOREST lists the ambush rule", () => {
    const lines = getErBiomeEffectLines(BiomeId.FOREST);
    expect(lines.some(l => /ambush/i.test(l))).toBe(true);
  });

  it("VOLCANO lists the Fire boost AND the burn-on-entry risk", () => {
    const lines = getErBiomeEffectLines(BiomeId.VOLCANO);
    expect(lines).toContain("Fire moves +20%");
    expect(lines.some(l => /burn on entry/i.test(l))).toBe(true);
  });

  it("GRASS lists grassy terrain AND the double-battle bias", () => {
    const lines = getErBiomeEffectLines(BiomeId.GRASS);
    expect(lines.some(l => /terrain/i.test(l))).toBe(true);
    expect(lines.some(l => /double battles/i.test(l))).toBe(true);
  });

  it("a berry biome lists the berries line (TOWN and FOREST)", () => {
    expect(getErBiomeEffectLines(BiomeId.TOWN).some(l => /berries/i.test(l))).toBe(true);
    expect(getErBiomeEffectLines(BiomeId.FOREST).some(l => /berries/i.test(l))).toBe(true);
  });

  it("ABYSS reports that it has no shop", () => {
    const lines = getErBiomeEffectLines(BiomeId.ABYSS);
    expect(lines).toContain("No shop here");
  });

  it("ICE_CAVE lists snow AND the frostbite-on-entry risk", () => {
    const lines = getErBiomeEffectLines(BiomeId.ICE_CAVE);
    expect(lines.some(l => /snow/i.test(l))).toBe(true);
    expect(lines.some(l => /frostbite on entry/i.test(l))).toBe(true);
  });

  it("MOUNTAIN lists the Flying boost AND the high-winds accuracy penalty", () => {
    const lines = getErBiomeEffectLines(BiomeId.MOUNTAIN);
    expect(lines).toContain("Flying moves +20%");
    expect(lines.some(l => /high winds/i.test(l))).toBe(true);
  });

  it("names the dominant gem for a gem biome (VOLCANO -> Fire Gem)", () => {
    expect(getErBiomeEffectLines(BiomeId.VOLCANO).some(l => /Fire Gem/.test(l))).toBe(true);
  });

  // --- #439 §3 second batch: the ten new biome field/economy effects ---------

  it("LABORATORY lists the wild-fusion rate", () => {
    const lines = getErBiomeEffectLines(BiomeId.LABORATORY);
    expect(lines.some(l => /50% of wild Pokemon are fusions/i.test(l))).toBe(true);
  });

  it("TEMPLE lists Misty terrain AND the stat-stage freeze", () => {
    const lines = getErBiomeEffectLines(BiomeId.TEMPLE);
    expect(lines).toContain("Misty terrain");
    expect(lines.some(l => /stat stages are frozen/i.test(l))).toBe(true);
  });

  it("METROPOLIS lists the near-always-doubles bias", () => {
    const lines = getErBiomeEffectLines(BiomeId.METROPOLIS);
    expect(lines.some(l => /almost every battle is a double/i.test(l))).toBe(true);
  });

  it("DOJO lists the Fighting boost AND the never-resisted rule", () => {
    const lines = getErBiomeEffectLines(BiomeId.DOJO);
    expect(lines).toContain("Fighting moves +20%");
    expect(lines).toContain("Fighting moves are never resisted");
  });

  it("FACTORY lists the guaranteed wild held item", () => {
    const lines = getErBiomeEffectLines(BiomeId.FACTORY);
    expect(lines.some(l => /wild Pokemon always hold an item/i.test(l))).toBe(true);
  });

  it("RUINS lists darkness AND a Defense-gated ambush (not the speed gate)", () => {
    const lines = getErBiomeEffectLines(BiomeId.RUINS);
    expect(lines.some(l => /darkness/i.test(l))).toBe(true);
    expect(lines.some(l => /ambush.*defense/i.test(l))).toBe(true);
    expect(lines.some(l => /outspeeds/i.test(l))).toBe(false);
  });

  it("WASTELAND lists the no-heal shop AND the wild item drop", () => {
    const lines = getErBiomeEffectLines(BiomeId.WASTELAND);
    expect(lines.some(l => /shop sells no healing/i.test(l))).toBe(true);
    expect(lines.some(l => /drop 2 held items/i.test(l))).toBe(true);
  });

  it("CONSTRUCTION_SITE lists the extra reward slot AND the cheap shop", () => {
    const lines = getErBiomeEffectLines(BiomeId.CONSTRUCTION_SITE);
    expect(lines.some(l => /extra reward slot/i.test(l))).toBe(true);
    expect(lines.some(l => /cheap shop/i.test(l))).toBe(true);
  });

  it("SLUM lists the per-faint money loss", () => {
    const lines = getErBiomeEffectLines(BiomeId.SLUM);
    expect(lines.some(l => /lose 2% money per ally that faints/i.test(l))).toBe(true);
  });

  it("LAKE lists the berry-save AND the per-turn heal", () => {
    const lines = getErBiomeEffectLines(BiomeId.LAKE);
    expect(lines.some(l => /keep an eaten berry/i.test(l))).toBe(true);
    expect(lines.some(l => /party heals a little each turn/i.test(l))).toBe(true);
  });

  it("FAIRY_CAVE keeps its blessing AND now lists Misty terrain", () => {
    const lines = getErBiomeEffectLines(BiomeId.FAIRY_CAVE);
    expect(lines).toContain("Misty terrain");
    expect(lines.some(l => /no infatuation/i.test(l))).toBe(true);
  });

  it("caps the list at six lines and never emits an em dash", () => {
    for (const biome of Object.values(BiomeId)) {
      if (typeof biome !== "number") {
        continue;
      }
      const lines = getErBiomeEffectLines(biome);
      expect(lines.length).toBeLessThanOrEqual(6);
      for (const l of lines) {
        expect(l.includes("—"), `em dash in "${l}"`).toBe(false);
      }
    }
  });
});
