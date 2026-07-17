/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  COOP_FAINT_SWITCH_RESOLUTION_OWNER,
  type CoopFaintSourceAddress,
  addressCoopFaintSwitchChoiceData,
  armCoopFaintSwitchIntentResend,
  captureCoopFaintSwitchOperationBinding,
  markCoopFaintSwitchPickerSettled,
  registerCoopFaintSwitchPickerTerminal,
} from "#data/elite-redux/coop/coop-faint-switch-operation";
import {
  beginCoopFaintSwitchWindow,
  COOP_FAINT_SWITCH_SEQ_BASE,
  endCoopFaintSwitchWindow,
  sendCoopFaintSwitchChoice,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  coopSessionGeneration,
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { UiMode } from "#enums/ui-mode";
import { PartyUiHandler, PartyUiMode } from "#ui/handlers/party-ui-handler";

/**
 * Co-op (#786): the GUEST chooses its OWN replacement after its mon faints. Unshifted by
 * {@linkcode CoopFaintReplayPhase} when the presented faint hit a GUEST-OWNED player slot
 * with a legal bench. Opens the real FAINT_SWITCH party picker and relays the pick over the
 * interaction relay under the same `turn*4+fieldIndex` seq the host's SwitchPhase awaits -
 * so the HOST summons the guest's choice instead of auto-picking ("the host just sent out
 * a pokemon without the guest choosing"). The pick is RELAY-ONLY: no local summon - the
 * host's out-of-band replacement checkpoint (CoopPushReplacementCheckpointPhase) is what
 * materializes the mon on the guest, keeping the renderer mutation-free.
 *
 * If the player idles past the host's bounded wait, the retained
 * FAINT_SWITCH terminal closes this picker before the host's authoritative replacement projects.
 */
export class CoopGuestFaintSwitchPhase extends Phase {
  public readonly phaseName = "CoopGuestFaintSwitchPhase";

  private readonly fieldIndex: number;
  private readonly faintSourceAddress: CoopFaintSourceAddress | undefined;
  /** Re-entrant guard: a drive loop may call start() again while the picker is open. */
  private opened = false;

  constructor(fieldIndex: number, faintSourceAddress?: CoopFaintSourceAddress) {
    super();
    this.fieldIndex = fieldIndex;
    this.faintSourceAddress = faintSourceAddress;
  }

  public override start(): void {
    super.start();
    if (this.opened) {
      return;
    }
    this.opened = true;
    const controller = getCoopController();
    const relay = getCoopInteractionRelay();
    if (controller == null || relay == null) {
      this.end();
      return;
    }
    const scene = globalScene;
    const operationBinding = (() => {
      try {
        return captureCoopFaintSwitchOperationBinding("guest");
      } catch (error) {
        coopWarn("replay", "guest own-faint picker could not bind its runtime", error);
        failCoopSharedSession("The replacement picker lost its co-op runtime binding.");
        return null;
      }
    })();
    if (operationBinding == null) {
      return;
    }
    const seq = COOP_FAINT_SWITCH_SEQ_BASE + this.fieldIndex;
    const sourceAddress = this.faintSourceAddress ?? {
      wave: scene.currentBattle?.waveIndex ?? 0,
      turn: scene.currentBattle?.turn ?? 0,
      occurrence: 0,
    };
    const { wave: sourceWave, turn: sourceTurn, occurrence } = sourceAddress;
    const runtime = getCoopRuntime();
    const sourceGeneration = coopSessionGeneration();
    const phaseBoundary = {
      wave: scene.currentBattle?.waveIndex ?? 0,
      turn: scene.currentBattle?.turn ?? 0,
    };
    if (runtime == null) {
      failCoopSharedSession("The replacement picker lost its active runtime.");
      return;
    }
    const boundaryStillLive = (): boolean =>
      coopSessionGeneration() === sourceGeneration
      && getCoopRuntime() === runtime
      && scene.phaseManager.getCurrentPhase() === this
      && (scene.currentBattle?.waveIndex ?? -1) === phaseBoundary.wave
      && (scene.currentBattle?.turn ?? -1) === phaseBoundary.turn;
    coopLog("replay", `guest own-faint picker OPEN slot=${this.fieldIndex} seq=${seq} (choose your replacement)`);
    // Suppress the stall watchdog while THIS human's replacement picker is open: the guest's replay is
    // parked in a network wait for the host's next turn (which legitimately can't arrive until this pick),
    // so the mutual-wait watchdog would otherwise misread the deliberation as a deadlock ~20s in and pull a
    // stateSync. Paired 1:1 with endCoopFaintSwitchWindow on pick (the select callback) or on an open
    // failure (the catch) - exactly one of the two runs.
    beginCoopFaintSwitchWindow();
    let settled = false;
    let materialized = false;
    let unregisterTerminal = () => {};
    const closePicker = (): void => {
      void scene.ui.setModeBoundedWhen(UiMode.MESSAGE, 2_000, boundaryStillLive).then(result => {
        if (coopSessionGeneration() !== sourceGeneration) {
          return;
        }
        if (result === "superseded" || !boundaryStillLive()) {
          failCoopSharedSession("The replacement picker lost its exact material boundary while closing.");
          return;
        }
        scene.phaseManager.shiftPhase();
        materialized = true;
        markCoopFaintSwitchPickerSettled(sourceWave, sourceTurn, this.fieldIndex, operationBinding, occurrence);
      });
    };
    unregisterTerminal = registerCoopFaintSwitchPickerTerminal(
      {
        wave: sourceWave,
        turn: sourceTurn,
        occurrence,
        fieldIndex: this.fieldIndex,
        consume: (payload, operationId) => {
          if (settled) {
            return materialized;
          }
          settled = true;
          endCoopFaintSwitchWindow();
          coopLog(
            "replay",
            `guest own-faint picker CLOSE from committed authority slot=${this.fieldIndex} `
              + `party[${payload.partySlot}] op=${operationId}`,
          );
          // Keep the durability operation unacknowledged until the real modal transition and phase
          // shift have completed. Its retry will observe the exact settled address and ACK then.
          closePicker();
          return false;
        },
      },
      operationBinding,
    );
    try {
      scene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.FAINT_SWITCH,
        this.fieldIndex,
        (slotIndex: number) => {
          if (settled) {
            return;
          }
          settled = true;
          unregisterTerminal();
          endCoopFaintSwitchWindow();
          const battlerCount = scene.currentBattle?.getBattlerCount() ?? 0;
          const picked = scene.getPlayerParty()[slotIndex];
          // DEFENSIVE guard (guest-faint desync, seed EW0gvphu5Ps8dmWDaUKqgr8x): never RELAY a bench
          // mon this client's LOCAL state believes is FAINTED (hp<=0 or not battle-allowed). The
          // FAINT_SWITCH picker already filters fainted mons, but a party-state desync (a stale bench
          // hp / mis-ordered slot) could surface a locally-dead mon; relaying it would have the host
          // summon a mon the guest then renders instantly-KO'd + re-open this picker in a loop. On a
          // bad pick, RELAY NOTHING - the host auto-picks a legal replacement after its wait, so the
          // run never stalls, and the guest converges on the host's authoritative summon.
          const pickLegal =
            slotIndex >= battlerCount && slotIndex < 6 && picked != null && picked.hp > 0 && picked.isAllowedInBattle();
          if (pickLegal) {
            coopLog("replay", `guest own-faint picker PICK slot=${this.fieldIndex} -> party[${slotIndex}] seq=${seq}`);
            // #799 (Wingull/Chinchou wrong-mon summon): carry the picked mon's SPECIES so the
            // host can resolve the pick by IDENTITY when the two clients' party orders have
            // diverged (a blind slot index summons a DIFFERENT mon on the other engine).
            const pickedSpecies = picked.species?.speciesId ?? 0;
            const data = addressCoopFaintSwitchChoiceData(
              [0, pickedSpecies],
              {
                wave: sourceWave,
                turn: sourceTurn,
                occurrence,
                fieldIndex: this.fieldIndex,
                partySlot: slotIndex,
                resolution: COOP_FAINT_SWITCH_RESOLUTION_OWNER,
              },
              operationBinding,
            );
            sendCoopFaintSwitchChoice(relay, this.fieldIndex, slotIndex, data);
            armCoopFaintSwitchIntentResend(
              {
                payload: { fieldIndex: this.fieldIndex, partySlot: slotIndex, data },
                localRole: controller.role,
                wave: sourceWave,
                turn: sourceTurn,
                occurrence,
                resend: () => sendCoopFaintSwitchChoice(relay, this.fieldIndex, slotIndex, data),
              },
              operationBinding,
            );
          } else if (slotIndex >= battlerCount && slotIndex < 6) {
            coopWarn(
              "replay",
              `guest own-faint picker slot=${this.fieldIndex} -> party[${slotIndex}] is locally fainted/illegal `
                + `(hp=${picked?.hp ?? "-"}) -> NOT relayed, host auto-picks (guard)`,
            );
          }
          closePicker();
        },
        PartyUiHandler.FilterNonFainted,
      );
    } catch {
      // A UI failure must never hang the guest's replay; the host auto-picks after its wait.
      endCoopFaintSwitchWindow();
      unregisterTerminal();
      coopWarn("replay", `guest own-faint picker slot=${this.fieldIndex} failed to open (handled, host auto-picks)`);
      if (!boundaryStillLive()) {
        failCoopSharedSession("The replacement picker failed after losing its exact phase boundary.");
        return;
      }
      scene.phaseManager.shiftPhase();
      materialized = true;
      markCoopFaintSwitchPickerSettled(sourceWave, sourceTurn, this.fieldIndex, operationBinding, occurrence);
    }
  }
}
