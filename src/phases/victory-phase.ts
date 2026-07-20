import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { isCoopMeOperationJournalActive } from "#data/elite-redux/coop/coop-me-operation";
import {
  broadcastCoopWaveResolved,
  captureCoopAutomaticVictorySealIdentity,
  failCoopSharedSession,
  getCoopActiveWaveTransition,
  getCoopController,
  isCoopAuthoritativeGuest,
  isCoopHostCaptureTransitionPending,
} from "#data/elite-redux/coop/coop-runtime";
import {
  resolveCoopBiomeBoundaryFlag,
  resolveCoopVictoryTailControl,
} from "#data/elite-redux/coop/coop-wave-operation";
import { erRecordAchievementWaveWon } from "#data/elite-redux/er-achievement-tracker";
import { erBiomeOverstay } from "#data/elite-redux/er-biome-notoriety";
import { erBiomeRoutingActive } from "#data/elite-redux/er-biome-routing";
import { erShouldRaiseCrossroads } from "#data/elite-redux/er-biome-structure";
import { hasErGhostOverride } from "#data/elite-redux/er-ghost-teams";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import { ClassicFixedBossWaves } from "#enums/fixed-boss-waves";
import { GameModes } from "#enums/game-modes";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { CustomModifierSettings } from "#modifiers/modifier-type";
import { type ModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import { generateModifierType, handleMysteryEncounterVictory } from "#mystery-encounters/encounter-phase-utils";
import { PokemonPhase } from "#phases/pokemon-phase";
import { applyEffects } from "#system/llm-director/consequence-effects";
import { logEffectApplied } from "#system/llm-director/director-log";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";
import { paginateAndJoin } from "#system/llm-director/text-pagination";
import { randSeedInt } from "#utils/common";

export class VictoryPhase extends PokemonPhase {
  public readonly phaseName = "VictoryPhase";
  /** If true, indicates that the phase is intended for EXP purposes only, and not to continue a battle to next phase */
  isExpOnly: boolean;
  /**
   * Source wave of an authoritative guest continuation. The retained transaction is addressed to the
   * wave that just ended; by the time this legacy phase runs, NewBattlePhase may already have installed
   * the next Battle object. Never let that mutable ambient object re-address the retained tail.
   */
  private readonly coopSourceWave: number | null;

  constructor(battlerIndex: BattlerIndex | number, isExpOnly = false, coopSourceWave: number | null = null) {
    super(battlerIndex);

    this.isExpOnly = isExpOnly;
    this.coopSourceWave = coopSourceWave;
  }

  start() {
    super.start();

    // A retained normal-wave Victory can run after a speculative next Battle has already been installed.
    // Its immutable WAVE_ADVANCE statement—not that mutable ambient object—owns encounter classification.
    // Real Mystery-battle victories use the legacy source-null path and may consult their live encounter.
    const retainedSourceTransition =
      this.coopSourceWave == null ? null : getCoopActiveWaveTransition(this.coopSourceWave);
    if (this.coopSourceWave != null && retainedSourceTransition == null) {
      failCoopSharedSession(`The retained VictoryPhase for wave ${this.coopSourceWave} lost its transition.`);
      return;
    }
    const isMysteryEncounter =
      this.coopSourceWave == null
        ? globalScene.currentBattle.isBattleMysteryEncounter()
        : retainedSourceTransition?.meBoundary === "battle-victory";

    // The authoritative renderer may have no live encounter mechanics object. Training Session is the only
    // encounter that suppresses this statistic, and its host-authored type survives structural adoption.
    const preventsDefeatedStat =
      globalScene.currentBattle.mysteryEncounter?.preventGameStatsUpdates
      ?? globalScene.currentBattle.mysteryEncounterType === MysteryEncounterType.TRAINING_SESSION;
    if (!isMysteryEncounter || !preventsDefeatedStat) {
      globalScene.gameData.gameStats.pokemonDefeated++;
    }

    // Co-op authoritative (#838): the guest is a PURE RENDERER; the HOST computes exp and streams the
    // SETTLED post-exp battle state on `waveEndState` (adopted via one id-based full-state apply in the
    // guest's BattleEndPhase). Running applyPartyExp here would re-derive a DIVERGENT amount (different
    // participantIds; one VictoryPhase per wave vs the host's one per faint) -> a different
    // level/evolution path -> the relayed learn-move slot hits a DIFFERENT mon on the guest (the live
    // learn-move-on-the-wrong-mon desync). Skip for the authoritative GUEST only; solo / host / lockstep
    // are unchanged. KNOWN RESIDUAL (cosmetic): the guest no longer animates the exp bar / "grew to Lv. N"
    // / level-up move-learn prompt. State is still correct (the wave-end snapshot carries exp/level/moveset);
    // the host streams narration via the event channel. Consistent with the authoritative renderer model.
    if (isCoopAuthoritativeGuest()) {
      // Co-op authoritative GUEST: SKIP local exp computation (it would diverge - different
      // participantIds, one VictoryPhase/wave vs the host's one/faint). The settled post-exp state
      // arrives on `waveEndState` and is applied in the guest's BattleEndPhase.
      coopLog(
        "progression",
        `GUEST applyPartyExp SKIP wave=${globalScene.currentBattle.waveIndex} koMon=${this.getPokemon()?.name ?? "already-materialized"} (awaiting host waveEndState)`,
      );
    } else {
      const expValue = this.getPokemon().getExpValue();
      // Co-op authoritative HOST (and solo/lockstep): we COMPUTE exp locally; the settled post-exp state
      // is streamed on `waveEndState` at BattleEndPhase. Log on co-op only (solo/lockstep skip silently)
      // so the host's exp computation can be paired with the guest's skip + apply in the captured log.
      if (globalScene.gameMode.isCoop) {
        coopLog(
          "progression",
          `HOST applyPartyExp COMPUTE wave=${globalScene.currentBattle.waveIndex} expValue=${expValue} koMon=${this.getPokemon().name}`,
        );
      }
      globalScene.applyPartyExp(expValue, true);
    }

    if (isMysteryEncounter) {
      if (isCoopAuthoritativeGuest() && isCoopMeOperationJournalActive()) {
        // The renderer does not own a live MysteryEncounter object: encounter authority deliberately
        // clears locally-derived mechanics, and the retained battle-settled transaction declares the
        // exact reward/event continuation later. Its only legal action at a terminal ME victory is to
        // park an unplanned BattleEnd on that transaction; reading `continuousEncounter` here both
        // crashed real guests and made the test harness skip the queue entirely. The legacy rollback
        // path still owns a live encounter and must keep using its original locally-derived tail.
        if (!this.isExpOnly) {
          globalScene.phaseManager.pushNew("BattleEndPhase", true);
        }
      } else {
        handleMysteryEncounterVictory(false, this.isExpOnly);
      }
      return this.end();
    }

    const retainedResolvedVictory =
      this.coopSourceWave != null
      && (retainedSourceTransition?.outcome === "win" || retainedSourceTransition?.outcome === "capture");
    if (
      retainedResolvedVictory
      || !globalScene
        .getEnemyParty()
        .find(p => (globalScene.currentBattle.battleType === BattleType.WILD ? p.isOnField() : !p?.isFainted(true)))
    ) {
      // Co-op (#633, authoritative wave-advance handshake): this is the real WIN / wave-clear
      // branch (not the exp-only / mystery-encounter paths, which returned above). The host is
      // the sole engine; signal the guest renderer that this wave RESOLVED so it runs the same
      // post-battle tail (the guest never hits a FaintPhase, so it would otherwise loop the won
      // wave forever). Hard no-op for solo / non-host / lockstep. Emitted BEFORE the host queues
      // its own BattleEnd -> rewards -> biome -> NewBattle tail (the order is irrelevant to the
      // guest - it carries the wave number, guarded against a double-advance on the guest side).
      erRecordAchievementWaveWon();
      const captureKeepsBattleEndSettlement = isCoopHostCaptureTransitionPending(globalScene.currentBattle.waveIndex);
      broadcastCoopWaveResolved("win");

      const gameMode = globalScene.gameMode;
      const currentWaveIndex =
        isCoopAuthoritativeGuest() && this.coopSourceWave != null
          ? this.coopSourceWave
          : globalScene.currentBattle.waveIndex;
      const authoritativeTransition = isCoopAuthoritativeGuest() ? retainedSourceTransition : null;
      const tailControl = resolveCoopVictoryTailControl(authoritativeTransition, {
        trainerWin: () => globalScene.currentBattle.battleType === BattleType.TRAINER,
        runContinues: () => gameMode.isEndless || !gameMode.isWaveFinal(currentWaveIndex),
        biomeChange: () => resolveCoopBiomeBoundaryFlag(gameMode.hasRandomBiomes, globalScene.isNewBiome()),
      });
      const isTrainerWin = tailControl.trainerWin;
      // DIAGNOSTIC (#633 trainer-victory deadlock): log the win-branch entry on a co-op run so a live
      // capture shows the battleType and whether the trainer reward chain is queued. On the GUEST this
      // MUST read TRAINER + queue=TrainerVictoryPhase for a trainer wave - if the guest's KOd enemy was
      // not stamped FAINT, this whole branch is skipped and the guest deadlocks the host's reward WATCHER.
      if (globalScene.gameMode.isCoop) {
        const willSelectModifier =
          (globalScene.gameMode.isEndless || !globalScene.gameMode.isWaveFinal(currentWaveIndex))
          && currentWaveIndex % 10 !== 0;
        const coopRole = getCoopController()?.role ?? "none";
        console.info(
          `[coop-diag] VictoryPhase win-branch role=${coopRole} battleType=${BattleType[globalScene.currentBattle.battleType]} queuesTrainerVictory=${isTrainerWin} queuesSelectModifier=${willSelectModifier} wave=${currentWaveIndex}`,
        );
      }

      const automaticVictorySeal =
        (!isCoopAuthoritativeGuest() && !captureKeepsBattleEndSettlement) || authoritativeTransition?.outcome === "win"
          ? captureCoopAutomaticVictorySealIdentity(currentWaveIndex)
          : null;
      globalScene.phaseManager.pushNew("BattleEndPhase", true, automaticVictorySeal);
      if (isTrainerWin) {
        globalScene.phaseManager.pushNew("TrainerVictoryPhase");
      }

      // LLM effects are automatic shared mutations and must be inside the retained image. Their narration
      // and reward chooser are only queued after the explicit seal below, so no public surface can open on
      // a pre-effect state. The closure is null outside Director mode or when no hook exists.
      const queuePostVictoryPresentation =
        gameMode.modeId === GameModes.LLM_DIRECTOR ? preparePostVictoryHook(currentWaveIndex) : null;

      if (tailControl.runContinues) {
        let waveModifierRewardSettings: CustomModifierSettings | undefined;
        if (tailControl.eggLapse) {
          globalScene.phaseManager.pushNew("EggLapsePhase");
        }
        if (gameMode.isClassic) {
          switch (currentWaveIndex) {
            case ClassicFixedBossWaves.RIVAL_1:
            case ClassicFixedBossWaves.RIVAL_2:
              // Get event modifiers for this wave
              timedEventManager
                .getFixedBattleEventRewards(currentWaveIndex)
                .map(r => globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes[r]));
              break;
            case ClassicFixedBossWaves.EVIL_BOSS_2:
              // Should get Lock Capsule on 165 before shop phase so it can be used in the rewards shop
              globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.LOCK_CAPSULE);
              break;
          }
        }
        if (currentWaveIndex % 10) {
          // ER (#217): a cross-player GHOST-team trainer rolls a per-victory reward
          // TIER for the whole reward screen (60% Great, 10% Common, 30% Ultra),
          // BEFORE luck (luck still upgrades from there). Reuses the rival/boss
          // guaranteedModifierTiers routine. Otherwise the fixed-battle config's
          // reward settings (rival/boss) or undefined (a normal trainer/wild).
          const ghostRewards = buildErGhostRewardSettings();
          waveModifierRewardSettings =
            ghostRewards ?? gameMode.getFixedBattle(currentWaveIndex)?.customModifierRewardSettings;
        } else if (gameMode.isDaily) {
          globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.EXP_CHARM);
          if (currentWaveIndex > 10 && !gameMode.isWaveFinal(currentWaveIndex)) {
            globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.GOLDEN_POKEBALL);
          }
        } else {
          const superExpWave = gameMode.isEndless ? 10 : globalScene.offsetGym ? 0 : 20;
          if (gameMode.isEndless && currentWaveIndex === 10) {
            globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.EXP_SHARE);
          }
          if (gameMode.isClassic && currentWaveIndex === 10) {
            globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.EXP_CHARM);
          }
          if (currentWaveIndex <= 750 && (currentWaveIndex <= 500 || currentWaveIndex % 30 === superExpWave)) {
            globalScene.phaseManager.pushNew(
              "ModifierRewardPhase",
              currentWaveIndex % 30 !== superExpWave || currentWaveIndex > 250
                ? modifierTypes.EXP_CHARM
                : modifierTypes.SUPER_EXP_CHARM,
            );
          }
          if (currentWaveIndex <= 150 && !(currentWaveIndex % 50)) {
            globalScene.phaseManager.pushNew("ModifierRewardPhase", modifierTypes.GOLDEN_POKEBALL);
          }
          if (gameMode.isEndless && !(currentWaveIndex % 50)) {
            globalScene.phaseManager.pushNew(
              "ModifierRewardPhase",
              currentWaveIndex % 250 ? modifierTypes.VOUCHER_PLUS : modifierTypes.VOUCHER_PREMIUM,
            );
            globalScene.phaseManager.pushNew("AddEnemyBuffModifierPhase");
          }
        }

        // ER #440: Biome Market on x0 boss waves. Vanilla skips
        // SelectModifierPhase entirely on x0 waves (the `if (currentWaveIndex %
        // 10)` above is false), so no shop ever opened. Push the bespoke
        // BiomeShopPhase here - a full-screen 4x4 biome market (see
        // BiomeShopUiHandler) built from getPlayerShopModifierTypeOptionsForWave's
        // 16-slot biome stock. It runs AFTER the x0 reward popups and BEFORE the
        // biome change, so prices reflect the biome just cleared. Shipped to
        // production (release approval): runs on every x0 wave; daily runs
        // (shared seed) are still skipped.
        // ER (#504): the shop cadence stays on the every-10 GLOBAL-wave tick
        // (waveIndex % 10) for ALL runs, including the World Map gate. #486 had
        // moved it to the biome BOUNDARY (isNewBiome); that is reverted here so the
        // market always fires every 10 global waves regardless of variable biome
        // length / notoriety. Daily runs (shared seed) are still skipped.
        const erRouting = erBiomeRoutingActive();
        // The authoritative guest must NEVER derive this boundary locally. A one-bit disagreement here is
        // the wave-10 split: one queue opens SelectBiomePhase while the other advances without the map.
        const biomeEnding = tailControl.biomeChange;
        const fireBiomeShop = !(currentWaveIndex % 10) && !gameMode.isDaily;
        const raiseCrossroads =
          !biomeEnding
          && erRouting
          && erShouldRaiseCrossroads(currentWaveIndex)
          && !gameMode.isFixedBattle(currentWaveIndex + 1);
        if (globalScene.gameMode.isCoop) {
          console.info(
            `[coop-diag] VictoryTail role=${getCoopController()?.role ?? "none"} wave=${currentWaveIndex} source=${authoritativeTransition == null ? "legacy-local" : "host-stated"} trainer=${isTrainerWin} egg=${tailControl.eggLapse} biomeShop=${fireBiomeShop} biomeChange=${biomeEnding} crossroads=${raiseCrossroads} nextWave=${authoritativeTransition?.nextWave ?? currentWaveIndex + 1}`,
          );
        }

        // The mid-biome x0 heal is an automatic shared mutation. It must drain before the retained victory
        // image is sealed; previously it ran after the interactive market and therefore could never be part
        // of the wave's authoritative boundary.
        if (erRouting && fireBiomeShop && !biomeEnding && !isCoopAuthoritativeGuest()) {
          globalScene.phaseManager.pushNew("PartyHealPhase", false);
        }

        if (automaticVictorySeal != null) {
          globalScene.phaseManager.pushNew("CoopVictorySealPhase", automaticVictorySeal);
        }
        queuePostVictoryPresentation?.();
        if (currentWaveIndex % 10) {
          globalScene.phaseManager.pushNew(
            "SelectModifierPhase",
            undefined,
            undefined,
            waveModifierRewardSettings,
            false,
            { kind: "wave-boundary" },
          );
        }

        if (fireBiomeShop) {
          // ER Abyss: the Abyss has no market - its every-10-waves "shop" slot is
          // Giratina's Bargain (a dialogue event, see TheBargainPhase). Everywhere
          // else the slot is the normal biome market. (The bargain screen was
          // previously staging/dev gated while its handler was polished; that gate
          // is now removed, so the event is live in production too.)
          // Co-op (#795): the Bargain is now owner-alternated - the interaction OWNER plays
          // the real screen, the watcher waits and adopts the comprehensive outcome blob
          // (the proven ME-terminal resync), so both clients converge on whatever the deal
          // did. The old route-to-market fallback is gone; Abyss x0 is the Bargain for all.
          if (globalScene.arena.biomeId === BiomeId.ABYSS) {
            globalScene.phaseManager.pushNew("TheBargainPhase");
          } else {
            globalScene.phaseManager.pushNew("BiomeShopPhase", 0, undefined, undefined, false, {
              kind: "wave-boundary",
            });
          }
        }

        if (biomeEnding) {
          globalScene.phaseManager.pushNew("SelectBiomePhase", currentWaveIndex);
        } else if (raiseCrossroads) {
          // ER (#486): not a biome end, but a 5-wave Crossroads tick - raise the
          // "Stay / Move on" choice AFTER the reward and BEFORE the next battle.
          //
          // BattleEnd advances the resolving battle exactly once before any reward/crossroads
          // interaction opens. Freeze that settlement address here instead of letting Crossroads retain
          // the pre-BattleEnd turn from VictoryPhase. The terminal reward result and the following
          // interaction-open must share this w/t coordinate; otherwise the global V2 log correctly rejects
          // reward(w/t+1) -> Crossroads(w/t) as a backwards control edge.
          globalScene.phaseManager.pushNew("ErCrossroadsPhase", currentWaveIndex, globalScene.currentBattle.turn + 1);
        }

        // ER (#504): warn ONCE, exactly on the wave the player crosses into
        // notoriety (the next wave is the FIRST past the 10-wave free window) and
        // the biome is NOT ending. Gated on the overstay TRANSITION (== 1) rather
        // than a module-state latch, so a mid-biome save/state restore can't make
        // it re-fire every wave (the old erClaimNotorietyWarning latch bug).
        if (erRouting && !biomeEnding && erBiomeOverstay(currentWaveIndex + 1) === 1) {
          globalScene.phaseManager.pushNew(
            "MessagePhase",
            "Word of your lingering has spread, and you are gaining notoriety here. The longer you stay, the more hostile this place will grow.",
            null,
            true,
          );
        }

        globalScene.phaseManager.pushNew("NewBattlePhase");
      } else if (gameMode.isShowdown) {
        if (automaticVictorySeal != null) {
          globalScene.phaseManager.pushNew("CoopVictorySealPhase", automaticVictorySeal);
        }
        queuePostVictoryPresentation?.();
        // Showdown 1v1 (C3): the opponent's team is swept -> the LOCAL player won the duel. Route
        // to the ephemeral result flow (message + return to title, NO save/score/clear), never the
        // classic GameOver path. C6 emits the showdownResult wire message from the result phase.
        globalScene.currentBattle.battleType = BattleType.CLEAR;
        globalScene.phaseManager.pushNew("ShowdownResultPhase", true, "victory");
      } else {
        if (automaticVictorySeal != null) {
          globalScene.phaseManager.pushNew("CoopVictorySealPhase", automaticVictorySeal);
        }
        queuePostVictoryPresentation?.();
        globalScene.currentBattle.battleType = BattleType.CLEAR;
        globalScene.score += gameMode.getClearScoreBonus();
        globalScene.updateScoreText();
        globalScene.phaseManager.pushNew("GameOverPhase", true);
      }
    }

    this.end();
  }
}

