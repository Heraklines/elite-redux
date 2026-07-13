import { pokerogueApi } from "#api/api";
import { clientSessionId } from "#app/account";
import { globalScene } from "#app/global-scene";
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { bypassLogin } from "#constants/app-constants";
import { modifierTypes } from "#data/data-lists";
import { getCharVariantFromDialogue } from "#data/dialogue";
import {
  broadcastCoopWaveResolved,
  clearCoopRuntime,
  getCoopBattleStreamer,
  isCoopAuthoritativeGuest,
} from "#data/elite-redux/coop/coop-runtime";
import { erRecordDailySeedWon } from "#data/elite-redux/er-achievement-detection";
import { enqueueFounderPublish, recordLocalDraftAttempt } from "#data/elite-redux/er-community-challenges";
import { getFounderRunState, setFounderRunState } from "#data/elite-redux/er-community-run-state";
import { recordGhostTeamOnGameOver } from "#data/elite-redux/er-ghost-teams";
import type { PokemonSpecies } from "#data/pokemon-species";
import { BattleType } from "#enums/battle-type";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { PlayerGender } from "#enums/player-gender";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import type { Pokemon } from "#field/pokemon";
import { BattlePhase } from "#phases/battle-phase";
import type { EndCardPhase } from "#phases/end-card-phase";
import { achvs, ChallengeAchv } from "#system/achv";
import { ArenaData } from "#system/arena-data";
import { ChallengeData } from "#system/challenge-data";
import { applyEffects } from "#system/llm-director/consequence-effects";
import { logEffectApplied } from "#system/llm-director/director-log";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";
import { paginateAndJoin } from "#system/llm-director/text-pagination";
import { ModifierData as PersistentModifierData } from "#system/modifier-data";
import { PokemonData } from "#system/pokemon-data";
import { RibbonData, type RibbonFlag } from "#system/ribbons/ribbon-data";
import { awardRibbonsToSpeciesLine } from "#system/ribbons/ribbon-methods";
import { TrainerData } from "#system/trainer-data";
import { trainerConfigs } from "#trainers/trainer-config";
import type { SessionSaveData } from "#types/save-data";
import { checkSpeciesValidForChallenge, isNuzlockeChallenge } from "#utils/challenge-utils";
import { fixedInt, isLocalServerConnected } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

export class GameOverPhase extends BattlePhase {
  public readonly phaseName = "GameOverPhase";

  private isVictory: boolean;
  private readonly firstRibbons: PokemonSpecies[] = [];

  constructor(isVictory = false) {
    super();

    this.isVictory = isVictory;
  }

