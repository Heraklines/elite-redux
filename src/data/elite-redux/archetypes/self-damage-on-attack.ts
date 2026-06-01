/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `self-damage-on-attack` archetype.
//
// Ability-driven self-damage when the holder lands a damaging move. Two bases:
//   - "damageDealt": recoil = `fraction` of the damage dealt by THIS hit. Fires
//     per hit, so a multi-hit move sums to `fraction` of total damage — exactly
//     how vanilla RecoilAttr accumulates.
//   - "maxHp": lose `fraction` of the holder's MAX HP per move. Gated to the
//     move's last hit (`turnData.hitsLeft <= 1`) so multi-hit moves only pay
//     the cost once.
//
// Mirrors vanilla RecoilAttr's damage application
// (`damageAndUpdate(dmg, { result: INDIRECT, ignoreSegments: true })`).
//
// Wires:
//   - 487 Super Strain — "moves deal 25% of the damage done as recoil."
//     (basis "damageDealt", fraction 0.25)
//   - 536 Blood Price — "lose 10% of max HP when landing an attack."
//     (basis "maxHp", fraction 0.10, once per move)
// =============================================================================

import { PostAttackAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { HitResult } from "#enums/hit-result";
import { toDmgValue } from "#utils/common";

export type SelfDamageBasis = "damageDealt" | "maxHp";

export interface SelfDamageOnAttackOptions {
  /** What the self-damage is a fraction of. */
  readonly basis: SelfDamageBasis;
  /** Fraction of the basis to lose (0.25 = 25%). */
  readonly fraction: number;
}

export class SelfDamageOnAttackAbAttr extends PostAttackAbAttr {
  private readonly basis: SelfDamageBasis;
  private readonly fraction: number;

  constructor(options: SelfDamageOnAttackOptions) {
    super();
    this.basis = options.basis;
    this.fraction = options.fraction;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { simulated, damage, pokemon } = params;
    // Damaging move (super) + actually connected for damage this hit.
    if (!super.canApply(params) || simulated || damage <= 0) {
      return false;
    }
    // maxHp cost is per move: only pay on the final hit of a multi-hit move.
    if (this.basis === "maxHp" && pokemon.turnData.hitsLeft > 1) {
      return false;
    }
    return true;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { pokemon, damage } = params;
    const base = this.basis === "maxHp" ? pokemon.getMaxHp() : damage;
    const self = toDmgValue(base * this.fraction, 1);
    if (self <= 0) {
      return;
    }
    pokemon.damageAndUpdate(self, { result: HitResult.INDIRECT, ignoreSegments: true });
  }
}
