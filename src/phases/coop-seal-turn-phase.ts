/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { terminateCoopAuthoritySession } from "#data/elite-redux/coop/coop-authority-terminal";
import { captureCoopAuthoritativeCarrier } from "#data/elite-redux/coop/coop-battle-engine";
import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  coopSessionGeneration,
  getCoopBattleStreamer,
  getCoopController,
  isAuthoritativeBattleSession,
} from "#data/elite-redux/coop/coop-runtime";
import { endCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";

/**
 * Root-level host-authoritative post-turn seal. The phase manager pre-enqueues this immediately after
 * {@linkcode TurnEndPhase}; because it remains at the root, TurnEnd's entire child/deferred subtree drains
 * first. The immutable carrier therefore includes terrain/biome healing, modifier and ability work, nested
 * scripted moves, faint/victory/replacement tails, and every state mutation they enqueue.
 *
 * The turn number comes from the recording opened at TurnStart. TurnEnd has already incremented the ambient
 * battle turn by the time this phase runs. A missing/incomplete carrier fails closed and leaves progression
 * parked while the shared terminal contract tears down both peers coherently.
 */
export class CoopSealTurnPhase extends Phase {
  public readonly phaseName = "CoopSealTurnPhase";

  public override start(): void {
    super.start();
    const recording = endCoopRecording();

    // Solo and lockstep still pass through this root sentinel, but have no authoritative publisher. The
    // recorder close above is the only effect. Showdown-versus intentionally shares the authoritative seam.
    if (!isAuthoritativeBattleSession()) {
      this.end();
      return;
    }

    const controller = getCoopController();
    const streamer = getCoopBattleStreamer();
    if (controller == null || streamer == null || controller.role !== "host" || recording.turn < 0) {
      this.end();
      return;
    }

    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const fatal = (reason: string): void => {
      const generation = coopSessionGeneration();
      void streamer
        .broadcastAuthorityFailure({
          epoch: controller.sessionEpoch,
          wave,
          turn: recording.turn,
          boundary: "turnResolution",
          reason,
        })
        .then(() => {
          if (generation === coopSessionGeneration()) {
            terminateCoopAuthoritySession(reason);
          }
        });
    };

    try {
      const carrier = captureCoopAuthoritativeCarrier(recording.turn, "turnResolution");
      if (carrier == null) {
        coopWarn("checkpoint", `host could not capture complete turnResolution turn=${recording.turn}`);
        fatal(`Host could not capture complete turn authority for wave ${wave}, turn ${recording.turn}.`);
        return;
      }
      streamer.emitTurn(
        controller.sessionEpoch,
        carrier.authoritativeState.wave,
        recording.turn,
        recording.events,
        carrier.checkpoint,
        carrier.checksum,
        carrier.preimage,
        carrier.fullField,
        carrier.authoritativeState,
      );
    } catch (error) {
      coopWarn("checkpoint", `host failed to emit turnResolution turn=${recording.turn}`, error);
      fatal(`Host could not publish complete turn authority for wave ${wave}, turn ${recording.turn}.`);
      return;
    }
    this.end();
  }
}
