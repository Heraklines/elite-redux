/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { AnySound } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { Phase } from "#app/phase";
import type { CoopWaveProgressionPresentationV2 } from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { playErPokemonSpriteAnim } from "#data/elite-redux/er-form-sprite-redirect";
import { getTypeRgb } from "#data/type";
import { ExpGainsSpeed } from "#enums/exp-gains-speed";
import { ExpNotification } from "#enums/exp-notification";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { PokemonData } from "#system/pokemon-data";
import type { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";
import i18next from "i18next";
import SoundFade from "phaser3-rex-plugins/plugins/soundfade";

const PROGRESSION_STEP_WATCHDOG_MS = 15_000;
const EVOLUTION_STEP_WATCHDOG_MS = 45_000;
const EVOLUTION_CLEANUP_WATCHDOG_MS = 2_000;

class CoopEvolutionPresentationCancelled extends Error {
  constructor() {
    super("retained evolution presentation cancelled");
    this.name = "CoopEvolutionPresentationCancelled";
  }
}

/**
 * A mechanics-free evolution cutscene backed by two exact Pokemon images: the live pre-evolution renderer
 * and an ephemeral Pokemon reconstructed from this event's immutable post-evolution image. It deliberately owns
 * no evolution choice, mutation, account write, move learning, or successor; those already happened once on
 * the authority. The temporary Pokemon is never inserted into the party and is destroyed after presentation.
 */
class CoopEvolutionPresentation {
  private readonly before: PlayerPokemon;
  private readonly after: PlayerPokemon;
  private handler: EvolutionSceneUiHandler | null = null;
  private container: Phaser.GameObjects.Container | null = null;
  private baseBg: Phaser.GameObjects.Image | null = null;
  private videoBg: Phaser.GameObjects.Video | null = null;
  private bgOverlay: Phaser.GameObjects.Rectangle | null = null;
  private flashOverlay: Phaser.GameObjects.Rectangle | null = null;
  private beforeSprite: Phaser.GameObjects.Sprite | null = null;
  private beforeTint: Phaser.GameObjects.Sprite | null = null;
  private afterSprite: Phaser.GameObjects.Sprite | null = null;
  private afterTint: Phaser.GameObjects.Sprite | null = null;
  private bgm: AnySound | null = null;
  private readonly cancellationHooks = new Set<() => void>();
  private readonly cycleCancelled = { value: false };
  private cancelled = false;
  private modeTransitionStarted = false;

  constructor(before: PlayerPokemon, after: PlayerPokemon) {
    this.before = before;
    this.after = after;
  }

  public async play(signal: AbortSignal): Promise<void> {
    const abort = () => this.cancel();
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) {
        this.cancel();
      }
      await this.awaitExternal(this.after.loadAssets());
      this.assertActive();
      this.modeTransitionStarted = true;
      const enterMode = globalScene.ui.setModeForceTransition(UiMode.EVOLUTION_SCENE);
      // If cancellation wins while the transition is still pending, restore MESSAGE again after the late
      // transition settles. Otherwise an abandoned setMode promise can reopen EVOLUTION_SCENE behind DATA.
      void enterMode
        .then(() => {
          if (this.cancelled) {
            return globalScene.ui.setModeForceTransition(UiMode.MESSAGE);
          }
        })
        .catch(() => undefined);
      await this.awaitExternal(enterMode);
      this.assertActive();
      this.setup();
      await this.showTimedText(i18next.t("menu:evolving", { pokemonName: getPokemonNameWithAffix(this.before) }), 1000);
      this.assertActive();
      this.before.cry();
      await this.delay(1000);
      this.assertActive();
      this.bgm = globalScene.playSoundWithoutBgm("evolution");
      await this.tween(this.bgOverlay!, { alpha: 1 }, 1500, 500);
      await this.delay(1000);
      this.assertActive();
      this.videoBg!.setVisible(true).play();
      globalScene.playSound("se/charge");
      globalScene.animations.doSpiralUpward(this.baseBg!, this.container!);
      await this.tween(this.beforeTint!, { alpha: 1 }, 2000);
      this.assertActive();
      this.beforeSprite!.setVisible(false);
      await this.delay(1100);
      this.assertActive();
      globalScene.playSound("se/beam");
      globalScene.animations.doArcDownward(this.baseBg!, this.container!);
      await this.delay(1500);
      this.assertActive();
      this.afterTint!.setScale(0.25).setVisible(true);
      // doCycle owns recursive tweens. Its BooleanHolder stops the recursion at the current (<=500 ms)
      // tween boundary, after which assertActive exits without scheduling any later presentation work.
      await globalScene.animations.doCycle(1, 15, this.beforeTint!, this.afterTint!, this.cycleCancelled);
      this.assertActive();
      globalScene.playSound("se/sparkle");
      this.afterSprite!.setVisible(true);
      globalScene.animations.doCircleInward(this.baseBg!, this.container!);
      await this.delay(900);
      this.assertActive();
      globalScene.playSound("se/shine");
      globalScene.animations.doSpray(this.baseBg!, this.container!);
      await this.tween(this.flashOverlay!, { alpha: 1 }, 250);
      this.assertActive();
      this.bgOverlay!.setAlpha(1);
      this.videoBg!.setVisible(false);
      await this.tween([this.flashOverlay!, this.afterTint!], { alpha: 0 }, 2000, 150);
      await this.tween(this.bgOverlay!, { alpha: 0 }, 250);
      await this.delay(250);
      this.assertActive();
      this.after.cry();
      await this.delay(1250);
      this.assertActive();
      globalScene.playSoundWithoutBgm("evolution_fanfare");
      await this.showTimedText(
        i18next.t("menu:evolutionDone", {
          pokemonName: getPokemonNameWithAffix(this.before),
          evolvedPokemonName: this.after.name,
        }),
        4000,
      );
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.bgm != null) {
        SoundFade.fadeOut(globalScene, this.bgm, 100);
      }
      this.flashOverlay?.destroy();
      if (this.modeTransitionStarted) {
        const restored = globalScene.ui.setModeForceTransition(UiMode.MESSAGE).catch(() => undefined);
        await new Promise<void>(resolve => {
          const cleanupTimeout = setTimeout(resolve, EVOLUTION_CLEANUP_WATCHDOG_MS);
          void restored.finally(() => {
            clearTimeout(cleanupTimeout);
            resolve();
          });
        });
      }
      globalScene.playBgm();
    }
  }

  private cancel(): void {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.cycleCancelled.value = true;
    for (const cancel of [...this.cancellationHooks]) {
      cancel();
    }
    this.cancellationHooks.clear();
  }

  private assertActive(): void {
    if (this.cancelled) {
      throw new CoopEvolutionPresentationCancelled();
    }
  }

  private cancellable<T>(
    begin: (resolve: (value: T) => void, reject: (reason?: unknown) => void) => (() => void) | void,
  ): Promise<T> {
    if (this.cancelled) {
      return Promise.reject(new CoopEvolutionPresentationCancelled());
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let dispose: (() => void) | void;
      const cleanup = () => {
        this.cancellationHooks.delete(cancel);
        dispose?.();
      };
      const succeed = (value: T) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (reason?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(reason);
      };
      const cancel = () => fail(new CoopEvolutionPresentationCancelled());
      this.cancellationHooks.add(cancel);
      dispose = begin(succeed, fail);
      if (settled) {
        dispose?.();
      }
      if (this.cancelled) {
        cancel();
      }
    });
  }

  private awaitExternal<T>(pending: Promise<T>): Promise<T> {
    return this.cancellable<T>((resolve, reject) => {
      pending.then(resolve, reject);
    });
  }

  private setup(): void {
    this.handler = globalScene.ui.getHandler() as EvolutionSceneUiHandler;
    this.handler.canCancel = false;
    this.container = this.handler.evolutionContainer;
    this.baseBg = globalScene.add.image(0, 0, "default_bg").setOrigin(0);
    this.videoBg = globalScene.add.video(0, 0, "evo_bg").stop().setOrigin(0).setScale(0.4359673025).setVisible(false);
    this.bgOverlay = globalScene.add
      .rectangle(0, 0, globalScene.scaledCanvas.width, globalScene.scaledCanvas.height, 0x262626)
      .setOrigin(0)
      .setAlpha(0);
    this.container.add([this.baseBg, this.bgOverlay, this.videoBg]);
    this.flashOverlay = globalScene.add
      .rectangle(
        0,
        -globalScene.scaledCanvas.height,
        globalScene.scaledCanvas.width,
        globalScene.scaledCanvas.height - 48,
        0xffffff,
      )
      .setOrigin(0)
      .setAlpha(0);
    globalScene.ui.add(this.flashOverlay);

    this.beforeSprite = this.createPokemonSprite(this.before);
    this.beforeTint = this.createPokemonSprite(this.before).setAlpha(0).setTintFill(0xffffff);
    this.afterSprite = this.createPokemonSprite(this.after).setVisible(false);
    this.afterTint = this.createPokemonSprite(this.after).setVisible(false).setTintFill(0xffffff);
    this.container.add([this.beforeSprite, this.beforeTint, this.afterSprite, this.afterTint]);
  }

  private createPokemonSprite(pokemon: Pokemon): Phaser.GameObjects.Sprite {
    const sprite = globalScene.addPokemonSprite(
      pokemon,
      this.baseBg!.displayWidth / 2,
      this.baseBg!.displayHeight / 2,
      "pkmn__sub",
    );
    const spriteKey = pokemon.getSpriteKey(true);
    playErPokemonSpriteAnim(sprite, spriteKey);
    sprite.setPipeline(globalScene.spritePipeline, {
      tone: [0, 0, 0, 0],
      hasShadow: false,
      teraColor: getTypeRgb(pokemon.getTeraType()),
      isTerastallized: pokemon.isTerastallized,
    });
    sprite
      .setPipelineData("ignoreTimeTint", true)
      .setPipelineData("spriteKey", spriteKey)
      .setPipelineData("shiny", pokemon.shiny)
      .setPipelineData("variant", pokemon.variant);
    for (let key of ["spriteColors", "fusionSpriteColors"]) {
      if (pokemon.summonData.speciesForm) {
        key += "Base";
      }
      sprite.pipelineData[key] = pokemon.getSprite().pipelineData[key];
    }
    return sprite;
  }

  private showTimedText(text: string, delay: number): Promise<void> {
    return this.cancellable<void>(resolve => {
      globalScene.ui.showText(text, null, resolve, delay, true);
    });
  }

  private delay(duration: number): Promise<void> {
    return this.cancellable<void>(resolve => {
      const timer = globalScene.time.delayedCall(duration, resolve);
      return () => timer.remove(false);
    });
  }

  private tween(
    targets: object | object[],
    properties: Record<string, number>,
    duration: number,
    delay = 0,
  ): Promise<void> {
    return this.cancellable<void>(resolve => {
      const tween = globalScene.tweens.add({
        targets,
        ...properties,
        duration,
        delay,
        ease: "Sine.easeInOut",
        onComplete: () => resolve(),
      });
      return () => tween.stop();
    });
  }
}

