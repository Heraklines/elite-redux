import type { Beat, Consequence, NpcMemory, StoryBible } from "#data/llm-director/beat-schema";

/**
 * Persistent state for an LLM Director run. Stored as `llmDirectorState` on
 * `SystemSaveData`; absent on saves created before the feature shipped.
 *
 * The runtime queue (pre-generated beats waiting to fire) is intentionally NOT
 * part of this shape — it's transient and rebuilt on load.
 */
export interface LLMDirectorState {
  version: 1;
  storyBible?: StoryBible;
  beatHistory: BeatHistoryEntry[];
  factionRep: Record<string, number>;
  alignment: number;
  flags: Record<string, boolean>;
  npcMemory: Record<string, NpcMemory>;
  lossRiskBudget: { used: number; target: number };
  latencyTelemetry?: TelemetryEntry[];
}

export interface BeatHistoryEntry {
  beatId: string;
  wave: number;
  beatType: Beat["type"];
  /** Verbatim copy for the most recent ~30 entries; older entries get a digest only. */
  verbatim?: Beat;
  digest?: string;
  playerChoice?: { optionLabel: string; consequenceApplied: Consequence };
}

export interface TelemetryEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "ok" | "retry" | "fallback" | "underrun";
  timestampMs: number;
}

const DEFAULT_LOSS_RISK_TARGET = 0.15;

export function defaultDirectorState(): LLMDirectorState {
  return {
    version: 1,
    beatHistory: [],
    factionRep: {},
    alignment: 0,
    flags: {},
    npcMemory: {},
    lossRiskBudget: { used: 0, target: DEFAULT_LOSS_RISK_TARGET },
  };
}

/**
 * Merge a possibly-incomplete saved state with sane defaults. Used on load to
 * tolerate future schema additions and missing fields from older saves.
 */
export function mergeDirectorState(saved: Partial<LLMDirectorState> | undefined): LLMDirectorState {
  const base = defaultDirectorState();
  if (!saved) {
    return base;
  }
  const out: LLMDirectorState = {
    version: 1,
    beatHistory: saved.beatHistory ?? base.beatHistory,
    factionRep: saved.factionRep ?? base.factionRep,
    alignment: typeof saved.alignment === "number" ? saved.alignment : base.alignment,
    flags: saved.flags ?? base.flags,
    npcMemory: saved.npcMemory ?? base.npcMemory,
    lossRiskBudget: saved.lossRiskBudget ?? base.lossRiskBudget,
  };
  if (saved.storyBible) {
    out.storyBible = saved.storyBible;
  }
  if (saved.latencyTelemetry) {
    out.latencyTelemetry = saved.latencyTelemetry;
  }
  return out;
}
