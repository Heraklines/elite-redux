/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Flammable Coat — "Cannot be copied or suppressed" (the implementable clauses;
// the Engulfed form-change is a separate species → engine-blocked).
// Mental Pollution — "Suppresses others' abilities when enraged" — uses the
// dedicated ER_ENRAGE battler tag and dynamically suppresses other field holders.
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
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

  test("Mental Pollution suppresses another field holder while enraged", async () => {
    game.override.ability(ErAbilityId.MENTAL_POLLUTION as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.addTag(BattlerTagType.ER_ENRAGE);

    expect(player.canApplyAbility()).toBe(true);
    expect(enemy.canApplyAbility()).toBe(false);
  });

  test("Mental Pollution does not suppress while not enraged", async () => {
    game.override.ability(ErAbilityId.MENTAL_POLLUTION as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.getTag(BattlerTagType.ER_ENRAGE)).toBeUndefined();
    expect(enemy.canApplyAbility()).toBe(true);
  });

  test("Mental Pollution and Lunar Affinity resolve without recursive field-suppression checks", async () => {
    game.override
      .ability(ErAbilityId.MENTAL_POLLUTION as unknown as AbilityId)
      .enemyAbility(ErAbilityId.LUNAR_AFFINITY as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.addTag(BattlerTagType.ER_ENRAGE);

    expect(player.getActiveAbilitySources().some(source => source.ability.id === ErAbilityId.MENTAL_POLLUTION)).toBe(
      true,
    );
    expect(enemy.getActiveAbilitySources().some(source => source.ability.id === ErAbilityId.LUNAR_AFFINITY)).toBe(
      false,
    );
  });
});
