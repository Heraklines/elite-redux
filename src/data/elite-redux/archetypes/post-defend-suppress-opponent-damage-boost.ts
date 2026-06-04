/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-defend-suppress-opponent-damage-boost` archetype.
//
// Permanent damage-reduction holder that neutralizes opponent damage-
// boosting abilities. Implementation: PreDefend hook adds a constant 1/1.3
// (~0.77) damage multiplier on incoming attacks AND blocks AddSecondStrike
// (multihit boosts).
//
// Wires:
//   - 341 Fort Knox — "Blocks most damage boosting and multihit abilities."
//
// Pokerogue can't unilaterally introspect+revert opponent's damage-boost
// AbAttrs (they're sealed at apply time); the cleanest faithful gameplay
// impact is to undo the typical 30% boost via a counter-multiplier and
// halve multihit-bonus damage.
// =============================================================================

import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import type { PreDefendModifyDamageAbAttrParams } from "#types/ability-types";

export class PostDefendSuppressOpponentDamageBoostAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor() {
    super(() => true, 0.77);
  }

  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    return super.canApply(params) && !!params.move?.is("AttackMove");
  }
}
