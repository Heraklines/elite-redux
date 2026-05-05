import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type {
  Beat,
  BiomeTransitionBeat,
  BiomeTransitionOption,
  DialogueChoiceBeat,
  DialogueChoiceOption,
  ItemEventBeat,
  NarrativeOnlyBeat,
  TrainerBattleBeat,
} from "#data/llm-director/beat-schema";
import { pickFillerBeat } from "#data/llm-director/filler-beats";
import type { BiomeId } from "#enums/biome-id";
import { UiMode } from "#enums/ui-mode";
import { buildTrainerOverride } from "#phases/llm-director-beat-utils";
import { type ApplyResult, applyConsequence } from "#system/llm-director/beat-applier";
import { recordBeatHistory, recordPlayerChoice } from "#system/llm-director/beat-history";
import { compactHistory, HISTORY_COMPACT_THRESHOLD } from "#system/llm-director/compact-history";
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
    // Compaction runs in the background as soon as history grows past the
    // threshold. We don't await — the result lands on `state.beatHistory`
    // before the next envelope is built, and a missed window just means
    // one more uncompacted envelope.
    if (globalScene.gameData.llmDirectorState.beatHistory.length > HISTORY_COMPACT_THRESHOLD) {
      void compactHistory(globalScene.gameData.llmDirectorState, runtime.client);
    }
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
        this.renderTrainerBattle(beat);
        return;
      case "biome_transition":
        this.renderBiomeTransition(beat);
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

  /**
   * Trainer-battle beat: build the inter-beat override for the next vanilla
   * NewBattlePhase (offset +1) so the upcoming trainer is rewritten with our
   * spec, then show the pre-battle text and end. The actual battle resolves
   * via Task 18's NewBattlePhase hook.
   */
  private renderTrainerBattle(beat: TrainerBattleBeat): void {
    const runtime = getDirectorRuntime();
    if (runtime) {
      const override = buildTrainerOverride(beat, { recentFaints: this.countRecentFaints() });
      if (override) {
        runtime.queue.setInterBeatOverride(this.waveIndex + override.atWaveOffset, override);
      }
    }
    this.renderTextThenEnd(beat.introText, beat.preBattleText);
  }

  /**
   * Number of party faints across the last 10 waves. Used to gate brutal
   * trainer beats (the balance rails roll back +10 to ±3 if this is non-zero).
   *
   * v1: conservatively reports 0 — the LLM's own `difficultyTag` already
   * gates brutal beats, and threading a 10-wave-window faint count from
   * `globalScene` is deferred to v2.
   */
  private countRecentFaints(): number {
    return 0;
  }

  /**
   * Biome-transition beat: show the intro then OPTION_SELECT for the
   * options. The selected option's consequence (if any) is applied, the
   * chosen biome is queued via SwitchBiomePhase, and the option's flavor
   * text is shown before the phase ends.
   */
  private renderBiomeTransition(beat: BiomeTransitionBeat): void {
    const showOptions = () => this.showBiomeOptions(beat);
    globalScene.ui.showText(beat.introText, null, showOptions, null, true);
  }

  private showBiomeOptions(beat: BiomeTransitionBeat): void {
    const items: OptionSelectItem[] = beat.options.map(opt => ({
      label: opt.flavorText.split("\n")[0].slice(0, 40), // first line, abbreviated
      handler: () => {
        this.handleBiomeOptionSelected(opt);
        return true;
      },
    }));
    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options: items, noCancel: true });
  }

  private handleBiomeOptionSelected(option: BiomeTransitionOption): void {
    const state = globalScene.gameData.llmDirectorState;
    let result: ApplyResult = {};
    if (option.consequence) {
      result = applyConsequence(state, option.consequence);
    }
    globalScene.ui.revertMode();
    // Queue the biome switch ahead of the next vanilla wave.
    globalScene.phaseManager.unshiftNew("SwitchBiomePhase", option.biomeId as BiomeId);
    const tail = result.epilogueText ? `\n${result.epilogueText}` : "";
    globalScene.ui.showText(`${option.flavorText}${tail}`, null, () => this.end(), null, true);
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
   * Underrun: no beat was ready in time. Pick a tone-neutral filler beat,
   * record it in history (so the LLM gets a placeholder to refer back to
   * rather than a gap), and render it. The queue keeps generating in the
   * background; the next 1-ahead slot should be back on cadence.
   */
  private handleUnderrun(): void {
    console.warn(`[llm-director] queue underrun for wave ${this.waveIndex}; rendering filler beat`);
    const filler = pickFillerBeat();
    recordBeatHistory(globalScene.gameData.llmDirectorState, filler, this.waveIndex);
    // Re-kick the next slot in case the queue lost the kickOff race.
    const runtime = getDirectorRuntime();
    if (runtime) {
      runtime.queue.kickOff(this.waveIndex + 3);
    }
    this.renderNarrative(filler);
  }
}
