import { pokerogueApi } from "#api/api";
import { clientSessionId, getSessionDataLocalStorageKey, loggedInUser, updateUserInfo } from "#app/account";
import { defaultStarterSpecies, saveKey } from "#app/constants";
import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { isIos } from "#app/touch-controls";
import { Tutorial } from "#app/tutorial";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { speciesStarterCosts } from "#balance/starters";
import { bypassLogin, isBeta, isDev } from "#constants/app-constants";
import { MAX_STARTER_CANDY_COUNT } from "#constants/game-constants";
import { EntryHazardTag } from "#data/arena-tag";
import { getSerializedDailyRunConfig, parseDailySeed } from "#data/daily-seed/daily-seed-utils";
import { allMoves, allSpecies } from "#data/data-lists";
import { Egg } from "#data/egg";
import { coopGateAccountWrite } from "#data/elite-redux/coop/coop-account-gate";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { classifySessionProtection, enqueueSessionCloudMutation } from "#data/elite-redux/coop/coop-cloud-save-tail";
import { isCoopControlPlaneSaveData } from "#data/elite-redux/coop/coop-control-plane";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  type CoopResumeLoadedSession,
  captureCoopResumeEvidence,
  coopParticipantPairMatches,
  coopResumeCommitmentMatches,
  coopSeatMapMatches,
  deriveCoopResumeCommitment,
  digestCoopResumeSession,
  readCoopResumeMarker,
  recordCoopDeletedRun,
  recordCoopResumeMarker,
  recordCoopResumeUnavailableEvidence,
  restoreCoopResumeEvidenceIfUnchanged,
} from "#data/elite-redux/coop/coop-resume-marker";
import { canonicalCoopParticipantPair, isCoopRunId, sameCoopIdentity } from "#data/elite-redux/coop/coop-run-identity";
import {
  applyCoopControlPlaneSaveData,
  clearCoopRuntime,
  coopBroadcastDexSync,
  coopSessionGeneration,
  getCoopControlPlaneSaveData,
  getCoopRuntime,
  purgeCoopBufferedArrivals,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import type {
  CoopResumeCheckpointPersistenceAck,
  CoopSessionController,
} from "#data/elite-redux/coop/coop-session-controller";
import type { CoopLaunchSnapshotAbortReason, CoopResumeCommitment } from "#data/elite-redux/coop/coop-transport";
import { getErAchievementRunState, restoreErAchievementRunState } from "#data/elite-redux/er-achievement-run-state";
import {
  getCommunityAllowedSpecies,
  getFounderRunState,
  setCommunityAllowedSpecies,
  setFounderRunState,
} from "#data/elite-redux/er-community-run-state";
import { migrateErRemovedFormUnlocks } from "#data/elite-redux/er-egg-pool-bans";
import { erMegaTargetToBaseSpeciesId } from "#data/elite-redux/er-generic-pool-bans";
import { type GhostTrainerProfile, sanitizeGhostProfile } from "#data/elite-redux/er-ghost-profile";
import { getErMapSaveData, restoreErMapState } from "#data/elite-redux/er-map-nodes";
import { getErMoneyStreakEntries, restoreErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import { getErReduxCounterpartId, migrateErReduxDexHijack } from "#data/elite-redux/er-redux-dex-redirect";
import { getErRelicBattleState, restoreErRelicBattleState } from "#data/elite-redux/er-relic-battle-state";
import { getErResistBerryEntries, restoreErResistBerries } from "#data/elite-redux/er-resist-berries";
import { getErDifficulty, getErDifficultyCandyMultiplier, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ER_CANDY_GAIN_MULTIPLIER, getRunCandyMultiplier } from "#data/elite-redux/er-shiny-favour";
import { grantErShinyLabSavedLookToSave, mergeErShinyLabSaveData } from "#data/elite-redux/er-shiny-lab-effects";
import { sanitizeTrainerFxSaveData, type TrainerFxSaveData } from "#data/elite-redux/er-trainer-fx";
import { getErUsedTrainerKeys, restoreErRunTrainerTracking } from "#data/elite-redux/er-trainer-runtime-hook";
import { getErWardStoneEntries, restoreErWardStones } from "#data/elite-redux/er-ward-stones";
import { swapSessionData } from "#data/elite-redux/showdown/showdown-side-swap";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import {
  deletePreset,
  makeShowdownTeamPreset,
  renamePreset,
  type ShowdownTeamPreset,
  sanitizeShowdownTeamPresets,
  upsertPreset,
} from "#data/elite-redux/showdown/showdown-team-preset";
import { pokemonFormChanges } from "#data/pokemon-forms";
import type { PokemonSpecies } from "#data/pokemon-species";
import { loadPositionalTag } from "#data/positional-tags/load-positional-tag";
import { TerrainType } from "#data/terrain";
import { AbilityAttr } from "#enums/ability-attr";
import { BattleType } from "#enums/battle-type";
import { ChallengeType } from "#enums/challenge-type";
import { Device } from "#enums/devices";
import { DexAttr } from "#enums/dex-attr";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { GameDataType } from "#enums/game-data-type";
import { GameModes } from "#enums/game-modes";
import type { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PlayerGender } from "#enums/player-gender";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import { WeatherType } from "#enums/weather-type";
import { TagAddedEvent, TerrainChangedEvent, WeatherChangedEvent } from "#events/arena";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
// biome-ignore lint/performance/noNamespaceImport: Something weird is going on here and I don't want to touch it
import * as Modifier from "#modifiers/modifier";
import { MysteryEncounterSaveData } from "#mystery-encounters/mystery-encounter-save-data";
import type { Variant } from "#sprites/variant";
import { achvs } from "#system/achv";
import { computeAchvProgress } from "#system/achv-category";
import { ArenaData, type SerializedArenaData } from "#system/arena-data";
import {
  type AutoEggRestockSettings,
  defaultAutoEggRestockSettings,
  mergeAutoEggRestockSettings,
} from "#system/auto-egg-restock-settings";
import { ChallengeData } from "#system/challenge-data";
import { EggData } from "#system/egg-data";
import { GameStats } from "#system/game-stats";
import { defaultDirectorState, type LLMDirectorState, mergeDirectorState } from "#system/llm-director/director-state";
import { ModifierData as PersistentModifierData } from "#system/modifier-data";
import { PokemonData } from "#system/pokemon-data";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { resetSettings, SettingKeys, setSetting } from "#system/settings";
import { SettingGamepad, setSettingGamepad, settingGamepadDefaults } from "#system/settings-gamepad";
import type { SettingKeyboard } from "#system/settings-keyboard";
import { setSettingKeyboard } from "#system/settings-keyboard";
import { TrainerData } from "#system/trainer-data";
import {
  applySessionVersionMigration,
  applySettingsVersionMigration,
  applySystemVersionMigration,
} from "#system/version-migration/version-converter";
import { VoucherType, vouchers } from "#system/voucher";
import type { DexData, DexEntry } from "#types/dex-data";
import type {
  AchvUnlocks,
  DexAttrProps,
  RunHistoryData,
  SeenDialogues,
  SessionSaveData,
  StarterData,
  StarterDataEntry,
  SystemSaveData,
  TutorialFlags,
  Unlocks,
  VoucherCounts,
  VoucherUnlocks,
} from "#types/save-data";
import { RUN_HISTORY_LIMIT } from "#ui/run-history-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { fixedInt, NumberHolder, randInt, randSeedItem } from "#utils/common";
import { decrypt, encrypt } from "#utils/data";
import { getEnumKeys } from "#utils/enums";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { toCamelCase } from "#utils/strings";
import { AES, enc } from "crypto-js";
import i18next from "i18next";

function getDataTypeKey(dataType: GameDataType, slotId = 0): string {
  switch (dataType) {
    case GameDataType.SYSTEM:
      return "data";
    case GameDataType.SESSION: {
      let ret = "sessionData";
      if (slotId) {
        ret += slotId;
      }
      return ret;
    }
    case GameDataType.SETTINGS:
      return "settings";
    case GameDataType.TUTORIALS:
      return "tutorials";
    case GameDataType.SEEN_DIALOGUES:
      return "seenDialogues";
    case GameDataType.RUN_HISTORY:
      return "runHistoryData";
  }
}

const systemShortKeys = {
  seenAttr: "$sa",
  caughtAttr: "$ca",
  natureAttr: "$na",
  seenCount: "$s",
  caughtCount: "$c",
  hatchedCount: "$hc",
  ivs: "$i",
  moveset: "$m",
  eggMoves: "$em",
  candyCount: "$x",
  friendship: "$f",
  abilityAttr: "$a",
  passiveAttr: "$pa",
  valueReduction: "$vr",
  classicWinCount: "$wc",
  erShinyLabAvailableEffects: "$esla",
  erShinyLab: "$esl",
  ghostProfile: "$gp",
  spentAchvPoints: "$sap",
  trainerFx: "$tfx",
};

const CLOUD_SYNC_MIN_INTERVAL_MS = 20 * 60 * 1000;
const CLOUD_SYNC_BACKOFF_BASE_MS = 20 * 60 * 1000;
const CLOUD_SYNC_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
const COOP_PERSISTENCE_LOCK_ACQUIRE_TIMEOUT_MS = 2_000;
// Ordinary persistence operations fail closed quickly so a wedged tab cannot stall gameplay. Once an
// exact backend tombstone has committed, however, returning early leaves the browser advertising stale
// local bytes even though the authoritative row is already gone. Give that final compare-delete enough
// time to wait behind a legitimate in-flight checkpoint transaction; it still uses the same account Web
// Lock and exact local/head guards, so a concurrent tab can never be erased speculatively.
const COOP_COMMITTED_DELETE_LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const COOP_PERSISTENCE_NETWORK_TIMEOUT_MS = 5_000;
// The GUEST's fresh first-save durability persist chains several SEQUENTIAL real-cloud round-trips
// (per-slot CAS reads -> run-status guard -> empty-CAS mirror write), each independently bounded by
// COOP_PERSISTENCE_NETWORK_TIMEOUT_MS, plus a lock acquire and digest hashing. The HOST's ack budget
// must cover the guest's WORST-CASE completion, not a single round-trip: the bare 5_000ms was inverted
// against the guest's chain and, on real-world RTT (phones / slow links) or a CPU-starved client, the
// ack times out (~6.5s observed) and the host aborts a perfectly healthy launch ("guest-persistence-
// failed") - stranding the guest pre-boot (P33 layer-6). Size for real players, not CI. A generous
// budget only adds latency to a GENUINE-failure abort; the checkpoint is retained for reconnect retry
// either way, and a successful late ack still retires the outbox (see resumeCheckpointAck handling).
const COOP_FRESH_LAUNCH_GUEST_CHAIN_DEPTH = 4; // marker read + parallel slot reads + run-status + mirror write
const COOP_RESUME_CHECKPOINT_ACK_TIMEOUT_MS =
  COOP_FRESH_LAUNCH_GUEST_CHAIN_DEPTH * COOP_PERSISTENCE_NETWORK_TIMEOUT_MS
  + COOP_PERSISTENCE_LOCK_ACQUIRE_TIMEOUT_MS
  + 3_000; // digest hashing + CPU-starved-client scheduling headroom

export interface CoopPersistenceClock {
  lockAcquireTimeoutMs: number;
  networkTimeoutMs: number;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

const defaultCoopPersistenceClock: CoopPersistenceClock = {
  lockAcquireTimeoutMs: COOP_PERSISTENCE_LOCK_ACQUIRE_TIMEOUT_MS,
  networkTimeoutMs: COOP_PERSISTENCE_NETWORK_TIMEOUT_MS,
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
let coopPersistenceClock = defaultCoopPersistenceClock;

/** Inject a deterministic clock for production-path persistence tests without wall-clock sleeps. */
export function setCoopPersistenceClockForTesting(clock: CoopPersistenceClock | null): void {
  coopPersistenceClock = clock ?? defaultCoopPersistenceClock;
}

interface CoopResumeCloudCas {
  mode: "empty" | "existing";
  runId?: string;
  checkpointRevision?: number;
  digest?: string;
}

interface CoopKnownCloudHead {
  version: 1;
  runId: string;
  checkpointRevision: number;
  digest: string;
}

interface CoopDuplicateConvergenceDebt {
  version: 1;
  loserSlot: number;
  loser: CoopKnownCloudHead;
  survivorSlot: number;
  survivor: CoopKnownCloudHead;
}

interface CoopDuplicateLocalFence {
  storageKey: string;
  localRaw: string | null;
  head: CoopKnownCloudHeadState;
  removeLocal: boolean;
}

type CoopKnownCloudHeadState =
  | { kind: "absent" }
  | { kind: "invalid"; raw: string }
  | { kind: "valid"; head: CoopKnownCloudHead };

interface CoopClassifiedReplica {
  slot: number;
  raw: string;
  protection: "solo" | "coop-valid" | "coop-invalid" | "unknown";
  session: SessionSaveData | null;
  commitment: CoopResumeCommitment | null;
}

type CoopImportDisposition =
  | { kind: "ordinary" }
  | { kind: "same-run" }
  | {
      kind: "replace-tombstoned";
      prior: CoopResumeCommitment;
      expectedHead: CoopKnownCloudHeadState;
      expectedLocalRaw: string;
    };

type CoopCloudCasClientResult =
  | { ok: true; error: ""; failureKind: null }
  | {
      ok: false;
      error: string;
      failureKind: "conflict" | "invalid" | "unauthorized" | "unsupported" | "too-large" | "transient";
      /** Only the exact frozen parent permits a local-only checkpoint to continue as durable debt. */
      continuationSafe: boolean;
      /** Rollback is permitted only when readback proves the exact frozen parent still owns the slot. */
      rollbackSafe: boolean;
    };

interface CoopFreshSessionSlotClaim {
  slot: number;
  runId: string;
  generation: number;
  accountIdentity: string | null;
  controller: CoopSessionController;
}

interface CoopPersistenceContext {
  accountIdentity: string | null;
  slot: number;
  storageKey: string;
  runtime: NonNullable<ReturnType<typeof getCoopRuntime>>;
  controller: CoopSessionController;
  generation: number;
  runId: string;
}

export type CoopFreshLaunchConsumption =
  | { kind: "not-fresh" }
  | { kind: "committed"; sessionJson: string }
  | { kind: "invalid" };

class CoopResumeReplicaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoopResumeReplicaUnavailableError";
  }
}

/**
 * One immutable lobby scan. Slot failures stay attached to their slot so discovery can
 * still inspect every other replica and make a partner-specific decision. Global
 * account/cloud-scan failures still reject the scan itself.
 */
export interface CoopResumeLobbySnapshot {
  sessions: Map<number, CoopResumeLoadedSession | undefined>;
  failures: Map<number, Error>;
}

interface ImportableLocalSessionSave {
  slot: number;
  data: string;
}

interface ImportableLocalSaveBundle {
  system: string;
  sessions: ImportableLocalSessionSave[];
}

interface ImportableLocalSystemCandidate {
  key: string;
  data: string;
}

interface CloudSyncState {
  lastSuccessAt?: number;
  blockedUntil?: number;
  failureCount?: number;
}

/**
 * Write to localStorage without letting a failure abort the save flow. A bloated
 * system save - most often a very large egg inventory - can push `data_<user>`
 * (or a `sessionData_<user>` slot) past the browser's ~5MB localStorage quota, at
 * which point `setItem` throws QuotaExceededError. Left uncaught inside
 * {@linkcode GameData.saveSystem} / {@linkcode GameData.saveAll}, that rejected
 * the save promise mid-flow: the saving icon spun forever (Save & Quit appeared to
 * "freeze"), the cloud push was skipped, and the player had to refresh. This
 * swallows the error and returns false so callers can warn the player and still
 * push to the cloud (which serializes from the in-memory objects, not from
 * localStorage, so a too-large local save can still sync).
 * @returns true if the write landed, false if it was rejected (e.g. quota full).
 */
export function trySetLocalStorageItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    const quota =
      err instanceof DOMException
      && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22);
    console.error(
      `Failed to write "${key}" to localStorage${quota ? " - browser storage is full (save too large, e.g. too many eggs)" : ""}:`,
      err,
    );
    return false;
  }
}

export class GameData {
  public trainerId: number;
  public secretId: number;

  /**
   * Set by {@linkcode loadSystem} when the logged-in account had NO cloud system
   * save (a brand-new account / 404). The login flow reads this to offer a
   * one-time "import your existing local save?" prompt (#229).
   */
  public cloudSaveMissing = false;

  /**
   * ER (#389): set by {@linkcode saveAll} when the most recent attempted cloud
   * push FAILED (non-fatal - the save still landed in localStorage and the
   * sync retries later). Save and Quit reads this to warn the player that the
   * save is local-only right now.
   */
  public lastCloudSyncFailed = false;

  /**
   * ER save-integrity guard: `true` once THIS GameData instance has been populated
   * from real persisted system data (a successful {@linkcode initParsedSystem}), or
   * once a brand-new account has legitimately committed its first system save.
   *
   * A fresh `new GameData()` - notably the one {@linkcode BattleScene.reset} installs
   * on a 401 / auth-reset, before the re-login re-loads - starts `false`. saveSystem
   * reads this to REFUSE overwriting EXISTING non-empty local data with an empty,
   * never-loaded in-memory state (the "I lost all my data" clobber vector). A genuine
   * new account has no existing local blob, so its first save is still allowed.
   */
  private systemDataLoaded = false;

  /**
   * A confirmed overwrite has already retired the previous cloud row. Its replacement must bypass
   * the ordinary cloud cadence exactly once, otherwise the preceding save's 20-minute success
   * cooldown can leave the newly occupied slot local-only after the destructive delete.
   */
  private pendingOverwriteCloudSync: { slot: number; accountIdentity: string } | null = null;

  /**
   * ER: set when a localStorage write (system or session save) was rejected -
   * typically QuotaExceededError, the browser's ~5MB cap exceeded by a bloated
   * save (e.g. a very large egg inventory). The save flow no longer throws on this
   * (which froze Save & Quit); it warns once and still attempts the cloud push.
   * Reset on the next successful local write.
   */
  public lastLocalSaveFailed = false;
  /** Guards the "storage full" player notice so it shows once, not every save. */
  private warnedLocalStorageFull = false;
  /** One-time guard for the cloud-save-protected notice (server save-clobber guard). */
  private warnedCloudSaveProtected = false;
  /** Tentative empty slot; it becomes owned only when the first complete session wins backend CAS. */
  private pendingFreshCoopSlotClaim: CoopFreshSessionSlotClaim | null = null;
  /** Exact first-save bytes released to the guest only after host CAS + guest durability succeed. */
  private committedFreshCoopLaunchSession: {
    wave: number;
    sessionJson: string;
    controller: CoopSessionController;
    runId: string;
    generation: number;
    slot: number;
    accountIdentity: string | null;
    encryptedSession: string;
  } | null = null;
  /** Exact guest persistence closure bound to one immutable runtime/account generation. */
  private coopResumeCheckpointPersistence: {
    runtime: NonNullable<ReturnType<typeof getCoopRuntime>>;
    controller: CoopSessionController;
    generation: number;
    accountIdentity: string | null;
    persist: (
      session: string,
      commitment: CoopResumeCommitment,
      mirrorCloud: boolean,
    ) => Promise<CoopResumeCheckpointPersistenceAck>;
  } | null = null;

  public gender: PlayerGender;

  public dexData: DexData;
  private defaultDexData: DexData | null;

  public starterData: StarterData;

  public gameStats: GameStats;
  public runHistory: RunHistoryData;

  public unlocks: Unlocks;

  public achvUnlocks: AchvUnlocks;

  public voucherUnlocks: VoucherUnlocks;
  public voucherCounts: VoucherCounts;
  public eggs: Egg[];
  public eggPity: number[];
  public unlockPity: number[];
  /** ER Shiny Lab: global achievement/challenge availability bitset. */
  public erShinyLabAvailableEffects: number[] = [];
  /** ER Ghost Trainer Editor: the player's authored ghost presentation profile. */
  public ghostProfile: GhostTrainerProfile | null = null;
  /** ER Ghost Trainer FX: total achievement points already spent unlocking effects. */
  public spentAchvPoints = 0;
  /** ER Ghost Trainer FX: owned entrance/aura effect bitsets + equipped picks. */
  public trainerFx: TrainerFxSaveData = {};
  /** ER achievement rewards: earned trainer titles (display UI deferred; persistence only). */
  public erTitles: string[] = [];

  /**
   * One-time gift flag: set `true` once the player has received the free 2
   * Legendary eggs grant. Persisted in `SystemSaveData` so the grant fires
   * exactly once. See {@linkcode grantFreeLegendaryEggsOnce}.
   */
  public freeLegendaryEggsGranted = false;

  /** Settings controlling silent auto-restock of the egg queue between waves. */
  public autoEggRestock: AutoEggRestockSettings = defaultAutoEggRestockSettings();

  /** Persistent state for LLM Director runs (story bible, beat history, alignment, …). */
  public llmDirectorState: LLMDirectorState = defaultDirectorState();

  /** Showdown 1v1 (D2/I2): applied-settlement row-id ledger (capped FIFO), persisted in the system save. */
  public showdownAppliedSettlements: number[] = [];

  /**
   * Showdown 1v1 (Team Menu): named TEAM presets, serialized in the account save so they
   * survive a device change (superseding the earlier local-only v1 decision). Each preset is
   * a named list of the wire manifests, fed straight into the negotiate pipeline at lobby entry.
   * Optional for back-compat (absent = []); sanitized on load.
   */
  public showdownTeamPresets: ShowdownTeamPreset[] = [];

  /**
   * @param fromRaw - If true, will skip initialization of fields that are normally randomized on new game start. Used for the admin panel; default `false`
   */
  constructor(fromRaw = false) {
    if (fromRaw) {
      this.trainerId = 0;
      this.secretId = 0;
    } else {
      this.loadSettings();
      this.loadGamepadSettings();
      this.loadMappingConfigs();
      this.trainerId = randInt(65536);
      this.secretId = randInt(65536);
    }
    this.starterData = {};
    this.gameStats = new GameStats();
    this.runHistory = {};
    this.unlocks = {
      [Unlockables.ENDLESS_MODE]: false,
      [Unlockables.MINI_BLACK_HOLE]: false,
      [Unlockables.SPLICED_ENDLESS_MODE]: false,
      [Unlockables.EVIOLITE]: false,
    };
    this.achvUnlocks = {};
    this.voucherUnlocks = {};
    this.voucherCounts = {
      [VoucherType.REGULAR]: 0,
      [VoucherType.PLUS]: 0,
      [VoucherType.PREMIUM]: 0,
      [VoucherType.GOLDEN]: 0,
    };
    this.eggs = [];
    this.eggPity = [0, 0, 0, 0];
    this.unlockPity = [0, 0, 0, 0];
    this.erShinyLabAvailableEffects = [];
    this.ghostProfile = null;
    this.spentAchvPoints = 0;
    this.trainerFx = {};
    this.erTitles = [];
    this.autoEggRestock = defaultAutoEggRestockSettings();
    this.llmDirectorState = defaultDirectorState();
    this.showdownAppliedSettlements = [];
    this.showdownTeamPresets = [];
    this.initDexData();
    this.initStarterData();
    this.applyLocalAllStartersDebug();
  }

  public getSystemSaveData(): SystemSaveData {
    return {
      trainerId: this.trainerId,
      secretId: this.secretId,
      gender: this.gender,
      dexData: this.dexData,
      starterData: this.starterData,
      gameStats: this.gameStats,
      unlocks: this.unlocks,
      achvUnlocks: this.achvUnlocks,
      voucherUnlocks: this.voucherUnlocks,
      voucherCounts: this.voucherCounts,
      eggs: this.eggs.map(e => new EggData(e)),
      gameVersion: globalScene.game.config.gameVersion,
      timestamp: Date.now(),
      eggPity: this.eggPity.slice(0),
      unlockPity: this.unlockPity.slice(0),
      autoEggRestock: this.autoEggRestock,
      llmDirectorState: this.llmDirectorState,
      showdownAppliedSettlements: this.showdownAppliedSettlements.slice(0),
      showdownTeamPresets: this.showdownTeamPresets.map(p => ({ ...p, mons: p.mons.map(m => ({ ...m })) })),
      freeLegendaryEggsGranted: this.freeLegendaryEggsGranted,
      erShinyLabAvailableEffects: this.erShinyLabAvailableEffects.slice(0),
      ghostProfile: this.ghostProfile,
      spentAchvPoints: this.spentAchvPoints,
      trainerFx: this.trainerFx,
      erTitles: this.erTitles.slice(0),
    };
  }

  /**
   * One-time gift: grant the player 2 free Legendary eggs, exactly once. The
   * {@linkcode freeLegendaryEggsGranted} flag is persisted in the system save
   * (and therefore the cloud save), so once received this is a permanent no-op —
   * it never re-triggers across reloads, sessions, or devices. Called from both
   * the load path ({@linkcode initParsedSystem}) and the save path
   * ({@linkcode saveSystem}) so every player — existing and brand-new — gets it.
   */
  public grantFreeLegendaryEggsOnce(): void {
    if (this.freeLegendaryEggsGranted) {
      return;
    }
    for (let i = 0; i < 2; i++) {
      this.eggs.push(new Egg({ tier: EggTier.LEGENDARY, sourceType: EggSourceType.EVENT }));
    }
    this.freeLegendaryEggsGranted = true;
    console.log("[er-gift] granted 2 free Legendary eggs (one-time)");
  }

  // --- Showdown TEAM PRESETS (account-save CRUD) --------------------------------------------
  //
  // Thin persistence wrappers over the PURE helpers in `showdown-team-preset.ts` (unit-tested
  // there). Each mutation persists via `saveSystem` (best-effort cloud + local cache) so a
  // preset created in the Team Menu survives a reload/device change. `saveSystem` is fired
  // fire-and-forget - the menu updates its own local list from the returned array immediately.

  /** All saved team presets (a live reference; the menu reads it each render for re-validation). */
  public listShowdownTeamPresets(): ShowdownTeamPreset[] {
    return this.showdownTeamPresets;
  }

  /**
   * Save a team preset. When `index` names an existing preset the flow is EDITING it in place;
   * otherwise a new preset is appended (capped). Returns the 0-based index of the saved preset.
   */
  public saveShowdownTeamPreset(name: string, mons: ShowdownMonManifest[], index?: number): number {
    const preset = makeShowdownTeamPreset(name, mons);
    this.showdownTeamPresets = upsertPreset(this.showdownTeamPresets, preset, index);
    const savedIndex =
      index !== undefined && index >= 0 && index < this.showdownTeamPresets.length
        ? index
        : this.showdownTeamPresets.length - 1;
    void this.saveSystem();
    return savedIndex;
  }

  /** Rename the preset at `index`, persisting the change. */
  public renameShowdownTeamPreset(index: number, newName: string): void {
    this.showdownTeamPresets = renamePreset(this.showdownTeamPresets, index, newName);
    void this.saveSystem();
  }

  /** Delete the preset at `index`, persisting the change. */
  public deleteShowdownTeamPreset(index: number): void {
    this.showdownTeamPresets = deletePreset(this.showdownTeamPresets, index);
    void this.saveSystem();
  }

  /**
   * ER Ghost Trainer FX currency: the player's SPENDABLE achievement points.
   * There is no stored total - it is derived live from `achvUnlocks` (the sum of
   * `score` over unlocked achievements) MINUS the persisted {@linkcode spentAchvPoints}
   * counter. This is the game's first AP sink; spending NEVER mutates achvUnlocks.
   */
  public getSpendableAchvPoints(): number {
    const earned = computeAchvProgress(this.achvUnlocks).overall.earnedScore;
    return Math.max(0, earned - Math.max(0, this.spentAchvPoints || 0));
  }

  /**
   * Spend `amount` achievement points. Returns `false` (and changes nothing) when
   * the player can't afford it; otherwise increments {@linkcode spentAchvPoints},
   * persists the system save, and returns `true`. Callers should set the relevant
   * owned bit BEFORE calling so it is captured in the same save.
   */
  public spendAchvPoints(amount: number): boolean {
    const cost = Math.max(0, Math.round(amount));
    if (cost > this.getSpendableAchvPoints()) {
      return false;
    }
    this.spentAchvPoints = Math.max(0, this.spentAchvPoints || 0) + cost;
    void this.saveSystem();
    return true;
  }

  /**
   * Checks if an `Unlockable` has been unlocked.
   * @param unlockable The Unlockable to check
   * @returns `true` if the player has unlocked this `Unlockable` or an override has enabled it
   */
  public isUnlocked(unlockable: Unlockables): boolean {
    if (Overrides.ITEM_UNLOCK_OVERRIDE.includes(unlockable)) {
      return true;
    }
    return this.unlocks[unlockable];
  }

  /**
   * Surface a one-time, non-blocking notice that a local save was rejected for
   * lack of browser storage (see {@linkcode trySetLocalStorageItem}). Best-effort:
   * if the current UI context can't show a queued message, the console error from
   * the failed write is the fallback. The guard resets on the next save that fits,
   * so the player is re-warned if they fill storage again.
   */
  private warnLocalStorageFull(): void {
    this.lastLocalSaveFailed = true;
    if (this.warnedLocalStorageFull) {
      return;
    }
    this.warnedLocalStorageFull = true;
    try {
      globalScene.phaseManager.queueMessage(
        "This browser's storage is full, so your game could not be saved locally - your save has grown too large, usually from holding too many eggs. Hatch or release some eggs, then save again. (Cloud sync was still attempted.)",
        null,
        true,
      );
    } catch (e) {
      console.debug("Could not show the localStorage-full notice in the current UI context:", e);
    }
  }

  /**
   * Surface a one-time, non-blocking notice that this device's system save was
   * refused by the server save-clobber guard because it would regress the cloud
   * save (stale or empty local data, e.g. a cleared cache). Nothing was overwritten
   * locally or in the cloud; reloading re-pulls the authoritative cloud save. Shown
   * once per session so repeated autosaves do not spam it.
   */
  private warnCloudSaveProtected(): void {
    if (this.warnedCloudSaveProtected) {
      return;
    }
    this.warnedCloudSaveProtected = true;
    try {
      globalScene.phaseManager.queueMessage(
        "Your cloud save was protected. This device's data looks out of date, so it was not uploaded over your saved progress. Reload the page to restore your cloud save.",
        null,
        true,
      );
    } catch (e) {
      console.debug("Could not show the cloud-save-protected notice in the current UI context:", e);
    }
  }

  public async saveSystem(forceSync = false): Promise<boolean> {
    globalScene.ui.savingIcon.show();
    // Catch-all for the one-time Legendary-egg gift: a brand-new account never
    // runs initParsedSystem on its first session (no save to parse yet), so the
    // grant rides the first save instead. Idempotent (flag-guarded).
    this.grantFreeLegendaryEggsOnce();
    const data = this.getSystemSaveData();

    const maxIntAttrValue = 0x80000000;
    const systemData = JSON.stringify(data, (_k: any, v: any) =>
      typeof v === "bigint" ? (v <= maxIntAttrValue ? Number(v) : v.toString()) : v,
    );

    // ER save-integrity guard (the "I lost all my data" clobber vector): NEVER let an
    // in-memory GameData that was never loaded from persistence overwrite EXISTING
    // non-empty local data. This is the state a 401 / auth-reset leaves behind
    // (BattleScene.reset installs a fresh, empty `new GameData()` before the re-login
    // re-loads); a stray save in that window would replace good local bytes with an
    // empty save. A genuine new account has no existing local blob, so its first save
    // still lands. We preserve the bytes and surface the failure instead of persisting.
    const systemLocalKey = `data_${loggedInUser?.username}`;
    const existingLocal = localStorage.getItem(systemLocalKey);
    if (!this.systemDataLoaded && existingLocal != null && existingLocal.length > 0) {
      console.error(
        "[save] refusing to overwrite existing local system save with never-loaded (empty) data - preserving local bytes",
      );
      this.lastCloudSyncFailed = true;
      this.warnCloudSaveProtected();
      globalScene.ui.savingIcon.hide();
      return false;
    }

    const localSaved = trySetLocalStorageItem(systemLocalKey, encrypt(systemData, bypassLogin));
    if (localSaved) {
      // This instance is now the source of truth for local bytes; later saves may overwrite.
      this.systemDataLoaded = true;
      this.warnedLocalStorageFull = false;
      this.lastLocalSaveFailed = false;
    } else {
      // Storage full: warn once and fall through so the cloud push still runs (it
      // serializes from `systemData`, not localStorage) instead of freezing here.
      this.warnLocalStorageFull();
    }

    if (bypassLogin) {
      globalScene.ui.savingIcon.hide();
      return localSaved;
    }

    if (!forceSync && !this.shouldAttemptCloudSync()) {
      globalScene.ui.savingIcon.hide();
      return localSaved;
    }

    const error = await pokerogueApi.savedata.system.update({ clientSessionId }, systemData);
    globalScene.ui.savingIcon.hide();
    if (error) {
      if (error.startsWith("session out of date")) {
        globalScene.phaseManager.clearPhaseQueue();
        globalScene.phaseManager.unshiftNew("ReloadSessionPhase");
        console.error(error);
        return false;
      }
      if (error.startsWith("Save rejected")) {
        // Server save-clobber guard refused this push: this device's save would
        // regress the cloud copy (stale or empty local data, e.g. a cleared cache).
        // The cloud save is untouched; warn the player once that a reload restores
        // it. Same control flow as a generic sync failure otherwise.
        this.markCloudSyncFailure();
        this.warnCloudSaveProtected();
        console.warn(error);
        return true;
      }
      this.markCloudSyncFailure();
      console.error(error);
      return true;
    }
    this.markCloudSyncSuccess();
    return true;
  }

  public async loadSystem(): Promise<boolean> {
    console.log("Client Session:", clientSessionId);
    this.cloudSaveMissing = false;

    if (bypassLogin && !localStorage.getItem(`data_${loggedInUser?.username}`)) {
      return false;
    }

    if (bypassLogin) {
      return await this.initSystem(decrypt(localStorage.getItem(`data_${loggedInUser?.username}`)!, bypassLogin)); // TODO: is this bang correct?
    }
    const saveDataOrErr = await pokerogueApi.savedata.system.get({ clientSessionId });

    if (typeof saveDataOrErr === "number" || !saveDataOrErr || saveDataOrErr.length === 0 || saveDataOrErr[0] !== "{") {
      if (saveDataOrErr === 404) {
        // Brand-new account: no cloud save. Flag it so the login flow can offer
        // a one-time "import your existing local save?" prompt (#229). Suppress
        // the alarming "could not be found" notice when a local save IS available
        // to import — otherwise players see a false-alarm error a split second
        // before the import prompt fires and their data loads fine. Only show the
        // notice when there's genuinely nothing to import (a true fresh account).
        this.cloudSaveMissing = true;
        if (!bypassLogin && this.findImportableLocalSaveBundle()) {
          return true;
        }
        globalScene.phaseManager.queueMessage(
          "Save data could not be found. If this is a new account, you can safely ignore this message.",
          null,
          true,
        );
        return true;
      }
      if (typeof saveDataOrErr === "string" && saveDataOrErr.includes("Too many connections")) {
        globalScene.phaseManager.queueMessage(
          "Too many people are trying to connect and the server is overloaded. Please try again later.",
          null,
          true,
        );
        return false;
      }
      return false;
    }

    const cachedSystem = localStorage.getItem(`data_${loggedInUser?.username}`);
    return await this.initSystem(
      // Route through decrypt() (not raw AES) so a compressed local cache (#631)
      // is decompressed; legacy plaintext caches pass through unchanged.
      saveDataOrErr,
      cachedSystem ? decrypt(cachedSystem, bypassLogin) : undefined,
    );
  }

