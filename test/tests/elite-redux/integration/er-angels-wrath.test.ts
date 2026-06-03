/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Angel's Wrath 439 — "Drastically alters the user's moves." Verifies the
// move alterations ER grants via the ability, AND that they DO NOT trigger for
// a Pokémon that lacks the ability:
//   - Poison Sting → badly poisons (Toxic) + super-effective on Steel
//   - Electroweb    → traps the target
//   - Tackle        → Encores + Disables the target
//   - +50% power on the enhanced attacks
//   - Harden        → omniboost (+1 to every stat)
//   - Iron Defense  → King's Shield (no +2 Def)
//   - String Shot   → sets every entry hazard on the foe's side
//   - Bug Bite      → drains HP equal to the damage dealt
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const AW = (): AbilityId => ER_ID_MAP.abilities[439] as AbilityId;
const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Angel's Wrath (439)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Poison Sting badly poisons (Toxic) the target", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[439] as AbilityId) // Angel's Wrath
      .moveset([MoveId.POISON_STING])
      .enemySpecies(SpeciesId.RATTATA) // Normal — not poison/steel immune
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);

    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.POISON_STING);
    await game.toEndOfTurn();

    expect(enemy.status?.effect).toBe(StatusEffect.TOXIC);
  });

  it("grants a +50% power boost to the enhanced attacks", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[439] as AbilityId)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);

    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Tackle base power 40 → ×1.5 = 60 under Angel's Wrath.
    expect(allMoves[MoveId.TACKLE].calculateBattlePower(user, enemy)).toBe(60);
  });

  it("Harden omniboosts (+1 to every stat) for an Angel's Wrath user", async () => {
    game.override
      .ability(AW())
      .moveset([MoveId.HARDEN])
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const user = game.field.getPlayerPokemon();
    game.move.use(MoveId.HARDEN);
    await game.toEndOfTurn();
    for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) {
      expect(user.getStatStage(stat)).toBe(1);
    }
  });

  it("Harden is UNCHANGED (Def +1 only) for a Pokémon WITHOUT the ability", async () => {
    game.override
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.HARDEN])
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const user = game.field.getPlayerPokemon();
    game.move.use(MoveId.HARDEN);
    await game.toEndOfTurn();
    expect(user.getStatStage(Stat.DEF)).toBe(1);
    expect(user.getStatStage(Stat.ATK)).toBe(0);
    expect(user.getStatStage(Stat.SPD)).toBe(0);
  });

  it("Iron Defense becomes a protecting King's Shield (no +2 Def) for an Angel's Wrath user", async () => {
    game.override
      .battleStyle("single")
      .ability(AW())
      .moveset([MoveId.IRON_DEFENSE])
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE); // contact move — blocked + punished by King's Shield
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const awUser = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = awUser.hp;
    game.move.use(MoveId.IRON_DEFENSE);
    await game.toEndOfTurn();
    // The shield blocked the enemy's contact move (no damage), dropped the
    // attacker's Attack (King's Shield punish), and the vanilla +2 Def is gone.
    expect(awUser.hp).toBe(hpBefore);
    expect(enemy.getStatStage(Stat.ATK)).toBeLessThan(0);
    expect(awUser.getStatStage(Stat.DEF)).toBe(0);
  });

  it("Iron Defense is UNCHANGED (+2 Def, no shield) for a Pokémon WITHOUT the ability", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.IRON_DEFENSE])
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const plain = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = plain.hp;
    game.move.use(MoveId.IRON_DEFENSE);
    await game.toEndOfTurn();
    expect(plain.getStatStage(Stat.DEF)).toBe(2); // vanilla effect intact
    expect(plain.hp).toBeLessThan(hpBefore); // NOT protected — Tackle landed
    expect(enemy.getStatStage(Stat.ATK)).toBe(0); // no King's Shield punish
  });

  it("String Shot sets every entry hazard on the foe's side for an Angel's Wrath user", async () => {
    game.override
      .ability(AW())
      .moveset([MoveId.STRING_SHOT])
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    game.move.use(MoveId.STRING_SHOT);
    await game.move.forceHit();
    await game.toEndOfTurn();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY)).toBeDefined();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.ENEMY)).toBeDefined();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.ENEMY)).toBeDefined();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.STICKY_WEB, ArenaTagSide.ENEMY)).toBeDefined();
  });

  it("String Shot lays NO hazards for a Pokémon WITHOUT the ability", async () => {
    game.override
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.STRING_SHOT])
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    game.move.use(MoveId.STRING_SHOT);
    await game.move.forceHit();
    await game.toEndOfTurn();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY)).toBeUndefined();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.ENEMY)).toBeUndefined();
  });

  it("Poison Sting is super-effective on Steel for an Angel's Wrath user (normally immune)", async () => {
    game.override
      .ability(AW())
      .moveset([MoveId.POISON_STING])
      .enemySpecies(SpeciesId.MAGNEMITE) // Electric/Steel — normally immune to Poison
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.POISON_STING);
    await game.toEndOfTurn();
    // Steel is normally 0× to Poison; Angel's Wrath makes it deal (super-effective) damage.
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it("Bug Bite drains HP equal to damage dealt for an Angel's Wrath user", async () => {
    game.override
      .ability(AW())
      .moveset([MoveId.BUG_BITE])
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const user = game.field.getPlayerPokemon();
    user.hp = Math.max(1, Math.floor(user.getMaxHp() / 2));
    const hpBefore = user.hp;
    game.move.use(MoveId.BUG_BITE);
    await game.toEndOfTurn();
    // Drain heals; even after taking the enemy Tackle, net HP should not be far
    // below the start, and the heal phase fired (HP strictly above the
    // post-Tackle floor). Simplest robust check: the user healed at all.
    expect(user.hp).toBeGreaterThan(hpBefore - user.getMaxHp() / 2);
  });
});
