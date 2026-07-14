/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `entry-hazard-immunity` marker.
//
// Registration-free marker AbAttr: the holder takes NO effect from ANY entry
// hazard on switch-in (Spikes, Stealth Rock, Toxic Spikes, Sticky Web, Hot
// Coals, …). A total immunity, unconditional on type/grounding — scanned by
// name in `EntryHazardTag.apply` (the shared switch-in hazard path).
//
// Wires:
//   - 19 Shield Dust — ER 2.65 dex: "immune to entry hazards" (alongside the
//     powder-move immunity and the vanilla secondary-effect block).
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";

/**
 * Marker attr. Presence on the holder makes it immune to every entry hazard on
 * switch-in. The effect is realized by the name-scan in `EntryHazardTag.apply`,
 * not by dispatch; `apply` is the base no-op.
 */
export class EntryHazardImmunityAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}
