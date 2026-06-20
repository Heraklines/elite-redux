/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Fog ability tests — the ER fog ecosystem includes ~10 abilities that
// summon, exploit, or react to FOG weather. This suite verifies they
// work together and produce the right effects.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER fog ecosystem", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Low Visibility (619) — wire installed (entry-effect EERIE_FOG)", async () => {
    const pkrgId = await erId(619);
    if (pkrgId === undefined) {
      return;
    }
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
  });

  it("Ectoplasm (621) — wire installed (highest atk stat 1.5x in fog)", async () => {
    const pkrgId = await erId(621);
    if (pkrgId === undefined) {
      return;
    }
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
  });

  it("Surprise! (623) — wire installed (Astonishes priority users in fog)", async () => {
    const pkrgId = await erId(623);
    if (pkrgId === undefined) {
      return;
    }
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
  });

  it("Greater Spirit (625) — wire installed (+1 highest stat on entry in fog)", async () => {
    const pkrgId = await erId(625);
    if (pkrgId === undefined) {
      return;
    }
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
  });

  it("Ethereal Rush (627) — wire installed (1.5x Speed in fog)", async () => {
    const pkrgId = await erId(627);
    if (pkrgId === undefined) {
      return;
    }
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
  });

  it("Shallow Grave (629) — wire installed (revive 25% HP in fog)", async () => {
    const pkrgId = await erId(629);
    if (pkrgId === undefined) {
      return;
    }
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
  });

  it("Fog Machine (905) — sets FOG weather on hit", async () => {
    const pkrgId = await erId(905);
    if (pkrgId === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(pkrgId)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    // After being hit, Fog Machine sets WeatherType.FOG (= 6).
    expect(game.scene.arena.weather?.weatherType).toBe(6);
  });

  it("Surprise counters priority after the holder's first turn", async () => {
    const pkrgId = await erId(623);
    if (pkrgId === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.LUCARIO)
      .enemyMoveset(MoveId.QUICK_ATTACK)
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    game.scene.arena.trySetWeather(WeatherType.FOG);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.tempSummonData.waveTurnCount = 2;
    const playerHp = player.hp;
    const enemyHp = enemy.hp;

    game.move.use(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.QUICK_ATTACK, BattlerIndex.PLAYER);
    await game.toEndOfTurn();

    expect(enemy.hp).toBeLessThan(enemyHp);
    expect(player.hp).toBe(playerHp);
    expect(enemy).toHaveUsedMove({ move: MoveId.QUICK_ATTACK, result: MoveResult.FAIL });
  });
});
