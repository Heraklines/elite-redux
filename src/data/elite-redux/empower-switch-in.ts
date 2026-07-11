/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — "empower the switch-in" primitive (Ghastly Echo, dex 848).
//
// Ghastly Echo (848): "Deals damage and switches. Switch-in gets 50% boost for
// 1 turn. Sound-based." The damage + self force-switch + SOUND_BASED flag are
// wired on the move itself (init-elite-redux-custom-moves.ts). This module is
// the remaining half: the NEXT Pokemon sent out on the user's side gets a
// one-turn +50% MOVE POWER battler tag (ER_EMPOWERED_SWITCH_IN), consumed after
// its first move.
//
// Mirrors the deferred-revive primitive (archetypes/post-faint-deferred-revive.ts):
//   - The move ARMS a per-side pending latch when its self-switch actually
//     fires (erArmSwitchInBoost).
//   - SummonPhase.onEnd -> erApplyPendingSwitchInBoost() applies the tag to
//     whoever is sent out next on that side and clears the latch.
// The +50% power itself is read in Move.getPower (the same hook as ER_ENRAGE).
//
// The latch is transient battle state, deliberately NOT serialized (as with the
// deferred-revive WeakMaps): the arm->consume pair is same-turn (the forced
// self-switch always summons a replacement that immediately consumes it), so
// there is no window for it to leak across a save/reload or across battles.
// =============================================================================

import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";

/**
 * Per-side "empower the next switch-in" latch. Set when Ghastly Echo's
 * self-switch fires; consumed at the next send-out on that side.
 */
const PENDING_SWITCH_IN_BOOST = { player: false, enemy: false };

/**
 * Arm the "empower the next switch-in" flag for a side. Called from Ghastly
 * Echo's self-switch attr, only when the switch actually queues (so an aborted
 * switch — e.g. no eligible bench mon — never leaves a dangling flag).
 *
 * @param isPlayer - Whether the switching (and re-summoning) side is the player.
 */
export function erArmSwitchInBoost(isPlayer: boolean): void {
  if (isPlayer) {
    PENDING_SWITCH_IN_BOOST.player = true;
  } else {
    PENDING_SWITCH_IN_BOOST.enemy = true;
  }
}

/**
 * If the side that just sent out `pokemon` has a pending Ghastly-Echo empower
 * flag, apply the one-turn +50% move-power tag ({@linkcode
 * BattlerTagType.ER_EMPOWERED_SWITCH_IN}) to it and clear the flag. Called from
 * {@linkcode SummonPhase.onEnd} after each send-out. No-op unless armed.
 *
 * @param pokemon - The {@linkcode Pokemon} that was just summoned.
 */
export function erApplyPendingSwitchInBoost(pokemon: Pokemon): void {
  const isPlayer = pokemon.isPlayer();
  const armed = isPlayer ? PENDING_SWITCH_IN_BOOST.player : PENDING_SWITCH_IN_BOOST.enemy;
  if (!armed) {
    return;
  }
  if (isPlayer) {
    PENDING_SWITCH_IN_BOOST.player = false;
  } else {
    PENDING_SWITCH_IN_BOOST.enemy = false;
  }
  // The tag self-configures its lapse (TURN_END, turnCount 2 — see
  // ErEmpoweredSwitchInTag), so the turnCount arg here is ignored by the factory.
  // Ghastly Echo is an ER-custom move (id outside the MoveId enum) and the tag
  // stores no source move, so MoveId.NONE is passed.
  pokemon.addTag(BattlerTagType.ER_EMPOWERED_SWITCH_IN, 0, MoveId.NONE);
}
