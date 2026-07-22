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

import { coopHostEngineDialogueMessageAdvanceAllowed } from "#data/elite-redux/coop/coop-runtime";
import { describe, expect, it } from "vitest";

/** The exact mystery-lane state: authoritative host, MESSAGE dialogue, guest-owned in-progress ME. */
const HOST_ENGINE_DIALOGUE = {
  isMessageMode: true,
  netcodeMode: "authoritative",
  meInProgress: true,
  meHandoffBattleStarted: false,
  meBespokeHostDrives: false,
  localSeatOwnsMe: false,
  meInteractiveSurfaceActive: true,
} as const;

describe("Authority-V2 host engine-dialogue carve-out (campaign 29933294323 mystery park)", () => {
  it("ALLOWS the authoritative host to advance its own MESSAGE dialogue on a guest-owned ME (#816 under V2)", () => {
    // Without this the V2 freeze shadows #816 and the post-pick narration parks forever.
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE })).toBe(true);
  });

  it("BLOCKS every non-MESSAGE (CHOICE) surface - options / party / secondary / quiz stay frozen", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, isMessageMode: false })).toBe(false);
  });

  it("BLOCKS the host-OWNED ME (the host drives its own selector off local input; nothing to bypass)", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, localSeatOwnsMe: true })).toBe(false);
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

  it("BLOCKS a bespoke host-driven mini-game (the host must be able to PLAY it, #823)", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, meBespokeHostDrives: true })).toBe(
      false,
    );
  });

  it("BLOCKS when no ME-interactive pump surface is live (embedded battle / end-of-ME shop own their input)", () => {
    expect(
      coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, meInteractiveSurfaceActive: false }),
    ).toBe(false);
  });

  it("BLOCKS outside any live ME (coopMeInProgress false)", () => {
    expect(coopHostEngineDialogueMessageAdvanceAllowed({ ...HOST_ENGINE_DIALOGUE, meInProgress: false })).toBe(false);
  });
});
