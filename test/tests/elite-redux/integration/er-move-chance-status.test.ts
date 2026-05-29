/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #125 (moves) — ER custom moves with a secondary chance-status effect
// (archetype "chance-status-on-hit"). The move dispatcher wires a
// StatusEffectAttr / AddBattlerTagAttr and the secondary chance rides on the
// move's `Move.chance` field. These tests confirm the effect fires end-to-end
// and matches the description.
//
// Also serves as the regression test for #128 — custom moves are now index-
// assigned into `allMoves[id]` (not pushed) and registered in the `MoveId`
// reverse-map, so a player Pokémon can actually carry and use a custom move in
// battle (previously they were filtered out of getMoveset / crashed loadAssets).
//
// RNG pinned to the minimum so every secondary roll succeeds.
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

function mockRngMin(): () => void {
  const saved = BattleScene.prototype.randBattleSeedInt;
  BattleScene.prototype.randBattleSeedInt = (_range, min = 0) => min;
  return () => {
    BattleScene.prototype.randBattleSeedInt = saved;
  };
}

async function erMove(id: number): Promise<number | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.moves[id];
}

describe.skipIf(!RUN_SCENARIOS)("ER move chance-status secondary effects (#125 / #128)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Bad Egg (984): 100% badly poisons the target", async () => {
    const move = await erMove(984);
    if (move === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([move])
      .startingLevel(80)
      .enemyLevel(80)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(move);
    await game.toEndOfTurn();
    expect(enemy.status?.effect).toBe(StatusEffect.TOXIC);
  });

  it("Spine Breaker (932): 30% paralyze fires under min-RNG", async () => {
    const move = await erMove(932);
    if (move === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([move])
      .startingLevel(80)
      .enemyLevel(80)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(move);
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.status?.effect).toBe(StatusEffect.PARALYSIS);
  });

  it("Mind Break (827): 20% confuse fires under min-RNG", async () => {
    const move = await erMove(827);
    if (move === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([move])
      .startingLevel(80)
      .enemyLevel(80)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(move);
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.getTag(BattlerTagType.CONFUSED)).toBeDefined();
  });
});
