import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { initializeErEndlessContinuation } from "#data/elite-redux/er-endless-continuation";
import { prepareErEndlessGhostPool } from "#data/elite-redux/er-ghost-teams";
import { resetErMapNodes } from "#data/elite-redux/er-map-nodes";
import { BiomeId } from "#enums/biome-id";
import type { EndCardPhase } from "#phases/end-card-phase";

export class EndlessContinuationPhase extends Phase {
  public readonly phaseName = "EndlessContinuationPhase";

  constructor(private readonly endCardPhase?: EndCardPhase) {
    super();
  }

  start(): void {
    super.start();
    void this.enterEndless();
  }

  private async enterEndless(): Promise<void> {
    await globalScene.ui.fadeOut(500);
    this.endCardPhase?.endCard?.destroy();
    this.endCardPhase?.text?.destroy();
    this.endCardPhase?.difficultyText?.destroy();

    const completedWave = globalScene.currentBattle.waveIndex;
    const initialRifts = initializeErEndlessContinuation(completedWave, globalScene.seed);
    resetErMapNodes();
    await Promise.race([
      prepareErEndlessGhostPool(),
      new Promise<void>(resolve => globalScene.time.delayedCall(4000, resolve)),
    ]);

    globalScene.disableMenu = true;
    globalScene.field.setVisible(true);
    await globalScene.ui.fadeIn(300);
    for (const rift of initialRifts) {
      await globalScene.ui.showEndlessRiftReceived(rift);
    }

    globalScene.phaseManager.unshiftNew("NewBattlePhase");
    globalScene.phaseManager.unshiftNew("SwitchBiomePhase", BiomeId.TOWN);
    globalScene.disableMenu = false;
    this.end();
  }
}
