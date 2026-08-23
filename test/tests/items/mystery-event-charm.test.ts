import { modifierTypes } from "#data/data-lists";
import { HiddenAbilityRateBoosterModifier, MysteryEventRateBoosterModifier } from "#modifiers/modifier";
import { ModifierData } from "#system/modifier-data";
import { NumberHolder } from "#utils/common";
import { describe, expect, it } from "vitest";

describe("Mystery Event Charm", () => {
  const createCharm = () =>
    modifierTypes
      .ABILITY_CHARM()
      .withIdFromFunc(modifierTypes.ABILITY_CHARM)
      .newModifier() as MysteryEventRateBoosterModifier;

  it("doubles the Mystery Encounter rate", () => {
    const charm = createCharm();
    const rate = new NumberHolder(37.5);

    charm.apply(rate);

    expect(rate.value).toBe(75);
    expect(charm.getMaxStackCount()).toBe(1);
  });

  it("keeps the old Ability Charm modifier class compatible", () => {
    const charm = new ModifierData(
      {
        typeId: "ABILITY_CHARM",
        args: [],
        stackCount: 4,
        className: "HiddenAbilityRateBoosterModifier",
      },
      true,
    ).toModifier(HiddenAbilityRateBoosterModifier);

    expect(charm).toBeInstanceOf(MysteryEventRateBoosterModifier);
    expect(charm).toBeInstanceOf(HiddenAbilityRateBoosterModifier);
    expect(charm?.stackCount).toBe(1);
  });
});
