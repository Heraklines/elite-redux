import { ER_BIOME_ITEM_FLAVOR, getErBiomeItemFlavor } from "#data/elite-redux/er-biome-item-flavor";
import { BiomeId } from "#enums/biome-id";
import { getModifierTypeFuncById } from "#modifiers/modifier-type";
import { describe, expect, it } from "vitest";

describe("er-biome-item-flavor (on-mon distribution)", () => {
  it("themes each biome's pool to its identity", () => {
    expect(getErBiomeItemFlavor(BiomeId.VOLCANO)?.pool).toContain("ER_FIRE_GEM");
    expect(getErBiomeItemFlavor(BiomeId.POWER_PLANT)?.pool).toContain("ER_CELL_BATTERY");
    expect(getErBiomeItemFlavor(BiomeId.ICE_CAVE)?.pool).toContain("ER_SNOWBALL");
    expect(getErBiomeItemFlavor(BiomeId.GRAVEYARD)?.pool).toContain("ER_GHOST_GEM");
  });

  it("item-rich biomes carry a higher chance than ambient ones", () => {
    expect(getErBiomeItemFlavor(BiomeId.FACTORY)!.chance).toBeGreaterThan(
      getErBiomeItemFlavor(BiomeId.MOUNTAIN)!.chance,
    );
  });

  it("every entry has a non-empty pool and a sane chance", () => {
    for (const f of Object.values(ER_BIOME_ITEM_FLAVOR)) {
      expect(f.pool.length).toBeGreaterThan(0);
      expect(f.chance).toBeGreaterThan(0);
      expect(f.chance).toBeLessThanOrEqual(100);
      expect(f.pool.every(k => k.startsWith("ER_"))).toBe(true);
    }
  });

  it("every lazily resolved flavor factory self-pins the exact registry id", () => {
    const keys = new Set(Object.values(ER_BIOME_ITEM_FLAVOR).flatMap(flavor => flavor.pool));
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      const factory = getModifierTypeFuncById(key);
      expect(factory, key).toBeDefined();
      expect(factory!().id, `${key} must survive direct trainer-flavor construction`).toBe(key);
    }
  });
});
