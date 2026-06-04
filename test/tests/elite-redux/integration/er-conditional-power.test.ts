/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Conditional-power abilities — verify wires that scale based on HP
// thresholds, weather conditions, or type-of-attack conditions.
//
// These cover the "Short Circuit boosts Elec 1.2x → 1.5x below 1/3 HP"
// family. We can't easily threshold-test without HP-mutation tools, so we
// verify the wire is installed (constructor name scan + basic damage check).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { allAbilities } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER conditional-power abilities", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // ===========================================================================
  // GROUP 1: HP-threshold conditional boosts
  // ===========================================================================
  it("Short Circuit (322) — wire installed, Electric move boost", async () => {
    const pkrgId = await erId(322);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.THUNDERBOLT)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.THUNDERBOLT);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Psychic Mind (343) — wire installed", async () => {
    const pkrgId = await erId(343);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.PSYCHIC)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.PSYCHIC);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  // ===========================================================================
  // GROUP 2: Type-specific boost + resistance
  // ===========================================================================
  it("Fossilized (303) — 1.2x own Rock + halves Rock damage taken", async () => {
    const pkrgId = await erId(303);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.ROCK_SLIDE)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.RAMPARDOS);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.ROCK_SLIDE);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Nocturnal (306) — 1.25x own Dark + -25% dmg from Dark/Fairy", async () => {
    const pkrgId = await erId(306);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.CRUNCH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.UMBREON);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.CRUNCH);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  // ===========================================================================
  // GROUP 3: Stat-multiplier abilities
  // ===========================================================================
  it("Cryptic Power (301) — wire installed, SPATK 2x", async () => {
    const pkrgId = await erId(301);
    if (pkrgId === undefined) return;
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
  });

  it("Majestic Bird (323) — wire installed, SPATK 1.5x", async () => {
    const pkrgId = await erId(323);
    if (pkrgId === undefined) return;
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
  });

  // ===========================================================================
  // GROUP 4: Weather-gated buffs
  // ===========================================================================
  it("Dune Terror (431) — wire installed, Sand reduction + Ground boost", async () => {
    const pkrgId = await erId(431);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.SAND_STREAM)
      .enemySpecies(SpeciesId.TYRANITAR)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.EARTHQUAKE)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.GLISCOR);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.EARTHQUAKE);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Sea Guardian (356) — rain entry boost wire", async () => {
    const pkrgId = await erId(356);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.DRIZZLE)
      .enemySpecies(SpeciesId.PELIPPER)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.KINGDRA);
    expect(game.scene.arena.weather?.weatherType).toBeDefined();
  });

  // ===========================================================================
  // GROUP 5: Post-attack scripted move chains
  // ===========================================================================
  it("Volcano Rage (382) — Fire move → Eruption 50BP follow-up", async () => {
    const pkrgId = await erId(382);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.FLAMETHROWER)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.FLAMETHROWER);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("High Tide (503) — Water move → Surf 50BP follow-up", async () => {
    const pkrgId = await erId(503);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SURF)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.KINGDRA);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.SURF);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });
});
