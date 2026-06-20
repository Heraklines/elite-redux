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
import { migrateErRemovedFormUnlocks } from "#data/elite-redux/er-egg-pool-bans";
import { getErMapSaveData, restoreErMapState } from "#data/elite-redux/er-map-nodes";
import { getErMoneyStreakEntries, restoreErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import { getErReduxCounterpartId, migrateErReduxDexHijack } from "#data/elite-redux/er-redux-dex-redirect";
import { getErResistBerryEntries, restoreErResistBerries } from "#data/elite-redux/er-resist-berries";
import { getErDifficulty, getErDifficultyCandyMultiplier, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { ER_CANDY_GAIN_MULTIPLIER, getRunCandyMultiplier } from "#data/elite-redux/er-shiny-favour";
import { getErUsedTrainerKeys, restoreErRunTrainerTracking } from "#data/elite-redux/er-trainer-runtime-hook";
import { getErWardStoneEntries, restoreErWardStones } from "#data/elite-redux/er-ward-stones";
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
};

const CLOUD_SYNC_MIN_INTERVAL_MS = 20 * 60 * 1000;
const CLOUD_SYNC_BACKOFF_BASE_MS = 20 * 60 * 1000;
const CLOUD_SYNC_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

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
    this.autoEggRestock = defaultAutoEggRestockSettings();
    this.llmDirectorState = defaultDirectorState();
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
      freeLegendaryEggsGranted: this.freeLegendaryEggsGranted,
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

    localStorage.setItem(`data_${loggedInUser?.username}`, encrypt(systemData, bypassLogin));

    if (bypassLogin) {
      globalScene.ui.savingIcon.hide();
      return true;
    }

    if (!forceSync && !this.shouldAttemptCloudSync()) {
      globalScene.ui.savingIcon.hide();
      return true;
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
      saveDataOrErr,
      cachedSystem ? AES.decrypt(cachedSystem, saveKey).toString(enc.Utf8) : undefined,
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
      const error = await pokerogueApi.savedata.session.update(
        {
          slot: session.slot,
          trainerId: this.trainerId,
          secretId: this.secretId,
          clientSessionId,
        },
        session.data,
      );
      if (error) {
        console.error(error);
        success = false;
        continue;
      }
      localStorage.setItem(getSessionDataLocalStorageKey(session.slot), encrypt(session.data, bypassLogin));
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
    this.clearLocalData();
    return false;
  }

  public clearLocalData(): void {
    if (bypassLogin) {
      return;
    }
    localStorage.removeItem(`data_${loggedInUser?.username}`);
    for (let s = 0; s < 5; s++) {
      localStorage.removeItem(getSessionDataLocalStorageKey(s));
    }
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
    return {
      seed: globalScene.seed,
      playTime: globalScene.sessionPlayTime,
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
      // ER (#357): persist the player's stolen resist berries (runtime ER
      // modifier types are dropped by the vanilla modifier registry on load).
      erResistBerries: getErResistBerryEntries(),
      // ER (#358): persist the player's Ward Stones incl. charge state.
      erWardStones: getErWardStoneEntries(),
      // ER (#486): persist the run's Map state (revealed nodes / travel target /
      // Treasure-Map fragments) - run-scoped module state a reload would wipe.
      erMapState: getErMapSaveData(),
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
    const response = await pokerogueApi.savedata.session.get({ slot: slotId, clientSessionId });

    // TODO: This is a far cry from proper JSON validation
    if (response == null || response.length === 0 || response.charAt(0) !== "{") {
      console.error("Invalid save data JSON detected!", response);
      return;
    }

    localStorage.setItem(getSessionDataLocalStorageKey(slotId), encrypt(response, bypassLogin));

    return this.parseSessionData(response);
  }

  async renameSession(slotId: number, newName: string): Promise<boolean> {
    if (slotId < 0) {
      return false;
    }
    // TODO: Why do we consider renaming to an empty string successful if it does nothing?
    if (newName === "") {
      return true;
    }
    const sessionData = await this.getSession(slotId);
    if (!sessionData) {
      return false;
    }

    sessionData.name = newName;
    // update timestamp by 1 to ensure the session is saved
    sessionData.timestamp += 1;
    const updatedDataStr = JSON.stringify(sessionData);
    const encrypted = encrypt(updatedDataStr, bypassLogin);
    const secretId = this.secretId;
    const trainerId = this.trainerId;

    if (bypassLogin) {
      localStorage.setItem(getSessionDataLocalStorageKey(slotId), encrypt(updatedDataStr, bypassLogin));
      return true;
    }

    const response = await pokerogueApi.savedata.session.update(
      { slot: slotId, trainerId, secretId, clientSessionId },
      updatedDataStr,
    );

    if (response) {
      return false;
    }
    localStorage.setItem(getSessionDataLocalStorageKey(slotId), encrypted);
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
    this.initSessionFromData(sessionData);
    return true;
  }

  // TODO: This needs a giant refactor and overhaul
  private async initSessionFromData(fromSession: SessionSaveData): Promise<void> {
    if (isBeta || isDev) {
      try {
        console.debug(
          this.parseSessionData(JSON.stringify(fromSession, (_, v: any) => (typeof v === "bigint" ? v.toString() : v))),
        );
      } catch (err) {
        console.debug("Attempt to log session data failed: ", err);
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
    // ER (#486): restore the run's Map state (revealed nodes / travel target /
    // fragments). Tolerant of older saves with no field (clean, empty map).
    restoreErMapState(fromSession.erMapState, fromSession.waveIndex);

    globalScene.setSeed(fromSession.seed || globalScene.game.config.seed[0]);
    globalScene.resetSeed();

    console.log("Seed:", globalScene.seed);

    globalScene.gameMode.trySetCustomDailyConfig(JSON.stringify(fromSession.dailyConfig));

    globalScene.sessionPlayTime = fromSession.playTime || 0;
    globalScene.lastSavePlayTime = 0;

    const loadPokemonAssets: Promise<void>[] = [];

    const party = globalScene.getPlayerParty();
    party.splice(0, party.length);

    for (const p of fromSession.party) {
      const pokemon = p.toPokemon() as PlayerPokemon;
      pokemon.setVisible(false);
      loadPokemonAssets.push(pokemon.loadAssets(false));
      party.push(pokemon);
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

    fromSession.enemyParty.forEach((enemyData, e) => {
      const enemyPokemon = enemyData.toPokemon(
        battleType,
        e,
        fromSession.trainer?.variant === TrainerVariant.DOUBLE,
      ) as EnemyPokemon;
      battle.enemyParty[e] = enemyPokemon;
      if (battleType === BattleType.WILD) {
        battle.seenEnemyPartyMemberIds.add(enemyPokemon.id);
      }

      loadPokemonAssets.push(enemyPokemon.loadAssets());
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

    await Promise.all(loadPokemonAssets);
  }

  /**
   * Delete the session data at the given slot when overwriting a save file
   * For deleting the session of a finished run, use {@linkcode tryClearSession}
   * @param slotId - The slot to clear
   * @returns A Promise that resolves with whether the session deletion succeeded
   */
  async deleteSession(slotId: number): Promise<boolean> {
    if (bypassLogin) {
      localStorage.removeItem(getSessionDataLocalStorageKey(slotId));
      return true;
    }

    const [success] = await updateUserInfo();
    if (!success) {
      return false;
    }

    const error = await pokerogueApi.savedata.session.delete({ slot: slotId, clientSessionId });
    if (!error) {
      if (loggedInUser) {
        loggedInUser.lastSessionSlot = -1;
      }

      localStorage.removeItem(getSessionDataLocalStorageKey(slotId));
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
    const [userOk] = await updateUserInfo();

    if (bypassLogin) {
      localStorage.removeItem(getSessionDataLocalStorageKey(slotId));
      return [true, true];
    }

    let newClear = false;
    if (userOk) {
      const sessionData = this.getSessionSaveData();
      const { trainerId } = this;
      const jsonResponse = await pokerogueApi.savedata.session.clear(
        { slot: slotId, trainerId, clientSessionId },
        sessionData,
      );

      if (jsonResponse.error) {
        if (jsonResponse.error.startsWith("session out of date")) {
          // A newer session exists server-side: queue a reload to reconcile and
          // KEEP the local copy so the reload has data to load. Do NOT wipe.
          globalScene.phaseManager.clearPhaseQueue();
          globalScene.phaseManager.unshiftNew("ReloadSessionPhase");
          console.error(jsonResponse);
          return [false, false];
        }
        // Any other server failure (offline / Worker error / auth): fall through
        // and clear the run LOCALLY anyway. A FINISHED run must never remain
        // continuable — otherwise "Continue" reloads the dead party and the run
        // immediately game-overs back to the title, forever (the ER prod
        // login-required regression: clearing used to bail here and leave the
        // dead session in place). Server-side staleness self-heals on next save.
        console.error(jsonResponse);
      } else {
        newClear = !!jsonResponse.success;
      }
    }

    // Always wipe a finished run locally (server reachable or not). Returning
    // `true` lets PostGameOverPhase proceed cleanly to the title instead of
    // hard-resetting back into the un-cleared session.
    localStorage.removeItem(getSessionDataLocalStorageKey(slotId));
    if (loggedInUser) {
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
    if (!skipVerification) {
      const [success] = await updateUserInfo();
      if (!success) {
        return false;
      }
    }

    const shouldCloudSync = sync && !bypassLogin && (forceSync || this.shouldAttemptCloudSync());

    // ER (#389): reset the cloud-push failure signal for this save attempt -
    // Save and Quit reads it to warn the player when their force-push to the
    // cloud did NOT go through (the save is local-only until the next retry).
    this.lastCloudSyncFailed = false;

    if (shouldCloudSync) {
      globalScene.ui.savingIcon.show();
    }

    const sessionData = useCachedSession
      ? this.parseSessionData(
          decrypt(localStorage.getItem(getSessionDataLocalStorageKey(globalScene.sessionSlotId))!, bypassLogin),
        ) // TODO: is this bang correct?
      : this.getSessionSaveData();

    const maxIntAttrValue = 0x80000000;

    const systemData = useCachedSystem
      ? GameData.parseSystemData(decrypt(localStorage.getItem(`data_${loggedInUser?.username}`)!, bypassLogin))
      : this.getSystemSaveData(); // TODO: is this bang correct?

    const request = {
      system: systemData,
      session: sessionData,
      sessionSlotId: globalScene.sessionSlotId,
      clientSessionId,
    };

    localStorage.setItem(
      `data_${loggedInUser?.username}`,
      encrypt(
        JSON.stringify(systemData, (_k: any, v: any) =>
          typeof v === "bigint" ? (v <= maxIntAttrValue ? Number(v) : v.toString()) : v,
        ),
        bypassLogin,
      ),
    );

    localStorage.setItem(
      getSessionDataLocalStorageKey(globalScene.sessionSlotId),
      encrypt(JSON.stringify(sessionData), bypassLogin),
    );

    console.debug(`Session data saved to slot ${globalScene.sessionSlotId}!`);

    if (bypassLogin || !shouldCloudSync) {
      globalScene.ui.savingIcon.hide();
      return true;
    }

    const saveError = await pokerogueApi.savedata.updateAll(request);
    globalScene.ui.savingIcon.hide();

    if (!saveError) {
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
              () => {
                localStorage.setItem(dataKey, encrypt(dataStr, bypassLogin));

                if (!bypassLogin && dataType < GameDataType.SETTINGS) {
                  updateUserInfo().then(success => {
                    if (!success[0]) {
                      return displayError(i18next.t("menuUiHandler:importNoServer", { dataName }));
                    }
                    const { trainerId, secretId } = this;
                    let updatePromise: Promise<string | null>;
                    if (dataType === GameDataType.SESSION) {
                      updatePromise = pokerogueApi.savedata.session.update(
                        {
                          slot: slotId,
                          trainerId,
                          secretId,
                          clientSessionId,
                        },
                        dataStr,
                      );
                    } else {
                      updatePromise = pokerogueApi.savedata.system.update(
                        { trainerId, secretId, clientSessionId },
                        dataStr,
                      );
                    }
                    updatePromise.then(error => {
                      if (error) {
                        console.error(error);
                        return displayError(i18next.t("menuUiHandler:importError", { dataName }));
                      }
                      window.location.reload();
                    });
                  });
                } else {
                  window.location.reload();
                }
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

  public getStarterDataEntry(speciesId: number): StarterDataEntry {
    // Normalize to the evolution line's ROOT so candy + passive/ability unlocks
    // pool under ONE key and survive evolution. Without this, any line with a
    // baby pre-evo (Pichu->Pikachu->Raichu, Cleffa->Clefairy, ...) scattered
    // candy and unlocks across stages - the in-battle Abilities page reads the
    // root and showed everything "Locked - unlock with candy" even after paying.
    // Falls back to the raw id for synthetic/custom species not in the table.
    const rootId = getPokemonSpecies(speciesId)?.getRootSpeciesId() ?? speciesId;
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
      const rootId = species.getRootSpeciesId();
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
    return this.setPokemonSpeciesCaught(
      pokemon,
      dexSpecies,
      incrementCount,
      fromEgg,
      showMessage,
      // The redux formIndex bit means nothing on the single-form counterpart:
      // register its DEFAULT form alongside the mon's gender/shiny/variant bits.
      reduxCounterpartId === undefined ? undefined : (pokemon.getDexAttr() & 127n) | DexAttr.DEFAULT_FORM,
    );
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
    const starterEntry = this.getStarterDataEntry(speciesId);
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

    globalScene.candyBar.showStarterSpeciesCandy(speciesId, count);
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
