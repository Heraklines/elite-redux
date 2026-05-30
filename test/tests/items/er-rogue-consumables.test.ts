/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — behavioral tests for the two Rogue-tier consumables:
//   - Ability Randomizer  → rerolls the holder's ability (never Truant/Slow Start)
//   - Move Slot Expander   → grants a permanent 5th move slot (once per Pokémon)
// =============================================================================

import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import type { PokemonAddMoveSlotModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Rogue consumables — Ability Randomizer / Move Slot Expander", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingLevel(50).enemySpecies(SpeciesId.SHUCKLE);
  });

  test("Ability Randomizer changes the ability and never rolls Truant/Slow Start", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    const pokemon = game.field.getPlayerPokemon();
    const original = pokemon.getAbility().id;

    const modifier = modifierTypes.ABILITY_RANDOMIZER().newModifier(pokemon)!;
    const applied = modifier.apply(pokemon);

    expect(applied).toBe(true);
    expect(pokemon.customPokemonData.ability).not.toBe(-1);
    expect(pokemon.customPokemonData.ability).not.toBe(AbilityId.TRUANT);
    expect(pokemon.customPokemonData.ability).not.toBe(AbilityId.SLOW_START);
    expect(pokemon.customPokemonData.ability).not.toBe(AbilityId.NONE);
    // The forced ability is what getAbility() now reports.
    expect(pokemon.getAbility().id).toBe(pokemon.customPokemonData.ability);
    // And it actually changed.
    expect(pokemon.getAbility().id).not.toBe(original);
  });

  test("Move Slot Expander raises the move cap from 4 to 5, once only", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    const pokemon = game.field.getPlayerPokemon();

    expect(pokemon.getMaxMoveCount()).toBe(4);
    expect(pokemon.customPokemonData.bonusMoveSlots).toBe(0);

    const first = modifierTypes.MOVE_SLOT_EXPANDER().newModifier(pokemon)!;
    expect(first.apply(pokemon)).toBe(true);
    expect(pokemon.customPokemonData.bonusMoveSlots).toBe(1);
    expect(pokemon.getMaxMoveCount()).toBe(5);

    // A second one must not stack beyond the single-slot cap.
    const second = modifierTypes.MOVE_SLOT_EXPANDER().newModifier(pokemon) as PokemonAddMoveSlotModifier;
    expect(second.shouldApply(pokemon)).toBe(false);
    expect(second.apply(pokemon)).toBe(false);
    expect(pokemon.getMaxMoveCount()).toBe(5);
  });
});
