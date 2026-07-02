/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_FAINT_SWITCH_SEQ_BASE, getCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { getCoopController, getCoopInteractionRelay } from "#data/elite-redux/coop/coop-runtime";
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
 * If the player idles past the host's wait ({@linkcode getCoopFaintSwitchWaitMs}), the host
 * auto-picks and the late pick is simply ignored (stale seq) - the run never stalls.
 */
export class CoopGuestFaintSwitchPhase extends Phase {
  public readonly phaseName = "CoopGuestFaintSwitchPhase";

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
    const seq = COOP_FAINT_SWITCH_SEQ_BASE + this.fieldIndex;
    coopLog("replay", `guest own-faint picker OPEN slot=${this.fieldIndex} seq=${seq} (choose your replacement)`);
    try {
      globalScene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.FAINT_SWITCH,
        this.fieldIndex,
        (slotIndex: number) => {
          const battlerCount = globalScene.currentBattle?.getBattlerCount() ?? 0;
          if (slotIndex >= battlerCount && slotIndex < 6) {
            coopLog("replay", `guest own-faint picker PICK slot=${this.fieldIndex} -> party[${slotIndex}] seq=${seq}`);
            // #799 (Wingull/Chinchou wrong-mon summon): carry the picked mon's SPECIES so the
            // host can resolve the pick by IDENTITY when the two clients' party orders have
            // diverged (a blind slot index summons a DIFFERENT mon on the other engine).
            const pickedSpecies = globalScene.getPlayerParty()[slotIndex]?.species?.speciesId ?? 0;
            relay.sendInteractionChoice(seq, "switch", slotIndex, [0, pickedSpecies]);
          }
          void Promise.resolve(globalScene.ui.setMode(UiMode.MESSAGE)).then(() => this.end());
        },
        PartyUiHandler.FilterNonFainted,
      );
    } catch {
      // A UI failure must never hang the guest's replay; the host auto-picks after its wait.
      coopWarn("replay", `guest own-faint picker slot=${this.fieldIndex} failed to open (handled, host auto-picks)`);
      this.end();
    }
  }
}
