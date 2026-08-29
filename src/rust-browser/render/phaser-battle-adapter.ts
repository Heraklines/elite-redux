import type Phaser from "phaser";
import { decodeBrowserPresentationCue, type PresentationSettlementOutcomeV1 } from "./reference-presentation-view";

interface BattleCueDetailV1 {
  pokemon?: number;
  before?: number;
  after?: number;
}

export class PhaserBattleAdapterV1 {
  readonly #scene: Phaser.Scene;
  readonly #actors = new Map<number, Phaser.GameObjects.Sprite>();
  #generation = 0;
  #disposed = false;

  constructor(scene: Phaser.Scene) {
    this.#scene = scene;
  }

  registerActor(pokemonId: number, sprite: Phaser.GameObjects.Sprite): void {
    if (this.#disposed || !Number.isSafeInteger(pokemonId) || pokemonId <= 0) {
      throw new Error("Phaser Rust battle actor registration is invalid");
    }
    this.#actors.set(pokemonId, sprite);
  }

  removeActor(pokemonId: number): void {
    this.#actors.delete(pokemonId);
  }

  async present(bytes: Uint8Array): Promise<PresentationSettlementOutcomeV1> {
    if (this.#disposed) {
      return "FAILED";
    }
    const cue = decodeBrowserPresentationCue(bytes);
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { detail?: BattleCueDetailV1 };
    const actor = raw.detail?.pokemon == null ? null : (this.#actors.get(raw.detail.pokemon) ?? null);
    const generation = ++this.#generation;
    try {
      if (cue.kind === "BATTLE_WON" || cue.kind === "BATTLE_LOST") {
        this.#scene.cameras.main.flash(
          180,
          cue.kind === "BATTLE_WON" ? 255 : 160,
          255,
          cue.kind === "BATTLE_WON" ? 255 : 160,
        );
        return await this.#wait(180, generation);
      }
      if (actor == null) {
        return cue.blocking_policy === "NON_BLOCKING" ? "INTENTIONALLY_SKIPPED" : "FAILED";
      }
      if (cue.kind === "FAINTED") {
        return await this.#tween(actor, { alpha: 0, y: actor.y + 24, duration: 180 }, generation);
      }
      if (cue.kind === "SWITCHED") {
        actor.setAlpha(0);
        return await this.#tween(actor, { alpha: 1, duration: 180 }, generation);
      }
      if (cue.kind === "HP_CHANGED") {
        actor.setTintFill(0xffffff);
        const outcome = await this.#wait(80, generation);
        actor.clearTint();
        return outcome;
      }
      return await this.#tween(
        actor,
        { scaleX: actor.scaleX * 1.08, scaleY: actor.scaleY * 1.08, yoyo: true, duration: 90 },
        generation,
      );
    } catch {
      return "FAILED";
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#generation += 1;
    this.#actors.clear();
  }

  #wait(duration: number, generation: number): Promise<PresentationSettlementOutcomeV1> {
    const { promise, resolve } = Promise.withResolvers<PresentationSettlementOutcomeV1>();
    this.#scene.time.delayedCall(duration, () => {
      resolve(!this.#disposed && generation === this.#generation ? "SETTLED" : "FAILED");
    });
    return promise;
  }

  #tween(
    target: Phaser.GameObjects.Sprite,
    config: Phaser.Types.Tweens.TweenBuilderConfig,
    generation: number,
  ): Promise<PresentationSettlementOutcomeV1> {
    const { promise, resolve } = Promise.withResolvers<PresentationSettlementOutcomeV1>();
    this.#scene.tweens.add({
      targets: target,
      ...config,
      onComplete: () => resolve(!this.#disposed && generation === this.#generation ? "SETTLED" : "FAILED"),
    });
    return promise;
  }
}
