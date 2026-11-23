/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `chance-dodge` archetype.
//
// PreDefend hook: rolls a configurable percentage chance to evade ANY
// single-target incoming attack. Mirrors classic "evasion" but as a per-
// hit roll (not a permanent EVA stat boost).
//
// Wires:
//   - 597 Olé! — "20% chance to evade single-target moves" (chance: 20,
//     singleTargetOnly: true).
// =============================================================================

import { PreDefendAbAttr, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { MoveTarget } from "#enums/move-target";

export interface ChanceDodgeOptions {
  /** Percentage chance to evade (0-100). */
  readonly chance: number;
  /** If true, only single-target attacks can be dodged (mirrors Olé). */
  readonly singleTargetOnly?: boolean;
}

const SINGLE_TARGET_KINDS = new Set<MoveTarget>([
  MoveTarget.NEAR_OTHER,
  MoveTarget.OTHER,
  MoveTarget.NEAR_ENEMY,
  MoveTarget.ENEMY_SIDE,
]);

export class ChanceDodgeAbAttr extends PreDefendAbAttr implements GatedAttr<TypeMultiplierAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: TypeMultiplierAbAttrParams) => boolean) | undefined;

  private readonly chance: number;
  private readonly singleTargetOnly: boolean;

  constructor(options: ChanceDodgeOptions) {
    if (!(options.chance > 0 && options.chance <= 100)) {
      throw new Error(`[ChanceDodgeAbAttr] chance must be in (0, 100]; got ${options.chance}`);
    }
    super(true);
    this.chance = options.chance;
    this.singleTargetOnly = options.singleTargetOnly ?? false;
  }

  /** Tier B split (ability studio spec 3.1): `guards`, then `gate` (the target test, then the ONE random draw). */
  override canApply(params: TypeMultiplierAbAttrParams): boolean {
    return gatedCanApply<TypeMultiplierAbAttrParams>(this, params);
  }

  /** Safety rules that stay in the class, checked first: never dodge my own move, and only attacking moves can be dodged. */
  public guards({ move, opponent: attacker, pokemon }: TypeMultiplierAbAttrParams): boolean {
    return !(attacker === pokemon || !move.is("AttackMove"));
  }

  /**
   * The replaceable condition, in the original clause order: the single-target test (a setting of the class), then the
   * chance roll LAST (the one random draw, only reached when everything before it passed).
   */
  public gate({ move, pokemon }: TypeMultiplierAbAttrParams): boolean {
    if (this.singleTargetOnly && !SINGLE_TARGET_KINDS.has(move.moveTarget)) {
      return false;
    }
    return pokemon.randBattleSeedInt(100) < this.chance;
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    params.typeMultiplier.value = 0;
    params.cancelled.value = true;
  }
}
