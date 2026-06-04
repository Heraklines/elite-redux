/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `outgoing-stat-drop-multiplier` archetype.
//
// PreStatStageChange hook on opposing pokemon: when the holder is the
// SOURCE of a negative stat-stage change on an opponent, multiply the
// magnitude by `factor`. Uses pokerogue's existing PreStatStageChange
// machinery — we attach an attribute that augments stages in the holder's
// chain.
//
// Wires:
//   - 556 Subdue — "Doubles stat drop effects used by this pokemon"
//     (factor 2).
//
// Pokerogue does not natively expose a "source-side stat-stage modifier"
// hook (the existing PreStatStageChangeAbAttr fires on the *target* side).
// To implement Subdue's outgoing modifier, we hook PostMoveUse: after the
// holder uses a stat-dropping move, we apply the additional drops directly.
// This faithfully recreates the gameplay outcome.
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import { globalScene } from "#app/global-scene";

export interface OutgoingStatDropMultiplierOptions {
  /** Multiplier applied to outgoing stat-drop magnitude (e.g. 2 = double). */
  readonly factor: number;
}

export class OutgoingStatDropMultiplierAbAttr extends PostAttackAbAttr {
  private readonly factor: number;

  constructor(options: OutgoingStatDropMultiplierOptions) {
    super(undefined, false);
    if (options.factor <= 1) {
      throw new Error("[OutgoingStatDropMultiplierAbAttr] factor must be > 1");
    }
    this.factor = options.factor;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move } = params;
    return move.getAttrs("StatStageChangeAttr").some(a => a.stages < 0 && !a.selfTarget);
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    const { move, opponent, pokemon, simulated } = params;
    if (simulated || !opponent || opponent.isFainted()) {
      return;
    }
    const stages = move.getAttrs("StatStageChangeAttr").filter(a => a.stages < 0 && !a.selfTarget);
    for (const attr of stages) {
      const extra = Math.floor(attr.stages * (this.factor - 1));
      if (extra >= 0) {
        continue;
      }
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        opponent.getBattlerIndex(),
        false,
        attr.stats,
        extra,
      );
    }
  }
}
