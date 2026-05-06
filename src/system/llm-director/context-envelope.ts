import type { StoryBible } from "#data/llm-director/beat-schema";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { TrainerType } from "#enums/trainer-type";
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
  /** True for the very first beat of the run — the LLM must weave the
   * bible's playerIntro + openingScene into the introText. */
  isFirstBeat: boolean;
}

/**
 * Static, prompt-cacheable facts about the game's curve and pools. Sent every
 * call but doesn't change run-to-run, so providers with prompt caching get a
 * free win.
 *
 * The trainer + biome catalogs are generated FROM the enums so they stay in
 * sync as PokéRogue adds more. The LLM emits an integer id; the game maps it
 * back to the enum value directly.
 */
export interface GameBalanceCard {
  levelCurveNote: string;
  rewardTiers: string[];
  /** Generic, dialog-friendly trainer types. Excludes named gym leaders. */
  trainerTypeCatalog: CatalogEntry[];
  biomeCatalog: CatalogEntry[];
  /** Full move catalog for authoring trainer Pokémon movesets. */
  moveCatalog: CatalogEntry[];
}

export interface CatalogEntry {
  id: number;
  name: string;
}

const HISTORY_VERBATIM_LIMIT = 30;

/**
 * Build the generic-trainer catalog from the TrainerType enum. We exclude:
 * - id 0 (UNKNOWN sentinel)
 * - id >= 200 (named special trainers — gym leaders, elite four, champions,
 *   rivals; these have fixed canonical teams and the Director shouldn't
 *   override them)
 *
 * Result: ~70 generic trainer archetypes the LLM can pick from by id.
 */
function buildTrainerCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const [name, id] of Object.entries(TrainerType)) {
    if (typeof id !== "number") {
      continue;
    }
    if (id === 0) {
      continue;
    }
    if (id >= 200) {
      continue;
    }
    entries.push({ id, name: name.toLowerCase() });
  }
  return entries.sort((a, b) => a.id - b.id);
}

/** All biomes in the BiomeId frozen-object enum. */
function buildBiomeCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const [name, id] of Object.entries(BiomeId)) {
    if (typeof id !== "number") {
      continue;
    }
    entries.push({ id, name: name.toLowerCase() });
  }
  return entries.sort((a, b) => a.id - b.id);
}

/** Full move catalog for trainer authoring (~950 moves, ~25KB). */
function buildMoveCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const [name, id] of Object.entries(MoveId)) {
    if (typeof id !== "number") {
      continue;
    }
    if (id === 0) {
      continue;
    }
    entries.push({ id, name: name.toLowerCase() });
  }
  return entries.sort((a, b) => a.id - b.id);
}

/** Built once at module load — all enums are static. */
const GAME_BALANCE_CARD: GameBalanceCard = {
  levelCurveNote:
    "Trainer party levels follow the Classic curve. Default deviations cap at ±3 levels around the curve.",
  rewardTiers: ["common", "uncommon", "rare", "epic"],
  trainerTypeCatalog: buildTrainerCatalog(),
  biomeCatalog: buildBiomeCatalog(),
  moveCatalog: buildMoveCatalog(),
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
    isFirstBeat: state.beatHistory.length === 0,
  };
}
