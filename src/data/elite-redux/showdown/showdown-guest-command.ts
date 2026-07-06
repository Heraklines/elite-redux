/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 GUEST command construction (C5) - PRESENTATION ONLY.
//
// The versus GUEST is a pure renderer of the host's authoritative world: its OWN team is the
// ENEMY side there. It never resolves a turn locally - it picks a command for its active mon
// against the STREAMED state and SHIPS it via `ShowdownCommandRelay.sendCommand`; the HOST
// validates the pick host-authoritatively (illegal -> AI fallback, already proven) and simulates.
//
// This module owns the PURE wire-facing bit: turning a menu choice (a move slot / a bench slot)
// into the `SerializedCommand` the relay carries. NO engine logic, NO legality computation - the
// host is the authority. Engine-free (Command / MoveUseMode / BattlerIndex enums + the wire type),
// so it is unit-testable headlessly without a scene.
//
// TARGETING: a 1v1 has exactly one opposing slot. In the host's world the guest's mon is the
// ENEMY and its lone opponent is the host's active PLAYER mon (`BattlerIndex.PLAYER`), so every
// guest FIGHT targets `PLAYER`. The host re-derives/validates targets, so this is a presentation
// default, not an authoritative decision.
// =============================================================================

import type { SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveUseMode } from "#enums/move-use-mode";

/**
 * The single opposing slot a 1v1 guest FIGHT targets: in the host's world the guest's mon is the
 * ENEMY side, whose lone opponent is the host's active mon at {@linkcode BattlerIndex.PLAYER}.
 */
export const SHOWDOWN_GUEST_FIGHT_TARGET = BattlerIndex.PLAYER;

/**
 * Build the FIGHT command the guest ships for the chosen move slot. `slot` is the move's index in
 * the mon's moveset (the relay's `cursor`); `moveId` is echoed so the host matches it verbatim.
 */
export function buildShowdownFightCommand(slot: number, moveId: number): SerializedCommand {
  return {
    command: Command.FIGHT,
    cursor: slot,
    moveId,
    targets: [SHOWDOWN_GUEST_FIGHT_TARGET],
    useMode: MoveUseMode.NORMAL,
  };
}

/**
 * Build the POKEMON (switch) command the guest ships for a benched party member. `partyIndex` is
 * the party-slot index (the relay's `cursor`). Never a Baton switch from the menu (design: plain
 * switch); the host validates the target is a real, non-fainted, benched mon.
 */
export function buildShowdownSwitchCommand(partyIndex: number): SerializedCommand {
  return {
    command: Command.POKEMON,
    cursor: partyIndex,
    baton: false,
  };
}
