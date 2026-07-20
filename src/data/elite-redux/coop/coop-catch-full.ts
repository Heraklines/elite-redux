/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op wild-catch FULL-PARTY keep/release relay (#856). The recipient-drives twin of the #855 ME
// catch-full sub-prompt, applied to the LIVE-battle wild catch path.
//
// On a successful WILD catch with a FULL merged party the keep-in-party / release picker belongs to the
// CATCHER (the ball thrower), NOT the sole-engine host. For a GUEST-thrown catch the HOST cannot let its
// own client decide releases from the merged party (that can release the host's OWN mons and mis-attribute
// the guest's catch - the #800 class). Instead the host streams a `catchFullPrompt`, the GUEST opens the
// real replace-or-skip picker (CoopGuestCatchFullPhase) + relays the chosen party slot on
// COOP_CATCH_FULL_SEQ, and the host applies the authoritative release+add from the relayed slot.
//
// This is the HOST half: it sends the prompt + awaits the guest's slot. It resolves to
//  - the guest's 0-based party slot to REPLACE (0..partySize-1) on a live pick, or
//  - `null` when the guest cancelled (an out-of-range slot), disconnected, or the await hit its ceiling -
//    in every case the caller LOUDLY declines the grant (the caught mon is not kept), never hangs.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  type CoopCatchFullOperationBinding,
  captureCoopCatchFullOperationBinding,
  commitCoopCatchFullAuthorityDecision,
  coopCatchFullDecisionOperationId,
  sendCoopCatchFullPromptWithOperationId,
} from "#data/elite-redux/coop/coop-catch-full-operation";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import { COOP_CATCH_FULL_SEQ, getCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  failCoopSharedSession,
  getCoopInteractionRelay,
  getCoopRuntime,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_CATCH_FULL_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";

/**
 * HOST (#856): stream a `catchFullPrompt` to the CATCHER partner and await its relayed replace slot on
 * {@linkcode COOP_CATCH_FULL_SEQ}. Resolves to the guest's 0-based party slot (0..partySize-1) on a live
 * pick, or `null` when the guest cancelled / relayed an out-of-range slot / the await hit its ceiling
 * (disconnect / timeout). The caller MUST have gated on a GUEST-thrown catch first - this opens no local
 * UI and is a bare relay off the awaiting host, so solo / host-thrown never reach it and stay byte-identical.
 */
export interface CoopPreparedWildCatchFullDecision {
  readonly slot: number | null;
  /**
   * Capture and retain the complete post-decision image. The caller must invoke this only after release/add
   * (or decline cleanup) has settled. It is idempotent for the exact prepared decision.
   */
  readonly commitAfterApply: () => boolean;
}

function preparedDecision(
  speciesId: number,
  slot: number | null,
  wave: number,
  turn: number,
  operationBinding: CoopCatchFullOperationBinding,
  promptOperationId: string | null,
  settleDecision: (operationId: string) => void,
): CoopPreparedWildCatchFullDecision {
  let committed = false;
  const decisionOperationId =
    promptOperationId == null || promptOperationId === "legacy"
      ? null
      : coopCatchFullDecisionOperationId(promptOperationId);
  return {
    slot,
    commitAfterApply: () => {
      if (committed) {
        return true;
      }
      if (decisionOperationId != null) {
        settleDecision(decisionOperationId);
      }
      committed = commitCoopCatchFullAuthorityDecision(
        {
          payload: { type: "decision", speciesId, partySlot: slot ?? -1 },
          ownerRole: "guest",
          localRole: "host",
          wave,
          turn,
          ...(decisionOperationId == null ? {} : { operationId: decisionOperationId }),
        },
        operationBinding,
      );
      return committed;
    },
  };
}

export function coopHostPrepareWildCatchFullDecision(
  pokemonName: string,
  speciesId: number,
  onPromptCommitted?: (operationId: string) => void,
): Promise<CoopPreparedWildCatchFullDecision | null> {
  const relay = getCoopInteractionRelay();
  if (relay == null) {
    return Promise.resolve(null);
  }
  coopLog("replay", "host streams catch-FULL keep/release prompt + awaits catcher slot (#856)", {
    seq: COOP_CATCH_FULL_SEQ,
    speciesId,
  });
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  const turn = globalScene.currentBattle?.turn ?? 0;
  // Promise continuations in the two-engine harness can resume after its guest became ambient. Capture the
  // scheduling host's op-state + durability manager before opening the prompt/await and use only this stable
  // binding for both retained commits.
  const operationBinding = captureCoopCatchFullOperationBinding();
  const owningRuntime = getCoopRuntime();
  const promptOperationId = sendCoopCatchFullPromptWithOperationId(
    relay,
    pokemonName,
    speciesId,
    { localRole: "host", wave, turn },
    operationBinding,
  );
  if (promptOperationId == null) {
    failCoopSharedSession(`Catch-full prompt for species ${speciesId} could not enter durable authority`);
    return Promise.resolve(null);
  }
  if (promptOperationId !== "legacy") {
    onPromptCommitted?.(promptOperationId);
  }
  return relay
    .awaitInteractionChoice(COOP_CATCH_FULL_SEQ, getCoopFaintSwitchWaitMs(), COOP_CATCH_FULL_CHOICE_KINDS)
    .then(pick => {
      const slot = pick?.choice ?? null;
      const partySize = globalScene.getPlayerParty().length;
      if (slot == null || slot < 0 || slot >= partySize) {
        coopWarn(
          "replay",
          "host: catch-full catcher declined/out-of-range/timeout; the caught mon is NOT kept (#856)",
          {
            seq: COOP_CATCH_FULL_SEQ,
            slot,
            partySize,
            fromNull: pick == null,
          },
        );
        return preparedDecision(speciesId, null, wave, turn, operationBinding, promptOperationId, operationId =>
          settleCoopV2InteractionOperation(operationId, owningRuntime),
        );
      }
      coopLog("replay", "host received catcher catch-full replace slot (#856)", { seq: COOP_CATCH_FULL_SEQ, slot });
      return preparedDecision(speciesId, slot, wave, turn, operationBinding, promptOperationId, operationId =>
        settleCoopV2InteractionOperation(operationId, owningRuntime),
      );
    });
}
