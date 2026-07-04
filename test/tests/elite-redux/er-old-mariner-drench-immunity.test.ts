/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Old Mariner (620) drench immunity.
//
// DEX: "If user is Grass-type... half damage from Fire... 2x damage to Fire-type
// with Grass moves... Grants STAB to Water-type moves regardless of typing. Also
// provides immunity to being drenched."
//
// The Seaweed (Grass-gated Fire interaction) + Water STAB pieces already worked.
// This pins the ADDED drench-immunity marker (DrenchImmunityAbAttr).
//
// NOTE: DRENCH itself is NOT yet implemented engine-wide in this port (no move
// applies it; `resolveStatusName` returns null for it). The immunity is therefore
// verified as CORRECT-BY-CONSTRUCTION: the marker is present on the built ability
// so that, the moment a DRENCH source lands and gates on
// `hasAbilityWithAttr("DrenchImmunityAbAttr")`, Old Mariner (and Amphibious) are
// already immune. See DrenchImmunityAbAttr's doc for exactly what DRENCH requires.
// =============================================================================

import { DrenchImmunityAbAttr } from "#abilities/ab-attrs";
import type { AbAttr } from "#data/abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { describe, expect, it } from "vitest";

/** Resolve an ER ability id to its dispatched AbAttr list via its archetype row. */
function attrsFor(erId: number): readonly AbAttr[] {
  const row = ER_ABILITY_ARCHETYPES[erId];
  expect(row, `no archetype row for er ability ${erId}`).toBeDefined();
  return dispatchArchetype(row.archetype, row.params, erId).attrs;
}

describe("ER - Old Mariner / Amphibious drench immunity (marker)", () => {
  it("Old Mariner (620) wires both Water STAB and the drench-immunity marker", () => {
    const attrs = attrsFor(620);
    const stab = attrs.filter((a): a is StabAddAbAttr => a instanceof StabAddAbAttr);
    expect(stab, "Old Mariner should still grant Water STAB").toHaveLength(1);
    expect(
      attrs.some(a => a instanceof DrenchImmunityAbAttr),
      "Old Mariner should carry the drench-immunity marker",
    ).toBe(true);
  });

  it("Amphibious (297) also wires the drench-immunity marker", () => {
    const attrs = attrsFor(297);
    expect(
      attrs.some(a => a instanceof StabAddAbAttr),
      "Amphibious should still grant Water STAB",
    ).toBe(true);
    expect(
      attrs.some(a => a instanceof DrenchImmunityAbAttr),
      "Amphibious should carry the drench-immunity marker",
    ).toBe(true);
  });
});
