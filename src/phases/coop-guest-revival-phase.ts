/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import {
  COOP_REVIVAL_SEQ_BASE,
  getCoopFaintSwitchWaitMs,
  sendCoopRevivalChoice,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  armCoopRevivalIntentResend,
  type CoopRevivalOperationBinding,
  captureCoopRevivalOperationBinding,
  coopRevivalDecisionOperationId,
  coopRevivalOperationId,
  isCoopRevivalAuthorityV2Active,
} from "#data/elite-redux/coop/coop-revival-operation";
import {
  failCoopSharedSession,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  notifyCoopV2InteractionSurfaceReady,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_REVIVAL_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { UiMode } from "#enums/ui-mode";
import { PartyUiHandler, PartyUiMode } from "#ui/handlers/party-ui-handler";

/**
 * Queue-owned Revival Blessing surface on the guest. A guest-owned prompt opens the real interactive
 * picker and relays its intent; a host-owned prompt opens the same public screen read-only and only the
 * exact immutable decision derived from that prompt may close it. Neither path mutates battle state.
 */
export class CoopGuestRevivalPhase extends Phase {
  public readonly phaseName = "CoopGuestRevivalPhase";
  public coopV2ControlOperationId: string | null;

  private readonly fieldIndex: number;
  private readonly ownerIsGuest: boolean;
  private readonly coopOwningRuntime = getCoopRuntime();
  /** Re-entrant guard: a drive loop may call start() again while the picker is open. */
  private opened = false;

  constructor(fieldIndex: number, operationId?: string, ownerIsGuest = true) {
    super();
    this.fieldIndex = fieldIndex;
    this.coopV2ControlOperationId = operationId ?? null;
    this.ownerIsGuest = ownerIsGuest;
  }

  /** Idempotently bind a redelivered prompt to this exact override-phase generation. */
  public installCoopV2RevivalPresentation(operationId: string, fieldIndex: number, ownerIsGuest: boolean): boolean {
    if (
      fieldIndex !== this.fieldIndex
      || ownerIsGuest !== this.ownerIsGuest
      || operationId.length === 0
      || (this.coopV2ControlOperationId != null && this.coopV2ControlOperationId !== operationId)
    ) {
      return false;
    }
    this.coopV2ControlOperationId = operationId;
    notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
    return true;
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
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const turn = globalScene.currentBattle?.turn ?? 0;
    coopLog(
      "replay",
      `guest revival ${this.ownerIsGuest ? "picker" : "watcher"} OPEN slot=${this.fieldIndex} seq=${seq}`,
    );
    try {
      const mode = globalScene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.REVIVAL_BLESSING,
        this.fieldIndex,
        (slotIndex: number) => {
          if (!this.ownerIsGuest) {
            return;
          }
          if (slotIndex >= 0 && slotIndex < 6) {
            const pickedSpecies = globalScene.getPlayerParty()[slotIndex]?.species?.speciesId ?? 0;
            coopLog(
              "replay",
              `guest revival picker PICK slot=${this.fieldIndex} -> party[${slotIndex}] sp=${pickedSpecies} seq=${seq}`,
            );
            const data = [0, pickedSpecies];
            const decisionPayload = {
              type: "decision" as const,
              fieldIndex: this.fieldIndex,
              partySlot: slotIndex,
              speciesId: pickedSpecies,
            };
            sendCoopRevivalChoice(relay, this.fieldIndex, slotIndex, data);
            armCoopRevivalIntentResend(
              {
                payload: decisionPayload,
                localRole: "guest",
                wave,
                turn,
                resend: () => sendCoopRevivalChoice(relay, this.fieldIndex, slotIndex, data),
              },
              operationBinding,
            );
            settleCoopV2InteractionOperation(
              coopRevivalOperationId(decisionPayload, wave, turn, "guest", operationBinding),
              this.coopOwningRuntime,
            );
          }
          void Promise.resolve(globalScene.ui.setMode(UiMode.MESSAGE)).then(() => this.end());
        },
        PartyUiHandler.FilterFainted,
      );
      Promise.resolve(mode).then(() => {
        notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime);
        if (!this.ownerIsGuest) {
          void this.awaitHostOwnedDecision(relay, operationBinding, seq);
        }
      });
    } catch {
      coopWarn("replay", `guest revival surface slot=${this.fieldIndex} failed to open`);
      if (isCoopRevivalAuthorityV2Active(operationBinding)) {
        failCoopSharedSession(`Revival Blessing surface for slot ${this.fieldIndex} could not open`);
      }
      this.end();
    }
  }

  /** Host-owned prompt: remain read-only until the exact immutable result closes this watcher. */
  private async awaitHostOwnedDecision(
    relay: NonNullable<ReturnType<typeof getCoopInteractionRelay>>,
    operationBinding: CoopRevivalOperationBinding,
    seq: number,
  ): Promise<void> {
    const result = await relay.awaitInteractionChoice(seq, getCoopFaintSwitchWaitMs(), COOP_REVIVAL_CHOICE_KINDS);
    const expectedOperationId =
      result == null || this.coopV2ControlOperationId == null
        ? null
        : coopRevivalDecisionOperationId(this.coopV2ControlOperationId, result.choice);
    if (
      isCoopRevivalAuthorityV2Active(operationBinding)
      && (expectedOperationId == null
        || result?.operationId !== expectedOperationId
        || !settleCoopV2InteractionOperation(expectedOperationId, this.coopOwningRuntime))
    ) {
      failCoopSharedSession(
        `Revival Blessing watcher for slot ${this.fieldIndex} could not settle its exact V2 result`,
      );
      return;
    }
    void Promise.resolve(globalScene.ui.setMode(UiMode.MESSAGE)).then(() => this.end());
  }
}
