/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `recoil-damage-multiplier` archetype.
//
// Engine-side hook: src/data/moves/move.ts:RecoilAttr.apply iterates the
// user's attrs by constructor.name and calls `fire(multHolder)` on any
// instance of this class — allowing abilities to multiply the recoil
// damage taken by a factor.
//
// Wires:
//   - 7 Limber — "takes half recoil" → factor 0.5
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import type { NumberHolder } from "#utils/common";

export interface RecoilDamageMultiplierOptions {
  /** Multiplier applied to recoil damage (e.g. 0.5 = half recoil). */
  readonly factor: number;
}

export class RecoilDamageMultiplierAbAttr extends AbAttr {
  constructor(private readonly opts: RecoilDamageMultiplierOptions) {
    super(false);
    if (!(opts.factor > 0 && opts.factor < 1)) {
      throw new Error(`[RecoilDamageMultiplierAbAttr] factor must be in (0, 1); got ${opts.factor}`);
    }
  }

  /** Called by move.ts when the holder's recoil damage is being computed. */
  public fire(multHolder: NumberHolder): void {
    multHolder.value *= this.opts.factor;
  }
}
