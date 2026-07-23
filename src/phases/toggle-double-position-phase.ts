import { globalScene } from "#app/global-scene";
import { fieldPositionForSlot } from "#data/battle-format";
import { FieldPosition } from "#enums/field-position";
import { BattlePhase } from "#phases/battle-phase";

export class ToggleDoublePositionPhase extends BattlePhase {
  public readonly phaseName = "ToggleDoublePositionPhase";
  private double: boolean;

  constructor(double: boolean) {
    super();

    this.double = double;
  }

  start() {
    super.start();

    // Reconcile EVERY occupied slot whenever at least two leads are already present. This
    // is required for triple -> double transitions: slot 1 used to retain triple's CENTER
    // lane because the binary path only touched slot 0, leaving the next 2v2 visually
    // stacked and its battle-info bar in triple scale/offset. Triple -> triple needs the
    // same all-slot repair after faint/replacement churn. The one-lead path below remains
    // responsible for party compaction while a second lead is still being summoned.
    const capacity = globalScene.currentBattle?.arrangement.playerCapacity ?? 1;
    const onField = globalScene.getPlayerField().filter(p => p.isActive(true));
    if (this.double && capacity > 1 && onField.length > 1) {
      Promise.all(onField.map(p => p.setFieldPosition(fieldPositionForSlot(p.getFieldIndex(), capacity), 500))).then(
        () => this.end(),
      );
      return;
    }

    const playerPokemon = globalScene.getPlayerField().find(p => p.isActive(true));
    if (playerPokemon) {
      playerPokemon
        .setFieldPosition(
          this.double && globalScene.getPokemonAllowedInBattle().length > 1 ? FieldPosition.LEFT : FieldPosition.CENTER,
          500,
        )
        .then(() => {
          if (playerPokemon.getFieldIndex() === 1) {
            const party = globalScene.getPlayerParty();
            party[1] = party[0];
            party[0] = playerPokemon;
          }
          this.end();
        });
    } else {
      this.end();
    }
  }
}
