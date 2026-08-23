/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// AUTHORITY-V2 host engine-dialogue carve-out for guest-owned MEs (campaign run 29933294323
// mystery-gauntlet lane, error "wave 1: clients never reached the next command surface ...
// latest phase=CoopReplayMePhase").
//
// On a GUEST-OWNED Mystery encounter the sole-engine authority (host) applies the guest owner's relayed
// option programmatically, then advances its OWN engine MESSAGE dialogue (option-selected outcome text,
// the press-your-luck round prompt, ...) so the encounter can reach its next round / terminal. That
// self-advance is the pre-existing #816 fix. Under the interaction-V2 cutover a pending SHARED_INTERACTION
// control froze ALL of the host's human input (isCoopV2InteractionHumanInputFrozen) BEFORE the #816 branch
// could run, so the host's post-pick narration was never dismissed: no subsequent ME_PRESENT was ever
// streamed and the guest owner stranded in CoopReplayMePhase re-sending its pick until the between-wave
// deadline (host trace: the option-selected narration prompt advanced once, then the host went idle while
// the guest spammed `SEND interactionChoice seq=8000001 kind=me choice=0` and the host dropped every one as
// a duplicate proposal). ER_GLITTERING_VEIN (type 36, a press-your-luck delve) is the exact ME that hit it.
//
// The fix carves the host engine-dialogue MESSAGE advance out of the freeze:
// coopHostEngineDialogueMessageAdvanceAllowed mirrors the exact #816 gate, so ONLY that case (authoritative
// host, MESSAGE mode, guest-owned in-progress ME, no battle-handoff / bespoke mini-game, live ME-interactive
// pump surface) slips the freeze; every CHOICE surface (never MESSAGE) and the host-OWNED ME stay frozen.
//
// PURE, deterministic regression over the exact carve-out predicate the UI gate consults (engine-free: no
// GameManager / no two-engine boot).
// =============================================================================

import { coopMeNarrationOperationId, isCoopMeNarrationOperationId } from "#data/elite-redux/coop/coop-me-operation";
import { coopHostEngineDialogueMessageAdvanceAllowed } from "#data/elite-redux/coop/coop-runtime";
import { describe, expect, it } from "vitest";

/** The exact mystery-lane state: authoritative host, MESSAGE dialogue, guest-owned in-progress ME. */
const HOST_ENGINE_DIALOGUE = {
  localRole: "host",
  isMessageMode: true,
  netcodeMode: "authoritative",
  meInProgress: true,
  meHandoffBattleStarted: false,
  mePostBattleContinuationActive: false,
  meBespokeHostDrives: false,
} as const;

describe("Authority-V2 host engine-dialogue carve-out (campaign 29933294323 mystery park)", () => {
  it("binds every guest narration acknowledgement to one epoch, ME pin, and prompt ordinal", () => {
    const address = { epoch: 7, pinned: 1, seq: 8_000_001, step: 3 } as const;
    const operationId = coopMeNarrationOperationId(address);
    expect(operationId).toBe("7:1:ME_BUTTON:64000011003");
    expect(isCoopMeNarrationOperationId({ ...address, operationId: operationId! })).toBe(true);
    expect(isCoopMeNarrationOperationId({ ...address, step: 4, operationId: operationId! })).toBe(false);
    expect(isCoopMeNarrationOperationId({ ...address, epoch: 8, operationId: operationId! })).toBe(false);
  });

  it("ALLOWS the authoritative host to advance its own MESSAGE dialogue on a guest-owned ME (#816 under V2)", () => {
    // Without this the V2 freeze shadows #816 and the post-pick narration parks forever.
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE })).toBe(true);
  });

  it("BLOCKS every non-MESSAGE (CHOICE) surface - options / party / secondary / quiz stay frozen", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, isMessageMode: false })).toBe(false);
  });

  it("ALLOWS a standalone MessagePhase after the selector phase has ended", () => {
    // Campaign 30217040544 reached exactly this state: the first selected-option line advanced while
    // MysteryEncounterPhase was current, then an ordinary MessagePhase became actionable and V2 froze it.
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE })).toBe(true);
  });

  it("BLOCKS the guest renderer even when it owns the Mystery choice", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, localRole: "guest" })).toBe(false);
  });

  it("BLOCKS off the authoritative netcode (lockstep never freezes host input this way)", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, netcodeMode: "lockstep" })).toBe(
      false,
    );
  });

  it("BLOCKS once an ME-spawned battle handoff has started (that uses the normal battle input path, #817)", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, meHandoffBattleStarted: true })).toBe(
      false,
    );
  });

  it("ALLOWS action-only Mystery continuation narration after a retained battle settlement", () => {
    expect(
      coopHostEngineDialogueMessageAdvanceAllowed({
        ...HOST_ENGINE_DIALOGUE,
        meHandoffBattleStarted: true,
        mePostBattleContinuationActive: true,
      }),
    ).toBe(true);
  });

  it("BLOCKS a bespoke host-driven mini-game (the host must be able to PLAY it, #823)", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, meBespokeHostDrives: true })).toBe(
      false,
    );
  });

  it("BLOCKS outside any live ME (coopMeInProgress false)", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, meInProgress: false })).toBe(false);
  });
});
