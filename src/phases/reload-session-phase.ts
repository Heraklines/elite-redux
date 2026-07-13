import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { UiMode } from "#enums/ui-mode";
import { fixedInt } from "#utils/common";

export class ReloadSessionPhase extends Phase {
  public readonly phaseName = "ReloadSessionPhase";
  private systemDataStr?: string | undefined;

  constructor(systemDataStr?: string) {
    super();

    this.systemDataStr = systemDataStr;
  }

  start(): void {
    globalScene.ui.setMode(UiMode.SESSION_RELOAD);

    let delayElapsed = false;
    let loaded = false;

    globalScene.time.delayedCall(fixedInt(1500), () => {
      if (loaded) {
        this.end();
      } else {
        delayElapsed = true;
      }
    });

    void (async () => {
      const cleared = await globalScene.gameData.clearLocalData();
      if (!cleared) {
        throw new Error("local save refresh could not acquire an account-safe persistence lease");
      }
      if (this.systemDataStr) {
        await globalScene.gameData.initSystem(this.systemDataStr);
      } else {
        await globalScene.gameData.loadSystem();
      }
      if (delayElapsed) {
        this.end();
      } else {
        loaded = true;
      }
    })().catch(error => {
      console.error("Session reload failed closed", error);
      delayElapsed = true;
      globalScene.ui.showText(
        "Could not safely refresh your save. Your co-op checkpoints were preserved; return to the title and retry.",
        null,
        () => {
          globalScene.phaseManager.toTitleScreen();
          this.end();
        },
        null,
        true,
      );
    });
  }
}
