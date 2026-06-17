import { globalScene } from "#app/global-scene";
import { initMoveAnim, loadMoveAnimAssets } from "#data/battle-anims";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { PlayerPartyMemberPokemonPhase } from "#phases/player-party-member-pokemon-phase";
import { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";

/**
 * ER QoL: filter a level-up move list down to the moves actually offerable in the
 * Move Learn panel - drop {@linkcode MoveId.NONE}, duplicates, and any move the
 * mon already knows, so a move can NEVER be learned twice and a "nothing new"
 * level shows no panel at all. Pure and order-preserving for easy unit testing.
 */
export function filterLearnableMoves(levelMoveIds: number[], knownMoveIds: number[]): MoveId[] {
  const known = new Set(knownMoveIds);
  const seen = new Set<number>();
  const out: MoveId[] = [];
  for (const id of levelMoveIds) {
    if (id === MoveId.NONE || known.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id as MoveId);
  }
  return out;
}

/** Dependencies handed to the Move Learn panel handler (see {@linkcode LearnMoveBatchPhase}). */
export interface LearnMoveBatchDeps {
  pokemon: Pokemon;
  /** The NEW, offerable moves for this level-up (already de-duped / known-filtered). */
  learnableIds: MoveId[];
  /** Silently place a chosen move into a slot (no "learned X" banner). */
  assign: (moveId: MoveId, slotIndex: number) => void;
  /** Called once when the player finishes or cancels; closes the panel + ends the phase. */
  done: () => void;
}

/**
 * ER QoL (level-up move panel, #er): replaces the per-move text barrage with ONE
 * interactive panel listing every NEW move this level-up teaches. The player
 * picks moves to learn (and which move they overwrite when the set is full);
 * assignment is SILENT (no "learned X" message) and the list thins down in place.
 * See {@linkcode UiMode.LEARN_MOVE_BATCH} / LearnMoveBatchUiHandler.
 *
 * ONLY the LevelUpPhase loop routes through here. TMs, the egg/Memory tutor, the
 * relearner and evolution-move learning still use the vanilla LearnMovePhase.
 */
export class LearnMoveBatchPhase extends PlayerPartyMemberPokemonPhase {
  public readonly phaseName = "LearnMoveBatchPhase";
  private readonly candidateMoveIds: MoveId[];

  constructor(partyMemberIndex: number, candidateMoveIds: MoveId[]) {
    super(partyMemberIndex);
    this.candidateMoveIds = candidateMoveIds;
  }

  start(): void {
    super.start();
    const pokemon = this.getPokemon();
    // Real moveset (ignoreOverride=true): a stale MOVESET_OVERRIDE must not hide a
    // move the mon truly has, or the "already knows it" filter misses and the same
    // move could be offered/learned twice (mirrors LearnMovePhase's #449 guard).
    const known = pokemon.getMoveset(true).map(m => m.moveId);
    const learnable = filterLearnableMoves(this.candidateMoveIds, known);
    // "Only on levels that teach something new" - nothing offerable -> no panel.
    if (learnable.length === 0) {
      this.end();
      return;
    }

    const returnMode =
      globalScene.ui.getHandler() instanceof EvolutionSceneUiHandler ? UiMode.EVOLUTION_SCENE : UiMode.MESSAGE;
    const learnedIds: MoveId[] = [];

    const deps: LearnMoveBatchDeps = {
      pokemon,
      learnableIds: learnable,
      assign: (moveId, slotIndex) => {
        // Silent write - no banner, just place the move. Mirrors the data half of
        // LearnMovePhase.learnMove (setMove + load the move's animation assets).
        pokemon.setMove(slotIndex, moveId);
        learnedIds.push(moveId);
        initMoveAnim(moveId).then(() => loadMoveAnimAssets([moveId], true));
      },
      done: () => {
        // Fire any move-learned form change ONCE after the panel closes (not mid-panel).
        if (learnedIds.length > 0) {
          globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeMoveLearnedTrigger, true);
        }
        globalScene.ui.setMode(returnMode).then(() => this.end());
      },
    };

    globalScene.ui.setMode(UiMode.LEARN_MOVE_BATCH, deps);
  }
}
