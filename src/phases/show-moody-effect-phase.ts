import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { MoodyEffectFlyoutCue } from "#data/elite-redux/moody/moody-effect-flyout";

export class ShowMoodyEffectPhase extends Phase {
  public readonly phaseName = "ShowMoodyEffectPhase";
  private readonly cue: MoodyEffectFlyoutCue;

  constructor(cue: MoodyEffectFlyoutCue) {
    super();
    this.cue = cue;
  }

  public start(): void {
    super.start();
    if (!globalScene.showMoodyEffectFlyouts || globalScene.currentBattle == null) {
      this.end();
      return;
    }
    if (globalScene.abilityBar.isVisible()) {
      globalScene.phaseManager.unshiftNew("HideAbilityPhase");
      globalScene.phaseManager.unshiftPhase(new ShowMoodyEffectPhase(this.cue));
      this.end();
      return;
    }
    globalScene.abilityBar.showTrainerEffect(this.cue.name, this.cue.kind, this.cue.side).then(() => this.end());
  }
}
