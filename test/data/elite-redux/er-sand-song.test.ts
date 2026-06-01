import { TypeConversionAbAttr, TypeConversionPowerBoostAbAttr } from "#data/elite-redux/archetypes/type-conversion";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it } from "vitest";

/**
 * Sand Song — "Sound moves get a 1.2x boost and become Ground if Normal."
 * Verifies the type-conversion + power-boost pair the archetype dispatch wires
 * for er 274.
 */
describe("ER ability - Sand Song (sound→Ground if Normal, +20%)", () => {
  const typeChange = new TypeConversionAbAttr({
    source: { kind: "flag", flag: MoveFlags.SOUND_BASED, requireType: PokemonType.NORMAL },
    newType: PokemonType.GROUND,
  });
  const boost = new TypeConversionPowerBoostAbAttr({
    source: { kind: "flag", flag: MoveFlags.SOUND_BASED },
    multiplier: 1.2,
  });

  const move = (type: PokemonType, sound: boolean) =>
    ({ type, hasFlag: (f: MoveFlags) => sound && f === MoveFlags.SOUND_BASED }) as any;

  it("converts a Normal sound move to Ground", () => {
    expect(typeChange.getNewType()).toBe(PokemonType.GROUND);
    expect(TypeConversionAbAttr.matchesSource(typeChange.getSource(), {} as any, move(PokemonType.NORMAL, true))).toBe(
      true,
    );
  });

  it("does NOT convert a non-Normal sound move", () => {
    expect(TypeConversionAbAttr.matchesSource(typeChange.getSource(), {} as any, move(PokemonType.WATER, true))).toBe(
      false,
    );
  });

  it("does NOT convert a Normal NON-sound move", () => {
    expect(TypeConversionAbAttr.matchesSource(typeChange.getSource(), {} as any, move(PokemonType.NORMAL, false))).toBe(
      false,
    );
  });

  it("boosts ALL sound moves by 1.2x regardless of type", () => {
    expect(boost.getMultiplier()).toBe(1.2);
    const water = { value: 100 };
    expect(
      boost.canApply({
        pokemon: {} as any,
        opponent: {} as any,
        move: move(PokemonType.WATER, true),
        power: water,
      } as any),
    ).toBe(true);
    boost.apply({ pokemon: {} as any, opponent: {} as any, move: move(PokemonType.WATER, true), power: water } as any);
    expect(water.value).toBeCloseTo(120, 5);
  });

  it("does NOT boost a non-sound move", () => {
    expect(
      boost.canApply({
        pokemon: {} as any,
        opponent: {} as any,
        move: move(PokemonType.NORMAL, false),
        power: { value: 100 },
      } as any),
    ).toBe(false);
  });
});
