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
