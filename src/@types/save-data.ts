import type { PokeballCounts } from "#app/battle-scene";
import type { Tutorial } from "#app/tutorial";
import type { ErMapSaveData } from "#data/elite-redux/er-map-nodes";
import type { ErRelicBattleStateData } from "#data/elite-redux/er-relic-battle-state";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import type { ErShinyLabSaveData } from "#data/elite-redux/er-shiny-lab-effects";
import type { BattleType } from "#enums/battle-type";
import type { GameModes } from "#enums/game-modes";
import type { MoveId } from "#enums/move-id";
import type { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Nature } from "#enums/nature";
import type { PlayerGender } from "#enums/player-gender";
import type { PokemonType } from "#enums/pokemon-type";
import type { SpeciesId } from "#enums/species-id";
import type { MysteryEncounterSaveData } from "#mystery-encounters/mystery-encounter-save-data";
import type { Variant } from "#sprites/variant";
import type { ArenaData } from "#system/arena-data";
import type { AutoEggRestockSettings } from "#system/auto-egg-restock-settings";
import type { ChallengeData } from "#system/challenge-data";
import type { EggData } from "#system/egg-data";
import type { GameStats } from "#system/game-stats";
import type { LLMDirectorState } from "#system/llm-director/director-state";
import type { ModifierData } from "#system/modifier-data";
import type { PokemonData } from "#system/pokemon-data";
import type { TrainerData } from "#system/trainer-data";
import type { SerializedDailyRunConfig } from "./daily-run";
import type { DexData } from "./dex-data";

export interface SystemSaveData {
  trainerId: number;
  secretId: number;
  gender: PlayerGender;
  dexData: DexData;
  starterData: StarterData;
  gameStats: GameStats;
  unlocks: Unlocks;
  achvUnlocks: AchvUnlocks;
  voucherUnlocks: VoucherUnlocks;
  voucherCounts: VoucherCounts;
  eggs: EggData[];
  gameVersion: string;
  timestamp: number;
  eggPity: number[];
  unlockPity: number[];
  /** Optional for back-compat with saves created before the auto-restock feature. */
  autoEggRestock?: AutoEggRestockSettings;
  /** Optional for back-compat with saves created before the LLM Director feature. */
  llmDirectorState?: LLMDirectorState;
  /**
   * One-time gift flag: `true` once the player has received the free 2 Legendary
   * eggs grant. Absent on saves predating the grant (treated as `false`, so the
   * grant fires exactly once and never again). See
   * {@linkcode GameData.grantFreeLegendaryEggsOnce}.
   */
  freeLegendaryEggsGranted?: boolean;
  /** ER Shiny Lab: global achievement/challenge availability bitset. */
  erShinyLabAvailableEffects?: number[];
}

export interface SessionSaveData {
  seed: string;
  playTime: number;
  gameMode: GameModes;
  dailyConfig?: SerializedDailyRunConfig;
  party: PokemonData[];
  enemyParty: PokemonData[];
  modifiers: ModifierData[];
  enemyModifiers: ModifierData[];
  arena: ArenaData;
  pokeballCounts: PokeballCounts;
  money: number;
  score: number;
  waveIndex: number;
  // TODO: This enum being inside save data is basically useless, being inferrable from the presence or absence of `trainer` and `mysteryEncounterType`.
  // Remove this later on to reduce save size and improve clarity.
  battleType: Exclude<BattleType, BattleType.CLEAR>;
  // TODO: This being nullable NEEDS to be reflected in the type signature
  trainer: TrainerData;
  gameVersion: string;
  /** The player-chosen name of the run */
  name: string;
  timestamp: number;
  challenges: ChallengeData[];
  // TODO: Change default value to `undefined` to both save space and ease nullishness checks
  mysteryEncounterType: MysteryEncounterType | -1; // Only defined when current wave is ME,
  // TODO: This can be `undefined` - reflect that in the type signature
  mysteryEncounterSaveData: MysteryEncounterSaveData;
  /**
   * Counts the amount of pokemon fainted in your party during the current arena encounter.
   */
  playerFaints: number;
  /**
   * Elite Redux: the run difficulty (Ace / Elite / Hell) chosen at team select.
   * Drives which ER trainer roster tier the run uses. Persisted so it survives
   * a save reload — without it the module-level difficulty resets to the default
   * ("ace" = vanilla trainers) on every page load, so a run started on Elite/Hell
   * would silently stop spawning ER trainers after reloading. Optional for
   * backwards compatibility with pre-existing saves (treated as "ace").
   */
  erDifficulty?: ErDifficulty;
  /**
   * ER: stableKeys of trainers already encountered this run, so the difficulty's
   * trainer pool doesn't repeat across a save/load. Optional for backwards
   * compatibility (older saves restore an empty set, i.e. a fresh pool).
   */
  erUsedTrainerKeys?: string[];
  /**
   * ER (#348): per-mon faint-free money-streak counters ([pokemonId, waves]),
   * so a reload keeps each mon's streak. Optional for backwards compatibility
   * (older saves restore fresh streaks).
   */
  erMoneyStreaks?: [number, number][];
  /**
   * ER (#357): the player's resist berries ([pokemonId, resistType]) — kept as
   * a side-channel because runtime ER modifier types aren't reconstructible
   * from the vanilla modifier registry. Optional for backwards compatibility.
   */
  erResistBerries?: [number, number][];
  /**
   * ER (#358): the player's Ward Stones ([pokemonId, tierIndex, charges,
   * waveProgress]) — same side-channel rationale as erResistBerries.
   */
  erWardStones?: [number, number, number, number][];
  /**
   * ER (#486): the run's Map state - revealed nodes, a pending travel target, and
   * Treasure-Map fragment count. Run-scoped module state that a reload would
   * otherwise wipe. Optional for backwards compatibility (older saves restore a
   * fresh, empty map).
   */
  erMapState?: ErMapSaveData;
  /**
   * ER: per-battle relic counters (Cursed Idol send-out count, Pharaoh's Ankh
   * "used", ...) scoped to the current wave, so a reload doesn't reset them and
   * re-fire the effect. Optional for backwards compatibility (older saves re-arm).
   */
  erRelicBattleState?: ErRelicBattleStateData;
}

