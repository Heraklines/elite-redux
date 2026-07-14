/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `defense-stat-swap-on-statused-foe` archetype.
//
// Exploit Weakness (284): "When attacking a statused opponent, the attack targets
// their LOWER defensive stat." This is a genuine defensive-stat SWAP in the damage
// formula — the attacker's damage is computed against whichever of the defender's
// EFFECTIVE Def / SpDef (stat stages included) is lower — NOT a capped power-ratio
// proxy. The mechanic lives in `LowerDefensiveStatVsStatusedFoeAbAttr`
// (`ab-attrs.ts`), which `Pokemon.getAttackDamage` invokes source-side (gated on
// the defender being statused) via `applyAbAttrs`. This archetype class is a thin
// alias so the dispatcher wiring (case 284) keeps its historical name; `getAttrs`
// / `applyAbAttrs` still resolve it through the base class (instanceof match).
//
// Wires:
//   - 284 Exploit Weakness — "Targets lowest defense vs statused foes."
// =============================================================================

import { LowerDefensiveStatVsStatusedFoeAbAttr } from "#abilities/ab-attrs";

export class DefenseStatSwapOnStatusedFoeAbAttr extends LowerDefensiveStatVsStatusedFoeAbAttr {}
