/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `stat-multiplier-per-faint` archetype.
//
// "Fainted Pokemon increase your offenses and spdef by 5%." Each Pokemon that
// faints (either side) while the holder is on the field permanently raises a
// per-holder counter; the holder's ATK / SPATK / SPDEF are then multiplied by
// (1 + perFaint × count) — a true stat multiplier, not stat stages.
//
// Implemented as a faint-counting trigger plus per-stat multiplier attrs that
// share a Symbol counter on the holder.
//
// Engine note: PostKnockOut only fires for on-field holders, so only faints
// that occur while the holder is out are counted (matches every ER faint-react
// ability).
//
// Wires:
//   - 888 Soul Harvest — "Fainted Pokemon increase your offenses and spdef
//     by 5%." (perFaint 0.05, stats ATK/SPATK/SPDEF)
// =============================================================================

import {
  PostKnockOutAbAttr,
  type PostKnockOutAbAttrParams,
  StatMultiplierAbAttr,
  type StatMultiplierAbAttrParams,
} from "#abilities/ab-attrs";
import type { BattleStat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";

const COUNT = Symbol("StatMultiplierPerFaint.count");

const faintCount = (pokemon: Pokemon): number => (pokemon as unknown as Record<symbol, number>)[COUNT] ?? 0;

export class FaintCountTriggerAbAttr extends PostKnockOutAbAttr {
  override canApply({ pokemon, victim }: PostKnockOutAbAttrParams): boolean {
    // Count every faint except the holder's own.
    return victim.id !== pokemon.id;
  }

  override apply({ pokemon, simulated }: PostKnockOutAbAttrParams): void {
    if (simulated) {
      return;
    }
    const store = pokemon as unknown as Record<symbol, number>;
    store[COUNT] = (store[COUNT] ?? 0) + 1;
  }
}

export class PerFaintStatMultiplierAbAttr extends StatMultiplierAbAttr {
  private readonly perFaint: number;

  constructor(stat: BattleStat, perFaint = 0.05) {
    super(stat, 1);
    this.perFaint = perFaint;
  }

  override apply({ pokemon, statVal }: StatMultiplierAbAttrParams): void {
    statVal.value *= 1 + this.perFaint * faintCount(pokemon);
  }
}

/** Test helper: the holder's accumulated faint count. */
export const soulHarvestFaintCount = faintCount;