export interface Unlocks {
  [key: number]: boolean;
}

export interface AchvUnlocks {
  [key: string]: number;
}

export interface VoucherUnlocks {
  [key: string]: number;
}

export interface VoucherCounts {
  [type: string]: number;
}

export type StarterMoveset = [MoveId] | [MoveId, MoveId] | [MoveId, MoveId, MoveId] | [MoveId, MoveId, MoveId, MoveId];

export interface StarterFormMoveData {
  [key: number]: StarterMoveset;
}

export interface StarterMoveData {
  [key: number]: StarterMoveset | StarterFormMoveData;
}

export interface StarterAttributes {
  nature?: number | undefined;
  ability?: number | undefined;
  variant?: number | undefined;
  form?: number | undefined;
  female?: boolean | undefined;
  shiny?: boolean | undefined;
  favorite?: boolean | undefined;
  nickname?: string | undefined;
  tera?: PokemonType | undefined;
  /** ER Black Shinies (#349): the t4 black tier is selected for this starter. */
  erBlackShiny?: boolean | undefined;
}

export interface DexAttrProps {
  shiny: boolean;
  female: boolean;
  variant: Variant;
  formIndex: number;
}

export interface Starter {
  speciesId: SpeciesId;
  shiny: boolean;
  variant: Variant;
  formIndex: number;
  female?: boolean | undefined;
  abilityIndex: number;
  passive: boolean;
  nature: Nature;
  moveset?: StarterMoveset | undefined;
  pokerus: boolean;
  nickname?: string | undefined;
  teraType?: PokemonType | undefined;
  ivs: number[];
  /** ER Black Shinies (#349): start this mon as a t4 black shiny. */
  erBlackShiny?: boolean | undefined;
  /**
   * Co-op (#633 Fix #3): the owning player's per-account innate-unlock snapshot (one
   * `passiveAttr` bitmask per ER innate slot 0/1/2), threaded into `customPokemonData` at
   * launch so a shared merged mon's active innates are gated by the OWNER's unlocks, not the
   * local client's. `undefined` for every solo / non-co-op starter (all other modes untouched).
   */
  coopPassiveAttr?: number[] | undefined;
  /** Co-op (#633 Fix #3): the owning player's canonical luck for this mon. */
  coopLuck?: number | undefined;
}

// TODO: What type of number does this store?
export type RunHistoryData = Record<number, RunEntry>;

export interface RunEntry {
  entry: SessionSaveData;
  isVictory: boolean;
  /** Automatically set to false at the moment - implementation TBD */
  isFavorite: boolean;
}

export interface StarterDataEntry {
  moveset: StarterMoveset | StarterFormMoveData | null;
  eggMoves: number;
  candyCount: number;
  friendship: number;
  abilityAttr: number;
  passiveAttr: number;
  valueReduction: number;
  classicWinCount: number;
  /**
   * ER Black Shinies (#349): set once the player has caught/hatched a BLACK
   * (t4) shiny of this line — unlocks the black tier in starter select and
   * the dex filter. Optional for save compatibility.
   */
  erBlackShiny?: boolean;
  /** ER Shiny Lab: per-species owned bitsets, equipped loadout, params, and presets. */
  erShinyLab?: ErShinyLabSaveData;
}

export interface StarterData {
  [key: number]: StarterDataEntry;
}

// TODO: Rework into a bitmask
export type TutorialFlags = {
  [key in Tutorial]: boolean;
};

// TODO: Rework into a bitmask
export interface SeenDialogues {
  [key: string]: boolean;
}