  public findImportableLocalSaveBundle(): ImportableLocalSaveBundle | null {
    const candidate = this.findImportableLocalSystemCandidate();
    if (!candidate) {
      return null;
    }
    return {
      system: candidate.data,
      sessions: this.findImportableLocalSessionSaves(candidate.key),
    };
  }

  private findImportableLocalSystemCandidate(): ImportableLocalSystemCandidate | null {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const currentKey = `data_${loggedInUser?.username}`;
    const candidates: string[] = [];
    for (const key of Object.keys(localStorage)) {
      if (!key || key.endsWith("_bak") || key === currentKey || (key !== "data" && !key.startsWith("data_"))) {
        continue;
      }
      candidates.push(key);
    }
    candidates.sort((a, b) => {
      const rank = (key: string) => (key === "data_Guest" ? 0 : key === "data" ? 1 : 2);
      return rank(a) - rank(b);
    });
    for (const key of candidates) {
      const raw = localStorage.getItem(key);
      const data = raw ? this.decryptImportableLocalSave(raw) : null;
      if (data) {
        return { key, data };
      }
    }
    return null;
  }

  private findImportableLocalSessionSaves(systemKey: string): ImportableLocalSessionSave[] {
    const userSuffix = systemKey === "data" ? "" : systemKey.slice("data_".length);
    const sessions: ImportableLocalSessionSave[] = [];
    for (let slot = 0; slot < 5; slot++) {
      const base = `sessionData${slot || ""}`;
      const candidateKeys = userSuffix ? [`${base}_${userSuffix}`] : [base];
      if (slot === 0) {
        candidateKeys.push(userSuffix ? `sessionData0_${userSuffix}` : "sessionData0");
      }
      for (const key of candidateKeys) {
        const raw = localStorage.getItem(key);
        const data = raw ? this.decryptImportableLocalSave(raw) : null;
        if (!data) {
          continue;
        }
        try {
          JSON.parse(data);
          sessions.push({ slot, data });
          break;
        } catch {}
      }
    }
    return sessions;
  }

  private decryptImportableLocalSave(raw: string): string | null {
    for (const asGuest of [true, false]) {
      try {
        const decrypted = decrypt(raw, asGuest);
        if (decrypted && decrypted[0] === "{") {
          return decrypted;
        }
      } catch {}
    }
    return null;
  }

