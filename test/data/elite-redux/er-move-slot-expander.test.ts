/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Move Slot Expander — grants a 5th slot AND lets the player pick the 5th move
// from the Pokémon's learnable pool (relearn flow), filling the new slot.
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { PokemonAddMoveSlotModifier } from "#modifiers/modifier";
import { PokemonAddMoveSlotModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Item - Move Slot Expander", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.GROWL, MoveId.TAIL_WHIP, MoveId.HEADBUTT]);
  });

  test("grants a 5th slot and teaches the chosen learnable move into it", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    expect(snorlax.getMaxMoveCount()).toBe(4); // vanilla before the item
    expect(snorlax.getMoveset().length).toBe(4);

    const learnable = snorlax.getLearnableLevelMoves();
    expect(learnable.length).toBeGreaterThan(0);
    const chosenMoveId = learnable[0];

    // Apply the item choosing the first learnable move.
    const mod = new PokemonAddMoveSlotModifier(new PokemonAddMoveSlotModifierType(), snorlax.id, 0);
    mod.apply(snorlax);
    // The bonus slot opens immediately (so the subsequent learn fills it instead
    // of prompting to forget a move).
    expect(snorlax.customPokemonData.bonusMoveSlots).toBe(1);
    expect(snorlax.getMaxMoveCount()).toBe(5);
    // …and a LearnMovePhase for the chosen move is queued to fill the new slot.
    expect(globalScene.phaseManager.hasPhaseOfType("LearnMovePhase", (p: any) => p.moveId === chosenMoveId)).toBe(true);
  });

  test("cannot be used twice (slot cap)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const snorlax = game.field.getPlayerPokemon();
    const mod = new PokemonAddMoveSlotModifier(new PokemonAddMoveSlotModifierType(), snorlax.id, 0);
    expect(mod.shouldApply(snorlax)).toBe(true);
    snorlax.customPokemonData.bonusMoveSlots = 1;
    expect(mod.shouldApply(snorlax)).toBe(false);
  });
});
