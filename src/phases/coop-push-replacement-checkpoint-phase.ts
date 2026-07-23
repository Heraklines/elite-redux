/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { isCoopV2ReplacementCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-replacement";
import { terminateCoopAuthoritySession } from "#data/elite-redux/coop/coop-authority-terminal";
import { captureCoopAuthoritativeCarrier } from "#data/elite-redux/coop/coop-battle-engine";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  commitCoopV2ReplacementAuthority,
  coopSessionGeneration,
  getCoopBattleStreamer,
  getCoopController,
} from "#data/elite-redux/coop/coop-runtime";

/**
 * Co-op (#633, the guest-faint deadlock): pushed by the HOST right after it auto-summons a
 * replacement into a fainted slot (switch-phase HALF B). In Authority V2, every completed
 * summon seals one REPLACEMENT_COMMIT: an intermediate image installs the next ordered picker,
 * while the final image installs the command frontier. In rollback mode it sends the legacy
 * OUT-OF-BAND checkpoint so the guest materializes the replacement before the next turn.
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
        // Every completed summon is now its own immutable V2 transaction. Capturing the intermediate field
        // is intentional: its entry installs the next addressed replacement picker, so no later seat must
        // choose before the log authorizes it. The final summon then carries the fully-refilled field and
        // command frontier. Legacy/non-cutover sessions still use the original single checkpoint carrier.
        if (!isCoopV2ReplacementCutoverActive()) {
          const partySlotStillFainted = globalScene
            .getPlayerField()
            .some(mon => mon == null || mon.isActive() !== true);
          const anotherReplacementPending =
            globalScene.phaseManager.hasPhaseOfType("SwitchPhase")
            || globalScene.phaseManager.hasPhaseOfType("SwitchSummonPhase");
          if (partySlotStillFainted && anotherReplacementPending) {
            coopLog("checkpoint", "legacy replacement capture deferred until every pending summon completes");
            this.end();
            return;
          }
        }
        const carrier = captureCoopAuthoritativeCarrier(turn, "replacement");
        if (carrier == null) {
          coopWarn("checkpoint", "host could not capture complete replacement checkpoint");
          fatal(`Host could not capture replacement authority for wave ${wave}, turn ${turn}.`);
          return;
        }
        const v2 = commitCoopV2ReplacementAuthority(
          {
            checkpoint: carrier.checkpoint,
            checksum: carrier.checksum,
            preimage: carrier.preimage,
            fullField: carrier.fullField,
            authoritativeState: carrier.authoritativeState,
            epoch: controller.sessionEpoch,
            wave: carrier.authoritativeState.wave,
            turn: carrier.authoritativeState.turn,
          },
          { mysteryBattle: globalScene.currentBattle?.isBattleMysteryEncounter() === true },
        );
        if (v2?.kind === "committed") {
          coopLog(
            "v2-replacement",
            `host committed ${v2.entries.length} complete post-summon replacement entr${v2.entries.length === 1 ? "y" : "ies"}`,
          );
          this.end();
          return;
        }
        if (v2?.kind === "failed-clean") {
          fatal(
            `Authority V2 replacement commit failed for wave ${wave}, turn ${turn}; `
              + "refusing a second legacy authority.",
          );
          return;
        }
        if (v2?.kind === "no-pending") {
          fatal(
            `Authority V2 replacement carrier had no address-exact staged result for wave ${wave}, turn ${turn}; `
              + "refusing an unlogged compatibility checkpoint.",
          );
          return;
        }
        // `null` means this session is not cut over. Only rollback/legacy mode may retain and send the
        // compatibility checkpoint outside the global V2 log.
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
