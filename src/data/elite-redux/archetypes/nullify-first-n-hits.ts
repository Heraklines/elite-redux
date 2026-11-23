/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `nullify-first-n-hits` archetype.
//
// "Negates the first two instances of damage received. Moves still connect and
// secondary effects apply, but damage becomes 0." Implemented as a PreDefend
// damage modifier: the first N damage instances the holder would take in each
// encounter are set to 0. Usage is keyed by the current Battle object so party
// members that persist between waves receive fresh charges in the next battle.
//
// Wires:
//   - 427 Cheating Death — "Gets no damage for the first two hits." (n = 2)
// =============================================================================

import { type PreDefendModifyDamageAbAttrParams, ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { markDamageNullified } from "#data/damage-nullification";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import type { Pokemon } from "#field/pokemon";

const NO_ACTIVE_BATTLE = Symbol("NullifyFirstNHits.noActiveBattle");

interface NullifyUsage {
  battle: unknown;
  used: number;
}

export class NullifyFirstNHitsAbAttr
  extends ReceivedMoveDamageMultiplierAbAttr
  implements GatedAttr<PreDefendModifyDamageAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreDefendModifyDamageAbAttrParams) => boolean) | undefined;

  private readonly n: number;
  private readonly battleKey: () => unknown;
  private readonly usage = new WeakMap<Pokemon, NullifyUsage>();

  constructor(n = 2, battleKey: () => unknown = () => globalScene?.currentBattle ?? NO_ACTIVE_BATTLE) {
    // Multiplier is unused (apply is overridden); condition always passes.
    super(() => true, 0);
    this.n = n;
    this.battleKey = battleKey;
  }

  /**
   * Tier B split (ability studio spec 3.1) of the old `damage.value > 0 && used < n`: `gate` is the counter (a condition staff
   * may change), `residual` is "the hit really does damage" (a hit that already does nothing does not burn a charge). Both are
   * reads, so asking the counter first changes no answer.
   */
  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    return gatedCanApply<PreDefendModifyDamageAbAttrParams>(this, params);
  }

  /** The gate: I have been hit fewer than `n` times in this battle. */
  public gate({ pokemon }: PreDefendModifyDamageAbAttrParams): boolean {
    return this.used(pokemon) < this.n;
  }

  /** The residual that stays in the class: the hit would really do damage. */
  public residual({ damage }: PreDefendModifyDamageAbAttrParams): boolean {
    return damage.value > 0;
  }

  override apply({ pokemon, damage, simulated }: PreDefendModifyDamageAbAttrParams): void {
    if (simulated) {
      // Still report 0 damage for previews, but don't consume a charge.
      damage.value = 0;
      markDamageNullified(damage);
      return;
    }
    const usage = this.currentUsage(pokemon);
    usage.used++;
    damage.value = 0;
    markDamageNullified(damage);
  }

  /** Test helper: number of negated hits consumed so far. */
  public used(pokemon: Pokemon): number {
    return this.currentUsage(pokemon).used;
  }

  /** Test helper: how many incoming damage instances this negates. */
  public getN(): number {
    return this.n;
  }

  private currentUsage(pokemon: Pokemon): NullifyUsage {
    const battle = this.battleKey();
    const existing = this.usage.get(pokemon);
    if (existing !== undefined && existing.battle === battle) {
      return existing;
    }
    const fresh = { battle, used: 0 };
    this.usage.set(pokemon, fresh);
    return fresh;
  }
}
