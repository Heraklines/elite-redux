import type { AnySound } from "#app/battle-scene";
import { EVOLVE_MOVE } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { Phase } from "#app/phase";
import type { SpeciesFormEvolution } from "#balance/pokemon-evolutions";
import { FusionSpeciesFormEvolution } from "#balance/pokemon-evolutions";
import type { CoopWaveProgressionPresentationV2 } from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import type { CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";
import {
  failCoopSharedSession,
  getCoopController,
  getCoopRuntime,
  recordCoopWaveProgressionPresentation,
  runWhenCoopRuntimeActive,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopAuthorityRole } from "#data/elite-redux/coop/coop-session-binding";
import { erRecordAchievementEvolution } from "#data/elite-redux/er-achievement-tracker";
import { playErPokemonSpriteAnim } from "#data/elite-redux/er-form-sprite-redirect";
import { notifyMoodyCoordinatorPokemonEvolved } from "#data/elite-redux/moody/moody-runtime-game-adapter";
import { getTypeRgb } from "#data/type";
import { LearnMoveSituation } from "#enums/learn-move-situation";
import { LearnMoveType } from "#enums/learn-move-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { PokemonData } from "#system/pokemon-data";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import type { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";
import { fixedInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { fadeOutSoundIfActive } from "#utils/sound-fade";
import { toPascalCase } from "#utils/strings";
import i18next from "i18next";

/**
 * Human-readable target for a candidate evolution. Regional evolutions such as
 * Typhlosion/Hisuian Typhlosion use separate species ids but share the same base
 * `name`, so the plain species name makes a branched choice ambiguous. Prefer
 * the localized expanded species/form name while remaining safe for ER custom
 * species ids that are not represented in the vanilla SpeciesId enum.
 */
export function getEvolutionChoiceLabel(evolution: SpeciesFormEvolution): string {
  const species = getPokemonSpecies(evolution.speciesId);
  const enumSpeciesName = SpeciesId[evolution.speciesId];
  const speciesName =
    evolution.speciesId >= 2000 && typeof enumSpeciesName === "string"
      ? species.getExpandedSpeciesName()
      : species.name;

  if (!evolution.evoFormKey) {
    return speciesName;
  }

  const formIndex = species.forms.findIndex(form => form.formKey === evolution.evoFormKey);
  const displayedFormName = formIndex >= 0 ? species.getFormNameToDisplay(formIndex, true) : "";
  return displayedFormName || `${speciesName} (${toPascalCase(evolution.evoFormKey)})`;
}

/**
 * Only the replica renderer needs a signed structural bridge while a terminal reward evolution settles.
 * The authority already owns its ordinary local NewBattlePhase; replacing it with a replica-only signed
 * wait makes NewBattlePhase fail closed as soon as the authority tries to start it.
 */
export function shouldQueueCoopEvolutionReplicaNextWaveBridge(
  authorityRole: CoopAuthorityRole | null | undefined,
  allowNextWaveStart: boolean,
): boolean {
  return authorityRole === "replica" && allowNextWaveStart;
}

export class EvolutionPhase extends Phase {
  // FormChangePhase and its mechanics-free co-op replay inherit from this, but EvolutionPhase is not abstract.
  // We have to use the union here
  public readonly phaseName: "EvolutionPhase" | "FormChangePhase" | "CoopFormChangeCutsceneReplayPhase" =
    "EvolutionPhase";
  /**
   * The scene that constructed this phase. Co-op's two-engine harness deliberately swaps the process-global
   * scene while promises are pending, so an async subclass must never rediscover its renderer after an await.
   */
  protected readonly scene = globalScene;
  protected pokemon: PlayerPokemon;
  protected lastLevel: number;

  protected evoChain: Phaser.Tweens.TweenChain | null = null;

  private preEvolvedPokemonName: string;
  private readonly coopPreEvolutionSpeciesId: number;
  private readonly coopPreEvolutionFormIndex: number;
  private readonly coopPreEvolutionSpriteKey: string;
  private readonly coopPreEvolutionPokemon: Readonly<Record<string, unknown>>;

  private evolution: SpeciesFormEvolution | null;
  /**
   * When the species has more than one currently-valid evolution, the full set
   * of candidates the player gets to choose between at the start of the phase.
   * Empty/single-element means there is no choice and {@linkcode evolution} is used directly.
   */
  private readonly evolutionChoices: SpeciesFormEvolution[];
  /** True only for an evolution queued by a terminal reward whose successor may enter wave N+1. */
  private readonly coopAllowNextWaveStart: boolean;
  /** Exact terminal reward whose complete result is settled only after this asynchronous evolution. */
  private readonly coopRewardOperationId: string | null;
  private readonly coopSettleRewardEvolution:
    | ((
        presentation: Extract<CoopWaveProgressionPresentationV2, { readonly k: "evolution" }>,
        requiresLearnMoveDecision: boolean,
      ) => boolean)
    | null;
  private readonly coopOwningRuntime = getCoopRuntime();
  private readonly coopRewardSourceWave: number;
  private readonly coopRewardSourceTurn: number;
  private coopRewardTerminalSettlement: {
    readonly operationId: string;
    readonly successor: Extract<CoopNextControl, { readonly kind: "AWAIT_SUCCESSOR" }>;
    readonly settle: () => boolean;
  } | null = null;
  private fusionSpeciesEvolved: boolean; // Whether the evolution is of the fused species
  private evolutionBgm: AnySound | null;
  private evolutionHandler: EvolutionSceneUiHandler;

  /** Container for all assets used by the scene. When the scene is cleared, the children within this are destroyed. */
  protected evolutionContainer: Phaser.GameObjects.Container;
  protected evolutionBaseBg: Phaser.GameObjects.Image;
  protected evolutionBg: Phaser.GameObjects.Video;
  protected evolutionBgOverlay: Phaser.GameObjects.Rectangle;
  protected evolutionOverlay: Phaser.GameObjects.Rectangle;
  protected pokemonSprite: Phaser.GameObjects.Sprite;
  protected pokemonTintSprite: Phaser.GameObjects.Sprite;
  protected pokemonEvoSprite: Phaser.GameObjects.Sprite;
  protected pokemonEvoTintSprite: Phaser.GameObjects.Sprite;

  /** Whether the evolution can be cancelled by the player */
  protected canCancel: boolean;

  /**
   * @param pokemon - The Pokemon that is evolving
   * @param evolution - The form being evolved into
   * @param lastLevel - The level at which the Pokemon is evolving
   * @param canCancel - Whether the evolution can be cancelled by the player
   * @param evolutionChoices - When the line offers more than one valid evolution, the candidates to
   *  let the player pick between. Defaults to just `evolution` (no choice).
   * @param coopAllowNextWaveStart - Inherit a terminal reward's wave-crossing permit through evolve-move prompts.
   * @param coopRewardOperationId - Exact retained reward whose complete result waits for this evolution.
   * @param coopSettleRewardEvolution - Authority-only post-image settlement callback for that reward.
   */
  constructor(
    pokemon: PlayerPokemon,
    evolution: SpeciesFormEvolution | null,
    lastLevel: number,
    canCancel = true,
    evolutionChoices: SpeciesFormEvolution[] = [],
    coopAllowNextWaveStart = false,
    coopRewardOperationId: string | null = null,
    coopSettleRewardEvolution:
      | ((
          presentation: Extract<CoopWaveProgressionPresentationV2, { readonly k: "evolution" }>,
          requiresLearnMoveDecision: boolean,
        ) => boolean)
      | null = null,
  ) {
    super();

    this.pokemon = pokemon;
    this.evolution = evolution;
    this.lastLevel = lastLevel;
    this.fusionSpeciesEvolved = evolution instanceof FusionSpeciesFormEvolution;
    this.canCancel = canCancel;
    this.evolutionChoices = evolutionChoices;
    this.coopAllowNextWaveStart = coopAllowNextWaveStart;
    this.coopRewardOperationId = coopRewardOperationId;
    this.coopSettleRewardEvolution = coopRewardOperationId == null ? null : coopSettleRewardEvolution;
    this.coopRewardSourceWave = this.scene.currentBattle?.waveIndex ?? 0;
    this.coopRewardSourceTurn = this.scene.currentBattle?.turn ?? 0;
    this.coopPreEvolutionSpeciesId = pokemon.species.speciesId;
    this.coopPreEvolutionFormIndex = pokemon.formIndex;
    this.coopPreEvolutionSpriteKey = pokemon.getSpriteKey(true);
    this.coopPreEvolutionPokemon = JSON.parse(JSON.stringify(new PokemonData(pokemon))) as Record<string, unknown>;
  }

  /** Install the exact terminal successor while this phase is the scheduler's live reward boundary. */
  public installCoopV2TerminalSuccessor(
    operationId: string,
    successor: Extract<CoopNextControl, { readonly kind: "AWAIT_SUCCESSOR" }>,
    settle: () => boolean,
  ): boolean {
    if (
      this.coopRewardOperationId !== operationId
      || successor.afterOperationId !== operationId
      || successor.epoch !== getCoopController()?.sessionEpoch
      || successor.wave !== this.coopRewardSourceWave
      || successor.turn !== this.coopRewardSourceTurn
    ) {
      return false;
    }
    if (this.coopRewardTerminalSettlement != null) {
      return (
        this.coopRewardTerminalSettlement.operationId === operationId
        && JSON.stringify(this.coopRewardTerminalSettlement.successor) === JSON.stringify(successor)
      );
    }
    this.coopRewardTerminalSettlement = { operationId, successor: structuredClone(successor), settle };
    return true;
  }

  /** Queue the signed structural bridge before proving the exact delayed reward result complete. */
  private proveCoopRewardEvolutionSettlement(): boolean {
    if (this.coopRewardOperationId == null) {
      return true;
    }
    const operationId = this.coopRewardOperationId;
    const runtime = this.coopOwningRuntime;
    const successor = runtime?.v2ControlLedger.latestControl;
    const sourceEntry = runtime == null || successor == null ? null : runtime.v2ControlLedger.sourceEntryOf(successor);
    // Replica materialization installs the successor directly on this phase before it applies the
    // presentation. The authority authored the post-image itself, so its successor exists only after the
    // atomic log commit. Recover that authority-local binding exclusively from the exact material-applied
    // ledger claim; a merely latest/ambient wait must never release this asynchronous evolution.
    const authorityTerminal =
      runtime?.controller.authorityRole === "authority"
      && successor?.kind === "AWAIT_SUCCESSOR"
      && successor.afterOperationId === operationId
      && successor.epoch === runtime.controller.sessionEpoch
      && successor.wave === this.coopRewardSourceWave
      && successor.turn === this.coopRewardSourceTurn
      && runtime.v2ControlLedger.isMaterialApplied(successor)
      && sourceEntry?.kind === "INTERACTION_COMMIT"
      && sourceEntry.operationId === operationId
      && sourceEntry.context.sessionEpoch === successor.epoch
      && sourceEntry.context.authoritySeatId === runtime.controller.localSeatId
        ? {
            operationId,
            successor,
            settle: () => settleCoopV2InteractionOperation(operationId, runtime),
          }
        : null;
    const terminal = this.coopRewardTerminalSettlement ?? authorityTerminal;
    if (terminal == null || terminal.operationId !== this.coopRewardOperationId) {
      return false;
    }
    if (
      shouldQueueCoopEvolutionReplicaNextWaveBridge(
        runtime?.controller.authorityRole,
        terminal.successor.allowNextWaveStart,
      )
    ) {
      this.scene.phaseManager.removeAllPhasesOfType("NewBattlePhase");
      this.scene.phaseManager.pushNew("NewBattlePhase", {
        afterOperationId: terminal.successor.afterOperationId,
        epoch: terminal.successor.epoch,
        wave: terminal.successor.wave,
        turn: terminal.successor.turn,
      });
    }
    return terminal.settle();
  }

  validate(): boolean {
    return !!this.evolution;
  }

  setMode(): Promise<void> {
    return this.scene.ui.setModeForceTransition(UiMode.EVOLUTION_SCENE);
  }

  /**
   * Present the player with every currently-valid evolution and resolve with the
   * one they pick, or `null` if they back out (decline to evolve).
   */
  private promptEvolutionChoice(): Promise<SpeciesFormEvolution | null> {
    return new Promise(resolve => {
      const options: OptionSelectItem[] = this.evolutionChoices.map(evo => ({
        label: getEvolutionChoiceLabel(evo),
        handler: () => {
          this.scene.ui.revertMode();
          resolve(evo);
          return true;
        },
      }));
      // Trailing escape so the player can always decline to evolve.
      options.push({
        label: i18next.t("menu:cancel"),
        handler: () => {
          this.scene.ui.revertMode();
          resolve(null);
          return true;
        },
      });
      this.scene.ui.showText(
        i18next.t("menu:selectEvolution", { pokemonName: getPokemonNameWithAffix(this.pokemon) }),
        null,
        () => {
          this.scene.ui.setOverlayMode(UiMode.OPTION_SELECT, {
            options,
            noCancel: true,
          });
        },
        1000,
      );
    });
  }

  /**
   * Set up the following evolution assets
   * - {@linkcode evolutionContainer}
   * - {@linkcode evolutionBaseBg}
   * - {@linkcode evolutionBg}
   * - {@linkcode evolutionBgOverlay}
   * - {@linkcode evolutionOverlay}
   *
   */
  private setupEvolutionAssets(): void {
    this.evolutionHandler = this.scene.ui.getHandler() as EvolutionSceneUiHandler;
    this.evolutionContainer = this.evolutionHandler.evolutionContainer;
    this.evolutionBaseBg = this.scene.add.image(0, 0, "default_bg").setOrigin(0);

    this.evolutionBg = this.scene.add
      .video(0, 0, "evo_bg")
      .stop()
      .setOrigin(0)
      .setScale(0.4359673025)
      .setVisible(false);

    this.evolutionBgOverlay = this.scene.add
      .rectangle(0, 0, this.scene.scaledCanvas.width, this.scene.scaledCanvas.height, 0x262626)
      .setOrigin(0)
      .setAlpha(0);
    this.evolutionContainer.add([this.evolutionBaseBg, this.evolutionBgOverlay, this.evolutionBg]);

    this.evolutionOverlay = this.scene.add.rectangle(
      0,
      -this.scene.scaledCanvas.height,
      this.scene.scaledCanvas.width,
      this.scene.scaledCanvas.height - 48,
      0xffffff,
    );
    this.evolutionOverlay.setOrigin(0).setAlpha(0);
    this.scene.ui.add(this.evolutionOverlay);
  }

  /**
   * Configure the sprite, setting its pipeline data
   * @param pokemon - The pokemon object that the sprite information is configured from
   * @param sprite - The sprite object to configure
   * @param setPipeline - Whether to also set the pipeline; should be false
   *  if the sprite is only being updated with new sprite assets
   *
   *
   * @returns The sprite object that was passed in
   */
  protected configureSprite(pokemon: Pokemon, sprite: Phaser.GameObjects.Sprite, setPipeline = true): typeof sprite {
    const spriteKey = pokemon.getSpriteKey(true);
    // ER (#396 / Discupid evolution scramble): pin the atlas + frame 0001, gap-fill
    // the anim if the atlas is loaded but its animation was not built, then play.
    // Without this a bare `play` warns "Missing animation" and the EVOLVED sprite
    // silently keeps showing the pre-evolution (or draws the raw packed sheet).
    playErPokemonSpriteAnim(sprite, spriteKey);

    if (setPipeline) {
      sprite.setPipeline(this.scene.spritePipeline, {
        tone: [0.0, 0.0, 0.0, 0.0],
        hasShadow: false,
        teraColor: getTypeRgb(pokemon.getTeraType()),
        isTerastallized: pokemon.isTerastallized,
      });
    }

    sprite
      .setPipelineData("ignoreTimeTint", true)
      .setPipelineData("spriteKey", spriteKey)
      .setPipelineData("shiny", pokemon.shiny)
      .setPipelineData("variant", pokemon.variant);

    for (let k of ["spriteColors", "fusionSpriteColors"]) {
      if (pokemon.summonData.speciesForm) {
        k += "Base";
      }
      sprite.pipelineData[k] = pokemon.getSprite().pipelineData[k];
    }

    return sprite;
  }

  private getPokemonSprite(): Phaser.GameObjects.Sprite {
    const sprite = this.scene.addPokemonSprite(
      this.pokemon,
      this.evolutionBaseBg.displayWidth / 2,
      this.evolutionBaseBg.displayHeight / 2,
      "pkmn__sub",
    );
    sprite.setPipeline(this.scene.spritePipeline, {
      tone: [0.0, 0.0, 0.0, 0.0],
      ignoreTimeTint: true,
    });
    return sprite;
  }

  /**
   * Initialize {@linkcode pokemonSprite}, {@linkcode pokemonTintSprite}, {@linkcode pokemonEvoSprite}, and {@linkcode pokemonEvoTintSprite}
   * and add them to the {@linkcode evolutionContainer}
   */
  private setupPokemonSprites(): void {
    this.pokemonSprite = this.configureSprite(this.pokemon, this.getPokemonSprite());
    this.pokemonTintSprite = this.configureSprite(
      this.pokemon,
      this.getPokemonSprite().setAlpha(0).setTintFill(0xffffff),
    );
    this.pokemonEvoSprite = this.configureSprite(this.pokemon, this.getPokemonSprite().setVisible(false));
    this.pokemonEvoTintSprite = this.configureSprite(
      this.pokemon,
      this.getPokemonSprite().setVisible(false).setTintFill(0xffffff),
    );

    this.evolutionContainer.add([
      this.pokemonSprite,
      this.pokemonTintSprite,
      this.pokemonEvoSprite,
      this.pokemonEvoTintSprite,
    ]);
  }

  async start() {
    super.start();
    await this.setMode();

    if (this.isRetired()) {
      return;
    }

    if (!this.validate()) {
      // setMode() above put the UI in EVOLUTION_SCENE; only EndEvolutionPhase
      // transitions back to MESSAGE. Bailing straight to end() here would leave
      // the UI stuck in the evolution scene (frozen black screen), so restore
      // it the same way the success/failed paths do.
      this.scene.phaseManager.unshiftNew("EndEvolutionPhase");
      return this.end();
    }

    // When the line currently offers more than one valid evolution, let the
    // player pick the path first. Declining the choice (cancel) is treated like
    // cancelling the evolution outright. Done after entering the evolution scene
    // so we are in a known UI mode that supports the prompt overlay.
    if (this.evolutionChoices.length > 1) {
      // Co-op (#633 Fix #4c): the branched-evolution prompt + the cancel are interactive
      // choices on a SHARED mon - each client could pick a DIFFERENT branch (divergent
      // species) or one cancel + one evolve. There is no relay for this, so co-op resolves
      // it DETERMINISTICALLY: take the FIRST valid evolution (identical on both clients) and
      // never prompt. Solo keeps the interactive branch picker.
      if (this.scene.gameMode.isCoop) {
        this.evolution = this.evolutionChoices[0];
        this.fusionSpeciesEvolved = this.evolution instanceof FusionSpeciesFormEvolution;
      } else {
        const chosen = await this.promptEvolutionChoice();
        if (this.isRetired()) {
          return;
        }
        if (!chosen) {
          // Same as the validate()-fail bail above: we are in EVOLUTION_SCENE
          // mode, so we must route through EndEvolutionPhase to hand the UI back
          // to MESSAGE. Cancelling Eevee (its branched evolutions trigger this
          // prompt) otherwise froze the game.
          this.scene.phaseManager.unshiftNew("EndEvolutionPhase");
          return this.end();
        }
        this.evolution = chosen;
        this.fusionSpeciesEvolved = chosen instanceof FusionSpeciesFormEvolution;
      }
    }
    this.setupEvolutionAssets();
    this.setupPokemonSprites();
    this.preEvolvedPokemonName = getPokemonNameWithAffix(this.pokemon);
    this.doEvolution();
  }

  /**
   * Update the sprites depicting the evolved Pokemon
   * @param evolvedPokemon - The evolved Pokemon
   */
  private updateEvolvedPokemonSprites(evolvedPokemon: Pokemon): void {
    this.configureSprite(evolvedPokemon, this.pokemonEvoSprite, false);
    this.configureSprite(evolvedPokemon, this.pokemonEvoTintSprite, false);
  }

  /**
   * Adds the evolution tween and begins playing it
   */
  private playEvolutionAnimation(evolvedPokemon: Pokemon): void {
    globalScene.time.delayedCall(1000, () => {
      this.evolutionBgm = globalScene.playSoundWithoutBgm("evolution");
      globalScene.tweens.add({
        targets: this.evolutionBgOverlay,
        alpha: 1,
        delay: 500,
        duration: 1500,
        ease: "Sine.easeOut",
        onComplete: () => {
          globalScene.time.delayedCall(1000, () => {
            this.evolutionBg.setVisible(true).play();
          });
          globalScene.playSound("se/charge");
          globalScene.animations.doSpiralUpward(this.evolutionBaseBg, this.evolutionContainer);
          this.fadeOutPokemonSprite(evolvedPokemon);
        },
      });
    });
  }

  private fadeOutPokemonSprite(evolvedPokemon: Pokemon): void {
    globalScene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 2000,
      onUpdate: t => {
        this.pokemonTintSprite.setAlpha(t.getValue() ?? 1);
      },
      onComplete: () => {
        this.pokemonSprite.setVisible(false);
        globalScene.time.delayedCall(1100, () => {
          globalScene.playSound("se/beam");
          globalScene.animations.doArcDownward(this.evolutionBaseBg, this.evolutionContainer);
          this.prepareForCycle(evolvedPokemon);
        });
      },
    });
  }

  /**
   * Prepares the evolution cycle by setting up the tint sprites and starting the cycle
   */
  private prepareForCycle(evolvedPokemon: Pokemon): void {
    globalScene.time.delayedCall(1500, () => {
      this.pokemonEvoTintSprite.setScale(0.25).setVisible(true);
      // Co-op (#633 Fix #4c): never allow cancel in co-op - one client cancelling while the
      // other evolves diverges the shared mon's species. Force-evolve deterministically.
      this.evolutionHandler.canCancel = this.canCancel && !globalScene.gameMode.isCoop;
      globalScene.animations.doCycle(1, 15, this.pokemonTintSprite, this.pokemonEvoTintSprite).then(() => {
        if (this.evolutionHandler.cancelled) {
          this.handleFailedEvolution(evolvedPokemon);
        } else {
          this.handleSuccessEvolution(evolvedPokemon);
        }
      });
    });
  }

  /**
   * Show the evolution text and then commence the evolution animation
   */
  doEvolution(): void {
    globalScene.ui.showText(
      i18next.t("menu:evolving", { pokemonName: this.preEvolvedPokemonName }),
      null,
      () => {
        this.pokemon.cry();
        this.pokemon.getPossibleEvolution(this.evolution).then(evolvedPokemon => {
          this.updateEvolvedPokemonSprites(evolvedPokemon);
          this.playEvolutionAnimation(evolvedPokemon);
        });
      },
      1000,
    );
  }

  /** Used exclusively by {@linkcode handleFailedEvolution} to fade out the evolution sprites and music */
  private fadeOutEvolutionAssets(): void {
    globalScene.tweens.add({
      targets: [this.evolutionBg, this.pokemonTintSprite, this.pokemonEvoSprite, this.pokemonEvoTintSprite],
      alpha: 0,
      duration: 250,
      onComplete: () => {
        this.evolutionBg.setVisible(false);
      },
    });
    fadeOutSoundIfActive(globalScene, this.evolutionBgm);
  }

  /**
   * Show the confirmation prompt for pausing evolutions
   * @param endCallback - The callback to call after either option is selected.
   *  This should end the evolution phase
   */
  private showPauseEvolutionConfirmation(endCallback: () => void): void {
    globalScene.ui.setOverlayMode(
      UiMode.CONFIRM,
      () => {
        globalScene.ui.revertMode();
        this.pokemon.pauseEvolutions = true;
        globalScene.ui.showText(
          i18next.t("menu:evolutionsPaused", {
            pokemonName: this.preEvolvedPokemonName,
          }),
          null,
          endCallback,
          3000,
        );
      },
      () => {
        globalScene.ui.revertMode();
        globalScene.time.delayedCall(3000, endCallback);
      },
    );
  }

  /**
   * Used exclusively by {@linkcode handleFailedEvolution} to show the failed evolution UI messages
   */
  private showFailedEvolutionUI(evolvedPokemon: Pokemon): void {
    globalScene.phaseManager.unshiftNew("EndEvolutionPhase");

    globalScene.ui.showText(
      i18next.t("menu:stoppedEvolving", {
        pokemonName: this.preEvolvedPokemonName,
      }),
      null,
      () => {
        globalScene.ui.showText(
          i18next.t("menu:pauseEvolutionsQuestion", {
            pokemonName: this.preEvolvedPokemonName,
          }),
          null,
          () => {
            const end = () => {
              globalScene.ui.showText("", 0);
              globalScene.playBgm();
              evolvedPokemon.destroy();
              this.end();
            };
            this.showPauseEvolutionConfirmation(end);
          },
        );
      },
      null,
      true,
    );
  }

  /**
   * Fade out the evolution assets, show the failed evolution UI messages, and enqueue the EndEvolutionPhase
   * @param evolvedPokemon - The evolved Pokemon
   */
  private handleFailedEvolution(evolvedPokemon: Pokemon): void {
    this.pokemonSprite.setVisible(true);
    this.pokemonTintSprite.setScale(1);
    this.fadeOutEvolutionAssets();

    globalScene.phaseManager.unshiftNew("EndEvolutionPhase");
    this.showFailedEvolutionUI(evolvedPokemon);
  }

  /**
   * Fadeout evolution music, play the cry, show the evolution completed text, and end the phase
   */
  private onEvolutionComplete(evolvedPokemon: Pokemon) {
    // ER achievements: `this.pokemon` is now the evolved species (Incompatible Hardware: Porygon-Z).
    erRecordAchievementEvolution(this.pokemon);
    notifyMoodyCoordinatorPokemonEvolved(this.pokemon);
    fadeOutSoundIfActive(globalScene, this.evolutionBgm);
    globalScene.time.delayedCall(250, () => {
      this.pokemon.cry();
      globalScene.time.delayedCall(1250, () => {
        globalScene.playSoundWithoutBgm("evolution_fanfare");

        evolvedPokemon.destroy();
        globalScene.ui.showText(
          i18next.t("menu:evolutionDone", {
            pokemonName: this.preEvolvedPokemonName,
            evolvedPokemonName: this.pokemon.name,
          }),
          null,
          () => this.end(),
          null,
          true,
          fixedInt(4000),
        );
        globalScene.time.delayedCall(fixedInt(4250), () => globalScene.playBgm());
      });
    });
  }

  private evolutionLevelMoves() {
    const learnSituation: LearnMoveSituation = this.fusionSpeciesEvolved
      ? LearnMoveSituation.EVOLUTION_FUSED
      : this.pokemon.fusionSpecies
        ? LearnMoveSituation.EVOLUTION_FUSED_BASE
        : LearnMoveSituation.EVOLUTION;
    return this.pokemon
      .getLevelMoves(this.lastLevel + 1, true, false, false, learnSituation)
      .filter(lm => lm[0] === EVOLVE_MOVE);
  }

  /** Whether at least one evolve move will require human replacement after deterministic empty-slot learns. */
  private evolutionRequiresLearnMoveDecision(): boolean {
    const moveset = this.pokemon.getMoveset(true);
    const knownMoves = new Set(moveset.map(move => move.moveId));
    const novelMoves = this.evolutionLevelMoves().filter(([, moveId]) => !knownMoves.has(moveId));
    const emptySlots = Math.max(0, this.pokemon.getMaxMoveCount() - moveset.length);
    return novelMoves.length > emptySlots;
  }

  private postEvolve(evolvedPokemon: Pokemon): void {
    const levelMoves = this.evolutionLevelMoves();
    for (let index = 0; index < levelMoves.length; index++) {
      const lm = levelMoves[index];
      globalScene.phaseManager.unshiftNew(
        "LearnMovePhase",
        globalScene.getPlayerParty().indexOf(this.pokemon),
        lm[1],
        LearnMoveType.LEARN_MOVE,
        -1,
        this.coopAllowNextWaveStart && index === levelMoves.length - 1,
      );
    }
    globalScene.phaseManager.unshiftNew("EndEvolutionPhase");

    globalScene.playSound("se/shine");
    globalScene.animations.doSpray(this.evolutionBaseBg, this.evolutionContainer);

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
          onComplete: () => this.onEvolutionComplete(evolvedPokemon),
        },
      ],
    });
  }

  /**
   * Handles a successful evolution
   * @param evolvedPokemon - The evolved Pokemon
   */
  private handleSuccessEvolution(evolvedPokemon: Pokemon): void {
    globalScene.playSound("se/sparkle");
    this.pokemonEvoSprite.setVisible(true);
    globalScene.animations.doCircleInward(this.evolutionBaseBg, this.evolutionContainer);

    globalScene.time.delayedCall(900, () => {
      // Co-op (#633 Fix #4c): keep cancel disabled in co-op for the same determinism reason.
      this.evolutionHandler.canCancel = this.canCancel && !globalScene.gameMode.isCoop;

      this.pokemon.evolve(this.evolution, this.pokemon.species).then(() => {
        const partySlot = this.scene.getPlayerParty().indexOf(this.pokemon);
        if (partySlot >= 0) {
          const presentation = {
            k: "evolution",
            partySlot,
            pokemonId: this.pokemon.id,
            fromSpeciesId: this.coopPreEvolutionSpeciesId,
            fromFormIndex: this.coopPreEvolutionFormIndex,
            fromSpriteKey: this.coopPreEvolutionSpriteKey,
            toSpeciesId: this.pokemon.species.speciesId,
            toFormIndex: this.pokemon.formIndex,
            toSpriteKey: this.pokemon.getSpriteKey(true),
            prePokemon: this.coopPreEvolutionPokemon,
            postPokemon: JSON.parse(JSON.stringify(new PokemonData(this.pokemon))) as Record<string, unknown>,
          } as const satisfies Extract<CoopWaveProgressionPresentationV2, { readonly k: "evolution" }>;
          const finishEvolution = (): void => {
            recordCoopWaveProgressionPresentation(presentation, this.coopOwningRuntime);
            if (this.coopSettleRewardEvolution != null) {
              const committed = this.coopSettleRewardEvolution(presentation, this.evolutionRequiresLearnMoveDecision());
              if (!committed || !this.proveCoopRewardEvolutionSettlement()) {
                failCoopSharedSession(`Evolution reward ${this.coopRewardOperationId ?? "unknown"} could not settle`);
                return;
              }
            }
            this.postEvolve(evolvedPokemon);
          };
          if (this.coopSettleRewardEvolution != null && this.coopOwningRuntime != null) {
            runWhenCoopRuntimeActive(this.coopOwningRuntime, finishEvolution);
          } else {
            finishEvolution();
          }
          return;
        }
        if (this.coopSettleRewardEvolution != null) {
          failCoopSharedSession(`Evolution reward ${this.coopRewardOperationId ?? "unknown"} lost its party target`);
          return;
        }
        this.postEvolve(evolvedPokemon);
      });
    });
  }
}
