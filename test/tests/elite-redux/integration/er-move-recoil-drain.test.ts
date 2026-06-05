/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #125 (moves) — ER custom moves with the "recoil-or-drain" archetype.
// The move dispatcher wires a RecoilAttr (mode=recoil) or HitHealAttr
// (mode=drain) with the percentage from the ER draft. These tests confirm the
// effect fires end-to-end and the percentage matches the description:
//   - Star Crash (820): 33% recoil
//   - Psycho Wave (1025): 50% recoil
//   - Soil Drain (858): heals 50% of damage dealt
//
// Damage variance is mocked to a constant so the recoil/heal amount is
// deterministic. Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erMove(id: number): Promise<number | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.moves[id];
}

describe.skipIf(!RUN_SCENARIOS)("ER move recoil/drain (#125)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  async function expectRecoil(erId: number, pct: number): Promise<void> {
    const move = await erMove(erId);
    if (move === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD) // guarantee hits (some moves are <100% acc); does NOT block recoil
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([move])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    const enemyHp0 = enemy.hp;
    const playerHp0 = player.hp;
    game.move.use(move);
    await game.toEndOfTurn();
    const dmgDealt = enemyHp0 - enemy.hp;
    const recoilTaken = playerHp0 - player.hp;
    expect(dmgDealt, "move dealt damage").toBeGreaterThan(0);
    expect(recoilTaken, "user took recoil").toBeGreaterThan(0);
    // RecoilAttr floors `dmg * pct`; allow ±2 for rounding.
    const expected = Math.floor(dmgDealt * pct);
    expect(Math.abs(recoilTaken - expected)).toBeLessThanOrEqual(2);
  }

  it("Star Crash (820): 33% recoil", async () => {
    await expectRecoil(820, 0.33);
  });

  it("Psycho Wave (1025): 50% recoil", async () => {
    await expectRecoil(1025, 0.5);
  });

  it("Soil Drain (858): heals 50% of damage dealt", async () => {
    const move = await erMove(858);
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
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    // Damage the user so the drain heal is observable (not capped at max HP).
    player.hp = Math.floor(player.getMaxHp() / 2);
    const playerHpBefore = player.hp;
    const enemyHp0 = enemy.hp;
    game.move.use(move);
    await game.toEndOfTurn();
    const dmgDealt = enemyHp0 - enemy.hp;
    const healed = player.hp - playerHpBefore;
    expect(dmgDealt, "move dealt damage").toBeGreaterThan(0);
    expect(healed, "user drained HP").toBeGreaterThan(0);
    const expected = Math.floor(dmgDealt * 0.5);
    expect(Math.abs(healed - expected)).toBeLessThanOrEqual(2);
  });

  it("Leech Blade (835): heals 50% of damage dealt (drain was previously dropped)", async () => {
    // Regression: Leech Blade was wired as flag-tagged-move (KEEN_EDGE only), so
    // the "Heals 50% of damage done" half was missing and it drained nothing.
    const move = await erMove(835);
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
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    vi.spyOn(Pokemon.prototype, "randBattleSeedIntRange").mockImplementation((_min: number, max: number) => max);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    // Damage the user so the drain heal is observable (not capped at max HP).
    player.hp = Math.floor(player.getMaxHp() / 2);
    const playerHpBefore = player.hp;
    const enemyHp0 = enemy.hp;
    game.move.use(move);
    await game.toEndOfTurn();
    const dmgDealt = enemyHp0 - enemy.hp;
    const healed = player.hp - playerHpBefore;
    expect(dmgDealt, "Leech Blade dealt damage").toBeGreaterThan(0);
    expect(healed, "Leech Blade drained HP").toBeGreaterThan(0);
    expect(Math.abs(healed - Math.floor(dmgDealt * 0.5))).toBeLessThanOrEqual(2);
  });
});
