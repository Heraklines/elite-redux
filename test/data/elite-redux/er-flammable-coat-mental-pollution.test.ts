/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Flammable Coat — "Cannot be copied or suppressed" (the implementable clauses;
// the Engulfed form-change is a separate species → engine-blocked).
// Mental Pollution — "Suppresses others' abilities when enraged" — modeled with
// FOG as the established ER enrage proxy (cf. Madness Enhancement).
import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Abilities - Flammable Coat & Mental Pollution (engine-limited clauses)", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.INTIMIDATE)
      .enemyLevel(1) // keep the holder alive so the PostDefend suppress can fire
      .enemyMoveset(MoveId.TACKLE)
      .moveset([MoveId.SPLASH]);
  });

  test("Flammable Coat is uncopiable and unsuppressable", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const fc = allAbilities[ErAbilityId.FLAMMABLE_COAT];
    expect(fc).toBeDefined();
    expect(fc.suppressable).toBe(false);
    expect(fc.copiable).toBe(false);
    expect(fc.replaceable).toBe(false);
  });

  // Drive the holder's PostDefend suppress attr directly against the live scene
  // (real arena weather), so the assertion doesn't depend on enemy-AI move
  // resolution. `move` is a real AttackMove so `move.is("AttackMove")` holds.
  const suppressAttr = (player: any) =>
    [...player.getAbility().attrs].find((a: any) => a?.constructor?.name === "SuppressAttackerAbilityAbAttr");
  const anAttackMove = () => allMoves.find(m => m?.is("AttackMove"))!;

  test("Mental Pollution suppresses an attacking foe's ability while fog (enrage) is active", async () => {
    game.override.ability(ErAbilityId.MENTAL_POLLUTION as unknown as AbilityId).weather(WeatherType.FOG);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.FOG); // sanity: enraged
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const attr = suppressAttr(player) as any;
    expect(attr).toBeDefined();
    const params = { pokemon: player, opponent: enemy, move: anAttackMove(), simulated: false } as any;
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(enemy.summonData.abilitySuppressed).toBe(true);
  });

  test("Mental Pollution does NOT suppress without fog (not enraged)", async () => {
    game.override.ability(ErAbilityId.MENTAL_POLLUTION as unknown as AbilityId).weather(WeatherType.NONE);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const attr = suppressAttr(player) as any;
    const params = { pokemon: player, opponent: enemy, move: anAttackMove(), simulated: false } as any;
    expect(attr.canApply(params)).toBe(false); // no fog → not enraged → no suppression
  });
});
