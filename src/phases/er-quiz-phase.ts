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
import { coopMeInProgress, coopMeInteractionStartValue } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  coopQuizAwaitRemoteAnswer,
  coopQuizHostStreamSession,
  coopQuizPublishAnswer,
} from "#data/elite-redux/coop/coop-quiz-mirror";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopController,
  getCoopRuntime,
  notifyCoopV2InteractionSurfaceReady,
} from "#data/elite-redux/coop/coop-runtime";
import { erRecordQuizPerfect } from "#data/elite-redux/er-achievement-detection";
import type { ErQuizQuestion } from "#data/elite-redux/er-quiz";
import { erQuizOptionName, getErFootprintAsset } from "#data/elite-redux/er-quiz";
import { SpeciesId } from "#enums/species-id";
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
  /** "item" rounds only: modifierTypes keys of the items correctly identified
   * (in ask order). Lets an encounter grant the exact parts the player named. */
  correctItemIds: string[];
}

export interface ErQuizSessionConfig {
  /** The questions to ask, in order. */
  questions: ErQuizQuestion[];
  /** Stop the session at the first wrong answer (press-your-luck). */
  stopOnWrong?: boolean;
  /** Called once when the session ends. */
  onComplete: (result: ErQuizResult) => void;
  /** Exact Authority V2 ME_PRESENT address inherited by a watcher-side mirror quiz. */
  coopV2ControlOperationId?: string | null;
}

export class ErQuizPhase extends Phase {
  public readonly phaseName = "ErQuizPhase";
  /** Exact immutable ME_PRESENT address that authorized this quiz generation. */
  public coopV2ControlOperationId: string | null;

  private readonly questions: ErQuizQuestion[];
  private readonly stopOnWrong: boolean;
  private readonly onComplete: (result: ErQuizResult) => void;

  private index = 0;
  private correct = 0;
  private answered = 0;
  private forfeited = false;
  /** modifierTypes keys of the "item"-kind questions answered correctly. */
  private readonly correctItemIds: string[] = [];
  /** #818 co-op quiz mirroring: question indices whose remote (owner-relayed) answer has already
   *  been applied, so a stale / late remote resolution can never answer a LATER question. */
  private readonly resolvedRemote = new Set<number>();
  private coopBoundary:
    | {
        scene: typeof globalScene;
        runtime: ReturnType<typeof getCoopRuntime>;
        controller: ReturnType<typeof getCoopController>;
        generation: number;
        pinned: number;
      }
    | undefined;

  private boundaryStillLive(): boolean {
    const boundary = this.coopBoundary;
    return (
      boundary == null
      || (globalScene === boundary.scene
        && getCoopRuntime() === boundary.runtime
        && getCoopController() === boundary.controller
        && coopSessionGeneration() === boundary.generation
        && coopMeInteractionStartValue() === boundary.pinned
        && globalScene.phaseManager.getCurrentPhase() === this)
    );
  }

  constructor(config: ErQuizSessionConfig) {
    super();
    this.questions = config.questions;
    this.stopOnWrong = config.stopOnWrong ?? false;
    this.onComplete = config.onComplete;
    this.coopV2ControlOperationId = config.coopV2ControlOperationId ?? null;
  }

  start(): void {
    super.start();
    if (globalScene.gameMode.isCoop && coopMeInProgress()) {
      this.coopBoundary = {
        scene: globalScene,
        runtime: getCoopRuntime(),
        controller: getCoopController(),
        generation: coopSessionGeneration(),
        pinned: coopMeInteractionStartValue(),
      };
    }
    // #818 co-op quiz mirroring: the HOST (sole engine) streams the whole question session so BOTH
    // clients render the SAME quiz off it. The function gates itself on host role + a live mirrored ME,
    // so this is a no-op in solo play and safe to call unconditionally.
    const streamedOperationId = coopQuizHostStreamSession(this.questions, this.stopOnWrong);
    if (
      streamedOperationId != null
      && this.coopV2ControlOperationId != null
      && this.coopV2ControlOperationId !== streamedOperationId
    ) {
      failCoopSharedSession("Quiz phase received two different Authority V2 presentation addresses");
      return;
    }
    if (streamedOperationId != null) {
      this.coopV2ControlOperationId = streamedOperationId;
    }
    void this.run();
  }

