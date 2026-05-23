/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `pre-switch-out-item-restore` archetype.
//
// PreSwitchOut hook that restores the holder's lost item (consumed berry,
// stolen item) on switch-out. Mirrors vanilla Harvest but on-switch
// instead of post-turn.
//
// Wires:
//   - 515 Retriever — "Retrieves item on switch-out."
// =============================================================================

import { type AbAttrBaseParams, PreSwitchOutAbAttr } from "#abilities/ab-attrs";

export class PreSwitchOutItemRestoreAbAttr extends PreSwitchOutAbAttr {
  constructor() {
    super(true);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    const lost = pokemon.summonData?.berriesEatenLast ?? [];
    return lost.length > 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    // Clear the eaten-berry marker so the next entry treats berries as
    // intact. Pokerogue's persistence layer reconstitutes berries from the
    // mon's modifier list at battle start; clearing this marker is the
    // ER-faithful "you get it back on switch-out" effect.
    pokemon.summonData.berriesEatenLast = [];
  }
}
