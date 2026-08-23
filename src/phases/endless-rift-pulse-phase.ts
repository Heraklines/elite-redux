import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { pulseErEndlessRifts } from "#data/elite-redux/er-endless-continuation";

export class EndlessRiftPulsePhase extends Phase {
  public readonly phaseName = "EndlessRiftPulsePhase";

  constructor(private readonly completedWave: number) {
    super();
  }

  start(): void {
    super.start();
    void this.revealNewRifts();
  }

  private async revealNewRifts(): Promise<void> {
    for (const rift of pulseErEndlessRifts(this.completedWave)) {
      await globalScene.ui.showEndlessRiftReceived(rift);
    }
    this.end();
  }
}
