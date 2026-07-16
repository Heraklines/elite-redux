/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — "protect the switch-in" primitive (Safe Passage, dex 979).
//
// Safe Passage (979): "Guides an ally onto the field. They take -35% damage this
// turn." The self force-switch is wired on the move itself (its dispatcher case
// uses ErSafePassageSwitchAttr). This module is the remaining half: the NEXT
// Pokemon sent out on the user's side gets a one-turn -35% DAMAGE-TAKEN battler
// tag (ER_SAFE_PASSAGE), stripped at that turn's end.
//
// Mirrors the empower-switch-in latch (empower-switch-in.ts):
//   - The move ARMS a per-side pending latch when its self-switch actually
//     fires (erArmSafePassage).
//   - SummonPhase.onEnd -> erApplyPendingSafePassage() applies the tag to
//     whoever is sent out next on that side and clears the latch.
// The -35% damage reduction itself is read in Pokemon.getAttackDamage (the same
// place as the ER_FEAR +50% multiplier).
//
// The latch is transient battle state, deliberately NOT serialized (as with the
// empower-switch-in latch): the arm->consume pair is same-turn (the forced
// self-switch always summons a replacement that immediately consumes it), so
// there is no window for it to leak across a save/reload or across battles.
// =============================================================================

import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";

/**
 * Per-side "protect the next switch-in" latch. Set when Safe Passage's
 * self-switch fires; consumed at the next send-out on that side.
 */
const PENDING_SAFE_PASSAGE = { player: false, enemy: false };

/**
 * Arm the "protect the next switch-in" flag for a side. Called from Safe
 * Passage's self-switch attr, only when the switch actually queues (so an
 * aborted switch — e.g. no eligible bench mon — never leaves a dangling flag).
 *
 * @param isPlayer - Whether the switching (and re-summoning) side is the player.
 */
export function erArmSafePassage(isPlayer: boolean): void {
  if (isPlayer) {
    PENDING_SAFE_PASSAGE.player = true;
  } else {
    PENDING_SAFE_PASSAGE.enemy = true;
  }
}

/**
 * If the side that just sent out `pokemon` has a pending Safe-Passage flag,
 * apply the one-turn -35% damage-taken tag ({@linkcode
 * BattlerTagType.ER_SAFE_PASSAGE}) to it and clear the flag. Called from
 * {@linkcode SummonPhase.onEnd} after each send-out. No-op unless armed.
 *
 * @param pokemon - The {@linkcode Pokemon} that was just summoned.
 */
export function erApplyPendingSafePassage(pokemon: Pokemon): void {
  const isPlayer = pokemon.isPlayer();
  const armed = isPlayer ? PENDING_SAFE_PASSAGE.player : PENDING_SAFE_PASSAGE.enemy;
  if (!armed) {
    return;
  }
  if (isPlayer) {
    PENDING_SAFE_PASSAGE.player = false;
  } else {
    PENDING_SAFE_PASSAGE.enemy = false;
  }
  // The tag self-configures its lapse (TURN_END, turnCount 1 — see
  // ErSafePassageTag), so the turnCount arg here is ignored by the factory. Safe
  // Passage stores no source move on the tag, so MoveId.NONE is passed.
  pokemon.addTag(BattlerTagType.ER_SAFE_PASSAGE, 0, MoveId.NONE);
}
