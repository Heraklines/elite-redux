import { globalScene } from "#app/global-scene";
import { MoveChargeAnim } from "#data/battle-anims";
import { erTryQuickeningGrace } from "#data/elite-redux/abilities/quickening-grace";
import { erRecordAchievementChargeMove } from "#data/elite-redux/er-achievement-tracker";
import { erTryConsumePowerHerb } from "#data/elite-redux/er-community-items";
import type { AbilityId } from "#enums/ability-id";
import type { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveResult } from "#enums/move-result";
import type { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import { applyMoveChargeAttrs } from "#moves/apply-attrs";
import type { PokemonMove } from "#moves/pokemon-move";
import { PokemonPhase } from "#phases/pokemon-phase";
import type { ChargingMove } from "#types/move-types";
import { BooleanHolder } from "#utils/common";

/**
 * Phase for the "charging turn" of two-turn moves (e.g. Dig).
 */
export class MoveChargePhase extends PokemonPhase {
  public readonly phaseName = "MoveChargePhase";
  /** The move instance that this phase applies */
  public move: PokemonMove;
  /** The field index targeted by the move (Charging moves assume single target) */
  public targetIndex: BattlerIndex;

  /** The {@linkcode MoveUseMode} of the move that triggered the charge; passed on from move phase */
  private useMode: MoveUseMode;

  /**
   * Create a new MoveChargePhase.
   * @param battlerIndex - The {@linkcode BattlerIndex} of the user.
   * @param targetIndex - The {@linkcode BattlerIndex} of the target.
   * @param move - The {@linkcode PokemonMove} being used
   * @param useMode - The move's {@linkcode MoveUseMode}
   */
  constructor(battlerIndex: BattlerIndex, targetIndex: BattlerIndex, move: PokemonMove, useMode: MoveUseMode) {
    super(battlerIndex);
    this.move = move;
    this.targetIndex = targetIndex;
    this.useMode = useMode;
  }

  public override start() {
    super.start();

    const user = this.getUserPokemon();
    const target = this.getTargetPokemon();
    const move = this.move.getMove();

    // If the target is somehow not defined, or the move is somehow not a ChargingMove,
    // immediately end this phase.
    if (!target || !move.isChargingMove()) {
      console.warn("Invalid parameters for MoveChargePhase");
      super.end();
      return;
    }

    new MoveChargeAnim(move.chargeAnim, move.id, user).play(false, () => {
      move.showChargeText(user, target);

      applyMoveChargeAttrs("MoveEffectAttr", user, target, move);
      user.addTag(BattlerTagType.CHARGING, 1, move.id, user.id);
      this.end();
    });
  }

  /** Checks the move's instant charge conditions, then ends this phase. */
  public override end() {
    const user = this.getUserPokemon();
    // Checked for `ChargingMove` in `this.start()`
    const move = this.move.getMove() as ChargingMove;

    const instantCharge = new BooleanHolder(false);
    applyMoveChargeAttrs("InstantChargeAttr", user, null, move, instantCharge);

    // ER Power Herb (#401): spend one herb charge to skip the charge turn.
    if (!instantCharge.value && erTryConsumePowerHerb(user)) {
      instantCharge.value = true;
    }

    // ER Accelerate (#449, ability 474 - "Moves that need a charge turn are now
    // used instantly"): the holder skips EVERY charge turn, free. Handled here at
    // the real charge-resolution point (the same hook Power Herb uses) - the prior
    // PreAttack tag-removal approach never actually skipped the charge.
    if (!instantCharge.value && user?.hasAbility(ErAbilityId.ACCELERATE as unknown as AbilityId)) {
      instantCharge.value = true;
    }

    // ER Quickening Grace (5913, Mega Xerneas): once per turn, an ally's ability
    // lets THIS user's first attacking two-turn charge move fire immediately.
    // Status charge moves (Geomancy) and recharge moves are excluded inside the
    // helper / by never reaching this phase.
    if (!instantCharge.value && erTryQuickeningGrace(user, move)) {
      instantCharge.value = true;
    }
    erRecordAchievementChargeMove(user, move.id, instantCharge.value);

    // If instantly charging, remove the pending MoveEndPhase and queue a new MovePhase for the "attack" portion of the move.
    // Otherwise, add the attack portion to the user's move queue to execute next turn.
    // TODO: This checks status twice for a single-turn usage...
    if (instantCharge.value) {
      globalScene.phaseManager.tryRemovePhase("MoveEndPhase", phase => phase.getPokemon() === user);
      globalScene.phaseManager.unshiftNew("MovePhase", user, [this.targetIndex], this.move, this.useMode);
    } else {
      user.pushMoveQueue({ move: move.id, targets: [this.targetIndex], useMode: this.useMode });
    }

    // Add this move's charging phase to the user's move history
    user.pushMoveHistory({
      move: this.move.moveId,
      targets: [this.targetIndex],
      result: MoveResult.OTHER,
      useMode: this.useMode,
    });

    super.end();
  }

  public getUserPokemon(): Pokemon {
    return (this.player ? globalScene.getPlayerField() : globalScene.getEnemyField())[this.fieldIndex];
  }

  public getTargetPokemon(): Pokemon | undefined {
    return globalScene.getField(true).find(p => this.targetIndex === p.getBattlerIndex());
  }
}
