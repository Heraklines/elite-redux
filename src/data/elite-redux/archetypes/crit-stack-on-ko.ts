/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `crit-stack-on-ko` archetype.
//
// Each time the holder knocks out an opponent (PostVictory), its critical-hit
// stage rises by `perKo` (accumulating, capped at `cap`). The accumulated bonus
// is read by `Pokemon.getCritStage` via a by-name scan (registration-free).
//
// Wires:
//   - 649 Pretentious — "Dealing a KO raises Crit by one stage." (perKo 1)
// =============================================================================

import { PostVictoryAbAttr } from "#abilities/ab-attrs";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

const STACK = Symbol("CritStackOnKo.stacks");

export class CritStackOnKoAbAttr extends PostVictoryAbAttr {
  private readonly perKo: number;
  private readonly cap: number;

  constructor(perKo = 1, cap = 6) {
    super();
    this.perKo = perKo;
    this.cap = cap;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const cur = (pokemon as unknown as Record<symbol, number>)[STACK] ?? 0;
    (pokemon as unknown as Record<symbol, number>)[STACK] = Math.min(cur + this.perKo, this.cap);
  }

  /** The crit-stage bonus this holder has accumulated from KOs. */
  public currentStacks(pokemon: Pokemon): number {
    return (pokemon as unknown as Record<symbol, number>)[STACK] ?? 0;
  }
}
