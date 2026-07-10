/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `status-move-type-bypass` marker.
//
// Registration-free marker AbAttr: the holder's STATUS-category moves ignore
// TYPE-based immunity/resistance (the type-chart 0x and the `isTypeImmune`
// powder/Grass 0x). Scanned by name in `Pokemon.getMoveEffectiveness`, gated
// there on `move.category === STATUS` so damaging moves are unaffected. Does NOT
// touch ability-based immunities (Soundproof, Magnet Rise, substitute) — those
// are applied on separate paths and still hold. The status-application type
// immunities (Toxic vs Steel, Will-O-Wisp vs Fire) live in `canSetStatus` and
// are handled separately via `IgnoreTypeStatusEffectImmunityAbAttr`.
//
// Wires:
//   - 510 Mycelium Might — "Status moves bypass all immunities and type
//     resistances, but move last in their bracket."
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";

/**
 * Marker attr. Presence makes the holder's STATUS-category moves treat a
 * type-based effectiveness of 0x as neutral (1x). Realized by the name-scan in
 * `Pokemon.getMoveEffectiveness`; `apply` is the base no-op.
 */
export class StatusMoveTypeImmunityBypassAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}
