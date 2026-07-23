import { globalScene } from "#app/global-scene";
import { CommonBattleAnim } from "#data/battle-anims";
import type { BattlerIndex } from "#enums/battler-index";
import type { CommonAnim } from "#enums/move-anims-common";
import { PokemonPhase } from "#phases/pokemon-phase";

export interface CommonAnimPresentationTag {
  readonly source: "environment";
  readonly kind: "weather" | "terrain";
  readonly value: number;
}

export class CommonAnimPhase extends PokemonPhase {
  // PokemonHealPhase extends CommonAnimPhase, and to make typescript happy,
  // we need to allow phaseName to be a union of the two
  public readonly phaseName: "CommonAnimPhase" | "PokemonHealPhase" | "WeatherEffectPhase" = "CommonAnimPhase";
  private anim: CommonAnim | null;
  private readonly targetIndex: BattlerIndex | undefined;
  public readonly coopPresentation: CommonAnimPresentationTag | undefined;

  // TODO: Why can common anim be null?
  // TODO: Pass in pokemon directly instead of operating with unsafe indices
  constructor(
    battlerIndex?: BattlerIndex,
    targetIndex?: BattlerIndex,
    anim: CommonAnim | null = null,
    coopPresentation?: CommonAnimPresentationTag,
  ) {
    super(battlerIndex);

    this.anim = anim;
    this.targetIndex = targetIndex;
    this.coopPresentation = coopPresentation;
  }

  setAnimation(anim: CommonAnim) {
    this.anim = anim;
  }

  /** Read-only presentation identity used by the sealed two-browser oracle. */
  public getAnimationId(): CommonAnim | null {
    return this.anim;
  }

  start() {
    const target =
      this.targetIndex === undefined
        ? this.getPokemon()
        : (this.player ? globalScene.getEnemyField() : globalScene.getPlayerField())[this.targetIndex];

    // Elite Redux — a common/weather animation must NEVER be able to hang the
    // phase queue, which freezes the whole game. Two failure modes are guarded:
    //   1. play() throws synchronously while starting the anim — e.g. an ER
    //      custom anim (eerie-fog) that builds a tileSprite from a texture that
    //      somehow isn't loaded. The try/catch ends the phase instead of
    //      leaving the queue stalled forever.
    //   2. play()'s completion callback never fires (a stalled tween chain).
    //      A generous watchdog ends the phase so battle can continue. Common
    //      anims run well under a second, so a multi-second timeout only ever
    //      trips on a genuine hang — it never cuts a legitimate animation short.
    // `ended` guards against the watchdog and the real callback both firing.
    let ended = false;
    let watchdog: Phaser.Time.TimerEvent | undefined;
    const finish = () => {
      if (ended) {
        return;
      }
      ended = true;
      watchdog?.remove();
      this.end();
    };
    watchdog = globalScene.time.delayedCall(5000, finish);
    try {
      new CommonBattleAnim(this.anim, this.getPokemon(), target).play(false, finish);
    } catch (err) {
      console.error(`[ER] CommonAnimPhase: anim ${this.anim} failed to play; ending phase to avoid a freeze`, err);
      finish();
    }
  }
}