/**
 * Render the authority's retained post-battle EXP/level cues over the guest's parked BattleEndPhase.
 *
 * This phase never derives progression. Every displayed value is copied from the immutable WAVE_ADVANCE
 * carrier, and the complete settled state is still applied atomically after this phase reports completion.
 * A damaged UI subtree is presentation-only: the watchdog skips that cue and releases the ordered DATA
 * boundary instead of turning a missing animation into a co-op softlock.
 */
export class CoopWaveProgressionReplayPhase extends Phase {
  public readonly phaseName = "CoopWaveProgressionReplayPhase";

  private readonly wave: number;
  private readonly events: readonly CoopWaveProgressionPresentationV2[];
  private readonly onComplete: () => void;
  private completed = false;

  constructor(wave: number, events: readonly CoopWaveProgressionPresentationV2[], onComplete: () => void) {
    super();
    this.wave = wave;
    this.events = structuredClone(events);
    this.onComplete = onComplete;
  }

  public override start(): void {
    super.start();
    this.renderAll().catch(error => {
      coopWarn("progression", `GUEST retained presentation batch failed wave=${this.wave}; releasing DATA`, error);
      this.finish();
    });
  }

  private async renderAll(): Promise<void> {
    coopLog("progression", `GUEST retained presentation start wave=${this.wave} events=${this.events.length}`);
    for (const event of this.events) {
      try {
        await this.withWatchdog(event, () => this.render(event));
      } catch (error) {
        coopWarn("progression", `GUEST retained ${event.k} presentation failed; skipping cue`, error);
      }
    }
    this.finish();
  }

