import { globalScene } from "#app/global-scene";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { settleCoopTrainerPresentation } from "#data/elite-redux/coop/coop-field-presentation";
import { PlayerGender } from "#enums/player-gender";
import { BattlePhase } from "#phases/battle-phase";

export class ShowTrainerPhase extends BattlePhase {
  public readonly phaseName = "ShowTrainerPhase";
  start() {
    super.start();

    // The authoritative renderer blocks ReturnPhase because it resets summon state, so the player Pokemon
    // can still be visibly fielded when the locally-built post-battle tail reaches ShowTrainerPhase. Showing
    // the trainer over those sprites creates the stale overlay seen between wild/trainer waves. Settle the
    // renderer's absolute hidden/alpha-ready trainer postcondition and end without constructing a tween.
    if (isCoopAuthoritativeGuestGated()) {
      settleCoopTrainerPresentation("player");
      this.end();
      return;
    }

    globalScene.trainer
      .setVisible(true)
      .setTexture(`trainer_${globalScene.gameData.gender === PlayerGender.FEMALE ? "f" : "m"}_back`);

    globalScene.tweens.add({
      targets: globalScene.trainer,
      x: 106,
      duration: 1000,
      onComplete: () => this.end(),
    });
  }
}
