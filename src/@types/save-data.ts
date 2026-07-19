import type { PokeballCounts } from "#app/battle-scene";
import type { Tutorial } from "#app/tutorial";
import type { CoopControlPlaneSaveData } from "#data/elite-redux/coop/coop-control-plane";
import type { CommunityChallengeConfig } from "#data/elite-redux/er-community-challenges";
import type { GhostTrainerProfile } from "#data/elite-redux/er-ghost-profile";
import type { ErMapSaveData } from "#data/elite-redux/er-map-nodes";
import type { ErRelicBattleStateData } from "#data/elite-redux/er-relic-battle-state";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import type { ErShinyLabSaveData } from "#data/elite-redux/er-shiny-lab-effects";
import type { TrainerFxSaveData } from "#data/elite-redux/er-trainer-fx";
import type { ShowdownTeamPreset } from "#data/elite-redux/showdown/showdown-team-preset";
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
   * Showdown 1v1 (D2/I2): the applied-settlement ledger — showdown_settlements row ids already
   * applied locally, capped FIFO. Lets an honest client skip re-applying a row whose server ack
   * never landed. Optional for back-compat (absent = empty).
   */
  showdownAppliedSettlements?: number[];
  /**
   * Showdown 1v1 (Team Menu): named team presets, serialized in the account save so they
   * survive a device change / cloud round-trip. Each preset = { version, name, mons }, where
   * mons are the canonical wire {@linkcode ShowdownMonManifest}s. Optional for back-compat
   * (absent = empty); sanitized on load.
   */
  showdownTeamPresets?: ShowdownTeamPreset[];
  /**
   * One-time gift flag: `true` once the player has received the free 2 Legendary
   * eggs grant. Absent on saves predating the grant (treated as `false`, so the
   * grant fires exactly once and never again). See
   * {@linkcode GameData.grantFreeLegendaryEggsOnce}.
   */
  freeLegendaryEggsGranted?: boolean;
  /** ER Shiny Lab: global achievement/challenge availability bitset. */
  erShinyLabAvailableEffects?: number[];
  /** ER Ghost Trainer Editor: the player's authored ghost presentation profile
   *  (sprite/name/title/dialogue/FX). null/absent = the default random ghost.
   *  A snapshot of this rides along on each published ghost (runs.presentation). */
  ghostProfile?: GhostTrainerProfile | null;
  /** ER Ghost Trainer FX: total achievement points SPENT unlocking effects. The
   *  spendable balance = derived earnedScore - spentAchvPoints. Absent = 0. */
  spentAchvPoints?: number;
  /** ER Ghost Trainer FX: owned entrance/aura effect bitsets + equipped picks. */
  trainerFx?: TrainerFxSaveData;
  /**
   * ER achievement rewards: trainer titles the player has earned (e.g. "Champion
   * Material" from CHAMPION_MATERIAL). Persisted so a title survives a reload / cloud
   * round-trip; the display UI is intentionally deferred. Absent = none earned yet.
   */
  erTitles?: string[];
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
   * ER editor custom-trainer keys already encountered in this run. Kept
   * separate from the regular ER trainer registry because the key spaces and
   * selection systems are independent.
   */
  erUsedCustomTrainerKeys?: string[];
  /**
   * Zero-based custom-trainer spawn windows already consumed in this run.
   * Persisting these prevents a refresh between adjacent waves from allowing a
   * second custom trainer inside the same window.
   */
  erUsedCustomTrainerWindows?: number[];
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
  /**
   * ER Community Challenge: when this run is the founder's qualifying play of a draft
   * they just created, the draft id + its config. A legit classic victory auto-publishes
   * the draft (it survives a mid-run save/reload so the publish isn't lost). Optional for
   * backwards compatibility (older / non-founder saves restore none).
   */
  founderChallenge?: { draftId: string; config: CommunityChallengeConfig };
  /**
   * ER Community Challenge: the run's allowed-species whitelist (root species ids), so the
   * catch gate survives a mid-run save/reload. Optional + absent for non-community runs.
   */
  communityAllowedSpecies?: number[];
  /**
   * Co-op W2b (contract doc §4): the CONTROL-PLANE snapshot - the interaction counter + durability journal
   * high-water marks - so a COLD resume keeps alternating-owner parity + revision ordering CONTINUOUS
   * instead of resetting to base 0. Optional + absent for every solo / pre-W2b save (fully save-compatible).
   */
  coopControlPlane?: CoopControlPlaneSaveData | undefined;
  /** Stable logical co-op run identity plus host-monotonic persistence order. */
  coopRun?:
    | {
        version: 1;
        runId: string;
        checkpointRevision: number;
      }
    | undefined;
  /**
   * ER achievement-expansion catalog-v2 (#900): run-local achievement state that must survive a
   * mid-run save/reload (bargain accept/refuse flags, one-per-run black-market credit, learned-move
   * wave stamps, PARALLEL_PLAY KO ids, LIFELINE per-wave revive dedupe). Optional + absent for older
   * saves (restore fresh, empty state). See er-achievement-run-state.ts.
   */
  erAchievementRunState?: import("#data/elite-redux/er-achievement-run-state").ErAchievementRunSaveData;
  /**
   * Stable account pair plus the authority-seat identity mapping for cold resume. The seat map is
   * mandatory for resumability: unordered legacy pairs cannot safely survive host/guest reversal.
   */
  coopParticipants?:
    | {
        version: 1;
        players: [string, string];
        seats: { host: string; guest: string };
      }
    | undefined;
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
  /** Co-op (#785): the OWNER'S carried Shiny Lab look (encoded SavedLook) for this pick. */
  erShinyLab?: import("#data/elite-redux/er-shiny-lab-effects").ErShinyLabSavedLook | undefined;
  /** Co-op (#785): the equipped preset name carried with the look. */
  erShinyLabName?: string | undefined;
  /** Co-op (#633 Fix #3): the owning player's canonical luck for this mon. */
  coopLuck?: number | undefined;
  /**
   * Showdown: the concrete evolution STAGE the player chose to field for this line
   * (the grid pick is the root; this is the evolved species actually sent into the
   * 1v1 duel). `undefined` for every non-showdown starter, so save-compat is untouched.
   */
  showdownSpeciesId?: number | undefined;
  /** Showdown: the form index on {@linkcode showdownSpeciesId} (e.g. a mega form). */
  showdownFormIndex?: number | undefined;
  /**
   * Showdown: the held item this mon carries - a `ShowdownItemKey` from
   * `SHOWDOWN_ITEM_POOL`, or the `MEGA_STONE_ITEM` sentinel (auto-set + locked when a mega
   * stage is chosen). `undefined` until the player picks one.
   */
  showdownItem?: string | undefined;
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
