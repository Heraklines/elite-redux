import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { UiMode } from "#enums/ui-mode";
import type { EndCardPhase } from "#phases/end-card-phase";

/** Post-clear choice. This phase starts only after the ordinary victory commit has completed. */
export class EndlessOfferPhase extends Phase {
  public readonly phaseName = "EndlessOfferPhase";

  constructor(private readonly endCardPhase?: EndCardPhase) {
    super();
  }

  start(): void {
    super.start();
    globalScene.ui.showText("Enter the Endless Rift?", null, () => {
      globalScene.ui.setMode(
        UiMode.CONFIRM,
        () => {
          globalScene.ui.setMode(UiMode.MESSAGE);
          globalScene.phaseManager.unshiftNew("EndlessContinuationPhase", this.endCardPhase);
          this.end();
        },
        () => {
          globalScene.ui.setMode(UiMode.MESSAGE);
          globalScene.phaseManager.unshiftNew("PostGameOverPhase", globalScene.sessionSlotId, this.endCardPhase);
          this.end();
        },
        false,
        0,
        0,
        1000,
      );
    });
  }
}
