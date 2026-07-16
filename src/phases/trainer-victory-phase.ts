import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { getCharVariantFromDialogue } from "#data/dialogue";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import { isCoopMeOperationJournalActive } from "#data/elite-redux/coop/coop-me-operation";
import { captureCoopActiveMysteryControl } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  failCoopSharedSession,
  getCoopActiveWaveTransition,
  getCoopWaveAdvanceRuntimeBinding,
  isCoopAuthoritativeGuest,
} from "#data/elite-redux/coop/coop-runtime";
import {
  coopShouldQueueBossVoucherReward,
  coopVictoryDialogueDecision,
} from "#data/elite-redux/coop/coop-trainer-victory";
import {
  type CoopTrainerVictoryBoundary,
  clearCoopTrainerVictoryBoundary,
  getCoopTrainerVictoryBoundary,
  snapshotCoopTrainerVictoryBoundary,
} from "#data/elite-redux/coop/coop-trainer-victory-boundary";
import { getCoopPendingWaveContinuationBoundary } from "#data/elite-redux/coop/coop-wave-operation";
import { erRecordAchievementTrainerVictory } from "#data/elite-redux/er-achievement-tracker";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { BiomeId } from "#enums/biome-id";
import { TrainerType } from "#enums/trainer-type";
import { BattlePhase } from "#phases/battle-phase";
import { achvs } from "#system/achv";
import { vouchers } from "#system/voucher";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedItem } from "#utils/common";
import i18next from "i18next";

interface ResolvedTrainerVictoryBoundary {
  readonly authoritativeGuest: boolean;
  readonly victory: CoopTrainerVictoryBoundary;
  readonly liveTrainerMatches: boolean;
}

function resolveTrainerVictoryBoundary(): ResolvedTrainerVictoryBoundary | null {
  const authoritativeGuest = isCoopAuthoritativeGuest();
  if (!authoritativeGuest) {
    const victory = snapshotCoopTrainerVictoryBoundary(globalScene, globalScene.currentBattle);
    if (victory == null) {
      throw new Error("TrainerVictoryPhase started without a trainer battle");
    }
    return { authoritativeGuest, victory, liveTrainerMatches: true };
  }

  const ambientBattle = globalScene.currentBattle;
  const meControl = captureCoopActiveMysteryControl();
  if (
    isCoopMeOperationJournalActive()
    && meControl?.terminal === "battle-settled"
    && ambientBattle?.isBattleMysteryEncounter?.()
  ) {
    const victory = snapshotCoopTrainerVictoryBoundary(globalScene, ambientBattle);
    if (victory == null) {
      failCoopSharedSession("The retained Mystery settlement declared trainer victory without a trainer boundary.");
      return null;
    }
    return { authoritativeGuest, victory, liveTrainerMatches: true };
  }

  const retainedBinding = getCoopWaveAdvanceRuntimeBinding();
  const retainedBoundary = retainedBinding == null ? null : getCoopPendingWaveContinuationBoundary(retainedBinding);
  const retainedTransition = retainedBoundary == null ? null : getCoopActiveWaveTransition(retainedBoundary.wave);
  if (retainedBoundary == null || retainedTransition?.victoryKind !== "trainer") {
    const currentIdentity = globalScene.currentBattle?.trainer?.config.trainerType ?? "none";
    failCoopSharedSession(
      `The retained trainer-victory boundary was missing or mismatched (ambient trainer ${currentIdentity}).`,
    );
    return null;
  }

  const victory = getCoopTrainerVictoryBoundary(globalScene, retainedBoundary.wave);
  if (victory == null || victory.sourceWave !== retainedBoundary.wave) {
    const retainedIdentity = victory?.trainerType ?? "none";
    failCoopSharedSession(
      `The retained trainer-victory context for wave ${retainedBoundary.wave} was unavailable or mismatched (trainer ${retainedIdentity}).`,
    );
    return null;
  }

  const liveTrainerMatches =
    ambientBattle?.waveIndex === victory.sourceWave
    && ambientBattle.trainer?.config.trainerType === victory.trainerType;
  if (
    ambientBattle?.waveIndex === victory.sourceWave
    && ambientBattle.trainer != null
    && ambientBattle.trainer.config.trainerType !== victory.trainerType
  ) {
    failCoopSharedSession(
      `The retained trainer-victory context for wave ${victory.sourceWave} named trainer ${victory.trainerType}, but the live source battle named trainer ${ambientBattle.trainer.config.trainerType}.`,
    );
    return null;
  }
  return { authoritativeGuest, victory, liveTrainerMatches };
}

