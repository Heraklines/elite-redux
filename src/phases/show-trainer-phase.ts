import { globalScene } from "#app/global-scene";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import {
  getActuallyFieldedCoopPokemon,
  settleCoopSwitchActorPresentation,
  settleCoopTrainerPresentation,
} from "#data/elite-redux/coop/coop-field-presentation";
import { observeCoopPlayerTrainerTransition } from "#data/elite-redux/coop/coop-trainer-transition-observer";
import { PlayerGender } from "#enums/player-gender";
import { BattlePhase } from "#phases/battle-phase";

export class ShowTrainerPhase extends BattlePhase {
  public readonly phaseName = "ShowTrainerPhase";
  private readonly coopProjectedBattle: typeof globalScene.currentBattle | null;

  constructor(private readonly coopProjectedPresentation = false) {
    super();
    this.coopProjectedBattle = coopProjectedPresentation ? globalScene.currentBattle : null;
  }

  start() {
    super.start();
    let projectedPlayerField: ReturnType<typeof getActuallyFieldedCoopPokemon> = [];

    // The authoritative renderer blocks ReturnPhase because it resets summon state. Mirror only its visual
    // postcondition before showing the normal player-trainer transition: keep every Pokemon structurally
    // seated, but hide its sprite/info children until EncounterPhase's authoritative presentation projector
    // reveals the exact destination field. The previous shortcut hid the trainer too, so only the guest
    // skipped this transition entirely.
    if (isCoopAuthoritativeGuestGated()) {
      // Only the signed destination tail may opt the renderer into this positive cue. A stale locally-derived
      // ShowTrainerPhase, or one whose Battle identity was replaced before it ran, retains the fail-closed
      // hidden postcondition instead of painting an unrelated transition over live command control.
      if (!this.coopProjectedPresentation || globalScene.currentBattle !== this.coopProjectedBattle) {
        settleCoopTrainerPresentation("player");
        this.end();
        return;
      }
      projectedPlayerField = getActuallyFieldedCoopPokemon("player");
      const hiddenIds = projectedPlayerField.map(pokemon => {
        settleCoopSwitchActorPresentation(globalScene, pokemon, "hidden");
        return pokemon.id;
      });
      coopLog("renderer", `guest player-trainer transition hid field presentation ids=[${hiddenIds.join(",")}]`);
    }

    globalScene.trainer
      .setVisible(true)
      .setAlpha(1)
      .setTexture(`trainer_${globalScene.gameData.gender === PlayerGender.FEMALE ? "f" : "m"}_back`);

    if (projectedPlayerField.length > 0) {
      observeCoopPlayerTrainerTransition({
        wave: globalScene.currentBattle.waveIndex,
        trainerVisible: globalScene.trainer.visible,
        trainerAlpha: globalScene.trainer.alpha,
        trainerPresented: globalScene.trainer.visible && globalScene.trainer.alpha > 0.001,
        playerField: projectedPlayerField.map(pokemon => ({
          pokemonId: pokemon.id,
          onField: pokemon.isOnField(),
          pokemonVisible: pokemon.visible,
          spriteVisible: pokemon.getSprite()?.visible === true,
          infoVisible: pokemon.getBattleInfo()?.visible === true,
        })),
      });
    }

    globalScene.tweens.add({
      targets: globalScene.trainer,
      x: 106,
      duration: 1000,
      onComplete: () => this.end(),
    });
  }
}
