import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { modifierTypes } from "#data/data-lists";
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
import type { ModifierType } from "#modifiers/modifier-type";
import { buildTrainerOverride } from "#phases/llm-director-beat-utils";
import { type ApplyResult, applyConsequence } from "#system/llm-director/beat-applier";
import { recordBeatHistory, recordPlayerChoice } from "#system/llm-director/beat-history";
import { compactHistory, HISTORY_COMPACT_THRESHOLD } from "#system/llm-director/compact-history";
import { applyEffects, resolveItemThunk } from "#system/llm-director/consequence-effects";
import { logBeatDispatched, logChoiceMade, logTrainerOverride, logUnderrun } from "#system/llm-director/director-log";
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
    console.info(`[llm-director] BeatPhase start, wave=${this.waveIndex}`);

    const runtime = getDirectorRuntime();
    if (!runtime) {
      // No runtime → mode was started without env config. Just end the phase
      // and let the vanilla flow resume.
      console.warn("[llm-director] BeatPhase: no runtime, ending without beat");
      this.end();
      return;
    }

    const beat = await runtime.queue.tryTake(this.waveIndex, { timeoutMs: this.takeTimeoutMs });
    if (!beat) {
      logUnderrun(this.waveIndex);
      this.handleUnderrun();
      return;
    }
    logBeatDispatched(this.waveIndex, beat.type, beat.beatId);

    // Always kick off the next beat as soon as we resolve this one — keeps
    // the 1-ahead buffer warm. Snap to the regular 3-wave cadence so the
    // wave-1 forced beat schedules wave 3 (not wave 4) — otherwise wave 4
    // gets generated but never consumed (NewBattlePhase only fires beats
    // on wave % 3 === 0) and wave 3 underruns.
    const nextWave = Math.max(3, Math.floor(this.waveIndex / 3) * 3 + 3);
    runtime.queue.kickOff(nextWave);

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
    // setMode(MESSAGE) routes Enter to the message handler so MessagePhase
    // can advance. Without it the previous mode's handler intercepts input
    // and the player gets stuck.
    void globalScene.ui.setMode(UiMode.MESSAGE);
    // queueMessage unshifts to the front of the queue, so the LAST call
    // ends up running FIRST. To preserve source order (intro → body),
    // queue body first, then intro.
    if (body) {
      globalScene.phaseManager.queueMessage(paginate(body), null, true);
    }
    if (intro) {
      globalScene.phaseManager.queueMessage(paginate(intro), null, true);
    }
    this.end();
  }

  /**
   * Render a dialogue choice: optional speaker line, then OPTION_SELECT for
   * the choices. The selected option's consequence is applied immediately;
   * any epilogue text is shown before the phase ends.
   */
  private renderDialogue(beat: DialogueChoiceBeat): void {
    const showChoices = () => this.showChoiceMenu(beat);
    // Dialogue intros must fit ONE Phaser dialog page (~100 chars with a
    // speaker name eating box space). Going longer means the player
    // pre-emptively sees the truncated text *and* the option overlay
    // opens on a single page-advance — not a clean "read everything,
    // then choose" flow.
    // Use paginate so long dialogue intros split into multiple pages
    // (showDialogue auto-paginates on `$`) — the option overlay only opens
    // after the LAST page advance.
    const intro = paginate(beat.introText);
    void globalScene.ui.setMode(UiMode.MESSAGE);
    if (beat.speaker?.name) {
      globalScene.ui.showDialogue(intro, beat.speaker.name, null, showChoices);
    } else {
      globalScene.ui.showText(intro, null, showChoices, null, true);
    }
  }

  private showChoiceMenu(beat: DialogueChoiceBeat): void {
    const items: OptionSelectItem[] = beat.options.map(opt => ({
      // Hard cap option label length so the OPTION_SELECT widget doesn't
      // clip on the left edge.
      label: truncate(opt.label, 50),
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
    logChoiceMade("(current)", option.label, {
      alignment: option.consequence.alignment,
      factionRep: option.consequence.factionRep,
      flags: option.consequence.flags,
      itemCount: option.consequence.items?.length ?? 0,
      hasEpilogue: !!result.epilogueText,
    });
    // Apply game-state side effects + collect any narrative messages from
    // effects (custom descriptions, biome flavor, etc.).
    const effectMessages = grantConsequenceRewards(option.consequence);
    // Pop the OPTION_SELECT overlay so the message handler renders cleanly.
    globalScene.ui.revertMode();
    // Consolidate effect messages + epilogue into ONE `$`-paginated
    // MessagePhase. PokéRogue's MessagePhase auto-paginates on `$` and
    // chains pages with single-press advance, so the player never gets
    // stuck between separate MessagePhases racing with mode changes.
    this.queueConsolidatedTail(effectMessages, result.epilogueText);
    this.end();
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
        const targetWave = this.waveIndex + override.atWaveOffset;
        runtime.queue.setInterBeatOverride(targetWave, override);
        logTrainerOverride(targetWave, override);
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
    // Intro via showText with the option-overlay opener as the callback —
    // here the chain is short enough (1 page) that the showText callback
    // path is acceptable. If we ever need multi-page intros for biome
    // beats, switch to queueMessage and a follow-up CallbackPhase.
    const showOptions = () => this.showBiomeOptions(beat);
    globalScene.ui.showText(paginate(beat.introText), null, showOptions, null, true);
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
    let effectMessages: string[] = [];
    if (option.consequence) {
      result = applyConsequence(state, option.consequence);
      effectMessages = grantConsequenceRewards(option.consequence);
    }
    globalScene.ui.revertMode();
    // Queue the biome switch ahead of the next vanilla wave.
    globalScene.phaseManager.unshiftNew("SwitchBiomePhase", option.biomeId as BiomeId);
    // Consolidate flavor text + effect messages + epilogue into ONE
    // paginated message. Order: flavor (option's own description),
    // effect messages, epilogue.
    const tail: string[] = [];
    if (option.flavorText) {
      tail.push(option.flavorText);
    }
    tail.push(...effectMessages);
    if (result.epilogueText) {
      tail.push(result.epilogueText);
    }
    this.queueConsolidatedTail(tail, undefined);
    this.end();
  }

  private renderItemEvent(beat: ItemEventBeat): void {
    const state = globalScene.gameData.llmDirectorState;
    const result = applyConsequence(state, beat.consequence);
    const effectMessages = grantConsequenceRewards(beat.consequence);
    const tail: string[] = [];
    if (beat.introText) {
      tail.push(beat.introText);
    }
    tail.push(...effectMessages);
    if (result.epilogueText) {
      tail.push(result.epilogueText);
    }
    this.queueConsolidatedTail(tail, undefined);
    this.end();
  }

  /**
   * Consolidate multiple text fragments into ONE `$`-paginated MessagePhase.
   * The phase handler auto-paginates on `$` so Enter advances through pages
   * of one dialog instead of fighting between separate MessagePhases that
   * race with battle UI mode changes. Empty / whitespace-only entries are
   * skipped. If the combined string is empty, no message is queued.
   */
  private queueConsolidatedTail(parts: string[], _trailing: string | undefined): void {
    const cleaned = parts.map(p => (p ?? "").trim()).filter(p => p.length > 0);
    if (cleaned.length === 0) {
      return;
    }
    // Each part is itself paginated (long parts split at sentence boundaries),
    // then the parts are joined by `$` so the message handler treats each
    // part as its own advanceable page.
    const combined = cleaned.map(p => paginate(p)).join("$");
    void globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.phaseManager.queueMessage(combined, null, true);
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

/**
 * Insert PokéRogue's `$` page-break separator into long text so MessagePhase
 * auto-paginates. The widget can fit ~120 chars per page; we split at
 * sentence boundaries within that budget. If a single sentence exceeds the
 * budget we fall back to a hard split at a word boundary (no mid-word cuts).
 *
 * Use this for ANY LLM-emitted text passed to queueMessage / showText so
 * the player can press Enter to read all of it instead of getting truncated.
 */
function paginate(text: string | undefined, perPage = 120): string {
  if (!text) {
    return "";
  }
  if (text.length <= perPage) {
    return text;
  }
  const pages: string[] = [];
  let remaining = text.trim();
  while (remaining.length > perPage) {
    const slice = remaining.slice(0, perPage);
    let cut = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    if (cut < perPage * 0.5) {
      // No sentence boundary — fall back to last word boundary
      cut = slice.lastIndexOf(" ");
      if (cut < perPage * 0.3) {
        cut = perPage; // last resort: hard cut
      }
    } else {
      cut += 1; // include the period
    }
    pages.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) {
    pages.push(remaining);
  }
  return pages.join("$");
}

/**
 * Hard cap for any LLM-emitted player-facing text. Cuts at the last sentence
 * boundary within `max` chars when one exists; otherwise hard-cuts and adds
 * an ellipsis. Used when content MUST fit one page (e.g., bible intro per
 * user spec). For most beat content, prefer `paginate()` instead.
 */
function truncate(text: string | undefined, max: number): string {
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  const head = text.slice(0, max);
  const lastSentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (lastSentence > max * 0.6) {
    return head.slice(0, lastSentence + 1);
  }
  return `${head.trimEnd()}…`;
}

/**
 * Grant items, money, and v2 effects from a Consequence.
 *
 * Legacy fields (`items`, `money`):
 *   - `items[]` go through PokéRogue's standard ModifierRewardPhase — same
 *     path vanilla item rewards use, so the player sees the standard "You
 *     received X!" message + item-fanfare sound and the item lands in
 *     inventory. Unknown modifierType keys are logged and skipped.
 *   - `money` is a wave-curve multiplier piped through MoneyRewardPhase.
 *
 * v2 `effects[]`:
 *   - Discriminated-union variants dispatched by `applyEffects`. Effects fire
 *     in source order. Many are end-to-end implementations; some are stubbed
 *     log + no-op for v1 — see `consequence-effects.ts`. The `custom`
 *     escape hatch surfaces the LLM's free-form description as a player
 *     message so even unimplemented effects are felt narratively.
 */
function grantConsequenceRewards(consequence: import("#data/llm-director/beat-schema").Consequence): string[] {
  const messages: string[] = [];
  if (consequence.items) {
    const factories = modifierTypes as Record<string, (() => ModifierType) | undefined>;
    for (const item of consequence.items) {
      const factory = factories[item.modifierType];
      if (typeof factory !== "function") {
        console.warn(`[llm-director] unknown modifierType in consequence.items: "${item.modifierType}"`);
        continue;
      }
      const resolved = resolveItemThunk(factory, item.modifierType);
      if (!resolved) {
        continue;
      }
      const qty = Math.max(1, item.qty ?? 1);
      for (let i = 0; i < qty; i++) {
        globalScene.phaseManager.unshiftNew("ModifierRewardPhase", resolved);
      }
    }
  }
  if (typeof consequence.money === "number" && consequence.money !== 0) {
    globalScene.phaseManager.unshiftNew("MoneyRewardPhase", consequence.money);
  }
  if (consequence.effects && consequence.effects.length > 0) {
    messages.push(...applyEffects(consequence.effects));
  }
  return messages;
}
