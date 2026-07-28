import type { Animation } from "#app/animations";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import {
  type CoopPresentationOutcome,
  type CoopPresentationOutcomeToken,
  settleCoopPresentationOutcome,
} from "#data/elite-redux/coop/coop-presentation-outcome";
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
}

export class FormChangePhase extends EvolutionPhase {
  public readonly phaseName: "FormChangePhase" | "CoopFormChangeCutsceneReplayPhase" = "FormChangePhase";
  private readonly formChange: SpeciesFormChange;
  private readonly modal: boolean;
  private readonly coopPreFormIndex: number;
  private readonly coopReplay: CoopAuthoritativeFormChangeReplay | null;
  private coopPresentationRecorded = false;
  private coopReplayTerminal = false;
  private coopReplayWatchdog: CoopPresentationProgressWatchdog | undefined;

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
  }

  validate(): boolean {
    return !!this.formChange;
  }

  setMode(): Promise<void> {
    if (!this.modal) {
      return super.setMode();
    }
    return globalScene.ui.setOverlayMode(UiMode.EVOLUTION_SCENE);
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
        this.finishCoopReplay({
          kind: "failed",
          reason: "form-change-cutscene-threw",
          actorFingerprint: this.coopReplay.actorFingerprint,
        });
        return;
      }
      throw error;
    }
  }

  private finishCoopReplay(outcome: CoopPresentationOutcome): void {
    if (this.coopReplay == null || this.coopReplayTerminal) {
      return;
    }
    this.coopReplayTerminal = true;
    this.coopReplayWatchdog?.remove();
    settleCoopPresentationOutcome(this.coopReplay.outcomeToken, outcome);
    this.pokemon.destroy();
    void globalScene.ui.revertMode().finally(() => super.end());
  }

  /** Install only the signed appearance result; never re-run `Pokemon.changeForm()` mechanics. */
  private async installCoopReplayResult(): Promise<void> {
    const replay = this.coopReplay;
    if (replay == null) {
      await this.pokemon.changeForm(this.formChange);
      return;
    }
    const authorityPokemon = replay.authorityPokemon;
    authorityPokemon.formIndex = replay.targetFormIndex;
    authorityPokemon.generateName();
    authorityPokemon.setScale(authorityPokemon.getSpriteScale());
    await authorityPokemon.loadAssets(false);
    authorityPokemon.playAnim();
    await Promise.all([authorityPokemon.updateInfo(), globalScene.updateFieldScale()]);

    // The detached actor exists only to supply the cutscene's localized post-form name and cry.
    this.pokemon.formIndex = replay.targetFormIndex;
    this.pokemon.generateName();
    this.pokemon.setScale(this.pokemon.getSpriteScale());
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
  private postFormChangeTweens(transformedPokemon: Pokemon, preName: string): void {
    globalScene.tweens.chain({
      targets: null,
      tweens: [
        {
          targets: this.evolutionOverlay,
          alpha: 1,
          duration: 250,
          easing: "Sine.easeIn",
          onComplete: () => {
            this.evolutionBgOverlay.setAlpha(1);
            this.evolutionBg.setVisible(false);
          },
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
          onComplete: () => this.pokemon.cry(),
        },
      ],
      // 1.25 seconds after the pokemon cry
      completeDelay: 1250,
      onComplete: () => {
        let playEvolutionFanfare = false;
        if (this.formChange.formKey.indexOf(SpeciesFormKey.MEGA) > -1) {
          if (this.coopReplay == null) {
            globalScene.validateAchv(achvs.MEGA_EVOLVE);
            erRecordAchievementFormChange(this.pokemon, `${this.formChange.formKey}`);
            // #900 follow-up (Raw Talent): note a local player mega during an active Showdown match.
            erNoteShowdownPlayerMega(this.pokemon);
          }
          playEvolutionFanfare = true;
        } else if (
          this.formChange.formKey.indexOf(SpeciesFormKey.GIGANTAMAX) > -1
          || this.formChange.formKey.indexOf(SpeciesFormKey.ETERNAMAX) > -1
        ) {
          if (this.coopReplay == null) {
            globalScene.validateAchv(achvs.GIGANTAMAX);
          }
          playEvolutionFanfare = true;
        }

        const delay = playEvolutionFanfare ? 4000 : 1750;
        globalScene.playSoundWithoutBgm(playEvolutionFanfare ? "evolution_fanfare" : "minor_fanfare");
        transformedPokemon.destroy();
        globalScene.ui.showText(
          getSpeciesFormChangeMessage(this.pokemon, this.formChange, preName),
          null,
          () => this.end(),
          null,
          true,
          fixedInt(delay),
        );
        globalScene.time.delayedCall(fixedInt(delay + 250), () => globalScene.playBgm());
      },
    });
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
    globalScene.playSound("se/sparkle");
    this.pokemonEvoSprite.setVisible(true);
    globalScene.animations.doCircleInward(this.evolutionBaseBg, this.evolutionContainer);
    globalScene.time.delayedCall(900, () => {
      if (this.coopReplayTerminal) {
        transformedPokemon.destroy();
        return;
      }
      const finishMaterialApply = () => {
        if (this.coopReplayTerminal) {
          transformedPokemon.destroy();
          return;
        }
        this.recordAuthoritativePresentation();
        if (!this.modal) {
          globalScene.phaseManager.unshiftNew("EndEvolutionPhase");
        }
        globalScene.playSound("se/shine");
        globalScene.animations.doSpray(this.evolutionBaseBg, this.evolutionContainer);
        this.postFormChangeTweens(transformedPokemon, preName);
      };
      const apply = this.installCoopReplayResult();
      if (this.coopReplay == null) {
        // Preserve the ordinary host phase's existing rejection semantics; the replay-only catch below
        // must not turn an unrelated failed mechanical form change into a silently swallowed hang.
        apply.then(finishMaterialApply);
        return;
      }
      apply.then(finishMaterialApply).catch(() => {
        transformedPokemon.destroy();
        this.finishCoopReplay({
          kind: "failed",
          reason: "form-change-material-apply-threw",
          actorFingerprint: this.coopReplay?.actorFingerprint ?? "form-change-replay",
        });
      });
    });
  }

  /**
   * Commence the sequence of tweens and events that occur during the evolution animation
   * @param preName The name of the Pokemon before the evolution
   * @param transformedPokemon The Pokemon after the evolution
   */
  private beginTweens(preName: string, transformedPokemon: Pokemon): void {
    globalScene.tweens.chain({
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
          onComplete: () => {
            globalScene.tweens.add({
              targets: this.evolutionBgOverlay,
              alpha: 0,
              duration: 250,
              delay: 1000,
            });
            this.evolutionBg.setVisible(true).play();
          },
        },
        // Step 2: Play the sounds and fade in the tint sprite
        {
          targets: this.pokemonTintSprite,
          alpha: { from: 0, to: 1 },
          duration: 2000,
          onStart: () => {
            globalScene.playSound("se/charge");
            globalScene.animations.doSpiralUpward(this.evolutionBaseBg, this.evolutionContainer);
          },
          onComplete: () => {
            this.pokemonSprite.setVisible(false);
          },
        },
      ],

      // Step 3: Commence the form change animation via doCycle then continue the animation chain with afterCycle
      completeDelay: 1100,
      onComplete: () => {
        globalScene.playSound("se/beam");
        globalScene.animations.doArcDownward(this.evolutionBaseBg, this.evolutionContainer);
        globalScene.time.delayedCall(1000, () => {
          this.pokemonEvoTintSprite.setScale(0.25).setVisible(true);
          globalScene.animations
            .doCycle(1, 1, this.pokemonTintSprite, this.pokemonEvoSprite)
            .then(() => this.afterCycle(preName, transformedPokemon));
        });
      },
    });
  }

  doEvolution(): void {
    const preName = getPokemonNameWithAffix(this.pokemon, false);

    this.pokemon.getPossibleForm(this.formChange).then(transformedPokemon => {
      this.configureSprite(transformedPokemon, this.pokemonEvoSprite, false);
      this.configureSprite(transformedPokemon, this.pokemonEvoTintSprite, false);
      this.beginTweens(preName, transformedPokemon);
    });
  }

  end(): void {
    if (this.coopReplay != null) {
      if (this.coopReplayTerminal) {
        return;
      }
      this.coopReplayWatchdog?.remove();
      const replay = this.coopReplay;
      void globalScene.ui
        .revertMode()
        .then(() => {
          if (this.coopReplayTerminal) {
            return;
          }
          this.coopReplayTerminal = true;
          settleCoopPresentationOutcome(replay.outcomeToken, {
            kind: "rendered",
            actorFingerprint: replay.actorFingerprint,
          });
          this.pokemon.destroy();
          super.end();
        })
        .catch(() => {
          this.finishCoopReplay({
            kind: "failed",
            reason: "form-change-cutscene-close-threw",
            actorFingerprint: replay.actorFingerprint,
          });
        });
      return;
    }
    this.pokemon.findAndRemoveTags(t => t.tagType === BattlerTagType.AUTOTOMIZED);
    if (this.modal) {
      globalScene.ui.revertMode().then(() => {
        if (globalScene.ui.getMode() === UiMode.PARTY) {
          const partyUiHandler = globalScene.ui.getHandler() as PartyUiHandler;
          partyUiHandler.clearPartySlots();
          partyUiHandler.populatePartySlots();
        }

        super.end();
      });
    } else {
      super.end();
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
