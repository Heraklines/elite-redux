import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { ThemeSeed } from "#data/llm-director/theme-seeds";
import { UiMode } from "#enums/ui-mode";

/**
 * Run-start phase for LLM Director mode. Opens the theme picker UI; on
 * Accept, queues the bible-generation phase with the chosen seed and ends.
 *
 * This phase is pushed after `SelectStarterPhase` so the player picks their
 * party first (matching Classic), then chooses the run's story seed before
 * the first beat is generated.
 */
export class LLMDirectorStartPhase extends Phase {
  public readonly phaseName = "LLMDirectorStartPhase";

  public override start(): void {
    super.start();
    globalScene.ui.setOverlayMode(UiMode.LLM_DIRECTOR_THEME_PICKER, {
      onAccept: (seed: ThemeSeed) => {
        // Pop the picker overlay and queue the bible phase.
        globalScene.ui.revertMode();
        globalScene.phaseManager.unshiftNew("LLMDirectorBiblePhase", seed);
        this.end();
      },
      onCancel: () => {
        // Cancel the run setup entirely. End the phase; the next pushed
        // phase (EncounterPhase) will fire and the player still gets a
        // playable run, just without Director content.
        this.end();
      },
    });
  }
}
