import { FixedBattleConfig } from "#app/battle";
import { CHALLENGE_MODE_MYSTERY_ENCOUNTER_WAVES, CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { allChallenges, type Challenge, copyChallenge } from "#data/challenge";
import {
  getDailyEventSeedBoss,
  getDailyForcedWaveSpecies,
  getDailyStartingBiome,
  getDailyStartingMoney,
  getDailyTrainerManipulation,
} from "#data/daily-seed/daily-run";
import { parseDailySeed } from "#data/daily-seed/daily-seed-utils";
import { allSpecies } from "#data/data-lists";
import { erBalanceMap, erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { erForcesTrainerWave } from "#data/elite-redux/er-battle-frequency";
import { erBiomeTrainerRateMult } from "#data/elite-redux/er-biome-encounters";
import { erNotorietyTrainerChancePct } from "#data/elite-redux/er-biome-notoriety";
import { erBiomeRoutingActive } from "#data/elite-redux/er-biome-routing";
import type { PokemonSpecies } from "#data/pokemon-species";
import { BiomeId } from "#enums/biome-id";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { classicFixedBattles, type FixedBattleConfigs } from "#trainers/fixed-battle-configs";
import type { CustomDailyRunConfig } from "#types/daily-run";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder, randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

interface GameModeConfig {
  isClassic?: boolean;
  isEndless?: boolean;
  isDaily?: boolean;
  hasTrainers?: boolean;
  hasNoShop?: boolean;
  hasShortBiomes?: boolean;
  hasRandomBiomes?: boolean;
  hasRandomBosses?: boolean;
  isSplicedOnly?: boolean;
  isChallenge?: boolean;
  hasMysteryEncounters?: boolean;
  /** True for the LLM Director mode (per-run story arcs). */
  isLLMDirector?: boolean;
  /** True for the 2-player Co-op mode (#633). Classic-like, but a shared run
   *  driven by two players over a P2P transport (doubles, 3 mons each). */
  isCoop?: boolean;
  /** True for the Showdown mode: a single ephemeral 1v1 duel at level 100 (no
   *  shops, no exp progression, no waves beyond the first, not a saved run). */
  isShowdown?: boolean;
  /** Excludes this mode from daily-seed/leaderboard logic. */
  nonDeterministic?: boolean;
}

export class GameMode implements GameModeConfig {
  public modeId: GameModes;
  public isClassic: boolean;
  public isEndless: boolean;
  public isDaily: boolean;
  public dailyConfig?: CustomDailyRunConfig | undefined;
  public hasTrainers: boolean;
  public hasNoShop: boolean;
  public hasShortBiomes: boolean;
  public hasRandomBiomes: boolean;
  public hasRandomBosses: boolean;
  public isSplicedOnly: boolean;
  public isChallenge: boolean;
  public challenges: Challenge[];
  public battleConfig: FixedBattleConfigs;
  public hasMysteryEncounters: boolean;
  public minMysteryEncounterWave: number;
  public maxMysteryEncounterWave: number;
  public isLLMDirector: boolean;
  public isCoop: boolean;
  public isShowdown: boolean;
  public nonDeterministic: boolean;

  constructor(modeId: GameModes, config: GameModeConfig, battleConfig?: FixedBattleConfigs) {
    this.modeId = modeId;
    this.challenges = [];
    Object.assign(this, config);
    if (this.isChallenge) {
      this.challenges = allChallenges.map(c => copyChallenge(c));
    }
    this.battleConfig = battleConfig || {};
  }

  /**
   * Enables challenges if they are disabled and sets the specified challenge's value
   * @param challenge - The challenge to set
   * @param value - The value to give the challenge. Impact depends on the specific challenge
   * @param severity - If provided, will override the given severity amount. Unused if `challenge` does not use severity
   * @todo Add severity support to daily mode challenge setting
   */
  setChallengeValue(challenge: Challenges, value: number, severity?: number) {
    if (!this.isChallenge) {
      this.isChallenge = true;
      this.challenges = allChallenges.map(c => copyChallenge(c));
    }
    this.challenges
      .filter((chal: Challenge) => chal.id === challenge)
      .forEach(chal => {
        chal.value = value;
        if (chal.hasSeverity()) {
          chal.severity = severity ?? chal.severity;
        }
      });
  }

  /**
   * Helper function to see if a GameMode has a specific challenge type
   * @param challenge the Challenges it looks for
   * @returns true if the game mode has that challenge
   */
  hasChallenge(challenge: Challenges): boolean {
    return this.challenges.some(c => c.id === challenge && c.value !== 0);
  }

  /**
   * Helper function to see if a GameMode has any challenges, needed in tests
   * @returns true if the game mode has at least one challenge
   */
  hasAnyChallenges(): boolean {
    return this.challenges.length > 0;
  }

  /**
   * Helper function to see if the game mode is using fresh start
   * @returns true if a fresh start challenge is being applied
   */
  isFreshStartChallenge(): boolean {
    return this.hasChallenge(Challenges.FRESH_START);
  }

  /**
   * Helper function to see if the game mode is using fresh start
   * @returns true if a fresh start challenge is being applied
   */
  isFullFreshStartChallenge(): boolean {
    for (const challenge of this.challenges) {
      if (challenge.id === Challenges.FRESH_START && challenge.value === 1) {
        return true;
      }
    }
    return false;
  }

  /**
   * Helper function to get starting level for game mode.
   * @returns either:
   * - starting level override from overrides.ts
   * - 20 for Daily Runs
   * - 5 for all other modes
   */
  getStartingLevel(): number {
    if (Overrides.STARTING_LEVEL_OVERRIDE > 0) {
      return Overrides.STARTING_LEVEL_OVERRIDE;
    }
    switch (this.modeId) {
      case GameModes.DAILY:
        return 20;
      case GameModes.SHOWDOWN:
        // Single 1v1 duel is fought at a fixed high level.
        return 100;
      default:
        return 5;
    }
  }

  /** Return the normal player EXP cap for a specific wave. */
  getMaxExpLevelForWave(waveIndex: number): number {
    const roundedWave = Math.ceil(Math.max(1, waveIndex) / 10) * 10;
    const difficultyWaveIndex = this.getWaveForDifficulty(roundedWave);
    const baseLevel = (1 + difficultyWaveIndex / 2 + Math.pow(difficultyWaveIndex / 25, 2)) * 1.2;
    return Math.ceil(baseLevel / 2) * 2 + 2;
  }

  /**
   * @returns either:
   * - override from overrides.ts
   * - 1000
   * - override from a custom daily seed
   */
  getStartingMoney(): number {
    if (Overrides.STARTING_MONEY_OVERRIDE > 0) {
      return Overrides.STARTING_MONEY_OVERRIDE;
    }

    switch (this.modeId) {
      // biome-ignore lint/suspicious/noFallthroughSwitchClause: Intentional
      case GameModes.DAILY: {
        const dailyStartingMoney = getDailyStartingMoney();
        if (dailyStartingMoney != null) {
          return dailyStartingMoney;
        }
      }
      default:
        // Editor-tunable (vanilla.money.starting).
        return erBalanceNum("vanilla.money.starting");
    }
  }

  /**
   * @returns either:
   * - override from overrides.ts
   * - random biome for Daily mode
   * - Town
   */
  getStartingBiome(): BiomeId {
    if (Overrides.STARTING_BIOME_OVERRIDE != null) {
      return Overrides.STARTING_BIOME_OVERRIDE;
    }

    switch (this.modeId) {
      case GameModes.DAILY:
        return getDailyStartingBiome();
      default:
        return BiomeId.TOWN;
    }
  }

  getWaveForDifficulty(waveIndex: number, ignoreCurveChanges = false): number {
    switch (this.modeId) {
      case GameModes.DAILY:
        return waveIndex + 30 + (ignoreCurveChanges ? 0 : Math.floor(waveIndex / 5));
      default:
        return waveIndex;
    }
  }

  /**
   * Determines whether or not to generate a trainer
   * @param waveIndex - The current floor the player is on (trainer sprites fail to generate on X1 floors)
   * @returns Whether a trainer should be generated
   */
  public isWaveTrainer(waveIndex: number): boolean {
    const { arena, offsetGym } = globalScene;

    // Daily spawns trainers on floors 5, 15, 20, 25, 30, 35, 40, and 45
    if (this.isDaily) {
      const trainerManipulation = getDailyTrainerManipulation(waveIndex);
      if (trainerManipulation != null) {
        return trainerManipulation;
      }
      return waveIndex % 10 === 5 || (!(waveIndex % 10) && waveIndex > 10 && !this.isWaveFinal(waveIndex));
    }
    if (waveIndex % 30 === (offsetGym ? 0 : 20) && !this.isWaveFinal(waveIndex)) {
      return true;
    }
    if (waveIndex % 10 !== 1 && waveIndex % 10) {
      /**
       * Do not check X1 floors since there's a bug that stops trainer sprites from appearing
       * after a X0 full party heal, this also allows for a smoother biome transition for general gameplay feel
       */
      const trainerChance = arena.trainerChance;
      let allowTrainerBattle = true;
      if (trainerChance) {
        const waveBase = Math.floor(waveIndex / 10) * 10;
        // Stop generic trainers from spawning in within 2 waves of a fixed trainer battle
        for (let w = Math.max(waveIndex - 2, waveBase + 2); w <= Math.min(waveIndex + 2, waveBase + 10); w++) {
          if (w === waveIndex) {
            continue;
          }
          if (w % 30 === (offsetGym ? 0 : 20) || this.isFixedBattle(w)) {
            allowTrainerBattle = false;
            break;
          }
          if (w < waveIndex) {
            globalScene.executeWithSeedOffset(() => {
              const waveTrainerChance = arena.trainerChance;
              if (!randSeedInt(waveTrainerChance)) {
                allowTrainerBattle = false;
              }
            }, w);
            if (!allowTrainerBattle) {
              break;
            }
          }
        }
      }
      // ER (#439): the DOJO biome is trainer-DENSE - its "hall of fighters"
      // identity. Every eligible non-boss / non-fixed wave is a trainer battle
      // (on all difficulties; the trainers themselves still come from the normal
      // per-difficulty pool, so Ace/Youngster stay vanilla-sourced). The World
      // Tournament gauntlet is a SEPARATE special event (gated to Dojo+Metropolis),
      // not this passive density.
      if (
        arena?.biomeId === BiomeId.DOJO
        && allowTrainerBattle
        && waveIndex % 30 !== (offsetGym ? 0 : 20)
        && !this.isFixedBattle(waveIndex)
      ) {
        return true;
      }
      // ER Elite/Hell: force a trainer on the difficulty cadence (in addition to
      // — not instead of — the normal biome trainer roll). Ace is untouched.
      //
      // This deliberately bypasses BOTH suppressors above:
      //   - the *random* anti-clustering rolls (they only exist to thin out
      //     generic trainers), and
      //   - the ±2 proximity guard around gyms / fixed battles.
      // Together those silently collapsed the intended "near-continuous
      // gauntlet" back to ~vanilla density: the random rolls kicked in the
      // moment the run left a `trainerChance: 0` biome (Town → Plains ~wave 10),
      // and the ±2 guard blanked out the cadence waves flanking every rival/gym
      // (e.g. the wave-25 rival killed forced trainers on 24 and 27, leaving
      // waves 20–30 nearly empty — exactly the reported drop-off). For a
      // gauntlet, trainers clustered next to a rival are the whole point.
      //
      // We still skip the EXACT gym / fixed-battle wave, since those already
      // supply their own (scripted) trainer and take precedence downstream.
      if (erForcesTrainerWave(waveIndex) && waveIndex % 30 !== (offsetGym ? 0 : 20) && !this.isFixedBattle(waveIndex)) {
        return true;
      }
      // ER (#504): biome NOTORIETY forces more TRAINER battles the longer the
      // player over-stays a biome (climbing to near-certain at full notoriety).
      // Additive to the normal trainer roll and LOCAL to the biome (overstay is a
      // pure function of the per-biome start wave, which resets on entry), so the
      // global curve resumes exactly after leaving. Skips the exact gym/fixed wave
      // (those supply their own scripted trainer). Gated to the World Map run.
      if (erBiomeRoutingActive() && waveIndex % 30 !== (offsetGym ? 0 : 20) && !this.isFixedBattle(waveIndex)) {
        const notorietyTrainerPct = erNotorietyTrainerChancePct(waveIndex);
        if (notorietyTrainerPct > 0 && randSeedInt(100) < notorietyTrainerPct) {
          return true;
        }
      }
      // ER (biome composition): scale the generic trainer odds per biome. The roll
      // is `1/trainerChance`, so a HIGHER mult means a SMALLER divisor (denser
      // trainers: Metropolis 1.6x), a LOWER mult a larger one (sparser: Desert 0.3x,
      // Wasteland/Abyss/Space). Base 0 (Town) stays 0. Composes with the difficulty
      // force + notoriety paths above (those already returned true when they fire).
      const trainerMult = erBiomeTrainerRateMult(arena.biomeId);
      const effectiveTrainerChance =
        trainerMult === 1 ? trainerChance : Math.max(1, Math.round(trainerChance / trainerMult));
      return Boolean(allowTrainerBattle && trainerChance && !randSeedInt(effectiveTrainerChance));
    }
    return false;
  }

  isTrainerBoss(waveIndex: number, biomeType: BiomeId, offsetGym: boolean): boolean {
    switch (this.modeId) {
      case GameModes.DAILY:
        return waveIndex > 10 && waveIndex < 50 && !(waveIndex % 10);
      default:
        return (
          waveIndex % 30 === (offsetGym ? 0 : 20)
          && (biomeType !== BiomeId.END || this.isClassic || this.isWaveFinal(waveIndex))
        );
    }
  }

  getOverrideSpecies(waveIndex: number): PokemonSpecies | null {
    if (this.isDaily && this.isWaveFinal(waveIndex)) {
      const eventBoss = getDailyEventSeedBoss();
      if (eventBoss?.speciesId != null) {
        // Cannot set form index here, it will be overriden when adding it as enemy pokemon.
        return getPokemonSpecies(eventBoss.speciesId);
      }

      const allFinalBossSpecies = allSpecies.filter(
        s =>
          (s.subLegendary || s.legendary || s.mythical)
          && s.baseTotal >= 600
          && s.speciesId !== SpeciesId.ETERNATUS
          && s.speciesId !== SpeciesId.ARCEUS,
      );
      return randSeedItem(allFinalBossSpecies);
    }

    return getDailyForcedWaveSpecies(waveIndex);
  }

  /**
   * Checks if wave provided is the final for current or specified game mode
   * @param waveIndex
   * @param modeId game mode
   * @returns if the current wave is final for classic or daily OR a minor boss in endless
   */
  isWaveFinal(waveIndex: number, modeId: GameModes = this.modeId): boolean {
    switch (modeId) {
      case GameModes.CLASSIC:
      case GameModes.CHALLENGE:
      case GameModes.LLM_DIRECTOR:
      case GameModes.COOP:
        return waveIndex === 200;
      case GameModes.ENDLESS:
      case GameModes.SPLICED_ENDLESS:
        return waveIndex % 250 === 0;
      case GameModes.DAILY:
        return waveIndex === 50;
      case GameModes.SHOWDOWN:
        // Single 1v1 duel (C3): wave 1 is the only wave, so it is always the final wave.
        // After it resolves the run routes to the showdown result flow (C6), never a next
        // wave / shop / save. Owned here per the C3 task (the B1 provisional is now real).
        return waveIndex === 1;
    }
  }

  /**
   * Every 10 waves is a boss battle
   * @returns true if waveIndex is a multiple of 10
   */
  isBoss(waveIndex: number): boolean {
    return waveIndex % 10 === 0;
  }

  /**
   * @returns `true` if the current battle is against classic mode's final boss
   */
  isBattleClassicFinalBoss(waveIndex: number): boolean {
    return (
      (this.modeId === GameModes.CLASSIC || this.modeId === GameModes.CHALLENGE || this.modeId === GameModes.COOP)
      && this.isWaveFinal(waveIndex)
    );
  }

  /**
   * Check whether the current wave is an Endless boss of any kind.
   * @param waveIndex - The current wave number.
   * @returns Whether `waveIndex` corresponds to an Endless boss.
   */
  isEndlessBoss(waveIndex: number): boolean {
    return waveIndex % 50 === 0 && (this.modeId === GameModes.ENDLESS || this.modeId === GameModes.SPLICED_ENDLESS);
  }

  /**
   * Check whether the current wave is an Endless minor boss.
   * Currently is normal Eternatus.
   * @param waveIndex - The current wave number.
   * @returns Whether `waveIndex` is a multiple of 250 during endless mode.
   */
  public isEndlessMinorBoss(waveIndex: number): boolean {
    return waveIndex % 250 === 0 && (this.modeId === GameModes.ENDLESS || this.modeId === GameModes.SPLICED_ENDLESS);
  }

  /**
   * Every 1000 waves of an Endless mode is a major boss
   * At this time it is Eternamax Eternatus
   * @returns true if waveIndex is a multiple of 1000 in Endless
   */
  isEndlessMajorBoss(waveIndex: number): boolean {
    return waveIndex % 1000 === 0 && (this.modeId === GameModes.ENDLESS || this.modeId === GameModes.SPLICED_ENDLESS);
  }

  /**
   * Checks whether there is a fixed battle on this gamemode on a given wave.
   * @param waveIndex The wave to check.
   * @returns If this game mode has a fixed battle on this wave
   */
  isFixedBattle(waveIndex: number): boolean {
    const dummyConfig = new FixedBattleConfig();
    return (
      Object.hasOwn(this.battleConfig, waveIndex)
      || applyChallenges(ChallengeType.FIXED_BATTLES, waveIndex, dummyConfig)
    );
  }

  /**
   * Returns the config for the fixed battle for a particular wave.
   * @param waveIndex The wave to check.
   * @returns The fixed battle for this wave.
   */
  getFixedBattle(waveIndex: number): FixedBattleConfig | undefined {
    const challengeConfig = new FixedBattleConfig();
    if (applyChallenges(ChallengeType.FIXED_BATTLES, waveIndex, challengeConfig)) {
      return challengeConfig;
    }
    return this.battleConfig[waveIndex];
  }

  /**
   * Check if the current game mode has the shop enabled or not
   * @returns Whether the shop is available in the current mode
   */
  public getShopStatus(): boolean {
    const status = new BooleanHolder(!this.hasNoShop);
    applyChallenges(ChallengeType.SHOP, status);
    return status.value;
  }

  getClearScoreBonus(): number {
    switch (this.modeId) {
      case GameModes.CLASSIC:
      case GameModes.CHALLENGE:
      case GameModes.COOP:
        return 5000;
      case GameModes.DAILY:
        return 2500;
      default:
        return 0;
    }
  }

  getEnemyModifierChance(isBoss: boolean): number {
    // Editor-tunable 1-in-X odds (vanilla.enemy.modifierChance).
    const chances = erBalanceMap("vanilla.enemy.modifierChance");
    switch (this.modeId) {
      case GameModes.CLASSIC:
      case GameModes.CHALLENGE:
      case GameModes.DAILY:
      case GameModes.LLM_DIRECTOR:
      case GameModes.COOP:
      case GameModes.SHOWDOWN:
        return isBoss ? chances.classicBoss : chances.classicNonBoss;
      case GameModes.ENDLESS:
      case GameModes.SPLICED_ENDLESS:
        return isBoss ? chances.endlessBoss : chances.endlessNonBoss;
    }
  }

  getName(): string {
    switch (this.modeId) {
      case GameModes.CLASSIC:
        return i18next.t("gameMode:classic");
      case GameModes.ENDLESS:
        return i18next.t("gameMode:endless");
      case GameModes.SPLICED_ENDLESS:
        return i18next.t("gameMode:endlessSpliced");
      case GameModes.DAILY:
        return i18next.t("gameMode:dailyRun");
      case GameModes.CHALLENGE:
        return i18next.t("gameMode:challenge");
      case GameModes.LLM_DIRECTOR:
        return i18next.t("gameMode:llmDirector");
      case GameModes.COOP:
        return i18next.t("gameMode:coop");
      case GameModes.SHOWDOWN:
        return i18next.t("gameMode:showdown");
    }
  }

  /**
   * Returns the wave range where MEs can spawn for the game mode [min, max]
   */
  getMysteryEncounterLegalWaves(): [minWave: number, maxWave: number] {
    switch (this.modeId) {
      case GameModes.CLASSIC:
      case GameModes.COOP:
        return CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES;
      case GameModes.CHALLENGE:
        return CHALLENGE_MODE_MYSTERY_ENCOUNTER_WAVES;
      default:
        return [0, 0];
    }
  }

  /**
   * Sets the daily config if the seed is a custom seed.
   * @param seed - The seed to check
   * @returns The seed to use.
   * @remarks
   * If it is not a custom seed, it will return the original seed.
   */
  public trySetCustomDailyConfig(seed: string): string {
    this.dailyConfig = parseDailySeed(seed);
    return this.dailyConfig?.seed ?? seed;
  }

  static getModeName(modeId: GameModes): string {
    switch (modeId) {
      case GameModes.CLASSIC:
        return i18next.t("gameMode:classic");
      case GameModes.ENDLESS:
        return i18next.t("gameMode:endless");
      case GameModes.SPLICED_ENDLESS:
        return i18next.t("gameMode:endlessSpliced");
      case GameModes.DAILY:
        return i18next.t("gameMode:dailyRun");
      case GameModes.CHALLENGE:
        return i18next.t("gameMode:challenge");
      case GameModes.LLM_DIRECTOR:
        return i18next.t("gameMode:llmDirector");
      case GameModes.COOP:
        return i18next.t("gameMode:coop");
      case GameModes.SHOWDOWN:
        return i18next.t("gameMode:showdown");
    }
  }
}

export function getGameMode(gameMode: GameModes): GameMode {
  switch (gameMode) {
    case GameModes.CLASSIC:
      return new GameMode(
        GameModes.CLASSIC,
        { isClassic: true, hasTrainers: true, hasMysteryEncounters: true },
        classicFixedBattles,
      );
    case GameModes.ENDLESS:
      return new GameMode(GameModes.ENDLESS, {
        isEndless: true,
        hasShortBiomes: true,
        hasRandomBosses: true,
      });
    case GameModes.SPLICED_ENDLESS:
      return new GameMode(GameModes.SPLICED_ENDLESS, {
        isEndless: true,
        hasShortBiomes: true,
        hasRandomBosses: true,
        isSplicedOnly: true,
      });
    case GameModes.DAILY:
      return new GameMode(GameModes.DAILY, {
        isDaily: true,
        hasTrainers: true,
        hasNoShop: true,
      });
    case GameModes.CHALLENGE:
      return new GameMode(
        GameModes.CHALLENGE,
        {
          isClassic: true,
          hasTrainers: true,
          isChallenge: true,
          hasMysteryEncounters: true,
        },
        classicFixedBattles,
      );
    case GameModes.LLM_DIRECTOR:
      // Inherits Classic's starter selection, level curve, and 200-wave count.
      // The LLM Director phase fires every 3 waves between Classic vanilla content.
      // nonDeterministic excludes this mode from daily-seed/leaderboard code.
      return new GameMode(
        GameModes.LLM_DIRECTOR,
        {
          isClassic: true,
          hasTrainers: true,
          hasMysteryEncounters: true,
          isLLMDirector: true,
          nonDeterministic: true,
        },
        classicFixedBattles,
      );
    case GameModes.COOP:
      // 2-player co-op (#633): Classic's starter selection, level curve, and
      // 200-wave count; `isCoop` flips the co-op-specific deltas (doubles-only,
      // 3-mon-per-player cap, lures off, shared run, ghost-pool exclusion).
      // Challenges can be layered on top (the co-op flow can route through the
      // challenge menu); they get cloned in by `setChallengeValue` when used.
      return new GameMode(
        GameModes.COOP,
        {
          isClassic: true,
          hasTrainers: true,
          hasMysteryEncounters: true,
          isCoop: true,
          // Co-op (#633) is challenge-capable: the co-op flow routes through the
          // challenge-select screen so players can layer challenges on a co-op run
          // ("co-op challenge"). With nothing selected the challenges are all 0 and
          // it plays as plain co-op. (getValueLimit stays a flat 5 - the STARTER_POINTS
          // challenge does not re-scale the co-op budget.)
          isChallenge: true,
        },
        classicFixedBattles,
      );
    case GameModes.SHOWDOWN:
      // Showdown: a single ephemeral 1v1 duel fought at level 100.
      // No shops (hasNoShop), no waves beyond the first (see isWaveFinal), and
      // not a saved/continuable run - like DAILY it does NOT set `isClassic`, so
      // it stays out of the classic saved-run / final-boss / ME paths.
      // `nonDeterministic` keeps it out of daily-seed/leaderboard code.
      return new GameMode(GameModes.SHOWDOWN, {
        isShowdown: true,
        hasNoShop: true,
        nonDeterministic: true,
      });
  }
}
