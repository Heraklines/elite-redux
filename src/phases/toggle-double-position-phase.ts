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

    // Triple+ battles (playerCapacity >= 3): the binary single/double logic below only
    // repositions the FIRST active mon and swaps party[0]/[1] when it sits at field index 1.
    // That scrambles a 3-mon party and leaves the other leads stacked - e.g. after a lead
    // faints the RIGHT lead can stay pinned on CENTER, hidden behind the middle mon (reads
    // in-game as "a lead's sprite vanished"). Instead reposition EVERY on-field lead to the
    // slot its field index maps to (LEFT / CENTER / RIGHT ...), with no party reorder.
    // Idempotent: setFieldPosition no-ops when a mon is already in place.
    const capacity = globalScene.currentBattle?.arrangement.playerCapacity ?? 1;
    if (this.double && capacity >= 3) {
      const onField = globalScene.getPlayerField().filter(p => p.isActive(true));
      if (onField.length === 0) {
        this.end();
        return;
      }
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