  start() {
    super.start();

    // Showdown 1v1 (C3): a versus match NEVER runs the classic game-over (no save / ribbons /
    // achievements / cloud). Route the player's loss (or an unexpected showdown game-over) to the
    // ephemeral showdown result flow instead. Showdown-only -> every other mode is untouched.
    if (globalScene.gameMode.isShowdown) {
      globalScene.phaseManager.unshiftNew("ShowdownResultPhase", this.isVictory, "victory");
      return this.end();
    }

    globalScene.phaseManager.hideAbilityBar();

    // Failsafe if players somehow skip floor 200 in classic mode
    if (globalScene.gameMode.isClassic && globalScene.currentBattle.waveIndex > 200) {
      this.isVictory = true;
    }

    // LLM Director post-defeat hook: when the player dies on a wave that
    // had a beat-authored override, queue the LLM's postLossText +
    // defeatEffects narration so the death feels tied to the run's story.
    // No effect for victory game-over (handled by VictoryPhase).
    if (!this.isVictory && globalScene.gameMode.modeId === GameModes.LLM_DIRECTOR) {
      applyPostDefeatHook(globalScene.currentBattle.waveIndex);
    }

    // Handle Mystery Encounter special Game Over cases
    // Situations such as when player lost a battle, but it isn't treated as full Game Over
    if (
      !this.isVictory
      && globalScene.currentBattle.mysteryEncounter?.onGameOver
      && !globalScene.currentBattle.mysteryEncounter.onGameOver()
    ) {
      // Do not end the game
      return this.end();
    }
    // Otherwise, continue standard Game Over logic

    // The ME hook above is allowed to turn a battle loss back into a live encounter. Only a true terminal
    // can prove continuationReady; otherwise the retained battle transaction must remain owned by the
    // resumed ME surface instead of being released against a terminal that never opened.
    if (isCoopAuthoritativeGuest()) {
      getCoopBattleStreamer()?.notifyContinuationSurface("terminal");
    }

    // Co-op (#633, authoritative wave-advance handshake): publish only after an ME's onGameOver hook
    // confirms this is a real run terminal. Expert Breeder losses deliberately resume the encounter;
    // announcing WAVE_ADVANCE(gameOver) before that hook split the guest onto a terminal screen forever.
    broadcastCoopWaveResolved("gameOver");

    if (this.isVictory && globalScene.gameMode.isEndless) {
      const genderIndex = globalScene.gameData.gender ?? PlayerGender.UNSET;
      const genderStr = PlayerGender[genderIndex].toLowerCase();
      globalScene.ui.showDialogue(
        i18next.t("miscDialogue:endingEndless", { context: genderStr }),
        i18next.t("miscDialogue:endingName"),
        0,
        () => this.handleGameOver(),
        0,
        fixedInt(3000),
      );
    } else if (this.isVictory || !globalScene.enableRetries || globalScene.gameMode.isCoop) {
      // Co-op (#633 Fix #4f): never open the per-client "retry?" prompt in co-op. It would
      // reset + reload THIS client's session independently of the partner (loadSession +
      // re-push EncounterPhase), desyncing the shared run / hanging the partner. Go straight
      // to game-over so both clients end together. Solo keeps the enableRetries prompt.
      this.handleGameOver();
    } else {
      globalScene.ui.showText(i18next.t("battle:retryBattle"), null, () => {
        globalScene.ui.setMode(
          UiMode.CONFIRM,
          () => {
            globalScene.ui.fadeOut(1250).then(() => {
              globalScene.reset();
              globalScene.phaseManager.clearPhaseQueue();
              globalScene.gameData.loadSession(globalScene.sessionSlotId).then(() => {
                globalScene.phaseManager.pushNew("EncounterPhase", true);

                const availablePartyMembers = globalScene.getPokemonAllowedInBattle().length;

                // Format-capacity, not hardcoded doubles slots 0/1 (a retried TRIPLE
                // summoned/prompted only two of three slots). Slots >= 1 of a loaded
                // multi format are also restored by the encounter-phase reload block;
                // SummonPhase's isOnField-guarded path keeps this idempotent.
                const battlerCount = globalScene.currentBattle.getBattlerCount();
                for (let i = 0; i < battlerCount && (i === 0 || availablePartyMembers > i); i++) {
                  globalScene.phaseManager.pushNew("SummonPhase", i, true, true);
                }
                if (
                  globalScene.currentBattle.waveIndex > 1
                  && globalScene.currentBattle.battleType !== BattleType.TRAINER
                ) {
                  for (let i = 0; i < battlerCount && (i === 0 || availablePartyMembers > i); i++) {
                    globalScene.phaseManager.pushNew("CheckSwitchPhase", i, battlerCount > 1);
                  }
                }

                globalScene.ui.fadeIn(1250);
                this.end();
              });
            });
          },
          () => this.handleGameOver(),
          false,
          0,
          0,
          1000,
        );
      });
    }
  }

