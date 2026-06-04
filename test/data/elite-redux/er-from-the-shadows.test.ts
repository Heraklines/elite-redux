import { MovingFirstTrapFlinchAbAttr } from "#data/elite-redux/archetypes/moving-first-trap-flinch";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { describe, expect, it, vi } from "vitest";

/**
 * From the Shadows — "Attacks trap and have a 20% flinch chance when moving
 * first." Verifies the moving-first gate (target hasn't acted) and that trap is
 * unconditional while flinch is a separate roll.
 */
describe("ER ability - From the Shadows (moving-first trap + flinch)", () => {
  const move = { category: MoveCategory.PHYSICAL } as any;

  const makeParams = (targetActed: boolean, roll: number, hitResult = HitResult.EFFECTIVE) => {
    const addTag = vi.fn();
    const pokemon = { id: 1, turnData: { hitsLeft: 1 }, randBattleSeedInt: () => roll } as any;
    const target = { turnData: { acted: targetActed }, addTag } as any;
    return { params: { pokemon, opponent: target, move, hitResult, simulated: false } as any, addTag };
  };

  it("does NOT fire when the holder moved second (target already acted)", () => {
    const attr = new MovingFirstTrapFlinchAbAttr(20);
    const { params } = makeParams(true, 0);
    expect(attr.canApply(params)).toBe(false);
  });

  it("traps (always) and flinches (roll < 20) when moving first", () => {
    const attr = new MovingFirstTrapFlinchAbAttr(20);
    const { params, addTag } = makeParams(false, 10); // roll 10 < 20 -> flinch
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(addTag).toHaveBeenCalledWith(BattlerTagType.TRAPPED, 4, undefined, 1);
    expect(addTag).toHaveBeenCalledWith(BattlerTagType.FLINCHED, 1, undefined, 1);
  });

  it("traps but does NOT flinch when the roll fails (>= 20)", () => {
    const attr = new MovingFirstTrapFlinchAbAttr(20);
    const { params, addTag } = makeParams(false, 50); // roll 50 -> no flinch
    attr.apply(params);
    expect(addTag).toHaveBeenCalledWith(BattlerTagType.TRAPPED, 4, undefined, 1);
    expect(addTag).not.toHaveBeenCalledWith(BattlerTagType.FLINCHED, 1, undefined, 1);
  });

  it("does NOT fire on a no-effect hit", () => {
    const attr = new MovingFirstTrapFlinchAbAttr(20);
    const { params } = makeParams(false, 0, HitResult.NO_EFFECT);
    expect(attr.canApply(params)).toBe(false);
  });
});
