/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { captureCoopAuthoritativeCarrier } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { getCoopBattleStreamer, getCoopController } from "#data/elite-redux/coop/coop-runtime";

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
    try {
      const streamer = getCoopBattleStreamer();
      if (streamer != null && getCoopController()?.role === "host") {
        const carrier = captureCoopAuthoritativeCarrier(globalScene.currentBattle?.turn ?? 0, "replacement");
        if (carrier == null) {
          // Fail closed: the guest must not command a replacement reconstructed from only the numeric half.
          // A durable ACK/resend for this withheld boundary remains explicit protocol debt.
          coopWarn("checkpoint", "host withheld incomplete replacement checkpoint");
        } else {
          coopLog("checkpoint", "host push OUT-OF-BAND replacement checkpoint (partner-slot auto-summon)");
          streamer.sendCheckpoint(
            "replacement",
            carrier.checkpoint,
            carrier.checksum,
            carrier.fullField,
            carrier.authoritativeState,
          );
        }
      }
    } catch (error) {
      // Keep the host engine alive, but do not emit a partial frame or claim the guest can proceed.
      coopWarn("checkpoint", "replacement checkpoint push failed; carrier withheld", error);
    }
    this.end();
  }
}
