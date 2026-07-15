/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Mycelial Network`.
//
// "Whenever an opposing Pokemon loses HP to Infestation, the holder recovers HP
// equal to half the amount lost; if the holder is at full HP, remaining healing
// transfers to the lowest-HP living ally (only in doubles/triples; in singles the
// overflow is wasted)." Implemented as a marker AbAttr checked inside the ER
// Infestation-damage hook in `DamagingTrapTag.lapse`.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_MYCELIAL_NETWORK_ABILITY_ID = 5905;

/** Marker attribute; the effect is applied from the Infestation damage hook. */
export class MycelialNetworkAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}