  /**
   * Submethod of {@linkcode handleGameOver} that awards ribbons to Pokémon in the player's party based on the current
   * game mode and challenges.
   */
  private awardRibbons(): void {
    let ribbonFlags = 0n;
    for (const challenge of globalScene.gameMode.challenges) {
      const ribbon = challenge.ribbonAwarded;
      if (challenge.value && ribbon) {
        ribbonFlags |= ribbon;
      }
    }

    // TODO: find a better way to handle blocking ribbons and achievements
    // Block other ribbons if flip stats or inverse is active
    const flip_or_inverse = ribbonFlags & (RibbonData.FLIP_STATS | RibbonData.INVERSE);
    // Block other ribbons if passives on `all` is active
    const passives = ribbonFlags & RibbonData.PASSIVE_CHALLENGE;
    if (flip_or_inverse) {
      ribbonFlags = flip_or_inverse;
    } else if (globalScene.gameMode.challenges.some(c => c.id === Challenges.PASSIVES && c.value === 2)) {
      ribbonFlags = passives;
    } else {
      if (globalScene.gameMode.isClassic) {
        ribbonFlags |= RibbonData.CLASSIC;
      }
      if (isNuzlockeChallenge()) {
        ribbonFlags |= RibbonData.NUZLOCKE;
      }
    }
    // Award ribbons to all Pokémon in the player's party that are considered valid
    // for the current game mode and challenges.
    for (const pokemon of globalScene.getPlayerParty()) {
      const species = pokemon.species;
      if (
        checkSpeciesValidForChallenge(
          species,
          globalScene.gameData.getSpeciesDexAttrProps(species, pokemon.getDexAttr()),
          false,
        )
      ) {
        awardRibbonsToSpeciesLine(species.speciesId, ribbonFlags as RibbonFlag);
      }
    }
  }