/** Number of reward slots a ghost victory fills at the rolled tier (the base
 *  reward count; earned extra slots are added on top by getModifierCount). */
const ER_GHOST_REWARD_SLOTS = 3;

/**
 * ER (#217): if the just-defeated trainer is a cross-player GHOST team, roll a
 * per-victory reward TIER and return the `customModifierSettings` that guarantee
 * the WHOLE reward screen at that tier. 60% Great, 30% Ultra, 10% Common. The roll
 * is BEFORE luck (`allowLuckUpgrades` left default-true), so luck still upgrades
 * from there. Reuses the rival/boss `guaranteedModifierTiers` routine. Returns
 * `undefined` for a non-ghost / non-trainer victory (normal reward flow). Seeded
 * per wave so a reroll/reload re-reads the same tier.
 *
 * Exported for the #217 reward-tier regression test (it drives this exact seam
 * with a ghost-marked currentBattle.trainer, avoiding a full trainer fight).
 */
export function buildErGhostRewardSettings(): CustomModifierSettings | undefined {
  const battle = globalScene.currentBattle;
  const trainer = battle?.trainer;
  if (battle?.battleType !== BattleType.TRAINER || !trainer || !hasErGhostOverride(trainer)) {
    return;
  }
  let tier = ModifierTier.GREAT;
  globalScene.executeWithSeedOffset(
    () => {
      const roll = randSeedInt(100);
      // 60% Great, 30% Ultra, 10% Common.
      tier = roll < 60 ? ModifierTier.GREAT : roll < 90 ? ModifierTier.ULTRA : ModifierTier.COMMON;
    },
    battle.waveIndex,
    "er-ghost-reward-tier",
  );
  return { guaranteedModifierTiers: new Array(ER_GHOST_REWARD_SLOTS).fill(tier) };
}

