/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Darmanitan Redux Bond -> Blunder Battle Bond form change.
//
// Model: SPECIES_DARMANITAN_REDUX_BOND (pkrg 10813) carries Battle Bond as an
// innate (ER innate id 210 = AbilityId.BATTLE_BOND, installed as a passive). Its
// BASE form IS the "Bond" state. On a KO, the generic Battle Bond wiring in
// init-abilities.ts (PostVictoryFormChangeAbAttr + getBattleBondTargetFormIndex,
// reading a SpeciesFormChangeAbilityTrigger from pokemonFormChanges) promotes it
// one-way to the injected "blunder" form (the heavier stat line from
// SPECIES_DARMANITAN_REDUX_BLUNDER, pkrg 10818) — like Greninja -> Ash-Greninja.
//
// The fully-evolved Darmanitan Redux battle forms (Bond / Blunder / Aura) must
// NOT hatch from eggs or appear as starters — only the base of the line
// (Darumaka Redux) hatches.
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { speciesStarterCosts } from "#balance/starters";
import { allSpecies } from "#data/data-lists";
import { SpeciesFormChangeAbilityTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges, type SpeciesFormChange } from "#data/pokemon-forms";
import { AbilityId } from "#enums/ability-id";
import type { EggTier } from "#enums/egg-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ER customs aren't in the SpeciesId enum, so these numeric ids are widened to
// the enum type for use with the SpeciesId-typed APIs.
/** Pokerogue species id of Darmanitan Redux Bond (ER id 2630). */
const BOND_ID = 10813 as SpeciesId;
/** Pokerogue species id of Blunder-Darmanitan (ER id 2635). */
const BLUNDER_ID = 10818 as SpeciesId;
/** Pokerogue species id of Darmanitan Aura (ER id 2629). */
const AURA_ID = 10812 as SpeciesId;

describe("ER - Darmanitan Redux Bond -> Blunder (Battle Bond)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("injects the blunder form + a Bond->Blunder ability-trigger edge, and 10813 has Battle Bond", () => {
    const bond = allSpecies.find(s => s.speciesId === BOND_ID);
    expect(bond, "Darmanitan Redux Bond should be registered").toBeDefined();
    expect(
      bond?.forms.map(f => f.formKey),
      "10813 should have base + blunder forms",
    ).toEqual(expect.arrayContaining(["", "blunder"]));

    // 10813 carries Battle Bond (as an innate/passive).
    const passives = bond?.getPassiveAbilities() ?? [];
    expect(passives, "10813 should carry Battle Bond as an innate").toContain(AbilityId.BATTLE_BOND);

    // The Bond -> Blunder edge exists and is an ability-trigger (Battle Bond reads this).
    const fcs = pokemonFormChanges[BOND_ID] as SpeciesFormChange[] | undefined;
    expect(fcs, "10813 should have form changes registered").toBeDefined();
    const edge = (fcs as SpeciesFormChange[]).find(fc => fc.preFormKey === "" && fc.formKey === "blunder");
    expect(edge, "10813 should have a base -> blunder edge").toBeDefined();
    expect(
      edge?.findTrigger(SpeciesFormChangeAbilityTrigger),
      "the Bond -> Blunder edge must use a SpeciesFormChangeAbilityTrigger",
    ).toBeTruthy();
    // One-way (no revert edge), like Greninja -> Ash-Greninja.
    const revert = (fcs as SpeciesFormChange[]).find(fc => fc.preFormKey === "blunder");
    expect(revert, "Bond -> Blunder is one-way; there should be no revert edge").toBeUndefined();
  });

  it("keeps Bond / Blunder / Aura out of the egg pool and starter grid", () => {
    const tiers = speciesEggTiers as Record<number, EggTier | undefined>;
    const costs = speciesStarterCosts as Record<number, number | undefined>;
    for (const id of [BOND_ID, BLUNDER_ID, AURA_ID]) {
      expect(tiers[id], `species ${id} must not be in speciesEggTiers`).toBeUndefined();
      expect(costs[id], `species ${id} must not be in speciesStarterCosts`).toBeUndefined();
    }
  });

  it("transforms Bond -> Blunder on a KO", async () => {
    await game.classicMode.startBattle([BOND_ID]);

    const darmanitan = game.field.getPlayerPokemon();
    expect(darmanitan.getFormKey()).toBe("");

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // Battle Bond should have promoted Bond -> Blunder on the KO.
    expect(darmanitan.getFormKey()).toBe("blunder");
  });
});
