import type { StoryBible } from "#data/llm-director/beat-schema";
import type { BeatHistoryEntry, LLMDirectorState } from "#system/llm-director/director-state";

/**
 * Pure builder for the JSON envelope sent with every LLM call. The Director
 * never reads from `globalScene` directly — the caller assembles `EnvelopeInputs`
 * from whatever sources are available so this stays unit-testable.
 */

export interface EnvelopePartyMember {
  species: string;
  level: number;
  types: string[];
  ability: string;
  moves: string[];
  hpPct: number;
}

export interface EnvelopeInventory {
  items: Array<{ name: string; qty: number }>;
  money: number;
  vouchers: number;
}

export interface EnvelopeRecentWave {
  wave: number;
  faints: number;
  endHpPct: number;
  itemsBurned: number;
}

export interface EnvelopeInputs {
  state: LLMDirectorState;
  playerParty: EnvelopePartyMember[];
  inventory?: EnvelopeInventory;
  recentPressure?: { last10Waves: EnvelopeRecentWave[] };
  currentWaveIndex: number;
  /** Optional: force a specific beat type (e.g., for queued tagged beats). */
  forcedBeatType?: string;
}

export interface ContextEnvelope {
  storyBible: StoryBible | undefined;
  beatHistory: BeatHistoryEntry[];
  playerParty: EnvelopePartyMember[];
  inventory: EnvelopeInventory;
  factionRep: Record<string, number>;
  alignment: number;
  flags: Record<string, boolean>;
  npcMemory: LLMDirectorState["npcMemory"];
  recentPressure: { last10Waves: EnvelopeRecentWave[] };
  lossRiskBudget: { used: number; target: number };
  currentWaveIndex: number;
  currentAct: StoryBible["acts"][number] | undefined;
  gameBalanceCard: GameBalanceCard;
  currentBeatType: "auto" | string;
}

/**
 * Static, prompt-cacheable facts about the game's curve and pools. Sent every
 * call but doesn't change run-to-run, so providers with prompt caching get a
 * free win.
 */
export interface GameBalanceCard {
  levelCurveNote: string;
  rewardTiers: string[];
  trainerTypePool: string[];
  biomePool: string[];
}

const HISTORY_VERBATIM_LIMIT = 30;

/**
 * v1 game balance card. The pools are referenced by string for now — the LLM
 * does not need to know the underlying enum values; the game maps them.
 */
const GAME_BALANCE_CARD: GameBalanceCard = {
  levelCurveNote:
    "Trainer party levels follow the Classic curve. Default deviations cap at ±3 levels around the curve.",
  rewardTiers: ["common", "uncommon", "rare", "epic"],
  trainerTypePool: [
    "youngster",
    "lass",
    "ace_trainer",
    "rich_boy",
    "veteran",
    "scientist",
    "psychic",
    "hex_maniac",
    "biker",
    "rocker",
  ],
  biomePool: ["plains", "grass", "forest", "tall_grass", "metropolis", "cave", "desert", "ice_cave", "ruins", "swamp"],
};

function findCurrentAct(bible: StoryBible | undefined, wave: number): StoryBible["acts"][number] | undefined {
  if (!bible) {
    return;
  }
  return bible.acts.find(a => wave >= a.waveStart && wave <= a.waveEnd);
}

/**
 * Compress beat history older than the verbatim window down to digest-only
 * entries. v1 keeps even old entries in the array (with verbatim stripped); a
 * future Kimi summarization pass (Task 22) replaces stripped entries with real
 * digest text.
 */
function compactHistory(history: BeatHistoryEntry[]): BeatHistoryEntry[] {
  if (history.length <= HISTORY_VERBATIM_LIMIT) {
    return history;
  }
  const cutoff = history.length - HISTORY_VERBATIM_LIMIT;
  return history.map((entry, idx) => {
    if (idx >= cutoff) {
      return entry;
    }
    if (entry.digest) {
      const out: BeatHistoryEntry = {
        beatId: entry.beatId,
        wave: entry.wave,
        beatType: entry.beatType,
        digest: entry.digest,
      };
      if (entry.playerChoice) {
        out.playerChoice = entry.playerChoice;
      }
      return out;
    }
    // No digest yet — leave the verbatim entry in place; Task 22 will replace
    // it on the next compaction pass.
    return entry;
  });
}

export function buildContextEnvelope(inputs: EnvelopeInputs): ContextEnvelope {
  const {
    state,
    playerParty,
    inventory = { items: [], money: 0, vouchers: 0 },
    recentPressure = { last10Waves: [] },
    currentWaveIndex,
    forcedBeatType,
  } = inputs;

  return {
    storyBible: state.storyBible,
    beatHistory: compactHistory(state.beatHistory),
    playerParty,
    inventory,
    factionRep: state.factionRep,
    alignment: state.alignment,
    flags: state.flags,
    npcMemory: state.npcMemory,
    recentPressure,
    lossRiskBudget: state.lossRiskBudget,
    currentWaveIndex,
    currentAct: findCurrentAct(state.storyBible, currentWaveIndex),
    gameBalanceCard: GAME_BALANCE_CARD,
    currentBeatType: forcedBeatType ?? "auto",
  };
}
