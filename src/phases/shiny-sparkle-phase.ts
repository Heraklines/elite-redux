import { globalScene } from "#app/global-scene";
import type { BattlerIndex } from "#enums/battler-index";
import { PokemonPhase } from "#phases/pokemon-phase";

export class ShinySparklePhase extends PokemonPhase {
  public readonly phaseName = "ShinySparklePhase";
  // biome-ignore lint/complexity/noUselessConstructor: This makes `battlerIndex` required
  constructor(battlerIndex: BattlerIndex) {
    super(battlerIndex);
  }

  start() {
    super.start();

    // Null-safe (showdown guest launch 2026-07-08): on the versus guest the streamed launch can
    // queue a sparkle for a battler slot whose mon isn't registered on the local field yet -
    // skip the cosmetic instead of crashing the whole launch. No-op change when resolved.
    const pokemon = this.getPokemon();
    if (pokemon == null) {
      this.end();
      return;
    }
    pokemon.sparkle();
    globalScene.time.delayedCall(1000, () => this.end());
  }
}
