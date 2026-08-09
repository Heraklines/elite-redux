import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getFunScrambledMoveId } from "#data/elite-redux/er-fun-mode";
import type { BattlerIndex } from "#enums/battler-index";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import { PokemonPhase } from "#phases/pokemon-phase";

export class MoveEndPhase extends PokemonPhase {
  public readonly phaseName = "MoveEndPhase";
  private readonly wasFollowUp: boolean;
  private readonly usedMoveId: MoveId | undefined;

  /** Targets from the preceding MovePhase */
  private readonly targets: Pokemon[];
  constructor(battlerIndex: BattlerIndex, targets: Pokemon[], wasFollowUp = false, usedMoveId?: MoveId) {
    super(battlerIndex);

    this.targets = targets;
    this.wasFollowUp = wasFollowUp;
    this.usedMoveId = usedMoveId;
  }

  start() {
    super.start();

    const pokemon = this.getPokemon();

    // Reset hit-related temporary data.
    // TODO: These properties should be stored inside a "move in flight" object,
    // which this Phase would promptly destroy
    if (pokemon) {
      pokemon.turnData.hitsLeft = -1;
    }

    if (!this.wasFollowUp && pokemon?.isActive(true)) {
      pokemon.lapseTags(BattlerTagLapseType.AFTER_MOVE);
    }

    // Remove effects which were set on a Pokemon which removes them on summon (i.e. via Mold Breaker)
    globalScene.arena.setIgnoreAbilities(false);
    for (const target of this.targets) {
      if (target) {
        applyAbAttrs("PostSummonRemoveEffectAbAttr", { pokemon: target });
      }
    }

    if (
      !this.wasFollowUp
      && this.usedMoveId != null
      && pokemon
      && globalScene.gameMode.isFun
      && !pokemon.getTag(BattlerTagType.CHARGING)
    ) {
      const move = pokemon.moveset.find(candidate => candidate?.moveId === this.usedMoveId);
      if (move) {
        const replacement = getFunScrambledMoveId(
          pokemon.id,
          this.usedMoveId,
          globalScene.currentBattle.waveIndex,
          globalScene.currentBattle.turn,
          pokemon.moveset.map(candidate => candidate?.moveId ?? MoveId.NONE),
        );
        if (replacement != null) {
          move.moveId = replacement;
          move.ppUsed = 0;
          move.ppUp = 0;
          move.maxPpOverride = undefined;
        }
      }
    }

    // TODO: Unshift a phase to trigger dancer for all active pokemon if at least 1 has the ability.
    this.end();
  }
}
