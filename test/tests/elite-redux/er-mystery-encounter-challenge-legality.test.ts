/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #126 - Roster-challenge legality for the three VANILLA mystery encounters that
// GRANT or TRANSFORM-INTO a party Pokemon OUTSIDE the catch hook:
//   1. Global Trade System  -> generateTradeOption (random trade roll)
//   2. Weird Dream          -> getTransformedSpecies (whole-party transform)
//   3. The Pokemon Salesman -> getSalesmanSpeciesOffer (sells via catchPokemon,
//                              which bypasses POKEMON_ADD_TO_PARTY entirely)
// Each must only ever produce a species that is legal under the run's active
// roster challenge (Mono Type / Mono Generation / Mono Color / Usage Tier). The
// single source of truth is checkStarterValidForChallenge (soft) - the same
// predicate starter-select uses - reached via isSpeciesAllowedByActiveChallenges.
// With NO active challenge the pools must stay unrestricted. ER_SCENARIO=1 gated.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { MonoColorChallenge, SingleTypeChallenge } from "#data/challenge";
import { ER_COLOR_NAMES } from "#data/elite-redux/er-species-colors";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { generateTradeOption } from "#mystery-encounters/global-trade-system-encounter";
import { getSalesmanSpeciesOffer } from "#mystery-encounters/the-pokemon-salesman-encounter";
import { getTransformedSpecies } from "#mystery-encounters/weird-dream-encounter";
import { GameManager } from "#test/framework/game-manager";
import { checkStarterValidForChallenge } from "#utils/challenge-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Sweep a species-selection helper N times and return every distinct species it produced. */
const collect = (rolls: number, roll: () => PokemonSpecies): PokemonSpecies[] => {
  const out: PokemonSpecies[] = [];
  for (let i = 0; i < rolls; i++) {
    out.push(roll());
  }
  return out;
};

/** The exact gate the three MEs use: legal == valid as a (soft) starter under every active challenge. */
const isLegal = (s: PokemonSpecies) =>
  checkStarterValidForChallenge(s, { shiny: false, female: false, variant: 0, formIndex: 0 }, true);

describe.skipIf(!RUN)("ER mystery-encounter roster-challenge legality (#126)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(50)
      .startingLevel(50)
      .ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    // Clear any challenge we pushed so other tests see no active roster challenge.
    for (const c of globalScene.gameMode?.challenges ?? []) {
      c.value = 0;
    }
  });

  /** Push (or reuse) a Mono Type challenge for the given type and activate it. */
  const activateMonoType = (type: PokemonType) => {
    const challenges = globalScene.gameMode.challenges;
    let c = challenges.find(ch => ch.id === Challenges.SINGLE_TYPE) as SingleTypeChallenge | undefined;
    if (!c) {
      c = new SingleTypeChallenge();
      challenges.push(c);
    }
    c.value = type + 1; // value is the 1-based PokemonType index
  };

  /** Push (or reuse) a Mono Color challenge for the given 1-based color value and activate it. */
  const activateMonoColor = (colorValue: number) => {
    const challenges = globalScene.gameMode.challenges;
    let c = challenges.find(ch => ch.id === Challenges.MONO_COLOR) as MonoColorChallenge | undefined;
    if (!c) {
      c = new MonoColorChallenge();
      challenges.push(c);
    }
    c.value = colorValue;
  };

  /** Remove every challenge so the pools are unrestricted. */
  const clearChallenges = () => {
    for (const c of globalScene.gameMode?.challenges ?? []) {
      c.value = 0;
    }
  };

  // --- Sanity: with no challenge, the predicate accepts everything ------------
  it("with no active challenge, every species selection is allowed (pools unrestricted)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    clearChallenges();

    // GTS: a mid-BST trade roll should produce species of varied types.
    const trades = collect(40, () => generateTradeOption([], 500));
    expect(trades.every(isLegal)).toBe(true);
    expect(new Set(trades.map(s => s.type1)).size).toBeGreaterThan(1);

    // Weird Dream: transforms should be varied (fresh range tuple each call - it mutates by ref).
    const transforms = collect(40, () => getTransformedSpecies(480, [40, 50], false, false, []));
    expect(transforms.every(isLegal)).toBe(true);
    expect(new Set(transforms.map(s => s.type1)).size).toBeGreaterThan(1);

    // Salesman: offers should be varied across many rolls.
    const sales = collect(40, () => getSalesmanSpeciesOffer());
    expect(sales.every(isLegal)).toBe(true);
    expect(new Set(sales.map(s => s.type1)).size).toBeGreaterThan(1);
  });

  // --- Mono Type (Water): every selection must be challenge-legal ------------
  it("Global Trade System: every trade roll is legal under a Mono Type (Water) challenge", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    activateMonoType(PokemonType.WATER);

    const trades = collect(60, () => generateTradeOption([], 500));
    const illegal = trades.filter(s => !isLegal(s));
    expect(
      illegal,
      `GTS offered challenge-illegal species: ${illegal.map(s => `${s.name}(${s.speciesId})`).join(", ")}`,
    ).toEqual([]);
  });

  it("Weird Dream: every transform target is legal under a Mono Type (Water) challenge", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    activateMonoType(PokemonType.WATER);

    // Fresh range tuple each call (getTransformedSpecies mutates bstSearchRange by ref).
    const transforms = collect(60, () => getTransformedSpecies(480, [40, 50], false, false, []));
    const illegal = transforms.filter(s => !isLegal(s));
    expect(
      illegal,
      `Weird Dream transformed into challenge-illegal species: ${illegal.map(s => `${s.name}(${s.speciesId})`).join(", ")}`,
    ).toEqual([]);
  });

  it("The Pokemon Salesman: every offer is legal under a Mono Type (Water) challenge", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    activateMonoType(PokemonType.WATER);

    const sales = collect(60, () => getSalesmanSpeciesOffer());
    const illegal = sales.filter(s => !isLegal(s));
    expect(
      illegal,
      `Salesman offered challenge-illegal species: ${illegal.map(s => `${s.name}(${s.speciesId})`).join(", ")}`,
    ).toEqual([]);
  });

  // --- Mono Color (Blue): a second, ER-only challenge axis -------------------
  it("all three encounters stay legal under a Mono Color (Blue) challenge", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    activateMonoColor(ER_COLOR_NAMES.indexOf("BLUE") + 1);

    const trades = collect(40, () => generateTradeOption([], 500));
    const transforms = collect(40, () => getTransformedSpecies(480, [40, 50], false, false, []));
    const sales = collect(40, () => getSalesmanSpeciesOffer());

    expect(
      trades.filter(s => !isLegal(s)),
      "GTS offered an off-color species",
    ).toEqual([]);
    expect(
      transforms.filter(s => !isLegal(s)),
      "Weird Dream transformed into an off-color species",
    ).toEqual([]);
    expect(
      sales.filter(s => !isLegal(s)),
      "Salesman offered an off-color species",
    ).toEqual([]);
  });
});
