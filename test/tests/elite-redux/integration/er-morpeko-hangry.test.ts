/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Morpeko (Full Belly / Hangry) ER-custom species regression suite.
//
// ER models Morpeko's Hangry mode (and Morpekyll's) as SEPARATE custom species
// (SPECIES_MORPEKO_HANGRY → 10393, SPECIES_MORPEKYLL_HANGRY → 10455) rather than
// vanilla full-belly/hangry FORMS. Three user-reported bugs stemmed from that:
//
//   (a) The Hangry customs leaked into the egg pool + starter selection. A rare
//       egg hatched "Morpekyll Hangry" at Lv5 already in Hangry mode, and the
//       Hangry custom showed up as a directly selectable starter — violating the
//       rule that only base/root mons appear there. They must be filtered out as
//       battle-only alt-forms (same class as Mega/Primal).
//
//   (b) `species.getPassiveAbility()` (the legacy single-passive lookup) logged
//       "No passive ability found for 10455, using run away" because ER customs
//       have no `starterPassiveAbilities` entry and no prevolution chain. It now
//       consults the installed `_passives` triple's slot-0 entry first.
//
//   (c) Two-Faced (Morpeko's Hunger Switch composite) carries PostTurnFormChange
//       attrs. On these custom species — which have NO alternate forms — the attr
//       resolved a phantom non-existent target form every turn, firing the passive
//       popup + a no-op form change each turn. `canApply` now requires the target
//       form to actually exist, so single-form species never fire it (no popup,
//       no effect) while vanilla two-form Morpeko keeps toggling normally.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { PostTurnFormChangeAbAttr } from "#data/abilities/ab-attrs";
import { allSpecies } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErSpeciesId } from "#enums/er-species-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const MORPEKYLL_HANGRY = ErSpeciesId.MORPEKYLL_HANGRY; // 10455
const MORPEKO_HANGRY = ErSpeciesId.MORPEKO_HANGRY; // 10393
const MORPEKYLL = ErSpeciesId.MORPEKYLL; // 10048 (the base evolution — should remain valid)

describe.skipIf(!RUN)("ER Morpeko (Full Belly / Hangry) customs", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // (a) Hangry customs are battle-only alt-forms — never hatchable, never starters.
  it("excludes the Hangry customs from the egg pool and starter selection", () => {
    expect(speciesEggTiers[MORPEKYLL_HANGRY]).toBeUndefined();
    expect(speciesStarterCosts[MORPEKYLL_HANGRY]).toBeUndefined();
    expect(speciesEggTiers[MORPEKO_HANGRY]).toBeUndefined();
    expect(speciesStarterCosts[MORPEKO_HANGRY]).toBeUndefined();
  });

  // (b) The legacy single-passive lookup resolves a real ability (no run-away log).
  it("resolves a registered passive for the Hangry customs (no run-away fallback)", () => {
    const morpekyllHangry = allSpecies.find(s => s.speciesId === MORPEKYLL_HANGRY);
    const morpekoHangry = allSpecies.find(s => s.speciesId === MORPEKO_HANGRY);
    expect(morpekyllHangry).toBeDefined();
    expect(morpekoHangry).toBeDefined();

    // slot-0 of the installed `_passives` triple is the legacy single passive.
    expect(morpekyllHangry!.getPassiveAbility(0)).toBe(morpekyllHangry!.getPassiveAbilities(0)[0]);
    expect(morpekoHangry!.getPassiveAbility(0)).toBe(morpekoHangry!.getPassiveAbilities(0)[0]);

    // …and that passive is a real ability, NOT the RUN_AWAY fallback.
    expect(morpekyllHangry!.getPassiveAbility(0)).not.toBe(AbilityId.RUN_AWAY);
    expect(morpekoHangry!.getPassiveAbility(0)).not.toBe(AbilityId.RUN_AWAY);
  });

  // (c) PostTurnFormChange no-op popup guard: single-form custom species never fire it;
  //     vanilla two-form Morpeko still toggles.
  it("PostTurnFormChange never fires on a single-form Hangry custom, but toggles vanilla Morpeko", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);

    // Build the same Hunger-Switch-style form func pair used in init-abilities.
    const toHangry = new PostTurnFormChangeAbAttr(p => (p.getFormKey() ? 0 : 1));
    const toFull = new PostTurnFormChangeAbAttr(p => (p.getFormKey() ? 1 : 0));

    // Custom Hangry species has forms: [] → no valid target form → never applies.
    const hangry = game.scene.addPlayerPokemon(getPokemonSpecies(MORPEKYLL_HANGRY), 5);
    expect(hangry.species.forms.length).toBe(0);
    expect(toHangry.canApply({ pokemon: hangry, simulated: true })).toBe(false);
    expect(toFull.canApply({ pokemon: hangry, simulated: true })).toBe(false);

    // Vanilla Morpeko has two forms (full-belly idx 0, hangry idx 1) → still toggles.
    // The two form funcs mirror init-abilities' Hunger Switch wiring; exactly one is
    // applicable per turn (the one whose target differs from the current form).
    const morpeko = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MORPEKO), 5);
    expect(morpeko.species.forms.length).toBeGreaterThanOrEqual(2);
    morpeko.formIndex = 0; // full-belly (formKey is truthy)
    const fullBellyApplicable = [toHangry, toFull].filter(a => a.canApply({ pokemon: morpeko, simulated: true }));
    expect(fullBellyApplicable).toHaveLength(1); // exactly one switches it to hangry

    morpeko.formIndex = 1; // hangry (formKey "hangry" is also truthy, but index differs)
    const hangryApplicable = [toHangry, toFull].filter(a => a.canApply({ pokemon: morpeko, simulated: true }));
    expect(hangryApplicable).toHaveLength(1); // exactly one switches it back to full-belly
  });

  // The base evolution (Morpekyll, full-belly) is NOT a Hangry form and stays valid.
  it("keeps the base Morpekyll evolution out of eggs via its prevolution (unchanged)", () => {
    // Morpekyll is an evolution of Morpeko, so it is prevolution-gated, not
    // Hangry-gated. It must not regress into the egg pool from the Hangry filter.
    expect(speciesEggTiers[MORPEKYLL]).toBeUndefined();
  });
});
