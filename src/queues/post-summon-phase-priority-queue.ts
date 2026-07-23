import { globalScene } from "#app/global-scene";
import { PostSummonActivateAbilityPhase } from "#app/phases/post-summon-activate-ability-phase";
import type { PostSummonPhase } from "#app/phases/post-summon-phase";
import { PokemonPhasePriorityQueue } from "#app/queues/pokemon-phase-priority-queue";
import { sortInSpeedOrder } from "#app/utils/speed-order";

/**
 * Priority Queue for {@linkcode PostSummonPhase} and {@linkcode PostSummonActivateAbilityPhase}
 *
 * Orders phases first by ability priority, then by the {@linkcode Pokemon}'s effective speed
 */
export class PostSummonPhasePriorityQueue extends PokemonPhasePriorityQueue<PostSummonPhase> {
  protected override reorder(): void {
    this.queue = sortInSpeedOrder(this.queue);
    this.queue.sort((phaseA, phaseB) => phaseB.getPriority() - phaseA.getPriority());
  }

  public override push(phase: PostSummonPhase): void {
    super.push(phase);
    this.queueAbilityPhase(phase);
  }

  /**
   * Queues all necessary {@linkcode PostSummonActivateAbilityPhase}s for each pushed {@linkcode PostSummonPhase}
   * @param phase - The {@linkcode PostSummonPhase} that was pushed onto the queue
   */
  private queueAbilityPhase(phase: PostSummonPhase): void {
    if (phase instanceof PostSummonActivateAbilityPhase) {
      return;
    }

    const phasePokemon = phase.getPokemon();

    for (const source of phasePokemon.getActiveAbilitySources()) {
      // Most active/innate abilities have no switch-in behavior. Scheduling a dynamic
      // phase for every one was pure overhead (up to 24 empty phases for a 3v3), which
      // is especially visible on mobile during a triple intro. A source can only do
      // work here through a PostSummonAbAttr, so omit empty phases before sorting and
      // dispatch. Sources with a gated attr still need a phase because canApply depends
      // on the fully assembled field at execution time.
      if (!source.ability.hasAttr("PostSummonAbAttr")) {
        continue;
      }
      const activateAbilityPhase = new PostSummonActivateAbilityPhase(
        phasePokemon.getBattlerIndex(),
        source.ability.postSummonPriority,
        source.passiveSlot,
      );
      globalScene.phaseManager.unshiftPhase(activateAbilityPhase);
    }
  }
}
