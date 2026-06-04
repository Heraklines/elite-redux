import type { Beat, Consequence, NpcMemory, StoryBible } from "#data/llm-director/beat-schema";

/**
 * Persistent director state, mutated by `applyConsequence`. Mirrors the
 * `llmDirectorState` slice on `SystemSaveData` (see Task 5).
 *
 * `storyBible` is optional here — Task 5's `LLMDirectorState` shape allows it
 * to be absent before the bible phase fires, and `applyConsequence` never
 * reads it. Keeping the field optional lets the runtime state pass directly
 * to the applier without an `as` cast.
 */
export interface DirectorState {
  storyBible?: StoryBible;
  beatHistory: BeatRecord[];
  factionRep: Record<string, number>;
  alignment: number;
  flags: Record<string, boolean>;
  npcMemory: Record<string, NpcMemory>;
  lossRiskBudget: { used: number; target: number };
}

export interface BeatRecord {
  beatId: string;
  wave: number;
  beatType: Beat["type"];
  verbatim?: Beat;
  digest?: string;
  playerChoice?: { optionLabel: string; consequenceApplied: Consequence };
}

/**
 * Result returned by `applyConsequence`. The caller is responsible for any
 * side effects beyond pure state mutation (granting items, ending the run,
 * showing epilogue text in the UI, …).
 */
export interface ApplyResult {
  runEnd?: { reason: string; epilogueText: string };
  epilogueText?: string;
}

const ALIGNMENT_MIN = -100;
const ALIGNMENT_MAX = 100;
const REP_MIN = -100;
const REP_MAX = 100;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Mutate `state` according to `consequence`. Returns side-effect information
 * (run end, epilogue text) for the caller to surface.
 */
export function applyConsequence(state: DirectorState, consequence: Consequence): ApplyResult {
  if (typeof consequence.alignment === "number") {
    state.alignment = clamp(state.alignment + consequence.alignment, ALIGNMENT_MIN, ALIGNMENT_MAX);
  }

  if (consequence.factionRep) {
    for (const [faction, delta] of Object.entries(consequence.factionRep)) {
      const current = state.factionRep[faction] ?? 0;
      state.factionRep[faction] = clamp(current + delta, REP_MIN, REP_MAX);
    }
  }

  if (consequence.flags) {
    Object.assign(state.flags, consequence.flags);
  }

  if (consequence.npcMemoryUpdate) {
    for (const [key, partial] of Object.entries(consequence.npcMemoryUpdate)) {
      const existing = state.npcMemory[key] ?? {};
      state.npcMemory[key] = { ...existing, ...partial };
    }
  }

  const result: ApplyResult = {};
  if (consequence.epilogueText) {
    result.epilogueText = consequence.epilogueText;
  }
  if (consequence.runEnd) {
    result.runEnd = { ...consequence.runEnd };
  }
  return result;
}
