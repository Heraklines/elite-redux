/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Deactivating (reverting) a Mega/Primal from the party menu works because
// `initPokemonForms()` auto-generates a DEACTIVATE entry (item trigger with
// active=false) for every forward Mega item trigger. That pass runs before ER
// bridges its mega/primal form changes into `pokemonFormChanges`, so ER
// megas/primals used to have NO revert entry and couldn't be turned back off —
// the reported "can't revert some megas" bug. The reverse generator is now
// re-run after ER form changes register (idempotent), filling in the gap.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeItemTrigger } from "#data/pokemon-forms/form-change-triggers";
import { SpeciesId } from "#enums/species-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Whether `species` has a deactivate (revert) item trigger from `fromFormKey` back to base. */
function hasDeactivateEntry(speciesId: SpeciesId, fromFormKey: string): boolean {
  const changes = pokemonFormChanges[speciesId] ?? [];
  return changes.some(fc => {
    const trigger = fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | null;
    return fc.preFormKey === fromFormKey && fc.formKey === "" && trigger != null && trigger.active === false;
  });
}

describe.skipIf(!RUN)("Mega/Primal forms can be reverted (deactivate entries exist)", () => {
  it("an ER primal (Cascoon) has a 'primal' → base deactivate entry", () => {
    // Forward entry exists (sanity)…
    const forward = (pokemonFormChanges[SpeciesId.CASCOON] ?? []).some(
      fc => fc.preFormKey === "" && fc.formKey === "primal",
    );
    expect(forward).toBe(true);
    // …and the revert entry that the party-menu deactivate relies on.
    expect(hasDeactivateEntry(SpeciesId.CASCOON, "primal")).toBe(true);
  });

  it("vanilla Mega Charizard still has its deactivate entries (idempotent, no regression)", () => {
    expect(hasDeactivateEntry(SpeciesId.CHARIZARD, "mega-x")).toBe(true);
    expect(hasDeactivateEntry(SpeciesId.CHARIZARD, "mega-y")).toBe(true);
  });

  it("the reverse generator did not duplicate entries (re-run is idempotent)", () => {
    const megaXReverts = (pokemonFormChanges[SpeciesId.CHARIZARD] ?? []).filter(fc => {
      const t = fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | null;
      return fc.preFormKey === "mega-x" && fc.formKey === "" && t?.active === false;
    });
    expect(megaXReverts).toHaveLength(1);
  });
});
