/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Challenge QoL: you must NOT be able to CATCH a wild Pokemon the active
// challenge forbids (off-tier / off-color / off-type / off-generation). The
// capture phase (attempt-capture-phase.ts:279) asks
// ChallengeType.POKEMON_ADD_TO_PARTY before adding a caught mon to the party; a
// false result still dex-registers the mon but does NOT add it to the party
// (the "caught, but it can't join you" branch, L318-322). Each ER/vanilla
// challenge that gates the roster now overrides applyPokemonAddToParty to mirror
// its starter / in-battle legality against the wild EnemyPokemon (no isPlayer
// gate - the caught mon is an enemy). This drives those overrides on a real wild
// mon: Charmander (RED / Fire / generation 1). Gated behind ER_SCENARIO=1.
// =============================================================================

import {
  copyChallenge,
  MonoColorChallenge,
  SingleGenerationChallenge,
  SingleTypeChallenge,
  UsageTierChallenge,
} from "#data/challenge";
import { ER_COLOR_NAMES } from "#data/elite-redux/er-species-colors";
import { AbilityId } from "#enums/ability-id";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { applyChallenges, isSpeciesAllowedByActiveChallenges } from "#utils/challenge-utils";
import { BooleanHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const COLOR = (name: (typeof ER_COLOR_NAMES)[number]) => ER_COLOR_NAMES.indexOf(name) + 1;

describe.skipIf(!RUN)("ER challenge: catching is blocked outside the active challenge", () => {
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
      .enemySpecies(SpeciesId.CHARMANDER) // the wild mon we attempt to catch: RED / Fire / gen 1
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(20)
      .startingLevel(20)
      .ability(AbilityId.BALL_FETCH);
  });

  // Run a challenge's CATCH hook against the current wild EnemyPokemon and return
  // whether the mon would be allowed into the party (true) or rejected (false).
  const catchValidity = (challenge: {
    applyPokemonAddToParty(p: EnemyPokemon, h: BooleanHolder): boolean;
  }): boolean => {
    const wild = game.scene.getEnemyPokemon()!;
    const holder = new BooleanHolder(true);
    challenge.applyPokemonAddToParty(wild, holder);
    return holder.value;
  };

  it("Mono Color rejects an off-color catch and admits the matching color", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const black = new MonoColorChallenge();
    black.value = COLOR("BLACK");
    expect(catchValidity(black)).toBe(false); // Charmander is RED, not BLACK

    const red = new MonoColorChallenge();
    red.value = COLOR("RED");
    expect(catchValidity(red)).toBe(true);
  });

  it("Single Type rejects an off-type catch and admits the matching type", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const water = new SingleTypeChallenge();
    water.value = PokemonType.WATER + 1;
    expect(catchValidity(water)).toBe(false); // Charmander is Fire, not Water

    const fire = new SingleTypeChallenge();
    fire.value = PokemonType.FIRE + 1;
    expect(catchValidity(fire)).toBe(true);
  });

  it("Single Generation rejects an out-of-gen catch and admits the matching gen", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const gen2 = new SingleGenerationChallenge();
    gen2.value = 2;
    expect(catchValidity(gen2)).toBe(false); // Charmander is generation 1

    const gen1 = new SingleGenerationChallenge();
    gen1.value = 1;
    expect(catchValidity(gen1)).toBe(true);
  });

  it("Usage Tier: the catch gate enforces the exact same legality as starter select", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const wild = game.scene.getEnemyPokemon()!;

    // Tier data is fetched from the CDN (and may fail-open headless), so rather than
    // assert a specific verdict we assert EQUIVALENCE: the catch path and the
    // already-trusted starter-choice path must reach the same answer for the line.
    const tier = new UsageTierChallenge();
    tier.value = 4; // NU

    const fromCatch = new BooleanHolder(true);
    tier.applyPokemonAddToParty(wild, fromCatch);

    const fromStarter = new BooleanHolder(true);
    tier.applyStarterChoice(wild.species, fromStarter);

    expect(fromCatch.value).toBe(fromStarter.value);
  });

  // The IN-GAME path: the capture phase calls applyChallenges(POKEMON_ADD_TO_PARTY,
  // ...), which only fires challenges INSTALLED in gameMode.challenges with a non-zero
  // value. The per-class tests above call the override directly; this drives the real
  // dispatch with the challenge live in the gameMode, the way a challenge RUN does -
  // the path the user reported as "not working inside challenges".
  it("REPRO (#132): the live applyChallenges dispatch blocks an off-type wild catch", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const wild = game.scene.getEnemyPokemon()!; // Charmander (Fire)

    game.scene.gameMode.challenges = [
      copyChallenge({ id: Challenges.SINGLE_TYPE, value: PokemonType.WATER + 1, severity: 1 }),
    ];

    const addStatus = new BooleanHolder(true);
    applyChallenges(ChallengeType.POKEMON_ADD_TO_PARTY, wild, addStatus);

    expect(addStatus.value).toBe(false); // Fire mon must NOT be addable under Mono Water
  });

  // The capture phase (#132) additionally gates on isSpeciesAllowedByActiveChallenges -
  // the SAME unified roster check starter select + the party "can't use this mon"
  // message use - so every active challenge (even one without a bespoke override) blocks
  // the catch. Drive that gate directly.
  it("REPRO (#132): the unified roster gate rejects an off-type wild species, allows it with no challenge", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const wild = game.scene.getEnemyPokemon()!; // Charmander (Fire)

    game.scene.gameMode.challenges = [
      copyChallenge({ id: Challenges.SINGLE_TYPE, value: PokemonType.WATER + 1, severity: 1 }),
    ];
    expect(isSpeciesAllowedByActiveChallenges(wild.species)).toBe(false);

    game.scene.gameMode.challenges = [];
    expect(isSpeciesAllowedByActiveChallenges(wild.species)).toBe(true);
  });
});
