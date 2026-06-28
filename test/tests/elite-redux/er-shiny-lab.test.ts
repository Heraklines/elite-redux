/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  bitsetToErShinyLabAvailableSet,
  buildErShinyLabPaletteMap,
  buildErShinyLabVariantPalette,
  decodeErShinyLabLoadout,
  decodeErShinyLabParams,
  ER_SHINY_LAB_EFFECTS_BY_CATEGORY,
  type ErShinyLabConfig,
  type ErShinyLabEffect,
  type ErShinyLabSaveData,
  encodeErShinyLabLoadout,
  encodeErShinyLabParams,
  encodeErShinyLabPreset,
  getErShinyLabEffectCost,
  getErShinyLabOwnedSet,
  mergeErShinyLabSaveData,
  resolveErShinyLabEffectState,
  setErShinyLabBit,
  setErShinyLabOwnedBit,
} from "#data/elite-redux/er-shiny-lab-effects";
import { getErShinyLabVariantCacheKey, variantColorCache } from "#sprites/variant";
import { describe, expect, it } from "vitest";

type VariantPaletteCache = Record<string, Record<number, Record<string, string>>>;

function configFor(
  effect: ErShinyLabEffect,
): Pick<ErShinyLabConfig, "earnedTier" | "candy" | "owned" | "available" | "equipped"> {
  return {
    earnedTier: effect.minTier,
    candy: effect.cost,
    owned: { palette: new Set(), surface: new Set(), around: new Set() },
    available: new Set(effect.lockHint ? [effect.id] : []),
    equipped: { palette: null, surface: null, around: null },
  };
}

