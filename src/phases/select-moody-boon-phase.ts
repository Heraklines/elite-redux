import { globalScene } from "#app/global-scene";
import { getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";

export class SelectMoodyBoonPhase extends BattlePhase {
  public readonly phaseName = "SelectMoodyBoonPhase";

  constructor(private readonly waveIndex: number) {
    super();
  }

  start(): void {
    super.start();
    if (getMoodyModeState() == null) {
      this.end();
      return;
    }
    void globalScene.ui.setMode(UiMode.MOODY_BOON_SELECT, this.waveIndex, () => this.end());
  }
}
