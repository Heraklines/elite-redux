/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#351): Primal Cascoon is the Elite/Hell FINAL BOSS form (#243)
// and must never be player-obtainable. The ER form-change bridge used to
// register Cascoon "" → "primal" with an ITEM trigger (Purple Orb), which put
// the orb into the reward pool for any party Cascoon. The bridge now skips
// boss-only targets; the boss's own transform uses a separate MANUAL-trigger
// edge (er-final-boss.ts) which must still exist.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { SpeciesFormChangeItemTrigger, SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Primal Cascoon is unobtainable by players (#351)", () => {
  it("Cascoon has NO item-triggered primal form change (no Purple Orb in the pool)", () => {
    const changes = pokemonFormChanges[SpeciesId.CASCOON] ?? [];
    const itemPrimal = changes.find(
      fc => fc.formKey === SpeciesFormKey.PRIMAL && fc.findTrigger(SpeciesFormChangeItemTrigger),
    );
    expect(itemPrimal, "no player-facing (item) edge to Primal Cascoon may exist").toBeUndefined();
  });

  it("the final boss's MANUAL primal edge still exists (boss fight unaffected)", () => {
    const changes = pokemonFormChanges[SpeciesId.CASCOON] ?? [];
    const manualPrimal = changes.find(
      fc => fc.formKey === SpeciesFormKey.PRIMAL && fc.findTrigger(SpeciesFormChangeManualTrigger),
    );
    expect(manualPrimal, "er-final-boss manual transform edge must remain").toBeDefined();
  });
});
