/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import {
  armCoopCatchFullIntentResend,
  captureCoopCatchFullOperationBinding,
  coopCatchFullDecisionOperationId,
} from "#data/elite-redux/coop/coop-catch-full-operation";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_CATCH_FULL_SEQ } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  notifyCoopV2InteractionSurfaceReady,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { UiMode } from "#enums/ui-mode";
import { PartyUiMode } from "#ui/handlers/party-ui-handler";
import i18next from "i18next";

/**
 * Co-op (#856, the CoopGuestRevivalPhase / #855 ME catch-full pattern): when a GUEST-THROWN wild catch
 * succeeds with a FULL merged party, the keep-in-party / release decision belongs to the CATCHER (the
 * guest), NOT the sole-engine host. The host's {@linkcode AttemptCapturePhase} sends a `catchFullPrompt`,
 * the guest's runtime queues THIS phase, which opens the REAL replace-or-skip picker on the catcher's
 * client and relays ONLY the chosen party slot under {@linkcode COOP_CATCH_FULL_SEQ} - the seq the host
 * awaits. The host then applies the authoritative release+add at the relayed slot; the caught mon
 * materializes on the guest via the normal capture handshake (`applyCoopCaptureParty`), keeping the
 * renderer mutation-free.
 *
 * The picker is a NON-mutating PARTY/SELECT (never a local RELEASE splice on the pure-renderer guest - the
 * host owns the mutation): the guest shows the party-full text, opens the picker, and relays the chosen
 * slot (0..5) to REPLACE, or an out-of-range slot on cancel so the host SKIPS the grant. If the player
 * idles past the host's wait the host declines (out-of-range fallback) and the late pick is ignored (stale
 * seq) - the run never stalls.
 */
export class CoopGuestCatchFullPhase extends Phase {
  public readonly phaseName = "CoopGuestCatchFullPhase";
  public readonly coopV2ControlOperationId: string | null;

  private readonly pokemonName: string;
  private readonly speciesId: number;
  private readonly coopOwningRuntime = getCoopRuntime();
  /** Re-entrant guard: a drive loop may call start() again while the picker is open. */
  private opened = false;

  constructor(pokemonName: string, speciesId: number, operationId?: string) {
    super();
    this.pokemonName = pokemonName;
    this.speciesId = speciesId;
    this.coopV2ControlOperationId = operationId ?? null;
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
    // Bind before either UI callback can outlive this client's ambient runtime selection. The callback sends
    // only a proposal carrier; the host's retained decision remains the sole terminal authority.
    const operationBinding = captureCoopCatchFullOperationBinding();
    const seq = COOP_CATCH_FULL_SEQ;
    coopLog("replay", `guest catch-full picker OPEN sp=${this.speciesId} seq=${seq} (choose keep/release)`);
    try {
      globalScene.ui.showText(i18next.t("battle:partyFull", { pokemonName: this.pokemonName }), null, () => {
        // NON-mutating PARTY/SELECT so the pure-renderer guest never splices its own party (the host owns
        // the release+add); the callback relays the chosen slot, or an out-of-range slot on cancel (skip).
        const mode = globalScene.ui.setMode(UiMode.PARTY, PartyUiMode.SELECT, -1, (slotIndex: number) => {
          coopLog("replay", `guest catch-full picker PICK slot=${slotIndex} seq=${seq}`);
          const partySlot = slotIndex >= 0 && slotIndex < 6 ? slotIndex : -1;
          const wave = globalScene.currentBattle?.waveIndex ?? 0;
          const turn = globalScene.currentBattle?.turn ?? 0;
          const resend = () => relay.sendInteractionChoice(seq, "catchFull", partySlot);
          resend();
          armCoopCatchFullIntentResend(
            {
              payload: { type: "decision", speciesId: this.speciesId, partySlot },
              wave,
              turn,
              resend,
            },
            operationBinding,
          );
          const decisionOperationId =
            this.coopV2ControlOperationId == null
              ? null
              : coopCatchFullDecisionOperationId(this.coopV2ControlOperationId);
          if (decisionOperationId != null) {
            settleCoopV2InteractionOperation(decisionOperationId, this.coopOwningRuntime);
          }
          void Promise.resolve(globalScene.ui.setMode(UiMode.MESSAGE)).then(() => this.end());
        });
        Promise.resolve(mode).then(() => notifyCoopV2InteractionSurfaceReady(this.coopOwningRuntime));
      });
    } catch {
      // A UI failure must never hang the replay; the host declines the grant after its wait.
      coopWarn("replay", `guest catch-full picker sp=${this.speciesId} failed to open (handled, host declines)`);
      this.end();
    }
  }
}
