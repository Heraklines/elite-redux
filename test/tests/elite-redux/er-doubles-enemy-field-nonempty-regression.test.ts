/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Item C guard ("battle-starts-with-no-opponent", screenshot Meadow wave 113
// doubles, 2026-07-15): a DOUBLES battle's command menu was reported open with
// ZERO enemy field mons / no enemy HP panels.
//
// Root-cause status: the empty-field-at-battle-START does NOT reproduce on HEAD
// with a standard wild doubles at that wave/biome - enemy generation
// (battle.ts fills enemyLevels to arrangement.enemyCapacity, encounter-phase.ts
// generates one enemy per level and fieldSetup()s each up to enemyCapacity) fields
// the full pair before CommandPhase. This guard locks that invariant: a wild
// doubles must present a NON-EMPTY, non-fainted enemy field when the command menu
// opens. A regression that leaves the field empty at battle start (the reported
// symptom) fails here.
//
// (The distinct MID-battle empty-field classes - the variant-DOUBLE trainer
// reserve-summon slot-gate and the all-foes-fainted-on-entry-hazard softlock -
// are separate and covered elsewhere / need their own live capture; this is the
// battle-START invariant only.)
//
// Gated behind ER_SCENARIO=1 like every ER engine test.
// =============================================================================

import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("wild doubles fields a non-empty enemy field at battle start (item C)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("a wave-113 Meadow wild double battle has 2 living foes when the command menu opens", async () => {
    game.override.battleStyle("double").startingWave(113).startingBiome(BiomeId.MEADOW).disableTrainerWaves();

    await game.classicMode.startBattle(SpeciesId.MEWTWO, SpeciesId.ARCEUS);

    // The command menu is open (CommandPhase reached). The enemy field must NOT be empty.
    const enemyField = game.scene.getEnemyField();
    expect(enemyField.length, "a double battle must field both foes at battle start").toBe(2);
    for (const foe of enemyField) {
      expect(foe.isFainted(), `${foe.name} must be alive & on the field when the command menu opens`).toBe(false);
    }
  });
});
