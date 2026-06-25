import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { getCharVariantFromDialogue } from "#data/dialogue";
import {
  coopShouldQueueBossVoucherReward,
  coopVictoryDialogueDecision,
} from "#data/elite-redux/coop/coop-trainer-victory";
import { hasErGhostOverride } from "#data/elite-redux/er-ghost-teams";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { BiomeId } from "#enums/biome-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { BattlePhase } from "#phases/battle-phase";
import { achvs } from "#system/achv";
import { vouchers } from "#system/voucher";
import { randSeedItem } from "#utils/common";
import i18next from "i18next";

export class TrainerVictoryPhase extends BattlePhase {
  public readonly phaseName = "TrainerVictoryPhase";
  start() {
    globalScene.disableMenu = true;

    globalScene.playBgm(globalScene.currentBattle.trainer?.config.victoryBgm);

    globalScene.phaseManager.unshiftNew("MoneyRewardPhase", globalScene.currentBattle.trainer?.config.moneyMultiplier!); // TODO: is this bang correct?

    const modifierRewardFuncs = globalScene.currentBattle.trainer?.config.modifierRewardFuncs!; // TODO: is this bang correct?
    for (const modifierRewardFunc of modifierRewardFuncs) {
      globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierRewardFunc);
    }

    // ER: every trainer win grants small (1-egg) egg vouchers, scaled by the
    // run difficulty — Ace 1, Elite 2, Hell 3. Youngster (#368) is the
    // no-stakes trial mode: NO per-trainer vouchers.
    const erVoucherCount = { youngster: 0, ace: 1, elite: 2, hell: 3 }[getErDifficulty()];
    for (let i = 0; i < erVoucherCount; i++) {
      globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.VOUCHER);
    }

    const trainerType = globalScene.currentBattle.trainer?.config.trainerType!; // TODO: is this bang correct?
    const isCoop = globalScene.gameMode.isCoop;
    // Validate Voucher for boss trainers.
    //
    // The per-account voucher CREDIT (validateVoucher's side effect: voucherUnlocks +
    // voucherCounts + achvBar) must still run on every client - vouchers are per-account,
    // not shared. Keep its guard as `Object.hasOwn(vouchers, ...)` ALONE (NOT `&& isBoss`)
    // so the solo side-effect set is byte-for-byte identical to before; only boss types ever
    // land in the voucher registry, so this matches today's effective behavior.
    //
    // The QUEUE decision for the repeat-win bonus ModifierRewardPhase is the divergence
    // source: `!validateVoucher(...)` reads per-account save history, so two co-op clients
    // queue a different number of phases -> lockstep desync. In co-op we suppress the bonus
    // phase on BOTH clients (see coopShouldQueueBossVoucherReward); solo is unchanged.
    const hasBossVoucher = Object.hasOwn(vouchers, TrainerType[trainerType]);
    const creditedFirstTime = hasBossVoucher ? globalScene.validateVoucher(vouchers[TrainerType[trainerType]]) : false;
    if (
      hasBossVoucher
      && globalScene.currentBattle.trainer?.config.isBoss
      && coopShouldQueueBossVoucherReward(isCoop, creditedFirstTime)
    ) {
      if (timedEventManager.getUpgradeUnlockedVouchers()) {
        globalScene.phaseManager.unshiftNew(
          "ModifierRewardPhase",
          [
            modifierTypes.VOUCHER_PLUS,
            modifierTypes.VOUCHER_PLUS,
            modifierTypes.VOUCHER_PLUS,
            modifierTypes.VOUCHER_PREMIUM,
          ][vouchers[TrainerType[trainerType]].voucherType],
        );
      } else {
        globalScene.phaseManager.unshiftNew(
          "ModifierRewardPhase",
          [modifierTypes.VOUCHER, modifierTypes.VOUCHER, modifierTypes.VOUCHER_PLUS, modifierTypes.VOUCHER_PREMIUM][
            vouchers[TrainerType[trainerType]].voucherType
          ],
        );
      }
    }
    // Breeders in Space achievement
    if (
      globalScene.arena.biomeId === BiomeId.SPACE
      && (trainerType === TrainerType.BREEDER || trainerType === TrainerType.EXPERT_POKEMON_BREEDER)
    ) {
      globalScene.validateAchv(achvs.BREEDERS_IN_SPACE);
    }
    // Exorcist: defeating a cross-player GHOST-team trainer (#217).
    const trainer = globalScene.currentBattle.trainer;
    if (trainer && hasErGhostOverride(trainer)) {
      globalScene.validateAchv(achvs.EXORCIST);
    }

    globalScene.ui.showText(
      i18next.t("battle:trainerDefeated", {
        trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
      }),
      null,
      () => {
        // CO-OP (lockstep) determinism: the victory-message block below has TWO per-account
        // decision points - the call-site `ui.shouldSkipDialogue(message)` (gates the
        // char-sprite overlay async branch) AND `ui.showDialogue`'s OWN internal per-account
        // skip (gated by `skipSeenDialogues` + `gameData.getSeenDialogues()`, with the page
        // count further driven by per-account `gameData.gender`). Two accounts almost never
        // match, so one client takes the async overlay/dialogue path while the other ends
        // synchronously -> the clients leave this phase with a DIFFERENT number of async UI
        // waits and HANG. We skip the entire flavor block on BOTH clients (ALWAYS-SKIP) so the
        // async-wait count is a constant 0, provably identical regardless of per-account state.
        // This is the only policy that stays identical without editing ui.ts. Solo / authoritative
        // are untouched (the decision returns null and the original per-account logic runs).
        if (coopVictoryDialogueDecision(globalScene.gameMode.isCoop) === false) {
          this.end();
          return;
        }
        const victoryMessages = globalScene.currentBattle.trainer?.getVictoryMessages()!; // TODO: is this bang correct?
        let message: string;
        globalScene.executeWithSeedOffset(
          () => (message = randSeedItem(victoryMessages)),
          globalScene.currentBattle.waveIndex,
        );
        message = message!; // tell TS compiler it's defined now

        const showMessage = () => {
          const originalFunc = showMessageOrEnd;
          showMessageOrEnd = () =>
            globalScene.ui.showDialogue(
              message,
              globalScene.currentBattle.trainer?.getName(TrainerSlot.TRAINER, true),
              null,
              originalFunc,
            );

          showMessageOrEnd();
        };
        let showMessageOrEnd = () => this.end();
        if (victoryMessages?.length > 0) {
          if (globalScene.currentBattle.trainer?.config.hasCharSprite && !globalScene.ui.shouldSkipDialogue(message)) {
            const originalFunc = showMessageOrEnd;
            showMessageOrEnd = () =>
              globalScene.charSprite.hide().then(() => globalScene.hideFieldOverlay(250).then(() => originalFunc()));
            globalScene
              .showFieldOverlay(500)
              .then(() =>
                globalScene.charSprite
                  .showCharacter(
                    globalScene.currentBattle.trainer?.getKey()!,
                    getCharVariantFromDialogue(victoryMessages[0]),
                  )
                  .then(() => showMessage()),
              ); // TODO: is this bang correct?
          } else {
            showMessage();
          }
        } else {
          showMessageOrEnd();
        }
      },
      null,
      true,
    );

    this.showEnemyTrainer();
  }
}
