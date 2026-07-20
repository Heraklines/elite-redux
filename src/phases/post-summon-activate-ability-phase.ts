import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import type { BattlerIndex } from "#enums/battler-index";
import { PostSummonPhase } from "#phases/post-summon-phase";

/**
 * Helper to {@linkcode PostSummonPhase} which applies abilities
 */
export class PostSummonActivateAbilityPhase extends PostSummonPhase {
  private readonly priority: number;
  private readonly passiveSlot: number | undefined;

  constructor(battlerIndex: BattlerIndex, priority: number, passiveSlot?: number) {
    super(battlerIndex);
    this.priority = priority;
    this.passiveSlot = passiveSlot;
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
    const passive = this.passiveSlot !== undefined;
    applyAbAttrs("PostSummonAbAttr", {
      pokemon: this.getPokemon(),
      passive,
      passiveSlot: this.passiveSlot,
    });

    this.end();
  }

  public override getPriority() {
    return this.priority;
  }
}
