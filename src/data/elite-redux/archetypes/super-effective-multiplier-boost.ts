/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `super-effective-multiplier-boost` archetype.
//
// Hooks the attacker side of the type-multiplier computation: when the
// holder is attacking AND the move would already be super-effective
// (typeMultiplier >= 2), multiply the multiplier further by `factor`.
//
// Wires:
//   - 586 Winged King — "Ups super-effective by 33%" (factor = 1.33)
//   - 588 Iron Serpent — same shape (factor = 1.33)
//
// Pokerogue evaluates PreDefend TypeMultiplier on the DEFENDER side; for
// attacker-side modulation we subclass PostAttackAbAttr / DamageBoost path
// instead. We attach to the standard MovePowerBoost path with a condition
// that checks the type effectiveness AT POWER COMPUTATION TIME.
//
// Pokerogue's `MovePowerBoostAbAttr` provides this hook — the condition
// receives (user, target, move) and can compute effectiveness.
// =============================================================================

import { MovePowerBoostAbAttr, type PreAttackModifyPowerAbAttrParams } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { Move } from "#moves/move";
import type { Pokemon } from "#field/pokemon";

export interface SuperEffectiveMultiplierBoostOptions {
  /** Multiplier applied to power when the move is SE (typeMultiplier >= 2). */
  readonly factor: number;
}

/**
 * The one condition of the class: the move would be super effective (effective type multiplier of 2 or more) against the target.
 * A missing target or move, or an engine error while reading the matchup, counts as "no".
 */
function isSuperEffective(user: Pokemon, target: Pokemon | undefined, move: Move | undefined): boolean {
  if (!target || !move) {
    return false;
  }
  try {
    const eff = target.getMoveEffectiveness(user, move);
    return eff >= 2;
  } catch {
    return false;
  }
}

/**
 * Boosts move power by `factor` when the move would be super-effective
 * (effective type multiplier >= 2 against the target).
 */
export class SuperEffectiveMultiplierBoostAbAttr
  extends MovePowerBoostAbAttr
  implements GatedAttr<PreAttackModifyPowerAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  constructor(options: SuperEffectiveMultiplierBoostOptions) {
    super((user, target, move) => isSuperEffective(user, target, move), options.factor);
  }

  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  /** Tier B (ability studio spec 3.1): the whole rule is the replaceable condition (the same test the parent's closure runs). */
  public gate({ pokemon, opponent, move }: PreAttackModifyPowerAbAttrParams): boolean {
    return isSuperEffective(pokemon, opponent, move);
  }
}
