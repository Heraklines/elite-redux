/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  getErBiomeBackgroundSets,
  getErBiomeBackgroundTextureKeys,
  resolveErBiomeBackground,
  selectErBiomeBackgroundSetIndex,
} from "#data/elite-redux/er-biome-backgrounds";
import { BiomeId } from "#enums/biome-id";
import { TimeOfDay } from "#enums/time-of-day";
import { describe, expect, it } from "vitest";

describe("ER biome background registry", () => {
  it("replaces every formerly placeholder-only biome", () => {
    const upgradedBiomes = [
      BiomeId.CONSTRUCTION_SITE,
      BiomeId.FACTORY,
      BiomeId.FAIRY_CAVE,
      BiomeId.LABORATORY,
      BiomeId.METROPOLIS,
      BiomeId.SEABED,
      BiomeId.SLUM,
      BiomeId.SWAMP,
    ];

    for (const biomeId of upgradedBiomes) {
      expect(getErBiomeBackgroundSets(biomeId).length).toBeGreaterThan(0);
    }
  });

  it("resolves painted day, dusk, and night frames without shader tint", () => {
    expect(resolveErBiomeBackground(BiomeId.METROPOLIS, 0, TimeOfDay.DAWN)).toEqual({
      textureKey: "metropolis_bg",
      ignoreTimeTint: true,
    });
    expect(resolveErBiomeBackground(BiomeId.METROPOLIS, 0, TimeOfDay.DUSK)).toEqual({
      textureKey: "metropolis_bg_dusk",
      ignoreTimeTint: true,
    });
    expect(resolveErBiomeBackground(BiomeId.METROPOLIS, 0, TimeOfDay.NIGHT)).toEqual({
      textureKey: "metropolis_bg_night",
      ignoreTimeTint: true,
    });
  });

  it("keeps indoor single-frame art untinted", () => {
    expect(resolveErBiomeBackground(BiomeId.LABORATORY, 1, TimeOfDay.NIGHT)).toEqual({
      textureKey: "laboratory_bg_destroyed",
      ignoreTimeTint: true,
    });
  });

  it("selects one stable, in-range scene per run and biome visit", () => {
    const first = selectErBiomeBackgroundSetIndex(BiomeId.METROPOLIS, "same-seed", 27);
    expect(selectErBiomeBackgroundSetIndex(BiomeId.METROPOLIS, "same-seed", 27)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(getErBiomeBackgroundSets(BiomeId.METROPOLIS).length);

    const selections = new Set(
      Array.from({ length: 40 }, (_, index) =>
        selectErBiomeBackgroundSetIndex(BiomeId.METROPOLIS, `seed-${index}`, 27),
      ),
    );
    expect(selections.size).toBe(getErBiomeBackgroundSets(BiomeId.METROPOLIS).length);
  });

  it("preloads each texture key once per biome", () => {
    for (const biomeId of Object.values(BiomeId)) {
      const keys = getErBiomeBackgroundTextureKeys(biomeId);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("falls back to the legacy biome key when no custom set exists", () => {
    expect(resolveErBiomeBackground(BiomeId.PLAINS, 0, TimeOfDay.DAY)).toBeNull();
  });
});
