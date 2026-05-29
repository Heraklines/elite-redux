/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #127 — composite-ability RIDERS wired via the hand-maintained
// `compositeRiderAttrs` table (free-text effects the auto-generator couldn't
// resolve). These verify the riders that use existing/new primitives:
//   - Two-Faced (785): Electric & Dark moves x1.35 WITH 10% recoil
//     (TypeDamageBoost + TypeRecoil).
//   - Mucus Membrane (986): takes 30% less damage from all attacks
//     (DamageReduction, filter "all").
//
// Damage variance mocked to a constant so ratios are deterministic.
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER composite riders (#127)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Two-Faced (785): Electric move takes 10% recoil (boost rider's downside)", async () => {
    const ability = await erId(785);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability) // Two-Faced — not Rock Head / Magic Guard
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.THUNDERBOLT, MoveId.TACKLE])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    const enemyHp0 = enemy.hp;
    const playerHp0 = player.hp;
    game.move.use(MoveId.THUNDERBOLT); // Electric — boosted, with recoil
    await game.toEndOfTurn();
    const dmgDealt = enemyHp0 - enemy.hp;
    const recoilTaken = playerHp0 - player.hp;
    expect(dmgDealt, "Electric move dealt damage").toBeGreaterThan(0);
    expect(recoilTaken, "user took recoil").toBeGreaterThan(0);
    const expected = Math.floor(dmgDealt * 0.1);
    expect(Math.abs(recoilTaken - expected)).toBeLessThanOrEqual(2);
  });

  it("Two-Faced (785): a NON-Electric/Dark move takes NO recoil (type-gated)", async () => {
    const ability = await erId(785);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.THUNDERBOLT])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const player = game.field.getPlayerPokemon();
    const playerHp0 = player.hp;
    game.move.use(MoveId.TACKLE); // Normal — not Electric/Dark, no recoil
    await game.toEndOfTurn();
    expect(player.hp, "Normal move should not cause recoil").toBe(playerHp0);
  });

  it("Mucus Membrane (986): takes 30% less damage from attacks", async () => {
    const ability = await erId(986);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.TACKLE)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const player = game.field.getPlayerPokemon();

    // Turn 1 — ability active: reduced incoming damage.
    let hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toNextTurn();
    const dmgReduced = hp0 - player.hp;

    // Suppress, heal, take the hit again at full.
    player.summonData.abilitySuppressed = true;
    player.hp = player.getMaxHp();
    hp0 = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    const dmgFull = hp0 - player.hp;

    expect(dmgFull, "baseline dealt damage").toBeGreaterThan(0);
    const ratio = dmgReduced / dmgFull;
    expect(ratio, `expected ~0.7x taken (got ${ratio.toFixed(3)})`).toBeGreaterThan(0.65);
    expect(ratio, `expected ~0.7x taken (got ${ratio.toFixed(3)})`).toBeLessThan(0.75);
  });

  it("Dreamscape (859): all moves deal 20% more damage", async () => {
    const ability = await erId(859);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();

    let hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toNextTurn();
    const dmgBoosted = hp0 - enemy.hp;

    player.summonData.abilitySuppressed = true;
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const dmgBase = hp0 - enemy.hp;

    expect(dmgBase, "baseline dealt damage").toBeGreaterThan(0);
    const ratio = dmgBoosted / dmgBase;
    expect(ratio, `expected ~1.2x (got ${ratio.toFixed(3)})`).toBeGreaterThan(1.15);
    expect(ratio, `expected ~1.2x (got ${ratio.toFixed(3)})`).toBeLessThan(1.25);
  });

  it("Marine Apex (389): +50% damage vs Water-type targets", async () => {
    const ability = await erId(389);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.VAPOREON) // pure Water; Tackle is neutral vs Water
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    let hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toNextTurn();
    const dmgBoosted = hp0 - enemy.hp;
    player.summonData.abilitySuppressed = true;
    enemy.hp = enemy.getMaxHp();
    hp0 = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const dmgBase = hp0 - enemy.hp;
    expect(dmgBase, "baseline dealt damage").toBeGreaterThan(0);
    const ratio = dmgBoosted / dmgBase;
    expect(ratio, `expected ~1.5x vs Water (got ${ratio.toFixed(3)})`).toBeGreaterThan(1.45);
    expect(ratio, `expected ~1.5x vs Water (got ${ratio.toFixed(3)})`).toBeLessThan(1.55);
  });

  it("Sinister Claws (1011): a slicing move lowers the target's Sp. Def", async () => {
    const ability = await erId(1011);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SLASH, MoveId.TACKLE]) // SLASH is a slicing move
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.SLASH);
    await game.toEndOfTurn();
    expect(enemy.getStatStage(Stat.SPDEF)).toBe(-1);
  });

  it("Sinister Claws (1011): a NON-slicing move does NOT lower Sp. Def", async () => {
    const ability = await erId(1011);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SLASH])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.getStatStage(Stat.SPDEF)).toBe(0);
  });
});
