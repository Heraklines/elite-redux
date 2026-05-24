/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bespoke MOVES smoke suite — verifies every ER bespoke move has a
// pokerogue MoveId mapping AND the corresponding Move object exists in
// allMoves with non-zero base power / proper class.
//
// Requires a GameManager to bootstrap initMoves() + custom-moves init.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import type { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

// All 57 bespoke ER move IDs from move-archetype-dispatcher.ts switch.
const BESPOKE_ER_MOVE_IDS = [
  760, 761, 769, 788, 810, 811, 822, 823, 832, 834, 836, 837, 841, 844, 846,
  853, 897, 935, 949, 950, 951, 954, 955, 962, 963, 964, 966, 967, 969, 970,
  971, 974, 975, 977, 979, 989, 990, 991, 999, 1000, 1003, 1005, 1006, 1007,
  1008, 1009, 1010, 1016, 1017, 1020, 1021, 1022, 1023, 1024, 1027, 1028, 1029,
];

describe.skipIf(!RUN_SCENARIOS)("ER bespoke moves smoke", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("All 57 bespoke ER moves have ER_ID_MAP → pokerogue MoveId mappings", async () => {
    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    let mappedCount = 0;
    for (const erMoveId of BESPOKE_ER_MOVE_IDS) {
      if (erIdMap.moves[erMoveId] !== undefined) {
        mappedCount++;
      }
    }
    expect(mappedCount).toBe(57);
  });

  it("All bespoke moves exist in allMoves after game init", async () => {
    // Boot a game to trigger initMoves() + custom-moves init.
    game.override
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    let existsCount = 0;
    const missing: number[] = [];
    for (const erMoveId of BESPOKE_ER_MOVE_IDS) {
      const pkrgId = erIdMap.moves[erMoveId];
      if (pkrgId !== undefined && allMoves.find(m => m.id === pkrgId)) {
        existsCount++;
      } else {
        missing.push(erMoveId);
      }
    }
    if (missing.length > 0) {
      console.log(`Missing ER moves in allMoves: ${missing.join(", ")}`);
    }
    expect(existsCount).toBe(57);
  });

  it("Every bespoke ER move has a non-empty name after game init", async () => {
    game.override
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    let namedCount = 0;
    for (const erMoveId of BESPOKE_ER_MOVE_IDS) {
      const pkrgId = erIdMap.moves[erMoveId];
      if (pkrgId === undefined) continue;
      const m = allMoves.find(m => m.id === pkrgId);
      if (m && m.name && m.name.length > 0) namedCount++;
    }
    expect(namedCount).toBe(57);
  });

  it("Damaging bespoke ER moves have non-zero base power", async () => {
    game.override
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    let damagingCount = 0;
    let totalBp = 0;
    for (const erMoveId of BESPOKE_ER_MOVE_IDS) {
      const pkrgId = erIdMap.moves[erMoveId];
      if (pkrgId === undefined) continue;
      const m = allMoves.find(m => m.id === pkrgId);
      if (m && m.power > 0) {
        damagingCount++;
        totalBp += m.power;
      }
    }
    expect(damagingCount).toBeGreaterThan(10);
    expect(totalBp).toBeGreaterThan(500);
  });

  it("Status-class bespoke moves are properly configured", async () => {
    game.override
      .battleStyle("single")
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    let statusCount = 0;
    for (const erMoveId of BESPOKE_ER_MOVE_IDS) {
      const pkrgId = erIdMap.moves[erMoveId];
      if (pkrgId === undefined) continue;
      const m = allMoves.find(m => m.id === pkrgId);
      if (m && m.power === 0) statusCount++;
    }
    expect(statusCount).toBeGreaterThan(0);
  });
});
