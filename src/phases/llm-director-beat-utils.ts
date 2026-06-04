import { clampTrainerBattle } from "#data/llm-director/balance-rails";
import type { AuthoredPokemon, InterBeatOverride, TrainerBattleBeat } from "#data/llm-director/beat-schema";

export interface BattleSnapshotForOverride {
  enemyLevels: number[] | undefined;
}

/**
 * Apply an inter-beat override to a battle's enemy-level array. Pure,
 * mutates-and-returns the snapshot so callers (NewBattlePhase) can apply it
 * to `globalScene.currentBattle` while keeping this function unit-testable.
 *
 * v1 only handles `levelDelta`; species swaps are reported by the caller
 * but not applied yet (deferred to v2). The full LLM-authored team
 * (enemyTeam) is applied separately in NewBattlePhase via
 * `installAuthoredTeam`, since that path needs globalScene access.
 *
 * Returns `true` when at least one field was applied so callers can log.
 */
export function applyOverrideToBattle(snapshot: BattleSnapshotForOverride, override: InterBeatOverride): boolean {
  let applied = false;
  const trainerOverride = override.trainerOverride;
  if (!trainerOverride) {
    return applied;
  }
  const { levelDelta } = trainerOverride;
  if (typeof levelDelta === "number" && Array.isArray(snapshot.enemyLevels)) {
    snapshot.enemyLevels = snapshot.enemyLevels.map(l => Math.max(1, l + levelDelta));
    applied = true;
  }
  return applied;
}

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
 * via the balance rails, then folds them — together with the optional
 * LLM-authored `enemyTeam` (v2) — into an `atWaveOffset: 1` override.
 *
 * The override is queued for `waveIndex + 1` (not the beat's wave), so the
 * upcoming vanilla trainer encounter is the one that gets the rewrite. The
 * beat phase itself is just narrative (intro + preBattleText).
 *
 * Returns `null` when the beat has nothing to override (no team, no swaps,
 * no delta) — the caller can then skip queueing it.
 */
export function buildTrainerOverride(beat: TrainerBattleBeat, ctx: TrainerOverrideContext): InterBeatOverride | null {
  const clamped = clampTrainerBattle(beat, ctx);
  const trainerOverride: { speciesSwaps?: number[]; levelDelta?: number; enemyTeam?: AuthoredPokemon[] } = {};
  if (clamped.speciesSwaps && clamped.speciesSwaps.length > 0) {
    trainerOverride.speciesSwaps = clamped.speciesSwaps;
  }
  if (typeof clamped.levelDelta === "number" && clamped.levelDelta !== 0) {
    trainerOverride.levelDelta = clamped.levelDelta;
  }
  if (Array.isArray(beat.enemyTeam) && beat.enemyTeam.length > 0) {
    trainerOverride.enemyTeam = beat.enemyTeam;
  }
  if (Object.keys(trainerOverride).length === 0) {
    return null;
  }
  return { atWaveOffset: 1, trainerOverride };
}
