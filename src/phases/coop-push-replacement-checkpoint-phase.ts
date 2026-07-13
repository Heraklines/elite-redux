/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { terminateCoopAuthoritySession } from "#data/elite-redux/coop/coop-authority-terminal";
import { captureCoopAuthoritativeCarrier } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { coopSessionGeneration, getCoopBattleStreamer, getCoopController } from "#data/elite-redux/coop/coop-runtime";

/**
 * Co-op (#633, the guest-faint deadlock): pushed by the HOST right after it auto-summons a
 * replacement into the PARTNER-owned fainted slot (switch-phase HALF B). Sends an OUT-OF-BAND
 * checkpoint so the guest materializes the replacement IMMEDIATELY instead of at the next
 * turn resolution - which can never arrive, because the host's next turn needs the guest's
 * command for the very mon the guest cannot see yet (the live "host just sent out a pokemon
 * without the guest choosing and now we were stuck" deadlock). The guest's live pump consumes
 * this checkpoint while parked and opens the guest's own CommandPhase for the refilled slot.
 * Runs AFTER the SwitchSummonPhase on the same queue level (FIFO), so the capture includes
 * the summoned mon. No-op on the guest / solo / with no live streamer.
 */
export class CoopPushReplacementCheckpointPhase extends Phase {
  public readonly phaseName = "CoopPushReplacementCheckpointPhase";

  public override start(): void {
    super.start();
    const streamer = getCoopBattleStreamer();
    const controller = getCoopController();
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const turn = globalScene.currentBattle?.turn ?? 0;
    const fatal = (reason: string): void => {
      if (streamer == null || controller == null) {
        terminateCoopAuthoritySession(reason);
        return;
      }
      const generation = coopSessionGeneration();
      void streamer
        .broadcastAuthorityFailure({
          epoch: controller.sessionEpoch,
          wave,
          turn,
          boundary: "replacement",
          reason,
        })
        .then(() => {
          if (generation === coopSessionGeneration()) {
            terminateCoopAuthoritySession(reason);
          }
        });
    };
    try {
      if (streamer != null && controller?.role === "host") {
        const carrier = captureCoopAuthoritativeCarrier(turn, "replacement");
        if (carrier == null) {
          coopWarn("checkpoint", "host could not capture complete replacement checkpoint");
          fatal(`Host could not capture replacement authority for wave ${wave}, turn ${turn}.`);
          return;
        }
        coopLog("checkpoint", "host push OUT-OF-BAND replacement checkpoint (partner-slot auto-summon)");
        streamer.sendCheckpoint(
          "replacement",
          controller.sessionEpoch,
          carrier.authoritativeState.wave,
          carrier.authoritativeState.turn,
          carrier.checkpoint,
          carrier.checksum,
          carrier.fullField,
          carrier.authoritativeState,
        );
      }
    } catch (error) {
      coopWarn("checkpoint", "replacement checkpoint push failed; carrier withheld", error);
      fatal(`Host could not publish replacement authority for wave ${wave}, turn ${turn}.`);
      return;
    }
    this.end();
  }
}
