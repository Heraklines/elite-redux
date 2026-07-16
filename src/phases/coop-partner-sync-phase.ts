/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { getCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { getCoopController, getCoopRuntime } from "#data/elite-redux/coop/coop-runtime";

/**
 * Co-op LOCKSTEP GATE (#788 v2): BLOCKS this client's phase queue after it finishes an
 * alternating interaction (reward shop, ME, ...) until the PARTNER'S broadcast interaction
 * counter catches up - i.e. until they finished the same menu too. The v1 barrier only
 * deferred the next wave's DATA; the finishing player's own SCREEN still ran ahead ("you can
 * continue far ahead and then they have to go through the shop or the shop is gone"). This
 * phase makes the wait visible and real: "Waiting for <partner>...". The timeout is a replay
 * cadence, not an escape hatch: the boundary remains closed until the peer confirms the counter.
 */
export class CoopPartnerSyncPhase extends Phase {
  public readonly phaseName = "CoopPartnerSyncPhase";

  /** Re-entrant guard: harness drives re-call start() on unfinished phases. */
  private waiting = false;

  public override start(): void {
    super.start();
    if (this.waiting) {
      return;
    }
    const controller = getCoopController();
    if (controller == null || !globalScene.gameMode.isCoop) {
      this.end();
      return;
    }
    // Hotseat / SpoofGuest: no real partner to wait for - the gate is meaningless, skip.
    if (getCoopRuntime()?.spoof != null) {
      this.end();
      return;
    }
    const target = controller.interactionCounter();
    if (controller.partnerInteractionCounterSeen() >= target) {
      this.end();
      return;
    }
    this.waiting = true;
    coopLog("interaction", `partner-sync gate: waiting for partner to reach counter=${target}`);
    try {
      globalScene.ui.showText(`Waiting for ${controller.partnerName ?? "your partner"}...`);
    } catch {
      /* cosmetic */
    }
    void controller.awaitPartnerInteraction(getCoopWaveBarrierMs()).then(caughtUp => {
      if (!caughtUp) {
        coopWarn(
          "interaction",
          `partner-sync gate: counter=${target} recovery exhausted/aborted - phase remains closed for shared terminal`,
        );
        return;
      }
      coopLog("interaction", `partner-sync gate: partner reached counter=${target} -> proceed`);
      this.end();
    });
  }
}
