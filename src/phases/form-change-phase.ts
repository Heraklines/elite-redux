import type { Animation } from "#app/animations";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import type { PhaseManager } from "#app/phase-manager";
import type { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import {
  type CoopPresentationOutcome,
  type CoopPresentationOutcomeToken,
  settleCoopPresentationOutcome,
} from "#data/elite-redux/coop/coop-presentation-outcome";
import {
  type CoopRuntime,
  coopSessionGeneration,
  getCoopBattleStreamer,
  getCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { recordCoopEvent } from "#data/elite-redux/coop/coop-turn-recorder";
import { erRecordAchievementFormChange } from "#data/elite-redux/er-achievement-tracker";
import { erNoteShowdownPlayerMega } from "#data/elite-redux/er-social-achievement-tracker";
import { getSpeciesFormChangeMessage } from "#data/form-change-triggers";
import type { SpeciesFormChange } from "#data/pokemon-forms";
import { BattlerTagType } from "#enums/battler-tag-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { EvolutionPhase } from "#phases/evolution-phase";
import { achvs } from "#system/achv";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { fixedInt } from "#utils/common";
import {
  armCoopPresentationProgressWatchdog,
  type CoopPresentationProgressWatchdog,
} from "./coop-presentation-watchdog";

/**
 * Renderer-only inputs for the full evolution-style form-change cutscene.
 *
 * `pokemon` passed to the phase is a detached cosmetic preimage. Only `authorityPokemon` is the live
 * actor, and it receives no trigger/ability/stat/modifier work: the signed target appearance is installed
 * directly. This lets reconnect/recovery replay the old-to-new cutscene without rolling mechanics back.
 */
export interface CoopAuthoritativeFormChangeReplay {
  readonly authorityPokemon: PlayerPokemon;
  readonly preFormIndex: number;
  readonly targetFormIndex: number;
  readonly outcomeToken: CoopPresentationOutcomeToken;
  readonly actorFingerprint: string;
  readonly runtime: CoopFormChangeRuntimeBinding;
}

/** Immutable browser/runtime ownership captured before the replay crosses its first asynchronous boundary. */
export interface CoopFormChangeRuntimeBinding {
  readonly scene: typeof globalScene;
  readonly phaseManager: PhaseManager;
  readonly runtime: CoopRuntime | null;
  readonly streamer: CoopBattleStreamer | null;
  readonly generation: number;
}

export class FormChangePhase extends EvolutionPhase {
  public readonly phaseName: "FormChangePhase" | "CoopFormChangeCutsceneReplayPhase" = "FormChangePhase";
  private readonly formChange: SpeciesFormChange;
  private readonly modal: boolean;
  private readonly coopPreFormIndex: number;
  private readonly coopReplay: CoopAuthoritativeFormChangeReplay | null;
  private readonly runtimeBinding: CoopFormChangeRuntimeBinding;
  private ownerPhaseManager: PhaseManager;
  private coopPresentationRecorded = false;
  private coopReplayTerminal = false;
  private coopReplayClosing = false;
  private phaseEnded = false;
  private coopReplayWatchdog: CoopPresentationProgressWatchdog | undefined;
  private readonly scheduledCallbacks = new Set<() => void>();
  private readonly timerEvents = new Set<Phaser.Time.TimerEvent>();
  private readonly tweens = new Set<Phaser.Tweens.BaseTween>();
  private transformedPokemon: Pokemon | null = null;

  constructor(
    pokemon: PlayerPokemon,
    formChange: SpeciesFormChange,
    modal: boolean,
    coopReplay: CoopAuthoritativeFormChangeReplay | null = null,
  ) {
    super(pokemon, null, 0);

    this.formChange = formChange;
    this.modal = modal;
    this.coopPreFormIndex = pokemon.formIndex;
    this.coopReplay = coopReplay;
    this.runtimeBinding = coopReplay?.runtime ?? {
      scene: this.scene,
      phaseManager: this.scene.phaseManager,
      runtime: getCoopRuntime(),
      streamer: getCoopBattleStreamer(),
      generation: coopSessionGeneration(),
    };
    this.ownerPhaseManager = this.runtimeBinding.phaseManager;
  }

  /** Bind scheduler ownership at the same phase-factory seam used by the replay pump. */
  public bindOwnerPhaseManager(phaseManager: PhaseManager): this {
    this.ownerPhaseManager = phaseManager;
    return this;
  }

  private hasRuntimeBoundary(): boolean {
    return this.runtimeBinding.runtime != null || this.runtimeBinding.streamer != null;
  }

  private exactRuntimeInstalled(): boolean {
    return (
      globalScene === this.runtimeBinding.scene
      && getCoopRuntime() === this.runtimeBinding.runtime
      && getCoopBattleStreamer() === this.runtimeBinding.streamer
      && coopSessionGeneration() === this.runtimeBinding.generation
    );
  }

  private dispatchBound(callback: () => void): void {
    if (this.phaseEnded || this.isRetired() || (this.coopReplay != null && this.coopReplayTerminal)) {
      return;
    }
    if (!this.hasRuntimeBoundary() || this.exactRuntimeInstalled()) {
      callback();
      return;
    }
    const streamer = this.runtimeBinding.streamer;
    if (streamer == null || globalScene === this.runtimeBinding.scene) {
      this.retire();
      return;
    }
    let cancel = () => {};
    cancel = streamer.scheduleAuthorityRetry(() => {
      this.scheduledCallbacks.delete(cancel);
      if (this.phaseEnded || this.isRetired() || (this.coopReplay != null && this.coopReplayTerminal)) {
        return;
      }
      if (!this.exactRuntimeInstalled()) {
        this.retire();
        return;
      }
      callback();
    }, 0);
    this.scheduledCallbacks.add(cancel);
  }

  private schedule(delay: number, callback: () => void): Phaser.Time.TimerEvent {
    let timer!: Phaser.Time.TimerEvent;
    timer = this.scene.time.delayedCall(delay, () => {
      this.timerEvents.delete(timer);
      this.dispatchBound(callback);
    });
    this.timerEvents.add(timer);
    return timer;
  }

  private trackTween<T extends Phaser.Tweens.BaseTween>(tween: T): T {
    if (this.coopReplay != null || this.hasRuntimeBoundary()) {
      this.tweens.add(tween);
    }
    return tween;
  }

  private clearOwnedResources(): void {
    this.coopReplayWatchdog?.remove();
    this.coopReplayWatchdog = undefined;
    for (const cancel of this.scheduledCallbacks) {
      cancel();
    }
    this.scheduledCallbacks.clear();
    for (const timer of this.timerEvents) {
      timer.remove(false);
    }
    this.timerEvents.clear();
    for (const tween of this.tweens) {
      tween.stop();
    }
    this.tweens.clear();
  }

  private destroyPresentationPokemon(): void {
    this.transformedPokemon?.destroy();
    this.transformedPokemon = null;
    if (this.coopReplay != null) {
      this.pokemon.destroy();
    }
  }

  private advanceOwner(): void {
    if (this.phaseEnded || this.isRetired()) {
      return;
    }
    this.phaseEnded = true;
    this.clearOwnedResources();
    if (this.ownerPhaseManager.getCurrentPhase() === this) {
      this.ownerPhaseManager.shiftPhase();
    }
  }

  validate(): boolean {
    return !!this.formChange;
  }

  setMode(): Promise<void> {
    if (!this.modal) {
      return super.setMode();
    }
    return this.scene.ui.setOverlayMode(UiMode.EVOLUTION_SCENE);
  }

  public override async start(): Promise<void> {
    const replay = this.coopReplay;
    if (replay != null) {
      this.coopReplayWatchdog = armCoopPresentationProgressWatchdog(() => {
        this.finishCoopReplay({
          kind: "failed",
          reason: "form-change-cutscene-watchdog-expired",
          actorFingerprint: replay.actorFingerprint,
        });
      });
    }
    try {
      await super.start();
    } catch (error) {
      if (this.coopReplay != null) {
        this.dispatchBound(() =>
          this.finishCoopReplay({
            kind: "failed",
            reason: "form-change-cutscene-threw",
            actorFingerprint: this.coopReplay?.actorFingerprint ?? "form-change-replay",
          }),
        );
        return;
      }
      throw error;
    }
  }

  private finishCoopReplay(outcome: CoopPresentationOutcome): void {
    if (this.coopReplay == null || this.coopReplayTerminal || this.isRetired()) {
      return;
    }
    this.coopReplayTerminal = true;
    this.coopReplayClosing = false;
    this.clearOwnedResources();
    settleCoopPresentationOutcome(this.coopReplay.outcomeToken, outcome);
    this.destroyPresentationPokemon();
    this.advanceOwner();
  }

  /** Install only the signed appearance result; never re-run `Pokemon.changeForm()` mechanics. */
  private async installCoopReplayResult(): Promise<boolean> {
    const replay = this.coopReplay;
    if (replay == null) {
      await this.pokemon.changeForm(this.formChange);
      return true;
    }
    if (this.coopReplayTerminal || this.isRetired()) {
      return false;
    }
    const authorityPokemon = replay.authorityPokemon;
    authorityPokemon.formIndex = replay.targetFormIndex;
    authorityPokemon.generateName();
    authorityPokemon.setScale(authorityPokemon.getSpriteScale());
    await authorityPokemon.loadAssets(false);
    if (this.coopReplayTerminal || this.isRetired()) {
      return false;
    }
    authorityPokemon.playAnim();
    await Promise.all([authorityPokemon.updateInfo(), this.scene.updateFieldScale()]);
    if (this.coopReplayTerminal || this.isRetired()) {
      return false;
    }

    // The detached actor exists only to supply the cutscene's localized post-form name and cry.
    this.pokemon.formIndex = replay.targetFormIndex;
    this.pokemon.generateName();
    this.pokemon.setScale(this.pokemon.getSpriteScale());
    return true;
  }

  private recordAuthoritativePresentation(): void {
    if (this.coopReplay != null || this.coopPresentationRecorded) {
      return;
    }
    this.coopPresentationRecorded =
      recordCoopEvent({
        k: "formChange",
        bi: this.pokemon.getBattlerIndex(),
        actor: { side: "player", pokemonId: this.pokemon.id },
        speciesId: this.pokemon.species.speciesId,
        preFormIndex: this.coopPreFormIndex,
        formIndex: this.pokemon.formIndex,
        presentation: "evolution",
        animate: true,
      }) != null;
  }

  /**
   * Commence the tweens that play after the form change animation finishes
   * @param transformedPokemon - The Pokemon after the evolution
   * @param preName - The name of the Pokemon before the evolution
   */
  private formChangeUsesEvolutionFanfare(): boolean {
    if (this.formChange.formKey.indexOf(SpeciesFormKey.MEGA) > -1) {
      if (this.coopReplay == null) {
        this.scene.validateAchv(achvs.MEGA_EVOLVE);
        erRecordAchievementFormChange(this.pokemon, `${this.formChange.formKey}`);
        // #900 follow-up (Raw Talent): note a local player mega during an active Showdown match.
        erNoteShowdownPlayerMega(this.pokemon);
      }
      return true;
    }
    if (
      this.formChange.formKey.indexOf(SpeciesFormKey.GIGANTAMAX) > -1
      || this.formChange.formKey.indexOf(SpeciesFormKey.ETERNAMAX) > -1
    ) {
      if (this.coopReplay == null) {
        this.scene.validateAchv(achvs.GIGANTAMAX);
      }
      return true;
    }
    return false;
  }

  private finishPostFormChange(transformedPokemon: Pokemon, preName: string): void {
    const delay = this.formChangeUsesEvolutionFanfare() ? 4000 : 1750;
    this.scene.playSoundWithoutBgm(delay === 4000 ? "evolution_fanfare" : "minor_fanfare");
    transformedPokemon.destroy();
    if (this.transformedPokemon === transformedPokemon) {
      this.transformedPokemon = null;
    }
    this.scene.ui.showText(
      getSpeciesFormChangeMessage(this.pokemon, this.formChange, preName),
      null,
      () =>
        this.dispatchBound(() => {
          this.scene.playBgm();
          this.end();
        }),
      null,
      true,
      fixedInt(delay),
    );
  }

  private postFormChangeTweens(transformedPokemon: Pokemon, preName: string): void {
    this.trackTween(
      this.scene.tweens.chain({
        targets: null,
        tweens: [
          {
            targets: this.evolutionOverlay,
            alpha: 1,
            duration: 250,
            easing: "Sine.easeIn",
            onComplete: () =>
              this.dispatchBound(() => {
                this.evolutionBgOverlay.setAlpha(1);
                this.evolutionBg.setVisible(false);
              }),
          },
          {
            targets: [this.evolutionOverlay, this.pokemonEvoTintSprite],
            alpha: 0,
            duration: 2000,
            delay: 150,
            easing: "Sine.easeIn",
          },
          {
            targets: this.evolutionBgOverlay,
            alpha: 0,
            duration: 250,
            completeDelay: 250,
            onComplete: () => this.dispatchBound(() => this.pokemon.cry()),
          },
        ],
        // 1.25 seconds after the pokemon cry
        completeDelay: 1250,
        onComplete: () => this.dispatchBound(() => this.finishPostFormChange(transformedPokemon, preName)),
      }),
    );
  }

  /**
   * Commence the animations that occur once the form change evolution cycle is complete
   *
   * @privateRemarks
   * This would prefer {@linkcode Animation.doCycle | doCycle} to be refactored and de-promisified so this can be moved into {@linkcode beginTweens}
   * @param preName - The name of the Pokemon before the evolution
   * @param transformedPokemon - The Pokemon being transformed into
   */
  private afterCycle(preName: string, transformedPokemon: Pokemon): void {
    this.scene.playSound("se/sparkle");
    this.pokemonEvoSprite.setVisible(true);
    this.scene.animations.doCircleInward(this.evolutionBaseBg, this.evolutionContainer);
    this.schedule(900, () => {
      if (this.coopReplayTerminal) {
        transformedPokemon.destroy();
        if (this.transformedPokemon === transformedPokemon) {
          this.transformedPokemon = null;
        }
        return;
      }
      const finishMaterialApply = (applied: boolean) => {
        if (this.coopReplayTerminal) {
          transformedPokemon.destroy();
          if (this.transformedPokemon === transformedPokemon) {
            this.transformedPokemon = null;
          }
          return;
        }
        if (!applied) {
          return;
        }
        this.recordAuthoritativePresentation();
        if (!this.modal) {
          this.ownerPhaseManager.unshiftNew("EndEvolutionPhase");
        }
        this.scene.playSound("se/shine");
        this.scene.animations.doSpray(this.evolutionBaseBg, this.evolutionContainer);
        this.postFormChangeTweens(transformedPokemon, preName);
      };
      const apply = this.installCoopReplayResult();
      if (this.coopReplay == null) {
        // Preserve the ordinary host phase's existing rejection semantics; the replay-only catch below
        // must not turn an unrelated failed mechanical form change into a silently swallowed hang.
        apply.then(applied => this.dispatchBound(() => finishMaterialApply(applied)));
        return;
      }
      apply
        .then(applied => this.dispatchBound(() => finishMaterialApply(applied)))
        .catch(() =>
          this.dispatchBound(() => {
            transformedPokemon.destroy();
            if (this.transformedPokemon === transformedPokemon) {
              this.transformedPokemon = null;
            }
            this.finishCoopReplay({
              kind: "failed",
              reason: "form-change-material-apply-threw",
              actorFingerprint: this.coopReplay?.actorFingerprint ?? "form-change-replay",
            });
          }),
        );
    });
  }

  /**
   * Commence the sequence of tweens and events that occur during the evolution animation
   * @param preName The name of the Pokemon before the evolution
   * @param transformedPokemon The Pokemon after the evolution
   */
  private beginTweens(preName: string, transformedPokemon: Pokemon): void {
    this.trackTween(
      this.scene.tweens.chain({
        // Starts 250ms after sprites have been configured
        targets: null,
        tweens: [
          // Step 1: Fade in the background overlay
          {
            delay: 250,
            targets: this.evolutionBgOverlay,
            alpha: 1,
            duration: 1500,
            ease: "Sine.easeOut",
            // We want the backkground overlay to fade out after it fades in
            onComplete: () =>
              this.dispatchBound(() => {
                this.trackTween(
                  this.scene.tweens.add({
                    targets: this.evolutionBgOverlay,
                    alpha: 0,
                    duration: 250,
                    delay: 1000,
                  }),
                );
                this.evolutionBg.setVisible(true).play();
              }),
          },
          // Step 2: Play the sounds and fade in the tint sprite
          {
            targets: this.pokemonTintSprite,
            alpha: { from: 0, to: 1 },
            duration: 2000,
            onStart: () =>
              this.dispatchBound(() => {
                this.scene.playSound("se/charge");
                this.scene.animations.doSpiralUpward(this.evolutionBaseBg, this.evolutionContainer);
              }),
            onComplete: () => this.dispatchBound(() => this.pokemonSprite.setVisible(false)),
          },
        ],

        // Step 3: Commence the form change animation via doCycle then continue the animation chain with afterCycle
        completeDelay: 1100,
        onComplete: () =>
          this.dispatchBound(() => {
            this.scene.playSound("se/beam");
            this.scene.animations.doArcDownward(this.evolutionBaseBg, this.evolutionContainer);
            this.schedule(1000, () => {
              this.pokemonEvoTintSprite.setScale(0.25).setVisible(true);
              this.scene.animations
                .doCycle(1, 1, this.pokemonTintSprite, this.pokemonEvoSprite)
                .then(() => this.dispatchBound(() => this.afterCycle(preName, transformedPokemon)));
            });
          }),
      }),
    );
  }

  doEvolution(): void {
    const preName = getPokemonNameWithAffix(this.pokemon, false);

    this.pokemon
      .getPossibleForm(this.formChange)
      .then(transformedPokemon =>
        this.dispatchBound(() => {
          this.transformedPokemon = transformedPokemon;
          this.configureSprite(transformedPokemon, this.pokemonEvoSprite, false);
          this.configureSprite(transformedPokemon, this.pokemonEvoTintSprite, false);
          this.beginTweens(preName, transformedPokemon);
        }),
      )
      .catch(() => {
        if (this.coopReplay != null) {
          this.dispatchBound(() =>
            this.finishCoopReplay({
              kind: "failed",
              reason: "form-change-preimage-material-failed",
              actorFingerprint: this.coopReplay?.actorFingerprint ?? "form-change-replay",
            }),
          );
        }
      });
  }

  public override retire(): void {
    if (this.isRetired()) {
      return;
    }
    super.retire();
    this.phaseEnded = true;
    this.coopReplayClosing = false;
    this.clearOwnedResources();
    if (this.coopReplay != null && !this.coopReplayTerminal) {
      this.coopReplayTerminal = true;
      settleCoopPresentationOutcome(this.coopReplay.outcomeToken, {
        kind: "failed",
        reason: "form-change-cutscene-retired",
        actorFingerprint: this.coopReplay.actorFingerprint,
      });
      this.destroyPresentationPokemon();
    }
  }

  public override end(): void {
    if (this.coopReplay != null) {
      if (this.coopReplayTerminal || this.coopReplayClosing || this.isRetired()) {
        return;
      }
      this.coopReplayClosing = true;
      const replay = this.coopReplay;
      let close: Promise<unknown>;
      try {
        close = this.scene.ui.revertMode();
      } catch {
        this.finishCoopReplay({
          kind: "failed",
          reason: "form-change-cutscene-close-threw",
          actorFingerprint: replay.actorFingerprint,
        });
        return;
      }
      // Keep the presentation watchdog armed until the real UI close resolves. If this promise hangs, the
      // exact-runtime wall fails the token and advances to the finalizer/shared terminal; it never strands it.
      close
        .then(() => {
          this.dispatchBound(() =>
            this.finishCoopReplay({
              kind: "rendered",
              actorFingerprint: replay.actorFingerprint,
            }),
          );
        })
        .catch(() => {
          this.dispatchBound(() =>
            this.finishCoopReplay({
              kind: "failed",
              reason: "form-change-cutscene-close-threw",
              actorFingerprint: replay.actorFingerprint,
            }),
          );
        });
      return;
    }
    this.pokemon.findAndRemoveTags(t => t.tagType === BattlerTagType.AUTOTOMIZED);
    if (this.modal) {
      this.scene.ui.revertMode().then(() =>
        this.dispatchBound(() => {
          if (this.scene.ui.getMode() === UiMode.PARTY) {
            const partyUiHandler = this.scene.ui.getHandler() as PartyUiHandler;
            partyUiHandler.clearPartySlots();
            partyUiHandler.populatePartySlots();
          }

          this.advanceOwner();
        }),
      );
    } else {
      this.advanceOwner();
    }
  }
}

/** Dedicated renderer identity for the mechanics-free rich cutscene path. */
export class CoopFormChangeCutsceneReplayPhase extends FormChangePhase {
  public override readonly phaseName = "CoopFormChangeCutsceneReplayPhase";

  constructor(
    presentationPokemon: PlayerPokemon,
    formChange: SpeciesFormChange,
    replay: CoopAuthoritativeFormChangeReplay,
  ) {
    super(presentationPokemon, formChange, true, replay);
  }
}
