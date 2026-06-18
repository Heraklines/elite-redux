import { ER_GEM_TIER, erGemItemType } from "#data/elite-redux/er-elemental-gems";
import { ER_REACTIVE_TIER, erReactiveItemType } from "#data/elite-redux/er-reactive-items";
import { ER_SEED_TIER, erSeedItemType } from "#data/elite-redux/er-terrain-seeds";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

/**
 * The imported items (5 reactive / 4 seeds / 18 gems) are registered in
 * `modifierTypes` (ER_CELL_BATTERY / ER_FIRE_GEM / ... - tsc-checked, and the
 * boot test confirms no import-cycle crash). Here we assert the factories the
 * registry keys call produce a correctly-named, correctly-tiered type, so a
 * player-owned copy renders + round-trips through save.
 */
describe("imported-item factories (registry targets)", () => {
  it("reactive items are named + Ultra tier", () => {
    const t = erReactiveItemType("cellBattery");
    expect(t.name).toBe("Cell Battery");
    expect(t.tier).toBe(ER_REACTIVE_TIER);
    expect(erReactiveItemType("weaknessPolicy").name).toBe("Weakness Policy");
  });

  it("terrain seeds are named + Great tier", () => {
    const t = erSeedItemType("electricSeed");
    expect(t.name).toBe("Electric Seed");
    expect(t.tier).toBe(ER_SEED_TIER);
  });

  it("elemental gems are named per type + Great tier", () => {
    const fire = erGemItemType(PokemonType.FIRE);
    expect(fire.name).toBe("Fire Gem");
    expect(fire.tier).toBe(ER_GEM_TIER);
    expect(erGemItemType(PokemonType.FAIRY).name).toBe("Fairy Gem");
  });
});
