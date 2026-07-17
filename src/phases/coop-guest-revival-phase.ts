/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_REVIVAL_SEQ_BASE, sendCoopRevivalChoice } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  armCoopRevivalIntentResend,
  type CoopRevivalOperationBinding,
  captureCoopRevivalOperationBinding,
} from "#data/elite-redux/coop/coop-revival-operation";
import { failCoopSharedSession, getCoopController, getCoopInteractionRelay } from "#data/elite-redux/coop/coop-runtime";
import { UiMode } from "#enums/ui-mode";
import { PartyUiHandler, PartyUiMode } from "#ui/handlers/party-ui-handler";

/**
 * Co-op (#809 revival owner-pick, the CoopGuestFaintSwitchPhase pattern): when the PARTNER's
 * mon uses Revival Blessing, the HOST's engine hits RevivalBlessingPhase but the pick belongs
 * to the mon's OWNER. The host sends a `revivalPrompt` and this phase opens the real
 * REVIVAL_BLESSING party picker on the owner's client, relaying the pick (with species
 * identity, #799) under `COOP_REVIVAL_SEQ_BASE + fieldIndex` - the seq the host awaits.
 * The pick is RELAY-ONLY: no local mutation - the revive materializes on this client via the
 * normal checkpoint, keeping the renderer mutation-free. If the player idles past the host's
 * wait, the host auto-picks and the late pick is ignored (stale seq) - the run never stalls.
 */
export class CoopGuestRevivalPhase extends Phase {
  public readonly phaseName = "CoopGuestRevivalPhase";

  private readonly fieldIndex: number;
  /** Re-entrant guard: a drive loop may call start() again while the picker is open. */
  private opened = false;

  constructor(fieldIndex: number) {
    super();
    this.fieldIndex = fieldIndex;
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
    let operationBinding: CoopRevivalOperationBinding;
    try {
      operationBinding = captureCoopRevivalOperationBinding("guest");
    } catch {
      failCoopSharedSession("The Revival Blessing picker lost its guest runtime binding.");
      this.end();
      return;
    }
    const seq = COOP_REVIVAL_SEQ_BASE + this.fieldIndex;
    coopLog("replay", `guest revival picker OPEN slot=${this.fieldIndex} seq=${seq} (choose who to revive)`);
    try {
      globalScene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.REVIVAL_BLESSING,
        this.fieldIndex,
        (slotIndex: number) => {
          if (slotIndex >= 0 && slotIndex < 6) {
            const pickedSpecies = globalScene.getPlayerParty()[slotIndex]?.species?.speciesId ?? 0;
            coopLog(
              "replay",
              `guest revival picker PICK slot=${this.fieldIndex} -> party[${slotIndex}] sp=${pickedSpecies} seq=${seq}`,
            );
            const data = [0, pickedSpecies];
            const wave = globalScene.currentBattle?.waveIndex ?? 0;
            const turn = globalScene.currentBattle?.turn ?? 0;
            sendCoopRevivalChoice(relay, this.fieldIndex, slotIndex, data);
            armCoopRevivalIntentResend(
              {
                payload: {
                  type: "decision",
                  fieldIndex: this.fieldIndex,
                  partySlot: slotIndex,
                  speciesId: pickedSpecies,
                },
                localRole: "guest",
                wave,
                turn,
                resend: () => sendCoopRevivalChoice(relay, this.fieldIndex, slotIndex, data),
              },
              operationBinding,
            );
          }
          void Promise.resolve(globalScene.ui.setMode(UiMode.MESSAGE)).then(() => this.end());
        },
        PartyUiHandler.FilterFainted,
      );
    } catch {
      // A UI failure must never hang the replay; the host auto-picks after its wait.
      coopWarn("replay", `guest revival picker slot=${this.fieldIndex} failed to open (handled, host auto-picks)`);
      this.end();
    }
  }
}