  /**
   * Find a locally-stored system save that could be imported into a freshly
   * logged-in account that has no cloud save yet (#229). Returns the decrypted
   * raw `SystemSaveData` JSON string, or `null` if none is found.
   *
   * Scans every `data_*` localStorage key except the current user's and any
   * `_bak` backups, preferring the `data_Guest` save (the standalone/local-only
   * default). Each candidate is tried with BOTH decryption schemes — Guest saves
   * are base64 (`bypassLogin` encoding) while logged-in saves are AES — so a save
   * written under either mode is recoverable.
   */
  public findImportableLocalSave(): string | null {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const currentKey = `data_${loggedInUser?.username}`;
    const candidates: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("data_") || key.endsWith("_bak") || key === currentKey) {
        continue;
      }
      candidates.push(key);
    }
    // Prefer the Guest save (the most common "I played locally then made an account" case).
    candidates.sort((a, b) => (a === "data_Guest" ? -1 : b === "data_Guest" ? 1 : 0));
    for (const key of candidates) {
      const raw = localStorage.getItem(key);
      if (!raw) {
        continue;
      }
      for (const asGuest of [true, false]) {
        try {
          const decrypted = decrypt(raw, asGuest);
          if (decrypted && decrypted[0] === "{") {
            return decrypted;
          }
        } catch {
          // Wrong scheme for this blob — try the other.
        }
      }
    }
    return null;
  }

  /**
   * Import a raw `SystemSaveData` JSON string into the current (logged-in)
   * account and push it to the cloud (and local cache) via {@linkcode saveSystem}.
   * Used by the first-login "import your local save?" prompt (#229).
   * @returns whether the cloud save succeeded.
   */
  public async importSystemSaveString(rawSystemDataStr: string): Promise<boolean> {
    await this.initSystem(rawSystemDataStr);
    this.cloudSaveMissing = false;
    return this.saveSystem();
  }

  public async importLocalSaveBundle(bundle: ImportableLocalSaveBundle): Promise<boolean> {
    let success = true;
    await this.initSystem(bundle.system);
    this.cloudSaveMissing = false;
    success = (await this.saveSystem(true)) && success;
    for (const session of bundle.sessions) {
      const accountIdentity = this.currentPersistenceAccount();
      if (!bypassLogin && accountIdentity == null) {
        success = false;
        continue;
      }
      let parsedSession: SessionSaveData | null = null;
      try {
        parsedSession = this.parseSessionData(session.data);
      } catch {
        // The legacy endpoint will report malformed solo data as before; protected co-op bytes fail below.
      }
      const incomingProtection = classifySessionProtection(session.data);
      const protectedCoop = incomingProtection === "coop-valid";
      if (incomingProtection === "coop-invalid") {
        success = false;
        continue;
      }
      const localKey = this.sessionStorageKeyForAccount(session.slot, accountIdentity);
      const localBeforeCloud = localStorage.getItem(localKey);
      const importDisposition = await this.assessImportOverLocalSession(
        session.slot,
        localBeforeCloud,
        session.data,
        parsedSession,
        accountIdentity,
      );
      if (importDisposition == null) {
        success = false;
        continue;
      }
      const error = await enqueueSessionCloudMutation(accountIdentity, async () => {
        if (!this.persistenceAccountIsCurrent(accountIdentity)) {
          return "Import account changed while queued.";
        }
        if (protectedCoop && parsedSession != null) {
          const mutation = await this.updateCoopCloudCas(session.slot, session.data, parsedSession, importDisposition);
          return mutation.ok ? "" : mutation.error;
        }
        return this.updateSessionBounded(
          {
            slot: session.slot,
            trainerId: this.trainerId,
            secretId: this.secretId,
            clientSessionId,
          },
          session.data,
        );
      });
      if (error) {
        console.error(error);
        success = false;
        continue;
      }
      if (protectedCoop) {
        const localCommitted = await this.withCoopResumePersistenceLease(async () => {
          if (localStorage.getItem(localKey) !== localBeforeCloud) {
            return false;
          }
          const encrypted = encrypt(session.data, bypassLogin);
          return trySetLocalStorageItem(localKey, encrypted) && localStorage.getItem(localKey) === encrypted;
        }, accountIdentity);
        if (localCommitted !== true) {
          success = false;
          continue;
        }
      } else {
        const encrypted = encrypt(session.data, bypassLogin);
        const localCommitted = await this.withSessionPersistenceLease(
          async () => {
            if (localStorage.getItem(localKey) !== localBeforeCloud) {
              return false;
            }
            localStorage.setItem(localKey, encrypted);
            return localStorage.getItem(localKey) === encrypted;
          },
          false,
          accountIdentity,
        );
        if (localCommitted !== true) {
          success = false;
          continue;
        }
      }
      if (loggedInUser) {
        loggedInUser.lastSessionSlot = Math.max(loggedInUser.lastSessionSlot, session.slot);
      }
    }
    // Also seed the shared run-history / ghost-team pool from this device's local
    // history (#217/#229). Dynamic import avoids rooting the heavy ghost-team /
    // pokemon import chain into game-data; best-effort, never blocks the import.
    void import("#data/elite-redux/er-ghost-teams")
      .then(m => m.uploadLocalRunHistory())
      .catch(err => console.error("Run-history seed failed:", err));
    return success;
  }

  private getCloudSyncStateKey(): string {
    return `cloudSyncState_${loggedInUser?.username}`;
  }

  private getCloudSyncState(): CloudSyncState {
    const raw = localStorage.getItem(this.getCloudSyncStateKey());
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw) as CloudSyncState;
    } catch {
      return {};
    }
  }

  private setCloudSyncState(state: CloudSyncState): void {
    localStorage.setItem(this.getCloudSyncStateKey(), JSON.stringify(state));
  }

  private shouldAttemptCloudSync(): boolean {
    const now = Date.now();
    const state = this.getCloudSyncState();
    if ((state.blockedUntil ?? 0) > now) {
      return false;
    }
    if (state.lastSuccessAt && now - state.lastSuccessAt < CLOUD_SYNC_MIN_INTERVAL_MS) {
      return false;
    }
    return true;
  }

  private markCloudSyncSuccess(): void {
    this.setCloudSyncState({ lastSuccessAt: Date.now(), failureCount: 0 });
  }

  private markCloudSyncFailure(): void {
    const state = this.getCloudSyncState();
    const failureCount = Math.min((state.failureCount ?? 0) + 1, 8);
    const blockedFor = Math.min(CLOUD_SYNC_BACKOFF_BASE_MS * 2 ** (failureCount - 1), CLOUD_SYNC_BACKOFF_MAX_MS);
    this.setCloudSyncState({
      ...state,
      failureCount,
      blockedUntil: Date.now() + blockedFor,
    });
  }

  /**
   *
   * @param dataStr - The raw JSON string of the `SystemSaveData`
   * @returns - A new `GameData` instance initialized with the parsed `SystemSaveData`
   */
  public static fromRawSystem(dataStr: string): GameData {
    const gameData = new GameData(true);
    const systemData = GameData.parseSystemData(dataStr);
    gameData.initParsedSystem(systemData);
    return gameData;
  }

  /**
   * Initialize system data _after_ it has been parsed from JSON.
   * @param systemData The parsed `SystemSaveData` to initialize from
   */
  private initParsedSystem(systemData: SystemSaveData): void {
    applySystemVersionMigration(systemData);

    this.trainerId = systemData.trainerId;
    this.secretId = systemData.secretId;

    this.gender = systemData.gender;

    this.saveSetting(SettingKeys.Player_Gender, systemData.gender === PlayerGender.FEMALE ? 1 : 0);

    if (systemData.starterData) {
      // ER fix: init FIRST (seeds ER custom entries for id >= 10000),
      // then merge saved data on top. Otherwise loading a save made
      // before ER customs were added (or any save period — saved data
      // never includes ER customs since they weren't in starterCosts at
      // save time) wipes the ER entries we seeded in initStarterData,
      // and pokedex/starter-select crash with "Cannot read property
      // 'eggMoves' of undefined" on ER custom hover.
      this.initStarterData();
      this.starterData = Object.assign(this.starterData, systemData.starterData);
    } else {
      this.initStarterData();

      if (systemData["starterMoveData"]) {
        const starterMoveData = systemData["starterMoveData"];
        for (const s of Object.keys(starterMoveData)) {
          this.starterData[s].moveset = starterMoveData[s];
        }
      }

      if (systemData["starterEggMoveData"]) {
        const starterEggMoveData = systemData["starterEggMoveData"];
        for (const s of Object.keys(starterEggMoveData)) {
          this.starterData[s].eggMoves = starterEggMoveData[s];
        }
      }

      this.migrateStarterAbilities(systemData, this.starterData);

      const starterIds = Object.keys(this.starterData).map(s => Number.parseInt(s) as SpeciesId);
      for (const s of starterIds) {
        this.starterData[s].candyCount += systemData.dexData[s].caughtCount;
        this.starterData[s].candyCount += systemData.dexData[s].hatchedCount * 2;
        if (systemData.dexData[s].caughtAttr & DexAttr.SHINY) {
          this.starterData[s].candyCount += 4;
        }
      }
    }

    // Merge any historic candy/passive scatter across evolution stages into the
    // line root (e.g. a save with Pichu 26 / Pikachu 0 / Raichu 98). Idempotent.
    this.consolidateStarterDataToRoots();

    if (systemData.gameStats) {
      this.gameStats = systemData.gameStats;
    }

    if (systemData.unlocks) {
      for (const key of Object.keys(systemData.unlocks)) {
        if (Object.hasOwn(this.unlocks, key)) {
          this.unlocks[key] = systemData.unlocks[key];
        }
      }
    }

    if (systemData.achvUnlocks) {
      for (const a of Object.keys(systemData.achvUnlocks)) {
        if (Object.hasOwn(achvs, a)) {
          this.achvUnlocks[a] = systemData.achvUnlocks[a];
        }
      }
    }

    if (systemData.voucherUnlocks) {
      for (const v of Object.keys(systemData.voucherUnlocks)) {
        if (Object.hasOwn(vouchers, v)) {
          this.voucherUnlocks[v] = systemData.voucherUnlocks[v];
        }
      }
    }

    if (systemData.voucherCounts) {
      getEnumKeys(VoucherType).forEach(key => {
        const index = VoucherType[key];
        this.voucherCounts[index] = systemData.voucherCounts[index] || 0;
      });
    }

    this.eggs = systemData.eggs ? systemData.eggs.map(e => e.toEgg()) : [];

    // One-time gift: read the persisted flag (absent on older saves → false).
    // The actual grant runs below, after eggPity/unlockPity are restored (egg
    // species rolls read unlockPity).
    this.freeLegendaryEggsGranted = systemData.freeLegendaryEggsGranted ?? false;

    this.autoEggRestock = mergeAutoEggRestockSettings(systemData.autoEggRestock);
    this.llmDirectorState = mergeDirectorState(systemData.llmDirectorState);
    this.showdownAppliedSettlements = Array.isArray(systemData.showdownAppliedSettlements)
      ? systemData.showdownAppliedSettlements.filter(n => Number.isInteger(n)).slice(-200)
      : [];
    this.showdownTeamPresets = sanitizeShowdownTeamPresets(systemData.showdownTeamPresets);
    this.erShinyLabAvailableEffects =
      systemData.erShinyLabAvailableEffects?.map(v => Math.max(0, Math.min(255, Math.round(v)))) ?? [];
    this.ghostProfile = sanitizeGhostProfile(systemData.ghostProfile) ?? null;
    this.spentAchvPoints = Math.max(0, Math.round(systemData.spentAchvPoints ?? 0));
    this.trainerFx = sanitizeTrainerFxSaveData(systemData.trainerFx) ?? {};
    this.erTitles = Array.isArray(systemData.erTitles)
      ? systemData.erTitles.filter((t): t is string => typeof t === "string")
      : [];

    this.eggPity = systemData.eggPity ? systemData.eggPity.slice(0) : [0, 0, 0, 0];
    this.unlockPity = systemData.unlockPity ? systemData.unlockPity.slice(0) : [0, 0, 0, 0];

    // Grant the free 2 Legendary eggs once (idempotent; no-op if already given).
    this.grantFreeLegendaryEggsOnce();

    this.dexData = Object.assign(this.dexData, systemData.dexData);
    this.consolidateDexData(this.dexData);
    this.defaultDexData = null;

    // ER egg-pool declutter (#407): compress shiny/dex/candy progress from the
    // removed duplicate forms onto their vanilla base so nothing is lost
    // (e.g. a red-shiny Unown letter unlocks red shiny on vanilla Unown).
    // Purely additive and exception-guarded - it can never break a save load.
    migrateErRemovedFormUnlocks(this);

    // ER (#410): move already-hijacked redux-form unlocks off the vanilla
    // species' dex entries onto their RDX counterparts (gen slot reverts to
    // vanilla; shiny/candies land on the RDX entry). Additive + idempotent.
    migrateErReduxDexHijack(this);

    // This instance now reflects real persisted data - saves may overwrite local.
    this.systemDataLoaded = true;
  }

  public async initSystem(systemDataStr: string, cachedSystemDataStr?: string): Promise<boolean> {
    try {
      let systemData = GameData.parseSystemData(systemDataStr);

      if (cachedSystemDataStr) {
        const cachedSystemData = GameData.parseSystemData(cachedSystemDataStr);
        if (cachedSystemData.timestamp > systemData.timestamp) {
          console.debug("Using cached system data");
          systemData = cachedSystemData;
          systemDataStr = cachedSystemDataStr;
        }
        // ER save-loss fix: the previous `else` here called clearLocalData(),
        // which DELETES ALL 5 SESSION SLOTS based on the SYSTEM-save timestamp.
        // On any normal load the server's system timestamp is >= local, so this
        // wiped local session slots every refresh - and any run that had NOT yet
        // synced to the server (the common case right after playing) was lost
        // ("my run deleted itself"; "Continue loaded slot 1 and wiped the rest").
        // The server SYSTEM save is still adopted unconditionally below
        // (localStorage.setItem(`data_...`)), so dropping the wipe only PRESERVES
        // the local SESSION cache - local wins over not-yet-synced remote, which
        // is the correct precedence. Per-slot session freshness is reconciled by
        // getSession / the save path, never by a blanket wipe on system load.
      }

      if (isBeta || isDev) {
        try {
          // Shallowly clone system data during logging to avoid memory leaks
          console.debug(
            GameData.parseSystemData(
              JSON.stringify(systemData, (_, v: any) => (typeof v === "bigint" ? v.toString() : v)),
            ),
          );
        } catch (err) {
          console.debug("Attempt to log system data failed:", err);
        }
      }

      localStorage.setItem(`data_${loggedInUser?.username}`, encrypt(systemDataStr, bypassLogin));

      const lsItemKey = `runHistoryData_${loggedInUser?.username}`;
      const lsItem = localStorage.getItem(lsItemKey);
      if (!lsItem) {
        localStorage.setItem(lsItemKey, "");
      }

      this.initParsedSystem(systemData);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  /**
   * Retrieves current run history data, organized by time stamp.
   * At the moment, only retrievable from locale cache
   */
  // TODO: save run history data to server?
  async getRunHistoryData(): Promise<RunHistoryData> {
    const lsItemKey = `runHistoryData_${loggedInUser?.username}`;
    const lsItem = localStorage.getItem(lsItemKey);
    if (lsItem) {
      const cachedResponse = lsItem;
      if (cachedResponse) {
        const runHistory: RunHistoryData = JSON.parse(decrypt(cachedResponse, bypassLogin));
        return runHistory;
      }
      return {};
    }
    localStorage.setItem(`runHistoryData_${loggedInUser?.username}`, "");
    return {};
  }

  /**
   * Saves a new entry to Run History
   * @param runEntry: most recent SessionSaveData of the run
   * @param isVictory: result of the run
   * Arbitrary limit of 25 runs per player - Will delete runs, starting with the oldest one, if needed
   */
  // TODO: save run history data to server?
  async saveRunHistory(runEntry: SessionSaveData, isVictory: boolean): Promise<boolean> {
    const runHistoryData = await this.getRunHistoryData();
    // runHistoryData should always return run history or {} empty object
    let timestamps = Object.keys(runHistoryData).map(Number);

    // Arbitrary limit of 25 entries per user --> Can increase or decrease
    while (timestamps.length >= RUN_HISTORY_LIMIT) {
      const oldestTimestamp = Math.min.apply(Math, timestamps).toString();
      delete runHistoryData[oldestTimestamp];
      timestamps = Object.keys(runHistoryData).map(Number);
    }

    const timestamp = runEntry.timestamp.toString();
    runHistoryData[timestamp] = {
      entry: runEntry,
      isVictory,
      isFavorite: false,
    };
    localStorage.setItem(
      `runHistoryData_${loggedInUser?.username}`,
      encrypt(JSON.stringify(runHistoryData), bypassLogin),
    );
    return true;
  }

  // TODO: Why is this static
  static parseSystemData(dataStr: string): SystemSaveData {
    return JSON.parse(dataStr, (k: string, v: any) => {
      if (k === "gameStats") {
        return new GameStats(v);
      }
      if (k === "eggs") {
        const ret: EggData[] = [];
        if (v === null) {
          v = [];
        }
        for (const e of v) {
          ret.push(new EggData(e));
        }
        return ret;
      }
      if (k === "ribbons") {
        return RibbonData.fromJSON(v);
      }

      return k.endsWith("Attr") && !["natureAttr", "abilityAttr", "passiveAttr"].includes(k) ? BigInt(v ?? 0) : v;
    }) as SystemSaveData;
  }

  convertSystemDataStr(dataStr: string, shorten = false): string {
    if (!shorten) {
      // Account for past key oversight
      dataStr = dataStr.replace(/\$pAttr/g, "$pa");
    }
    dataStr = dataStr.replace(/"trainerId":\d+/g, `"trainerId":${this.trainerId}`);
    dataStr = dataStr.replace(/"secretId":\d+/g, `"secretId":${this.secretId}`);
    const fromKeys = shorten ? Object.keys(systemShortKeys) : Object.values(systemShortKeys);
    const toKeys = shorten ? Object.values(systemShortKeys) : Object.keys(systemShortKeys);
    for (const k in fromKeys) {
      dataStr = dataStr.replace(new RegExp(`${fromKeys[k].replace("$", "\\$")}`, "g"), toKeys[k]);
    }

    return dataStr;
  }

  public async verify(): Promise<boolean> {
    if (bypassLogin) {
      return true;
    }

    const systemData = await pokerogueApi.savedata.system.verify({ clientSessionId });

    if (systemData == null) {
      return true;
    }

    globalScene.phaseManager.clearPhaseQueue();
    globalScene.phaseManager.unshiftNew("ReloadSessionPhase", JSON.stringify(systemData));
    await this.clearLocalData();
    return false;
  }

  public async clearLocalData(): Promise<boolean> {
    if (bypassLogin) {
      return true;
    }
    const accountIdentity = this.currentPersistenceAccount();
    if (accountIdentity == null) {
      return false;
    }
    const removable: { key: string; raw: string }[] = [];
    for (let s = 0; s < 5; s++) {
      const key = this.sessionStorageKeyForAccount(s, accountIdentity);
      const raw = localStorage.getItem(key);
      if (raw == null) {
        continue;
      }
      try {
        const json = decrypt(raw, bypassLogin);
        if (classifySessionProtection(json) === "solo") {
          removable.push({ key, raw });
        }
      } catch {
        // Opaque/corrupt and legacy co-op-shaped rows are preserved until an exact classified
        // recovery/delete endpoint proves what they are. A system refresh must never destroy them.
      }
    }
    const systemKey = `data_${accountIdentity}`;
    const systemBefore = localStorage.getItem(systemKey);
    const cleared = await this.withSessionPersistenceLease(
      async () => {
        if (!this.persistenceAccountIsCurrent(accountIdentity)) {
          return false;
        }
        if (localStorage.getItem(systemKey) === systemBefore) {
          localStorage.removeItem(systemKey);
        }
        for (const candidate of removable) {
          if (localStorage.getItem(candidate.key) === candidate.raw) {
            localStorage.removeItem(candidate.key);
          }
        }
        return true;
      },
      false,
      accountIdentity,
    );
    return cleared === true;
  }

  /**
   * Saves a setting to localStorage
   * @param setting string ideally of SettingKeys
   * @param valueIndex index of the setting's option
   * @returns true
   */
  public saveSetting(setting: string, valueIndex: number): boolean {
    let settings: object = {};
    if (Object.hasOwn(localStorage, "settings")) {
      settings = JSON.parse(localStorage.getItem("settings")!); // TODO: is this bang correct?
    }

    setSetting(setting, valueIndex);

    settings[setting] = valueIndex;
    settings["gameVersion"] = globalScene.game.config.gameVersion;

    localStorage.setItem("settings", JSON.stringify(settings));

    return true;
  }

  /**
   * Saves the mapping configurations for a specified device.
   *
   * @param deviceName - The name of the device for which the configurations are being saved.
   * @param config - The configuration object containing custom mapping details.
   * @returns `true` if the configurations are successfully saved.
   */
  public saveMappingConfigs(deviceName: string, config): boolean {
    const key = deviceName.toLowerCase(); // Convert the gamepad name to lowercase to use as a key
    let mappingConfigs: object = {}; // Initialize an empty object to hold the mapping configurations
    if (Object.hasOwn(localStorage, "mappingConfigs")) {
      // Check if 'mappingConfigs' exists in localStorage
      mappingConfigs = JSON.parse(localStorage.getItem("mappingConfigs")!); // TODO: is this bang correct?
    } // Parse the existing 'mappingConfigs' from localStorage
    if (!mappingConfigs[key]) {
      mappingConfigs[key] = {};
    } // If there is no configuration for the given key, create an empty object for it
    mappingConfigs[key].custom = config.custom; // Assign the custom configuration to the mapping configuration for the given key
    localStorage.setItem("mappingConfigs", JSON.stringify(mappingConfigs)); // Save the updated mapping configurations back to localStorage
    return true; // Return true to indicate the operation was successful
  }

  /**
   * Loads the mapping configurations from localStorage and injects them into the input controller.
   *
   * @returns `true` if the configurations are successfully loaded and injected; `false` if no configurations are found in localStorage.
   *
   * @remarks
   * This method checks if the 'mappingConfigs' entry exists in localStorage. If it does not exist, the method returns `false`.
   * If 'mappingConfigs' exists, it parses the configurations and injects each configuration into the input controller
   * for the corresponding gamepad or device key. The method then returns `true` to indicate success.
   */
  public loadMappingConfigs(): boolean {
    if (!Object.hasOwn(localStorage, "mappingConfigs")) {
      // Check if 'mappingConfigs' exists in localStorage
      return false;
    } // If 'mappingConfigs' does not exist, return false

    const mappingConfigs = JSON.parse(localStorage.getItem("mappingConfigs")!); // Parse the existing 'mappingConfigs' from localStorage // TODO: is this bang correct?

    for (const key of Object.keys(mappingConfigs)) {
      // Iterate over the keys of the mapping configurations
      globalScene.inputController.injectConfig(key, mappingConfigs[key]);
    } // Inject each configuration into the input controller for the corresponding key

    return true; // Return true to indicate the operation was successful
  }

  public resetMappingToFactory(): boolean {
    if (!Object.hasOwn(localStorage, "mappingConfigs")) {
      // Check if 'mappingConfigs' exists in localStorage
      return false;
    } // If 'mappingConfigs' does not exist, return false
    localStorage.removeItem("mappingConfigs");
    globalScene.inputController.resetConfigs();
    return true; // TODO: is `true` the correct return value?
  }

  /**
   * Saves a gamepad setting to localStorage.
   *
   * @param setting - The gamepad setting to save.
   * @param valueIndex - The index of the value to set for the gamepad setting.
   * @returns `true` if the setting is successfully saved.
   *
   * @remarks
   * This method initializes an empty object for gamepad settings if none exist in localStorage.
   * It then updates the setting in the current scene and iterates over the default gamepad settings
   * to update the specified setting with the new value. Finally, it saves the updated settings back
   * to localStorage and returns `true` to indicate success.
   */
  public saveControlSetting(
    device: Device,
    localStoragePropertyName: string,
    setting: SettingGamepad | SettingKeyboard,
    settingDefaults,
    valueIndex: number,
  ): boolean {
    let settingsControls: object = {}; // Initialize an empty object to hold the gamepad settings

    if (Object.hasOwn(localStorage, localStoragePropertyName)) {
      // Check if 'settingsControls' exists in localStorage
      settingsControls = JSON.parse(localStorage.getItem(localStoragePropertyName)!); // Parse the existing 'settingsControls' from localStorage // TODO: is this bang correct?
    }

    if (device === Device.GAMEPAD) {
      setSettingGamepad(setting as SettingGamepad, valueIndex);
    } else if (device === Device.KEYBOARD) {
      setSettingKeyboard(setting as SettingKeyboard, valueIndex);
    }

    Object.keys(settingDefaults).forEach(s => {
      // Iterate over the default gamepad settings
      if (s === setting) {
        // If the current setting matches, update its value
        settingsControls[s] = valueIndex;
      }
    });

    localStorage.setItem(localStoragePropertyName, JSON.stringify(settingsControls)); // Save the updated gamepad settings back to localStorage

    return true; // Return true to indicate the operation was successful
  }

  /**
   * Loads Settings from local storage if available
   * @returns true if succesful, false if not
   */
  private loadSettings(): boolean {
    resetSettings();

    if (!Object.hasOwn(localStorage, "settings")) {
      return false;
    }

    const settings = JSON.parse(localStorage.getItem("settings")!); // TODO: is this bang correct?

    applySettingsVersionMigration(settings);

    // ER (#430): the speed-option rework (#416) shrank Game_Speed to 6 options,
    // but the version-gated migrator never runs for players whose settings were
    // stamped with this build's version BEFORE the rework (the fork's package
    // version does not change every staging deploy). An out-of-range index from
    // the old 8-option list would silently break the setting - remap it here,
    // idempotently (in-range indexes are never touched). Old 6 = 4x -> new 2,
    // old 7 = 5x -> new 3.
    const speedIndex = settings[SettingKeys.Game_Speed];
    if (typeof speedIndex === "number" && speedIndex > 5) {
      settings[SettingKeys.Game_Speed] = speedIndex <= 6 ? 2 : 3;
      localStorage.setItem("settings", JSON.stringify(settings));
    }

    for (const setting of Object.keys(settings)) {
      setSetting(setting, settings[setting]);
    }

    return true; // TODO: is `true` the correct return value?
  }

  private loadGamepadSettings(): void {
    Object.values(SettingGamepad).forEach(setting => {
      setSettingGamepad(setting, settingGamepadDefaults[setting]);
    });

    if (!Object.hasOwn(localStorage, "settingsGamepad")) {
      return;
    }
    const settingsGamepad = JSON.parse(localStorage.getItem("settingsGamepad")!); // TODO: is this bang correct?

    for (const setting of Object.keys(settingsGamepad)) {
      setSettingGamepad(setting as SettingGamepad, settingsGamepad[setting]);
    }
  }

  /**
   * Save the specified tutorial as having the specified completion status.
   * @param tutorial - The {@linkcode Tutorial} whose completion status is being saved
   * @param status - The completion status to set
   */
  public saveTutorialFlag(tutorial: Tutorial, status: boolean): void {
    // Grab the prior save data tutorial
    const saveDataKey = getDataTypeKey(GameDataType.TUTORIALS);
    const tutorials: TutorialFlags = Object.hasOwn(localStorage, saveDataKey)
      ? JSON.parse(localStorage.getItem(saveDataKey)!)
      : {};

    // TODO: We shouldn't be storing this like that
    for (const key of Object.values(Tutorial)) {
      if (key === tutorial) {
        tutorials[key] = status;
      } else {
        tutorials[key] ??= false;
      }
    }

    localStorage.setItem(saveDataKey, JSON.stringify(tutorials));
  }

  public getTutorialFlags(): TutorialFlags {
    const key = getDataTypeKey(GameDataType.TUTORIALS);
    const ret: TutorialFlags = Object.values(Tutorial).reduce((acc, tutorial) => {
      acc[Tutorial[tutorial]] = false;
      return acc;
    }, {} as TutorialFlags);

    if (!Object.hasOwn(localStorage, key)) {
      return ret;
    }

    const tutorials = JSON.parse(localStorage.getItem(key)!); // TODO: is this bang correct?

    for (const tutorial of Object.keys(tutorials)) {
      ret[tutorial] = tutorials[tutorial];
    }

    return ret;
  }

  public saveSeenDialogue(dialogue: string): boolean {
    const key = getDataTypeKey(GameDataType.SEEN_DIALOGUES);
    const dialogues: object = this.getSeenDialogues();

    dialogues[dialogue] = true;
    localStorage.setItem(key, JSON.stringify(dialogues));
    console.log("Dialogue saved as seen:", dialogue);

    return true;
  }

  public getSeenDialogues(): SeenDialogues {
    const key = getDataTypeKey(GameDataType.SEEN_DIALOGUES);
    const ret: SeenDialogues = {};

    if (!Object.hasOwn(localStorage, key)) {
      return ret;
    }

    const dialogues = JSON.parse(localStorage.getItem(key)!); // TODO: is this bang correct?

    for (const dialogue of Object.keys(dialogues)) {
      ret[dialogue] = dialogues[dialogue];
    }

    return ret;
  }

  public getSessionSaveData(): SessionSaveData {
    const coopController = globalScene.gameMode?.isCoop === true ? getCoopRuntime()?.controller : undefined;
    const partnerName = coopController?.partnerName;
    const coopParticipants =
      coopController == null || partnerName == null
        ? undefined
        : {
            version: 1 as const,
            players: canonicalCoopParticipantPair(coopController.localName(), partnerName),
            seats: {
              host: coopController.role === "host" ? coopController.localName() : partnerName,
              guest: coopController.role === "guest" ? coopController.localName() : partnerName,
            },
          };
    const coopRun =
      coopController != null && isCoopRunId(coopController.runId)
        ? {
            version: 1 as const,
            runId: coopController.runId,
            checkpointRevision: coopController.checkpointRevision,
          }
        : undefined;
    const coopControlPlane = getCoopControlPlaneSaveData();
    if (
      globalScene.gameMode?.isCoop === true
      && (coopController == null || coopParticipants == null || coopRun == null || coopControlPlane == null)
    ) {
      throw new Error("refusing to serialize an incomplete co-op checkpoint identity/control plane");
    }
    return {
      seed: globalScene.seed,
      playTime: globalScene.sessionPlayTime,
      // SHOWDOWN (modeId 7) must never be persisted - duels are ephemeral sessions; the
      // showdown launch path (Task C1+) must never route a session into save slots.
      gameMode: globalScene.gameMode.modeId,
      dailyConfig: getSerializedDailyRunConfig(),
      party: globalScene.getPlayerParty().map(p => new PokemonData(p)),
      enemyParty: globalScene.getEnemyParty().map(p => new PokemonData(p)),
      modifiers: globalScene.findModifiers(() => true).map(m => new PersistentModifierData(m, true)),
      enemyModifiers: globalScene.findModifiers(() => true, false).map(m => new PersistentModifierData(m, false)),
      arena: new ArenaData(globalScene.arena),
      pokeballCounts: globalScene.pokeballCounts,
      money: Math.floor(globalScene.money),
      score: globalScene.score,
      waveIndex: globalScene.currentBattle.waveIndex,
      battleType: globalScene.currentBattle.battleType,
      trainer:
        globalScene.currentBattle.battleType === BattleType.TRAINER
          ? new TrainerData(globalScene.currentBattle.trainer)
          : null,
      gameVersion: globalScene.game.config.gameVersion,
      timestamp: Date.now(),
      challenges: globalScene.gameMode.challenges.map(c => new ChallengeData(c)),
      mysteryEncounterType: globalScene.currentBattle.mysteryEncounter?.encounterType ?? -1,
      mysteryEncounterSaveData: globalScene.mysteryEncounterSaveData,
      playerFaints: globalScene.arena.playerFaints,
      // ER: persist the run difficulty so a reload keeps using the chosen ER
      // trainer roster tier (otherwise it resets to "ace" = vanilla trainers).
      erDifficulty: getErDifficulty(),
      // ER: persist the set of trainers already fought this run, so reloading
      // doesn't wipe the no-repeat tracking and re-field the same trainers.
      erUsedTrainerKeys: getErUsedTrainerKeys(),
      // ER (#348): persist per-mon faint-free money streaks across save/load.
      erMoneyStreaks: getErMoneyStreakEntries(),
      // ER achievement-expansion catalog-v2 (#900): persist run-local achievement state
      // (bargain flags, black-market credit, learned-move stamps, PARALLEL_PLAY KO ids).
      erAchievementRunState: getErAchievementRunState(),
      // ER (#357): persist the player's stolen resist berries (runtime ER
      // modifier types are dropped by the vanilla modifier registry on load).
      erResistBerries: getErResistBerryEntries(),
      // ER (#358): persist the player's Ward Stones incl. charge state.
      erWardStones: getErWardStoneEntries(),
      // ER (#486): persist the run's Map state (revealed nodes / travel target /
      // Treasure-Map fragments) - run-scoped module state a reload would wipe.
      erMapState: getErMapSaveData(),
      // ER: per-battle relic counters (Cursed Idol / Pharaoh's Ankh / future
      // per-battle relics), scoped to the current wave so a reload doesn't reset
      // them and re-fire the effect.
      erRelicBattleState: getErRelicBattleState(),
      // ER Community Challenge: if this run is a founder's qualifying play of a draft,
      // persist {draftId, config} so a mid-run reload still auto-publishes on the win.
      founderChallenge: getFounderRunState() ?? undefined,
      // ER Community Challenge: persist the allowed-species whitelist so the catch gate
      // survives a mid-run reload (it gates the whole run, not just starter-select).
      communityAllowedSpecies: getCommunityAllowedSpecies() ?? undefined,
      // Co-op W2b (contract doc §4): persist the control-plane snapshot (interaction counter + journal
      // high-water) so a cold resume keeps alternating-owner parity + revision ordering. undefined for
      // every solo save (no live co-op runtime), so non-co-op saves are byte-identical.
      coopControlPlane,
      coopRun,
      // Pair + authority-seat identity live in the save so discovery survives a missing browser-local
      // pointer/cloud restore without guessing ownership. Pre-seat-map saves are visibly blocked.
      coopParticipants,
    } as SessionSaveData;
  }

  async getSession(slotId: number): Promise<SessionSaveData | undefined> {
    // TODO: Do we need this fallback anymore?
    if (slotId < 0) {
      return;
    }

    console.log("Getting Session Slot id: %d", slotId);

    // Check local storage for the cached session data
    if (bypassLogin || localStorage.getItem(getSessionDataLocalStorageKey(slotId))) {
      const sessionData = localStorage.getItem(getSessionDataLocalStorageKey(slotId));
      if (!sessionData) {
        console.error("No session data found!");
        return;
      }
      return this.parseSessionData(decrypt(sessionData, bypassLogin));
    }

    // Ask the server API for the save data and store it in localstorage
    const cloudRead = await this.readCoopCas(slotId);
    if (!cloudRead.ok) {
      console.error(`Session read failed (${cloudRead.failureKind}).`);
      return;
    }
    const response = cloudRead.rawSavedata;

    const localKey = getSessionDataLocalStorageKey(slotId);
    const protectedCoop = classifySessionProtection(response) !== "solo";
    const cached = await this.withSessionPersistenceLease(async () => {
      if (localStorage.getItem(localKey) != null) {
        return false;
      }
      const encrypted = encrypt(response, bypassLogin);
      localStorage.setItem(localKey, encrypted);
      return localStorage.getItem(localKey) === encrypted;
    }, protectedCoop);
    if (cached !== true) {
      return;
    }

    return this.parseSessionData(response);
  }

  /**
   * Reconcile both replicas for lobby resume discovery. Unlike the ordinary cache-oriented
   * {@linkcode getSession}, this never lets arbitrary local bytes hide a cloud co-op checkpoint and
   * never turns an unavailable/conflicting/tombstoned authority check into an apparent empty slot.
   */
  private async reconcileCoopResumeSlot(
    slotId: number,
    accountIdentity: string,
    cloud: CoopClassifiedReplica | null,
  ): Promise<CoopResumeLoadedSession | undefined> {
    const storageKey = this.sessionStorageKeyForAccount(slotId, accountIdentity);
    let localRaw = localStorage.getItem(storageKey);
    let local: CoopClassifiedReplica | null = null;
    if (localRaw != null) {
      try {
        local = await this.classifyCoopReplica(slotId, decrypt(localRaw, bypassLogin));
      } catch (error) {
        throw new CoopResumeReplicaUnavailableError(`local slot ${slotId} is unreadable: ${String(error)}`);
      }
    }
    if (!this.persistenceAccountIsCurrent(accountIdentity) || localStorage.getItem(storageKey) !== localRaw) {
      throw new CoopResumeReplicaUnavailableError(`local slot ${slotId} changed during resume inspection`);
    }

    // A failed post-cloud local commit (import, another tab, or storage pressure) can leave the exact
    // old local run beside a newer cloud row. Classifying that as a conflict before consulting the
    // old run's durable status makes a successfully tombstoned local replica impossible to retire.
    // Resolve only that one provable case first; a live/missing/unavailable old authority remains an
    // explicit conflict and is never silently displaced by the cloud row.
    const localConflictsWithCloud =
      local?.commitment != null
      && cloud != null
      && (local.protection !== cloud.protection || cloud.commitment?.runId !== local.commitment.runId);
    if (localConflictsWithCloud && localRaw != null && local?.commitment != null) {
      const localCommitment = local.commitment;
      const lineageHeadBeforeStatus = this.readKnownCoopCloudHead(slotId, accountIdentity);
      if (lineageHeadBeforeStatus.kind === "invalid") {
        throw new CoopResumeReplicaUnavailableError(`cloud head for run ${localCommitment.runId} is malformed`);
      }
      const localStatus = await this.readCoopRunStatus({
        clientSessionId,
        coopRunId: localCommitment.runId,
        slot: slotId,
      });
      if (!this.persistenceAccountIsCurrent(accountIdentity) || !localStatus.ok) {
        throw new CoopResumeReplicaUnavailableError(
          `conflicting local run status unavailable (${localStatus.ok ? "account-changed" : localStatus.failureKind})`,
        );
      }
      if (localStatus.value.state !== "tombstoned") {
        throw new CoopResumeReplicaUnavailableError(
          `local/cloud slot ${slotId} contains distinct non-tombstoned authorities`,
        );
      }
      const retired = await this.retireStatusProvenTombstonedLocalReplica(
        slotId,
        localRaw,
        localCommitment,
        lineageHeadBeforeStatus,
        accountIdentity,
      );
      if (!retired) {
        throw new CoopResumeReplicaUnavailableError(
          `tombstoned local run ${localCommitment.runId} could not be retired before cloud adoption`,
        );
      }
      local = null;
      localRaw = null;
    }
    if (local?.protection === "unknown" || cloud?.protection === "unknown") {
      throw new CoopResumeReplicaUnavailableError(`local/cloud slot ${slotId} contains opaque savedata`);
    }
    if (local != null && cloud != null && local.protection !== cloud.protection) {
      throw new CoopResumeReplicaUnavailableError(`local/cloud slot ${slotId} has conflicting protection classes`);
    }

    const selectedLegacy =
      local?.protection === "coop-invalid" ? local : cloud?.protection === "coop-invalid" ? cloud : null;
    if (selectedLegacy != null) {
      if (local != null && cloud != null && local.raw !== cloud.raw) {
        throw new CoopResumeReplicaUnavailableError(`legacy co-op replicas differ in slot ${slotId}`);
      }
      if (selectedLegacy.session == null) {
        throw new CoopResumeReplicaUnavailableError(`legacy co-op slot ${slotId} cannot be parsed safely`);
      }
      if (local == null) {
        const encryptedCloud = encrypt(selectedLegacy.raw, bypassLogin);
        const cached = await this.withCoopResumePersistenceLease(async () => {
          if (localStorage.getItem(storageKey) !== localRaw) {
            return false;
          }
          return (
            trySetLocalStorageItem(storageKey, encryptedCloud) && localStorage.getItem(storageKey) === encryptedCloud
          );
        }, accountIdentity);
        if (cached !== true) {
          throw new CoopResumeReplicaUnavailableError(`legacy co-op slot ${slotId} could not be cached safely`);
        }
      }
      return { session: selectedLegacy.session, sessionJson: selectedLegacy.raw };
    }

    const selectedSolo = local?.protection === "solo" ? local : cloud?.protection === "solo" ? cloud : null;
    if (selectedSolo != null) {
      if (selectedSolo.session == null) {
        throw new CoopResumeReplicaUnavailableError(`solo slot ${slotId} could not be parsed`);
      }
      if (local == null) {
        const encryptedCloud = encrypt(selectedSolo.raw, bypassLogin);
        const cached = await this.withSessionPersistenceLease(
          async () => {
            if (localStorage.getItem(storageKey) !== localRaw) {
              return false;
            }
            return (
              trySetLocalStorageItem(storageKey, encryptedCloud) && localStorage.getItem(storageKey) === encryptedCloud
            );
          },
          false,
          accountIdentity,
        );
        if (cached !== true) {
          throw new CoopResumeReplicaUnavailableError(`cloud solo slot ${slotId} could not be cached safely`);
        }
      }
      return { session: selectedSolo.session, sessionJson: selectedSolo.raw };
    }

    const commitment = local?.commitment ?? cloud?.commitment;
    if (commitment == null) {
      return;
    }
    const lineageHeadBeforeStatus = this.readKnownCoopCloudHead(slotId, accountIdentity);
    if (lineageHeadBeforeStatus.kind === "invalid") {
      throw new CoopResumeReplicaUnavailableError(`cloud head for run ${commitment.runId} is malformed`);
    }
    const status = await this.readCoopRunStatus({
      clientSessionId,
      coopRunId: commitment.runId,
      slot: slotId,
    });
    if (!this.persistenceAccountIsCurrent(accountIdentity) || !status.ok) {
      throw new CoopResumeReplicaUnavailableError(
        `co-op run status unavailable (${status.ok ? "account-changed" : status.failureKind})`,
      );
    }
    if (status.value.state === "tombstoned") {
      if (cloud != null || localRaw == null) {
        throw new CoopResumeReplicaUnavailableError(`tombstoned run ${commitment.runId} lineage could not converge`);
      }
      if (
        !(await this.retireStatusProvenTombstonedLocalReplica(
          slotId,
          localRaw,
          commitment,
          lineageHeadBeforeStatus,
          accountIdentity,
        ))
      ) {
        throw new CoopResumeReplicaUnavailableError("tombstoned local checkpoint could not be retired safely");
      }
      return;
    }
    if (status.value.state !== "active" || status.value.slot !== slotId || cloud?.commitment == null) {
      throw new CoopResumeReplicaUnavailableError(`run ${commitment.runId} has no unique active cloud checkpoint`);
    }
    if (
      status.value.checkpointRevision !== cloud.commitment.checkpointRevision
      || status.value.digest !== cloud.commitment.digest
    ) {
      throw new CoopResumeReplicaUnavailableError(`cloud read/status disagree for run ${commitment.runId}`);
    }
    const knownHead = this.readKnownCoopCloudHead(slotId, accountIdentity);
    if (knownHead.kind === "invalid") {
      throw new CoopResumeReplicaUnavailableError(`cloud head for run ${commitment.runId} is malformed`);
    }
    if (
      knownHead.kind === "valid"
      && (knownHead.head.runId !== cloud.commitment.runId
        || knownHead.head.checkpointRevision > cloud.commitment.checkpointRevision
        || (knownHead.head.checkpointRevision === cloud.commitment.checkpointRevision
          && knownHead.head.digest !== cloud.commitment.digest))
    ) {
      throw new CoopResumeReplicaUnavailableError(`cloud head ancestry conflict for run ${commitment.runId}`);
    }
    const knownHeadMatchesObservedCloud =
      knownHead.kind === "valid"
      && knownHead.head.runId === cloud.commitment.runId
      && knownHead.head.checkpointRevision === cloud.commitment.checkpointRevision
      && knownHead.head.digest === cloud.commitment.digest;
    if (
      local?.commitment != null
      && local.commitment.checkpointRevision > cloud.commitment.checkpointRevision
      && !knownHeadMatchesObservedCloud
    ) {
      throw new CoopResumeReplicaUnavailableError(
        `local-ahead checkpoint for run ${commitment.runId} has no proof it descends from the observed cloud head`,
      );
    }
    if (!this.recordKnownCoopCloudHead(slotId, accountIdentity, cloud.commitment, knownHead)) {
      throw new CoopResumeReplicaUnavailableError(`cloud head for run ${commitment.runId} could not be frozen`);
    }
    if (local == null) {
      const encryptedCloud = encrypt(cloud.raw, bypassLogin);
      const cached = await this.withCoopResumePersistenceLease(async () => {
        if (localStorage.getItem(storageKey) !== localRaw) {
          return false;
        }
        return (
          trySetLocalStorageItem(storageKey, encryptedCloud) && localStorage.getItem(storageKey) === encryptedCloud
        );
      }, accountIdentity);
      if (cached !== true) {
        throw new CoopResumeReplicaUnavailableError(`cloud co-op slot ${slotId} could not be cached safely`);
      }
      return { session: cloud.session!, sessionJson: cloud.raw };
    }
    if (local.commitment == null || !this.sameCoopReplicaLineage(local.commitment, cloud.commitment)) {
      throw new CoopResumeReplicaUnavailableError(`local/cloud co-op identity conflict in slot ${slotId}`);
    }
    if (local.commitment.checkpointRevision === cloud.commitment.checkpointRevision) {
      if (local.commitment.digest !== cloud.commitment.digest) {
        throw new CoopResumeReplicaUnavailableError(`equal-revision co-op fork in slot ${slotId}`);
      }
      return { session: local.session!, sessionJson: local.raw };
    }
    if (local.commitment.checkpointRevision > cloud.commitment.checkpointRevision) {
      return { session: local.session!, sessionJson: local.raw };
    }
    const encryptedCloud = encrypt(cloud.raw, bypassLogin);
    const advanced = await this.withCoopResumePersistenceLease(async () => {
      if (localStorage.getItem(storageKey) !== localRaw) {
        return false;
      }
      return trySetLocalStorageItem(storageKey, encryptedCloud) && localStorage.getItem(storageKey) === encryptedCloud;
    }, accountIdentity);
    if (advanced !== true) {
      throw new CoopResumeReplicaUnavailableError(`cloud-ahead co-op slot ${slotId} could not converge locally`);
    }
    return { session: cloud.session!, sessionJson: cloud.raw };
  }

  async getCoopResumeLobbySnapshot(): Promise<CoopResumeLobbySnapshot> {
    const accountIdentity = this.currentPersistenceAccount();
    if (!bypassLogin && accountIdentity == null) {
      throw new CoopResumeReplicaUnavailableError("co-op resume has no authenticated account identity");
    }
    const sessions = new Map<number, CoopResumeLoadedSession | undefined>();
    const failures = new Map<number, Error>();
    const recordSlotFailure = (slot: number, error: unknown): void => {
      failures.set(
        slot,
        error instanceof Error
          ? error
          : new CoopResumeReplicaUnavailableError(`slot ${slot} reconciliation failed: ${String(error)}`),
      );
    };
    if (bypassLogin) {
      for (let slot = 0; slot < 5; slot++) {
        const raw = localStorage.getItem(this.sessionStorageKeyForAccount(slot, accountIdentity));
        if (raw == null) {
          sessions.set(slot, undefined);
          continue;
        }
        // A malformed / wrong-codec local blob makes decrypt() throw a raw URIError; surface it as an explicit
        // unreadable-replica failure (mirrors reconcileCoopResumeSlot's guard) instead of leaking a bare
        // "URI malformed" that no resume caller can classify.
        let json: string;
        try {
          json = decrypt(raw, bypassLogin);
        } catch (error) {
          recordSlotFailure(
            slot,
            new CoopResumeReplicaUnavailableError(`local slot ${slot} is unreadable: ${String(error)}`),
          );
          continue;
        }
        try {
          const replica = await this.classifyCoopReplica(slot, json);
          if (replica.session == null) {
            throw new CoopResumeReplicaUnavailableError(`local slot ${slot} could not be classified`);
          }
          sessions.set(slot, { session: replica.session, sessionJson: replica.raw });
        } catch (error) {
          recordSlotFailure(slot, error);
        }
      }
      return { sessions, failures };
    }
    const cloud = await this.scanCoopCloudReplicas(accountIdentity!);
    for (let slot = 0; slot < 5; slot++) {
      try {
        sessions.set(slot, await this.reconcileCoopResumeSlot(slot, accountIdentity!, cloud.get(slot) ?? null));
      } catch (error) {
        recordSlotFailure(slot, error);
      }
    }
    return { sessions, failures };
  }

  /**
   * Strict programmatic scan retained for persistence callers and existing tests. The
   * public lobby uses {@linkcode getCoopResumeLobbySnapshot} so one quarantined slot
   * cannot erase a valid candidate in another slot or collapse the whole connection.
   */
  async getSessionsForCoopResume(): Promise<Map<number, CoopResumeLoadedSession | undefined>> {
    const snapshot = await this.getCoopResumeLobbySnapshot();
    const firstFailure = snapshot.failures.values().next().value;
    if (firstFailure != null) {
      throw firstFailure;
    }
    return snapshot.sessions;
  }

  async getSessionForCoopResume(slotId: number): Promise<CoopResumeLoadedSession | undefined> {
    if (slotId < 0) {
      return;
    }
    return (await this.getSessionsForCoopResume()).get(slotId);
  }

  async renameSession(slotId: number, newName: string): Promise<boolean> {
    if (slotId < 0) {
      return false;
    }
    // TODO: Why do we consider renaming to an empty string successful if it does nothing?
    if (newName === "") {
      return true;
    }
    const accountIdentity = this.currentPersistenceAccount();
    const sessionData = await this.getSession(slotId);
    if (!sessionData || !this.persistenceAccountIsCurrent(accountIdentity)) {
      return false;
    }
    const localKey = this.sessionStorageKeyForAccount(slotId, accountIdentity);
    const localBeforeCloud = localStorage.getItem(localKey);
    sessionData.name = newName;
    // update timestamp by 1 to ensure the session is saved
    sessionData.timestamp += 1;
    if ((sessionData.gameMode as number) === GameModes.COOP && sessionData.coopRun != null) {
      // Metadata is still a mutation of the protected row and therefore owns a new checkpoint.
      sessionData.coopRun.checkpointRevision += 1;
    }
    const updatedDataStr = JSON.stringify(sessionData);
    const encrypted = encrypt(updatedDataStr, bypassLogin);
    const secretId = this.secretId;
    const trainerId = this.trainerId;

    if (bypassLogin) {
      localStorage.setItem(localKey, encrypt(updatedDataStr, bypassLogin));
      return true;
    }

    const response = await enqueueSessionCloudMutation(accountIdentity, async () => {
      if (!this.persistenceAccountIsCurrent(accountIdentity)) {
        return "Rename account changed while queued.";
      }
      if ((sessionData.gameMode as number) === GameModes.COOP) {
        const mutation = await this.updateCoopCloudCas(slotId, updatedDataStr, sessionData);
        return mutation.ok ? "" : mutation.error;
      }
      return this.updateSessionBounded({ slot: slotId, trainerId, secretId, clientSessionId }, updatedDataStr);
    });

    if (response) {
      return false;
    }
    if ((sessionData.gameMode as number) === GameModes.COOP) {
      const localCommitted = await this.withCoopResumePersistenceLease(async () => {
        if (localStorage.getItem(localKey) !== localBeforeCloud) {
          return false;
        }
        localStorage.setItem(localKey, encrypted);
        return localStorage.getItem(localKey) === encrypted;
      }, accountIdentity);
      if (localCommitted !== true) {
        return false;
      }
    } else {
      const localCommitted = await this.withSessionPersistenceLease(
        async () => {
          if (localStorage.getItem(localKey) !== localBeforeCloud) {
            return false;
          }
          localStorage.setItem(localKey, encrypted);
          return localStorage.getItem(localKey) === encrypted;
        },
        false,
        accountIdentity,
      );
      if (localCommitted !== true) {
        return false;
      }
    }
    const [success] = await updateUserInfo();
    return success;
  }

  /**
   * Load stored session data and re-initialize the game with its contents.
   * @param slotIndex - The 0-indexed position of the save slot to load.
   *   Values `< 0` are considered invalid.
   * @returns A Promise that resolves with whether the session load succeeded
   * (i.e. whether a save in the given slot exists)
   */
  public async loadSession(slotIndex: number): Promise<boolean> {
    const sessionData = await this.getSession(slotIndex);
    if (!sessionData) {
      return false;
    }
    // #807 RESUME-REQUIRES-BOTH (finally enforced at the chokepoint): a co-op session save
    // may only load while a live co-op connection exists - a solo client cannot simulate a
    // merged-party run (the guest half was never an engine) and loading one solo corrupts the
    // run and confuses accounts. Connect through the Co-op lobby first, then resume.
    if ((sessionData.gameMode as number) === GameModes.COOP) {
      const runtime = getCoopRuntime();
      const membership = runtime?.membership.snapshot();
      const partner = runtime?.controller.partnerName;
      const exactLiveSession =
        runtime != null
        && runtime.localTransport.state === "connected"
        && runtime.controller.partnerConnected
        && runtime.controller.compatibilityAccepted
        && partner != null
        && membership?.state === "active"
        && membership.members.every(member => member.present)
        && sessionData.coopRun?.runId === runtime.controller.runId
        && Number.isSafeInteger(sessionData.coopRun?.checkpointRevision)
        && (sessionData.coopRun?.checkpointRevision ?? -1) >= runtime.controller.checkpointRevision
        && coopParticipantPairMatches(sessionData.coopParticipants?.players, runtime.controller.localName(), partner)
        && coopSeatMapMatches(
          sessionData.coopParticipants,
          runtime.controller.localName(),
          partner,
          runtime.controller.role,
        );
      if (exactLiveSession) {
        await this.initSessionFromData(sessionData);
        return true;
      }
      coopWarn(
        "launch",
        `loadSession slot=${slotIndex} REFUSED: co-op save does not match one live, compatible, active participant pair (#807)`,
      );
      try {
        globalScene.ui.showText(
          "This co-op save can only resume with its exact partner in a live, compatible lobby session.",
          null,
          undefined,
          4000,
        );
      } catch {
        /* cosmetic */
      }
      return false;
    }
    await this.initSessionFromData(sessionData);
    return true;
  }

  /**
   * Co-op GUEST (#633 M4 push-snapshot launch): BOOT the local session from the host's authoritative
   * launch snapshot (`sessionJson` = the host's `getSessionSaveData()` over the wire), instead of the
   * guest rolling its own enemy / arena / party. Rehydrates via the SAME {@linkcode parseSessionData}
   * cloud-save + resume use, then applies via the production-hardened {@linkcode initSessionFromData}
   * (which the guard above keeps from clobbering the live co-op runtime). AWAITED (unlike loadSession's
   * fire-and-forget) so the party/enemy assets are loaded before the caller queues EncounterPhase(true).
   * Returns false if parsing or session/asset materialization fails; the caller must fail closed.
   */
  public async applyCoopLaunchSession(
    sessionJson: string,
    expectedCommitment?: CoopResumeCommitment,
  ): Promise<boolean> {
    const entryRuntime = getCoopRuntime();
    const entryController = entryRuntime?.controller;
    const entryGeneration = coopSessionGeneration();
    const exactRuntimeIsCurrent = (): boolean => {
      if (
        entryRuntime == null
        || entryController == null
        || getCoopRuntime() !== entryRuntime
        || entryRuntime.controller !== entryController
        || coopSessionGeneration() !== entryGeneration
        || entryRuntime.localTransport.state !== "connected"
        || !entryController.partnerConnected
        || !entryController.compatibilityAccepted
      ) {
        return false;
      }
      const membership = entryRuntime.membership.snapshot();
      return membership.state === "active" && membership.members.every(member => member.present);
    };
    if (entryRuntime == null || entryController == null || !exactRuntimeIsCurrent()) {
      console.warn("[coop-launch] applyCoopLaunchSession: no exact active compatible runtime at entry");
      return false;
    }
    let sessionData: SessionSaveData;
    try {
      sessionData = this.parseSessionData(sessionJson);
    } catch (err) {
      console.warn("[coop-launch] applyCoopLaunchSession: unparseable snapshot, falling back", err);
      return false;
    }
    try {
      const expectedMode = entryController.isVersusSession() ? GameModes.SHOWDOWN : GameModes.COOP;
      if (!exactRuntimeIsCurrent() || (sessionData.gameMode as number) !== expectedMode) {
        console.warn(
          `[coop-launch] applyCoopLaunchSession: mode/runtime discriminator failed mode=${sessionData.gameMode} expected=${expectedMode}`,
        );
        return false;
      }
      if (expectedMode === GameModes.COOP) {
        const partner = entryController.partnerName;
        const coopRun = sessionData.coopRun;
        if (
          partner == null
          || !coopSeatMapMatches(
            sessionData.coopParticipants,
            entryController.localName(),
            partner,
            entryController.role,
          )
          || coopRun?.version !== 1
          || !isCoopRunId(coopRun.runId)
          || !Number.isSafeInteger(coopRun.checkpointRevision)
          || coopRun.checkpointRevision < 0
          || coopRun.runId !== entryController.runId
          || coopRun.checkpointRevision < entryController.checkpointRevision
        ) {
          console.warn("[coop-launch] applyCoopLaunchSession: participant/seat/digest discriminator failed");
          return false;
        }
        if (expectedCommitment != null) {
          const commitmentMatches = await coopResumeCommitmentMatches(sessionJson, sessionData, expectedCommitment);
          if (!exactRuntimeIsCurrent() || !commitmentMatches) {
            console.warn("[coop-launch] applyCoopLaunchSession: digest changed or runtime was replaced");
            return false;
          }
        }
      } else if (expectedCommitment != null) {
        console.warn("[coop-launch] applyCoopLaunchSession: a co-op resume commitment cannot authorize showdown");
        return false;
      }
      // SHOWDOWN (Task F1): the versus guest boots into its LOCAL orientation - its own team (authored
      // as the host's ENEMY side) becomes its local PLAYER party. Reflect the parsed session here, the
      // guest's world-adoption boundary, before initSessionFromData rebuilds party/enemyParty. No-op
      // for solo/co-op/host (versus-guest-only gate).
      if (isShowdownGuestFlipGated()) {
        sessionData = swapSessionData(sessionData);
      }
      if (!exactRuntimeIsCurrent()) {
        return false;
      }
      await this.initSessionFromData(sessionData, exactRuntimeIsCurrent);
      if (!exactRuntimeIsCurrent()) {
        return false;
      }
      return true;
    } catch (err) {
      console.warn("[coop-launch] applyCoopLaunchSession: snapshot materialization failed", err);
      return false;
    }
  }

  /**
   * Install the authoritative host-checkpoint mirror on the GUEST. The handler validates exact
   * bytes/participants/seats against this runtime, writes only to the pair's existing slot or a
   * genuinely empty slot, records the guest's own marker, then ACKs through the controller.
   */
  private currentPersistenceAccount(): string | null {
    return loggedInUser?.username ?? null;
  }

  private persistenceAccountIsCurrent(accountIdentity: string | null): boolean {
    return this.currentPersistenceAccount() === accountIdentity;
  }

  private sessionStorageKeyForAccount(slot: number, accountIdentity: string | null): string {
    if (slot < 0) {
      throw new Error("Cannot access a negative save slot ID from localstorage!");
    }
    return `sessionData${slot || ""}_${accountIdentity ?? "undefined"}`;
  }

  private coopCloudHeadKey(slot: number, accountIdentity: string): string {
    return `er-coop-cloud-head:${accountIdentity.normalize("NFKC").toLowerCase()}:${slot}`;
  }

  private readKnownCoopCloudHead(slot: number, accountIdentity: string): CoopKnownCloudHeadState {
    const raw = localStorage.getItem(this.coopCloudHeadKey(slot, accountIdentity));
    if (raw == null) {
      return { kind: "absent" };
    }
    try {
      const parsed = JSON.parse(raw) as CoopKnownCloudHead | null;
      return parsed?.version === 1
        && isCoopRunId(parsed.runId)
        && Number.isSafeInteger(parsed.checkpointRevision)
        && parsed.checkpointRevision >= 0
        && /^[0-9a-f]{64}$/u.test(parsed.digest)
        ? { kind: "valid", head: parsed }
        : { kind: "invalid", raw };
    } catch {
      return { kind: "invalid", raw };
    }
  }

  private coopCloudHeadStateMatches(left: CoopKnownCloudHeadState, right: CoopKnownCloudHeadState): boolean {
    if (left.kind !== right.kind) {
      return false;
    }
    if (left.kind === "absent") {
      return true;
    }
    if (left.kind === "invalid") {
      return right.kind === "invalid" && left.raw === right.raw;
    }
    return (
      right.kind === "valid"
      && left.head.runId === right.head.runId
      && left.head.checkpointRevision === right.head.checkpointRevision
      && left.head.digest === right.head.digest
    );
  }

  private recordKnownCoopCloudHead(
    slot: number,
    accountIdentity: string,
    commitment: Pick<CoopResumeCommitment, "runId" | "checkpointRevision" | "digest">,
    expected: CoopKnownCloudHeadState,
  ): boolean {
    if (!this.persistenceAccountIsCurrent(accountIdentity) || expected.kind === "invalid") {
      return false;
    }
    const current = this.readKnownCoopCloudHead(slot, accountIdentity);
    const next: CoopKnownCloudHeadState = {
      kind: "valid",
      head: {
        version: 1,
        runId: commitment.runId,
        checkpointRevision: commitment.checkpointRevision,
        digest: commitment.digest,
      },
    };
    if (!this.coopCloudHeadStateMatches(current, expected)) {
      return this.coopCloudHeadStateMatches(current, next);
    }
    try {
      localStorage.setItem(this.coopCloudHeadKey(slot, accountIdentity), JSON.stringify(next.head));
      return this.coopCloudHeadStateMatches(this.readKnownCoopCloudHead(slot, accountIdentity), next);
    } catch {
      return false;
    }
  }

  private clearKnownCoopCloudHead(slot: number, accountIdentity: string, runId: string): boolean {
    const current = this.readKnownCoopCloudHead(slot, accountIdentity);
    if (current.kind === "invalid") {
      return false;
    }
    if (current.kind === "absent" || current.head.runId !== runId) {
      return true;
    }
    try {
      localStorage.removeItem(this.coopCloudHeadKey(slot, accountIdentity));
      return this.readKnownCoopCloudHead(slot, accountIdentity).kind === "absent";
    } catch {
      return false;
    }
  }

  private coopDuplicateConvergenceDebtKey(accountIdentity: string, loserSlot: number): string {
    return `er-coop-duplicate-debt:${accountIdentity.normalize("NFKC").toLowerCase()}:${loserSlot}`;
  }

  private coopKnownHeadFromCommitment(
    commitment: Pick<CoopResumeCommitment, "runId" | "checkpointRevision" | "digest">,
  ): CoopKnownCloudHead {
    return {
      version: 1,
      runId: commitment.runId,
      checkpointRevision: commitment.checkpointRevision,
      digest: commitment.digest,
    };
  }

  private isValidCoopKnownHead(value: unknown): value is CoopKnownCloudHead {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const head = value as Partial<CoopKnownCloudHead>;
    return (
      head.version === 1
      && isCoopRunId(head.runId)
      && Number.isSafeInteger(head.checkpointRevision)
      && (head.checkpointRevision ?? -1) >= 0
      && typeof head.digest === "string"
      && /^[0-9a-f]{64}$/u.test(head.digest)
    );
  }

  private readCoopDuplicateConvergenceDebt(
    accountIdentity: string,
    loserSlot: number,
  ):
    | { kind: "absent" }
    | { kind: "invalid"; raw: string }
    | { kind: "valid"; raw: string; debt: CoopDuplicateConvergenceDebt } {
    const raw = localStorage.getItem(this.coopDuplicateConvergenceDebtKey(accountIdentity, loserSlot));
    if (raw == null) {
      return { kind: "absent" };
    }
    try {
      const debt = JSON.parse(raw) as Partial<CoopDuplicateConvergenceDebt>;
      return debt.version === 1
        && debt.loserSlot === loserSlot
        && Number.isSafeInteger(debt.survivorSlot)
        && (debt.survivorSlot ?? -1) >= 0
        && (debt.survivorSlot ?? 5) < 5
        && debt.survivorSlot !== loserSlot
        && this.isValidCoopKnownHead(debt.loser)
        && this.isValidCoopKnownHead(debt.survivor)
        && debt.loser.runId === debt.survivor.runId
        ? { kind: "valid", raw, debt: debt as CoopDuplicateConvergenceDebt }
        : { kind: "invalid", raw };
    } catch {
      return { kind: "invalid", raw };
    }
  }

  private recordCoopDuplicateConvergenceDebt(
    accountIdentity: string,
    loserSlot: number,
    loser: CoopResumeCommitment,
    survivorSlot: number,
    survivor: CoopResumeCommitment,
  ): boolean {
    if (!this.persistenceAccountIsCurrent(accountIdentity)) {
      return false;
    }
    const key = this.coopDuplicateConvergenceDebtKey(accountIdentity, loserSlot);
    const current = this.readCoopDuplicateConvergenceDebt(accountIdentity, loserSlot);
    const debt: CoopDuplicateConvergenceDebt = {
      version: 1,
      loserSlot,
      loser: this.coopKnownHeadFromCommitment(loser),
      survivorSlot,
      survivor: this.coopKnownHeadFromCommitment(survivor),
    };
    const raw = JSON.stringify(debt);
    if (current.kind === "invalid") {
      return false;
    }
    if (current.kind === "valid") {
      return current.raw === raw;
    }
    return trySetLocalStorageItem(key, raw) && localStorage.getItem(key) === raw;
  }

  private clearCoopDuplicateConvergenceDebt(accountIdentity: string, loserSlot: number, expectedRaw: string): boolean {
    const key = this.coopDuplicateConvergenceDebtKey(accountIdentity, loserSlot);
    try {
      if (localStorage.getItem(key) !== expectedRaw) {
        return false;
      }
      localStorage.removeItem(key);
      return localStorage.getItem(key) == null;
    } catch (error) {
      coopWarn("launch", `duplicate convergence debt cleanup failed slot=${loserSlot}`, error);
      return false;
    }
  }

  private async withCoopPersistenceNetworkTimeout<T>(operation: Promise<T>, timeoutValue: T): Promise<T> {
    let timer: unknown;
    return Promise.race([
      operation,
      new Promise<T>(resolve => {
        timer = coopPersistenceClock.schedule(() => resolve(timeoutValue), coopPersistenceClock.networkTimeoutMs);
      }),
    ]).finally(() => {
      if (timer != null) {
        coopPersistenceClock.cancel(timer);
      }
    });
  }

  private readCoopCas(slot: number): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.getCoopCas>>> {
    return this.withCoopPersistenceNetworkTimeout(pokerogueApi.savedata.session.getCoopCas({ slot, clientSessionId }), {
      ok: false,
      status: null,
      error: "Co-op session read timed out.",
      failureKind: "transient",
    });
  }

  private readCoopRunStatus(
    request: Parameters<typeof pokerogueApi.savedata.session.getCoopRunStatus>[0],
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.getCoopRunStatus>>> {
    return this.withCoopPersistenceNetworkTimeout(pokerogueApi.savedata.session.getCoopRunStatus(request), {
      ok: false,
      status: null,
      error: "Co-op run status timed out.",
      failureKind: "transient",
    });
  }

  private updateCoopCasBounded(
    request: Parameters<typeof pokerogueApi.savedata.session.updateCoopCas>[0],
    raw: string,
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.updateCoopCas>>> {
    return this.withCoopPersistenceNetworkTimeout(pokerogueApi.savedata.session.updateCoopCas(request, raw), {
      ok: false,
      status: null,
      error: "Co-op cloud CAS timed out.",
      failureKind: "transient",
    });
  }

  private deleteCoopDuplicateExactBounded(
    request: Parameters<typeof pokerogueApi.savedata.session.deleteCoopDuplicateExact>[0],
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.deleteCoopDuplicateExact>>> {
    return this.withCoopPersistenceNetworkTimeout(pokerogueApi.savedata.session.deleteCoopDuplicateExact(request), {
      ok: false,
      status: null,
      error: "Co-op duplicate delete timed out.",
      failureKind: "transient",
    });
  }

  private deleteCoopCasBounded(
    request: Parameters<typeof pokerogueApi.savedata.session.deleteCoopCas>[0],
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.deleteCoopCas>>> {
    return this.withCoopPersistenceNetworkTimeout(pokerogueApi.savedata.session.deleteCoopCas(request), {
      ok: false,
      status: null,
      error: "Co-op checkpoint delete timed out.",
      failureKind: "transient",
    });
  }

  private deleteLegacyCoopExactBounded(
    request: Parameters<typeof pokerogueApi.savedata.session.deleteLegacyCoopExact>[0],
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.deleteLegacyCoopExact>>> {
    return this.withCoopPersistenceNetworkTimeout(pokerogueApi.savedata.session.deleteLegacyCoopExact(request), {
      ok: false,
      status: null,
      error: "Legacy co-op checkpoint delete timed out.",
      failureKind: "transient",
    });
  }

  private deleteOpaqueExactBounded(
    request: Parameters<typeof pokerogueApi.savedata.session.deleteOpaqueExact>[0],
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.deleteOpaqueExact>>> {
    return this.withCoopPersistenceNetworkTimeout(pokerogueApi.savedata.session.deleteOpaqueExact(request), {
      ok: false,
      status: null,
      error: "Opaque checkpoint delete timed out.",
      failureKind: "transient",
    });
  }

  private deleteSessionBounded(
    request: Parameters<typeof pokerogueApi.savedata.session.delete>[0],
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.delete>>> {
    return this.withCoopPersistenceNetworkTimeout(
      pokerogueApi.savedata.session.delete(request),
      "Session delete timed out.",
    );
  }

  private updateSessionBounded(
    request: Parameters<typeof pokerogueApi.savedata.session.update>[0],
    raw: string,
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.update>>> {
    return this.withCoopPersistenceNetworkTimeout(
      pokerogueApi.savedata.session.update(request, raw),
      "Session update timed out.",
    );
  }

  private clearSessionBounded(
    request: Parameters<typeof pokerogueApi.savedata.session.clear>[0],
    session: Parameters<typeof pokerogueApi.savedata.session.clear>[1],
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.session.clear>>> {
    return this.withCoopPersistenceNetworkTimeout(pokerogueApi.savedata.session.clear(request, session), {
      success: false,
      error: "Session clear timed out.",
    });
  }

  private updateAllBounded(
    request: Parameters<typeof pokerogueApi.savedata.updateAll>[0],
  ): Promise<Awaited<ReturnType<typeof pokerogueApi.savedata.updateAll>>> {
    return this.withCoopPersistenceNetworkTimeout(
      pokerogueApi.savedata.updateAll(request),
      "Combined cloud save timed out.",
    );
  }

  private async classifyCoopReplica(slot: number, raw: string): Promise<CoopClassifiedReplica> {
    const structural = classifySessionProtection(raw);
    if (structural === "unknown") {
      return { slot, raw, protection: "unknown", session: null, commitment: null };
    }
    let session: SessionSaveData;
    try {
      session = this.parseSessionData(raw);
    } catch {
      return {
        slot,
        raw,
        protection: structural === "solo" ? "unknown" : "coop-invalid",
        session: null,
        commitment: null,
      };
    }
    if (structural === "solo") {
      return { slot, raw, protection: "solo", session, commitment: null };
    }
    if (structural === "coop-invalid") {
      return { slot, raw, protection: "coop-invalid", session, commitment: null };
    }
    const commitment = await deriveCoopResumeCommitment(raw, session);
    return commitment == null
      ? { slot, raw, protection: "coop-invalid", session, commitment: null }
      : { slot, raw, protection: "coop-valid", session, commitment };
  }

  private sameCoopReplicaLineage(left: CoopResumeCommitment, right: CoopResumeCommitment): boolean {
    return (
      left.runId === right.runId
      && coopParticipantPairMatches(left.participants, right.participants[0], right.participants[1])
      && sameCoopIdentity(left.seats.host, right.seats.host)
      && sameCoopIdentity(left.seats.guest, right.seats.guest)
    );
  }

  private coopHeadMatchesCommitment(
    head: Pick<CoopKnownCloudHead, "runId" | "checkpointRevision" | "digest">,
    commitment: Pick<CoopResumeCommitment, "runId" | "checkpointRevision" | "digest">,
  ): boolean {
    return (
      head.runId === commitment.runId
      && head.checkpointRevision === commitment.checkpointRevision
      && head.digest === commitment.digest
    );
  }

  private async captureCoopDuplicateLocalFence(
    loserSlot: number,
    loser: Pick<CoopResumeCommitment, "runId" | "checkpointRevision" | "digest">,
    survivor: CoopClassifiedReplica,
    accountIdentity: string,
  ): Promise<CoopDuplicateLocalFence | null> {
    if (survivor.commitment == null || loser.runId !== survivor.commitment.runId) {
      return null;
    }
    const head = this.readKnownCoopCloudHead(loserSlot, accountIdentity);
    if (head.kind === "invalid" || (head.kind === "valid" && !this.coopHeadMatchesCommitment(head.head, loser))) {
      return null;
    }
    const storageKey = this.sessionStorageKeyForAccount(loserSlot, accountIdentity);
    const localRaw = localStorage.getItem(storageKey);
    if (localRaw == null) {
      return { storageKey, localRaw, head, removeLocal: false };
    }
    try {
      const local = await this.classifyCoopReplica(loserSlot, decrypt(localRaw, bypassLogin));
      const localCommitment = local.commitment;
      if (
        localCommitment == null
        || !this.sameCoopReplicaLineage(localCommitment, survivor.commitment)
        || localCommitment.checkpointRevision > survivor.commitment.checkpointRevision
        || (localCommitment.checkpointRevision === survivor.commitment.checkpointRevision
          && localCommitment.digest !== survivor.commitment.digest)
      ) {
        return null;
      }
      return { storageKey, localRaw, head, removeLocal: true };
    } catch {
      return null;
    }
  }

  private async finishCoopDuplicateLocalCleanup(
    accountIdentity: string,
    loserSlot: number,
    loserRunId: string,
    expectedDebtRaw: string,
    fence: CoopDuplicateLocalFence,
    contextIsCurrent: () => boolean,
  ): Promise<boolean> {
    const cleaned = await this.withCoopResumePersistenceLease(async () => {
      const debt = this.readCoopDuplicateConvergenceDebt(accountIdentity, loserSlot);
      if (
        !contextIsCurrent()
        || debt.kind !== "valid"
        || debt.raw !== expectedDebtRaw
        || localStorage.getItem(fence.storageKey) !== fence.localRaw
        || !this.coopCloudHeadStateMatches(this.readKnownCoopCloudHead(loserSlot, accountIdentity), fence.head)
      ) {
        return false;
      }
      if (fence.removeLocal && fence.localRaw != null) {
        try {
          localStorage.removeItem(fence.storageKey);
        } catch (error) {
          coopWarn("launch", `duplicate local cleanup failed slot=${loserSlot}`, error);
          return false;
        }
        if (localStorage.getItem(fence.storageKey) != null) {
          return false;
        }
      }
      if (fence.head.kind === "valid" && !this.clearKnownCoopCloudHead(loserSlot, accountIdentity, loserRunId)) {
        return false;
      }
      // Clear the intent last. A crash at any earlier instruction leaves enough exact evidence for
      // the next discovery scan to finish the same deletion idempotently.
      return this.clearCoopDuplicateConvergenceDebt(accountIdentity, loserSlot, expectedDebtRaw);
    }, accountIdentity);
    return cleaned === true;
  }

  /**
   * Read every cloud slot with typed status and converge pre-existing same-run duplicates. The
   * documented survivor policy is highest checkpoint revision; byte-identical equal revisions use
   * the lowest slot. Equal-revision different bytes or different participant/seat lineage conflict.
   */
  private async scanCoopCloudReplicas(accountIdentity: string): Promise<Map<number, CoopClassifiedReplica | null>> {
    const scanRuntime = getCoopRuntime();
    const scanController = scanRuntime?.controller ?? null;
    const scanGeneration = coopSessionGeneration();
    const scanContextIsCurrent = (): boolean =>
      this.persistenceAccountIsCurrent(accountIdentity)
      && (scanRuntime == null
        || (getCoopRuntime() === scanRuntime
          && scanRuntime.controller === scanController
          && coopSessionGeneration() === scanGeneration));
    if (!scanContextIsCurrent()) {
      throw new CoopResumeReplicaUnavailableError("account changed before co-op cloud scan");
    }
    const reads = await Promise.all([0, 1, 2, 3, 4].map(slot => this.readCoopCas(slot)));
    if (!scanContextIsCurrent()) {
      throw new CoopResumeReplicaUnavailableError("account/runtime changed during co-op cloud scan");
    }
    const replicas = new Map<number, CoopClassifiedReplica | null>();
    for (let slot = 0; slot < reads.length; slot++) {
      const read = reads[slot];
      if (!read.ok) {
        if (read.failureKind === "missing") {
          replicas.set(slot, null);
          continue;
        }
        throw new CoopResumeReplicaUnavailableError(
          `cloud slot ${slot} read failed (${read.failureKind}, HTTP ${read.status ?? "transport"})`,
        );
      }
      replicas.set(slot, await this.classifyCoopReplica(slot, read.rawSavedata));
    }

    // Resume any exact duplicate-deletion intent that survived a tab/browser crash. The debt is
    // recorded before the destructive request and removed only after cloud proofs plus local/head
    // cleanup, so every crash cut converges on the next complete scan.
    for (let loserSlot = 0; loserSlot < 5; loserSlot++) {
      const debtState = this.readCoopDuplicateConvergenceDebt(accountIdentity, loserSlot);
      if (debtState.kind === "invalid") {
        throw new CoopResumeReplicaUnavailableError(`duplicate convergence debt is malformed for slot ${loserSlot}`);
      }
      if (debtState.kind === "absent") {
        continue;
      }
      const { debt } = debtState;
      const loser = replicas.get(loserSlot) ?? null;
      const survivor = replicas.get(debt.survivorSlot) ?? null;
      if (
        survivor?.commitment == null
        || !this.coopHeadMatchesCommitment(debt.survivor, survivor.commitment)
        || (loser?.commitment != null && !this.coopHeadMatchesCommitment(debt.loser, loser.commitment))
        || (loser != null && loser.commitment == null)
      ) {
        throw new CoopResumeReplicaUnavailableError(
          `duplicate convergence debt no longer matches its exact cloud pair for slot ${loserSlot}`,
        );
      }
      const fence = await this.captureCoopDuplicateLocalFence(loserSlot, debt.loser, survivor, accountIdentity);
      if (fence == null) {
        throw new CoopResumeReplicaUnavailableError(
          `duplicate convergence debt has conflicting local lineage for slot ${loserSlot}`,
        );
      }
      const convergence = await enqueueSessionCloudMutation(accountIdentity, async () => {
        const currentDebt = this.readCoopDuplicateConvergenceDebt(accountIdentity, loserSlot);
        if (
          !scanContextIsCurrent()
          || currentDebt.kind !== "valid"
          || currentDebt.raw !== debtState.raw
          || localStorage.getItem(fence.storageKey) !== fence.localRaw
          || !this.coopCloudHeadStateMatches(this.readKnownCoopCloudHead(loserSlot, accountIdentity), fence.head)
        ) {
          return null;
        }
        let mutationOutcome = "already-absent";
        if (loser != null) {
          const mutation = await this.deleteCoopDuplicateExactBounded({
            slot: loserSlot,
            clientSessionId,
            coopCasRunId: debt.loser.runId,
            coopCasCheckpointRevision: debt.loser.checkpointRevision,
            coopCasDigest: debt.loser.digest,
            survivorSlot: debt.survivorSlot,
            survivorCheckpointRevision: debt.survivor.checkpointRevision,
            survivorDigest: debt.survivor.digest,
          });
          mutationOutcome = mutation.ok ? "ok" : mutation.failureKind;
        }
        if (!scanContextIsCurrent()) {
          return null;
        }
        const [loserProof, survivorProof] = await Promise.all([
          this.readCoopCas(loserSlot),
          this.readCoopCas(debt.survivorSlot),
        ]);
        return scanContextIsCurrent() ? { mutationOutcome, loserProof, survivorProof } : null;
      });
      if (
        convergence == null
        || convergence.loserProof.ok
        || convergence.loserProof.failureKind !== "missing"
        || !convergence.survivorProof.ok
        || convergence.survivorProof.rawSavedata !== survivor.raw
      ) {
        throw new CoopResumeReplicaUnavailableError(
          `recorded duplicate convergence could not prove its terminal cloud state for slot ${loserSlot}`,
        );
      }
      if (
        !(await this.finishCoopDuplicateLocalCleanup(
          accountIdentity,
          loserSlot,
          debt.loser.runId,
          debtState.raw,
          fence,
          scanContextIsCurrent,
        ))
      ) {
        throw new CoopResumeReplicaUnavailableError(
          `recorded duplicate convergence could not finish local cleanup for slot ${loserSlot}`,
        );
      }
      replicas.set(loserSlot, null);
    }

    const byRun = new Map<string, CoopClassifiedReplica[]>();
    for (const replica of replicas.values()) {
      if (replica?.commitment != null) {
        const group = byRun.get(replica.commitment.runId) ?? [];
        group.push(replica);
        byRun.set(replica.commitment.runId, group);
      }
    }
    for (const [runId, group] of byRun) {
      if (group.length < 2) {
        continue;
      }
      const lineage = group[0].commitment!;
      if (group.some(replica => !this.sameCoopReplicaLineage(lineage, replica.commitment!))) {
        throw new CoopResumeReplicaUnavailableError(`duplicate run ${runId} has conflicting participant/seat lineage`);
      }
      const ordered = [...group].sort((left, right) => {
        const revisionDelta = right.commitment!.checkpointRevision - left.commitment!.checkpointRevision;
        return revisionDelta === 0 ? left.slot - right.slot : revisionDelta;
      });
      const survivor = ordered[0];
      const tied = ordered.filter(
        replica => replica.commitment!.checkpointRevision === survivor.commitment!.checkpointRevision,
      );
      if (tied.some(replica => replica.commitment!.digest !== survivor.commitment!.digest)) {
        throw new CoopResumeReplicaUnavailableError(`duplicate run ${runId} has an equal-revision fork`);
      }
      for (const duplicate of ordered.slice(1)) {
        const fence = await this.captureCoopDuplicateLocalFence(
          duplicate.slot,
          duplicate.commitment!,
          survivor,
          accountIdentity,
        );
        if (fence == null) {
          throw new CoopResumeReplicaUnavailableError(`duplicate slot ${duplicate.slot} has conflicting local lineage`);
        }
        const debtRecorded = await this.withCoopResumePersistenceLease(async () => {
          if (
            !scanContextIsCurrent()
            || localStorage.getItem(fence.storageKey) !== fence.localRaw
            || !this.coopCloudHeadStateMatches(this.readKnownCoopCloudHead(duplicate.slot, accountIdentity), fence.head)
          ) {
            return false;
          }
          return this.recordCoopDuplicateConvergenceDebt(
            accountIdentity,
            duplicate.slot,
            duplicate.commitment!,
            survivor.slot,
            survivor.commitment!,
          );
        }, accountIdentity);
        const debtState = this.readCoopDuplicateConvergenceDebt(accountIdentity, duplicate.slot);
        if (debtRecorded !== true || debtState.kind !== "valid") {
          throw new CoopResumeReplicaUnavailableError(
            `duplicate slot ${duplicate.slot} could not durably record convergence intent`,
          );
        }
        const convergence = await enqueueSessionCloudMutation(accountIdentity, async () => {
          const currentDebt = this.readCoopDuplicateConvergenceDebt(accountIdentity, duplicate.slot);
          if (
            !scanContextIsCurrent()
            || currentDebt.kind !== "valid"
            || currentDebt.raw !== debtState.raw
            || localStorage.getItem(fence.storageKey) !== fence.localRaw
            || !this.coopCloudHeadStateMatches(this.readKnownCoopCloudHead(duplicate.slot, accountIdentity), fence.head)
          ) {
            return null;
          }
          const mutation = await this.deleteCoopDuplicateExactBounded({
            slot: duplicate.slot,
            clientSessionId,
            coopCasRunId: runId,
            coopCasCheckpointRevision: duplicate.commitment!.checkpointRevision,
            coopCasDigest: duplicate.commitment!.digest,
            survivorSlot: survivor.slot,
            survivorCheckpointRevision: survivor.commitment!.checkpointRevision,
            survivorDigest: survivor.commitment!.digest,
          });
          if (!scanContextIsCurrent()) {
            return null;
          }
          const [loserProof, survivorProof] = await Promise.all([
            this.readCoopCas(duplicate.slot),
            this.readCoopCas(survivor.slot),
          ]);
          return scanContextIsCurrent() ? { mutation, loserProof, survivorProof } : null;
        });
        if (convergence == null) {
          throw new CoopResumeReplicaUnavailableError(
            "account/runtime/local lineage changed during duplicate convergence",
          );
        }
        const { mutation, loserProof, survivorProof } = convergence;
        const survivorExact = survivorProof.ok && survivorProof.rawSavedata === survivor.raw;
        const loserAbsent = !loserProof.ok && loserProof.failureKind === "missing";
        if (!loserAbsent || !survivorExact) {
          throw new CoopResumeReplicaUnavailableError(
            `duplicate convergence failed (${mutation.ok ? "unproved" : mutation.failureKind}) for run ${runId}`,
          );
        }
        if (
          !(await this.finishCoopDuplicateLocalCleanup(
            accountIdentity,
            duplicate.slot,
            runId,
            debtState.raw,
            fence,
            scanContextIsCurrent,
          ))
        ) {
          throw new CoopResumeReplicaUnavailableError(
            `duplicate slot ${duplicate.slot} local lineage could not converge`,
          );
        }
        replicas.set(duplicate.slot, null);
      }
    }
    return replicas;
  }

  private captureCoopPersistenceContext(slot: number, requiredRole?: "host" | "guest"): CoopPersistenceContext | null {
    const runtime = getCoopRuntime();
    const controller = runtime?.controller;
    const accountIdentity = this.currentPersistenceAccount();
    if (
      runtime == null
      || controller == null
      || (requiredRole != null && controller.role !== requiredRole)
      || !isCoopRunId(controller.runId)
      || (!bypassLogin && accountIdentity == null)
    ) {
      return null;
    }
    return {
      accountIdentity,
      slot,
      storageKey: this.sessionStorageKeyForAccount(slot, accountIdentity),
      runtime,
      controller,
      generation: coopSessionGeneration(),
      runId: controller.runId,
    };
  }

  private coopPersistenceContextIsCurrent(context: CoopPersistenceContext, requiredRole?: "host" | "guest"): boolean {
    return (
      this.persistenceAccountIsCurrent(context.accountIdentity)
      && getCoopRuntime() === context.runtime
      && context.runtime.controller === context.controller
      && coopSessionGeneration() === context.generation
      && context.controller.runId === context.runId
      && context.controller.role === (requiredRole ?? context.controller.role)
      && globalScene.sessionSlotId === context.slot
      && this.sessionStorageKeyForAccount(context.slot, context.accountIdentity) === context.storageKey
    );
  }

  private async withSessionPersistenceLease<T>(
    operation: () => Promise<T>,
    requireLocks: boolean,
    accountIdentity = this.currentPersistenceAccount(),
    lockAcquireTimeoutMs = coopPersistenceClock.lockAcquireTimeoutMs,
  ): Promise<T | null> {
    if (!this.persistenceAccountIsCurrent(accountIdentity)) {
      return null;
    }
    const lockName = `er-coop-resume:${accountIdentity?.normalize("NFKC").toLowerCase() ?? "guest"}`;
    const lockManager = (
      globalThis.navigator as Navigator & {
        locks?: {
          request<R>(
            name: string,
            options: { mode: "exclusive"; signal?: AbortSignal },
            callback: () => Promise<R>,
          ): Promise<R>;
        };
      }
    )?.locks;
    if (lockManager != null) {
      const abortController = new AbortController();
      let acquired = false;
      let expired = false;
      let acquisitionTimer: unknown;
      const timedOut = new Promise<null>(resolve => {
        acquisitionTimer = coopPersistenceClock.schedule(() => {
          if (acquired) {
            return;
          }
          expired = true;
          abortController.abort("co-op persistence lock acquisition timed out");
          resolve(null);
        }, lockAcquireTimeoutMs);
      });
      let requested: Promise<T | null>;
      try {
        requested = lockManager
          .request(lockName, { mode: "exclusive", signal: abortController.signal }, async () => {
            acquired = true;
            if (acquisitionTimer != null) {
              coopPersistenceClock.cancel(acquisitionTimer);
            }
            return !expired && this.persistenceAccountIsCurrent(accountIdentity) ? operation() : null;
          })
          .catch(error => {
            if (!expired) {
              coopWarn("launch", "co-op persistence lock request failed", error);
            }
            return null;
          });
      } catch (error) {
        if (acquisitionTimer != null) {
          coopPersistenceClock.cancel(acquisitionTimer);
        }
        coopWarn("launch", "co-op persistence lock request threw", error);
        return null;
      }
      const result = await Promise.race([requested, timedOut]);
      if (acquisitionTimer != null) {
        coopPersistenceClock.cancel(acquisitionTimer);
      }
      if (expired) {
        coopWarn("launch", "co-op persistence lock acquisition timed out; failing closed");
      }
      return result;
    }
    if (!requireLocks) {
      return this.persistenceAccountIsCurrent(accountIdentity) ? operation() : null;
    }
    coopWarn("launch", "co-op persistence requires Web Locks; failing closed on this browser");
    return null;
  }

  private hasWebLocks(): boolean {
    return (globalThis.navigator as Navigator & { locks?: { request: unknown } })?.locks?.request != null;
  }

  private withCoopResumePersistenceLease<T>(
    operation: () => Promise<T>,
    accountIdentity = this.currentPersistenceAccount(),
  ): Promise<T | null> {
    return this.withSessionPersistenceLease(operation, true, accountIdentity);
  }

  /** Finish local retirement after the backend has already committed an exact co-op tombstone. */
  private withCommittedCoopDeletePersistenceLease<T>(
    operation: () => Promise<T>,
    accountIdentity: string,
  ): Promise<T | null> {
    return this.withSessionPersistenceLease(
      operation,
      true,
      accountIdentity,
      COOP_COMMITTED_DELETE_LOCK_ACQUIRE_TIMEOUT_MS,
    );
  }

  /** Retire one exact local replica after a typed backend status already proved its run tombstoned. */
  private async retireStatusProvenTombstonedLocalReplica(
    slot: number,
    expectedLocalRaw: string,
    commitment: CoopResumeCommitment,
    expectedHead: CoopKnownCloudHeadState,
    accountIdentity: string,
  ): Promise<boolean> {
    const storageKey = this.sessionStorageKeyForAccount(slot, accountIdentity);
    const removed = await this.withCoopResumePersistenceLease(async () => {
      if (
        localStorage.getItem(storageKey) !== expectedLocalRaw
        || !this.coopCloudHeadStateMatches(this.readKnownCoopCloudHead(slot, accountIdentity), expectedHead)
        || !recordCoopDeletedRun(accountIdentity, commitment.runId)
        || !this.clearKnownCoopCloudHead(slot, accountIdentity, commitment.runId)
      ) {
        return false;
      }
      try {
        localStorage.removeItem(storageKey);
        return localStorage.getItem(storageKey) == null;
      } catch (error) {
        coopWarn("launch", `tombstoned local checkpoint removal failed slot=${slot}`, error);
        return false;
      }
    }, accountIdentity);
    return removed === true;
  }

  private async hasTombstoneProof(slot: number, accountIdentity: string, runId: string): Promise<boolean> {
    const status = await this.readCoopRunStatus({ clientSessionId, coopRunId: runId, slot });
    if (
      !this.persistenceAccountIsCurrent(accountIdentity)
      || !status.ok
      || status.value.state !== "tombstoned"
      || status.value.runId !== runId
    ) {
      return false;
    }
    return true;
  }

  private async retireTombstonedLocalReplica(
    slot: number,
    localRaw: string,
    accountIdentity: string,
  ): Promise<boolean> {
    let localJson: string;
    try {
      localJson = decrypt(localRaw, bypassLogin);
    } catch {
      return false;
    }
    const replica = await this.classifyCoopReplica(slot, localJson);
    if (replica.commitment == null) {
      return false;
    }
    const runId = replica.commitment.runId;
    const expectedHead = this.readKnownCoopCloudHead(slot, accountIdentity);
    if (expectedHead.kind === "invalid" || !(await this.hasTombstoneProof(slot, accountIdentity, runId))) {
      return false;
    }
    return this.retireStatusProvenTombstonedLocalReplica(
      slot,
      localRaw,
      replica.commitment,
      expectedHead,
      accountIdentity,
    );
  }

  private async proveEmptySlotLineage(slot: number, accountIdentity: string): Promise<boolean> {
    const expectedHead = this.readKnownCoopCloudHead(slot, accountIdentity);
    if (expectedHead.kind === "invalid") {
      return false;
    }
    if (expectedHead.kind === "absent") {
      return true;
    }
    const storageKey = this.sessionStorageKeyForAccount(slot, accountIdentity);
    if (
      localStorage.getItem(storageKey) != null
      || !(await this.hasTombstoneProof(slot, accountIdentity, expectedHead.head.runId))
    ) {
      return false;
    }
    const cleared = await this.withCoopResumePersistenceLease(async () => {
      if (
        localStorage.getItem(storageKey) != null
        || !this.coopCloudHeadStateMatches(this.readKnownCoopCloudHead(slot, accountIdentity), expectedHead)
        || !recordCoopDeletedRun(accountIdentity, expectedHead.head.runId)
      ) {
        return false;
      }
      return this.clearKnownCoopCloudHead(slot, accountIdentity, expectedHead.head.runId);
    }, accountIdentity);
    return cleared === true;
  }

  /**
   * Pick a tentative fresh-run slot only after both local and cloud occupancy are known. The read is
   * deliberately not treated as ownership: the first complete save must still win backend empty-slot
   * CAS. Unknown/error is occupied, and the exact runtime/account is fenced across every await.
   */
  public async findVerifiedEmptyCoopSessionSlot(): Promise<number | null> {
    this.pendingFreshCoopSlotClaim = null;
    this.committedFreshCoopLaunchSession = null;
    if (!this.hasWebLocks()) {
      coopWarn("launch", "fresh co-op slot selection requires Web Locks before backend CAS");
      return null;
    }
    const runtime = getCoopRuntime();
    const controller = runtime?.controller;
    const generation = coopSessionGeneration();
    const accountIdentity = loggedInUser?.username ?? null;
    if (
      runtime == null
      || controller?.role !== "host"
      || !isCoopRunId(controller.runId)
      || (!bypassLogin && accountIdentity == null)
    ) {
      return null;
    }
    const runId = controller.runId;
    const claimIsCurrent = (): boolean =>
      getCoopRuntime() === runtime
      && runtime.controller === controller
      && coopSessionGeneration() === generation
      && controller.role === "host"
      && controller.runId === runId
      && (bypassLogin
        || (accountIdentity != null
          && loggedInUser?.username != null
          && sameCoopIdentity(accountIdentity, loggedInUser.username)));

    let cloudReplicas: Map<number, CoopClassifiedReplica | null> | null = null;
    if (!bypassLogin && accountIdentity != null) {
      try {
        cloudReplicas = await this.scanCoopCloudReplicas(accountIdentity);
      } catch (error) {
        coopWarn("launch", "fresh co-op cloud scan failed closed", error);
        return null;
      }
      const runStatus = await this.readCoopRunStatus({
        clientSessionId,
        coopRunId: runId,
      });
      if (!claimIsCurrent() || !runStatus.ok || runStatus.value.state !== "missing") {
        coopWarn("launch", "fresh co-op run identity is not account-wide missing");
        return null;
      }
    }

    // Per-slot verdicts so a live "no verified empty slot" abort names each slot's exact blocker in
    // the captured console (local-occupied vs cloud-occupied vs lineage-unproven), instead of leaving
    // the report with only the aggregate refusal (2026-07-17 coop-save/anon captures).
    const verdicts: string[] = [];
    for (let slot = 0; slot < 5; slot++) {
      if (!claimIsCurrent()) {
        return null;
      }
      const storageKey = this.sessionStorageKeyForAccount(slot, accountIdentity);
      const localRaw = localStorage.getItem(storageKey);
      if (
        localRaw != null
        && (bypassLogin
          || accountIdentity == null
          || !(await this.retireTombstonedLocalReplica(slot, localRaw, accountIdentity)))
      ) {
        verdicts.push(`${slot}:local-occupied`);
        continue;
      }
      if (!bypassLogin && cloudReplicas?.get(slot) != null) {
        verdicts.push(`${slot}:cloud-occupied`);
        continue;
      }
      if (!bypassLogin && accountIdentity != null && !(await this.proveEmptySlotLineage(slot, accountIdentity))) {
        verdicts.push(`${slot}:lineage-unproven`);
        continue;
      }
      // Close the local read-vs-cloud-await window. A same-context/cross-tab mutation loses the slot.
      if (claimIsCurrent() && localStorage.getItem(storageKey) == null) {
        this.pendingFreshCoopSlotClaim = {
          slot,
          runId,
          generation,
          accountIdentity,
          controller,
        };
        coopLog("launch", `fresh co-op slot scan verified slot ${slot} [${verdicts.join(" ")}]`);
        return slot;
      }
      verdicts.push(`${slot}:raced`);
    }
    coopWarn("launch", `fresh co-op slot scan found NO verified slot [${verdicts.join(" ")}]`);
    return null;
  }

  /**
   * Maintainer directive (2026-07-17): a fresh co-op run reclaims a save slot AUTOMATICALLY, like
   * the solo new-game flow, instead of failing closed when no slot verifies empty. Preference:
   *  1. A verified-empty slot (unchanged path; nothing is deleted).
   *  2. Otherwise DELETE-and-claim the least valuable occupied slot: unreadable/conflicted co-op
   *     remnants first (they are unresumable), then the healthy save with the OLDEST timestamp.
   * Reclamation runs the full {@linkcode deleteSession} path (cloud-safe classification, co-op run
   * tombstoning, leased local retirement) and then re-runs the SAME verified-empty selection, so
   * the overwrite is an explicit, logged decision and the first save still wins backend empty-slot
   * CAS. If every reclamation attempt fails verification, the caller keeps the fail-closed abort.
   */
  public async findCoopLaunchSlotWithOverride(): Promise<{
    slot: number;
    overwrote: { slot: number; wave: number | null } | null;
  } | null> {
    const empty = await this.findVerifiedEmptyCoopSessionSlot();
    if (empty != null) {
      return { slot: empty, overwrote: null };
    }
    const accountIdentity = this.currentPersistenceAccount();
    // Divergent/quarantined replicas (readable locally but conflicting with their cloud copy - the
    // live slot-4 class) are unresumable garbage and must be reclaimed BEFORE any healthy save.
    // The isolated lobby snapshot already classifies them without aborting on one.
    let quarantinedSlots = new Set<number>();
    try {
      quarantinedSlots = new Set((await this.getCoopResumeLobbySnapshot()).failures.keys());
    } catch (error) {
      coopWarn("launch", "reclaim ranking could not classify quarantined slots", error);
    }
    const candidates: { slot: number; garbage: boolean; timestamp: number; wave: number | null }[] = [];
    for (let slot = 0; slot < 5; slot++) {
      const raw = localStorage.getItem(this.sessionStorageKeyForAccount(slot, accountIdentity));
      if (raw == null) {
        // Locally empty but cloud/lineage-unverifiable: there is nothing here the player chose to
        // keep, but deleting cloud state we cannot classify is exactly the overwrite class the
        // verified path exists to prevent. Skip; a later candidate's reclamation may still verify.
        continue;
      }
      try {
        const session = this.parseSessionData(decrypt(raw, bypassLogin));
        candidates.push({
          slot,
          garbage: quarantinedSlots.has(slot),
          timestamp: session.timestamp ?? 0,
          wave: session.waveIndex ?? null,
        });
      } catch {
        candidates.push({ slot, garbage: true, timestamp: 0, wave: null });
      }
    }
    candidates.sort((a, b) => Number(b.garbage) - Number(a.garbage) || a.timestamp - b.timestamp);
    for (const candidate of candidates) {
      coopLog(
        "launch",
        `fresh co-op launch reclaiming least-recent save slot=${candidate.slot} `
          + `wave=${candidate.wave ?? "?"} garbage=${candidate.garbage}`,
      );
      if (!(await this.deleteSession(candidate.slot))) {
        coopWarn("launch", `least-recent reclamation delete failed slot=${candidate.slot}; trying next candidate`);
        continue;
      }
      const claimed = await this.findVerifiedEmptyCoopSessionSlot();
      if (claimed != null) {
        return { slot: claimed, overwrote: { slot: candidate.slot, wave: candidate.wave } };
      }
      // Deleted but the account still has no verifiable slot (e.g. residual cloud state elsewhere):
      // keep trying strictly-less-valuable candidates before giving up fail-closed.
    }
    return null;
  }

  /** Final synchronous local fence immediately before starter materialization. */
  public confirmPendingFreshCoopSessionSlot(slot: number): boolean {
    const claim = this.pendingFreshCoopSlotClaim;
    const runtime = getCoopRuntime();
    return (
      claim != null
      && claim.slot === slot
      && runtime?.controller === claim.controller
      && coopSessionGeneration() === claim.generation
      && claim.controller.role === "host"
      && claim.controller.runId === claim.runId
      && (bypassLogin
        || (claim.accountIdentity != null
          && loggedInUser?.username != null
          && sameCoopIdentity(claim.accountIdentity, loggedInUser.username)))
      && localStorage.getItem(this.sessionStorageKeyForAccount(slot, claim.accountIdentity)) == null
    );
  }

  public cancelPendingFreshCoopSessionSlot(): void {
    this.pendingFreshCoopSlotClaim = null;
    this.committedFreshCoopLaunchSession = null;
  }

  private abortFreshCoopLaunch(
    reason: CoopLaunchSnapshotAbortReason,
    claim: CoopFreshSessionSlotClaim | null = this.pendingFreshCoopSlotClaim,
  ): void {
    const wave = globalScene.currentBattle?.waveIndex ?? 1;
    const runtime = getCoopRuntime();
    if (claim != null && runtime?.controller === claim.controller && coopSessionGeneration() === claim.generation) {
      runtime.battleStream.sendLaunchSnapshotAbort(wave, reason);
    }
    if (this.pendingFreshCoopSlotClaim === claim) {
      this.cancelPendingFreshCoopSessionSlot();
    } else {
      this.committedFreshCoopLaunchSession = null;
    }
    coopWarn("launch", `fresh co-op launch aborted wave=${wave} reason=${reason}`);
  }

  /** Consume the exact first-save bytes that are now safe to release to the waiting guest. */
  public async consumeCommittedFreshCoopLaunchSession(wave: number): Promise<CoopFreshLaunchConsumption> {
    const committed = this.committedFreshCoopLaunchSession;
    if (committed == null) {
      return { kind: "not-fresh" };
    }
    const consumed = await this.withCoopResumePersistenceLease(async () => {
      const runtime = getCoopRuntime();
      if (
        committed.wave !== wave
        || runtime?.controller !== committed.controller
        || committed.controller.runId !== committed.runId
        || coopSessionGeneration() !== committed.generation
        || (!bypassLogin
          && (committed.accountIdentity == null
            || loggedInUser?.username == null
            || !sameCoopIdentity(committed.accountIdentity, loggedInUser.username)))
        || localStorage.getItem(this.sessionStorageKeyForAccount(committed.slot, committed.accountIdentity))
          !== committed.encryptedSession
      ) {
        return null;
      }
      return committed.sessionJson;
    });
    if (this.committedFreshCoopLaunchSession === committed) {
      this.committedFreshCoopLaunchSession = null;
    }
    if (consumed == null) {
      const runtime = getCoopRuntime();
      if (runtime?.controller === committed.controller && coopSessionGeneration() === committed.generation) {
        runtime.battleStream.sendLaunchSnapshotAbort(wave, "slot-raced");
      }
      coopWarn("launch", `fresh co-op launch invalidated before exact snapshot consumption wave=${wave}`);
      return { kind: "invalid" };
    }
    return { kind: "committed", sessionJson: consumed };
  }

  public armCoopResumeCheckpointPersistence(): void {
    const runtime = getCoopRuntime();
    const controller = runtime?.controller;
    if (runtime == null || controller == null || controller.role !== "guest") {
      return;
    }
    const generation = coopSessionGeneration();
    const accountIdentity = this.currentPersistenceAccount();
    if (!bypassLogin && accountIdentity == null) {
      return;
    }
    const exactRuntimeIsCurrent = (): boolean => {
      const membership = runtime.membership.snapshot();
      return (
        this.persistenceAccountIsCurrent(accountIdentity)
        && (bypassLogin || controller.localName() === accountIdentity)
        && getCoopRuntime() === runtime
        && runtime.controller === controller
        && coopSessionGeneration() === generation
        && runtime.localTransport.state === "connected"
        && controller.partnerConnected
        && controller.compatibilityAccepted
        && membership.state === "active"
        && membership.members.every(member => member.present)
      );
    };

    const persist = async (
      sessionJson: string,
      commitment: CoopResumeCommitment,
      mirrorCloud: boolean,
    ): Promise<CoopResumeCheckpointPersistenceAck> => {
      if (!exactRuntimeIsCurrent()) {
        return { success: false, reason: "runtime-invalid" };
      }
      let session: SessionSaveData;
      try {
        session = this.parseSessionData(sessionJson);
      } catch (error) {
        coopWarn("launch", "guest resume checkpoint parse failed", error);
        return { success: false, reason: "invalid-checkpoint" };
      }
      const partner = controller.partnerName;
      if (
        partner == null
        || !coopSeatMapMatches(session.coopParticipants, controller.localName(), partner, controller.role)
        || !(await coopResumeCommitmentMatches(sessionJson, session, commitment))
        || !exactRuntimeIsCurrent()
      ) {
        coopWarn("launch", "guest resume checkpoint discriminator failed");
        return { success: false, reason: "invalid-checkpoint" };
      }
      const result = await this.withCoopResumePersistenceLease(async () => {
        type StoredCheckpoint = {
          session: SessionSaveData;
          sessionJson: string;
          commitment: CoopResumeCommitment;
        };
        type ResumeSlotInspection =
          | { kind: "empty"; slot: number; localRaw: string | null; cloudCas: CoopResumeCloudCas | null }
          | {
              kind: "occupied";
              slot: number;
              localRaw: string | null;
              stored: StoredCheckpoint;
              cloudCas: CoopResumeCloudCas | null;
            }
          | { kind: "unavailable"; slot: number; localRaw: string | null };

        const parseStored = async (json: string): Promise<StoredCheckpoint | null> => {
          try {
            const parsed = this.parseSessionData(json);
            const parsedCommitment = await deriveCoopResumeCommitment(json, parsed);
            return parsedCommitment == null
              ? null
              : { session: parsed, sessionJson: json, commitment: parsedCommitment };
          } catch {
            return null;
          }
        };
        const inspectSlot = async (slot: number): Promise<ResumeSlotInspection> => {
          const localRaw = localStorage.getItem(this.sessionStorageKeyForAccount(slot, accountIdentity));
          const localJson = (() => {
            if (localRaw == null) {
              return null;
            }
            try {
              return decrypt(localRaw, bypassLogin);
            } catch {
              return;
            }
          })();
          if (localJson === undefined) {
            return { kind: "unavailable", slot, localRaw };
          }
          const localStored = localJson == null ? null : await parseStored(localJson);
          if (localJson != null && localStored == null) {
            return { kind: "unavailable", slot, localRaw };
          }
          if (bypassLogin) {
            return localStored == null
              ? { kind: "empty", slot, localRaw, cloudCas: null }
              : { kind: "occupied", slot, localRaw, stored: localStored, cloudCas: null };
          }

          const cloudRead = await this.readCoopCas(slot);
          const cloudEmpty = !cloudRead.ok && cloudRead.failureKind === "missing";
          if (!cloudRead.ok && !cloudEmpty) {
            return { kind: "unavailable", slot, localRaw };
          }
          const cloudStored = cloudEmpty ? null : await parseStored(cloudRead.ok ? cloudRead.rawSavedata : "");
          if (!cloudEmpty && cloudStored == null) {
            return { kind: "unavailable", slot, localRaw };
          }
          const cloudCas: CoopResumeCloudCas =
            cloudStored == null
              ? { mode: "empty" }
              : {
                  mode: "existing",
                  runId: cloudStored.commitment.runId,
                  checkpointRevision: cloudStored.commitment.checkpointRevision,
                  digest: cloudStored.commitment.digest,
                };
          if (localStored == null && cloudStored == null) {
            return { kind: "empty", slot, localRaw, cloudCas };
          }
          if (localStored == null || cloudStored == null) {
            return {
              kind: "occupied",
              slot,
              localRaw,
              stored: localStored ?? cloudStored!,
              cloudCas,
            };
          }
          if (localStored.commitment.runId !== cloudStored.commitment.runId) {
            return { kind: "unavailable", slot, localRaw };
          }
          if (localStored.commitment.checkpointRevision === cloudStored.commitment.checkpointRevision) {
            if (localStored.commitment.digest !== cloudStored.commitment.digest) {
              return { kind: "unavailable", slot, localRaw };
            }
            return { kind: "occupied", slot, localRaw, stored: cloudStored, cloudCas };
          }
          return {
            kind: "occupied",
            slot,
            localRaw,
            stored:
              localStored.commitment.checkpointRevision > cloudStored.commitment.checkpointRevision
                ? localStored
                : cloudStored,
            cloudCas,
          };
        };
        const exactRunSlot = (
          inspection: ResumeSlotInspection,
        ): inspection is Extract<ResumeSlotInspection, { kind: "occupied" }> =>
          inspection.kind === "occupied"
          && inspection.stored.commitment.runId === commitment.runId
          && coopSeatMapMatches(
            inspection.stored.session.coopParticipants,
            controller.localName(),
            partner,
            controller.role,
          );
        const cloudBackedExactRunSlot = (
          inspection: ResumeSlotInspection,
        ): inspection is Extract<ResumeSlotInspection, { kind: "occupied" }> =>
          exactRunSlot(inspection)
          && (bypassLogin
            || (inspection.cloudCas?.mode === "existing" && inspection.cloudCas.runId === commitment.runId));

        // Maintainer directive (2026-07-17): the GUEST's checkpoint copy reclaims a slot like the
        // host's fresh launch - at most ONCE per persist so a mis-ranked account cannot cascade.
        let reclaimedForCheckpoint = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const marker = readCoopResumeMarker(controller.localName(), partner);
          const markerMatchesRun = marker?.runId === commitment.runId;
          const markerInspection = markerMatchesRun && marker?.slot != null ? await inspectSlot(marker.slot) : null;
          const markerIsCloudBackedExactRun = markerInspection != null && cloudBackedExactRunSlot(markerInspection);
          // A marker-local same-run row with a missing cloud parent is not authority. Scan for an
          // exact cloud-backed survivor elsewhere; if none exists, fail closed instead of ACKing an
          // orphan or manufacturing a fresh empty-slot lineage.
          const remainingInspections = markerIsCloudBackedExactRun
            ? []
            : await Promise.all(
                [0, 1, 2, 3, 4].filter(slot => slot !== (markerMatchesRun ? marker?.slot : undefined)).map(inspectSlot),
              );
          const allInspections =
            markerInspection == null ? remainingInspections : [markerInspection, ...remainingInspections];
          const cloudBackedSurvivor = allInspections
            .filter(cloudBackedExactRunSlot)
            .sort((left, right) =>
              left.kind === "occupied" && right.kind === "occupied"
                ? right.stored.commitment.checkpointRevision - left.stored.commitment.checkpointRevision
                : 0,
            )[0];
          const orphanedSameRunExists = allInspections.some(
            inspection => exactRunSlot(inspection) && !cloudBackedExactRunSlot(inspection),
          );
          const selected = markerIsCloudBackedExactRun
            ? markerInspection
            : (cloudBackedSurvivor
              ?? (orphanedSameRunExists
                ? null
                : ((markerInspection?.kind === "empty" ? markerInspection : null)
                  ?? remainingInspections.find(inspection => inspection.kind === "empty"))));
          if (
            (selected as ResumeSlotInspection | null)?.kind === "empty"
            && allInspections.some(inspection => inspection.kind === "occupied")
          ) {
            const summary = allInspections
              .map(inspection => {
                if (inspection.kind !== "occupied") {
                  return `${inspection.slot}:${inspection.kind}`;
                }
                return (
                  `${inspection.slot}:occupied`
                  + `:run=${inspection.stored.commitment.runId === commitment.runId}`
                  + `:seats=${coopSeatMapMatches(inspection.stored.session.coopParticipants, controller.localName(), partner, controller.role)}`
                  + `:cloud=${inspection.cloudCas?.mode ?? "none"}`
                  + `:cloudRun=${inspection.cloudCas?.mode === "existing" ? inspection.cloudCas.runId === commitment.runId : false}`
                );
              })
              .join(",");
            coopWarn("launch", `guest checkpoint selected empty slot=${selected.slot} inspections=[${summary}]`);
          }
          if (selected == null || !exactRuntimeIsCurrent()) {
            // Maintainer directive (2026-07-17, live report test4/Heraklines1): a guest whose five
            // slots are all occupied or unavailable must not NACK the launch checkpoint into a
            // shared terminal. Reclaim the least valuable slot ONCE - divergent/unreadable replicas
            // first (they are unresumable), then the OLDEST occupied save that is NOT this run's
            // slot - through the full cloud-safe delete, then re-run the same inspection.
            if (exactRuntimeIsCurrent() && !reclaimedForCheckpoint) {
              reclaimedForCheckpoint = true;
              const reclaim =
                allInspections.find(inspection => inspection.kind === "unavailable")
                ?? allInspections
                  .filter(
                    (inspection): inspection is Extract<ResumeSlotInspection, { kind: "occupied" }> =>
                      inspection.kind === "occupied" && !exactRunSlot(inspection),
                  )
                  .sort((a, b) => (a.stored.session.timestamp ?? 0) - (b.stored.session.timestamp ?? 0))[0];
              if (reclaim != null) {
                coopWarn(
                  "launch",
                  `guest checkpoint has no safe slot; reclaiming least-recent slot=${reclaim.slot} kind=${reclaim.kind}`,
                );
                if (await this.deleteSession(reclaim.slot)) {
                  continue;
                }
                coopWarn("launch", `guest checkpoint reclamation delete failed slot=${reclaim.slot}`);
              }
            }
            if (exactRuntimeIsCurrent()) {
              recordCoopResumeUnavailableEvidence(
                controller.localName(),
                partner,
                commitment.wave,
                commitment.runId,
                commitment.checkpointRevision,
                commitment.seats,
              );
            }
            return { success: false, reason: "no-safe-slot" } as const;
          }

          // Final local TOCTOU check after every digest/cloud await. No yield is permitted between
          // this comparison and the local write/decision below.
          const storageKey = this.sessionStorageKeyForAccount(selected.slot, accountIdentity);
          if (localStorage.getItem(storageKey) !== selected.localRaw) {
            coopWarn("launch", `guest resume slot=${selected.slot} mutated during validation; retry=${attempt}`);
            continue;
          }

          const persistIncomingReplica = async (): Promise<CoopResumeCheckpointPersistenceAck> => {
            let selectedHead =
              accountIdentity == null
                ? ({ kind: "absent" } as const)
                : this.readKnownCoopCloudHead(selected.slot, accountIdentity);
            if (selectedHead.kind === "invalid") {
              coopWarn("launch", `guest checkpoint ancestry invalid slot=${selected.slot}`);
              return { success: false, reason: "cloud-conflict" };
            }
            if (
              selectedHead.kind === "valid"
              && selectedHead.head.runId !== commitment.runId
              && accountIdentity != null
            ) {
              const displacedHead = selectedHead;
              const displacedStatus = await this.readCoopRunStatus({
                clientSessionId,
                coopRunId: displacedHead.head.runId,
                slot: selected.slot,
              });
              if (
                !exactRuntimeIsCurrent()
                || localStorage.getItem(storageKey) !== selected.localRaw
                || !this.coopCloudHeadStateMatches(
                  this.readKnownCoopCloudHead(selected.slot, accountIdentity),
                  displacedHead,
                )
                || !displacedStatus.ok
                || displacedStatus.value.state !== "tombstoned"
                || !recordCoopDeletedRun(accountIdentity, displacedHead.head.runId)
                || !this.clearKnownCoopCloudHead(selected.slot, accountIdentity, displacedHead.head.runId)
              ) {
                coopWarn("launch", `guest checkpoint displaced ancestry not tombstoned slot=${selected.slot}`);
                return { success: false, reason: "cloud-conflict" };
              }
              selectedHead = { kind: "absent" };
            }
            if (!bypassLogin && selected.cloudCas?.mode === "empty") {
              // Empty CAS is valid only for an initial cloud-mirrored checkpoint. Retire an exactly
              // tombstoned displaced lineage above first; a non-cloud cadence message still may not ACK
              // a physically empty/orphan slot as durable state.
              if (!mirrorCloud || accountIdentity == null || selectedHead.kind !== "absent") {
                coopWarn(
                  "launch",
                  `guest checkpoint empty ancestry rejected slot=${selected.slot} mirror=${mirrorCloud} head=${selectedHead.kind}`,
                );
                return { success: false, reason: "cloud-conflict" };
              }
              const incomingStatus = await this.readCoopRunStatus({
                clientSessionId,
                coopRunId: commitment.runId,
                slot: selected.slot,
              });
              if (
                !exactRuntimeIsCurrent()
                || localStorage.getItem(storageKey) !== selected.localRaw
                || !incomingStatus.ok
                || incomingStatus.value.state !== "missing"
              ) {
                coopWarn("launch", `guest checkpoint empty ancestry status changed slot=${selected.slot}`);
                return { success: false, reason: "cloud-conflict" };
              }
            }
            if (selected.cloudCas?.mode === "existing" && accountIdentity != null) {
              const observedCloudHead = {
                runId: selected.cloudCas.runId!,
                checkpointRevision: selected.cloudCas.checkpointRevision!,
                digest: selected.cloudCas.digest!,
              };
              if (
                observedCloudHead.runId !== commitment.runId
                || (selectedHead.kind === "valid"
                  && (selectedHead.head.runId !== observedCloudHead.runId
                    || selectedHead.head.checkpointRevision > observedCloudHead.checkpointRevision
                    || (selectedHead.head.checkpointRevision === observedCloudHead.checkpointRevision
                      && selectedHead.head.digest !== observedCloudHead.digest)))
              ) {
                coopWarn(
                  "launch",
                  `guest checkpoint observed ancestry mismatch slot=${selected.slot} observed=${observedCloudHead.checkpointRevision} known=${selectedHead.kind === "valid" ? selectedHead.head.checkpointRevision : "absent"}`,
                );
                return { success: false, reason: "cloud-conflict" };
              }
              if (
                (selectedHead.kind === "absent"
                  || selectedHead.head.checkpointRevision < observedCloudHead.checkpointRevision)
                && !this.recordKnownCoopCloudHead(selected.slot, accountIdentity, observedCloudHead, selectedHead)
              ) {
                coopWarn("launch", `guest checkpoint could not freeze observed ancestry slot=${selected.slot}`);
                return { success: false, reason: "cloud-conflict" };
              }
              selectedHead = this.readKnownCoopCloudHead(selected.slot, accountIdentity);
            }
            let localAlreadyExact = false;
            if (selected.localRaw != null) {
              try {
                localAlreadyExact = decrypt(selected.localRaw, bypassLogin) === sessionJson;
              } catch {
                return { success: false, reason: "slot-conflict" };
              }
            }

            const evidenceBefore = captureCoopResumeEvidence();
            let writtenRaw: string | null = null;
            if (!localAlreadyExact) {
              writtenRaw = encrypt(sessionJson, bypassLogin);
              if (!trySetLocalStorageItem(storageKey, writtenRaw)) {
                this.warnLocalStorageFull();
                recordCoopResumeUnavailableEvidence(
                  controller.localName(),
                  partner,
                  commitment.wave,
                  commitment.runId,
                  commitment.checkpointRevision,
                  commitment.seats,
                );
                return { success: false, reason: "storage-failed" };
              }
            }
            recordCoopResumeMarker(
              selected.slot,
              controller.localName(),
              partner,
              commitment.wave,
              commitment.runId,
              commitment.checkpointRevision,
            );
            const evidenceAfter = captureCoopResumeEvidence();
            if (!mirrorCloud) {
              return { success: true };
            }

            const cloud = await this.enqueueCoopResumeCloudMirror(
              selected.slot,
              sessionJson,
              selected.cloudCas,
              accountIdentity,
              runtime,
              controller,
              generation,
            );
            if (cloud.success || writtenRaw == null || !cloud.rollbackSafe) {
              if (!cloud.success && writtenRaw != null && !cloud.rollbackSafe) {
                coopWarn(
                  "launch",
                  `guest resume checkpoint cloud outcome is ambiguous slot=${selected.slot}; retaining local bytes for idempotent retry`,
                );
              }
              return cloud;
            }

            // The checkpoint ACK promises a coherent local+cloud transaction at cloud cadence. If
            // the conditional cloud write loses, put the exact prior local bytes and marker/evidence
            // back. Both halves are compare-and-swap guarded so a newer callback/tab is never
            // overwritten while this cloud request was awaiting the network.
            let localRestored = false;
            try {
              if (localStorage.getItem(storageKey) === writtenRaw) {
                if (selected.localRaw == null) {
                  localStorage.removeItem(storageKey);
                } else {
                  localStorage.setItem(storageKey, selected.localRaw);
                }
                localRestored = localStorage.getItem(storageKey) === selected.localRaw;
              }
            } catch (error) {
              coopWarn("launch", `guest resume checkpoint local rollback failed slot=${selected.slot}`, error);
            }
            const evidenceRestored =
              localRestored && restoreCoopResumeEvidenceIfUnchanged(evidenceAfter, evidenceBefore);
            if (!localRestored || !evidenceRestored) {
              coopWarn(
                "launch",
                `guest resume checkpoint rollback lost exact guard slot=${selected.slot} local=${localRestored} evidence=${evidenceRestored}`,
              );
            }
            return cloud;
          };

          if (selected.kind === "occupied") {
            const existing = selected.stored.commitment;
            if (existing.checkpointRevision > commitment.checkpointRevision) {
              if (
                selected.stored.sessionJson !== sessionJson
                && !trySetLocalStorageItem(storageKey, encrypt(selected.stored.sessionJson, bypassLogin))
              ) {
                return { success: false, reason: "storage-failed" } as const;
              }
              recordCoopResumeMarker(
                selected.slot,
                controller.localName(),
                partner,
                existing.wave,
                existing.runId,
                existing.checkpointRevision,
              );
              return { success: false, reason: "cloud-conflict" } as const;
            }
            if (existing.checkpointRevision === commitment.checkpointRevision) {
              if (existing.digest !== commitment.digest) {
                return { success: false, reason: "slot-conflict" } as const;
              }
              if (selected.stored.sessionJson !== sessionJson) {
                return { success: false, reason: "slot-conflict" } as const;
              }
              return persistIncomingReplica();
            }
          }

          return persistIncomingReplica();
        }
        return { success: false, reason: "slot-conflict" } as const;
      }, accountIdentity);
      return result ?? { success: false, reason: "slot-conflict" };
    };
    this.coopResumeCheckpointPersistence = {
      runtime,
      controller,
      generation,
      accountIdentity,
      persist,
    };
    controller.armResumeCheckpointHandler(persist);
  }

  /** Persist the exact cold-resume bytes before the guest reports scene application or crosses release. */
  public async persistCurrentCoopResumeCheckpoint(
    sessionJson: string,
    commitment: CoopResumeCommitment,
    mirrorCloud = true,
  ): Promise<CoopResumeCheckpointPersistenceAck> {
    const bound = this.coopResumeCheckpointPersistence;
    if (
      bound == null
      || getCoopRuntime() !== bound.runtime
      || bound.runtime.controller !== bound.controller
      || coopSessionGeneration() !== bound.generation
      || !this.persistenceAccountIsCurrent(bound.accountIdentity)
      || bound.controller.role !== "guest"
    ) {
      return { success: false, reason: "runtime-invalid" };
    }
    return bound.persist(sessionJson, commitment, mirrorCloud);
  }

  /**
   * Queue one guest-account cloud replica in the account-wide mutation order. The host sets
   * `mirrorCloud` only for its existing ~20-wave/~20-minute cadence; at those boundaries the guest ACK
   * waits for this CAS, so "persisted" means both guest local and guest cloud durability.
   */
  private enqueueCoopResumeCloudMirror(
    slot: number,
    sessionJson: string,
    cas: CoopResumeCloudCas | null,
    accountIdentity: string | null,
    runtime: NonNullable<ReturnType<typeof getCoopRuntime>>,
    controller: CoopSessionController,
    generation: number,
  ): Promise<{ success: true } | { success: false; reason: "cloud-failed" | "cloud-conflict"; rollbackSafe: boolean }> {
    if (bypassLogin) {
      return Promise.resolve({ success: true });
    }
    if (cas == null) {
      return Promise.resolve({ success: false, reason: "cloud-failed", rollbackSafe: false });
    }
    if (accountIdentity == null) {
      return Promise.resolve({ success: false, reason: "cloud-conflict", rollbackSafe: true });
    }
    const knownHead = this.readKnownCoopCloudHead(slot, accountIdentity);
    if (knownHead.kind === "invalid") {
      return Promise.resolve({ success: false, reason: "cloud-conflict", rollbackSafe: true });
    }
    if (
      cas.mode === "existing"
      && (knownHead.kind !== "valid"
        || knownHead.head.runId !== cas.runId
        || knownHead.head.checkpointRevision !== cas.checkpointRevision
        || knownHead.head.digest !== cas.digest)
    ) {
      return Promise.resolve({ success: false, reason: "cloud-conflict", rollbackSafe: true });
    }
    if (cas.mode === "empty" && knownHead.kind !== "absent") {
      return Promise.resolve({ success: false, reason: "cloud-conflict", rollbackSafe: true });
    }
    const contextIsCurrent = (): boolean =>
      this.persistenceAccountIsCurrent(accountIdentity)
      && getCoopRuntime() === runtime
      && runtime.controller === controller
      && coopSessionGeneration() === generation
      && controller.role === "guest";
    const request =
      cas.mode === "empty"
        ? {
            slot,
            trainerId: this.trainerId,
            secretId: this.secretId,
            clientSessionId,
            coopCasMode: "empty" as const,
          }
        : {
            slot,
            trainerId: this.trainerId,
            secretId: this.secretId,
            clientSessionId,
            coopCasMode: "existing" as const,
            coopCasRunId: cas.runId!,
            coopCasCheckpointRevision: cas.checkpointRevision!,
            coopCasDigest: cas.digest!,
          };
    return enqueueSessionCloudMutation(accountIdentity, async () => {
      if (!contextIsCurrent()) {
        coopWarn("launch", "guest resume checkpoint cloud mirror skipped: runtime/account changed in queue");
        return { success: false, reason: "cloud-conflict", rollbackSafe: true } as const;
      }
      const storageKey = this.sessionStorageKeyForAccount(slot, accountIdentity);
      const local = localStorage.getItem(storageKey);
      try {
        if (local == null || decrypt(local, bypassLogin) !== sessionJson) {
          coopWarn("launch", "guest resume checkpoint cloud mirror skipped: local slot now holds newer/other bytes");
          return { success: false, reason: "cloud-conflict", rollbackSafe: true } as const;
        }
      } catch {
        coopWarn("launch", "guest resume checkpoint cloud mirror skipped: local slot could not be revalidated");
        return { success: false, reason: "cloud-conflict", rollbackSafe: true } as const;
      }
      const incoming = await deriveCoopResumeCommitment(sessionJson, JSON.parse(sessionJson) as SessionSaveData);
      if (incoming == null || !contextIsCurrent()) {
        return { success: false, reason: "cloud-conflict", rollbackSafe: true } as const;
      }
      if (cas.mode === "empty") {
        const status = await this.readCoopRunStatus({
          clientSessionId,
          coopRunId: incoming.runId,
          slot,
        });
        if (!contextIsCurrent() || !status.ok || status.value.state !== "missing") {
          return { success: false, reason: "cloud-conflict", rollbackSafe: true } as const;
        }
      }
      const mutation = await this.updateCoopCasBounded(request, sessionJson);
      if (!contextIsCurrent()) {
        return { success: false, reason: "cloud-conflict", rollbackSafe: false } as const;
      }
      if (!mutation.ok) {
        coopWarn("launch", `guest resume checkpoint cloud mirror deferred: ${mutation.error}`);
        // A transport failure may have happened after the Worker committed. Resolve that ambiguity
        // before rolling local state backward: an exact read-back makes the request successful and
        // idempotent; a definitive different/empty row makes rollback safe; an unavailable read-back
        // retains local bytes so the durable outbox can retry without destroying the only N copy.
        const observed = await this.readCoopCas(slot);
        if (!contextIsCurrent()) {
          return { success: false, reason: "cloud-conflict", rollbackSafe: false } as const;
        }
        if (!observed.ok || observed.rawSavedata !== sessionJson) {
          const serverRejectedBeforeWrite = mutation.failureKind !== "transient";
          const definitiveReadback = observed.ok || observed.failureKind === "missing";
          return {
            success: false,
            reason: serverRejectedBeforeWrite ? "cloud-conflict" : "cloud-failed",
            rollbackSafe: serverRejectedBeforeWrite || definitiveReadback,
          } as const;
        }
      }
      const localAfterCloud = localStorage.getItem(storageKey);
      try {
        if (localAfterCloud == null || decrypt(localAfterCloud, bypassLogin) !== sessionJson) {
          coopWarn("launch", "guest resume checkpoint changed locally before cloud completion ACK");
          return { success: false, reason: "cloud-conflict", rollbackSafe: true } as const;
        }
      } catch {
        return { success: false, reason: "cloud-conflict", rollbackSafe: true } as const;
      }
      if (!contextIsCurrent()) {
        return { success: false, reason: "cloud-conflict", rollbackSafe: false } as const;
      }
      if (!contextIsCurrent() || !this.recordKnownCoopCloudHead(slot, accountIdentity, incoming, knownHead)) {
        return { success: false, reason: "cloud-conflict", rollbackSafe: false } as const;
      }
      return { success: true } as const;
    }).catch(error => {
      coopWarn("launch", "guest resume checkpoint cloud mirror failed", error);
      return { success: false, reason: "cloud-failed", rollbackSafe: false } as const;
    });
  }

  private async assessImportOverLocalSession(
    slot: number,
    localRaw: string | null,
    incomingJson: string,
    incomingSession: SessionSaveData | null,
    accountIdentity: string | null,
  ): Promise<CoopImportDisposition | null> {
    if (localRaw == null) {
      return this.persistenceAccountIsCurrent(accountIdentity) ? { kind: "ordinary" } : null;
    }
    let existingJson: string;
    try {
      existingJson = decrypt(localRaw, bypassLogin);
    } catch {
      return null;
    }
    const protection = classifySessionProtection(existingJson);
    if (protection === "solo") {
      return this.persistenceAccountIsCurrent(accountIdentity) ? { kind: "ordinary" } : null;
    }
    if (protection !== "coop-valid") {
      // Invalid co-op discriminators and opaque bytes are protected migration debt. They must
      // pass through the explicit exact-delete path before an import may replace the slot.
      return null;
    }
    let existingSession: SessionSaveData;
    try {
      existingSession = this.parseSessionData(existingJson);
    } catch {
      return null;
    }
    const existing = await deriveCoopResumeCommitment(existingJson, existingSession);
    if (!this.persistenceAccountIsCurrent(accountIdentity)) {
      return null;
    }
    if (existing == null) {
      return null;
    }
    const incoming = incomingSession == null ? null : await deriveCoopResumeCommitment(incomingJson, incomingSession);
    if (!this.persistenceAccountIsCurrent(accountIdentity)) {
      return null;
    }
    if (incoming == null) {
      return null;
    }
    if (accountIdentity == null) {
      return incoming.runId === existing.runId
        && this.sameCoopReplicaLineage(incoming, existing)
        && (incoming.checkpointRevision > existing.checkpointRevision
          || (incoming.checkpointRevision === existing.checkpointRevision && incoming.digest === existing.digest))
        ? { kind: "same-run" }
        : null;
    }
    const status = await this.readCoopRunStatus({
      clientSessionId,
      coopRunId: existing.runId,
      slot,
    });
    if (incoming.runId === existing.runId) {
      return this.persistenceAccountIsCurrent(accountIdentity)
        && status.ok
        && status.value.state === "active"
        && status.value.slot === slot
        && this.sameCoopReplicaLineage(incoming, existing)
        && (incoming.checkpointRevision > existing.checkpointRevision
          || (incoming.checkpointRevision === existing.checkpointRevision && incoming.digest === existing.digest))
        ? { kind: "same-run" }
        : null;
    }
    const tombstoned =
      this.persistenceAccountIsCurrent(accountIdentity)
      && status.ok
      && status.value.state === "tombstoned"
      && status.value.runId === existing.runId;
    if (!tombstoned) {
      return null;
    }
    const expectedHead = this.readKnownCoopCloudHead(slot, accountIdentity);
    return expectedHead.kind === "valid"
      && expectedHead.head.runId === existing.runId
      && expectedHead.head.checkpointRevision === existing.checkpointRevision
      && expectedHead.head.digest === existing.digest
      ? { kind: "replace-tombstoned", prior: existing, expectedHead, expectedLocalRaw: localRaw }
      : null;
  }

  /** Write from the last locally frozen cloud parent; never adopt a freshly observed competing head. */
  private async updateCoopCloudCas(
    slot: number,
    sessionJson: string,
    sessionData: SessionSaveData,
    importDisposition?: CoopImportDisposition,
  ): Promise<CoopCloudCasClientResult> {
    const accountIdentity = this.currentPersistenceAccount();
    const failure = (
      error: string,
      failureKind: Exclude<CoopCloudCasClientResult, { ok: true }>["failureKind"] = "invalid",
      options: { continuationSafe?: boolean; rollbackSafe?: boolean } = {},
    ): CoopCloudCasClientResult => ({
      ok: false,
      error,
      failureKind,
      continuationSafe: options.continuationSafe === true,
      rollbackSafe: options.rollbackSafe === true,
    });
    if (accountIdentity == null || !this.persistenceAccountIsCurrent(accountIdentity)) {
      return failure("Co-op cloud CAS account changed.", "unauthorized");
    }
    const accountIsCurrent = (): boolean => this.persistenceAccountIsCurrent(accountIdentity);
    const incoming = await deriveCoopResumeCommitment(sessionJson, sessionData);
    if (
      incoming == null
      || !accountIsCurrent()
      || accountIdentity == null
      || !incoming.participants.some(participant => sameCoopIdentity(participant, accountIdentity))
    ) {
      return failure("Co-op cloud CAS incoming checkpoint is invalid.");
    }
    const known = this.readKnownCoopCloudHead(slot, accountIdentity);
    if (known.kind === "invalid") {
      return failure("Co-op cloud ancestry head is malformed.", "conflict");
    }
    const emptyImport = importDisposition?.kind === "ordinary" || importDisposition?.kind === "replace-tombstoned";
    if (known.kind === "absent" && !emptyImport) {
      return failure("Co-op cloud ancestry is not established; reconnect through resume discovery.", "conflict");
    }
    if (
      known.kind === "valid"
      && known.head.runId !== incoming.runId
      && importDisposition?.kind !== "replace-tombstoned"
    ) {
      return failure("Co-op cloud ancestry belongs to another run.", "conflict");
    }
    if (
      importDisposition?.kind === "replace-tombstoned"
      && !this.coopCloudHeadStateMatches(known, importDisposition.expectedHead)
    ) {
      return failure("Tombstoned import ancestry changed before replacement.", "conflict");
    }
    if (emptyImport) {
      const observed = await this.readCoopCas(slot);
      if (!accountIsCurrent()) {
        return failure("Co-op cloud CAS account changed.", "unauthorized");
      }
      if (observed.ok || observed.failureKind !== "missing") {
        return failure("Import expected an empty cloud slot.", "conflict");
      }
      const incomingStatus = await this.readCoopRunStatus({
        clientSessionId,
        coopRunId: incoming.runId,
        slot,
      });
      if (!accountIsCurrent() || !incomingStatus.ok || incomingStatus.value.state !== "missing") {
        return failure("Import run identity is not account-wide missing.", "conflict");
      }
      if (
        importDisposition?.kind === "replace-tombstoned"
        && (await this.withCoopResumePersistenceLease(async () => {
          const storageKey = this.sessionStorageKeyForAccount(slot, accountIdentity);
          return (
            localStorage.getItem(storageKey) === importDisposition.expectedLocalRaw
            && this.coopCloudHeadStateMatches(
              this.readKnownCoopCloudHead(slot, accountIdentity),
              importDisposition.expectedHead,
            )
            && recordCoopDeletedRun(accountIdentity, importDisposition.prior.runId)
          );
        }, accountIdentity)) !== true
      ) {
        return failure("Tombstoned import lineage could not be recorded.", "conflict");
      }
    }
    const request = emptyImport
      ? {
          slot,
          trainerId: this.trainerId,
          secretId: this.secretId,
          clientSessionId,
          coopCasMode: "empty" as const,
        }
      : {
          slot,
          trainerId: this.trainerId,
          secretId: this.secretId,
          clientSessionId,
          coopCasMode: "existing" as const,
          coopCasRunId: known.kind === "valid" ? known.head.runId : "",
          coopCasCheckpointRevision: known.kind === "valid" ? known.head.checkpointRevision : -1,
          coopCasDigest: known.kind === "valid" ? known.head.digest : "",
        };
    const mutation = await this.updateCoopCasBounded(request, sessionJson);
    if (!accountIsCurrent()) {
      return failure("Co-op cloud CAS account changed.", "unauthorized");
    }
    if (!mutation.ok) {
      // A lost response has exactly two non-terminal resolutions. Exact incoming bytes prove the
      // write committed. Otherwise only the exact frozen parent, corroborated account-wide as the
      // unique active row, proves a transport failure happened before the write. Missing, malformed,
      // tombstoned, moved/duplicate, third, or newer state is divergence and must terminate rather
      // than being mislabeled as local mirrored debt.
      const readback = await this.readCoopCas(slot);
      if (!accountIsCurrent()) {
        return failure("Co-op cloud CAS account changed during readback.", "unauthorized");
      }
      if (readback.ok && readback.rawSavedata === sessionJson) {
        // Continue below and advance the locally frozen head to the exact committed bytes.
      } else if (readback.ok && known.kind === "valid") {
        const observedParent = await this.classifyCoopReplica(slot, readback.rawSavedata);
        const exactKnownParent =
          observedParent.commitment != null
          && observedParent.commitment.runId === known.head.runId
          && observedParent.commitment.checkpointRevision === known.head.checkpointRevision
          && observedParent.commitment.digest === known.head.digest;
        if (exactKnownParent) {
          const status = await this.readCoopRunStatus({
            clientSessionId,
            coopRunId: known.head.runId,
            slot,
          });
          const exactUniqueParent =
            accountIsCurrent()
            && status.ok
            && status.value.state === "active"
            && status.value.slot === slot
            && status.value.checkpointRevision === known.head.checkpointRevision
            && status.value.digest === known.head.digest;
          if (exactUniqueParent) {
            return mutation.failureKind === "transient"
              ? failure(mutation.error, "transient", { continuationSafe: true, rollbackSafe: true })
              : failure(mutation.error, mutation.failureKind, { rollbackSafe: true });
          }
          if (!status.ok && status.failureKind === "transient" && mutation.failureKind === "transient") {
            return failure(mutation.error, "transient");
          }
        }
        return failure("Co-op cloud CAS readback no longer proves the exact unique parent.", "conflict");
      } else if (!readback.ok && readback.failureKind === "transient" && mutation.failureKind === "transient") {
        return failure(mutation.error, "transient");
      } else {
        return failure("Co-op cloud CAS readback diverged from both the request and its exact parent.", "conflict");
      }
    }
    if (!this.recordKnownCoopCloudHead(slot, accountIdentity, incoming, known)) {
      return failure("Co-op cloud committed but the local ancestry head could not advance.", "conflict");
    }
    return { ok: true, error: "", failureKind: null };
  }

  /** Delete a co-op checkpoint with exact run/revision/digest and create its server tombstone. */
  private async deleteCoopCloudCas(
    slot: number,
    raw: string,
    sessionData: SessionSaveData,
    accountIdentity: string,
  ): Promise<string | null> {
    const accountIsCurrent = (): boolean => this.persistenceAccountIsCurrent(accountIdentity);
    const commitment = await deriveCoopResumeCommitment(raw, sessionData);
    if (commitment == null || !accountIsCurrent()) {
      return "Co-op delete checkpoint is invalid or the account changed.";
    }
    const mutation = await this.deleteCoopCasBounded({
      slot,
      clientSessionId,
      coopCasRunId: commitment.runId,
      coopCasCheckpointRevision: commitment.checkpointRevision,
      coopCasDigest: commitment.digest,
    });
    if (!accountIsCurrent()) {
      return "Co-op delete account changed.";
    }
    const status = accountIsCurrent()
      ? await this.readCoopRunStatus({
          clientSessionId,
          coopRunId: commitment.runId,
          slot,
        })
      : null;
    if (!accountIsCurrent()) {
      return "Co-op delete account changed.";
    }
    if (
      status?.ok === true
      && status.value.state === "tombstoned"
      && status.value.slot === slot
      && status.value.checkpointRevision === commitment.checkpointRevision
      && status.value.digest === commitment.digest
    ) {
      return null;
    }
    if (!mutation.ok) {
      return mutation.error;
    }
    return status?.ok === false ? status.error : "Co-op delete did not produce an exact tombstone proof.";
  }

  private async classifySessionJsonForExactDelete(json: string): Promise<{
    kind: "valid-coop" | "legacy-coop" | "solo" | "opaque";
    session: SessionSaveData | null;
    commitment: CoopResumeCommitment | null;
  }> {
    const protection = classifySessionProtection(json);
    if (protection === "unknown") {
      return { kind: "opaque", session: null, commitment: null };
    }
    if (protection === "solo") {
      return { kind: "solo", session: null, commitment: null };
    }
    if (protection === "coop-invalid") {
      return { kind: "legacy-coop", session: null, commitment: null };
    }
    try {
      const session = this.parseSessionData(json);
      const commitment = await deriveCoopResumeCommitment(json, session);
      return commitment == null
        ? { kind: "legacy-coop", session, commitment: null }
        : { kind: "valid-coop", session, commitment };
    } catch {
      return { kind: "legacy-coop", session: null, commitment: null };
    }
  }

  private async deleteSessionCloudSafely(
    slot: number,
    localRaw: string | null,
    accountIdentity: string,
  ): Promise<{ error: string | null; deletedCoopRunId?: string }> {
    if (!this.persistenceAccountIsCurrent(accountIdentity)) {
      return { error: "Delete account changed before cloud inspection." };
    }
    let localJson: string | null = null;
    let localCommitment: CoopResumeCommitment | null = null;
    let localKind: "empty" | "valid-coop" | "solo" | "legacy-coop" | "opaque" = localRaw == null ? "empty" : "opaque";
    if (localRaw != null) {
      try {
        localJson = decrypt(localRaw, bypassLogin);
        const classified = await this.classifySessionJsonForExactDelete(localJson);
        localCommitment = classified.commitment;
        localKind = classified.kind;
      } catch {
        localKind = "opaque";
      }
    }
    if (!this.persistenceAccountIsCurrent(accountIdentity)) {
      return { error: "Delete account changed while local checkpoint was classified." };
    }
    const observedRead = await this.readCoopCas(slot);
    if (!this.persistenceAccountIsCurrent(accountIdentity)) {
      return { error: "Delete account changed during cloud inspection." };
    }
    if (!observedRead.ok && observedRead.failureKind === "missing") {
      if (localCommitment == null) {
        return { error: null };
      }
      const status = await this.readCoopRunStatus({
        clientSessionId,
        coopRunId: localCommitment.runId,
        slot,
      });
      if (!this.persistenceAccountIsCurrent(accountIdentity)) {
        return { error: "Delete account changed during tombstone verification." };
      }
      if (status.ok && status.value.state === "tombstoned" && status.value.slot === slot) {
        return { error: null, deletedCoopRunId: localCommitment.runId };
      }
      return {
        error: status.ok ? "Protected local co-op checkpoint has no exact backend tombstone." : status.error,
      };
    }
    if (!observedRead.ok) {
      return { error: `Could not read the checkpoint before delete (${observedRead.failureKind}).` };
    }
    const observed = observedRead.rawSavedata;
    const classifiedCloud = await this.classifySessionJsonForExactDelete(observed);
    const cloudSession = classifiedCloud.session;
    const cloudCommitment = classifiedCloud.commitment;
    const cloudKind = classifiedCloud.kind;
    if (!this.persistenceAccountIsCurrent(accountIdentity)) {
      return { error: "Delete account changed while cloud checkpoint was classified." };
    }
    if (localCommitment != null) {
      if (cloudCommitment == null || cloudCommitment.runId !== localCommitment.runId) {
        return { error: "Local/cloud checkpoint conflict must be reconciled before delete." };
      }
    } else if (localRaw != null && localJson !== observed) {
      return { error: "Local/cloud checkpoint bytes differ; refusing ambiguous delete." };
    }
    if (cloudCommitment != null && cloudSession != null) {
      const error = await this.deleteCoopCloudCas(slot, observed, cloudSession, accountIdentity);
      return error == null ? { error: null, deletedCoopRunId: cloudCommitment.runId } : { error };
    }
    if (cloudKind === "legacy-coop") {
      const exactDigest = await digestCoopResumeSession(observed);
      const mutation = await this.deleteLegacyCoopExactBounded({
        slot,
        clientSessionId,
        exactDigest,
      });
      return mutation.ok ? { error: null } : { error: mutation.error };
    }
    if (cloudKind === "opaque") {
      const exactDigest = await digestCoopResumeSession(observed);
      const mutation = await this.deleteOpaqueExactBounded({ slot, clientSessionId, exactDigest });
      return mutation.ok ? { error: null } : { error: mutation.error };
    }
    if (localKind === "legacy-coop" || localKind === "opaque") {
      return { error: "Local/cloud checkpoint classification conflict must be resolved before delete." };
    }
    return { error: await this.deleteSessionBounded({ slot, clientSessionId }) };
  }

  // TODO: This needs a giant refactor and overhaul
  private async initSessionFromData(fromSession: SessionSaveData, continuationGuard?: () => boolean): Promise<void> {
    if (continuationGuard?.() === false) {
      throw new Error("session materialization invalidated before mutation");
    }
    if (
      (fromSession.gameMode as number) === GameModes.COOP
      && !isCoopControlPlaneSaveData(fromSession.coopControlPlane)
    ) {
      throw new Error("session materialization refused a missing/invalid co-op control plane");
    }
    if (isBeta || isDev) {
      try {
        console.debug(
          this.parseSessionData(JSON.stringify(fromSession, (_, v: any) => (typeof v === "bigint" ? v.toString() : v))),
        );
      } catch (err) {
        console.debug("Attempt to log session data failed: ", err);
      }
    }

    // Stage every asynchronous asset load before mutating shared run state. A co-op runtime can be
    // replaced while these promises yield; detached Pokemon are safe to destroy, whereas the old
    // order had already replaced gameMode/seed/party/arena/battle before learning the lease was stale.
    const stagedPlayers = fromSession.party.map(data => {
      const pokemon = data.toPokemon() as PlayerPokemon;
      pokemon.setVisible(false);
      return pokemon;
    });
    const stagedEnemies = fromSession.enemyParty.map(
      (data, index) =>
        data.toPokemon(
          fromSession.battleType,
          index,
          fromSession.trainer?.variant === TrainerVariant.DOUBLE,
        ) as EnemyPokemon,
    );
    const stagedPokemon = [...stagedPlayers, ...stagedEnemies];
    const destroyStagedPokemon = (): void => {
      for (const pokemon of stagedPokemon) {
        pokemon.destroy();
      }
    };
    try {
      await Promise.all([
        ...stagedPlayers.map(pokemon => pokemon.loadAssets(false)),
        ...stagedEnemies.map(pokemon => pokemon.loadAssets()),
      ]);
    } catch (error) {
      destroyStagedPokemon();
      throw error;
    }
    if (continuationGuard?.() === false) {
      destroyStagedPokemon();
      throw new Error("session materialization invalidated while assets loaded");
    }
    if ((fromSession.gameMode as number) === GameModes.COOP) {
      const coopRun = fromSession.coopRun;
      const controller = getCoopRuntime()?.controller;
      if (
        controller == null
        || coopRun?.version !== 1
        || !controller.restoreCheckpointIdentity(coopRun.runId, coopRun.checkpointRevision, "session-materialized")
      ) {
        destroyStagedPokemon();
        throw new Error("session materialization refused an invalid/stale co-op run identity");
      }
      if (!applyCoopControlPlaneSaveData(fromSession.coopControlPlane)) {
        destroyStagedPokemon();
        throw new Error("session materialization failed to restore the co-op control plane");
      }
    }

    globalScene.gameMode = getGameMode(fromSession.gameMode || GameModes.CLASSIC);
    if (fromSession.challenges) {
      globalScene.gameMode.challenges = fromSession.challenges.map(c => c.toChallenge());
    }

    // ER: restore the run difficulty (drives the ER trainer roster tier). Legacy
    // saves predate this field — default to "ace" (vanilla trainers). Restore the
    // per-run "already encountered" ER trainer set from the save so a continued
    // run keeps its no-repeat history (older saves have no keys → fresh pool).
    setErDifficulty(fromSession.erDifficulty ?? "ace");
    restoreErRunTrainerTracking(fromSession.erUsedTrainerKeys);
    restoreErMoneyStreaks(fromSession.erMoneyStreaks);
    // ER achievement-expansion catalog-v2 (#900): restore run-local achievement state so a
    // mid-run reload keeps an in-progress feat (bargain flags, black-market credit, etc.).
    restoreErAchievementRunState(fromSession.erAchievementRunState);
    // ER: restore in-progress per-battle relic counters so a reload mid-battle
    // doesn't re-fire Cursed Idol / Pharaoh's Ankh (older saves -> empty/re-arm).
    restoreErRelicBattleState(fromSession.erRelicBattleState);
    // ER (#486): restore the run's Map state (revealed nodes / travel target /
    // fragments). Tolerant of older saves with no field (clean, empty map).
    restoreErMapState(fromSession.erMapState, fromSession.waveIndex);

    // ER Community Challenge: restore the founder qualifying-run linkage so a reload
    // still auto-publishes the draft on the eventual win (null for non-founder saves).
    setFounderRunState(fromSession.founderChallenge ?? null);
    // ER Community Challenge: restore the allowed-species whitelist so the catch gate
    // keeps working after a mid-run reload (null/absent for non-community saves).
    setCommunityAllowedSpecies(fromSession.communityAllowedSpecies ?? null);
    globalScene.setSeed(fromSession.seed || globalScene.game.config.seed[0]);
    globalScene.resetSeed();

    console.log("Seed:", globalScene.seed);

    globalScene.gameMode.trySetCustomDailyConfig(JSON.stringify(fromSession.dailyConfig));

    globalScene.sessionPlayTime = fromSession.playTime || 0;
    globalScene.lastSavePlayTime = 0;

    const party = globalScene.getPlayerParty();
    party.splice(0, party.length);
    party.push(...stagedPlayers);

    // Co-op (#633, P5 resume): a saved co-op run re-establishes the local session
    // (host + spoofed partner) on load, so the in-battle co-op behaviors - command
    // routing to your own slot, switch ownership - work again. The per-mon coopOwner
    // tags were restored from the save above (PokemonData). For any non-co-op load,
    // tear down a stale co-op session left over from a prior run. (P6's real
    // transport reconnects the actual partner at this seam instead of a spoof.)
    //
    // #633 M4: guard the spoof-establish so it NEVER clobbers a LIVE runtime. A co-op GUEST
    // booting from the host's launch snapshot (applyCoopLaunchSession) already has a real
    // transport-connected runtime; startLocalCoopSession would clearCoopRuntime + spoof a
    // partner, severing the live peer. Only (re)establish when there is no active session
    // (the from-title resume path); the live launch keeps its real runtime untouched.
    if (globalScene.gameMode.isShowdown) {
      // Showdown 1v1 (D0): the versus GUEST boots from the host's launch snapshot over the LIVE
      // versus transport. Showdown never resumes/spoofs (it is a friendly, non-persisted match), and
      // the live runtime MUST be preserved here - clearing it (the non-co-op branch below) would sever
      // the peer mid-launch and strip the enemy-command relay. Leave the active runtime untouched.
    } else if (globalScene.gameMode.isCoop) {
      if (getCoopRuntime() == null) {
        startLocalCoopSession();
      } else {
        // #861: adopting a launch/resume session onto a LIVE runtime (the guest boots from the host's
        // snapshot; a from-title resume re-applies the save). Interaction seqs reset per session/epoch, so
        // any relay/rendezvous message BUFFERED from the prior epoch sits at a seq this new epoch reuses -
        // and a plain FIFO buffer-hit would satisfy the new await with the STALE pick (the reward-shop P0).
        // Drop the buffered arrivals so only THIS epoch's genuine picks can resolve an await; the live
        // runtime (transport, listeners) is otherwise untouched.
        purgeCoopBufferedArrivals("applyCoopLaunchSession (resume/launch adopt)");
      }
    } else {
      clearCoopRuntime();
    }

    Object.keys(globalScene.pokeballCounts).forEach((key: string) => {
      globalScene.pokeballCounts[key] = fromSession.pokeballCounts[key] || 0;
    });
    if (Overrides.POKEBALL_OVERRIDE.active) {
      globalScene.pokeballCounts = Overrides.POKEBALL_OVERRIDE.pokeballs;
    }

    globalScene.money = Math.floor(fromSession.money || 0);
    globalScene.updateMoneyText();

    if (globalScene.money > this.gameStats.highestMoney) {
      this.gameStats.highestMoney = globalScene.money;
    }

    globalScene.score = fromSession.score;
    globalScene.updateScoreText();

    globalScene.mysteryEncounterSaveData = new MysteryEncounterSaveData(fromSession.mysteryEncounterSaveData);

    // ER (#504 fix): pass `restoring=true` so newArena does NOT re-roll the biome
    // length / reset the start wave to 1. The biome structure (length + start wave)
    // was already restored from the save by restoreErMapState() above; re-rolling
    // here would clobber the start wave to 1 and pin biome notoriety to its max for
    // the rest of the run (enemies stuck +25 levels above the global curve).
    globalScene.newArena(fromSession.arena.biome, fromSession.playerFaints, true);

    const battle = globalScene.newBattle(fromSession);
    const { battleType } = battle;
    battle.enemyLevels = fromSession.enemyParty.map(p => p.level);

    globalScene.arena.init();

    stagedEnemies.forEach((enemyPokemon, e) => {
      battle.enemyParty[e] = enemyPokemon;
      if (battleType === BattleType.WILD) {
        battle.seenEnemyPartyMemberIds.add(enemyPokemon.id);
      }
    });

    globalScene.arena.weather = fromSession.arena.weather;
    globalScene.arena.eventTarget.dispatchEvent(
      new WeatherChangedEvent(
        WeatherType.NONE,
        globalScene.arena.weather?.weatherType!,
        globalScene.arena.weather?.turnsLeft!,
        globalScene.arena.weather?.maxDuration!,
      ),
    ); // TODO: is this bang correct?

    globalScene.arena.terrain = fromSession.arena.terrain;
    globalScene.arena.eventTarget.dispatchEvent(
      new TerrainChangedEvent(
        TerrainType.NONE,
        globalScene.arena.terrain?.terrainType!,
        globalScene.arena.terrain?.turnsLeft!,
        globalScene.arena.terrain?.maxDuration!,
      ),
    ); // TODO: is this bang correct?

    globalScene.arena.playerTerasUsed = fromSession.arena.playerTerasUsed;

    globalScene.arena.tags = fromSession.arena.tags;
    if (globalScene.arena.tags) {
      for (const tag of globalScene.arena.tags) {
        if (tag instanceof EntryHazardTag) {
          const { tagType, side, turnCount, maxDuration, layers, maxLayers } = tag as EntryHazardTag;
          globalScene.arena.eventTarget.dispatchEvent(
            new TagAddedEvent(tagType, side, turnCount, maxDuration, layers, maxLayers),
          );
        } else {
          globalScene.arena.eventTarget.dispatchEvent(
            new TagAddedEvent(tag.tagType, tag.side, tag.turnCount, tag.maxDuration),
          );
        }
      }
    }

    globalScene.arena.positionalTagManager.tags = fromSession.arena.positionalTags.map(tag => loadPositionalTag(tag));

    if (globalScene.modifiers.length > 0) {
      console.warn("Existing modifiers not cleared on session load, deleting...");
      globalScene.modifiers = [];
    }
    for (const modifierData of fromSession.modifiers) {
      const modifier = modifierData.toModifier(
        Modifier[modifierData.className] ?? resolveErModifierClass(modifierData.className),
      );
      if (modifier) {
        globalScene.addModifier(modifier, true);
      }
    }
    globalScene.updateModifiers(true);

    // ER (#357): re-attach the player's resist berries — their runtime
    // modifier type isn't in the vanilla registry, so the loop above dropped
    // them; the session's side-channel field restores them.
    restoreErResistBerries(fromSession.erResistBerries);
    // ER (#358): same for Ward Stones (incl. charges / recharge progress).
    restoreErWardStones(fromSession.erWardStones);

    for (const enemyModifierData of fromSession.enemyModifiers) {
      const modifier = enemyModifierData.toModifier(
        Modifier[enemyModifierData.className] ?? resolveErModifierClass(enemyModifierData.className),
      );
      if (modifier) {
        globalScene.addEnemyModifier(modifier, true);
      }
    }

    globalScene.updateModifiers(false);

    if (continuationGuard?.() === false) {
      throw new Error("session materialization invalidated after synchronous commit");
    }
  }

  /**
   * Delete the session data at the given slot when overwriting a save file
   * For deleting the session of a finished run, use {@linkcode tryClearSession}
   * @param slotId - The slot to clear
   * @param prepareOverwrite - Whether the next same-slot session save must bypass cloud cadence once
   * @returns A Promise that resolves with whether the session deletion succeeded
   */
  async deleteSession(slotId: number, prepareOverwrite = false): Promise<boolean> {
    const accountIdentity = this.currentPersistenceAccount();
    const localKey = this.sessionStorageKeyForAccount(slotId, accountIdentity);
    if (bypassLogin) {
      localStorage.removeItem(localKey);
      return true;
    }
    if (accountIdentity == null) {
      return false;
    }
    const localBeforeCloud = localStorage.getItem(localKey);
    const lineageHeadBeforeCloud = this.readKnownCoopCloudHead(slotId, accountIdentity);
    let protectedLocalCoop = localBeforeCloud != null;
    try {
      protectedLocalCoop =
        localBeforeCloud != null && classifySessionProtection(decrypt(localBeforeCloud, bypassLogin)) !== "solo";
    } catch {
      protectedLocalCoop = localBeforeCloud != null;
    }
    if (protectedLocalCoop && lineageHeadBeforeCloud.kind === "invalid") {
      return false;
    }

    const [success] = await updateUserInfo();
    if (!success || !this.persistenceAccountIsCurrent(accountIdentity)) {
      return false;
    }

    const deletion = await enqueueSessionCloudMutation(accountIdentity, () =>
      this.persistenceAccountIsCurrent(accountIdentity)
        ? this.deleteSessionCloudSafely(slotId, localBeforeCloud, accountIdentity)
        : Promise.resolve({ error: "Delete account changed while queued." }),
    );
    const error = deletion.error;
    if (!error) {
      const deletedCoopRunId = deletion.deletedCoopRunId;
      const retireLocalReplica = async (): Promise<boolean> => {
        if (
          localStorage.getItem(localKey) !== localBeforeCloud
          || !this.coopCloudHeadStateMatches(
            this.readKnownCoopCloudHead(slotId, accountIdentity),
            lineageHeadBeforeCloud,
          )
        ) {
          return false;
        }
        if (
          deletedCoopRunId != null
          && (!recordCoopDeletedRun(accountIdentity, deletedCoopRunId)
            || !this.clearKnownCoopCloudHead(slotId, accountIdentity, deletedCoopRunId))
        ) {
          return false;
        }
        localStorage.removeItem(localKey);
        return localStorage.getItem(localKey) == null;
      };
      const localDeleted = await (!protectedLocalCoop && deletedCoopRunId == null
        ? this.withSessionPersistenceLease(retireLocalReplica, false, accountIdentity)
        : this.withCommittedCoopDeletePersistenceLease(retireLocalReplica, accountIdentity));
      if (localDeleted !== true) {
        return false;
      }
      if (!this.persistenceAccountIsCurrent(accountIdentity) || loggedInUser == null) {
        return false;
      }
      loggedInUser.lastSessionSlot = -1;
      if (prepareOverwrite) {
        this.pendingOverwriteCloudSync = { slot: slotId, accountIdentity };
      }
      return true;
    }
    if (error.startsWith("session out of date")) {
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.phaseManager.unshiftNew("ReloadSessionPhase");
    }
    console.error(error);
    return false;
  }

  /**
   * Clear a daily run on an offline game, adding it to a locally-stored cache of cleared seeds.
   */
  // TODO: Explain what this boolean return is supposed to signify inside game-over-phase.ts
  async offlineNewClear(): Promise<boolean> {
    const sessionData = this.getSessionSaveData();
    const { seed, gameMode } = sessionData;
    if (gameMode !== GameModes.DAILY) {
      return true;
    }

    const prevDailies = localStorage.getItem("daily");
    if (!prevDailies) {
      localStorage.setItem("daily", btoa(JSON.stringify([seed])));
      return true;
    }
    const clearedDailies = JSON.parse(atob(prevDailies)) as string[];
    if (clearedDailies.includes(seed)) {
      return false;
    }
    clearedDailies.push(seed);
    localStorage.setItem("daily", btoa(JSON.stringify(clearedDailies)));
    return true;
  }

  /**
   * Attempt to clear session data after the end of a run
   * After session data is removed, attempt to update user info so the menu updates
   * To delete an unfinished run instead, use {@linkcode deleteSession}
   */
  async tryClearSession(slotId: number): Promise<[success: boolean, newClear: boolean]> {
    const accountIdentity = this.currentPersistenceAccount();
    const localKey = this.sessionStorageKeyForAccount(slotId, accountIdentity);
    const localBeforeCloud = localStorage.getItem(localKey);
    let coopClear = globalScene.gameMode?.isCoop === true;

    if (bypassLogin) {
      localStorage.removeItem(localKey);
      return [true, true];
    }

    if (accountIdentity == null) {
      return [false, false];
    }
    const lineageHeadBeforeCloud = this.readKnownCoopCloudHead(slotId, accountIdentity);
    if (localBeforeCloud != null) {
      try {
        coopClear ||= classifySessionProtection(decrypt(localBeforeCloud, bypassLogin)) !== "solo";
      } catch {
        coopClear = true;
      }
    }
    const [userOk] = await updateUserInfo();

    if (!userOk || !this.persistenceAccountIsCurrent(accountIdentity)) {
      // A finished co-op run is not locally deleted until its exact cloud tombstone exists.
      return [false, false];
    }

    if (!coopClear) {
      const observed = await this.readCoopCas(slotId);
      if (!this.persistenceAccountIsCurrent(accountIdentity) || (!observed.ok && observed.failureKind !== "missing")) {
        return [false, false];
      }
      if (observed.ok) {
        coopClear = classifySessionProtection(observed.rawSavedata) !== "solo";
      }
    }
    if (coopClear && lineageHeadBeforeCloud.kind === "invalid") {
      return [false, false];
    }

    let newClear = false;
    let deletedCoopRunId: string | undefined;
    if (userOk) {
      const sessionData = this.getSessionSaveData();
      const { trainerId } = this;
      const jsonResponse = coopClear
        ? await enqueueSessionCloudMutation(accountIdentity, async () => {
            if (!this.persistenceAccountIsCurrent(accountIdentity)) {
              return { success: false, error: "Clear account changed while queued." };
            }
            const deletion = await this.deleteSessionCloudSafely(slotId, localBeforeCloud, accountIdentity);
            return deletion.error == null
              ? { success: true, error: null, deletedCoopRunId: deletion.deletedCoopRunId }
              : { success: false, error: deletion.error };
          })
        : await enqueueSessionCloudMutation(accountIdentity, () =>
            this.persistenceAccountIsCurrent(accountIdentity)
              ? this.clearSessionBounded({ slot: slotId, trainerId, clientSessionId }, sessionData)
              : Promise.resolve({ success: false, error: "Clear account changed while queued." }),
          );

      if (jsonResponse.error) {
        if (coopClear || jsonResponse.error.startsWith("session out of date")) {
          // A newer session exists server-side: queue a reload to reconcile and
          // KEEP the local copy so the reload has data to load. Do NOT wipe.
          globalScene.phaseManager.clearPhaseQueue();
          globalScene.phaseManager.unshiftNew("ReloadSessionPhase");
          console.error(jsonResponse);
          return [false, false];
        }
        // Never erase local bytes without proof that the exact cloud target was cleared.
        console.error(jsonResponse);
        return [false, false];
      }
      newClear = !!jsonResponse.success;
      if ("deletedCoopRunId" in jsonResponse && typeof jsonResponse.deletedCoopRunId === "string") {
        deletedCoopRunId = jsonResponse.deletedCoopRunId;
      }
    }

    // Cloud exact-delete/clear completed. Compare-delete only the local bytes inspected above.
    if (coopClear) {
      const localDeleted = await this.withCommittedCoopDeletePersistenceLease(async () => {
        if (
          localStorage.getItem(localKey) !== localBeforeCloud
          || !this.coopCloudHeadStateMatches(
            this.readKnownCoopCloudHead(slotId, accountIdentity),
            lineageHeadBeforeCloud,
          )
        ) {
          return false;
        }
        if (
          deletedCoopRunId != null
          && (!recordCoopDeletedRun(accountIdentity, deletedCoopRunId)
            || !this.clearKnownCoopCloudHead(slotId, accountIdentity, deletedCoopRunId))
        ) {
          return false;
        }
        localStorage.removeItem(localKey);
        return localStorage.getItem(localKey) == null;
      }, accountIdentity);
      if (localDeleted !== true) {
        return [false, false];
      }
    } else {
      const localDeleted = await this.withSessionPersistenceLease(
        async () => {
          if (localStorage.getItem(localKey) !== localBeforeCloud) {
            return false;
          }
          localStorage.removeItem(localKey);
          return localStorage.getItem(localKey) == null;
        },
        false,
        accountIdentity,
      );
      if (localDeleted !== true) {
        return [false, false];
      }
    }
    if (this.persistenceAccountIsCurrent(accountIdentity) && loggedInUser) {
      loggedInUser.lastSessionSlot = -1;
    }
    return [true, newClear];
  }

  parseSessionData(dataStr: string): SessionSaveData {
    // TODO: Add `null`/`undefined` to the corresponding type signatures for this
    // (or prevent them from being null)
    // If the value is able to *not exist*, it should say so in the code
    const sessionData = JSON.parse(dataStr, (k: string, v: any) => {
      // TODO: Move this to occur _after_ migrate scripts (and refactor all non-assignment duties into migrate scripts)
      // This should ideally be just a giant assign block
      switch (k) {
        case "party":
        case "enemyParty": {
          const ret: PokemonData[] = [];
          for (const pd of v ?? []) {
            ret.push(new PokemonData(pd));
          }
          return ret;
        }

        case "trainer":
          return v ? new TrainerData(v) : null;

        case "modifiers":
        case "enemyModifiers": {
          const ret: PersistentModifierData[] = [];
          for (const md of v ?? []) {
            if (md?.className === "ExpBalanceModifier") {
              // Temporarily limit EXP Balance until it gets reworked
              md.stackCount = Math.min(md.stackCount, 4);
            }

            if (
              md instanceof Modifier.EnemyAttackStatusEffectChanceModifier
              && (md.effect === StatusEffect.FREEZE || md.effect === StatusEffect.SLEEP)
            ) {
              // Discard any old "sleep/freeze chance tokens".
              // TODO: make this migrate script
              continue;
            }

            ret.push(new PersistentModifierData(md, k === "modifiers"));
          }
          return ret;
        }

        case "arena":
          return new ArenaData(v as SerializedArenaData);

        case "challenges": {
          const ret: ChallengeData[] = [];
          for (const c of v ?? []) {
            ret.push(new ChallengeData(c));
          }
          return ret;
        }

        case "mysteryEncounterType":
          return v as MysteryEncounterType;

        case "mysteryEncounterSaveData":
          return new MysteryEncounterSaveData(v);

        case "dailyConfig":
          // make sure the config is valid
          return parseDailySeed(JSON.stringify(v));

        default:
          return v;
      }
    }) as SessionSaveData;

    applySessionVersionMigration(sessionData);

    return sessionData;
  }

  /**
   * Save all data related to the current session to {@linkcode localStorage} and/or the backend server.
   * @param skipVerification - (Default `false`) Whether to skip verifying user info before saving
   * @param sync - (Default `false`) Whether to sync data to the server
   * @param useCachedSession - (Default `false`) Whether to use cached session data from `localStorage` instead of generating new session data
   * @param useCachedSystem - (Default `false`) Whether to use cached system data from `localStorage` instead of generating new system data
   * @returns A Promise that resolves with whether the save operation succeeded.
   */
  // TODO: The name of this method is extremely misleading and suggests that it saves everything across all slots
  // TODO: This should not be able to take `sync=false` alongside either 'use cached' option (in which case we would save the exact same data that was already there)
  async saveAll(
    skipVerification = false,
    sync = false,
    useCachedSession = false,
    useCachedSystem = false,
    forceSync = false,
  ): Promise<boolean> {
    const freshClaim = this.pendingFreshCoopSlotClaim;
    try {
      const result = await this.saveAllImpl(skipVerification, sync, useCachedSession, useCachedSystem, forceSync);
      if (
        !result
        && freshClaim != null
        && (this.pendingFreshCoopSlotClaim === freshClaim
          || (this.committedFreshCoopLaunchSession?.controller === freshClaim.controller
            && this.committedFreshCoopLaunchSession.runId === freshClaim.runId
            && this.committedFreshCoopLaunchSession.generation === freshClaim.generation))
      ) {
        this.abortFreshCoopLaunch("first-save-cas-failed", freshClaim);
      }
      return result;
    } catch (error) {
      if (freshClaim != null) {
        this.abortFreshCoopLaunch("first-save-cas-failed", freshClaim);
      }
      try {
        globalScene.ui.savingIcon.hide();
      } catch {
        // Scene disposal may race this last-resort cleanup.
      }
      throw error;
    }
  }

  private async saveAllImpl(
    skipVerification = false,
    sync = false,
    useCachedSession = false,
    useCachedSystem = false,
    forceSync = false,
  ): Promise<boolean> {
    const liveCoopSave = !useCachedSession && globalScene.gameMode?.isCoop === true;
    const entryCoopContext = liveCoopSave
      ? this.captureCoopPersistenceContext(globalScene.sessionSlotId, "host")
      : null;
    if (liveCoopSave && entryCoopContext == null) {
      coopWarn("launch", "refusing co-op save without one immutable host persistence context");
      return false;
    }
    if (!skipVerification) {
      const [success] = await updateUserInfo();
      if (!success || (entryCoopContext != null && !this.coopPersistenceContextIsCurrent(entryCoopContext, "host"))) {
        return false;
      }
    }

    const pendingOverwriteCloudSync = this.pendingOverwriteCloudSync;
    const overwriteCloudSyncApplies =
      pendingOverwriteCloudSync != null
      && !useCachedSession
      && pendingOverwriteCloudSync.slot === globalScene.sessionSlotId
      && this.persistenceAccountIsCurrent(pendingOverwriteCloudSync.accountIdentity);
    const shouldCloudSync =
      sync && !bypassLogin && (forceSync || overwriteCloudSyncApplies || this.shouldAttemptCloudSync());

    if (entryCoopContext != null) {
      entryCoopContext.controller.advanceCheckpointRevision();
    }

    const freshClaim = this.pendingFreshCoopSlotClaim;
    const freshRuntime = getCoopRuntime();
    const freshClaimApplies =
      freshClaim != null
      && !useCachedSession
      && globalScene.gameMode?.isCoop === true
      && globalScene.sessionSlotId === freshClaim.slot
      && freshRuntime?.controller === freshClaim.controller
      && coopSessionGeneration() === freshClaim.generation
      && freshClaim.controller.role === "host"
      && freshClaim.controller.runId === freshClaim.runId
      && (bypassLogin
        || (freshClaim.accountIdentity != null
          && loggedInUser?.username != null
          && sameCoopIdentity(freshClaim.accountIdentity, loggedInUser.username)));
    if (freshClaim != null && !freshClaimApplies) {
      this.abortFreshCoopLaunch("slot-raced", freshClaim);
      return false;
    }
    const saveAccountIdentity = entryCoopContext?.accountIdentity ?? this.currentPersistenceAccount();
    if (!this.persistenceAccountIsCurrent(saveAccountIdentity)) {
      return false;
    }
    const sessionStorageKey = this.sessionStorageKeyForAccount(globalScene.sessionSlotId, saveAccountIdentity);
    const localSessionBeforeSave = localStorage.getItem(sessionStorageKey);
    // Second local empty check: the first happened immediately before starter materialization.
    // No stale scan is allowed to overwrite bytes another tab wrote during battle construction.
    if (freshClaimApplies && localStorage.getItem(sessionStorageKey) != null) {
      this.abortFreshCoopLaunch("slot-raced", freshClaim);
      return false;
    }

    // ER (#389): reset the cloud-push failure signal for this save attempt -
    // Save and Quit reads it to warn the player when their force-push to the
    // cloud did NOT go through (the save is local-only until the next retry).
    this.lastCloudSyncFailed = false;

    if (shouldCloudSync) {
      globalScene.ui.savingIcon.show();
    }

    const cachedSessionRaw = useCachedSession ? localStorage.getItem(sessionStorageKey) : null;
    if (useCachedSession && cachedSessionRaw == null) {
      globalScene.ui.savingIcon.hide();
      return false;
    }
    const sessionData = useCachedSession
      ? this.parseSessionData(decrypt(cachedSessionRaw!, bypassLogin))
      : this.getSessionSaveData();
    const sessionJson = JSON.stringify(sessionData);
    if (useCachedSession && (sessionData.gameMode as number) === GameModes.COOP) {
      coopWarn("launch", "refusing cached co-op session rewrite outside a live immutable checkpoint transaction");
      globalScene.ui.savingIcon.hide();
      return false;
    }
    let localProtection: CoopClassifiedReplica | null = null;
    if (localSessionBeforeSave != null) {
      try {
        localProtection = await this.classifyCoopReplica(
          globalScene.sessionSlotId,
          decrypt(localSessionBeforeSave, bypassLogin),
        );
      } catch {
        localProtection = {
          slot: globalScene.sessionSlotId,
          raw: "",
          protection: "unknown",
          session: null,
          commitment: null,
        };
      }
    }
    const incomingCommitment =
      (sessionData.gameMode as number) === GameModes.COOP
        ? await deriveCoopResumeCommitment(sessionJson, sessionData)
        : null;
    if (
      localProtection != null
      && localProtection.protection !== "solo"
      && (localProtection.protection !== "coop-valid"
        || localProtection.commitment == null
        || incomingCommitment == null
        || !this.sameCoopReplicaLineage(localProtection.commitment, incomingCommitment)
        || incomingCommitment.checkpointRevision < localProtection.commitment.checkpointRevision
        || (incomingCommitment.checkpointRevision === localProtection.commitment.checkpointRevision
          && incomingCommitment.digest !== localProtection.commitment.digest))
    ) {
      if (freshClaim != null) {
        this.abortFreshCoopLaunch("slot-raced", freshClaim);
      }
      globalScene.ui.savingIcon.hide();
      return false;
    }

    const maxIntAttrValue = 0x80000000;

    const systemStorageKey = `data_${saveAccountIdentity ?? "undefined"}`;
    const systemData = useCachedSystem
      ? GameData.parseSystemData(decrypt(localStorage.getItem(systemStorageKey)!, bypassLogin))
      : this.getSystemSaveData(); // TODO: is this bang correct?

    const request = {
      system: systemData,
      session: sessionData,
      sessionSlotId: globalScene.sessionSlotId,
      clientSessionId,
    };

    const systemSaved = trySetLocalStorageItem(
      systemStorageKey,
      encrypt(
        JSON.stringify(systemData, (_k: any, v: any) =>
          typeof v === "bigint" ? (v <= maxIntAttrValue ? Number(v) : v.toString()) : v,
        ),
        bypassLogin,
      ),
    );

    const encryptedSession = encrypt(sessionJson, bypassLogin);
    let sessionSaved = false;
    const coopEvidenceBeforeSave =
      (sessionData.gameMode as number) === GameModes.COOP ? captureCoopResumeEvidence() : null;
    let coopEvidenceAfterSave: ReturnType<typeof captureCoopResumeEvidence> | null = null;

    // Fresh-slot ownership is established only here, once a complete valid SessionSaveData exists.
    // Commit backend empty-CAS FIRST. Only after it succeeds do we take the account lease, perform
    // the final local-empty check, and write exact bytes synchronously. Thus no non-participating
    // local writer can be overwritten during the network window; if local became occupied, the
    // valid cloud row remains resumable and launch aborts without touching local bytes.
    let freshSlotCommitted = false;
    if (freshClaimApplies && freshClaim != null) {
      if (bypassLogin) {
        freshSlotCommitted = true;
      } else {
        const reservationRequest = {
          slot: freshClaim.slot,
          trainerId: this.trainerId,
          secretId: this.secretId,
          clientSessionId,
          coopCasMode: "empty" as const,
        };
        const reservation = await enqueueSessionCloudMutation(freshClaim.accountIdentity, async () => {
          const runtime = getCoopRuntime();
          if (
            runtime?.controller !== freshClaim.controller
            || coopSessionGeneration() !== freshClaim.generation
            || freshClaim.controller.runId !== freshClaim.runId
            || freshClaim.accountIdentity == null
            || !this.persistenceAccountIsCurrent(freshClaim.accountIdentity)
          ) {
            return {
              ok: false as const,
              status: null,
              error: "Fresh co-op slot claim became stale.",
              failureKind: "unauthorized" as const,
            };
          }
          return this.updateCoopCasBounded(reservationRequest, sessionJson);
        });
        if (reservation.ok) {
          freshSlotCommitted = true;
        } else {
          // Lost-response retry: the empty-CAS endpoint is idempotent for exact bytes, and this
          // read-back also handles an older Worker deployment without that server-side fast path.
          const observed = this.persistenceAccountIsCurrent(freshClaim.accountIdentity)
            ? await this.readCoopCas(freshClaim.slot)
            : null;
          freshSlotCommitted =
            this.persistenceAccountIsCurrent(freshClaim.accountIdentity)
            && observed?.ok === true
            && observed.rawSavedata === sessionJson;
          if (!freshSlotCommitted) {
            coopWarn("launch", `fresh co-op first-save CAS rejected (${reservation.failureKind})`);
          }
        }
      }
      if (!freshSlotCommitted) {
        this.abortFreshCoopLaunch("first-save-cas-failed", freshClaim);
        globalScene.ui.savingIcon.hide();
        return false;
      }
      if (!bypassLogin) {
        const freshCommitment = await deriveCoopResumeCommitment(sessionJson, sessionData);
        const knownFreshHead =
          freshClaim.accountIdentity == null
            ? ({ kind: "invalid", raw: "missing-account" } as const)
            : this.readKnownCoopCloudHead(freshClaim.slot, freshClaim.accountIdentity);
        if (
          freshCommitment == null
          || freshClaim.accountIdentity == null
          || knownFreshHead.kind !== "absent"
          || !this.recordKnownCoopCloudHead(
            freshClaim.slot,
            freshClaim.accountIdentity,
            freshCommitment,
            knownFreshHead,
          )
        ) {
          this.abortFreshCoopLaunch("first-save-cas-failed", freshClaim);
          globalScene.ui.savingIcon.hide();
          return false;
        }
      }
      const localCommitted = await this.withCoopResumePersistenceLease(async () => {
        const runtimeAfterReservation = getCoopRuntime();
        if (
          runtimeAfterReservation?.controller !== freshClaim.controller
          || coopSessionGeneration() !== freshClaim.generation
          || freshClaim.controller.runId !== freshClaim.runId
          || !this.persistenceAccountIsCurrent(freshClaim.accountIdentity)
          || sessionStorageKey !== this.sessionStorageKeyForAccount(freshClaim.slot, freshClaim.accountIdentity)
          || localStorage.getItem(sessionStorageKey) != null
        ) {
          return false;
        }
        const committed =
          trySetLocalStorageItem(sessionStorageKey, encryptedSession)
          && localStorage.getItem(sessionStorageKey) === encryptedSession;
        const partner = freshClaim.controller.partnerName;
        if (committed && partner != null && sessionData.coopRun != null) {
          recordCoopResumeMarker(
            freshClaim.slot,
            freshClaim.controller.localName(),
            partner,
            globalScene.currentBattle?.waveIndex ?? 1,
            sessionData.coopRun.runId,
            sessionData.coopRun.checkpointRevision,
          );
        }
        return committed;
      }, freshClaim.accountIdentity);
      sessionSaved = localCommitted === true;
      if (!sessionSaved) {
        // Backend contains a complete valid checkpoint. Never delete it and never touch the local
        // row that won this race; the next lobby can recover cloud state safely.
        this.abortFreshCoopLaunch("slot-raced", freshClaim);
        globalScene.ui.savingIcon.hide();
        return false;
      }
      this.pendingFreshCoopSlotClaim = null;
    } else if ((sessionData.gameMode as number) === GameModes.COOP) {
      const localCommitted = await this.withCoopResumePersistenceLease(async () => {
        if (
          entryCoopContext == null
          || !this.coopPersistenceContextIsCurrent(entryCoopContext, "host")
          || sessionStorageKey !== entryCoopContext.storageKey
          || sessionData.coopRun?.runId !== entryCoopContext.runId
          || localStorage.getItem(sessionStorageKey) !== localSessionBeforeSave
        ) {
          return false;
        }
        const committed =
          trySetLocalStorageItem(sessionStorageKey, encryptedSession)
          && localStorage.getItem(sessionStorageKey) === encryptedSession;
        const controller = entryCoopContext.controller;
        const partner = controller?.partnerName;
        const self = controller?.localName();
        if (committed && self && partner && sessionData.coopRun != null) {
          recordCoopResumeMarker(
            entryCoopContext.slot,
            self,
            partner,
            globalScene.currentBattle?.waveIndex ?? 0,
            sessionData.coopRun.runId,
            sessionData.coopRun.checkpointRevision,
          );
        }
        if (committed) {
          coopEvidenceAfterSave = captureCoopResumeEvidence();
        }
        return committed;
      }, saveAccountIdentity);
      sessionSaved = localCommitted === true;
    } else {
      const localCommitted = await this.withSessionPersistenceLease(
        async () => {
          if (localStorage.getItem(sessionStorageKey) !== localSessionBeforeSave) {
            return false;
          }
          return (
            trySetLocalStorageItem(sessionStorageKey, encryptedSession)
            && localStorage.getItem(sessionStorageKey) === encryptedSession
          );
        },
        false,
        saveAccountIdentity,
      );
      sessionSaved = localCommitted === true;
    }
    if (!sessionSaved && (sessionData.gameMode as number) === GameModes.COOP) {
      globalScene.ui.savingIcon.hide();
      return false;
    }

    // At cloud cadence, the authority's CAS resolves before the checkpoint is offered to the guest.
    // A deterministic conflict terminates before the peer can persist a fork. A transport failure
    // continues only when readback + account-wide status still prove the exact unique frozen parent;
    // every missing/moved/newer/opaque outcome terminates instead of being mislabeled local debt.
    let authorityCloudCommitted = freshSlotCommitted;
    let authorityCloudDebt = false;
    if (
      !freshSlotCommitted
      && shouldCloudSync
      && (sessionData.gameMode as number) === GameModes.COOP
      && entryCoopContext != null
    ) {
      const cloudRuntime = entryCoopContext.runtime;
      const coopCasResult = await enqueueSessionCloudMutation(saveAccountIdentity, () =>
        this.persistenceAccountIsCurrent(saveAccountIdentity)
        && this.coopPersistenceContextIsCurrent(entryCoopContext, "host")
          ? this.updateCoopCloudCas(entryCoopContext.slot, sessionJson, sessionData)
          : Promise.resolve({
              ok: false as const,
              error: "Co-op cloud CAS account/runtime changed.",
              failureKind: "unauthorized" as const,
              continuationSafe: false,
              rollbackSafe: false,
            }),
      );
      if (coopCasResult.ok) {
        authorityCloudCommitted = true;
      } else {
        this.markCloudSyncFailure();
        this.lastCloudSyncFailed = true;
        if (coopCasResult.continuationSafe) {
          authorityCloudDebt = true;
          coopWarn("launch", "authority cloud checkpoint deferred from its exact unique parent as local mirrored debt");
        } else {
          let rollbackConverged = false;
          if (coopCasResult.rollbackSafe && coopEvidenceBeforeSave != null && coopEvidenceAfterSave != null) {
            const coopEvidenceAfterSaveSnapshot = coopEvidenceAfterSave;
            try {
              rollbackConverged =
                (await this.withCoopResumePersistenceLease(async () => {
                  if (localStorage.getItem(sessionStorageKey) !== encryptedSession) {
                    return false;
                  }
                  let localRestored = false;
                  try {
                    if (localSessionBeforeSave == null) {
                      localStorage.removeItem(sessionStorageKey);
                      localRestored = localStorage.getItem(sessionStorageKey) == null;
                    } else {
                      localRestored =
                        trySetLocalStorageItem(sessionStorageKey, localSessionBeforeSave)
                        && localStorage.getItem(sessionStorageKey) === localSessionBeforeSave;
                    }
                  } catch (error) {
                    coopWarn("launch", "authority checkpoint local rollback threw", error);
                  }
                  return (
                    localRestored
                    && restoreCoopResumeEvidenceIfUnchanged(coopEvidenceAfterSaveSnapshot, coopEvidenceBeforeSave)
                  );
                }, saveAccountIdentity)) === true;
            } catch (error) {
              coopWarn("launch", "authority checkpoint rollback failed unexpectedly", error);
            }
          }
          if (!rollbackConverged && incomingCommitment != null) {
            const partner = entryCoopContext.controller.partnerName;
            if (partner != null) {
              recordCoopResumeUnavailableEvidence(
                entryCoopContext.controller.localName(),
                partner,
                incomingCommitment.wave,
                incomingCommitment.runId,
                incomingCommitment.checkpointRevision,
                incomingCommitment.seats,
              );
            }
            coopWarn("launch", "authority cloud conflict left explicit local reconciliation debt");
          }
          const terminateCurrentScene =
            getCoopRuntime() === cloudRuntime
            && cloudRuntime.controller === entryCoopContext.controller
            && coopSessionGeneration() === entryCoopContext.generation;
          try {
            cloudRuntime.battleStream.sendLaunchSnapshotAbort(
              globalScene.currentBattle?.waveIndex ?? 1,
              "first-save-cas-failed",
            );
          } catch (error) {
            coopWarn("launch", "authority cloud conflict terminal broadcast failed", error);
          } finally {
            try {
              cloudRuntime.localTransport.close();
            } catch (error) {
              coopWarn("launch", "authority cloud conflict transport close failed", error);
            }
            if (terminateCurrentScene) {
              try {
                clearCoopRuntime();
              } catch (error) {
                coopWarn("launch", "authority cloud conflict runtime cleanup failed", error);
              }
              try {
                globalScene.ui.savingIcon.hide();
              } catch (error) {
                coopWarn("launch", "authority cloud conflict saving indicator cleanup failed", error);
              }
              try {
                globalScene.reset(true);
              } catch (error) {
                coopWarn("launch", "authority cloud conflict scene reset failed", error);
              }
            }
          }
          return false;
        }
      }
    }

    // Authoritative co-op persistence mirror: this is a resume-safe boundary. Await the bounded
    // guest-local transaction before saveAll returns/EncounterPhase advances; timeout/NACK remains
    // retryable in the controller outbox and is distinguished explicitly in diagnostics.
    const checkpointRuntime = entryCoopContext?.runtime ?? getCoopRuntime();
    const checkpointController = entryCoopContext?.controller ?? checkpointRuntime?.controller;
    const checkpointGeneration = entryCoopContext?.generation ?? coopSessionGeneration();
    let freshGuestPersisted = !freshSlotCommitted;
    let checkpointPersistenceRequired = false;
    let checkpointPersisted = true;
    if (
      sessionSaved
      && checkpointRuntime != null
      && checkpointController?.role === "host"
      && globalScene.sessionSlotId >= 0
      && (sessionData.gameMode as number) === GameModes.COOP
    ) {
      checkpointPersistenceRequired = true;
      checkpointPersisted = false;
      try {
        const commitment = await deriveCoopResumeCommitment(sessionJson, sessionData);
        if (
          commitment == null
          || (entryCoopContext != null && !this.coopPersistenceContextIsCurrent(entryCoopContext, "host"))
          || getCoopRuntime() !== checkpointRuntime
          || checkpointRuntime.controller !== checkpointController
          || coopSessionGeneration() !== checkpointGeneration
        ) {
          coopWarn("launch", "guest resume checkpoint invalidated before bounded persistence transaction");
        } else {
          const delivery = await checkpointController.sendResumeCheckpointDetailed(
            sessionJson,
            commitment,
            COOP_RESUME_CHECKPOINT_ACK_TIMEOUT_MS,
            freshSlotCommitted || authorityCloudCommitted,
          );
          freshGuestPersisted = delivery.status === "persisted";
          checkpointPersisted = freshGuestPersisted;
          if (delivery.status === "nack") {
            coopWarn(
              "launch",
              `guest resume checkpoint durable NACK reason=${delivery.reason}; retained for retry/evidence`,
            );
          } else if (delivery.status !== "persisted") {
            coopWarn("launch", `guest resume checkpoint ${delivery.status}; retained for reconnect retry`);
          }
        }
      } catch (error) {
        coopWarn("launch", "guest resume checkpoint replication failed", error);
      }
    }
    let freshLocalStillExact = false;
    try {
      freshLocalStillExact = localStorage.getItem(sessionStorageKey) === encryptedSession;
    } catch {
      freshLocalStillExact = false;
    }
    const freshPostAckCurrent =
      freshClaim != null
      && (bypassLogin || this.persistenceAccountIsCurrent(freshClaim.accountIdentity))
      && getCoopRuntime() === checkpointRuntime
      && checkpointRuntime?.controller === freshClaim.controller
      && checkpointController === freshClaim.controller
      && checkpointGeneration === freshClaim.generation
      && coopSessionGeneration() === freshClaim.generation
      && freshClaim.controller.runId === freshClaim.runId
      && freshLocalStillExact;
    if (freshSlotCommitted && (!freshGuestPersisted || !freshPostAckCurrent)) {
      this.committedFreshCoopLaunchSession = null;
      this.abortFreshCoopLaunch("guest-persistence-failed", freshClaim);
      globalScene.ui.savingIcon.hide();
      return false;
    }
    const checkpointLocalStillExact = (() => {
      try {
        return localStorage.getItem(sessionStorageKey) === encryptedSession;
      } catch {
        return false;
      }
    })();
    const checkpointPostAckCurrent =
      this.persistenceAccountIsCurrent(saveAccountIdentity)
      && getCoopRuntime() === checkpointRuntime
      && checkpointRuntime?.controller === checkpointController
      && coopSessionGeneration() === checkpointGeneration
      && checkpointLocalStillExact
      && (entryCoopContext == null || this.coopPersistenceContextIsCurrent(entryCoopContext, "host"));
    if (!freshSlotCommitted && checkpointPersistenceRequired && (!checkpointPersisted || !checkpointPostAckCurrent)) {
      const capturedCheckpointStillOwnsScene = (): boolean =>
        checkpointRuntime != null
        && getCoopRuntime() === checkpointRuntime
        && checkpointRuntime.controller === checkpointController
        && coopSessionGeneration() === checkpointGeneration;
      checkpointRuntime?.battleStream.sendLaunchSnapshotAbort(sessionData.waveIndex, "guest-persistence-failed");
      // Always retire the captured transport. It may already be stale, but allowing it to survive
      // lets a late ACK/NACK keep emitting into the replacement session. Scene/runtime teardown is
      // separately generation-guarded so the stale callback cannot destroy that replacement.
      checkpointRuntime?.localTransport.close();
      if (capturedCheckpointStillOwnsScene()) {
        clearCoopRuntime();
        globalScene.ui.savingIcon.hide();
        globalScene.reset(true);
      }
      return false;
    }
    if (freshSlotCommitted && freshClaim != null) {
      this.committedFreshCoopLaunchSession = {
        wave: globalScene.currentBattle?.waveIndex ?? 1,
        sessionJson,
        controller: freshClaim.controller,
        runId: freshClaim.runId,
        generation: freshClaim.generation,
        slot: freshClaim.slot,
        accountIdentity: freshClaim.accountIdentity,
        encryptedSession,
      };
    }

    if (systemSaved && sessionSaved) {
      this.warnedLocalStorageFull = false;
      this.lastLocalSaveFailed = false;
    } else {
      // Storage full: warn once and keep going - the cloud `updateAll` below pushes
      // `request` (built from the in-memory data, not localStorage), so progress
      // still syncs and Save & Quit no longer freezes on a QuotaExceededError.
      this.warnLocalStorageFull();
    }

    console.debug(`Session data saved to slot ${globalScene.sessionSlotId}!`);

    if (bypassLogin || !shouldCloudSync) {
      globalScene.ui.savingIcon.hide();
      return true;
    }

    // Protected session bytes already used their dedicated authority CAS. updateAll is system-only.
    const cloudRequest = (sessionData.gameMode as number) === GameModes.COOP ? { ...request, session: null } : request;
    const saveError = await enqueueSessionCloudMutation(saveAccountIdentity, () =>
      this.persistenceAccountIsCurrent(saveAccountIdentity)
        ? this.updateAllBounded(cloudRequest)
        : Promise.resolve("Save account changed before queued cloud mutation."),
    );
    if (overwriteCloudSyncApplies && this.pendingOverwriteCloudSync === pendingOverwriteCloudSync) {
      this.pendingOverwriteCloudSync = null;
    }
    globalScene.ui.savingIcon.hide();

    if (!saveError) {
      if (authorityCloudDebt) {
        return true;
      }
      globalScene.lastSavePlayTime = 0;
      this.markCloudSyncSuccess();
      return true;
    }

    // TODO: handle this more gracefully
    if (saveError.startsWith("session out of date")) {
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.phaseManager.unshiftNew("ReloadSessionPhase");
      console.error(saveError);
      return false;
    }
    if (saveError.startsWith("Save rejected")) {
      // Server save-clobber guard refused the system portion of this push (stale or
      // empty local data would regress the cloud save). Cloud is untouched; warn
      // once that a reload restores it. Otherwise treated as a generic failure.
      this.markCloudSyncFailure();
      this.lastCloudSyncFailed = true;
      this.warnCloudSaveProtected();
      console.warn(saveError);
      return true;
    }
    this.markCloudSyncFailure();
    this.lastCloudSyncFailed = true;
    console.error(saveError);
    return true;
  }

  public async tryExportData(dataType: GameDataType, slotId = 0): Promise<boolean> {
    const dataKey = `${getDataTypeKey(dataType, slotId)}_${loggedInUser?.username}`;
    let data: string | null;

    // TODO: This control flow still leaves something to be desired
    if (bypassLogin || (dataType !== GameDataType.SYSTEM && dataType !== GameDataType.SESSION)) {
      const encrypted = localStorage.getItem(dataKey);
      if (typeof encrypted !== "string") {
        return false;
      }

      data = decrypt(encrypted, bypassLogin);
      if (dataType === GameDataType.SYSTEM) {
        data = this.convertSystemDataStr(data, true);
      }
    } else if (dataType === GameDataType.SYSTEM) {
      const resp = await pokerogueApi.savedata.system.get({ clientSessionId });
      if (typeof resp !== "string") {
        return false;
      }
      data = this.convertSystemDataStr(resp, true);
    } else {
      dataType satisfies GameDataType.SESSION;
      const resp = await pokerogueApi.savedata.session.get({ slot: slotId, clientSessionId });
      if (typeof resp !== "string") {
        return false;
      }
      data = resp;
    }

    // TODO: this is a really shit way of checking JSON validity
    if (!data || data.charAt(0) !== "{") {
      console.error("Exported save data is invalid JSON!", data);
      return false;
    }

    const encryptedData = AES.encrypt(data, saveKey);
    const blob = new Blob([encryptedData.toString()], {
      type: "text/json",
    });
    const link = document.createElement("a");
    link.href = window.URL.createObjectURL(blob);
    link.download = `${dataKey}.prsv`;
    link.click();
    link.remove();

    return true;
  }

  // TODO: Refactor this spaghetti monster
  public importData(dataType: GameDataType, slotId = 0): void {
    const dataKey = `${getDataTypeKey(dataType, slotId)}_${loggedInUser?.username}`;

    let saveFile: any = document.getElementById("saveFile");
    if (saveFile) {
      saveFile.remove();
    }

    saveFile = document.createElement("input");
    saveFile.id = "saveFile";
    saveFile.type = "file";
    saveFile.accept = ".prsv";

    // iOS requires user interaction with a visible element to trigger file input
    if (isIos()) {
      const uploadButton = document.createElement("button");
      uploadButton.id = "iosUploadButton";
      uploadButton.textContent = "Select File to Import";
      uploadButton.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 15px 30px;
        font-size: 18px;
        font-family: Arial, sans-serif;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
      `;

      const overlay = document.createElement("div");
      overlay.id = "iosUploadOverlay";
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0,0,0,0.7);
        z-index: 9999;
      `;

      saveFile.style.display = "none";

      uploadButton.onclick = () => {
        saveFile.click();
      };

      overlay.onclick = () => {
        overlay.remove();
        uploadButton.remove();
        saveFile.remove();
      };

      document.body.appendChild(overlay);
      document.body.appendChild(uploadButton);
    } else {
      saveFile.style.display = "none";
    }

    saveFile.addEventListener("change", e => {
      const overlay = document.getElementById("iosUploadOverlay");
      const button = document.getElementById("iosUploadButton");
      overlay?.remove();
      button?.remove();

      const reader = new FileReader();

      reader.onload = (_ => {
        return e => {
          const dataName = i18next.t(`gameData:${toCamelCase(GameDataType[dataType])}`);
          let dataStr = AES.decrypt(e.target?.result?.toString()!, saveKey).toString(enc.Utf8); // TODO: is this bang correct?
          let valid = false;
          let parsedImportedSession: SessionSaveData | null = null;
          try {
            switch (dataType) {
              case GameDataType.SYSTEM: {
                dataStr = this.convertSystemDataStr(dataStr);
                dataStr = dataStr.replace(/"playTime":\d+/, `"playTime":${this.gameStats.playTime + 60}`);
                const systemData = GameData.parseSystemData(dataStr);
                valid = !!systemData.dexData && !!systemData.timestamp;
                break;
              }
              case GameDataType.SESSION: {
                const sessionData = this.parseSessionData(dataStr);
                parsedImportedSession = sessionData;
                valid = !!sessionData.party && !!sessionData.enemyParty && !!sessionData.timestamp;
                break;
              }
              case GameDataType.RUN_HISTORY: {
                const data = JSON.parse(dataStr);
                const keys = Object.keys(data);
                keys.forEach(key => {
                  const entryKeys = Object.keys(data[key]);
                  valid =
                    ["isFavorite", "isVictory", "entry"].every(v => entryKeys.includes(v)) && entryKeys.length === 3;
                });
                break;
              }
              case GameDataType.SETTINGS:
              case GameDataType.TUTORIALS:
                valid = true;
                break;
            }
          } catch (ex) {
            console.error(ex);
          }

          const displayError = (error: string) =>
            globalScene.ui.showText(error, null, () => globalScene.ui.showText("", 0), fixedInt(1500));

          if (!valid) {
            return displayError(i18next.t("menuUiHandler:importCorrupt", { dataName }));
          }

          globalScene.ui.showText(i18next.t("menuUiHandler:confirmImport", { dataName }), null, () => {
            globalScene.ui.setOverlayMode(
              UiMode.CONFIRM,
              async () => {
                const accountIdentity = this.currentPersistenceAccount();
                if (!bypassLogin && accountIdentity == null) {
                  return displayError(i18next.t("menuUiHandler:importNoServer", { dataName }));
                }
                if (
                  dataType === GameDataType.SESSION
                  && dataKey !== this.sessionStorageKeyForAccount(slotId, accountIdentity)
                ) {
                  return displayError(i18next.t("menuUiHandler:importError", { dataName }));
                }
                const incomingProtection =
                  dataType === GameDataType.SESSION ? classifySessionProtection(dataStr) : "solo";
                const protectedCoopImport = incomingProtection === "coop-valid";
                if (incomingProtection === "coop-invalid") {
                  return displayError(i18next.t("menuUiHandler:importCorrupt", { dataName }));
                }
                const localBeforeCloud = localStorage.getItem(dataKey);
                let existingProtectedCoop = false;
                try {
                  existingProtectedCoop =
                    dataType === GameDataType.SESSION
                    && localBeforeCloud != null
                    && classifySessionProtection(decrypt(localBeforeCloud, bypassLogin)) !== "solo";
                } catch {
                  existingProtectedCoop = dataType === GameDataType.SESSION && localBeforeCloud != null;
                }
                if (existingProtectedCoop && !protectedCoopImport) {
                  return displayError(i18next.t("menuUiHandler:importError", { dataName }));
                }
                const importDisposition =
                  dataType === GameDataType.SESSION
                    ? await this.assessImportOverLocalSession(
                        slotId,
                        localBeforeCloud,
                        dataStr,
                        parsedImportedSession,
                        accountIdentity,
                      )
                    : ({ kind: "ordinary" } as const);
                if (importDisposition == null) {
                  return displayError(i18next.t("menuUiHandler:importError", { dataName }));
                }
                if (!bypassLogin && dataType < GameDataType.SETTINGS) {
                  const success = await updateUserInfo();
                  if (!success[0]) {
                    return displayError(i18next.t("menuUiHandler:importNoServer", { dataName }));
                  }
                  const { trainerId, secretId } = this;
                  let error: string | null;
                  if (dataType === GameDataType.SESSION) {
                    if (protectedCoopImport) {
                      const importedSession = parsedImportedSession;
                      if (importedSession == null) {
                        return displayError(i18next.t("menuUiHandler:importCorrupt", { dataName }));
                      }
                      const mutation = await enqueueSessionCloudMutation(accountIdentity, () =>
                        this.persistenceAccountIsCurrent(accountIdentity)
                          ? this.updateCoopCloudCas(slotId, dataStr, importedSession, importDisposition)
                          : Promise.resolve({
                              ok: false as const,
                              error: "Import account changed while queued.",
                              failureKind: "unauthorized" as const,
                              continuationSafe: false as const,
                              rollbackSafe: false as const,
                            }),
                      );
                      error = mutation.ok ? null : mutation.error;
                    } else {
                      error = await enqueueSessionCloudMutation(accountIdentity, () =>
                        this.persistenceAccountIsCurrent(accountIdentity)
                          ? this.updateSessionBounded(
                              {
                                slot: slotId,
                                trainerId,
                                secretId,
                                clientSessionId,
                              },
                              dataStr,
                            )
                          : Promise.resolve("Import account changed while queued."),
                      );
                    }
                  } else {
                    const encrypted = encrypt(dataStr, bypassLogin);
                    if (!trySetLocalStorageItem(dataKey, encrypted) || localStorage.getItem(dataKey) !== encrypted) {
                      return displayError(i18next.t("menuUiHandler:importError", { dataName }));
                    }
                    error = await pokerogueApi.savedata.system.update(
                      { trainerId, secretId, clientSessionId },
                      dataStr,
                    );
                  }
                  if (error) {
                    console.error(error);
                    return displayError(i18next.t("menuUiHandler:importError", { dataName }));
                  }
                  if (dataType === GameDataType.SESSION) {
                    const encrypted = encrypt(dataStr, bypassLogin);
                    const localCommitted = await this.withSessionPersistenceLease(
                      async () => {
                        if (localStorage.getItem(dataKey) !== localBeforeCloud) {
                          return false;
                        }
                        return (
                          trySetLocalStorageItem(dataKey, encrypted) && localStorage.getItem(dataKey) === encrypted
                        );
                      },
                      protectedCoopImport,
                      accountIdentity,
                    );
                    if (localCommitted !== true) {
                      return displayError(i18next.t("menuUiHandler:importError", { dataName }));
                    }
                  }
                  window.location.reload();
                  return;
                }
                if (protectedCoopImport) {
                  // An authenticated CAS/tombstone authority is required for durable co-op rows.
                  return displayError(i18next.t("menuUiHandler:importNoServer", { dataName }));
                }
                const encrypted = encrypt(dataStr, bypassLogin);
                if (!trySetLocalStorageItem(dataKey, encrypted) || localStorage.getItem(dataKey) !== encrypted) {
                  return displayError(i18next.t("menuUiHandler:importError", { dataName }));
                }
                window.location.reload();
              },
              () => {
                globalScene.ui.revertMode();
                globalScene.ui.showText("", 0);
              },
              false,
              -98,
            );
          });
        };
      })((e.target as any).files[0]);

      reader.readAsText((e.target as any).files[0]);
    });

    if (!isIos()) {
      saveFile.click();
    }
  }

  private initDexData(): void {
    const data: DexData = {};

    for (const species of allSpecies) {
      data[species.speciesId] = {
        seenAttr: 0n,
        caughtAttr: 0n,
        natureAttr: 0,
        seenCount: 0,
        caughtCount: 0,
        hatchedCount: 0,
        ivs: [0, 0, 0, 0, 0, 0],
        ribbons: new RibbonData(0),
      };
    }

    const defaultStarterAttr =
      DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;

    const defaultStarterNatures: Nature[] = [];

    globalScene.executeWithSeedOffset(
      () => {
        const neutralNatures = [Nature.HARDY, Nature.DOCILE, Nature.SERIOUS, Nature.BASHFUL, Nature.QUIRKY];
        for (const _ of defaultStarterSpecies) {
          defaultStarterNatures.push(randSeedItem(neutralNatures));
        }
      },
      0,
      "default",
    );

    for (let ds = 0; ds < defaultStarterSpecies.length; ds++) {
      const entry = data[defaultStarterSpecies[ds]] as DexEntry;
      entry.seenAttr = defaultStarterAttr;
      entry.caughtAttr = defaultStarterAttr;
      entry.natureAttr = 1 << (defaultStarterNatures[ds] + 1);
      for (const i in entry.ivs) {
        entry.ivs[i] = 15;
      }
    }

    this.defaultDexData = { ...data };
    this.dexData = data;
  }

  private initStarterData(): void {
    const starterData: StarterData = {};

    const starterSpeciesIds = Object.keys(speciesStarterCosts).map(k => Number.parseInt(k) as SpeciesId);

    for (const speciesId of starterSpeciesIds) {
      starterData[speciesId] = this.createStarterDataEntry(speciesId);
    }

    // Elite Redux: seed default starterData entries for ER-custom species
    // (ids >= 10000). Without these, UI/battle code that reads
    // starterData[id].classicWinCount, .abilityAttr, etc. crashes on
    // ER-custom encounters. Imported lazily here to avoid a circular
    // module dependency (init.ts imports game-data.ts).
    for (const species of allSpecies) {
      if (species.speciesId >= 10000 && starterData[species.speciesId] === undefined) {
        starterData[species.speciesId] = this.createStarterDataEntry(species.speciesId);
      }
    }

    this.starterData = starterData;
  }

  private createStarterDataEntry(speciesId: number): StarterDataEntry {
    return {
      moveset: null,
      eggMoves: 0,
      candyCount: 0,
      friendship: 0,
      abilityAttr: defaultStarterSpecies.includes(speciesId as SpeciesId) ? AbilityAttr.ABILITY_1 : 0,
      passiveAttr: 0,
      valueReduction: 0,
      classicWinCount: 0,
    };
  }

  /**
   * The canonical starterData KEY for a species: its evolution line's baby ROOT,
   * after first resolving a custom MEGA form to its base. This is the EXACT same
   * normalization {@linkcode getStarterDataEntry} pools under, exposed so UI that
   * needs the id (not the entry) - e.g. the Pokedex candy/passive panels - reads
   * the line's shared bucket instead of a per-stage stray (Pichu/Pikachu/Raichu
   * all resolve to Pichu). Pure: unlike getStarterDataEntry it never creates an
   * entry, so it's safe to call across the whole grid. Falls back to the raw id
   * for synthetic/custom species not in the species table.
   */
  public getRootStarterSpeciesId(speciesId: number): SpeciesId {
    const baseId = erMegaTargetToBaseSpeciesId(speciesId) ?? speciesId;
    return getPokemonSpecies(baseId)?.getRootSpeciesId() ?? (baseId as SpeciesId);
  }

  public getStarterDataEntry(speciesId: number): StarterDataEntry {
    // Normalize to the evolution line's ROOT so candy + passive/ability unlocks
    // pool under ONE key and survive evolution. Without this, any line with a
    // baby pre-evo (Pichu->Pikachu->Raichu, Cleffa->Clefairy, ...) scattered
    // candy and unlocks across stages - the in-battle Abilities page reads the
    // root and showed everything "Locked - unlock with candy" even after paying.
    // Falls back to the raw id for synthetic/custom species not in the table.
    // ER: a custom MEGA form (e.g. Flygon Redux B Mega) is a battle form of its
    // base, not a separate line - resolve it to the base FIRST (before the evo
    // root) so its candy/passive/ability unlocks pool on the base and it never
    // shows a split candy count.
    const rootId = this.getRootStarterSpeciesId(speciesId);
    return (this.starterData[rootId] ??= this.createStarterDataEntry(rootId));
  }

  /**
   * One-time consolidation: fold any starterData entry that belongs to a
   * NON-root member of an evolution line into the line's root, then delete the
   * stray. Undoes historic candy/passive scatter (e.g. a save with Pichu 26 /
   * Pikachu 0 / Raichu 98 and a passive paid on Pikachu) so nothing is lost and
   * the in-battle Abilities page reads correctly. Idempotent - once merged the
   * strays are gone, so re-running is a no-op.
   */
  private consolidateStarterDataToRoots(): void {
    for (const key of Object.keys(this.starterData)) {
      const speciesId = Number.parseInt(key) as SpeciesId;
      const species = getPokemonSpecies(speciesId);
      if (!species) {
        continue;
      }
      // ER: fold a custom MEGA form's stray bucket into its base too (mega has no
      // prevolution, so getRootSpeciesId returns itself - resolve mega->base first
      // so an already-split save (base candy X, mega candy Y) heals to base X+Y).
      const megaBase = erMegaTargetToBaseSpeciesId(speciesId);
      const rootId =
        megaBase === undefined
          ? species.getRootSpeciesId()
          : (getPokemonSpecies(megaBase)?.getRootSpeciesId() ?? megaBase);
      if (rootId === speciesId) {
        continue;
      }
      const src = this.starterData[speciesId];
      const dst = (this.starterData[rootId] ??= this.createStarterDataEntry(rootId));
      dst.candyCount = (dst.candyCount ?? 0) + (src.candyCount ?? 0);
      dst.passiveAttr |= src.passiveAttr ?? 0;
      dst.abilityAttr |= src.abilityAttr ?? 0;
      dst.valueReduction = Math.max(dst.valueReduction ?? 0, src.valueReduction ?? 0);
      dst.classicWinCount = Math.max(dst.classicWinCount ?? 0, src.classicWinCount ?? 0);
      dst.friendship = Math.max(dst.friendship ?? 0, src.friendship ?? 0);
      const mergedShinyLab = mergeErShinyLabSaveData(dst.erShinyLab, src.erShinyLab);
      if (mergedShinyLab) {
        dst.erShinyLab = mergedShinyLab;
      }
      delete this.starterData[speciesId];
    }
  }

  private applyLocalAllStartersDebug(): void {
    if (!isDev || !globalThis.location || !new URLSearchParams(globalThis.location.search).has("codexAllStarters")) {
      return;
    }

    const caughtAttr =
      DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
    for (const species of allSpecies) {
      const dexEntry = this.dexData[species.speciesId];
      if (dexEntry) {
        dexEntry.seenAttr = caughtAttr;
        dexEntry.caughtAttr = caughtAttr;
        dexEntry.natureAttr ||= 1 << (Nature.HARDY + 1);
        dexEntry.ivs = dexEntry.ivs.map(() => 31);
      }

      const starterEntry = this.getStarterDataEntry(species.speciesId);
      starterEntry.abilityAttr = AbilityAttr.ABILITY_1 | AbilityAttr.ABILITY_2 | AbilityAttr.ABILITY_HIDDEN;
    }

    globalScene.enableTutorials = false;
  }

  setPokemonSeen(pokemon: Pokemon, incrementCount = true, trainer = false): void {
    // Some Mystery Encounters block updates to these stats
    if (
      globalScene.currentBattle?.isBattleMysteryEncounter()
      && globalScene.currentBattle.mysteryEncounter?.preventGameStatsUpdates
    ) {
      return;
    }
    const dexEntry = this.dexData[pokemon.species.speciesId];
    dexEntry.seenAttr |= pokemon.getDexAttr();
    if (incrementCount) {
      dexEntry.seenCount++;
      this.gameStats.pokemonSeen++;
      if (!trainer && pokemon.species.subLegendary) {
        this.gameStats.subLegendaryPokemonSeen++;
      } else if (!trainer && pokemon.species.legendary) {
        this.gameStats.legendaryPokemonSeen++;
      } else if (!trainer && pokemon.species.mythical) {
        this.gameStats.mythicalPokemonSeen++;
      }
      if (!trainer && pokemon.isShiny()) {
        this.gameStats.shinyPokemonSeen++;
      }
    }
  }

  /**
   *
   * @param pokemon
   * @param incrementCount
   * @param fromEgg
   * @param showMessage
   * @returns `true` if Pokemon catch unlocked a new starter, `false` if Pokemon catch did not unlock a starter
   */
  // TODO: This return value is exclusively used inside Weird Dream (which manually displays the "new starter unlocked" message),
  // all for the purposes of playing a level up fanfare if 1+ species were unlocked.
  // Given its only use is effectively useless, we should consider removing this return value at a future date
  async setPokemonCaught(
    pokemon: Pokemon,
    incrementCount = true,
    fromEgg = false,
    showMessage = true,
  ): Promise<boolean> {
    // #807 B (default-deny account writes): during a CO-OP session, caught-registration only
    // proceeds from explicitly allowlisted scopes (own catch, scoped share apply, own adopt
    // credit). Anything else is a leak path by definition - blocked + loudly logged.
    if (
      !coopGateAccountWrite(globalScene.gameMode?.isCoop === true, `setPokemonCaught sp=${pokemon.species?.speciesId}`)
    ) {
      return false;
    }
    // ER (#410): a vanilla mon wearing the REDUX form registers its RDX custom
    // species (the entry eggs hatch and the RDX tab lists) instead of stamping
    // the vanilla species' slot - the reported "Spearow Redux replaced gen 1
    // Spearow's location" hijack. The run mon itself is untouched.
    const reduxCounterpartId = getErReduxCounterpartId(pokemon.species.speciesId, pokemon.getFormKey());
    const dexSpecies = reduxCounterpartId === undefined ? pokemon.species : getPokemonSpecies(reduxCounterpartId);

    // If incrementCount === false (not a catch scenario), only update the pokemon's dex data if the Pokemon has already been marked as caught in dex
    // Prevents form changes, nature changes, etc. from unintentionally updating the dex data of a "rental" pokemon
    const speciesRootForm = dexSpecies.getRootSpeciesId();
    if (!incrementCount && !globalScene.gameData.dexData[speciesRootForm].caughtAttr) {
      return Promise.resolve(false);
    }
    // ER Black Shinies (#349): catching/hatching a t4 black shiny unlocks the
    // black tier for this line (starter select + dex filter).
    if (pokemon.customPokemonData?.erBlackShiny && this.starterData[speciesRootForm]) {
      this.starterData[speciesRootForm].erBlackShiny = true;
    }
    const shinyLabLook = pokemon.customPokemonData?.erShinyLab;
    const starterEntry = this.starterData[speciesRootForm];
    if (shinyLabLook && starterEntry) {
      grantErShinyLabSavedLookToSave((starterEntry.erShinyLab ??= {}), shinyLabLook);
    }
    // Co-op shared acquisition (#794): this is THE universal acquisition chokepoint (wild
    // catch, DexNav grant, ME-granted mon, Picnic join, ...). After the dex write lands,
    // the HOST streams its dex/starter blob so the partner's account is credited NOW - not
    // only at the next ME terminal. No-op outside an active co-op run (guarded inside).
    const coopShareAcquisition = <T>(v: T): T => {
      coopBroadcastDexSync();
      return v;
    };
    return this.setPokemonSpeciesCaught(
      pokemon,
      dexSpecies,
      incrementCount,
      fromEgg,
      showMessage,
      // The redux formIndex bit means nothing on the single-form counterpart:
      // register its DEFAULT form alongside the mon's gender/shiny/variant bits.
      reduxCounterpartId === undefined ? undefined : (pokemon.getDexAttr() & 127n) | DexAttr.DEFAULT_FORM,
    ).then(coopShareAcquisition);
  }

  /**
   *
   * @param pokemon
   * @param species
   * @param incrementCount
   * @param fromEgg
   * @param showMessage
   * @returns `true` if Pokemon catch unlocked a new starter, `false` if Pokemon catch did not unlock a starter
   */
  // TODO: This logic should emphatically go somewhere else
  private async setPokemonSpeciesCaught(
    pokemon: Pokemon,
    species: PokemonSpecies,
    incrementCount = true,
    fromEgg = false,
    showMessage = true,
    // ER (#410): redux-form catches register their RDX counterpart species,
    // whose dex bits differ from the mon's own (the redux formIndex bit does
    // not exist there) - the caller passes the corrected attr.
    dexAttrOverride?: bigint,
  ): Promise<boolean> {
    const dexEntry = this.dexData[species.speciesId];
    const caughtAttr = dexEntry.caughtAttr;
    const formIndex = pokemon.formIndex;

    // This makes sure that we do not try to unlock data which cannot be unlocked
    const dexAttr = (dexAttrOverride ?? pokemon.getDexAttr()) & species.getFullUnlocksData();

    // Mark as caught
    dexEntry.caughtAttr |= dexAttr;

    // All That Glitters: a shiny was just recorded to the dex. Fired only on a
    // shiny acquisition EVENT (never at load); the achv's conditionFunc gates on
    // owning a shiny of all three variant tiers. validateAchv dedupes, so the
    // prevolution recursion below can call this again harmlessly.
    if (pokemon.isShiny()) {
      globalScene.validateAchv(achvs.ALL_SHINY_TIERS);
    }

    // If the caught form is a battleform, we want to also mark the base form as caught.
    // This snippet assumes that the base form has formIndex equal to 0, which should be
    // always true except for the case of Urshifu.
    const formKey = pokemon.getFormKey();
    if (formIndex > 0) {
      // In case a Pikachu with formIndex > 0 was unlocked, base form Pichu is also unlocked
      if (pokemon.species.speciesId === SpeciesId.PIKACHU && species.speciesId === SpeciesId.PICHU) {
        dexEntry.caughtAttr |= globalScene.gameData.getFormAttr(0);
      }
      if (pokemon.species.speciesId === SpeciesId.URSHIFU) {
        if (formIndex === 2) {
          dexEntry.caughtAttr |= globalScene.gameData.getFormAttr(0);
        } else if (formIndex === 3) {
          dexEntry.caughtAttr |= globalScene.gameData.getFormAttr(1);
        }
      } else if (pokemon.species.speciesId === SpeciesId.ZYGARDE) {
        if (formIndex === 4) {
          dexEntry.caughtAttr |= globalScene.gameData.getFormAttr(2);
        } else if (formIndex === 5) {
          dexEntry.caughtAttr |= globalScene.gameData.getFormAttr(3);
        }
      } else {
        const allFormChanges = Object.hasOwn(pokemonFormChanges, species.speciesId)
          ? pokemonFormChanges[species.speciesId]
          : [];
        const toCurrentFormChanges = allFormChanges.filter(f => f.formKey === formKey);
        if (toCurrentFormChanges.length > 0) {
          // Needs to do this or Castform can unlock the wrong form, etc.
          dexEntry.caughtAttr |= globalScene.gameData.getFormAttr(0);
        }
      }
    }

    // Unlock ability
    if (Object.hasOwn(speciesStarterCosts, species.speciesId)) {
      this.getStarterDataEntry(species.speciesId).abilityAttr |=
        pokemon.abilityIndex !== 1 || pokemon.species.ability2 ? 1 << pokemon.abilityIndex : AbilityAttr.ABILITY_HIDDEN;
    }

    // Unlock nature
    dexEntry.natureAttr |= 1 << (pokemon.nature + 1);

    const prevolution = pokemonPrevolutions[species.speciesId];
    const hasPrevolution = prevolution != null;
    const newCatch = !caughtAttr;
    const hasNewAttr = (caughtAttr & dexAttr) !== dexAttr;

    if (incrementCount) {
      if (fromEgg) {
        dexEntry.hatchedCount++;
        this.gameStats.pokemonHatched++;
        if (pokemon.species.subLegendary) {
          this.gameStats.subLegendaryPokemonHatched++;
        } else if (pokemon.species.legendary) {
          this.gameStats.legendaryPokemonHatched++;
        } else if (pokemon.species.mythical) {
          this.gameStats.mythicalPokemonHatched++;
        }
        if (pokemon.isShiny()) {
          this.gameStats.shinyPokemonHatched++;
        }
      } else {
        dexEntry.caughtCount++;
        this.gameStats.pokemonCaught++;
        if (pokemon.species.subLegendary) {
          this.gameStats.subLegendaryPokemonCaught++;
        } else if (pokemon.species.legendary) {
          this.gameStats.legendaryPokemonCaught++;
        } else if (pokemon.species.mythical) {
          this.gameStats.mythicalPokemonCaught++;
        }
        if (pokemon.isShiny()) {
          this.gameStats.shinyPokemonCaught++;
        }
      }

      if (!hasPrevolution && (!globalScene.gameMode.isDaily || hasNewAttr || fromEgg)) {
        // TODO: remove `?? 0`, `pokemon.variant` shouldn't be able to be nullish
        const shinyBonus = pokemon.isShiny() ? 5 * Math.pow(2, pokemon.variant ?? 0) : 1;
        const eggOrBossBonus = fromEgg || pokemon.isBoss() ? 2 : 1;
        this.addStarterCandy(species.speciesId, shinyBonus * eggOrBossBonus, fromEgg);
      }
    }

    const checkPrevolution = async (newStarter: boolean) => {
      if (prevolution == null) {
        return newStarter;
      }
      return await this.setPokemonSpeciesCaught(
        pokemon,
        getPokemonSpecies(prevolution),
        incrementCount,
        fromEgg,
        showMessage,
        dexAttrOverride,
      );
    };

    if (!newCatch || !Object.hasOwn(speciesStarterCosts, species.speciesId)) {
      return await checkPrevolution(false);
    }
    // TODO: This will skip unlocking a pre-evolution if the player catches an evolved form that is itself a starter.
    // (This only affects Pikachu, which is the only evolved starter Pokemon, but should be fixed anyways)
    // Better yet, rework this entire function to not do 10 different things at once
    if (!showMessage) {
      return true;
    }
    globalScene.playSound("level_up_fanfare");

    // TODO: Remove and replace with a simpler check if the return value is found to be unnecessary
    return new Promise(resolve =>
      globalScene.ui.showText(
        i18next.t("battle:addedAsAStarter", { pokemonName: species.name }),
        null,
        async () => resolve(await checkPrevolution(true)),
        null,
        true,
      ),
    );
  }

  /**
   * Increase the number of classic ribbons won with this species.
   * @param species - The species to increment the ribbon count for
   * @param forStarter - If true, will increment the ribbon count for the root species of the given species
   * @returns The number of classic wins after incrementing.
   */
  incrementRibbonCount(species: PokemonSpecies, forStarter = false): number {
    const speciesIdToIncrement: SpeciesId = species.getRootSpeciesId(forStarter);
    const starterEntry = this.getStarterDataEntry(speciesIdToIncrement);

    if (!starterEntry.classicWinCount) {
      starterEntry.classicWinCount = 0;
    }

    if (!starterEntry.classicWinCount) {
      globalScene.gameData.gameStats.ribbonsOwned++;
    }

    const ribbonsInStats: number = globalScene.gameData.gameStats.ribbonsOwned;

    if (ribbonsInStats >= 100) {
      globalScene.validateAchv(achvs._100_RIBBONS);
    }
    if (ribbonsInStats >= 75) {
      globalScene.validateAchv(achvs._75_RIBBONS);
    }
    if (ribbonsInStats >= 50) {
      globalScene.validateAchv(achvs._50_RIBBONS);
    }
    if (ribbonsInStats >= 25) {
      globalScene.validateAchv(achvs._25_RIBBONS);
    }
    if (ribbonsInStats >= 10) {
      globalScene.validateAchv(achvs._10_RIBBONS);
    }

    return ++starterEntry.classicWinCount;
  }

  /**
   * Adds candy to the player's game data for a given {@linkcode PokemonSpecies}.
   * @remarks
   * Will not increase the candy count past {@linkcode MAX_STARTER_CANDY_COUNT}.
   * @param fromEgg - Whether this candy comes from hatching an egg. Egg-hatch candy
   *   does NOT inherit the run's challenge-favour multiplier (see below).
   * @returns Whether the candy count was incremented
   */
  public addStarterCandy(speciesId: SpeciesId, count: number, fromEgg = false): boolean {
    // ER: route a custom MEGA form id to its base so the candy lands on the base
    // bucket AND the candy bar (which does a raw starterData[id] read) is handed
    // an id whose bucket getStarterDataEntry just guaranteed.
    const baseId = (erMegaTargetToBaseSpeciesId(speciesId) ?? speciesId) as SpeciesId;
    const starterEntry = this.getStarterDataEntry(baseId);
    const { candyCount } = starterEntry;

    if (candyCount >= MAX_STARTER_CANDY_COUNT) {
      return false;
    }

    // Elite Redux candy buffs: a flat ~35% across-the-board boost, plus the
    // current run's challenge-favour candy multiplier (same curve as shiny, up
    // to 3×). A positive gain never rounds down to 0.
    //
    // The favour multiplier is a RUN-scoped reward for handicapping yourself in
    // a challenge run, so it only applies to candy earned IN the run (catches,
    // bosses, classic wins, friendship). Egg-hatch candy comes from eggs that
    // were stockpiled outside the run, so it must NOT inherit the favour bonus —
    // otherwise hatching a backlog of eggs during a trivial high-favour challenge
    // would farm triple candy. Egg hatches still keep the always-on flat 35%.
    if (count > 0) {
      const favourMultiplier = fromEgg ? 1 : getRunCandyMultiplier();
      // #402: the lower difficulties' dedicated perk is CANDY (Youngster 2x,
      // Ace 1.5x). Run-scoped like favour, so egg-hatch backlogs are excluded.
      const difficultyMultiplier = fromEgg ? 1 : getErDifficultyCandyMultiplier();
      count = Math.max(1, Math.round(count * ER_CANDY_GAIN_MULTIPLIER * favourMultiplier * difficultyMultiplier));
    }

    // The ROOT id, not speciesId: the candy bar does a raw starterData[id] read, and
    // getStarterDataEntry only guarantees (and increments) the evolution-line ROOT
    // bucket - e.g. candy granted to SNORLAX lives under MUNCHLAX. Passing the raw id
    // crashes the bar (`candyCount` of undefined) whenever that id has no bucket of
    // its own - the wave-won achievement candy-grant black-screen class - and would
    // display the wrong count even when it doesn't crash.
    globalScene.candyBar.showStarterSpeciesCandy(this.getRootStarterSpeciesId(baseId), count);
    starterEntry.candyCount = Math.min(candyCount + count, MAX_STARTER_CANDY_COUNT);

    return true;
  }

  /**
   * @param showMessage - (Default `true`) Whether to display a message for the unlocked egg move
   * @param prependSpeciesToMessage - (Default `false`) Whether to change the message from "X Egg Move Unlocked!" to "Bulbasaur X Egg Move Unlocked!"
   */
  async setEggMoveUnlocked(
    species: PokemonSpecies,
    eggMoveIndex: number,
    showMessage = true,
    prependSpeciesToMessage = false,
  ): Promise<boolean> {
    const { speciesId } = species;
    if (!Object.hasOwn(speciesEggMoves, speciesId) || !speciesEggMoves[speciesId][eggMoveIndex]) {
      return false;
    }

    const starterEntry = this.getStarterDataEntry(speciesId);
    if (!starterEntry.eggMoves) {
      starterEntry.eggMoves = 0;
    }

    const value = 1 << eggMoveIndex;

    if (starterEntry.eggMoves & value) {
      return false;
    }

    starterEntry.eggMoves |= value;
    if (!showMessage) {
      return true;
    }
    globalScene.playSound("level_up_fanfare");
    const moveName = allMoves[speciesEggMoves[speciesId][eggMoveIndex]].name;
    let message = prependSpeciesToMessage ? species.getName() + " " : "";
    message +=
      eggMoveIndex === 3
        ? i18next.t("egg:rareEggMoveUnlock", { moveName })
        : i18next.t("egg:eggMoveUnlock", { moveName });

    return new Promise(resolve => globalScene.ui.showText(message, null, () => resolve(true), null, true));
  }

  /** Return whether the root species of a given `PokemonSpecies` has been unlocked in the dex */
  isRootSpeciesUnlocked(species: PokemonSpecies): boolean {
    return !!this.dexData[species.getRootSpeciesId()]?.caughtAttr;
  }

  /**
   * Unlocks the given {@linkcode Nature} for a {@linkcode PokemonSpecies} and its prevolutions.
   * Will fail silently if root species has not been unlocked
   */
  unlockSpeciesNature(species: PokemonSpecies, nature: Nature): void {
    if (!this.isRootSpeciesUnlocked(species)) {
      return;
    }

    //recursively unlock nature for species and prevolutions
    let { speciesId } = species;
    do {
      this.dexData[speciesId].natureAttr |= 1 << (nature + 1);
      speciesId = pokemonPrevolutions[speciesId];
    } while (speciesId != null);
  }

  updateSpeciesDexIvs(speciesId: SpeciesId, ivs: number[]): void {
    let dexEntry: DexEntry;
    do {
      dexEntry = globalScene.gameData.dexData[speciesId];
      const dexIvs = dexEntry.ivs;
      for (let i = 0; i < dexIvs.length; i++) {
        dexIvs[i] = Math.max(dexIvs[i], ivs[i]);
      }
      if (dexIvs.every(iv => iv === 31)) {
        globalScene.validateAchv(achvs.PERFECT_IVS);
      }
      speciesId = pokemonPrevolutions[speciesId];
    } while (speciesId != null);
  }

  getSpeciesCount(dexEntryPredicate: (entry: DexEntry) => boolean): number {
    const dexKeys = Object.keys(this.dexData);
    let speciesCount = 0;
    for (const s of dexKeys) {
      if (dexEntryPredicate(this.dexData[s])) {
        speciesCount++;
      }
    }
    return speciesCount;
  }

  getStarterCount(dexEntryPredicate: (entry: DexEntry) => boolean): number {
    const starterKeys = Object.keys(speciesStarterCosts);
    let starterCount = 0;
    for (const s of starterKeys) {
      const starterDexEntry = this.dexData[s];
      if (dexEntryPredicate(starterDexEntry)) {
        starterCount++;
      }
    }
    return starterCount;
  }

  getSpeciesDefaultDexAttr(species: PokemonSpecies, _forSeen = false, optimistic = false): bigint {
    let ret = 0n;
    const dexEntry = this.dexData[species.speciesId];
    const attr = dexEntry.caughtAttr;
    if (optimistic) {
      if (attr & DexAttr.SHINY) {
        ret |= DexAttr.SHINY;

        if (attr & DexAttr.VARIANT_3) {
          ret |= DexAttr.VARIANT_3;
        } else if (attr & DexAttr.VARIANT_2) {
          ret |= DexAttr.VARIANT_2;
        } else {
          ret |= DexAttr.DEFAULT_VARIANT;
        }
      } else {
        ret |= DexAttr.NON_SHINY;
        ret |= DexAttr.DEFAULT_VARIANT;
      }
    } else {
      // Default to non shiny. Fallback to shiny if it's the only thing that's unlocked
      ret |= attr & DexAttr.NON_SHINY || !(attr & DexAttr.SHINY) ? DexAttr.NON_SHINY : DexAttr.SHINY;

      if (attr & DexAttr.DEFAULT_VARIANT) {
        ret |= DexAttr.DEFAULT_VARIANT;
      } else if (attr & DexAttr.VARIANT_2) {
        ret |= DexAttr.VARIANT_2;
      } else if (attr & DexAttr.VARIANT_3) {
        ret |= DexAttr.VARIANT_3;
      } else {
        ret |= DexAttr.DEFAULT_VARIANT;
      }
    }
    ret |= attr & DexAttr.MALE || !(attr & DexAttr.FEMALE) ? DexAttr.MALE : DexAttr.FEMALE;
    ret |= this.getFormAttr(this.getFormIndex(attr));
    return ret;
  }

  getSpeciesDexAttrProps(_species: PokemonSpecies, dexAttr: bigint): DexAttrProps {
    const shiny = !(dexAttr & DexAttr.NON_SHINY);
    const female = !(dexAttr & DexAttr.MALE);
    let variant: Variant = 0;
    if (dexAttr & DexAttr.DEFAULT_VARIANT) {
      variant = 0;
    } else if (dexAttr & DexAttr.VARIANT_2) {
      variant = 1;
    } else if (dexAttr & DexAttr.VARIANT_3) {
      variant = 2;
    }
    const formIndex = this.getFormIndex(dexAttr);

    return {
      shiny,
      female,
      variant,
      formIndex,
    };
  }

  getStarterSpeciesDefaultAbilityIndex(species: PokemonSpecies, abilityAttr?: number): number {
    abilityAttr ??= this.getStarterDataEntry(species.speciesId).abilityAttr;
    return abilityAttr & AbilityAttr.ABILITY_1 ? 0 : !species.ability2 || abilityAttr & AbilityAttr.ABILITY_2 ? 1 : 2;
  }

  getSpeciesDefaultNature(species: PokemonSpecies, dexEntry?: DexEntry): Nature {
    dexEntry ??= this.dexData[species.speciesId];
    for (let n = 0; n < 25; n++) {
      if (dexEntry.natureAttr & (1 << (n + 1))) {
        return n as Nature;
      }
    }
    return 0 as Nature;
  }

  getSpeciesDefaultNatureAttr(species: PokemonSpecies): number {
    return 1 << this.getSpeciesDefaultNature(species);
  }

  getDexAttrLuck(dexAttr: bigint): number {
    return dexAttr & DexAttr.SHINY ? (dexAttr & DexAttr.VARIANT_3 ? 3 : dexAttr & DexAttr.VARIANT_2 ? 2 : 1) : 0;
  }

  getNaturesForAttr(natureAttr = 0): Nature[] {
    const ret: Nature[] = [];
    for (let n = 0; n < 25; n++) {
      if (natureAttr & (1 << (n + 1))) {
        ret.push(n);
      }
    }
    return ret;
  }

  /**
   * Obtain the value of a particular starter by SpeciesID
   * @param speciesId - The {@linkcode SpeciesId} of the starter
   * @param valueReduction - The applied value reduction; defaults to the value stored in `this.starterData[speciesId].valueReduction`
   * @returns The value/cost of the starter
   * @privateRemarks
   * `valueReduction` only needs to be provided when testing a value reduction other than the one currently unlocked
   */
  getSpeciesStarterValue(speciesId: SpeciesId, valueReduction?: number): number {
    // ER-custom species (id >= 10000) aren't in `speciesStarterCosts` —
    // default to 4 (matching mid-tier starters) so the dex filter loop
    // doesn't NaN-out and silently drop the row. Real cost assignment for
    // ER customs is a follow-up.
    const baseValue = speciesStarterCosts[speciesId] ?? 4;
    const reduction = valueReduction ?? this.starterData[speciesId]?.valueReduction ?? 0;
    let value = baseValue;

    const decrementValue = (v: number) => {
      if (v > 1) {
        v--;
      } else {
        v /= 2;
      }
      return v;
    };

    for (let v = 0; v < reduction; v++) {
      value = decrementValue(value);
    }

    const cost = new NumberHolder(value);
    applyChallenges(ChallengeType.STARTER_COST, speciesId, cost);

    return cost.value;
  }

  getFormIndex(attr: bigint): number {
    if (!attr || attr < DexAttr.DEFAULT_FORM) {
      return 0;
    }
    let f = 0;
    while (!(attr & this.getFormAttr(f))) {
      f++;
    }
    return f;
  }

  getFormAttr(formIndex: number): bigint {
    return BigInt(1) << BigInt(7 + formIndex);
  }

  consolidateDexData(dexData: DexData): void {
    for (const k of Object.keys(dexData)) {
      const entry = dexData[k] as DexEntry;
      if (!Object.hasOwn(entry, "hatchedCount")) {
        entry.hatchedCount = 0;
      }
      if (!Object.hasOwn(entry, "natureAttr") || (entry.caughtAttr && !entry.natureAttr)) {
        entry.natureAttr = this.defaultDexData?.[k].natureAttr || 1 << randInt(25, 1);
      }
      if (!Object.hasOwn(entry, "ribbons")) {
        entry.ribbons = new RibbonData(0);
      }
    }
  }

  migrateStarterAbilities(systemData: SystemSaveData, initialStarterData?: StarterData): void {
    const starterIds = Object.keys(this.starterData).map(s => Number.parseInt(s) as SpeciesId);
    const starterData = initialStarterData || systemData.starterData;
    const dexData = systemData.dexData;
    for (const s of starterIds) {
      const dexAttr = dexData[s].caughtAttr;
      starterData[s].abilityAttr =
        (dexAttr & DexAttr.DEFAULT_VARIANT ? AbilityAttr.ABILITY_1 : 0)
        | (dexAttr & DexAttr.VARIANT_2 ? AbilityAttr.ABILITY_2 : 0)
        | (dexAttr & DexAttr.VARIANT_3 ? AbilityAttr.ABILITY_HIDDEN : 0);
      if (dexAttr) {
        if (!(dexAttr & DexAttr.DEFAULT_VARIANT)) {
          dexData[s].caughtAttr ^= DexAttr.DEFAULT_VARIANT;
        }
        if (dexAttr & DexAttr.VARIANT_2) {
          dexData[s].caughtAttr ^= DexAttr.VARIANT_2;
        }
        if (dexAttr & DexAttr.VARIANT_3) {
          dexData[s].caughtAttr ^= DexAttr.VARIANT_3;
        }
      }
    }
  }
}
