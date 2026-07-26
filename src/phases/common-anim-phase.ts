import { globalScene } from "#app/global-scene";
import { CommonBattleAnim } from "#data/battle-anims";
import {
  type CoopPresentationOutcome,
  type CoopPresentationOutcomeToken,
  settleCoopPresentationOutcome,
} from "#data/elite-redux/coop/coop-presentation-outcome";
import { isCoopRecording, recordCoopEvent } from "#data/elite-redux/coop/coop-turn-recorder";
import type { BattlerIndex } from "#enums/battler-index";
import type { CommonAnim } from "#enums/move-anims-common";
import type { Pokemon } from "#field/pokemon";
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
  /** One queue insertion owns one immutable authority event, even if a phase is defensively re-queued. */
  private coopPresentationRecorded = false;

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

  /** Resolve the same concrete actors used by {@linkcode start}; never infer them again on the renderer. */
  private resolveAnimationParticipants(): { source: Pokemon; target: Pokemon } | null {
    const source = this.getPokemon();
    const target =
      this.targetIndex === undefined
        ? source
        : (this.player ? globalScene.getEnemyField() : globalScene.getPlayerField())[this.targetIndex];
    return source == null || target == null ? null : { source, target };
  }

  /**
   * Host queue-boundary tap for ordinary common VFX. Environment changes already have richer weather/terrain
   * events, while subclasses such as PokemonHealPhase own separate immutable HP presentation events; the
   * PhaseManager calls this only for an exact `CommonAnimPhase`.
   */
  public recordCoopPresentationAtEnqueue(): void {
    if (this.coopPresentationRecorded || this.coopPresentation != null || this.anim == null || !isCoopRecording()) {
      return;
    }
    let participants: { source: Pokemon; target: Pokemon } | null = null;
    try {
      participants = this.resolveAnimationParticipants();
    } catch {
      // The ordinary phase retains its existing fail-soft start behavior. A malformed/unaddressable cue is
      // not put on the wire because the renderer could not truthfully identify what the host intended.
      return;
    }
    if (participants == null) {
      return;
    }
    const { source, target } = participants;
    this.coopPresentationRecorded = true;
    recordCoopEvent({
      k: "commonAnim",
      anim: this.anim,
      bi: source.getBattlerIndex(),
      actor: { side: source.isPlayer() ? "player" : "enemy", pokemonId: source.id },
      targetBi: target.getBattlerIndex(),
      targetActor: { side: target.isPlayer() ? "player" : "enemy", pokemonId: target.id },
    });
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
      const participants = this.resolveAnimationParticipants();
      if (participants == null) {
        finish({ kind: "failed", reason: "environment-actor-not-displayed", actorFingerprint });
        return;
      }
      const { source, target } = participants;
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
