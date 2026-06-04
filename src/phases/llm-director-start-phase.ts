import { Phase } from "#app/phase";
import { ensurePendingBible, getDirectorRuntime } from "#system/llm-director/director-runtime";
import { generateStoryBible } from "#system/llm-director/generate-story-bible";

/**
 * Run-start kick-off for LLM Director mode. Picks a random theme seed and
 * fires the bible-generation request in the background, then ends
 * immediately so the player can pick starters while the LLM works.
 *
 * The actual "wait until bible is ready and apply it" happens in
 * `LLMDirectorBiblePhase`, which is pushed AFTER `SelectStarterPhase`.
 *
 * Cache behavior: if a previous Director pick already kicked off generation
 * (and the player backed out without playing), this phase reuses that
 * pending entry — no new LLM call. The cache is cleared by BiblePhase
 * once the run actually starts.
 */
export class LLMDirectorStartPhase extends Phase {
  public readonly phaseName = "LLMDirectorStartPhase";

  public override start(): void {
    super.start();

    const runtime = getDirectorRuntime();
    if (!runtime) {
      // Missing API config. BiblePhase will detect the same condition and
      // fall back to Classic. Nothing to kick off here.
      this.end();
      return;
    }

    // Idempotent: if a generation is already in flight from a previous
    // mode-pick, this returns the same pending entry without a new call.
    ensurePendingBible(seed => generateStoryBible(runtime.client, { seedText: seed.text }));

    this.end();
  }
}
