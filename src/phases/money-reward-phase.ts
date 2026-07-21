import { globalScene } from "#app/global-scene";
import { getCapturedBattleMoneyGainMultiplier } from "#data/elite-redux/archetypes/ability-meta-consumers";
import { isCoopAuthoritativeGuest } from "#data/elite-redux/coop/coop-runtime";
import { erGamblersCoinPayoutMultiplier } from "#data/elite-redux/er-relics";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { MoneyMultiplierModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";

export class MoneyRewardPhase extends BattlePhase {
  public readonly phaseName = "MoneyRewardPhase";
  private readonly moneyMultiplier: number;

  constructor(moneyMultiplier: number) {
    super();

    this.moneyMultiplier = moneyMultiplier;
  }

  start() {
    const moneyAmount = new NumberHolder(globalScene.getWaveMoneyAmount(this.moneyMultiplier));

    globalScene.applyModifiers(MoneyMultiplierModifier, true, moneyAmount);

    if (globalScene.arena.getTag(ArenaTagType.HAPPY_HOUR)) {
      moneyAmount.value *= 2;
    }

    moneyAmount.value = Math.floor(moneyAmount.value * getCapturedBattleMoneyGainMultiplier());

    // ER relic (#439): Gambler's Coin - after a TRAINER battle, the payout is doubled
    // 50% of the time and lost (zeroed) the other 50%. The coin flip is seeded per wave
    // so it's stable across reward rerolls / a reload. 1x (untouched) on non-trainer
    // money or when the relic isn't held.
    let gambled = false;
    let gambleWon = false;
    if (globalScene.currentBattle?.battleType === BattleType.TRAINER) {
      const coin = erGamblersCoinPayoutMultiplier();
      if (coin !== 1) {
        gambled = true;
        gambleWon = coin > 1;
        moneyAmount.value = Math.floor(moneyAmount.value * coin);
      }
    }

    // Co-op (#633 trainer-victory deadlock): `globalScene.money` is ONE shared pool that is
    // host-authoritative in the authoritative netcode (the guest reconciles to the host's snapshot).
    // The guest now runs the full TrainerVictoryPhase -> MoneyRewardPhase chain (so its account gets
    // the per-account vouchers), but it must NOT also ADD to the shared money - that would transiently
    // double it until the next resync corrects it. So the authoritative GUEST renders the "money won"
    // line WITHOUT mutating the pool. LOCKSTEP is unchanged: both clients add the same amount
    // deterministically (the shared pool stays correct). Solo / host add as before.
    if (!isCoopAuthoritativeGuest()) {
      globalScene.addMoney(moneyAmount.value);
    }

    const userLocale = navigator.language || "en-US";
    const formattedMoneyAmount = moneyAmount.value.toLocaleString(userLocale);
    const message = i18next.t("battle:moneyWon", {
      moneyAmount: formattedMoneyAmount,
    });

    globalScene.ui.showText(message, null, () => this.end(), null, true);
    // ER custom relic - English-only (shared locales submodule). Queue a short note so
    // the player sees the coin flip's outcome after the money line.
    if (gambled) {
      globalScene.phaseManager.queueMessage(
        gambleWon
          ? "The Gambler's Coin came up heads - the spoils are doubled!"
          : "The Gambler's Coin came up tails - the spoils slip away!",
      );
    }
  }
}
