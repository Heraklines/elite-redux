/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Elite Redux: in Ace / Elite, wild Pokémon with BST >= 600 (pseudo-legends /
// box legendaries) are rerolled before wave 55, so they don't leak into the
// early game. Hell is exempt. Trainers draw from the ER roster and never flow
// through this wild gate, so they're unaffected.

import { globalScene } from "#app/global-scene";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER early high-BST wild gate (Ace/Elite)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    setErDifficulty("ace");
  });

  // Reach the private reroll predicate that randomSpecies consults.
  const shouldReroll = (speciesId: SpeciesId, wave: number): boolean =>
    // biome-ignore lint/suspicious/noExplicitAny: exercising a private method
    (globalScene.arena as any).checkLegendBST(getPokemonSpecies(speciesId), wave);

  test("Ace: a 600-BST mon (Garchomp) is gated before wave 55, allowed after", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    setErDifficulty("ace");
    expect(shouldReroll(SpeciesId.GARCHOMP, 10)).toBe(true);
    expect(shouldReroll(SpeciesId.GARCHOMP, 54)).toBe(true);
    expect(shouldReroll(SpeciesId.GARCHOMP, 55)).toBe(false);
    // A low-BST mon is never gated.
    expect(shouldReroll(SpeciesId.BULBASAUR, 10)).toBe(false);
  });

  test("Elite: same gate applies", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    setErDifficulty("elite");
    expect(shouldReroll(SpeciesId.GARCHOMP, 10)).toBe(true);
  });

  test("Hell: high-BST mons are NOT gated by the ER rule (early power spikes allowed)", async () => {
    await game.classicMode.startBattle([SpeciesId.BULBASAUR]);
    setErDifficulty("hell");
    // Garchomp is not a legend, so the only thing that could gate it is the ER
    // Ace/Elite rule — which is off in Hell.
    expect(shouldReroll(SpeciesId.GARCHOMP, 10)).toBe(false);
  });
});