/**
 * Consume the LLM Director post-battle hook for `wave`, apply its automatic shared effects immediately,
 * and return a deferred presentation/reward-chooser enqueue. The caller places that closure after the
 * retained automatic victory seal, so the effect state is authoritative before either UI can open.
 *
 * Phase ordering (each pushNew appends to the queue):
 *   1. MessagePhase: postWinText + victoryEffects narration (one $-paginated msg)
 *   2. ModifierRewardPhase × N: one per victoryRewards item (× qty)
 *
 * Defeat-side hook (postLossText, defeatEffects) lives on FaintPhase / GameOverPhase.
 */
function preparePostVictoryHook(waveIndex: number): (() => void) | null {
  const runtime = getDirectorRuntime();
  if (!runtime) {
    return null;
  }
  const hook = runtime.queue.takePostBattleHook(waveIndex);
  if (!hook) {
    return null;
  }

  // 1. Apply effects (mutates state, returns narrative strings) +
  //    consolidate with postWinText into one message.
  const tail: string[] = [];
  if (hook.postWinText) {
    tail.push(hook.postWinText);
  }
  if (hook.victoryEffects && hook.victoryEffects.length > 0) {
    if (isCoopAuthoritativeGuest()) {
      coopLog(
        "progression",
        `GUEST LLM victory effects SKIP wave=${waveIndex} count=${hook.victoryEffects.length} (retained host state)`,
      );
    } else {
      try {
        tail.push(...applyEffects(hook.victoryEffects));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logEffectApplied(`victory-wave-${waveIndex}`, "victory-effects-batch", false, reason);
        if (globalScene.gameMode.isCoop) {
          failCoopSharedSession(`Could not apply the automatic LLM victory effects for wave ${waveIndex}.`);
        }
      }
    }
  }
  const combined = tail.length > 0 ? paginateAndJoin(tail) : "";

  // 2. LLM-authored victoryRewards: bundle into a single SelectModifierPhase
  // so the player picks ONE from the row. Pokemon-targeted modifiers
  // (POTION, LEFTOVERS, etc.) need the shop's target-selection step
  // anyway — and bundling everything into one shop avoids the empty-name +
  // freeze bugs from per-item ModifierRewardPhase. Same dedupe + qty=1 cap
  // as grantConsequenceRewards: the shop is a chooser, not a stockpile.
  const guaranteed: ModifierTypeOption[] = [];
  if (hook.victoryRewards && hook.victoryRewards.length > 0) {
    const factories = modifierTypes as Record<string, (() => ModifierType) | undefined>;
    const seen = new Set<string>();
    for (const item of hook.victoryRewards) {
      if (seen.has(item.modifierType)) {
        continue;
      }
      seen.add(item.modifierType);
      const factory = factories[item.modifierType];
      if (typeof factory !== "function") {
        console.warn(`[llm-director] unknown modifierType in victoryRewards: "${item.modifierType}"`);
        continue;
      }
      const resolved = generateModifierType(factory);
      if (!resolved) {
        console.warn(`[llm-director] victoryRewards "${item.modifierType}" produced no compatible item — skipping`);
        continue;
      }
      guaranteed.push(new ModifierTypeOption(resolved, 0));
    }
  }

  console.info(
    `[llm-director] post-victory-hook applied wave=${waveIndex} postWinTextLen=${hook.postWinText?.length ?? 0} effects=${hook.victoryEffects?.length ?? 0} rewards=${hook.victoryRewards?.length ?? 0}`,
  );

  return () => {
    if (combined.length > 0) {
      globalScene.phaseManager.pushNew("MessagePhase", combined, null, true);
    }
    if (guaranteed.length > 0) {
      globalScene.phaseManager.pushNew(
        "SelectModifierPhase",
        0,
        undefined,
        {
          guaranteedModifierTypeOptions: guaranteed,
          fillRemaining: false,
          rerollMultiplier: 0,
        },
        false,
        { kind: "wave-boundary" },
      );
    }
  };
}
