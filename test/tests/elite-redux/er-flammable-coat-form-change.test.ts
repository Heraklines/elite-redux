/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Flammable Coat (669): Lumbering Sloth -> Engulfed form change.
//
// DEX: "Transforms Lumbering Sloth into its Engulfed form when hit by Fire-type
// moves or when using Fire-type moves. Cannot be copied or suppressed."
//
// Engulfed is a SEPARATE ER dump species (SPECIES_LUMBERING_SLOTH_ENGULFED, ER
// 1847 -> pkrg 10439) injected AS the "engulfed" form onto base Lumbering Sloth
// (pkrg 10023) with a ONE-WAY manual form-change edge. The two fire-interaction
// AbAttrs (FireUse / FireHit) fire that manual change.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges, type SpeciesFormChange } from "#data/pokemon-forms";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/** Pokerogue species id of Lumbering Sloth (ER id 1049). */
const LUMBER_SLOTH_ID = 10023 as SpeciesId;

const RUN = process.env.ER_SCENARIO === "1";

describe("ER - Flammable Coat form change (wiring)", () => {
  it("injects the engulfed form + a one-way base->engulfed manual edge onto Lumbering Sloth", () => {
    const sloth = allSpecies.find(s => s.speciesId === LUMBER_SLOTH_ID);
    expect(sloth, "Lumbering Sloth should be registered").toBeDefined();
    expect(
      sloth?.forms.map(f => f.formKey),
      "10023 should have base + engulfed forms",
    ).toEqual(expect.arrayContaining(["", "engulfed"]));

    const fcs = pokemonFormChanges[LUMBER_SLOTH_ID] as SpeciesFormChange[] | undefined;
    expect(fcs, "10023 should have form changes registered").toBeDefined();
    const transform = (fcs as SpeciesFormChange[]).find(fc => fc.preFormKey === "" && fc.formKey === "engulfed");
    expect(transform, "10023 should have a base -> engulfed edge").toBeDefined();
    expect(
      transform?.findTrigger(SpeciesFormChangeManualTrigger),
      "the base -> engulfed edge must use a SpeciesFormChangeManualTrigger",
    ).toBeTruthy();
    // One-way: no revert edge (a fire interaction must not send Engulfed back).
    const revert = (fcs as SpeciesFormChange[]).find(fc => fc.preFormKey === "engulfed");
    expect(revert, "base -> engulfed is one-way; there should be no revert edge").toBeUndefined();
  });
});

describe.skipIf(!RUN)("ER - Flammable Coat form change (behavior)", () => {
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
      .startingLevel(50)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(ErAbilityId.FLAMMABLE_COAT as unknown as AbilityId)
      .moveset([MoveId.EMBER, MoveId.SPLASH]);
  });

  it("transforms into Engulfed when the holder USES a Fire-type move", async () => {
    await game.classicMode.startBattle(LUMBER_SLOTH_ID);
    const sloth = game.field.getPlayerPokemon();
    expect(sloth.getFormKey()).toBe("");

    game.move.use(MoveId.EMBER);
    await game.toEndOfTurn();

    expect(sloth.getFormKey()).toBe("engulfed");
  });

  it("transforms into Engulfed when the holder is HIT by a Fire-type move", async () => {
    game.override.enemyMoveset(MoveId.EMBER);
    await game.classicMode.startBattle(LUMBER_SLOTH_ID);
    const sloth = game.field.getPlayerPokemon();
    expect(sloth.getFormKey()).toBe("");

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(sloth.getFormKey()).toBe("engulfed");
  });

  it("does NOT transform when using a non-Fire move", async () => {
    await game.classicMode.startBattle(LUMBER_SLOTH_ID);
    const sloth = game.field.getPlayerPokemon();

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(sloth.getFormKey()).toBe("");
  });
});
