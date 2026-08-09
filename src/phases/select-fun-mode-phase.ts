import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { UiMode } from "#enums/ui-mode";

export class SelectFunModePhase extends Phase {
  public readonly phaseName = "SelectFunModePhase";

  start(): void {
    super.start();
    globalScene.playBgm("menu");
    globalScene.ui.setMode(UiMode.FUN_MODE_SELECT);
  }
}
