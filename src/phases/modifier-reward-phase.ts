import { globalScene } from "#app/global-scene";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { isCoopAuthoritativeGuest } from "#data/elite-redux/coop/coop-runtime";
import { AddVoucherModifierType, type ModifierType } from "#modifiers/modifier-type";
import { BattlePhase } from "#phases/battle-phase";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { getModifierType } from "#utils/modifier-utils";
import i18next from "i18next";

export class ModifierRewardPhase extends BattlePhase {
  // RibbonModifierRewardPhase extends ModifierRewardPhase and to make typescript happy
  // we need to use a union type here
  public readonly phaseName: "ModifierRewardPhase" | "RibbonModifierRewardPhase" | "GameOverModifierRewardPhase" =
    "ModifierRewardPhase";
  protected modifierType: ModifierType;

  constructor(modifierTypeFunc: ModifierTypeFunc) {
    super();

    this.modifierType = getModifierType(modifierTypeFunc);
  }

  start() {
    super.start();

    // The authoritative renderer may apply only account-local voucher credit. Shared run modifiers are
    // host mutations and arrive through the authoritative state carrier; running their generator here
    // would create a second source of truth. Keeping this decision inside the phase makes its renderer
    // allowlist classification context-safe for every caller.
    if (isCoopAuthoritativeGuest() && !(this.modifierType instanceof AddVoucherModifierType)) {
      coopLog("reward", `renderer SKIP shared ModifierRewardPhase type=${this.modifierType.name}`);
      this.end();
      return;
    }
    this.doReward().then(() => this.end());
  }

  doReward(): Promise<void> {
    return new Promise<void>(resolve => {
      const newModifier = this.modifierType.newModifier();
      globalScene.addModifier(newModifier);
      globalScene.playSound("item_fanfare");
      globalScene.ui.showText(
        i18next.t("battle:rewardGain", {
          modifierName: newModifier?.type.name,
        }),
        null,
        () => resolve(),
        null,
        true,
      );
    });
  }
}
