import type { Beat, DialogueChoiceOption } from "#data/llm-director/beat-schema";
import type { LLMDirectorState } from "#system/llm-director/director-state";

/**
 * Pure mutators for `LLMDirectorState.beatHistory`. Split out so phases can
 * call them without dragging in `globalScene`, and so they can be unit-tested
 * without a full Phaser scene.
 *
 * The mutators are NOT responsible for compaction (Task 22) — that runs
 * separately, on a wave boundary, against the whole history.
 */

/**
 * Append a verbatim history entry for the beat that just fired.
 */
export function recordBeatHistory(state: LLMDirectorState, beat: Beat, wave: number): void {
  state.beatHistory.push({
    beatId: beat.beatId,
    wave,
    beatType: beat.type,
    verbatim: beat,
  });
}

/**
 * Attach the player's selected dialogue option (label + applied consequence)
 * to the most recently recorded history entry. No-op if the history is empty,
 * which can only happen via misordered callers — defensive guard so a UI bug
 * doesn't corrupt state.
 */
export function recordPlayerChoice(state: LLMDirectorState, option: DialogueChoiceOption): void {
  const last = state.beatHistory.at(-1);
  if (!last) {
    return;
  }
  last.playerChoice = {
    optionLabel: option.label,
    consequenceApplied: option.consequence,
  };
}
