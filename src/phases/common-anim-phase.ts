import { globalScene } from "#app/global-scene";
import { CommonBattleAnim } from "#data/battle-anims";
import {
  type CoopPresentationOutcome,
  type CoopPresentationOutcomeToken,
  settleCoopPresentationOutcome,
} from "#data/elite-redux/coop/coop-presentation-outcome";
import type { BattlerIndex } from "#enums/battler-index";
import type { CommonAnim } from "#enums/move-anims-common";
import {
  armCoopPresentationProgressWatchdog,
  type CoopPresentationProgressWatchdog,
} from "#phases/coop-presentation-watchdog";
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
    private readonly coopPresentationOutcomeToken?: CoopPresentationOutcomeToken,
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
    let watchdog: CoopPresentationProgressWatchdog | undefined;
    const actorFingerprint =
      this.coopPresentation == null
        ? `environment:unknown:anim${this.anim ?? "none"}`
        : `${this.coopPresentation.kind}:${this.coopPresentation.value}:anim${this.anim ?? "none"}`;
    const finish = (outcome: CoopPresentationOutcome) => {
      if (ended) {
        return;
      }
      ended = true;
      watchdog?.remove();
      if (this.coopPresentationOutcomeToken != null) {
        settleCoopPresentationOutcome(this.coopPresentationOutcomeToken, outcome);
      }
      this.end();
    };
    if (this.coopPresentationOutcomeToken != null && !globalScene.moveAnimations) {
      finish({ kind: "intentionally-skipped", reason: "animations-disabled", actorFingerprint });
      return;
    }
    try {
      const source = this.getPokemon();
      const target =
        this.targetIndex === undefined
          ? source
          : (this.player ? globalScene.getEnemyField() : globalScene.getPlayerField())[this.targetIndex];
      watchdog = armCoopPresentationProgressWatchdog(() =>
        finish({ kind: "failed", reason: "environment-watchdog-expired", actorFingerprint }),
      );
      new CommonBattleAnim(this.anim, source, target).play(false, () => finish({ kind: "rendered", actorFingerprint }));
    } catch (err) {
      console.error(`[ER] CommonAnimPhase: anim ${this.anim} failed to play; ending phase to avoid a freeze`, err);
      finish({ kind: "failed", reason: "environment-presentation-threw", actorFingerprint });
    }
  }
}