  /** Republish only after the exact ER_QUIZ handler is active for this phase generation. */
  private notifyCoopV2SurfaceReady(): void {
    if (this.boundaryStillLive() && this.coopV2ControlOperationId != null) {
      notifyCoopV2InteractionSurfaceReady(this.coopBoundary?.runtime ?? getCoopRuntime());
    }
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
    // A prior phase / the encounter intro transition may still be loading; adding
    // files to an in-flight loader can drop them (the COMPLETE we await fires for
    // the OTHER batch). Wait for the loader to be idle, THEN queue our own batch
    // and start it once - the pattern that reliably lands every asset.
    if (globalScene.load.isLoading()) {
      await new Promise<void>(resolve => globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve()));
      if (!this.boundaryStillLive()) {
        return;
      }
    }

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
          globalScene.load.image(fp.key, fp.url);
          queuedAnything = true;
        }
        // Always queue the silhouette too: it is the fallback when a species
        // ships no footprint art (a missing file 404s harmlessly).
        queueSilhouette(q.answerId);
      }
    }

    if (queuedAnything) {
      // Surface any failed file (e.g. a missing footprint) into a Send-Logs
      // capture so we can see exactly which URL didn't load.
      const onErr = (file: { key?: string; src?: string }): void => {
        console.warn(`[er-quiz] asset load failed: key=${file?.key} src=${file?.src}`);
      };
      globalScene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onErr);
      await new Promise<void>(resolve => {
        globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
        if (!globalScene.load.isLoading()) {
          globalScene.load.start();
        }
      });
      globalScene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onErr);
      if (!this.boundaryStillLive()) {
        return;
      }
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

    // CIPHER (Unown): render the answer in Unown letter icons and offer the word
    // choices. Unown forms A-Z = formIndex 0-25; the menu-icon atlas is boot-loaded,
    // so no extra asset load is needed. The word is split on spaces into per-word
    // ROWS so a multi-word phrase (the longer final puzzle) wraps neatly.
    if (q.kind === "cipher") {
      const word = q.cipherWord ?? "";
      const unown = getPokemonSpecies(SpeciesId.UNOWN);
      const glyphRows = word
        .split(" ")
        .map(part => {
          const row: { atlas: string; frame: string }[] = [];
          for (const ch of part) {
            const formIndex = ch.charCodeAt(0) - 65; // 'A' -> 0 ... 'Z' -> 25
            if (formIndex < 0 || formIndex > 25) {
              continue;
            }
            row.push({ atlas: unown.getIconAtlasKey(formIndex), frame: unown.getIconId(false, formIndex) });
          }
          return row;
        })
        .filter(row => row.length > 0);
      const cipherView: ErQuizView = {
        header: `What do the glyphs spell?  (${this.index + 1}/${this.questions.length})`,
        glyphRows,
        options: q.cipherOptions ?? [],
      };
      const opened = await globalScene.ui.setModeBoundedWhen(
        UiMode.ER_QUIZ,
        2_000,
        () => this.boundaryStillLive(),
        cipherView,
        (choice: number) => (this.boundaryStillLive() ? void this.onAnswer(choice) : undefined),
      );
      if (opened === "superseded") {
        return;
      }
      this.notifyCoopV2SurfaceReady();
      this.armRemoteAnswer();
      return;
    }

    // BRAILLE (Dormant Guardian seal): render the answer word as raised Braille
    // dot-cells in the text prompt (no sprites), with the A-Z Braille KEY shown
    // beside it so the player can decode, and offer the word choices.
    if (q.kind === "braille") {
      const brailleView: ErQuizView = {
        header: `Read the raised glyphs.  (${this.index + 1}/${this.questions.length})`,
        prompt: q.prompt,
        largePrompt: true,
        showBrailleLegend: true,
        options: q.cipherOptions ?? [],
      };
      const opened = await globalScene.ui.setModeBoundedWhen(
        UiMode.ER_QUIZ,
        2_000,
        () => this.boundaryStillLive(),
        brailleView,
        (choice: number) => (this.boundaryStillLive() ? void this.onAnswer(choice) : undefined),
      );
      if (opened === "superseded") {
        return;
      }
      this.notifyCoopV2SurfaceReady();
      this.armRemoteAnswer();
      return;
    }

    // ITEM (Salvage Yard): render the held item's icon as a black silhouette
    // (the boot-loaded "items" atlas is always present, so no asset load) and
    // offer the item-name choices.
    if (q.kind === "item") {
      const itemView: ErQuizView = {
        header: `What part is this?  (${this.index + 1}/${this.questions.length})`,
        iconAtlas: "items",
        iconFrame: q.itemIconFrame,
        options: q.itemOptions ?? [],
      };
      const opened = await globalScene.ui.setModeBoundedWhen(
        UiMode.ER_QUIZ,
        2_000,
        () => this.boundaryStillLive(),
        itemView,
        (choice: number) => (this.boundaryStillLive() ? void this.onAnswer(choice) : undefined),
      );
      if (opened === "superseded") {
        return;
      }
      this.notifyCoopV2SurfaceReady();
      this.armRemoteAnswer();
      return;
    }

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

    const opened = await globalScene.ui.setModeBoundedWhen(
      UiMode.ER_QUIZ,
      2_000,
      () => this.boundaryStillLive(),
      view,
      (choice: number) => (this.boundaryStillLive() ? void this.onAnswer(choice) : undefined),
    );
    if (opened === "superseded") {
      return;
    }
    this.notifyCoopV2SurfaceReady();
    this.armRemoteAnswer();
  }

  /**
   * #818 co-op quiz mirroring (FOLLOW side): if the PARTNER owns this ME, arm a one-shot wait for
   * their relayed answer to the CURRENT question and feed it into our own onAnswer, so the follower
   * lands the identical result without taking local input. A no-op on the drive / solo side
   * (coopQuizAwaitRemoteAnswer returns null). The `forIndex` capture + the `resolvedRemote` guard are
   * MANDATORY: the wait can resolve LATE (after the human on the drive side finally answers), by which
   * point `this.index` may already point at a later question - applying it there would answer the wrong
   * one. So we apply only when the index has not advanced AND this index was not already answered
   * remotely (a duplicate resolution is dropped).
   */
  private armRemoteAnswer(): void {
    const remote = coopQuizAwaitRemoteAnswer(this.index);
    if (remote) {
      const forIndex = this.index;
      void remote.then(c => {
        if (this.boundaryStillLive() && this.index === forIndex && !this.resolvedRemote.has(forIndex)) {
          this.resolvedRemote.add(forIndex);
          void this.onAnswer(c);
        }
      });
    }
  }

  private async onAnswer(choice: number): Promise<void> {
    if (!this.boundaryStillLive()) {
      return;
    }
    const answeringIndex = this.index;
    // #818 co-op quiz mirroring (DRIVE side): relay this answer to the follower BEFORE we consume it,
    // so both clients apply the identical choice. Gates itself on the drive side (a no-op otherwise).
    coopQuizPublishAnswer(this.index, choice);
    // Hand the UI back to MESSAGE before showing the verdict text.
    const opened = await globalScene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, () => this.boundaryStillLive());
    if (opened === "superseded" || !this.boundaryStillLive() || this.index !== answeringIndex) {
      return;
    }

    const q = this.questions[this.index];
    const isCipher = q.kind === "cipher" || q.kind === "braille";
    const isItem = q.kind === "item";
    const answerName = isItem ? (q.itemName ?? "") : isCipher ? (q.cipherWord ?? "") : erQuizOptionName(q.answerId);

    if (choice < 0) {
      this.forfeited = true;
      this.finish();
      return;
    }

    this.answered++;
    const correctIndex = isItem
      ? (q.itemOptions ?? []).indexOf(q.itemName ?? "")
      : isCipher
        ? (q.cipherOptions ?? []).indexOf(q.cipherWord ?? "")
        : q.options.indexOf(q.answerId);
    const isCorrect = choice === correctIndex;
    if (isCorrect) {
      this.correct++;
      if (isItem && q.itemId) {
        this.correctItemIds.push(q.itemId);
      }
    }

    const msg = isCorrect ? `Correct! It's ${answerName}!` : `Wrong... it was ${answerName}.`;
    globalScene.ui.showText(
      msg,
      null,
      () => {
        if (this.boundaryStillLive() && this.index === answeringIndex) {
          this.afterVerdict(isCorrect);
        }
      },
      null,
      true,
    );
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
    if (!this.boundaryStillLive()) {
      return;
    }
    const result: ErQuizResult = {
      correct: this.correct,
      answered: this.answered,
      total: this.questions.length,
      perfect: this.answered > 0 && this.correct === this.answered && !this.forfeited,
      forfeited: this.forfeited,
      correctItemIds: this.correctItemIds,
    };
    // catalog-v2 (#900) FINAL_ANSWER: a perfect quiz run (every question correct).
    if (result.perfect) {
      erRecordQuizPerfect();
    }
    this.onComplete(result);
    this.end();
  }
}
