import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { recordCoopEvent } from "#data/elite-redux/coop/coop-turn-recorder";

export class HideAbilityPhase extends Phase {
  public readonly phaseName = "HideAbilityPhase";
  start() {
    super.start();

    // The flyout teardown is an ordered presentation boundary, not a renderer-local detail.
    // Without this event an authoritative guest can carry a stale ability bar into command input.
    recordCoopEvent({ k: "hideAbility" });
    if (!globalScene.showAbilityFlyouts || !globalScene.abilityBar.isVisible()) {
      globalScene.tweens.killTweensOf(globalScene.abilityBar);
      globalScene.abilityBar.setVisible(false);
      this.end();
      return;
    }
    globalScene.abilityBar.hide().then(() => {
      this.end();
    });
  }
}
