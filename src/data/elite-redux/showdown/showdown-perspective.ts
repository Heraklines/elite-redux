/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 guest PERSPECTIVE FLIP (C5) - PRESENTATION ONLY.
//
// The battle is host-authoritative: the host's team is the PLAYER side (BattlerIndex
// PLAYER / PLAYER_2), the opponent's team is the ENEMY side (ENEMY / ENEMY_2). The guest
// applies that authoritative state VERBATIM - seating, parties, and Pokemon ids all stay
// HOST-ORDERED (the guest derives nothing; touching authoritative order is forbidden).
//
// But each player must SEE their own team on the bottom (player side). For the GUEST, its
// own team is authoritatively the ENEMY side (it is the opponent in the host's world), so a
// pure renderer would show the guest's team on TOP as "enemies". The flip is a
// PRESENTATION-only side swap: at the render/UI seam it maps an authoritative side/slot to
// the on-SCREEN side/slot, WITHOUT changing any authoritative value.
//
// This module owns the PURE mapping. The render/UI layer consults these instead of raw
// `isPlayer()` at the presentation sites (sprite Y/side, battle-info panel choice, command
// UI labels). Engine-free so the mapping is unit-testable without a scene.
//
// SEAM NOTE (for the render wiring): there is no single narrow chokepoint - `isPlayer()`
// drives sprite side/Y, `PlayerBattleInfo` vs `EnemyBattleInfo`, and the command UI. The
// flip is threaded as a PRESENTATION-SIDE predicate ({@linkcode presentationSideIsPlayer})
// distinct from the authoritative `isPlayer()`, branched ONLY on `versus + guest`, so solo /
// co-op / the host are byte-identical (the flip collapses to identity when not the versus guest).
// =============================================================================

import { BattlerIndex } from "#enums/battler-index";

/** The side bit of a {@linkcode BattlerIndex}: PLAYER/PLAYER_2 clear it, ENEMY/ENEMY_2 set it. */
const SIDE_BIT = 0b10;

/**
 * The ON-SCREEN battler index for an authoritative `bi`, from this client's viewpoint. For the
 * versus GUEST the two sides swap (PLAYER<->ENEMY, PLAYER_2<->ENEMY_2) so the guest's own team
 * (authoritatively the enemy side) renders on the bottom; for everyone else it is identity.
 * `ATTACKER` (-1) and any non-field value pass through unchanged.
 */
export function presentationBattlerIndex(bi: BattlerIndex, flip: boolean): BattlerIndex {
  if (!flip || bi < 0) {
    return bi;
  }
  // XOR the side bit: 0<->2, 1<->3 (swap side, keep the slot within the side).
  return (bi ^ SIDE_BIT) as BattlerIndex;
}

/**
 * Whether an authoritatively-`isPlayer` mon renders on the ON-SCREEN PLAYER (bottom) side from
 * this client's viewpoint. For the versus guest the sense inverts (its authoritative-enemy team
 * shows on the bottom); otherwise it is the authoritative value unchanged.
 */
export function presentationSideIsPlayer(authoritativeIsPlayer: boolean, flip: boolean): boolean {
  return flip ? !authoritativeIsPlayer : authoritativeIsPlayer;
}

/** Whether a battler index is on the authoritative PLAYER side (PLAYER / PLAYER_2). */
export function isPlayerSide(bi: BattlerIndex): boolean {
  return bi === BattlerIndex.PLAYER || bi === BattlerIndex.PLAYER_2;
}
