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
    // One extra hit per healthy OTHER party member — the holder itself does NOT
    // count (else a lone holder hit twice and a full party hit 7×). With a full
    // healthy party of 6 that's +5 -> 6 hits, matching "max 6 hits".
    const healthyAllies = party.filter(
      p => p && p !== pokemon && !p.isFainted() && (p.status?.effect ?? StatusEffect.NONE) === StatusEffect.NONE,
    ).length;
    hitCount.value = Math.min(hitCount.value + healthyAllies, this.maxHits);
  }
}