  handleGameOver(): void {
    const doGameOver = (newClear: boolean) => {
      globalScene.disableMenu = true;
      globalScene.time.delayedCall(1000, () => {
        let firstClear = false;
        if (this.isVictory) {
          if (globalScene.gameMode.isClassic) {
            firstClear = globalScene.validateAchv(achvs.CLASSIC_VICTORY);
            globalScene.validateAchv(achvs.UNEVOLVED_CLASSIC_VICTORY);
            globalScene.gameData.gameStats.sessionsWon++;
            for (const pokemon of globalScene.getPlayerParty()) {
              this.awardFirstClassicCompletion(pokemon);
              if (pokemon.species.getRootSpeciesId() !== pokemon.species.getRootSpeciesId(true)) {
                this.awardFirstClassicCompletion(pokemon, true);
              }
            }
            this.awardRibbons();
            // Master of All: fired right after the ribbon award transition (never
            // at load); the achv's conditionFunc gates on owning all 18 mono-type
            // ribbons across the dex.
            globalScene.validateAchv(achvs.MASTER_OF_ALL);
          } else if (globalScene.gameMode.isDaily && newClear) {
            globalScene.gameData.gameStats.dailyRunSessionsWon++;
            globalScene.validateAchv(achvs.DAILY_VICTORY);
            // catalog-v2 (#900) GROUNDHOG_WEEK: 7 distinct Daily seeds won (fresh victory only).
            erRecordDailySeedWon(globalScene.seed);
          }
        }

        const fadeDuration = this.isVictory ? 10000 : 5000;
        globalScene.fadeOutBgm(fadeDuration, true);
        const activeBattlers = globalScene.getField().filter(p => p?.isActive(true));
        activeBattlers.map(p => p.hideInfo());
        globalScene.ui.fadeOut(fadeDuration).then(() => {
          activeBattlers.map(a => a.setVisible(false));
          globalScene.setFieldScale(1, true);
          globalScene.phaseManager.clearPhaseQueue();
          globalScene.ui.clearText();

          if (this.isVictory && globalScene.gameMode.isChallenge) {
            globalScene.gameMode.challenges.forEach(c => globalScene.validateAchvs(ChallengeAchv, c));
          }

          const clear = (endCardPhase?: EndCardPhase) => {
            if (this.isVictory && newClear) {
              this.handleUnlocks();

              for (const species of this.firstRibbons) {
                globalScene.phaseManager.unshiftNew("RibbonModifierRewardPhase", modifierTypes.VOUCHER_PLUS, species);
              }
              if (!firstClear) {
                globalScene.phaseManager.unshiftNew("GameOverModifierRewardPhase", modifierTypes.VOUCHER_PREMIUM);
              }
            }
            this.getRunHistoryEntry().then(runHistoryEntry => {
              globalScene.gameData.saveRunHistory(runHistoryEntry, this.isVictory);
              // ER (#217): snapshot the finished team as a cross-player "ghost"
              // (stored locally + uploaded when an endpoint is configured).
              recordGhostTeamOnGameOver(this.isVictory);
              // ER Community Challenge: record the FOUNDER's qualifying-run outcome. A win
              // auto-publishes the draft (flips draft->active); a LOSS still records the
              // attempt locally so the draft is NOT lost and stays in MY CHALLENGES to finalize.
              this.recordFounderRunOutcome();
              // Co-op (#829/#834): the run is over - tear the co-op runtime down on THIS client so the
              // run-over tail cleans up on BOTH clients (drop the detached ME listeners + stall watchdog,
              // close the transport, and zero the ME pins so nothing leaks into the next co-op run). Placed
              // at the TERMINAL step - well after start()'s broadcastCoopWaveResolved("gameOver"), whose
              // handler queues this same GameOverPhase on the guest - so that gameOver broadcast flushes to
              // the peer FIRST (the transport delivers on a microtask and close() drops anything still in
              // flight; an immediate teardown would strand the guest on the lost wave). Each client tears
              // down its OWN runtime when its OWN GameOverPhase reaches here. No-op for solo (clearCoopRuntime
              // early-returns when there is no active session).
              clearCoopRuntime();
              globalScene.phaseManager.pushNew("PostGameOverPhase", globalScene.sessionSlotId, endCardPhase);
              this.end();
            });
          };

          if (this.isVictory && globalScene.gameMode.isClassic) {
            const dialogueKey = "miscDialogue:ending";

            if (globalScene.ui.shouldSkipDialogue(dialogueKey)) {
              const endCardPhase = globalScene.phaseManager.create("EndCardPhase");
              globalScene.phaseManager.unshiftPhase(endCardPhase);
              clear(endCardPhase);
            } else {
              globalScene.ui.fadeIn(500).then(() => {
                const genderIndex = globalScene.gameData.gender ?? PlayerGender.UNSET;
                const genderStr = PlayerGender[genderIndex].toLowerCase();
                // Dialogue has to be retrieved so that the rival's expressions can be loaded and shown via getCharVariantFromDialogue
                const dialogue = i18next.t(dialogueKey, { context: genderStr });
                globalScene.charSprite
                  .showCharacter(
                    `rival_${globalScene.gameData.gender === PlayerGender.FEMALE ? "m" : "f"}`,
                    getCharVariantFromDialogue(dialogue),
                  )
                  .then(() => {
                    globalScene.ui.showDialogue(
                      dialogueKey,
                      globalScene.gameData.gender === PlayerGender.FEMALE
                        ? trainerConfigs[TrainerType.RIVAL].name
                        : trainerConfigs[TrainerType.RIVAL].nameFemale,
                      null,
                      () => {
                        globalScene.ui.fadeOut(500).then(() => {
                          globalScene.charSprite.hide().then(() => {
                            const endCardPhase = globalScene.phaseManager.create("EndCardPhase");
                            globalScene.phaseManager.unshiftPhase(endCardPhase);
                            clear(endCardPhase);
                          });
                        });
                      },
                    );
                  });
              });
            }
          } else {
            clear();
          }
        });
      });
    };

    // If Online, execute apiFetch as intended
    // If Offline, execute offlineNewClear() only for victory, a localStorage implementation of newClear daily run checks
    if (!bypassLogin || isLocalServerConnected) {
      pokerogueApi.savedata.session
        .newclear({
          slot: globalScene.sessionSlotId,
          isVictory: this.isVictory,
          clientSessionId,
        })
        .then(success => doGameOver(!globalScene.gameMode.isDaily || !!success))
        .catch(_err => {
          globalScene.phaseManager.clearPhaseQueue();
          globalScene.phaseManager.unshiftNew("MessagePhase", i18next.t("menu:serverCommunicationFailed"), 2500);
          // force the game to reload after 2 seconds.
          setTimeout(() => {
            window.location.reload();
          }, 2000);
          this.end();
        });
    } else if (this.isVictory) {
      globalScene.gameData.offlineNewClear().then(result => {
        doGameOver(result);
      });
    } else {
      doGameOver(false);
    }
  }

