/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `multi-hit-count-override` primitive.
//
// Ability-side marker that FORCES a specific move to an exact hit count,
// overriding that move's intrinsic {@linkcode MultiHitAttr} roll. Consumed by a
// by-name scan in `MoveEffectPhase.start` (registration-free, same pattern as
// `MoveCategoryOverrideAbAttr`) AFTER the native multi-hit / Parental Bond /
// Multi-Lens hit-count is computed, so the override wins.
//
// Wires:
//   - 960 Giant Shuriken — "Water Shuriken hits once with 100BP and +1 crit."
//     Water Shuriken natively rolls 2-5 hits; this clamps it to exactly 1
//     (alongside the existing power ×6.67 and +1 crit-stage attrs).
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import type { MoveId } from "#enums/move-id";
import type { Move } from "#moves/move";

export interface MultiHitCountOverrideOptions {
  /** The move whose hit count is forced. */
  readonly moveId: MoveId;
  /** The exact number of hits to force (>= 1). */
  readonly hits: number;
}

export class OverrideMultiHitCountAbAttr extends AbAttr {
  private readonly moveId: MoveId;
  private readonly hits: number;

  constructor(options: MultiHitCountOverrideOptions) {
    super(false);
    this.moveId = options.moveId;
    this.hits = options.hits;
  }

  /**
   * The forced hit count for the given move, or `null` when this ability does
   * not override the move's hit count.
   */
  public resolveHits(move: Move): number | null {
    return move.id === this.moveId ? this.hits : null;
  }
}
