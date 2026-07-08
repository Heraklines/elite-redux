import { applyAbAttrs, applyPostSummonPassiveAbAttrs } from "#abilities/apply-ab-attrs";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
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
    // SHOWDOWN versus GUEST (2026-07-08 turn-1/switch-in summon desync): the pure-renderer versus guest
    // boots from the host's launch snapshot and runs its OWN summon chain, so it would DERIVE each lead's
    // on-entry ability effect. That derivation is NOT identical to the host's, because ER gates innates by
    // SIDE (enemy innates always active, player innates candy-gated) and the SAME team is the host's PLAYER
    // but the guest's local ENEMY - so a team mon's entry innate fires on one client and is gated off on
    // the other. The guest must resolve NOTHING; it renders the host's authoritative post-summon (the
    // streamed `summonAbility` cues + the checkpoint). Skip the application entirely (occupy the queue slot,
    // end immediately). Versus-guest ONLY (isShowdownGuestFlip), so CO-OP guests - which reach their battle
    // through the full lockstep launch, not an independent summon - are byte-for-byte unaffected.
    if (isShowdownGuestFlipGated()) {
      this.end();
      return;
    }
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
