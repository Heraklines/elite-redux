import { applyAbAttrs, applyPostSummonPassiveAbAttrs } from "#abilities/apply-ab-attrs";
import type { BattlerIndex } from "#enums/battler-index";
import { PostSummonPhase } from "#phases/post-summon-phase";

/**
 * Helper to {@linkcode PostSummonPhase} which applies abilities
 */
export class PostSummonActivateAbilityPhase extends PostSummonPhase {
  private readonly priority: number;
  private readonly passive: boolean;

  constructor(battlerIndex: BattlerIndex, priority: number, passive: boolean) {
    super(battlerIndex);
    this.priority = priority;
    this.passive = passive;
  }

  start() {
    if (this.passive) {
      // ER 3-innate model: apply EVERY non-empty passive slot, not just slot 0.
      // `applyAbAttrs(..., { passive: true })` with no slot defaults to slot 0,
      // which left innate slots 1/2 (e.g. Grimmsnarl's Intimidate/Scare) dead on
      // switch-in. This mirrors the form-change path's all-slots iteration.
      applyPostSummonPassiveAbAttrs(this.getPokemon());
    } else {
      applyAbAttrs("PostSummonAbAttr", { pokemon: this.getPokemon(), passive: false });
    }

    this.end();
  }

  public override getPriority() {
    return this.priority;
  }
}
