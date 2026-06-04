/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `party-count-multi-hit` archetype.
//
// The holder's multi-strike-eligible moves gain one extra hit for every healthy
// party member (not fainted, no status), capped at a total of `maxHits`.
//
// Wires:
//   - 592 Minion Control — "Moves hit an extra time for each healthy party
//     member (max 6 hits)."
// =============================================================================

import { AddSecondStrikeAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { StatusEffect } from "#enums/status-effect";
import type { AddSecondStrikeAbAttrParams } from "#types/ability-types";

export class PartyCountMultiHitAbAttr extends AddSecondStrikeAbAttr {
  private readonly maxHits: number;

  constructor(maxHits = 6) {
    super();
    this.maxHits = maxHits;
  }

  override apply(params: AddSecondStrikeAbAttrParams): void {
    const { pokemon, hitCount } = params;
    const party = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
    const healthy = party.filter(
      p => p && !p.isFainted() && (p.status?.effect ?? StatusEffect.NONE) === StatusEffect.NONE,
    ).length;
    // One extra hit per healthy member, capped at maxHits total.
    hitCount.value = Math.min(hitCount.value + healthy, this.maxHits);
  }
}
