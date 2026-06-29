import { ErSilkenDecreeTag } from "#data/battler-tags";
import { allAbilities } from "#data/data-lists";
import { ER_SILKEN_DECREE_ABILITY_ID, SilkenDecreeAbAttr } from "#data/elite-redux/abilities/silken-decree";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import { describe, expect, it } from "vitest";

function mockPokemon(moveIds: readonly MoveId[]): Pokemon {
  let next = 0;
  return {
    getMoveset: () => moveIds.map(moveId => ({ moveId, isOutOfPp: () => false })),
    randBattleSeedInt: (range: number) => {
      const value = next % range;
      next++;
      return value;
    },
  } as unknown as Pokemon;
}

describe("Silken Decree", () => {
  it("registers as a custom ability with the Silken Decree attr", () => {
    const ability = allAbilities[ER_SILKEN_DECREE_ABILITY_ID];

    expect(ability).toBeDefined();
    expect(ability?.name).toBe("Silken Decree");
    expect(ability?.attrs.some(attr => attr instanceof SilkenDecreeAbAttr)).toBe(true);
  });

  it("seals two random usable moves while leaving at least one move available", () => {
    const tag = new ErSilkenDecreeTag(1);
    const pokemon = mockPokemon([MoveId.TACKLE, MoveId.GROWL, MoveId.SPLASH, MoveId.STRING_SHOT]);

    expect(tag.canAdd(pokemon)).toBe(true);
    tag.onAdd(pokemon);

    expect(tag.moveIds).toHaveLength(2);
    expect(new Set(tag.moveIds).size).toBe(2);
    const unsealed = [MoveId.TACKLE, MoveId.GROWL, MoveId.SPLASH, MoveId.STRING_SHOT].filter(
      moveId => !tag.isMoveRestricted(moveId),
    );
    expect(unsealed.length).toBe(2);
  });

  it("does not seal every move on a two-move set", () => {
    const tag = new ErSilkenDecreeTag(1);
    const pokemon = mockPokemon([MoveId.TACKLE, MoveId.GROWL]);

    expect(tag.canAdd(pokemon)).toBe(true);
    tag.onAdd(pokemon);

    expect(tag.moveIds).toHaveLength(1);
    expect([MoveId.TACKLE, MoveId.GROWL].some(moveId => !tag.isMoveRestricted(moveId))).toBe(true);
  });

  it("does not apply when only one usable move exists", () => {
    const tag = new ErSilkenDecreeTag(1);

    expect(tag.canAdd(mockPokemon([MoveId.TACKLE]))).toBe(false);
  });

  it("expires at the next turn end", () => {
    const tag = new ErSilkenDecreeTag(1);
    const pokemon = mockPokemon([MoveId.TACKLE, MoveId.GROWL, MoveId.SPLASH, MoveId.STRING_SHOT]);
    tag.onAdd(pokemon);

    expect(tag.lapse(pokemon, BattlerTagLapseType.TURN_END)).toBe(false);
  });
});
