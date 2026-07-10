/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `ground-entry-hazard-immunity` marker.
//
// Registration-free marker AbAttr: while the holder is Ground-type it takes NO
// switch-in damage from Stealth Rock or Spikes (a pure immunity — no heal,
// unlike `StealthRockImmunityAbAttr`). Scanned by name in
// `DamagingTrapTag.activateTrap` (the shared Spikes/Stealth-Rock hazard path),
// gated there on `pokemon.isOfType(GROUND)` so a non-Ground holder is unaffected.
//
// Wires:
//   - 308 Tectonize — "If the holder is Ground-type it is immune to Stealth Rock
//     and Spikes."
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";

/**
 * Marker attr. Presence on a Ground-type holder makes it immune to Stealth Rock
 * and Spikes entry damage. The effect is realized by the name-scan in
 * `DamagingTrapTag.activateTrap`, not by dispatch; `apply` is the base no-op.
 */
export class GroundEntryHazardImmunityAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}
