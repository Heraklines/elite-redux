/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Regression for the in-game "3v1": the triple dev scenario staged a 3-mon enemy
// party (setPendingDevEnemyParty) but ran on wave 145, which is RIVAL_5 - a SCRIPTED
// fixed rival TRAINER battle. A scripted trainer wave ignores BATTLE_TYPE_OVERRIDE and
// the staged wild party, fielding a single rival -> "3v1". The scenario now runs on a
// normal wave forced WILD, so the staged party fills all three foe slots. This pins
// both the root cause (wave 145 is a trainer) and the fix (forced-wild wave = 3v3).
// ER_SCENARIO=1.

import { setPendingDevEnemyParty } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER triple - a staged 3-mon enemy party fields three foes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("triple").ability(AbilityId.BALL_FETCH).startingLevel(80).enemyLevel(80);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("root cause: wave 145 (RIVAL_5) is a SCRIPTED trainer battle, not a wild triple", async () => {
    // The old scenario ran here. Even with the triple style, the fixed rival wave forces
    // a TRAINER battle - the staged wild party never applies, so it comes up short (3v1).
    game.override.startingWave(145);
    setPendingDevEnemyParty([
      { speciesId: SpeciesId.GARCHOMP, level: 80, moveIds: [MoveId.EARTHQUAKE] },
      { speciesId: SpeciesId.SYLVEON, level: 80, moveIds: [MoveId.HYPER_VOICE] },
      { speciesId: SpeciesId.METAGROSS, level: 80, moveIds: [MoveId.METEOR_MASH] },
    ]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    expect(globalScene.currentBattle.battleType).toBe(BattleType.TRAINER);
  });

  it("fields all three staged enemies (not 3v1) on a forced-wild triple wave", async () => {
    // The fixed scenario config: a normal wave (133), forced WILD so the staged party sticks.
    game.override.startingWave(133).battleType(BattleType.WILD).disableTrainerWaves();
    setPendingDevEnemyParty([
      { speciesId: SpeciesId.GARCHOMP, level: 80, moveIds: [MoveId.EARTHQUAKE] },
      { speciesId: SpeciesId.SYLVEON, level: 80, moveIds: [MoveId.HYPER_VOICE] },
      { speciesId: SpeciesId.METAGROSS, level: 80, moveIds: [MoveId.METEOR_MASH] },
    ]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    expect(globalScene.currentBattle.battleType).toBe(BattleType.WILD);
    expect(globalScene.currentBattle.arrangement.enemyCapacity).toBe(3);
    expect(globalScene.getEnemyField(true).length).toBe(3);
    expect(globalScene.currentBattle.enemyLevels?.length).toBeGreaterThanOrEqual(3);
  });
});
