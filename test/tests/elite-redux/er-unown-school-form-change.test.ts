/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Unown "School" (Revelation) form change.
//
// ER's Revelation ability (er id 885 -> ErAbilityId.REVELATION) is the Unown
// analogue of Wishiwashi's Schooling: "Changes into Revelation form until 1/4 HP
// or less." Above 25% HP the holder should School into its buffed Revelation
// form at end of turn; at 25% HP or below it reverts to the base form.
// =============================================================================

import { pokemonFormChanges, type SpeciesFormChange } from "#data/pokemon-forms";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/** HP fraction at/below which Unown reverts out of Revelation form. */
const REVERT_HP_RATIO = 0.25;

describe("ER - Unown School (Revelation) form change", () => {
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
      .ability(ErAbilityId.REVELATION as unknown as AbilityId)
      .startingLevel(50)
      .enemyLevel(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("registers a Revelation ability-trigger form change on base Unown", () => {
    const fcs = pokemonFormChanges[SpeciesId.UNOWN];
    expect(fcs, "Unown should have form changes registered").toBeDefined();
    const intoRevelation = (fcs as SpeciesFormChange[]).find(fc => fc.formKey === "revelation");
    expect(intoRevelation, "Unown should have an into-revelation form change").toBeDefined();
    const outOfRevelation = (fcs as SpeciesFormChange[]).find(fc => fc.preFormKey === "revelation");
    expect(outOfRevelation, "Unown should have a revert-from-revelation form change").toBeDefined();
  });

  it("Schools into Revelation form (on summon at full HP, and stays Schooled at end of turn)", async () => {
    await game.classicMode.startBattle(SpeciesId.UNOWN);

    const unown = game.field.getPlayerPokemon();
    // Like Wishiwashi, Schooling happens on summon while above the HP threshold.
    expect(unown.getFormKey()).toBe("revelation");

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    // Still above threshold -> remains Schooled.
    expect(unown.getFormKey()).toBe("revelation");
  });

  it("reverts to base form at end of turn when at or below 25% HP", async () => {
    await game.classicMode.startBattle(SpeciesId.UNOWN);

    const unown = game.field.getPlayerPokemon();
    expect(unown.getFormKey()).toBe("revelation");

    // Drop to/below the 25% threshold, then end the turn. The revert is enqueued
    // as a QuietFormChangePhase during TurnEndPhase, so advance to it.
    unown.hp = Math.max(1, Math.floor(unown.getMaxHp() * REVERT_HP_RATIO) - 1);
    game.move.use(MoveId.SPLASH);
    await game.phaseInterceptor.to("QuietFormChangePhase");

    expect(unown.getFormKey()).not.toBe("revelation");
  });
});
