/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / id-resync drift regression guard.
//
// Commit cfd9c8d realigned 81 ER ability draft ids in `er-abilities.ts` to the
// v2.65 JSON positions to fix species→ability registration — but the archetype
// classifier had keyed `er-ability-archetypes.ts` / `er-composite-parts.ts` by
// the PRE-realignment ids. Result: every drifted ability (Marine Apex, Lightsaber,
// Lucha Libre, …) was silently wired with a NEIGHBOUR ability's archetype.
//
// The fix re-keyed both data tables AND the dispatcher's hand-wired `case`
// labels to the current draft ids. This test pins that consistency so a future
// `pnpm run er:classify-abilities` (or any id shuffle) that re-introduces the
// drift fails loudly instead of silently mis-wiring abilities.
//
// Pure data assertions — no GameManager, fast. Behavioural coverage of the same
// abilities lives in er-composite-riders / er-offensive-chance-status.
// =============================================================================

import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { describe, expect, it } from "vitest";

/** Representative drifted abilities: {draftId, name, expected archetype}. */
const PINS: { id: number; name: string; archetype: string }[] = [
  { id: 386, name: "Spectralize", archetype: "type-conversion" },
  // 387 Spectral Shroud was reclassified to bespoke (audit-fix): the prior
  // chance-status-on-hit row wired only the 30% poison and dropped the
  // Spectralize (Normal→Ghost +1.2x) identity. Bespoke now wires both halves.
  { id: 387, name: "Spectral Shroud", archetype: "bespoke" },
  { id: 390, name: "Marine Apex", archetype: "composite-vanilla-mashup" },
  { id: 391, name: "Mighty Horn", archetype: "flag-damage-boost" },
  { id: 872, name: "Molten Core", archetype: "composite-vanilla-mashup" },
  // 909 Lightsaber is bespoke (pure hand-wired, no vanilla parts) — both halves
  // ("Adds Fire-type. Keen Edge moves 25% burn") wired in dispatchBespokeR48.
  { id: 909, name: "Lightsaber", archetype: "bespoke" },
  { id: 912, name: "Laser Drill", archetype: "chance-status-on-hit" },
  { id: 980, name: "Overcast", archetype: "bespoke" },
  { id: 984, name: "Mucus Membrane", archetype: "composite-vanilla-mashup" },
  { id: 985, name: "Lucha Libre", archetype: "composite-vanilla-mashup" },
  { id: 1025, name: "Reaper's Embarce", archetype: "composite-vanilla-mashup" },
  { id: 1026, name: "Foul Energy", archetype: "type-damage-boost" },
];

/** Offensive chance-status abilities whose `direction` annotation must survive.
 * (387 Spectral Shroud was moved to bespoke — its poison is now wired directly.) */
const OFFENSE_DIRECTION_IDS = [912, 295, 441];

describe("ER id-resync wiring consistency (#103)", () => {
  const byId = new Map<number, string>();
  for (const a of ER_ABILITIES) {
    if (!byId.has(a.id)) {
      byId.set(a.id, a.name);
    }
  }

  it.each(PINS)("draft $id ($name) → er-abilities name matches", ({ id, name }) => {
    expect(byId.get(id)).toBe(name);
  });

  it.each(PINS)("draft $id ($name) → archetype $archetype", ({ id, archetype }) => {
    const row = ER_ABILITY_ARCHETYPES[id];
    expect(row, `no archetype row for ${id}`).toBeDefined();
    expect(row.archetype).toBe(archetype);
  });

  it.each(OFFENSE_DIRECTION_IDS)("draft %i keeps its offensive chance-status direction", id => {
    const row = ER_ABILITY_ARCHETYPES[id];
    expect(row?.archetype).toBe("chance-status-on-hit");
    expect((row?.params as { direction?: string } | null)?.direction).toBeDefined();
  });
});
