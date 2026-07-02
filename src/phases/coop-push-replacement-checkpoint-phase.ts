/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Phase } from "#app/phase";
import { captureCoopCheckpoint, captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
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
        const checkpoint = captureCoopCheckpoint();
        if (checkpoint != null) {
          coopLog("checkpoint", "host push OUT-OF-BAND replacement checkpoint (partner-slot auto-summon)");
          streamer.sendCheckpoint("replacement", checkpoint, captureCoopChecksum());
        }
      }
    } catch {
      // Best-effort: a capture/send failure must never hang the host's flow; the guest
      // still heals on the next turn resolution's checkpoint.
      coopWarn("checkpoint", "replacement checkpoint push failed (handled)");
    }
    this.end();
  }
}
