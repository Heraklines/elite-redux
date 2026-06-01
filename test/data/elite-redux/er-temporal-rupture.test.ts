import { SetTargetAbilityOnMoveAbAttr } from "#data/elite-redux/archetypes/set-target-ability-on-move";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { describe, expect, it } from "vitest";

/**
 * Temporal Rupture — "Roar of Time changes the target's Ability to Slow Start."
 * Verifies the gating of the ability-setting rider (move-id, hit connected,
 * target not already Slow Start).
 */
describe("ER ability - Temporal Rupture (set target ability on Roar of Time)", () => {
  const attr = new SetTargetAbilityOnMoveAbAttr(MoveId.ROAR_OF_TIME, AbilityId.SLOW_START);
  const target = (abilityId: AbilityId, fainted = false) =>
    ({ isFainted: () => fainted, getAbility: () => ({ id: abilityId }) }) as any;
  const params = (moveId: MoveId, opp: any, hitResult = HitResult.EFFECTIVE) =>
    ({ move: { id: moveId, category: MoveCategory.SPECIAL }, opponent: opp, hitResult, simulated: false }) as any;

  it("fires when Roar of Time connects on a target that isn't already Slow Start", () => {
    expect(attr.canApply(params(MoveId.ROAR_OF_TIME, target(AbilityId.PRESSURE)))).toBe(true);
  });

  it("does NOT fire for a different move", () => {
    expect(attr.canApply(params(MoveId.DRAGON_PULSE, target(AbilityId.PRESSURE)))).toBe(false);
  });

  it("does NOT re-apply when the target already has Slow Start", () => {
    expect(attr.canApply(params(MoveId.ROAR_OF_TIME, target(AbilityId.SLOW_START)))).toBe(false);
  });

  it("does NOT fire on a missed / no-effect hit or a fainted target", () => {
    expect(attr.canApply(params(MoveId.ROAR_OF_TIME, target(AbilityId.PRESSURE), HitResult.NO_EFFECT))).toBe(false);
    expect(attr.canApply(params(MoveId.ROAR_OF_TIME, target(AbilityId.PRESSURE, true)))).toBe(false);
  });
});
