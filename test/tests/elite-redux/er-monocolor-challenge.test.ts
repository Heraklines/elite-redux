/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #388 - Mono Color challenge: the whole team must share one of the ten
// official ER dex colors (er-species-colors.ts, the ROM's own table). Starters
// must match the chosen color; a Pokemon whose CURRENT species color stops
// matching (evolution color change) becomes unusable in battle, mirroring
// Mono Type. Grants 5 Favour. Gated behind ER_SCENARIO=1.
// =============================================================================

import { allChallenges, MonoColorChallenge } from "#data/challenge";
import { erDexColorIndexOf } from "#data/elite-redux/er-monocolor";
import { getChallengeFavour } from "#data/elite-redux/er-shiny-favour";
import { ER_COLOR_NAMES } from "#data/elite-redux/er-species-colors";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { BooleanHolder } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const COLOR = (name: (typeof ER_COLOR_NAMES)[number]) => ER_COLOR_NAMES.indexOf(name) + 1;

describe.skipIf(!RUN)("ER Mono Color challenge (#388)", () => {
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
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(50)
      .startingLevel(50)
      .ability(AbilityId.BALL_FETCH);
  });

  it("is registered, has 10 color values and grants 5 Favour", () => {
    const challenge = allChallenges.find(c => c.id === Challenges.MONO_COLOR)!;
    expect(challenge).toBeDefined();
    expect(challenge.maxValue).toBe(10);
    const active = new MonoColorChallenge();
    active.value = COLOR("RED");
    expect(getChallengeFavour(active)).toBe(5);
    active.value = 0;
    expect(getChallengeFavour(active)).toBe(0);
  });

  it("the ROM color table resolves onto pokerogue species", () => {
    expect(ER_COLOR_NAMES[erDexColorIndexOf(SpeciesId.CHARMANDER)!]).toBe("RED");
    expect(ER_COLOR_NAMES[erDexColorIndexOf(SpeciesId.BULBASAUR)!]).toBe("GREEN");
    expect(ER_COLOR_NAMES[erDexColorIndexOf(SpeciesId.SQUIRTLE)!]).toBe("BLUE");
    expect(ER_COLOR_NAMES[erDexColorIndexOf(SpeciesId.SNORLAX)!]).toBe("BLACK");
  });

  it("starter choice: only species of the chosen color are valid", () => {
    const challenge = new MonoColorChallenge();
    challenge.value = COLOR("RED");
    const validRed = new BooleanHolder(true);
    challenge.applyStarterChoice(getPokemonSpecies(SpeciesId.CHARMANDER), validRed);
    expect(validRed.value).toBe(true);
    const validBlue = new BooleanHolder(true);
    challenge.applyStarterChoice(getPokemonSpecies(SpeciesId.SQUIRTLE), validBlue);
    expect(validBlue.value).toBe(false);
  });

  it("in battle: a player mon of the wrong color is invalid, the right color stays valid", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;

    const black = new MonoColorChallenge();
    black.value = COLOR("BLACK");
    const validBlack = new BooleanHolder(true);
    black.applyPokemonInBattle(player, validBlack);
    expect(validBlack.value).toBe(true);

    const red = new MonoColorChallenge();
    red.value = COLOR("RED");
    const validRed = new BooleanHolder(true);
    red.applyPokemonInBattle(player, validRed);
    expect(validRed.value).toBe(false);

    // Enemies are never restricted.
    const enemy = game.scene.getEnemyPokemon()!;
    const enemyValid = new BooleanHolder(true);
    red.applyPokemonInBattle(enemy, enemyValid);
    expect(enemyValid.value).toBe(true);
  });
});
