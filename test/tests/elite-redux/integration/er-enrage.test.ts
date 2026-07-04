/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER "Enrage" status (2.65). Enrage is the ER_ENRAGE battler tag, NOT vanilla
// Taunt (the earlier TAUNT-based model wrongly barred the holder from status
// moves). Per the dex: "Causes a Pokemon to deal 33% of the damage it deals
// with moves as recoil. Also makes them affected by Reckless and lasts until
// switched out." Rock Head / Steel Barrel / Brute Force grant "immunity to
// enrage recoil".
//
// Covers:
//   - APPLY (move): Swagger inflicts ER_ENRAGE on the target.
//   - APPLY (ability): Berserk DNA 529 enrages ITSELF on entry.
//   - EFFECT: an enraged mon takes 33% of the damage it deals as recoil.
//   - IMMUNITY: Rock Head takes no enrage recoil.
//   - READ: Cosmic Daze 534 deals 2x to an enraged foe.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const moveId = (name: string): number => allMoves.find(m => m?.name === name)!.id;

describe.skipIf(!RUN)("ER Enrage status (33% recoil)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Swagger inflicts ER_ENRAGE on the target", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(moveId("Splash"))
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    // Swagger is 85% accurate; the framework clamps rolls to MAX (which would
    // miss), so force the user's rolls low to guarantee the hit.
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);

    game.move.use(moveId("Swagger"), 0);
    await game.toNextTurn();

    expect(enemy.getTag(BattlerTagType.ER_ENRAGE), "Swagger enraged the foe").toBeDefined();
  }, 120_000);

  it("an enraged mon takes 33% of the damage it deals as recoil", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      // Sleeping bulky foe: it takes the hit but never counterattacks, so the
      // only thing that moves the attacker's HP is the enrage recoil.
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    player.addTag(BattlerTagType.ER_ENRAGE);
    const enemyHp0 = enemy.hp;
    const playerHp0 = player.hp;

    game.move.use(moveId("Tackle"), 0);
    await game.toNextTurn();

    const dealt = enemyHp0 - enemy.hp;
    expect(dealt, "the attack dealt damage").toBeGreaterThan(0);
    const recoil = playerHp0 - player.hp;
    // 33% of damage dealt (floored, min 1).
    expect(recoil, "recoil is ~33% of damage dealt").toBe(Math.max(1, Math.floor(dealt * 0.33)));
  }, 120_000);

  it("Rock Head grants immunity to enrage recoil", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .ability(AbilityId.ROCK_HEAD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    player.addTag(BattlerTagType.ER_ENRAGE);
    const playerHp0 = player.hp;

    game.move.use(moveId("Tackle"), 0);
    await game.toNextTurn();

    expect(player.hp, "Rock Head took no enrage recoil").toBe(playerHp0);
  }, 120_000);

  it("Berserk DNA 529 enrages the holder on entry", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[529] as AbilityId) // Berserk DNA
      .moveset([moveId("Splash")])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(moveId("Splash"));
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    expect(player.getTag(BattlerTagType.ER_ENRAGE), "Berserk DNA self-enraged on entry").toBeDefined();
  }, 120_000);

  it("Cosmic Daze 534 deals 2x to an enraged foe", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .ability(ER_ID_MAP.abilities[534] as AbilityId) // Cosmic Daze
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Splash"))
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.scene.getEnemyPokemon()!;

    // Baseline hit (foe not enraged).
    enemy.hp = enemy.getMaxHp();
    game.move.use(moveId("Tackle"), 0);
    await game.toNextTurn();
    const baseDmg = enemy.getMaxHp() - enemy.hp;

    // Now enrage the foe and hit again from full.
    enemy.hp = enemy.getMaxHp();
    enemy.addTag(BattlerTagType.ER_ENRAGE);
    game.move.use(moveId("Tackle"), 0);
    await game.toNextTurn();
    const enragedDmg = enemy.getMaxHp() - enemy.hp;

    expect(baseDmg, "baseline dealt damage").toBeGreaterThan(0);
    // ~2x (the multiplier is applied inside the damage formula, so per-step
    // flooring leaves it a few HP under an exact double).
    expect(enragedDmg, "Cosmic Daze ~doubles damage vs an enraged foe").toBeGreaterThanOrEqual(baseDmg * 2 - 3);
    expect(enragedDmg, "not more than double").toBeLessThanOrEqual(baseDmg * 2 + 1);
  }, 120_000);

  it("Incite adds the Dark type to the target and enrages it", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX) // Normal -> gains Dark as a second type
      .enemyMoveset(moveId("Splash"))
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0); // guarantee the hit

    game.move.use(moveId("Incite"), 0);
    await game.toNextTurn();

    expect(enemy.getTag(BattlerTagType.ER_ENRAGE), "Incite enraged the foe").toBeDefined();
    expect(enemy.isOfType(PokemonType.DARK), "Incite added the Dark type").toBe(true);
  }, 120_000);

  it("Deviate: a Dark user's Normal move becomes Dark and can enrage (10%)", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .ability(ErAbilityId.DEVIATE as unknown as AbilityId)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyStatusEffect(StatusEffect.SLEEP)
      .enemyMoveset(moveId("Tackle"))
      .enemyAbility(AbilityId.BALL_FETCH)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.UMBREON); // pure Dark user
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    expect(player.getMoveType(allMoves.find(m => m?.name === "Tackle")!), "Deviate retypes Normal->Dark").toBe(
      PokemonType.DARK,
    );
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0); // force the 10% enrage proc

    game.move.use(moveId("Tackle"), 0);
    await game.toNextTurn();

    expect(enemy.getTag(BattlerTagType.ER_ENRAGE), "Dark user's converted move enraged the foe").toBeDefined();
  }, 120_000);
});
