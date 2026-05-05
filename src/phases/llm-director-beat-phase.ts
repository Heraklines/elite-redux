import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { Beat, Consequence } from "#data/llm-director/beat-schema";
import { applyConsequence } from "#system/llm-director/beat-applier";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";

/**
 * Pulls the next pre-generated beat from the queue and routes to the
 * appropriate sub-flow (UI handler, battle init, biome select, item event).
 *
 * The phase is invoked from the wave-cadence hook (Task 19) on every third
 * wave. The pre-generation pipeline (Task 10) means the beat is usually
 * already buffered; on a buffer underrun we fall through to a filler beat
 * (Task 21) so the run never stalls.
 *
 * The actual UI/battle dispatch for `dialogue_choice`, `trainer_battle`,
 * `biome_transition`, and `item_event` lands in Tasks 15-17. v1 of this
 * phase wires `narrative_only` end-to-end and stubs the others with a
 * single-line `showText` so the phase still resolves cleanly during
 * development.
 */
export class LLMDirectorBeatPhase extends Phase {
  public readonly phaseName = "LLMDirectorBeatPhase";

  /** Wave index whose beat we're firing. */
  private readonly waveIndex: number;
  /** ms to wait for queue before falling back. Default 2s. */
  private readonly takeTimeoutMs: number;

  public constructor(waveIndex: number, takeTimeoutMs = 2_000) {
    super();
    this.waveIndex = waveIndex;
    this.takeTimeoutMs = takeTimeoutMs;
  }

  public override async start(): Promise<void> {
    super.start();

    const runtime = getDirectorRuntime();
    if (!runtime) {
      // No runtime → mode was started without env config. Just end the phase
      // and let the vanilla flow resume.
      this.end();
      return;
    }

    const beat = await runtime.queue.tryTake(this.waveIndex, { timeoutMs: this.takeTimeoutMs });
    if (!beat) {
      this.handleUnderrun();
      return;
    }

    // Always kick off the next beat as soon as we resolve this one — keeps
    // the 1-ahead buffer warm.
    runtime.queue.kickOff(this.waveIndex + 3);

    this.recordHistory(beat);
    this.dispatch(beat);
  }

  private dispatch(beat: Beat): void {
    switch (beat.type) {
      case "narrative_only":
        this.showNarrative(beat.introText, beat.bodyText);
        return;
      case "dialogue_choice":
        // Wired in Task 15 (LLMDirectorBeatUiHandler).
        this.showNarrative(beat.introText, beat.options[0]?.label ?? "");
        return;
      case "trainer_battle":
        // Wired in Task 16 (initBattleWithEnemyConfig).
        this.showNarrative(beat.introText, beat.preBattleText);
        return;
      case "biome_transition":
        // Wired in Task 17.
        this.showNarrative(beat.introText, beat.options[0]?.flavorText ?? "");
        return;
      case "item_event":
        this.applyAndEnd(beat.consequence, beat.introText);
        return;
    }
  }

  private showNarrative(intro: string, body: string): void {
    const text = body ? `${intro}\n${body}` : intro;
    globalScene.ui.showText(text, null, () => this.end(), null, true);
  }

  private applyAndEnd(consequence: Consequence, introText: string): void {
    const state = globalScene.gameData.llmDirectorState;
    const result = applyConsequence(state, consequence);
    const tail = result.epilogueText ? `\n${result.epilogueText}` : "";
    globalScene.ui.showText(`${introText}${tail}`, null, () => this.end(), null, true);
  }

  private recordHistory(beat: Beat): void {
    const state = globalScene.gameData.llmDirectorState;
    state.beatHistory.push({
      beatId: beat.beatId,
      wave: this.waveIndex,
      beatType: beat.type,
      verbatim: beat,
    });
  }

  /**
   * Underrun: no beat was ready in time. v1 just logs and ends the phase;
   * Task 21 replaces this with a prefab filler beat so the player still
   * sees content rather than dead air.
   */
  private handleUnderrun(): void {
    console.warn(`[llm-director] queue underrun for wave ${this.waveIndex}; ending phase early`);
    this.end();
  }
}
