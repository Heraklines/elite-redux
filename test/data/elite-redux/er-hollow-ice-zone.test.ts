import { ForceSwitchOutHelper } from "#abilities/ab-attrs";
import { SelfSwitchOnMoveTypeAbAttr } from "#data/elite-redux/archetypes/self-switch-on-move-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { describe, expect, it, vi } from "vitest";

/**
 * Hollow Ice Zone — "Ice-type moves apply Ice Statue and then make the user
 * switch." The ER_FROSTBITE-on-attack tag is covered by the bleed/frostbite
 * status suite; here we verify the self-switch-on-Ice-move piece in isolation.
 */
describe("ER ability - Hollow Ice Zone (self-switch on Ice move)", () => {
  const makeParams = (moveType: PokemonType, hitResult: HitResult, hitsLeft = 1) => {
    const move = { category: MoveCategory.SPECIAL } as any;
    const pokemon = {
      getMoveType: () => moveType,
      turnData: { hitsLeft },
    } as any;
    return { pokemon, opponent: {} as any, move, hitResult, simulated: false } as any;
  };

  it("switches out after a damaging Ice-type move connects", () => {
    const spy = vi.spyOn(ForceSwitchOutHelper.prototype, "switchOutLogic").mockReturnValue(true);
    const attr = new SelfSwitchOnMoveTypeAbAttr(PokemonType.ICE);
    const params = makeParams(PokemonType.ICE, HitResult.EFFECTIVE);

    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("does NOT switch on a non-Ice move", () => {
    const attr = new SelfSwitchOnMoveTypeAbAttr(PokemonType.ICE);
    expect(attr.canApply(makeParams(PokemonType.FIRE, HitResult.EFFECTIVE))).toBe(false);
  });

  it("does NOT switch when the move had no effect", () => {
    const attr = new SelfSwitchOnMoveTypeAbAttr(PokemonType.ICE);
    expect(attr.canApply(makeParams(PokemonType.ICE, HitResult.NO_EFFECT))).toBe(false);
  });

  it("waits for the final hit of a multi-hit move", () => {
    const attr = new SelfSwitchOnMoveTypeAbAttr(PokemonType.ICE);
    expect(attr.canApply(makeParams(PokemonType.ICE, HitResult.EFFECTIVE, 2))).toBe(false);
    expect(attr.canApply(makeParams(PokemonType.ICE, HitResult.EFFECTIVE, 1))).toBe(true);
  });
});
