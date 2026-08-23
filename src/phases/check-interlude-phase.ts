import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";

export class CheckInterludePhase extends Phase {
  public override readonly phaseName = "CheckInterludePhase";

  public override start(): void {
    super.start();
    const { phaseManager } = globalScene;
    const { waveIndex } = globalScene.currentBattle;

    if (globalScene.gameMode.isBoss(waveIndex) && globalScene.getEnemyParty().every(p => p.isFainted())) {
      phaseManager.onInterlude();
    }

    this.end();
  }
}
