/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Common Root`.
//
// "Whenever an opposing Pokemon loses HP to Leech Seed, EVERY active Pokemon on
// the holder's side recovers the ordinary Leech Seed healing amount (not just the
// seeder)." Implemented as a marker AbAttr checked inside `SeedTag.lapse`
// (mirroring how that tag already checks `ReverseDrainAbAttr`): when a Leech Seed
// tick drains a foe, allies of the seeder heal the same amount if any of them
// carries Common Root.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_COMMON_ROOT_ABILITY_ID = 5904;

/** Marker attribute; the effect is applied from {@linkcode SeedTag.lapse}. */
export class CommonRootAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}
