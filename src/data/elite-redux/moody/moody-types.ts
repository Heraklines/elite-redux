import type { MoodyFormationRuntimeSaveDataV1 } from "#data/elite-redux/moody/moody-runtime-formation-adapter";
import type { MoveId } from "#enums/move-id";
import type { PokemonType } from "#enums/pokemon-type";

export type MoodyRarity = "great" | "ultra" | "rogue" | "master";

export type MoodyTargetKind =
  | "slot"
  | "slots"
  | "pokemon"
  | "pokemon-pair"
  | "move"
  | "pokemon-type"
  | "enemy-type"
  | "item-stack"
  | "team"
  | "field"
  | "economy"
  | "reward"
  | "contract"
  | "rule";

export interface MoodyEvolutionDefinition {
  id: string;
  name: string;
  description: string;
}

export interface MoodyBoonDefinition {
  id: string;
  number: number;
  name: string;
  rarity: MoodyRarity;
  scope: string;
  targetKind: MoodyTargetKind;
  base: string;
  rankTwo: string;
  evolutions: readonly MoodyEvolutionDefinition[];
  fullDescription: string;
  implementationStatus?: "ready" | "blocked";
  implementationNote?: string;
}

export type MoodyDread = 1 | 2 | 3;

export interface MoodyCurseDefinition {
  id: string;
  number: number;
  name: string;
  dread: MoodyDread;
  description: string;
}

export interface MoodyBoonTarget {
  pokemonIds?: number[];
  partySlots?: number[];
  moveIds?: MoveId[];
  pokemonType?: PokemonType;
  itemTypeIds?: string[];
  option?: string;
}

export interface MoodyBoonProgress {
  counters?: Record<string, number>;
  flags?: Record<string, boolean>;
  values?: Record<string, number | string | boolean>;
}

export interface MoodyBoonInstance {
  instanceId: string;
  boonId: string;
  rank: 1 | 2 | 3;
  evolutionId?: string;
  target?: MoodyBoonTarget;
  progress?: MoodyBoonProgress;
  acquiredAtWave: number;
  dormant?: boolean;
}

export interface MoodyCurseInstance {
  curseId: string;
  acquiredAtWave: number;
  target?: MoodyBoonTarget;
  progress?: MoodyBoonProgress;
}

export interface MoodyCurseOffer {
  offerId: string;
  curseId: string;
}

export interface MoodyThreatRecord {
  pokemonId: number;
  damageDealt: number;
  bossSegmentDamage: number;
  knockouts: number;
  fieldTurns: number;
  itemInvestment: number;
  repeatedMoveUses: number;
  physicalBias: number;
  specialBias: number;
  speedDependence: number;
  weatherDependence: number;
}

export interface MoodyRuntimeFieldSaveData {
  version: 1;
  cursor: {
    battleId: string;
    waveIndex: number;
    turn: number;
    segmentIndex: number;
    biomeId: number;
    biomeEpoch: number;
  };
  numbers: [key: string, value: number][];
  values: [key: string, value: string | number | boolean][];
  lists: [key: string, value: string[]][];
}

export interface MoodyFormationEngineSaveData {
  version: 1;
  stateJson: string;
}

export interface MoodyModeSaveData {
  version: 1;
  seed: number;
  acquisitionRolls: number;
  draftIndex: number;
  boons: MoodyBoonInstance[];
  curses: MoodyCurseInstance[];
  recentThreat: MoodyThreatRecord[];
  formationRuntime?: MoodyFormationRuntimeSaveDataV1;
  formationEngine?: MoodyFormationEngineSaveData;
  /** Deterministic combat/runtime state. Optional only for pre-runtime saves. */
  fieldRuntime?: MoodyRuntimeFieldSaveData;
}

export type MoodyOfferKind = "new" | "rank-up" | "evolution" | "replace";

export interface MoodyBoonOffer {
  offerId: string;
  kind: MoodyOfferKind;
  boonId: string;
  existingInstanceId?: string;
  evolutionId?: string;
  hidden?: boolean;
}

export interface MoodyEnemyBoonLoadout {
  waveIndex: number;
  boons: MoodyBoonInstance[];
}
