/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `defense-stat-swap-on-statused-foe` archetype.
//
// Exploit Weakness (284): "When attacking a statused opponent, the attack targets
// their LOWER defensive stat." This is a genuine defensive-stat SWAP in the damage
// formula — the attacker's damage is computed against whichever of the defender's
// EFFECTIVE Def / SpDef (stat stages included) is lower — NOT a capped power-ratio
// proxy. The mechanic lives in `LowerDefensiveStatVsStatusedFoeAbAttr`
// (`ab-attrs.ts`), which `Pokemon.getAttackDamage` invokes source-side (gated on
// the defender being statused) via `applyAbAttrs`. This archetype class is a thin
// alias so the dispatcher wiring (case 284) keeps its historical name; `getAttrs`
// / `applyAbAttrs` still resolve it through the base class (instanceof match).
//
// Wires:
//   - 284 Exploit Weakness — "Targets lowest defense vs statused foes."
// =============================================================================

import {
  LowerDefensiveStatVsStatusedFoeAbAttr,
  type LowerDefensiveStatVsStatusedFoeAbAttrParams,
} from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { StatusEffect } from "#enums/status-effect";

export class DefenseStatSwapOnStatusedFoeAbAttr
  extends LowerDefensiveStatVsStatusedFoeAbAttr
  implements GatedAttr<LowerDefensiveStatVsStatusedFoeAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: LowerDefensiveStatVsStatusedFoeAbAttrParams) => boolean) | undefined;

  /**
   * Tier B split (ability studio spec 3.1). The engine call site (Pokemon.getBaseDamage) used to test "the foe has a
   * status condition" itself before asking the attr. That test is the gate now and the call site asks whenever there is
   * a defender, so the condition is a block staff can see, remove or combine. Pure reads, no random draw.
   */
  override canApply(params: LowerDefensiveStatVsStatusedFoeAbAttrParams): boolean {
    return gatedCanApply<LowerDefensiveStatVsStatusedFoeAbAttrParams>(this, params);
  }

  /** Safety rule that stays in the class: there must be a foe to compare. */
  public guards({ defender }: LowerDefensiveStatVsStatusedFoeAbAttrParams): boolean {
    return !!defender;
  }

  /** The replaceable condition: the foe has a status condition (the engine test, verbatim). */
  public gate({ defender }: LowerDefensiveStatVsStatusedFoeAbAttrParams): boolean {
    return defender.status != null && defender.status.effect !== StatusEffect.NONE;
  }
}