function queueTrainerVictoryRewards(victory: CoopTrainerVictoryBoundary): void {
  globalScene.phaseManager.unshiftNew("MoneyRewardPhase", victory.moneyMultiplier);
  for (const modifierRewardFunc of victory.modifierRewardFuncs) {
    globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierRewardFunc);
  }

  // Per-account ER trainer vouchers: Youngster 0, Ace 1, Elite 2, Hell 3.
  const erVoucherCount = { youngster: 0, ace: 1, elite: 2, hell: 3 }[getErDifficulty()];
  for (let i = 0; i < erVoucherCount; i++) {
    globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.VOUCHER);
  }

  // Voucher validation remains per-account on both peers. Its repeat-win reward is suppressed in co-op by
  // coopShouldQueueBossVoucherReward so account-local history cannot produce different phase counts.
  const voucher = vouchers[TrainerType[victory.trainerType]];
  if (voucher == null) {
    return;
  }
  const creditedFirstTime = globalScene.validateVoucher(voucher);
  if (!victory.isBoss || !coopShouldQueueBossVoucherReward(globalScene.gameMode.isCoop, creditedFirstTime)) {
    return;
  }
  const upgradedRewards: readonly ModifierTypeFunc[] = [
    modifierTypes.VOUCHER_PLUS,
    modifierTypes.VOUCHER_PLUS,
    modifierTypes.VOUCHER_PLUS,
    modifierTypes.VOUCHER_PREMIUM,
  ];
  const standardRewards: readonly ModifierTypeFunc[] = [
    modifierTypes.VOUCHER,
    modifierTypes.VOUCHER,
    modifierTypes.VOUCHER_PLUS,
    modifierTypes.VOUCHER_PREMIUM,
  ];
  const rewards = timedEventManager.getUpgradeUnlockedVouchers() ? upgradedRewards : standardRewards;
  globalScene.phaseManager.unshiftNew("ModifierRewardPhase", rewards[voucher.voucherType]!);
}

function applyTrainerVictoryAchievements(victory: CoopTrainerVictoryBoundary, liveTrainerMatches: boolean): void {
  if (
    victory.biomeId === BiomeId.SPACE
    && (victory.trainerType === TrainerType.BREEDER || victory.trainerType === TrainerType.EXPERT_POKEMON_BREEDER)
  ) {
    globalScene.validateAchv(achvs.BREEDERS_IN_SPACE);
  }
  if (victory.isErGhost) {
    globalScene.validateAchv(achvs.EXORCIST);
  }
  if (liveTrainerMatches) {
    erRecordAchievementTrainerVictory();
    return;
  }
  // This legacy achievement observer still reads the live Battle. Never let an automatic retained
  // boundary award the next wave's trainer-specific achievements; the source identity remains explicit.
  coopWarn(
    "progression",
    `defer ambient-only trainer achievement checks sourceWave=${victory.sourceWave} trainer=${victory.trainerType}`,
  );
}

function showTrainerVictoryMessage(victory: CoopTrainerVictoryBoundary, finish: () => void): void {
  globalScene.ui.showText(
    i18next.t("battle:trainerDefeated", { trainerName: victory.trainerName }),
    null,
    () => {
      // Co-op skips trainer flavor on both peers: account-local seen-dialogue history cannot add asymmetric waits.
      if (coopVictoryDialogueDecision(globalScene.gameMode.isCoop) === false) {
        finish();
        return;
      }
      const victoryMessages = victory.victoryMessages;
      let message = "";
      globalScene.executeWithSeedOffset(() => (message = randSeedItem(victoryMessages)), victory.sourceWave);
      let showMessageOrEnd = finish;
      const showMessage = () => {
        const originalFunc = showMessageOrEnd;
        showMessageOrEnd = () => globalScene.ui.showDialogue(message, victory.trainerDialogueName, null, originalFunc);
        showMessageOrEnd();
      };
      if (victoryMessages.length === 0) {
        showMessageOrEnd();
        return;
      }
      if (!victory.hasCharSprite || globalScene.ui.shouldSkipDialogue(message)) {
        showMessage();
        return;
      }
      const originalFunc = showMessageOrEnd;
      showMessageOrEnd = () =>
        globalScene.charSprite.hide().then(() => globalScene.hideFieldOverlay(250).then(() => originalFunc()));
      globalScene
        .showFieldOverlay(500)
        .then(() =>
          globalScene.charSprite
            .showCharacter(victory.trainerSpriteKey, getCharVariantFromDialogue(victoryMessages[0]))
            .then(showMessage),
        );
    },
    null,
    true,
  );
}

export class TrainerVictoryPhase extends BattlePhase {
  public readonly phaseName = "TrainerVictoryPhase";

  start() {
    const resolved = resolveTrainerVictoryBoundary();
    if (resolved == null) {
      return;
    }
    const { authoritativeGuest, victory, liveTrainerMatches } = resolved;
    const finish = () => {
      this.end();
      if (authoritativeGuest) {
        clearCoopTrainerVictoryBoundary(globalScene, victory.sourceWave);
      }
    };

    globalScene.disableMenu = true;
    globalScene.playBgm(victory.victoryBgm);
    queueTrainerVictoryRewards(victory);
    applyTrainerVictoryAchievements(victory, liveTrainerMatches);
    showTrainerVictoryMessage(victory, finish);
    if (liveTrainerMatches) {
      this.showEnemyTrainer();
    }
  }
}
