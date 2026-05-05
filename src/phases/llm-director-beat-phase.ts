import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type {
  Beat,
  DialogueChoiceBeat,
  DialogueChoiceOption,
  ItemEventBeat,
  NarrativeOnlyBeat,
} from "#data/llm-director/beat-schema";
import { UiMode } from "#enums/ui-mode";
import { type ApplyResult, applyConsequence } from "#system/llm-director/beat-applier";
import { recordBeatHistory, recordPlayerChoice } from "#system/llm-director/beat-history";
import { getDirectorRuntime } from "#system/llm-director/director-runtime";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";

/**
 * Pulls the next pre-generated beat from the queue and routes to the
 * appropriate sub-flow.
 *
 * The phase is invoked from the wave-cadence hook (Task 19) on every third
 * wave. The pre-generation pipeline (Task 10) means the beat is usually
 * already buffered; on a buffer underrun we fall through to a filler beat
 * (Task 21) so the run never stalls.
 *
 * Renders use the existing UI primitives:
 *   - `narrative_only` → showText
 *   - `dialogue_choice` → showDialogue (speaker) + OPTION_SELECT (choices)
 *   - `item_event` → applyConsequence + showText
 *   - `trainer_battle` / `biome_transition` → wired in Tasks 16-17
 *
 * Using the existing primitives instead of a bespoke beat handler is a
 * deliberate deviation from the plan: it cuts surface area and matches the
 * mystery-encounter codebase pattern.
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

    recordBeatHistory(globalScene.gameData.llmDirectorState, beat, this.waveIndex);
    this.dispatch(beat);
  }

  private dispatch(beat: Beat): void {
    switch (beat.type) {
      case "narrative_only":
        this.renderNarrative(beat);
        return;
      case "dialogue_choice":
        this.renderDialogue(beat);
        return;
      case "trainer_battle":
        // Wired in Task 16. v1: show pre-battle text and end so the wave
        // continues with the upcoming vanilla content.
        this.renderTextThenEnd(beat.introText, beat.preBattleText);
        return;
      case "biome_transition":
        // Wired in Task 17. v1: show first option flavor text and end.
        this.renderTextThenEnd(beat.introText, beat.options[0]?.flavorText ?? "");
        return;
      case "item_event":
        this.renderItemEvent(beat);
        return;
    }
  }

  private renderNarrative(beat: NarrativeOnlyBeat): void {
    this.renderTextThenEnd(beat.introText, beat.bodyText);
  }

  private renderTextThenEnd(intro: string, body: string): void {
    const text = body ? `${intro}\n${body}` : intro;
    globalScene.ui.showText(text, null, () => this.end(), null, true);
  }

  /**
   * Render a dialogue choice: optional speaker line, then OPTION_SELECT for
   * the choices. The selected option's consequence is applied immediately;
   * any epilogue text is shown before the phase ends.
   */
  private renderDialogue(beat: DialogueChoiceBeat): void {
    const showChoices = () => this.showChoiceMenu(beat);
    if (beat.speaker?.name) {
      globalScene.ui.showDialogue(beat.introText, beat.speaker.name, null, showChoices);
    } else {
      globalScene.ui.showText(beat.introText, null, showChoices, null, true);
    }
  }

  private showChoiceMenu(beat: DialogueChoiceBeat): void {
    const items: OptionSelectItem[] = beat.options.map(opt => ({
      label: opt.label,
      handler: () => {
        this.handleChoiceSelected(opt);
        return true;
      },
    }));
    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options: items, noCancel: true });
  }

  private handleChoiceSelected(option: DialogueChoiceOption): void {
    const state = globalScene.gameData.llmDirectorState;
    recordPlayerChoice(state, option);
    const result = applyConsequence(state, option.consequence);
    // Pop the OPTION_SELECT overlay before showing follow-up text, so the
    // message handler renders cleanly on top of the dialogue background.
    globalScene.ui.revertMode();
    this.afterConsequence(result);
  }

  private renderItemEvent(beat: ItemEventBeat): void {
    const state = globalScene.gameData.llmDirectorState;
    const result = applyConsequence(state, beat.consequence);
    const text = result.epilogueText ? `${beat.introText}\n${result.epilogueText}` : beat.introText;
    globalScene.ui.showText(text, null, () => this.end(), null, true);
  }

  private afterConsequence(result: ApplyResult): void {
    if (result.epilogueText) {
      globalScene.ui.showText(result.epilogueText, null, () => this.end(), null, true);
      return;
    }
    this.end();
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