  private async withWatchdog(
    event: CoopWaveProgressionPresentationV2,
    render: (signal?: AbortSignal) => Promise<void>,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      if (event.k === "evolution") {
        const controller = new AbortController();
        let watchdogFired = false;
        timeout = setTimeout(() => {
          watchdogFired = true;
          coopWarn(
            "progression",
            `GUEST retained evolution presentation watchdog wave=${this.wave} slot=${event.partySlot}`,
          );
          controller.abort();
        }, EVOLUTION_STEP_WATCHDOG_MS);
        try {
          // Unlike the old Promise.race guard, abort tears down every owned callback and waits for the
          // presentation's finally block before DATA may apply. No stale evolution code can outlive release.
          await render(controller.signal);
        } catch (error) {
          if (!watchdogFired || !(error instanceof CoopEvolutionPresentationCancelled)) {
            throw error;
          }
        }
        return;
      }
      await Promise.race([
        render(),
        new Promise<void>(resolve => {
          timeout = setTimeout(() => {
            coopWarn(
              "progression",
              `GUEST retained ${event.k} presentation watchdog wave=${this.wave} slot=${event.partySlot}`,
            );
            globalScene.ui.setMode(UiMode.MESSAGE).catch(() => undefined);
            resolve();
          }, PROGRESSION_STEP_WATCHDOG_MS);
        }),
      ]);
    } finally {
      if (timeout != null) {
        clearTimeout(timeout);
      }
    }
  }

  private render(event: CoopWaveProgressionPresentationV2, signal?: AbortSignal): Promise<void> {
    const pokemon = this.resolvePokemon(event.partySlot, event.pokemonId);
    if (pokemon == null) {
      coopWarn(
        "progression",
        `GUEST retained ${event.k} actor missing wave=${this.wave} slot=${event.partySlot} pokemon=${event.pokemonId}`,
      );
      return Promise.resolve();
    }
    if (event.k === "exp") {
      return this.renderExp(pokemon, event);
    }
    if (event.k === "levelUp") {
      return this.renderLevelUp(pokemon, event);
    }
    if (signal == null) {
      return Promise.reject(new Error("retained evolution presentation requires its watchdog signal"));
    }
    return this.renderEvolution(pokemon, event, signal);
  }

  private resolvePokemon(partySlot: number, pokemonId: number): PlayerPokemon | null {
    const party = globalScene.getPlayerParty();
    const exact = party.find(pokemon => pokemon.id === pokemonId);
    if (exact != null) {
      return exact;
    }
    const fallback = party[partySlot];
    return fallback?.id === pokemonId ? fallback : null;
  }

  private renderExp(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "exp" }>,
  ): Promise<void> {
    // These are host-stated result values, not a local EXP calculation. The complete wave image that follows
    // repeats and validates them as part of its atomic state application.
    pokemon.level = event.toLevel;
    pokemon.exp = event.toExp;

    if (event.display === "party") {
      return this.renderPartyExp(pokemon, event);
    }

    const fastForward = globalScene.gameMode.isCoop && !globalScene.moveAnimations;
    return new Promise<void>(resolve => {
      globalScene.ui.showText(
        i18next.t("battle:expGain", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          exp: event.expGain,
        }),
        fastForward ? 0 : null,
        () => {
          pokemon
            .updateInfo(fastForward)
            .catch(error => coopWarn("progression", "retained field EXP gauge update failed", error))
            .finally(resolve);
        },
        null,
        true,
      );
    });
  }

  private async renderPartyExp(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "exp" }>,
  ): Promise<void> {
    await pokemon.updateInfo(globalScene.expGainsSpeed >= ExpGainsSpeed.SKIP);
    if (globalScene.expParty === ExpNotification.SKIP) {
      return;
    }
    if (globalScene.expParty === ExpNotification.ONLY_LEVEL_UP && event.toLevel === event.fromLevel) {
      return;
    }
    await globalScene.partyExpBar.showPokemonExp(
      pokemon,
      event.expGain,
      globalScene.expParty === ExpNotification.ONLY_LEVEL_UP,
      event.toLevel,
    );
    await globalScene.partyExpBar.hide();
  }

  private async renderLevelUp(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "levelUp" }>,
  ): Promise<void> {
    pokemon.level = event.toLevel;
    pokemon.stats = [...event.postStats];
    await pokemon.updateInfo();

    if (globalScene.expParty === ExpNotification.SKIP) {
      return Promise.resolve();
    }
    const promptStats = () =>
      globalScene.ui
        .getMessageHandler()
        .promptLevelUpStats(event.partySlot, [...event.preStats], false, [...event.postStats]);
    if (globalScene.expParty !== ExpNotification.DEFAULT) {
      return promptStats();
    }
    globalScene.playSound("level_up_fanfare");
    return new Promise<void>(resolve => {
      globalScene.ui.showText(
        i18next.t("battle:levelUp", {
          pokemonName: getPokemonNameWithAffix(pokemon),
          level: event.toLevel,
        }),
        null,
        () => {
          promptStats()
            .catch(error => coopWarn("progression", "retained level-up stats prompt failed", error))
            .finally(resolve);
        },
        null,
        true,
      );
    });
  }

  private async renderEvolution(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "evolution" }>,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      pokemon.species.speciesId !== event.fromSpeciesId
      || pokemon.formIndex !== event.fromFormIndex
      || pokemon.getSpriteKey(true) !== event.fromSpriteKey
    ) {
      throw new Error("retained evolution pre-image does not match the live renderer");
    }
    const rndState = Phaser.Math.RND.state();
    let evolved: PlayerPokemon;
    try {
      evolved = new PokemonData(event.postPokemon).toPokemon(undefined, event.partySlot) as PlayerPokemon;
    } finally {
      Phaser.Math.RND.state(rndState);
    }
    try {
      if (
        evolved.id !== event.pokemonId
        || evolved.species.speciesId !== event.toSpeciesId
        || evolved.formIndex !== event.toFormIndex
        || evolved.getSpriteKey(true) !== event.toSpriteKey
      ) {
        throw new Error("retained evolution post-image does not match its immutable party material");
      }
      coopLog(
        "progression",
        `GUEST retained evolution start wave=${this.wave} slot=${event.partySlot} species=${event.fromSpeciesId}->${event.toSpeciesId}`,
      );
      await new CoopEvolutionPresentation(pokemon, evolved).play(signal);
      coopLog(
        "progression",
        `GUEST retained evolution complete wave=${this.wave} slot=${event.partySlot} species=${event.fromSpeciesId}->${event.toSpeciesId}`,
      );
    } finally {
      evolved.destroy();
    }
  }

  private finish(): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    coopLog("progression", `GUEST retained presentation complete wave=${this.wave} events=${this.events.length}`);
    // Restore the parked BattleEndPhase first. The callback retries the exact V2 entry against that real
    // boundary, so DATA can never apply while this cosmetic override is still current.
    this.end();
    this.onComplete();
  }
}
