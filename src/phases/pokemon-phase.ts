import { globalScene } from "#app/global-scene";
import { SideKind } from "#data/battle-format";
import { BattlerIndex } from "#enums/battler-index";
import type { Pokemon } from "#field/pokemon";
import { FieldPhase } from "#phases/field-phase";

export abstract class PokemonPhase extends FieldPhase {
  /**
   * The battler index this phase refers to, or the pokemon ID if greater than 3.
   * TODO: Make this either use IDs or `BattlerIndex`es, not a weird mix of both
   */
  protected battlerIndex: BattlerIndex | number;
  // TODO: Why is this needed?
  public player: boolean;
  /** @todo Remove in favor of `battlerIndex` pleas for fuck's sake */
  public fieldIndex: number;

  constructor(battlerIndex?: BattlerIndex | number) {
    super();

    battlerIndex =
      battlerIndex
      ?? globalScene
        .getField()
        .find(p => p?.isActive())
        ?.getBattlerIndex();
    if (battlerIndex === undefined) {
      // TODO: figure out a suitable fallback behavior
      console.warn("There are no Pokemon on the field!");
      battlerIndex = BattlerIndex.PLAYER;
    }

    this.battlerIndex = battlerIndex;
    // Multi-format: derive side/position from the arrangement so triple enemy slots
    // (flat indices 4/5) resolve correctly instead of the binary `% 2` / `< 2`. When the
    // index is not a field slot (a raw pokemon ID, > the format's last slot) fall back to
    // the legacy arithmetic. Binary battles produce identical player/fieldIndex.
    const id = globalScene.currentBattle?.arrangement.locate(battlerIndex);
    if (id && id.side >= 0) {
      this.player = globalScene.currentBattle!.arrangement.ownerOf(battlerIndex) === SideKind.PLAYER;
      this.fieldIndex = id.position;
    } else {
      this.player = battlerIndex < 2;
      this.fieldIndex = battlerIndex % 2;
    }
  }

  // TODO: This should have `undefined` in its signature
  getPokemon(): Pokemon {
    // Multi-format: a "field slot" is any index the arrangement maps to a real side
    // (triple includes 4/5). Anything else is a raw pokemon ID. Legacy fallback: > ENEMY_2.
    const arrangement = globalScene.currentBattle?.arrangement;
    const isFieldSlot = arrangement
      ? arrangement.locate(this.battlerIndex).side >= 0
      : this.battlerIndex <= BattlerIndex.ENEMY_2;
    if (!isFieldSlot) {
      return globalScene.getPokemonById(this.battlerIndex)!;
    }
    return globalScene.getField()[this.battlerIndex]!;
  }
}
