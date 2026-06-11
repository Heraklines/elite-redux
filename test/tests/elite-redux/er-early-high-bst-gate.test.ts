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
import { BiomePoolTier } from "#enums/biome-pool-tier";
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

  // Stub the arena's wild pools so randomSpecies rolls are fully controlled.
  const stubPools = (common: SpeciesId[], others: SpeciesId[]) => {
    const pools: Record<string, SpeciesId[]> = {};
    for (const tier of Object.values(BiomePoolTier).filter(v => typeof v === "number")) {
      pools[tier as number] = tier === BiomePoolTier.COMMON ? common : others;
    }
    // biome-ignore lint/suspicious/noExplicitAny: stubbing a private field
    (globalScene.arena as any).pokemonPool = pools;
  };

  test("#395 hole 1: when the 10-reroll cap is exhausted, a COMMON-pool pick replaces the god", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    setErDifficulty("ace");
    // Every non-common tier offers ONLY Rayquaza; the gate rerolls it each
    // time. Whether the rolls eventually land on COMMON or the cap trips and
    // the safe-pool fallback kicks in, the result must NEVER be the god.
    stubPools([SpeciesId.MAGIKARP], [SpeciesId.RAYQUAZA]);
    for (let i = 0; i < 5; i++) {
      const species = globalScene.arena.randomSpecies(13, 10);
      expect(species.baseTotal).toBeLessThan(600);
    }
  });

  test("#395 hole 2: the level-evolution substitution is re-gated (Gible at lv60 must NOT become Garchomp early)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    setErDifficulty("ace");
    stubPools([SpeciesId.GIBLE], [SpeciesId.GIBLE]);
    // Level 60 would normally substitute Gible -> Garchomp (600 BST). On Ace
    // before wave 55 the substitution must be rejected.
    const early = globalScene.arena.randomSpecies(13, 60);
    expect(early.baseTotal).toBeLessThan(600);

    // Hell keeps the vanilla behavior: the substitution may produce Garchomp.
    setErDifficulty("hell");
    const hell = globalScene.arena.randomSpecies(13, 60);
    expect(hell.speciesId).toBe(SpeciesId.GARCHOMP);
  });
});
