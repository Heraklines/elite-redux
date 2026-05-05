import { clampTrainerBattle } from "#data/llm-director/balance-rails";
import type { InterBeatOverride, TrainerBattleBeat } from "#data/llm-director/beat-schema";

/**
 * Pure helpers for the LLMDirectorBeatPhase, split out so they can be
 * unit-tested without spinning up Phaser / globalScene.
 */

export interface TrainerOverrideContext {
  /** Number of party faints across the last ~10 waves; gates brutal beats. */
  recentFaints: number;
}

/**
 * Build the inter-beat override that the next vanilla NewBattlePhase should
 * apply when a `trainer_battle` beat fires. Clamps levelDelta / speciesSwaps
 * via the balance rails, then folds them into an `atWaveOffset: 1` override.
 *
 * Returns `null` when the beat has nothing to override (no swaps, no delta) —
 * the caller can then skip queueing it.
 */
export function buildTrainerOverride(beat: TrainerBattleBeat, ctx: TrainerOverrideContext): InterBeatOverride | null {
  const clamped = clampTrainerBattle(beat, ctx);
  const trainerOverride: { speciesSwaps?: number[]; levelDelta?: number } = {};
  if (clamped.speciesSwaps && clamped.speciesSwaps.length > 0) {
    trainerOverride.speciesSwaps = clamped.speciesSwaps;
  }
  if (typeof clamped.levelDelta === "number" && clamped.levelDelta !== 0) {
    trainerOverride.levelDelta = clamped.levelDelta;
  }
  if (Object.keys(trainerOverride).length === 0) {
    return null;
  }
  return { atWaveOffset: 1, trainerOverride };
}
