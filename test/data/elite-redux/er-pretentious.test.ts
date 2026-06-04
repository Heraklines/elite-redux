/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Pretentious — each KO accumulates +1 crit stage (read in getCritStage).
import { allMoves } from "#data/data-lists";
import { CritStackOnKoAbAttr } from "#data/elite-redux/archetypes/crit-stack-on-ko";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("ER Ability - Pretentious", () => {
  let pg: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    pg = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(pg);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .ability(ErAbilityId.PRETENTIOUS as unknown as AbilityId)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE])
      .enemyAbility(AbilityId.BALL_FETCH);
  });
  test("each KO raises the holder's crit stage by one", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const tackle = allMoves[MoveId.TACKLE];
    const attr = player.getAbility().attrs.find(a => a instanceof CritStackOnKoAbAttr) as CritStackOnKoAbAttr;
    expect(attr).toBeDefined();
    const base = enemy.getCritStage(player, tackle);
    attr.apply({ pokemon: player, simulated: false } as never); // 1 KO
    expect(enemy.getCritStage(player, tackle)).toBe(base + 1);
    attr.apply({ pokemon: player, simulated: false } as never); // 2nd KO
    expect(enemy.getCritStage(player, tackle)).toBe(base + 2);
  });
});
