/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Tangled Tails (er ability 950) is the composite "Know Your Place
// + Grappler". BOTH halves must be wired:
//   - Know Your Place (er 735): contact attacks quash the attacker
//     (ContactQuashAbAttr / ER_QUASHED — "foes move last for 5 turns").
//   - Grappler (er 523): trapping moves last 6 turns and deal 1/6 max HP
//     (TrapDurationModifierAbAttr).
// Resolved-parts table: ER_COMPOSITE_PARTS[950] = [er 735, er 523].
// =============================================================================

import type { AbAttr } from "#data/abilities/ab-attrs";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { ContactQuashAbAttr } from "#data/elite-redux/archetypes/contact-quash";
import { TrapDurationModifierAbAttr } from "#data/elite-redux/archetypes/trap-duration-modifier";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { describe, expect, it } from "vitest";

describe("ER Tangled Tails — composite wires BOTH Know Your Place + Grappler", () => {
  const attrs = (): readonly AbAttr[] => {
    const row = ER_ABILITY_ARCHETYPES[950];
    expect(row, "no archetype row for Tangled Tails (950)").toBeDefined();
    return dispatchArchetype(row.archetype, row.params, 950).attrs;
  };

  it("contributes the Know Your Place quash half (ContactQuashAbAttr)", () => {
    expect(attrs().some(a => a instanceof ContactQuashAbAttr)).toBe(true);
  });

  it("contributes the Grappler trap-duration half (TrapDurationModifierAbAttr)", () => {
    expect(attrs().some(a => a instanceof TrapDurationModifierAbAttr)).toBe(true);
  });
});
