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

import { AbAttr } from "#abilities/ab-attrs";
import type { Pokemon } from "#field/pokemon";

export class PostDefendSuppressOpponentDamageBoostAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}

export function suppressesOpponentDamageBoosts(pokemon: Pokemon): boolean {
  // Defensive: damage helpers can reach this with a not-yet-initialized holder
  // (e.g. a partially set-up scene in the headless test harness).
  if (!pokemon) {
    return false;
  }
  return pokemon
    .getAllActiveAbilityAttrs()
    .some(attr => attr.constructor.name === "PostDefendSuppressOpponentDamageBoostAbAttr");
}

export function bypassesOpponentMultiHitSuppression(attr: AbAttr): boolean {
  return attr.constructor.name === "AddSecondStrikeAbAttr" || attr.constructor.name === "ErMultiHeadedAbAttr";
}
