import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { UiMode } from "#enums/ui-mode";
import type { MoodySectionReportConfig } from "#ui/moody/moody-section-report-ui-handler";

export class MoodySectionReportPhase extends Phase {
  public readonly phaseName = "MoodySectionReportPhase";
  private readonly config: Omit<MoodySectionReportConfig, "onAction">;

  constructor(config: Omit<MoodySectionReportConfig, "onAction">) {
    super();
    this.config = config;
  }

  public override start(): void {
    super.start();
    globalScene.ui
      .setOverlayMode(UiMode.MOODY_SECTION_REPORT, {
        ...this.config,
        onAction: () => this.end(),
      })
      .catch(() => this.end());
  }
}
