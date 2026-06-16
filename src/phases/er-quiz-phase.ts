/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Quiz/Minigame orchestrator (#439 biome overhaul).
//
// Runs a whole quiz session over the compact ErQuizUiHandler: asks each question
// in turn, scores it, shows a one-line verdict, and either continues or stops
// (optionally on the first wrong answer, for the press-your-luck booth). When the
// session ends it reports the tally through onComplete and ends the phase.
//
// All UiMode swaps happen INSIDE this phase (never from an awaited encounter
// callback), which is the pattern that avoids the #439 fade-race softlock.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { ErQuizQuestion } from "#data/elite-redux/er-quiz";
import { erQuizOptionName, getErFootprintAsset } from "#data/elite-redux/er-quiz";
import { UiMode } from "#enums/ui-mode";
import type { ErQuizView } from "#ui/er-quiz-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";

export interface ErQuizResult {
  /** Questions answered correctly. */
  correct: number;
  /** Questions presented before the session ended. */
  answered: number;
  /** Total questions in the session. */
  total: number;
  /** True if every presented question was answered correctly. */
  perfect: boolean;
  /** True if the player forfeited (cancelled) instead of answering. */
  forfeited: boolean;
}

export interface ErQuizSessionConfig {
  /** The questions to ask, in order. */
  questions: ErQuizQuestion[];
  /** Stop the session at the first wrong answer (press-your-luck). */
  stopOnWrong?: boolean;
  /** Called once when the session ends. */
  onComplete: (result: ErQuizResult) => void;
}

export class ErQuizPhase extends Phase {
  public readonly phaseName = "ErQuizPhase";

  private readonly questions: ErQuizQuestion[];
  private readonly stopOnWrong: boolean;
  private readonly onComplete: (result: ErQuizResult) => void;

  private index = 0;
  private correct = 0;
  private answered = 0;
  private forfeited = false;

  constructor(config: ErQuizSessionConfig) {
    super();
    this.questions = config.questions;
    this.stopOnWrong = config.stopOnWrong ?? false;
    this.onComplete = config.onComplete;
  }

  start(): void {
    super.start();
    void this.run();
  }

  /**
   * Preload every sprite-based question's assets, THEN run the round. Queue all
   * of them first and start the shared loader ONCE, awaiting its COMPLETE (the
   * proven encounter-phase / trainer-config pattern). A per-question
   * loadAssets(startLoad) would start the loader mid-queue and race, dropping
   * later assets - so figures rendered blank.
   *
   * silhouette -> the full battle-sprite atlas. footprint -> the footprint PNG
   * AND (as a fallback) the silhouette atlas, since not every species ships
   * footprint art - the UI shows the footprint when present, else a silhouette.
   */
  private async run(): Promise<void> {
    let queuedAnything = false;
    const queueSilhouette = (speciesId: number): void => {
      const species = getPokemonSpecies(speciesId);
      const key = species.getSpriteKey(false);
      if (!globalScene.textures.exists(key)) {
        globalScene.loadPokemonAtlas(key, species.getSpriteAtlasPath(false));
        queuedAnything = true;
      }
    };

    for (const q of this.questions) {
      if (q.kind === "silhouette") {
        queueSilhouette(q.answerId);
      } else if (q.kind === "footprint") {
        const fp = getErFootprintAsset(q.answerId);
        if (fp && !globalScene.textures.exists(fp.key)) {
          // A missing footprint file 404s harmlessly; ask() falls back to the
          // silhouette we also queue below.
          globalScene.load.image(fp.key, fp.url);
          queuedAnything = true;
        }
        queueSilhouette(q.answerId);
      }
    }

    if (queuedAnything) {
      await new Promise<void>(resolve => {
        globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
        if (!globalScene.load.isLoading()) {
          globalScene.load.start();
        }
      });
    }
    void this.ask();
  }

  /** Present the current question (its figure assets are already loaded). */
  private async ask(): Promise<void> {
    if (this.index >= this.questions.length) {
      this.finish();
      return;
    }
    const q = this.questions[this.index];

    // figure assets: footprint image (preferred for footprint questions),
    // else the full battle sprite as a black silhouette, else the always-present
    // menu icon - so the figure is never blank.
    let footprintKey: string | undefined;
    let spriteKey: string | undefined;
    let iconAtlas: string | undefined;
    let iconFrame: string | undefined;

    if (q.kind === "footprint") {
      const fp = getErFootprintAsset(q.answerId);
      if (fp && globalScene.textures.exists(fp.key)) {
        footprintKey = fp.key;
      }
    }
    if (!footprintKey && (q.kind === "silhouette" || q.kind === "footprint")) {
      const species = getPokemonSpecies(q.answerId);
      const key = species.getSpriteKey(false);
      if (globalScene.textures.exists(key)) {
        spriteKey = key;
      } else {
        const atlas = species.getIconAtlasKey();
        if (globalScene.textures.exists(atlas)) {
          iconAtlas = atlas;
          iconFrame = species.getIconId(false);
        }
      }
    }

    const header =
      q.kind === "footprint"
        ? `Whose tracks are these?  (${this.index + 1}/${this.questions.length})`
        : q.kind === "silhouette"
          ? `Who's that Pokémon?  (${this.index + 1}/${this.questions.length})`
          : `Whose entry is this?  (${this.index + 1}/${this.questions.length})`;

    const view: ErQuizView = {
      header,
      footprintKey,
      spriteKey,
      iconAtlas,
      iconFrame,
      prompt: q.kind === "dex" ? q.prompt : undefined,
      options: q.options.map(erQuizOptionName),
    };

    globalScene.ui.setMode(UiMode.ER_QUIZ, view, (choice: number) => void this.onAnswer(choice));
  }

  private async onAnswer(choice: number): Promise<void> {
    // Hand the UI back to MESSAGE before showing the verdict text.
    await globalScene.ui.setMode(UiMode.MESSAGE);

    const q = this.questions[this.index];
    const answerName = erQuizOptionName(q.answerId);

    if (choice < 0) {
      this.forfeited = true;
      this.finish();
      return;
    }

    this.answered++;
    const correctIndex = q.options.indexOf(q.answerId);
    const isCorrect = choice === correctIndex;
    if (isCorrect) {
      this.correct++;
    }

    const msg = isCorrect ? `Correct! It's ${answerName}!` : `Wrong... it was ${answerName}.`;
    globalScene.ui.showText(msg, null, () => this.afterVerdict(isCorrect), null, true);
  }

  private afterVerdict(isCorrect: boolean): void {
    if (!isCorrect && this.stopOnWrong) {
      this.finish();
      return;
    }
    this.index++;
    void this.ask();
  }

  private finish(): void {
    const result: ErQuizResult = {
      correct: this.correct,
      answered: this.answered,
      total: this.questions.length,
      perfect: this.answered > 0 && this.correct === this.answered && !this.forfeited,
      forfeited: this.forfeited,
    };
    this.onComplete(result);
    this.end();
  }
}
