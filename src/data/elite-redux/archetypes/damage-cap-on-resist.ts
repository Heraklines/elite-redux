/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `damage-cap-on-resist` archetype.
//
// PreDefend hook: when an incoming attack would faint the holder AND the
// attack is not-very-effective (typeMultiplier < 1), cap the damage at
// `currentHp - 1` so the holder survives at 1 HP. Mirrors Sturdy's
// "survive at 1 HP" but gated on NVE instead of full HP.
//
// Wires:
//   - 1000 Survivor Bias — "Not very effective moves can't cause fainting."
// =============================================================================

import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { PreDefendModifyDamageAbAttrParams } from "#types/ability-types";

export class DamageCapOnResistAbAttr
  extends ReceivedMoveDamageMultiplierAbAttr
  implements GatedAttr<PreDefendModifyDamageAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreDefendModifyDamageAbAttrParams) => boolean) | undefined;

  /** How many HP the holder keeps when the cap applies (the original fixed value is 1). */
  private readonly hpLeft: number;

  constructor(hpLeft = 1) {
    super(() => true, 1);
    this.hpLeft = hpLeft;
  }

  /**
   * Tier B split (ability studio spec 3.1), in the ORIGINAL clause order: `guards` (an attacking move), `gate` (the move is
   * not very effective against the holder), `residual` (the hit would faint the holder). No random draw.
   */
  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    return gatedCanApply<PreDefendModifyDamageAbAttrParams>(this, params);
  }

  /** Safety rule that stays in the class: only attacking moves are capped. */
  public guards({ move }: PreDefendModifyDamageAbAttrParams): boolean {
    return !!move?.is("AttackMove");
  }

  /** The replaceable condition: the move is resisted (its effectiveness against the holder is below 1x). */
  public gate({ pokemon, opponent, move }: PreDefendModifyDamageAbAttrParams): boolean {
    const eff = pokemon.getMoveEffectiveness(opponent, move);
    return !(eff >= 1);
  }

  /** Feasibility that stays in the class: the cap only means something when the hit would faint the holder. */
  public residual({ pokemon, damage }: PreDefendModifyDamageAbAttrParams): boolean {
    return damage.value >= pokemon.hp;
  }

  override apply(params: PreDefendModifyDamageAbAttrParams): void {
    const { pokemon, damage } = params;
    damage.value = Math.max(0, pokemon.hp - this.hpLeft);
  }
}
