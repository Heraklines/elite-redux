import type { TrainerBattleBeat } from "#data/llm-director/beat-schema";

/**
 * Hard balance rails enforced post-LLM. Trainer beats arrive from the LLM with
 * potentially out-of-bounds level deltas or too many species swaps; we clamp
 * before handing the beat to the battle engine.
 *
 * v1 caps at ±3 by default. `difficultyTag: "brutal"` permits up to +10, but
 * only when the player is fresh (no recent faints). The brutal-with-escape
 * predicate (design doc §"Difficulty system prompt directive") is enforced by
 * the generator, not here — this layer treats brutal as a green-lit upgrade.
 */

export interface BalanceContext {
  /** Faints across the last ~10 waves; used to decide whether brutal trainers are safe. */
  recentFaints: number;
}

const DEFAULT_DELTA_CAP = 3;
const BRUTAL_DELTA_CAP = 10;
const MAX_SPECIES_SWAPS = 2;
const BRUTAL_FAINT_THRESHOLD = 1;

function clampDelta(delta: number, cap: number): number {
  return Math.max(-cap, Math.min(cap, delta));
}

/**
 * Return a copy of the beat with `levelDelta` and `speciesSwaps` clamped.
 *
 * - levelDelta defaults to ±3.
 * - difficultyTag === "brutal" expands the cap to +10 (still ±3 on the negative
 *   side; we only ever make brutal harder, never softer).
 * - When the player has recently fainted, the brutal upgrade is denied: the
 *   beat is treated as a regular trainer to avoid piling on.
 * - speciesSwaps trim to the first 2 entries.
 */
export function clampTrainerBattle(beat: TrainerBattleBeat, ctx: BalanceContext): TrainerBattleBeat {
  const struggling = ctx.recentFaints >= BRUTAL_FAINT_THRESHOLD;
  const brutalAllowed = beat.difficultyTag === "brutal" && !struggling;

  const positiveCap = brutalAllowed ? BRUTAL_DELTA_CAP : DEFAULT_DELTA_CAP;
  const incoming = beat.levelDelta ?? 0;
  const clamped = brutalAllowed
    ? Math.max(-DEFAULT_DELTA_CAP, Math.min(positiveCap, incoming))
    : clampDelta(incoming, DEFAULT_DELTA_CAP);

  const swaps = beat.speciesSwaps ? beat.speciesSwaps.slice(0, MAX_SPECIES_SWAPS) : undefined;

  const out: TrainerBattleBeat = { ...beat, levelDelta: clamped };
  if (swaps !== undefined) {
    out.speciesSwaps = swaps;
  }
  return out;
}
