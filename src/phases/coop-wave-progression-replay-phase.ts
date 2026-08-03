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
import { observeCoopWaveProgressionPresentation } from "#data/elite-redux/coop/coop-wave-progression-observer";
import { playErPokemonSpriteAnim } from "#data/elite-redux/er-form-sprite-redirect";
import { getTypeRgb } from "#data/type";
import { Button } from "#enums/buttons";
import { ExpNotification } from "#enums/exp-notification";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { PokemonData } from "#system/pokemon-data";
import type { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";
import type { BattleMessageUiHandler } from "#ui/handlers/battle-message-ui-handler";
import { fadeOutSoundIfActive } from "#utils/sound-fade";
import i18next from "i18next";

const PROGRESSION_STEP_WATCHDOG_MS = 15_000;
const EVOLUTION_STEP_WATCHDOG_MS = 45_000;
const EVOLUTION_CLEANUP_WATCHDOG_MS = 2_000;

class CoopEvolutionPresentationCancelled extends Error {
  constructor() {
    super("retained evolution presentation cancelled");
    this.name = "CoopEvolutionPresentationCancelled";
  }
}

class CoopWaveProgressionPresentationCancelled extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CoopWaveProgressionPresentationCancelled";
  }
}

/**
 * A mechanics-free evolution cutscene backed by two exact ephemeral Pokemon images reconstructed from the
 * event's immutable pre/post material. It deliberately owns
 * no evolution choice, mutation, account write, move learning, or successor; those already happened once on
 * the authority. Neither temporary Pokemon is inserted into the party; both are destroyed after presentation.
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

  public async play(signal: AbortSignal, heartbeat: (stage: string) => void): Promise<void> {
    const abort = () => this.cancel();
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) {
        this.cancel();
      }
      await this.awaitExternal(Promise.all([this.before.loadAssets(), this.after.loadAssets()]));
      this.assertActive();
      heartbeat("assets-loaded");
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
      heartbeat("mode-ready");
      this.setup();
      heartbeat("scene-ready");
      await this.showTimedText(i18next.t("menu:evolving", { pokemonName: getPokemonNameWithAffix(this.before) }), {
        callbackDelay: 1000,
        prompt: false,
      });
      this.assertActive();
      heartbeat("intro-text");
      this.before.cry();
      await this.delay(1000);
      this.assertActive();
      heartbeat("intro-cry");
      this.bgm = globalScene.playSoundWithoutBgm("evolution");
      await this.tween(this.bgOverlay!, { alpha: 1 }, 1500, 500);
      this.assertActive();
      heartbeat("background-fade");
      await this.delay(1000);
      this.assertActive();
      heartbeat("charge-delay");
      this.videoBg!.setVisible(true).play();
      globalScene.playSound("se/charge");
      globalScene.animations.doSpiralUpward(this.baseBg!, this.container!);
      await this.tween(this.beforeTint!, { alpha: 1 }, 2000);
      this.assertActive();
      heartbeat("before-tint");
      this.beforeSprite!.setVisible(false);
      await this.delay(1100);
      this.assertActive();
      heartbeat("beam-delay");
      globalScene.playSound("se/beam");
      globalScene.animations.doArcDownward(this.baseBg!, this.container!);
      await this.delay(1500);
      this.assertActive();
      heartbeat("arc-delay");
      this.afterTint!.setScale(0.25).setVisible(true);
      // doCycle owns recursive tweens. Its BooleanHolder stops the recursion at the current (<=500 ms)
      // tween boundary, after which assertActive exits without scheduling any later presentation work.
      await globalScene.animations.doCycle(
        1,
        15,
        this.beforeTint!,
        this.afterTint!,
        this.cycleCancelled,
        undefined,
        cycle => heartbeat(`cycle-${cycle}`),
      );
      this.assertActive();
      heartbeat("cycle-complete");
      globalScene.playSound("se/sparkle");
      this.afterSprite!.setVisible(true);
      globalScene.animations.doCircleInward(this.baseBg!, this.container!);
      await this.delay(900);
      this.assertActive();
      heartbeat("reveal-delay");
      globalScene.playSound("se/shine");
      globalScene.animations.doSpray(this.baseBg!, this.container!);
      await this.tween(this.flashOverlay!, { alpha: 1 }, 250);
      this.assertActive();
      heartbeat("flash-in");
      this.bgOverlay!.setAlpha(1);
      this.videoBg!.setVisible(false);
      await this.tween([this.flashOverlay!, this.afterTint!], { alpha: 0 }, 2000, 150);
      this.assertActive();
      heartbeat("flash-out");
      await this.tween(this.bgOverlay!, { alpha: 0 }, 250);
      this.assertActive();
      heartbeat("background-clear");
      await this.delay(250);
      this.assertActive();
      heartbeat("settled-form");
      this.after.cry();
      await this.delay(1250);
      this.assertActive();
      heartbeat("evolved-cry");
      globalScene.playSoundWithoutBgm("evolution_fanfare");
      await this.showTimedText(
        i18next.t("menu:evolutionDone", {
          pokemonName: getPokemonNameWithAffix(this.before),
          evolvedPokemonName: this.after.name,
        }),
        {
          callbackDelay: null,
          prompt: true,
          promptDelay: 4000,
        },
      );
      this.assertActive();
      heartbeat("completion-text");
    } finally {
      signal.removeEventListener("abort", abort);
      fadeOutSoundIfActive(globalScene, this.bgm);
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

  private showTimedText(
    text: string,
    {
      callbackDelay,
      prompt,
      promptDelay,
    }: {
      readonly callbackDelay: number | null;
      readonly prompt: boolean;
      readonly promptDelay?: number;
    },
  ): Promise<void> {
    return this.cancellable<void>(resolve => {
      globalScene.ui.showText(text, null, resolve, callbackDelay, prompt, promptDelay);
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
  /** Return false to keep a newly selected local successor parked until the ordered V2 callback activates. */
  private readonly onComplete: (succeeded: boolean) => boolean;
  private readonly onRetired: () => void;
  private readonly renderControllers = new Set<AbortController>();
  private completed = false;
  private presentationFailed = false;

  constructor(
    wave: number,
    events: readonly CoopWaveProgressionPresentationV2[],
    onComplete: (succeeded: boolean) => boolean,
    onRetired: () => void = () => undefined,
  ) {
    super();
    this.wave = wave;
    this.events = structuredClone(events);
    this.onComplete = onComplete;
    this.onRetired = onRetired;
  }

  public override start(): void {
    super.start();
    this.renderAll().catch(error => {
      this.presentationFailed = true;
      coopWarn("progression", `GUEST retained presentation batch failed wave=${this.wave}; releasing DATA`, error);
      this.finish();
    });
  }

  private async renderAll(): Promise<void> {
    coopLog("progression", `GUEST retained presentation start wave=${this.wave} events=${this.events.length}`);
    for (let seq = 0; seq < this.events.length; seq++) {
      if (this.completed) {
        return;
      }
      const event = this.events[seq];
      try {
        await this.withWatchdog(event, (signal, heartbeat) => this.render(event, signal, heartbeat));
        if (this.completed) {
          return;
        }
        observeCoopWaveProgressionPresentation({
          stage: "renderer-completed",
          wave: this.wave,
          seq,
          event,
        });
      } catch (error) {
        // Authoritative replacement retired this exact phase. Its cancellation is not a damaged cue, and
        // no later event from the discarded transaction may start against the newly installed control.
        if (this.isRetired()) {
          return;
        }
        const reason = error instanceof Error ? error.message : String(error);
        this.presentationFailed = true;
        observeCoopWaveProgressionPresentation({
          stage: "renderer-failed",
          wave: this.wave,
          seq,
          event,
          reason,
        });
        coopWarn("progression", `GUEST retained ${event.k} presentation failed; skipping cue`, error);
      }
    }
    this.finish();
  }

  private async withWatchdog(
    event: CoopWaveProgressionPresentationV2,
    render: (signal: AbortSignal, heartbeat: (stage: string) => void) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    this.renderControllers.add(controller);
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let watchdogFired = false;
    let lastProgressStage = "start";
    try {
      const watchdogMs = event.k === "evolution" ? EVOLUTION_STEP_WATCHDOG_MS : PROGRESSION_STEP_WATCHDOG_MS;
      const armWatchdog = (stage: string): void => {
        if (watchdogFired || controller.signal.aborted) {
          return;
        }
        if (timeout != null) {
          clearTimeout(timeout);
        }
        lastProgressStage = stage;
        if (event.k === "evolution" && stage !== "start") {
          coopLog(
            "progression",
            `GUEST retained evolution heartbeat wave=${this.wave} slot=${event.partySlot} stage=${stage}`,
          );
        }
        timeout = setTimeout(() => {
          watchdogFired = true;
          coopWarn(
            "progression",
            `GUEST retained ${event.k} presentation watchdog wave=${this.wave} slot=${event.partySlot} `
              + `stage=${lastProgressStage}`,
          );
          controller.abort();
          if (event.k !== "evolution") {
            globalScene.ui.setMode(UiMode.MESSAGE).catch(() => undefined);
            globalScene.partyExpBar.hide().catch(() => undefined);
          }
        }, watchdogMs);
      };
      armWatchdog("start");
      if (event.k === "evolution") {
        // Evolution owns cancellable timers, tweens, the recursive sprite cycle, mode restoration, and its
        // temporary Pokemon. Abort and JOIN that cleanup before WAVE_ADVANCE DATA may apply; unlike the
        // message/EXP APIs below, this renderer has a complete lifecycle contract and must not be detached.
        await render(controller.signal, armWatchdog);
        if (watchdogFired || controller.signal.aborted) {
          throw new CoopWaveProgressionPresentationCancelled("evolution-presentation-watchdog-expired");
        }
        return;
      }
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new CoopWaveProgressionPresentationCancelled(`${event.k}-presentation-retired`)),
          { once: true },
        );
      });
      await Promise.race([render(controller.signal, armWatchdog), aborted]);
      if (watchdogFired || controller.signal.aborted) {
        throw new CoopWaveProgressionPresentationCancelled(`${event.k}-presentation-watchdog-expired`);
      }
    } catch (error) {
      if (watchdogFired) {
        throw new CoopWaveProgressionPresentationCancelled(`${event.k}-presentation-watchdog-expired`);
      }
      if (controller.signal.aborted && !(error instanceof CoopWaveProgressionPresentationCancelled)) {
        throw new CoopWaveProgressionPresentationCancelled(
          watchdogFired ? `${event.k}-presentation-watchdog-expired` : `${event.k}-presentation-retired`,
        );
      }
      throw error;
    } finally {
      if (timeout != null) {
        clearTimeout(timeout);
      }
      this.renderControllers.delete(controller);
    }
  }

  private render(
    event: CoopWaveProgressionPresentationV2,
    signal: AbortSignal,
    heartbeat: (stage: string) => void,
  ): Promise<void> {
    const pokemon = this.resolvePokemon(event.partySlot, event.pokemonId);
    if (pokemon == null) {
      return Promise.reject(
        new Error(
          `retained-${event.k}-actor-missing-wave-${this.wave}-slot-${event.partySlot}-pokemon-${event.pokemonId}`,
        ),
      );
    }
    if (event.k === "exp") {
      return this.renderExp(pokemon, event, signal);
    }
    if (event.k === "levelUp") {
      return this.renderLevelUp(pokemon, event, signal);
    }
    return this.renderEvolution(pokemon, event, signal, heartbeat);
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
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(new CoopWaveProgressionPresentationCancelled("exp-presentation-retired"));
    }
    // These are host-stated result values, not a local EXP calculation. The complete wave image that follows
    // repeats and validates them as part of its atomic state application.
    pokemon.level = event.toLevel;
    pokemon.exp = event.toExp;

    if (event.display === "party") {
      return this.renderPartyExp(pokemon, event, signal);
    }

    const fastForward = globalScene.gameMode.isCoop && !globalScene.moveAnimations;
    return this.showAutoText(
      i18next.t("battle:expGain", {
        pokemonName: getPokemonNameWithAffix(pokemon),
        exp: event.expGain,
      }),
      fastForward ? 0 : null,
      signal,
      "exp-presentation-retired",
    ).then(async () => {
      if (signal.aborted) {
        throw new CoopWaveProgressionPresentationCancelled("exp-presentation-retired");
      }
      await pokemon.updateInfo(fastForward);
      if (signal.aborted) {
        throw new CoopWaveProgressionPresentationCancelled("exp-presentation-retired");
      }
    });
  }

  private async renderPartyExp(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "exp" }>,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      throw new CoopWaveProgressionPresentationCancelled("exp-presentation-retired");
    }
    // ShowPartyExpBarPhase never waits for the field EXP bar before advancing the party flyout. Waiting for a
    // non-instant update here is observably different: a level boundary can recurse through PlayerBattleInfo's
    // Phaser tween/delayedCall chain and, on a low-frame-rate replica, outlive this event's hard watchdog even
    // though the small party flyout is healthy. Install the immutable preimage instantly; the retained flyout
    // below remains the visible, lifecycle-owned presentation for this event.
    await pokemon.updateInfo(true);
    if (signal.aborted) {
      throw new CoopWaveProgressionPresentationCancelled("exp-presentation-retired");
    }
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
    if (signal.aborted) {
      throw new CoopWaveProgressionPresentationCancelled("exp-presentation-retired");
    }
    await globalScene.partyExpBar.hide();
  }

  private async renderLevelUp(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "levelUp" }>,
    signal: AbortSignal,
  ): Promise<void> {
    pokemon.level = event.toLevel;
    pokemon.stats = [...event.postStats];
    await pokemon.updateInfo();
    if (signal.aborted) {
      throw new CoopWaveProgressionPresentationCancelled("level-up-presentation-retired");
    }

    if (globalScene.expParty === ExpNotification.SKIP) {
      return Promise.resolve();
    }
    const promptStats = async (): Promise<void> => {
      if (signal.aborted) {
        throw new CoopWaveProgressionPresentationCancelled("level-up-presentation-retired");
      }
      const handler = globalScene.ui.getMessageHandler() as BattleMessageUiHandler;
      const completed = handler.promptLevelUpStats(event.partySlot, [...event.preStats], false, [...event.postStats]);
      if (globalScene.showLevelUpStats) {
        const fastForward = globalScene.gameMode.isCoop && !globalScene.moveAnimations;
        // The authority already received the human confirmations before it committed this immutable event.
        // Requiring the replica to confirm the same two stat panels creates an illegal second control owner:
        // V2 correctly freezes its public input while DATA is pending. Keep both visual panels, but advance
        // their presentation-only callbacks after a bounded dwell owned by this replay lifecycle.
        for (let panel = 0; panel < 2; panel++) {
          await this.presentationDelay(fastForward ? 0 : 750, signal, "level-up-presentation-retired");
          if (!handler.processInput(Button.ACTION)) {
            throw new Error(`retained level-up stat panel ${panel + 1} was not actionable`);
          }
        }
      }
      await completed;
    };
    if (globalScene.expParty !== ExpNotification.DEFAULT) {
      return promptStats();
    }
    globalScene.playSound("level_up_fanfare");
    return this.showAutoText(
      i18next.t("battle:levelUp", {
        pokemonName: getPokemonNameWithAffix(pokemon),
        level: event.toLevel,
      }),
      globalScene.gameMode.isCoop && !globalScene.moveAnimations ? 0 : null,
      signal,
      "level-up-presentation-retired",
    ).then(promptStats);
  }

  /** Show one replica-only narration line without opening a second human control lease. */
  private showAutoText(
    text: string,
    delay: number | null,
    signal: AbortSignal,
    cancellationReason: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => signal.removeEventListener("abort", abort);
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };
      const abort = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(new CoopWaveProgressionPresentationCancelled(cancellationReason));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      try {
        // `prompt=false` is load-bearing: this is a committed visual result, not fresh replica input.
        globalScene.ui.showText(text, delay, finish, null, false);
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
  }

  /** Runtime-wall delay fenced by the same AbortSignal that owns this presentation event. */
  private presentationDelay(duration: number, signal: AbortSignal, cancellationReason: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve();
      }, duration);
      const abort = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(new CoopWaveProgressionPresentationCancelled(cancellationReason));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
      }
    });
  }

  private async renderEvolution(
    pokemon: PlayerPokemon,
    event: Extract<CoopWaveProgressionPresentationV2, { k: "evolution" }>,
    signal: AbortSignal,
    heartbeat: (stage: string) => void,
  ): Promise<void> {
    const liveMatchesPreImage =
      pokemon.species.speciesId === event.fromSpeciesId
      && pokemon.formIndex === event.fromFormIndex
      && pokemon.getSpriteKey(true) === event.fromSpriteKey;
    const liveMatchesPostImage =
      pokemon.species.speciesId === event.toSpeciesId
      && pokemon.formIndex === event.toFormIndex
      && pokemon.getSpriteKey(true) === event.toSpriteKey;
    if (!liveMatchesPreImage && !liveMatchesPostImage) {
      throw new Error(
        `retained evolution live renderer matches neither committed image: actual=${pokemon.species.speciesId}/${pokemon.formIndex}/${pokemon.getSpriteKey(true)} expected=${event.fromSpeciesId}/${event.fromFormIndex}/${event.fromSpriteKey}|${event.toSpeciesId}/${event.toFormIndex}/${event.toSpriteKey}`,
      );
    }
    const rndState = Phaser.Math.RND.state();
    let before: PlayerPokemon | null = null;
    let evolved: PlayerPokemon | null = null;
    try {
      before = new PokemonData(event.prePokemon).toPokemon(undefined, event.partySlot) as PlayerPokemon;
      evolved = new PokemonData(event.postPokemon).toPokemon(undefined, event.partySlot) as PlayerPokemon;
    } catch (error) {
      before?.destroy();
      evolved?.destroy();
      throw error;
    } finally {
      Phaser.Math.RND.state(rndState);
    }
    if (before == null || evolved == null) {
      throw new Error("retained evolution images could not be reconstructed");
    }
    try {
      if (
        before.id !== event.pokemonId
        || before.species.speciesId !== event.fromSpeciesId
        || before.formIndex !== event.fromFormIndex
        || before.getSpriteKey(true) !== event.fromSpriteKey
      ) {
        throw new Error("retained evolution pre-image does not match its immutable party material");
      }
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
        `GUEST retained evolution start wave=${this.wave} slot=${event.partySlot} species=${event.fromSpeciesId}->${event.toSpeciesId} live=${liveMatchesPreImage ? "pre" : "post"}`,
      );
      await new CoopEvolutionPresentation(before, evolved).play(signal, heartbeat);
      coopLog(
        "progression",
        `GUEST retained evolution complete wave=${this.wave} slot=${event.partySlot} species=${event.fromSpeciesId}->${event.toSpeciesId}`,
      );
    } finally {
      before.destroy();
      evolved.destroy();
    }
  }

  private finish(): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    coopLog("progression", `GUEST retained presentation complete wave=${this.wave} events=${this.events.length}`);
    // Select the parked/queued boundary without starting it, then let the completion callback retry the exact
    // V2 entry. A buffered successor may atomically replace that selected shell; the scheduler detects that
    // replacement and never starts either the obsolete local tail or the projected modal twice.
    const shifted = globalScene.phaseManager.shiftPhaseThroughCoopAuthorityCommit(this, () =>
      this.onComplete(!this.presentationFailed),
    );
    if (!shifted) {
      if (globalScene.phaseManager.getCurrentPhase() === this) {
        coopWarn(
          "progression",
          `GUEST retained presentation could not close its exact scheduler boundary wave=${this.wave}`,
        );
      } else {
        coopLog("progression", `GUEST retained presentation parked its ordered successor wave=${this.wave}`);
      }
    }
  }

  /** Cancel detached UI work when recovery or a newer authority entry destructively replaces this phase. */
  public override retire(): void {
    if (this.isRetired()) {
      return;
    }
    const notifyRetired = !this.completed;
    // Fence end() before abort rejects the outstanding Promise.race and schedules its continuation.
    super.retire();
    this.completed = true;
    for (const controller of this.renderControllers) {
      controller.abort();
    }
    this.renderControllers.clear();
    globalScene.ui.setMode(UiMode.MESSAGE).catch(() => undefined);
    globalScene.partyExpBar.hide().catch(() => undefined);
    if (notifyRetired) {
      this.onRetired();
    }
  }
}
