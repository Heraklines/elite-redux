/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Knight's Honor` (newcomer patch, Mega Dragonite Z).
//
// The DEFENSIVE counterpart of King's Wrath (er 409): "Lowering any stats on its
// side raises Def and Sp. Def." (King's Wrath raises Atk + Def.) It reuses the
// exact `stat-trigger-on-event` archetype primitives King's Wrath is built from
// — the self half (`StatTriggerOnStatLoweredAbAttr`, `scope: "side"`, once per
// stat lowered) plus the ally half (`StatTriggerOnAllyStatLoweredAbAttr`) — only
// the stat payload differs. Not a config on an auto-generated row (this is a
// manual-id ability), so we expose a factory the ability builder wires directly.
// =============================================================================

import type { AbAttr } from "#abilities/ab-attrs";
import {
  StatTriggerOnAllyStatLoweredAbAttr,
  StatTriggerOnStatLoweredAbAttr,
} from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { Stat } from "#enums/stat";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_KNIGHTS_HONOR_ABILITY_ID = 5939;

const KNIGHTS_HONOR_STATS = [
  { stat: Stat.DEF, stages: 1 },
  { stat: Stat.SPDEF, stages: 1 },
] as const;

/**
 * Build the two AbAttrs that make up Knight's Honor. Mirrors the King's Wrath
 * wiring (self-side + ally-side stat-lowered triggers), swapping the Atk/Def
 * payload for Def/Sp. Def.
 */
export function knightsHonorAttrs(): AbAttr[] {
  return [
    new StatTriggerOnStatLoweredAbAttr({ stats: KNIGHTS_HONOR_STATS, scope: "side" }),
    new StatTriggerOnAllyStatLoweredAbAttr({ stats: KNIGHTS_HONOR_STATS }),
  ];
}
