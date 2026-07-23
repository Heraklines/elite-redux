/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown versus GUEST command construction (C5) - PRESENTATION ONLY.
//
// The versus GUEST is a pure renderer of the host's authoritative world: its OWN team is the
// ENEMY side there. It never resolves a turn locally - it picks a command for each of its active
// mons against the STREAMED state and SHIPS it via `ShowdownCommandRelay.sendCommand`; the HOST
// validates the pick host-authoritatively (illegal -> AI fallback, already proven) and simulates.
//
// This module owns the PURE wire-facing bit: turning a menu choice (a move slot / a bench slot) +
// the chosen targets into the `SerializedCommand` the relay carries. NO engine logic, NO legality
// computation - the host is the authority. Engine-free (Command / MoveUseMode / BattlerIndex enums +
// the wire type), so it is unit-testable headlessly without a scene.
//
// TARGETING (singles vs doubles/triples): a 1v1 has exactly one opposing slot, so the target is a
// presentation default ({@linkcode SHOWDOWN_GUEST_FIGHT_TARGET}) and the host re-derives it. A
// doubles/triples FIGHT carries the guest's ACTUAL chosen targets - both as numeric BattlerIndices
// (the guest's LOCAL orientation, for presentation) AND as STABLE `targetRefs` ({side, pokemonId}).
// The host maps each targetRef to its OWN battler index by pokemonId (which is globally unique and
// shared across the two clients via the launch snapshot), so the perspective FLIP is handled without
// the guest and host having to agree on a numeric-index convention; the host still validates each
// mapped index against the move's legal target set, so a hostile peer can't aim at an illegal slot.
// =============================================================================

import type { CoopBattleTargetRef, SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveUseMode } from "#enums/move-use-mode";

/**
 * The single opposing slot a 1v1 guest FIGHT targets by default: in the host's world the guest's mon
 * is the ENEMY side, whose lone opponent is the host's active mon at {@linkcode BattlerIndex.PLAYER}.
 * A doubles/triples command instead carries the guest's actual chosen targets + `targetRefs`.
 */
export const SHOWDOWN_GUEST_FIGHT_TARGET = BattlerIndex.PLAYER;

/**
 * Build the FIGHT command the guest ships for the chosen move slot. `slot` is the move's index in
 * the mon's moveset (the relay's `cursor`); `moveId` is echoed so the host matches it verbatim.
 * `targets` are the guest's chosen target BattlerIndices (LOCAL orientation; defaults to the singles
 * {@linkcode SHOWDOWN_GUEST_FIGHT_TARGET}); `targetRefs` are the STABLE {side, pokemonId} identities
 * the host maps to its own battler indices (absent in a 1v1, where the host re-derives the target).
 */
export function buildShowdownFightCommand(
  slot: number,
  moveId: number,
  targets: number[] = [SHOWDOWN_GUEST_FIGHT_TARGET],
  targetRefs?: CoopBattleTargetRef[],
): SerializedCommand {
  return {
    command: Command.FIGHT,
    cursor: slot,
    moveId,
    targets,
    ...(targetRefs != null && targetRefs.length > 0 ? { targetRefs } : {}),
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