  /**
   * ER Community Challenge: if THIS run is the founder's qualifying play of a draft (set
   * at create + persisted on the session save), record its outcome. The linkage is cleared
   * so a second game-over can't re-fire. Called on BOTH win and loss:
   *  - WIN: auto-publish (POST /community/clear flips the draft live) + mark the local
   *    draft cleared/published (so MY CHALLENGES shows it as published).
   *  - LOSS: record a failed attempt LOCALLY so the draft is NOT lost - it stays in MY
   *    CHALLENGES where the founder can finalize it with another try (replay from scratch).
   */
  private recordFounderRunOutcome(): void {
    const founder = getFounderRunState();
    if (!founder) {
      return;
    }
    setFounderRunState(null);
    const wave = globalScene.currentBattle?.waveIndex ?? founder.config.targetWave;
    if (!this.isVictory) {
      recordLocalDraftAttempt(founder.draftId, "failed", wave);
      return;
    }
    recordLocalDraftAttempt(founder.draftId, "cleared", wave);
    const playerParty = globalScene.getPlayerParty();
    const party = playerParty.map(p => new PokemonData(p));
    const partyRoots = [...new Set(playerParty.map(p => p.species.getRootSpeciesId()))];
    // Enqueue (persisted) + try to publish now. If the POST fails (offline at the win),
    // it retries when the Community Challenges screen next opens, so it is not lost.
    enqueueFounderPublish({
      draftId: founder.draftId,
      config: founder.config,
      run: {
        wave,
        clearTimeMs: Math.round((globalScene.sessionPlayTime ?? 0) * 1000),
        party,
        partyRoots,
      },
    });
  }

  handleUnlocks(): void {
    if (this.isVictory && globalScene.gameMode.isClassic) {
      if (!globalScene.gameData.unlocks[Unlockables.ENDLESS_MODE]) {
        globalScene.phaseManager.unshiftNew("UnlockPhase", Unlockables.ENDLESS_MODE);
      }
      if (
        globalScene.getPlayerParty().filter(p => p.fusionSpecies).length > 0
        && !globalScene.gameData.unlocks[Unlockables.SPLICED_ENDLESS_MODE]
      ) {
        globalScene.phaseManager.unshiftNew("UnlockPhase", Unlockables.SPLICED_ENDLESS_MODE);
      }
      if (!globalScene.gameData.unlocks[Unlockables.MINI_BLACK_HOLE]) {
        globalScene.phaseManager.unshiftNew("UnlockPhase", Unlockables.MINI_BLACK_HOLE);
      }
      if (
        !globalScene.gameData.unlocks[Unlockables.EVIOLITE]
        && globalScene.getPlayerParty().some(p => p.getSpeciesForm(true).speciesId in pokemonEvolutions)
      ) {
        globalScene.phaseManager.unshiftNew("UnlockPhase", Unlockables.EVIOLITE);
      }
    }
  }

