/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Relativity` (Mega Shuckle Y).
//
// Order-based (NOT speed-based, so it behaves correctly under Trick Room):
//   - When the holder acts BEFORE its target this turn, its damaging moves use
//     the holder's CURRENT Speed stat (post-Borrowed-Time) in place of Attack /
//     Sp. Atk (whichever the move's category would read).
//   - When the holder acts AFTER an attacker this turn, it takes 25% less damage
//     from THAT attacker only.
//
// "Before/after" is resolved from the authoritative per-turn move order
// (`getLastTurnOrder()`), which is populated as each MovePhase pops from the
// Trick-Room-aware speed queue — so a Trick Room reversal is honored for free.
//
// Offense hook: a by-name scan in `Pokemon.getBaseDamage` (registration-free,
// same pattern as AttackStatSubstituteAbAttr) reads `resolveOffenseStat`.
// Defense hook: `RelativityDefenseReductionAbAttr` extends pokerogue's
// `ReceivedMoveDamageMultiplierAbAttr` and applies the 0.75x via its gated
// condition.
// =============================================================================

import { AbAttr, ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { type EffectiveStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_RELATIVITY_ABILITY_ID = 5911;

/** Damage taken from an attacker the holder out-slowed (acted after). */
export const RELATIVITY_DAMAGE_MULTIPLIER = 0.75;

/**
 * Whether `first` moved earlier than `second` in the current turn's resolved
 * order. Uses the authoritative per-turn order (filled from the Trick-Room-aware
 * speed queue as each MovePhase pops), so it is correct under Trick Room.
 *
 * Semantics at a mid-turn damage calc: the mon currently acting is already in
 * the order list; a mon that has not acted yet is absent. So:
 *   - `first` present, `second` absent  → `first` acted, `second` will later → before.
 *   - both present                      → compare their indices.
 *   - `first` absent                    → `first` hasn't acted → not "before".
 */
export function pokemonActedBefore(first: Pokemon, second: Pokemon): boolean {
  const order = globalScene.phaseManager.dynamicQueueManager.getLastTurnOrder();
  const iFirst = order.indexOf(first);
  if (iFirst === -1) {
    return false;
  }
  const iSecond = order.indexOf(second);
  if (iSecond === -1) {
    return true;
  }
  return iFirst < iSecond;
}

/**
 * Offense marker + resolver. Scanned by name in `getBaseDamage`. Returns the
 * Speed stat to substitute for the move's offensive stat when the holder
 * (`source`) acted before the `target` this turn, else `null`.
 */
export class RelativityAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}

  /**
   * @param source - the Relativity holder (attacker)
   * @param target - the defender being hit
   * @returns `Stat.SPD` when the offensive stat should be replaced by Speed, else `null`
   */
  public resolveOffenseStat(source: Pokemon, target: Pokemon): EffectiveStat | null {
    return pokemonActedBefore(source, target) ? Stat.SPD : null;
  }
}

/**
 * Defense half: the holder takes 25% less damage from an attacker it acted
 * AFTER this turn (i.e. the attacker moved first). Gated per incoming hit, so it
 * only reduces damage from the specific attacker the holder out-slowed.
 */
export class RelativityDefenseReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor() {
    super(
      (holder: Pokemon, attacker: Pokemon, _move: Move) => pokemonActedBefore(attacker, holder),
      RELATIVITY_DAMAGE_MULTIPLIER,
    );
  }
}