describe("ER Shiny Lab data layer", () => {
  it("resolves the tier, availability, owned, and candy gates in order", () => {
    const effect: ErShinyLabEffect = {
      id: "spectrumsplit",
      label: "Prism Split",
      category: "surface",
      rarity: "legendary",
      minTier: 3,
      cost: 500,
      accent: "#9ad0ff",
      lockHint: "clear Prism Break",
    };
    const base = configFor(effect);

    expect(resolveErShinyLabEffectState({ ...base, effect, category: "surface", earnedTier: 2 })).toBe("locked-tier");
    expect(
      resolveErShinyLabEffectState({
        ...base,
        effect,
        category: "surface",
        available: new Set(),
      }),
    ).toBe("locked-achv");
    expect(resolveErShinyLabEffectState({ ...base, effect, category: "surface", candy: 0 })).toBe("locked-candy");
    expect(resolveErShinyLabEffectState({ ...base, effect, category: "surface" })).toBe("buyable");

    const owned = { ...base.owned, surface: new Set([effect.id]) };
    expect(resolveErShinyLabEffectState({ ...base, effect, category: "surface", owned })).toBe("owned");
    expect(
      resolveErShinyLabEffectState({
        ...base,
        effect,
        category: "surface",
        owned,
        equipped: { palette: null, surface: effect.id, around: null },
      }),
    ).toBe("equipped");
  });

  it("prices category ramps, species discounts, and achievement discounts", () => {
    const glacier = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette.find(e => e.id === "glacier")!;
    const aurum = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette.find(e => e.id === "aurum")!;

    expect(
      getErShinyLabEffectCost({
        definition: glacier,
        ownedCount: 0,
        globallyAvailable: false,
        speciesDiscounted: false,
      }),
    ).toBe(100);
    expect(
      getErShinyLabEffectCost({
        definition: glacier,
        ownedCount: 2,
        globallyAvailable: false,
        speciesDiscounted: false,
      }),
    ).toBe(180);
    expect(
      getErShinyLabEffectCost({
        definition: glacier,
        ownedCount: 0,
        globallyAvailable: false,
        speciesDiscounted: true,
      }),
    ).toBe(60);
    expect(
      getErShinyLabEffectCost({
        definition: aurum,
        ownedCount: 2,
        globallyAvailable: true,
        speciesDiscounted: true,
      }),
    ).toBe(90);
  });

  it("builds deterministic palette maps and variant maps for the shader path", () => {
    const baseHexes = ["005273", "94c5ff", "4a84d6", "6badf7", "003152", "007bbd", "5a3a19"];
    const first = buildErShinyLabPaletteMap(baseHexes, "glacier");
    const second = buildErShinyLabPaletteMap(baseHexes, "glacier");

    expect(first).toEqual(second);
    expect(Object.keys(first)).toEqual(baseHexes);
    expect(first["005273"]).not.toBe("005273");

    const variant = buildErShinyLabVariantPalette({ 0: Object.fromEntries(baseHexes.map(h => [h, h])) }, "aurum", 2);
    expect(variant[0]).toEqual(variant[1]);
    expect(variant[1]).toEqual(variant[2]);
    expect(Object.keys(variant[2])).toEqual(baseHexes);
  });

  it("stores Shiny Lab palette variants under the raw sprite pipeline cache key", () => {
    const baseKey = "pkmn__articuno";
    const cacheKey = getErShinyLabVariantCacheKey(baseKey, "glacier");
    const cache = variantColorCache as VariantPaletteCache;
    const baseHexes = ["005273", "94c5ff", "4a84d6", "6badf7", "003152", "007bbd", "5a3a19"];

    try {
      cache[baseKey] = { 0: Object.fromEntries(baseHexes.map(h => [h, h])) };
      cache[cacheKey] = buildErShinyLabVariantPalette(cache[baseKey], "glacier", 0);

      expect(cacheKey).toBe("pkmn__articuno-erlab-glacier");
      expect(cache[cacheKey][0]["005273"]).not.toBe("005273");
      expect(cache[cacheKey][0]).toEqual(cache[cacheKey][1]);
      expect(cache[cacheKey][1]).toEqual(cache[cacheKey][2]);
    } finally {
      delete cache[baseKey];
      delete cache[cacheKey];
    }
  });

  it("round-trips compact Shiny Lab save fields through JSON and merge helpers", () => {
    const paletteDef = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette.find(e => e.id === "glacier")!;
    const surfaceDef = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.surface.find(e => e.id === "spectrumsplit")!;
    const save: ErShinyLabSaveData = {};
    setErShinyLabOwnedBit(save, "palette", paletteDef.index);
    setErShinyLabOwnedBit(save, "surface", surfaceDef.index);
    save.l = encodeErShinyLabLoadout({ palette: "glacier", surface: "spectrumsplit", around: null });
    save.q = encodeErShinyLabParams({ palAmt: 0.75, surfAmt: 0.5, aroAmt: 1, scale: 1.2, seed: 77, tintMode: 1 });
    save.r = [
      encodeErShinyLabPreset({
        loadout: { palette: "glacier", surface: null, around: null },
        params: { palAmt: 1, surfAmt: 1, aroAmt: 1, scale: 1, seed: 9, tintMode: 0 },
      }),
      null,
      null,
      null,
      null,
    ];

    const serialized = JSON.stringify({
      erShinyLabAvailableEffects: setErShinyLabBit([], surfaceDef.index),
      starterData: { "1": { erShinyLab: save } },
    });
    const parsed = JSON.parse(serialized) as {
      erShinyLabAvailableEffects: number[];
      starterData: Record<string, { erShinyLab: ErShinyLabSaveData }>;
    };
    const parsedSave = parsed.starterData["1"].erShinyLab;

    expect(bitsetToErShinyLabAvailableSet(parsed.erShinyLabAvailableEffects).has("spectrumsplit")).toBe(true);
    expect(getErShinyLabOwnedSet(parsedSave, "palette").has("glacier")).toBe(true);
    expect(getErShinyLabOwnedSet(parsedSave, "surface").has("spectrumsplit")).toBe(true);
    expect(decodeErShinyLabLoadout(parsedSave.l)).toEqual({
      palette: "glacier",
      surface: "spectrumsplit",
      around: null,
    });
    expect(decodeErShinyLabParams(parsedSave.q).seed).toBe(77);

    const merged = mergeErShinyLabSaveData({}, parsedSave);
    expect(merged).toEqual(parsedSave);
  });
});