  awardFirstClassicCompletion(pokemon: Pokemon, forStarter = false): void {
    const speciesId = getPokemonSpecies(pokemon.species.speciesId);
    const speciesRibbonCount = globalScene.gameData.incrementRibbonCount(speciesId, forStarter);
    // first time classic win, award voucher
    if (speciesRibbonCount === 1) {
      this.firstRibbons.push(getPokemonSpecies(pokemon.species.getRootSpeciesId(forStarter)));
    }
  }

  // TODO: Make function use existing getSessionSaveData() function and then modify the values from there.
  /**
   * Slightly modified version of {@linkcode GameData.getSessionSaveData}.
   * @returns A promise containing the {@linkcode SessionSaveData}
   */
  private async getRunHistoryEntry(): Promise<SessionSaveData> {
    const preWaveSessionData = await globalScene.gameData.getSession(globalScene.sessionSlotId);
    return {
      seed: globalScene.seed,
      playTime: globalScene.sessionPlayTime,
      gameMode: globalScene.gameMode.modeId,
      party: globalScene.getPlayerParty().map(p => new PokemonData(p)),
      enemyParty: globalScene.getEnemyParty().map(p => new PokemonData(p)),
      modifiers: preWaveSessionData
        ? preWaveSessionData.modifiers
        : globalScene.findModifiers(() => true).map(m => new PersistentModifierData(m, true)),
      enemyModifiers: preWaveSessionData
        ? preWaveSessionData.enemyModifiers
        : globalScene.findModifiers(() => true, false).map(m => new PersistentModifierData(m, false)),
      arena: new ArenaData(globalScene.arena),
      pokeballCounts: globalScene.pokeballCounts,
      money: Math.floor(globalScene.money),
      score: globalScene.score,
      waveIndex: globalScene.currentBattle.waveIndex,
      battleType: globalScene.currentBattle.battleType,
      trainer: globalScene.currentBattle.trainer ? new TrainerData(globalScene.currentBattle.trainer) : null,
      gameVersion: globalScene.game.config.gameVersion,
      timestamp: Date.now(),
      challenges: globalScene.gameMode.challenges.map(c => new ChallengeData(c)),
      mysteryEncounterType: globalScene.currentBattle.mysteryEncounter?.encounterType ?? -1,
      mysteryEncounterSaveData: globalScene.mysteryEncounterSaveData,
      playerFaints: globalScene.arena.playerFaints,
    } as SessionSaveData;
  }
}

/**
 * Consume the LLM Director post-battle hook for `wave` and queue the LOSS
 * narration (postLossText + defeatEffects). Mirrors `applyPostVictoryHook`
 * in victory-phase.ts. Called from GameOverPhase on a non-victory game-over.
 *
 * defeatEffects can mutate state (lose_money, status_inflict, lose_egg,
 * etc.) — they fire even though the run is ending so the player sees
 * what the LLM said the loss costs them, in the same trace.
 */
function applyPostDefeatHook(waveIndex: number): void {
  const runtime = getDirectorRuntime();
  if (!runtime) {
    return;
  }
  const hook = runtime.queue.takePostBattleHook(waveIndex);
  if (!hook) {
    return;
  }
  const tail: string[] = [];
  if (hook.postLossText) {
    tail.push(hook.postLossText);
  }
  if (hook.defeatEffects && hook.defeatEffects.length > 0) {
    try {
      tail.push(...applyEffects(hook.defeatEffects));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logEffectApplied(`defeat-wave-${waveIndex}`, "defeat-effects-batch", false, reason);
    }
  }
  if (tail.length > 0) {
    const combined = paginateAndJoin(tail);
    if (combined.length > 0) {
      void globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.phaseManager.unshiftNew("MessagePhase", combined, null, true);
    }
  }
  console.info(
    `[llm-director] post-defeat-hook applied wave=${waveIndex} postLossTextLen=${hook.postLossText?.length ?? 0} effects=${hook.defeatEffects?.length ?? 0}`,
  );
}
