/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite/Hell classic final boss = Cascoon → Primal Cascoon (drop-in for
// Eternatus → Eternamax). Verifies the difficulty gate and that the two-phase
// transform is wired: Cascoon must carry a "" → "primal" manual form change so
// BattleScene.initFinalBossPhaseTwo()'s generic
// triggerPokemonFormChange(SpeciesFormChangeManualTrigger) promotes phase 1 into
// phase 2 (otherwise the forced phase-1 survive-at-1HP logic would softlock).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { getErFinalBossSpecies, isErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import "#test/framework/game-manager";
import { afterEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Elite/Hell final boss (Cascoon → Primal Cascoon)", () => {
  afterEach(() => {
    setErDifficulty("ace"); // don't leak difficulty into other suites
  });

  it("replaces Eternatus with Cascoon on Elite and Hell, keeps Eternatus on Ace", () => {
    setErDifficulty("ace");
    expect(getErFinalBossSpecies()).toBeNull();

    setErDifficulty("elite");
    expect(getErFinalBossSpecies()?.speciesId).toBe(SpeciesId.CASCOON);

    setErDifficulty("hell");
    expect(getErFinalBossSpecies()?.speciesId).toBe(SpeciesId.CASCOON);

    expect(isErFinalBossSpecies(SpeciesId.CASCOON)).toBe(true);
    expect(isErFinalBossSpecies(SpeciesId.ETERNATUS)).toBe(false);
  });

  it("Cascoon has a '' → 'primal' manual form change (the phase-1 → phase-2 transform)", () => {
    const changes = pokemonFormChanges[SpeciesId.CASCOON] ?? [];
    // There may be multiple "" → "primal" entries (an item-stone trigger from the
    // ER primal bridge AND our manual trigger). The final-boss transform needs the
    // MANUAL-trigger one specifically.
    const phaseTwo = changes.find(
      fc =>
        fc.preFormKey === "" && fc.formKey === SpeciesFormKey.PRIMAL && fc.findTrigger(SpeciesFormChangeManualTrigger),
    );
    expect(phaseTwo, "Cascoon must have a ''→'primal' MANUAL form change registered").toBeDefined();
  });

  it("the Primal phase-2 form is the BST-726 jump (mirrors Eternatus → Eternamax)", () => {
    setErDifficulty("elite");
    const cascoon = getErFinalBossSpecies();
    expect(cascoon).not.toBeNull();
    const primal = cascoon?.forms.find(f => f.formKey === SpeciesFormKey.PRIMAL);
    expect(primal).toBeDefined();
    expect(primal!.baseTotal).toBe(726);
    // Phase 1 (default form) is the weak Cascoon.
    expect(cascoon!.forms[0].baseTotal).toBe(205);
  });
});
